#include "test_controller.hpp"
#include "../db/test_run_repository.hpp"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <chrono>
#include <sstream>
#include <iomanip>

namespace workflows {

TestController::TestController() = default;

TestController::TestController(std::shared_ptr<db::TestRunRepository> repository)
    : repository_(std::move(repository)) {
    spdlog::info("TestController: Initialized with database repository");
}

TestController::~TestController() {
    stop_test();
    if (test_thread_ && test_thread_->joinable()) {
        test_thread_->join();
    }
}

bool TestController::start_test(const TestConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (state_ != TestState::IDLE && state_ != TestState::COMPLETE && state_ != TestState::ERROR) {
        spdlog::warn("TestController: Cannot start test, state is not IDLE");
        return false;
    }
    
    // 验证配置
    if (config.param_sets.empty()) {
        spdlog::error("TestController: No param sets provided");
        return false;
    }
    
    // 计算总循环数
    int total = 0;
    for (const auto& ps : config.param_sets) {
        if (ps.cycles > 0) {
            total += ps.cycles;
        }
    }
    if (total == 0) {
        spdlog::error("TestController: Total cycles is 0");
        return false;
    }
    
    // 保存配置
    config_ = config;
    global_total_cycles_ = total;
    
    // 重置状态
    stop_requested_ = false;
    current_param_set_ = 0;
    current_cycle_ = 0;
    global_cycle_ = 0;
    current_param_name_.clear();
    message_.clear();
    logs_.clear();
    dynamic_empty_weight_.reset();
    current_run_id_ = 0;
    
    // 创建数据库记录
    if (repository_) {
        auto run_id = repository_->create_run(config_to_json(), total);
        if (run_id) {
            current_run_id_ = *run_id;
            spdlog::info("TestController: Created database run with id={}", current_run_id_);
        } else {
            spdlog::warn("TestController: Failed to create database run, continuing without persistence");
        }
    }
    
    // 启动测试线程
    if (test_thread_ && test_thread_->joinable()) {
        test_thread_->join();
    }
    test_thread_ = std::make_unique<std::thread>(&TestController::test_thread_func, this);
    
    spdlog::info("TestController: Test started with {} param sets, {} total cycles",
                 config.param_sets.size(), global_total_cycles_);
    return true;
}

void TestController::stop_test() {
    stop_requested_ = true;
    
    std::lock_guard<std::mutex> lock(mutex_);
    if (state_ != TestState::IDLE && state_ != TestState::COMPLETE && state_ != TestState::ERROR) {
        state_ = TestState::STOPPING;
        message_ = "正在停止测试...";
        add_log("用户请求停止测试");
    }
}

TestStatus TestController::get_status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    
    TestStatus status;
    status.state = state_;
    status.run_id = current_run_id_;
    status.current_param_set = current_param_set_;
    status.total_param_sets = static_cast<int>(config_.param_sets.size());
    status.current_cycle = current_cycle_;
    
    // 获取当前参数组的总循环数
    if (current_param_set_ > 0 && current_param_set_ <= static_cast<int>(config_.param_sets.size())) {
        status.total_cycles = config_.param_sets[current_param_set_ - 1].cycles;
    } else {
        status.total_cycles = 0;
    }
    
    status.global_cycle = global_cycle_;
    status.global_total_cycles = global_total_cycles_;
    status.current_param_name = current_param_name_;
    status.message = message_;
    status.dynamic_empty_weight = dynamic_empty_weight_;
    
    // 复制最近日志
    status.logs.assign(logs_.begin(), logs_.end());
    
    return status;
}

std::vector<TestResult> TestController::get_results() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return results_;
}

void TestController::clear_results() {
    std::lock_guard<std::mutex> lock(mutex_);
    results_.clear();
}

int TestController::get_current_run_id() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return current_run_id_;
}

std::string TestController::config_to_json() const {
    nlohmann::json j;
    j["accel"] = config_.accel;
    j["empty_tolerance"] = config_.empty_tolerance;
    j["drain_stability_window"] = config_.drain_stability_window;
    
    nlohmann::json param_sets = nlohmann::json::array();
    for (const auto& ps : config_.param_sets) {
        nlohmann::json p;
        p["id"] = ps.id;
        p["name"] = ps.name;
        p["pump2_volume"] = ps.pump2_volume;
        p["pump3_volume"] = ps.pump3_volume;
        p["pump4_volume"] = ps.pump4_volume;
        p["pump5_volume"] = ps.pump5_volume;
        p["speed"] = ps.speed;
        p["cycles"] = ps.cycles;
        param_sets.push_back(p);
    }
    j["param_sets"] = param_sets;
    
    return j.dump();
}

void TestController::record_weight_sample(const std::string& phase) {
    if (!repository_ || current_run_id_ == 0 || !get_weight_) return;
    
    auto [weight, is_stable] = get_weight_();
    std::string trend = "stable";
    
    repository_->insert_weight_sample(
        current_run_id_, current_cycle_, phase,
        weight, is_stable, trend
    );
}

void TestController::add_log(const std::string& msg) {
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    std::tm tm = *std::localtime(&time_t);
    
    std::ostringstream oss;
    oss << std::put_time(&tm, "%H:%M:%S") << " " << msg;
    std::string log_entry = oss.str();
    
    logs_.push_back(log_entry);
    if (logs_.size() > MAX_LOGS) {
        logs_.pop_front();
    }
    
    spdlog::info("TestController: {}", msg);
}

void TestController::test_thread_func() {
    spdlog::info("TestController: Test thread started");
    
    {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = TestState::DRAINING;
        add_log("开始自动测试");
    }
    
    // 重置动态空瓶值
    if (reset_dynamic_empty_weight_) {
        reset_dynamic_empty_weight_();
        std::lock_guard<std::mutex> lock(mutex_);
        dynamic_empty_weight_.reset();
        add_log("动态空瓶值已重置");
    }
    
    try {
        int param_set_idx = 0;
        for (const auto& param_set : config_.param_sets) {
            if (param_set.cycles <= 0) continue;
            if (stop_requested_) break;
            
            param_set_idx++;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                current_param_set_ = param_set_idx;
                current_param_name_ = param_set.name;
                add_log("=== 开始参数组 [" + param_set.name + "] (" + 
                       std::to_string(param_set.cycles) + " 次) ===");
            }
            
            for (int cycle = 1; cycle <= param_set.cycles; cycle++) {
                if (stop_requested_) break;
                
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    current_cycle_ = cycle;
                    global_cycle_++;
                }
                
                run_single_cycle(param_set, cycle);
            }
        }
        
        if (!stop_requested_) {
            // 最后排废
            {
                std::lock_guard<std::mutex> lock(mutex_);
                state_ = TestState::DRAINING;
                add_log("最后排废，等待空瓶...");
            }
            
            if (set_system_state_) {
                set_system_state_("DRAIN");
            }
            
            {
                std::lock_guard<std::mutex> lock(mutex_);
                state_ = TestState::WAITING_EMPTY;
            }
            
            if (wait_for_empty_bottle_) {
                auto [success, weight] = wait_for_empty_bottle_(
                    config_.empty_tolerance, 120.0f, config_.drain_stability_window);
                if (success) {
                    std::lock_guard<std::mutex> lock(mutex_);
                    dynamic_empty_weight_ = weight;
                }
            }
            
            if (set_system_state_) {
                set_system_state_("INITIAL");
            }
            
            {
                std::lock_guard<std::mutex> lock(mutex_);
                state_ = TestState::COMPLETE;
                add_log("=== 自动测试完成！===");
                message_ = "测试完成";
            }
            
            // 更新数据库状态
            if (repository_ && current_run_id_ > 0) {
                repository_->complete_run(current_run_id_, "completed");
            }
        } else {
            // 停止时恢复初始状态
            if (set_system_state_) {
                set_system_state_("INITIAL");
            }
            
            std::lock_guard<std::mutex> lock(mutex_);
            state_ = TestState::IDLE;
            add_log("测试已停止");
            message_ = "测试已停止";
            
            // 更新数据库状态
            if (repository_ && current_run_id_ > 0) {
                repository_->complete_run(current_run_id_, "aborted");
            }
        }
    } catch (const std::exception& e) {
        spdlog::error("TestController: Exception: {}", e.what());
        
        if (set_system_state_) {
            set_system_state_("INITIAL");
        }
        
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = TestState::ERROR;
        message_ = std::string("错误: ") + e.what();
        add_log(message_);
        
        // 更新数据库状态
        if (repository_ && current_run_id_ > 0) {
            repository_->update_run_state(current_run_id_, "error", -1, e.what());
        }
    }
    
    spdlog::info("TestController: Test thread finished");
}

void TestController::run_single_cycle(const ParamSet& param_set, int cycle_num) {
    auto cycle_start = std::chrono::steady_clock::now();
    
    float total_volume = param_set.pump2_volume + param_set.pump3_volume +
                         param_set.pump4_volume + param_set.pump5_volume;
    
    TestResult result;
    result.param_set_id = param_set.id;
    result.param_set_name = param_set.name;
    result.cycle = cycle_num;
    result.total_volume = total_volume;
    result.pump2_volume = param_set.pump2_volume;
    result.pump3_volume = param_set.pump3_volume;
    result.pump4_volume = param_set.pump4_volume;
    result.pump5_volume = param_set.pump5_volume;
    result.speed = param_set.speed;
    result.timestamp = std::chrono::system_clock::now();
    
    // 步骤1: 排废
    auto step_start = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = TestState::DRAINING;
        add_log("[" + param_set.name + "] 循环 " + std::to_string(cycle_num) + ": 开始排废...");
    }
    
    if (set_system_state_) {
        set_system_state_("DRAIN");
    }
    
    result.drain_duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - step_start).count();
    
    if (stop_requested_) return;
    
    // 步骤2: 等待空瓶稳定
    step_start = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = TestState::WAITING_EMPTY;
        add_log("[" + param_set.name + "] 循环 " + std::to_string(cycle_num) + ": 等待空瓶稳定...");
    }
    
    float empty_weight = 0;
    if (wait_for_empty_bottle_) {
        auto [success, weight] = wait_for_empty_bottle_(
            config_.empty_tolerance, 60.0f, config_.drain_stability_window);
        if (success) {
            empty_weight = weight;
            std::lock_guard<std::mutex> lock(mutex_);
            dynamic_empty_weight_ = weight;
        } else {
            throw std::runtime_error("等待空瓶稳定超时");
        }
    }
    result.empty_weight = empty_weight;
    result.wait_empty_duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - step_start).count();
    
    if (stop_requested_) return;
    
    // 步骤3: 进样
    step_start = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = TestState::INJECTING;
        std::ostringstream oss;
        oss << "[" << param_set.name << "] 循环 " << cycle_num 
            << ": 进样 (总量=" << total_volume << "mm, 速度=" << param_set.speed << "mm/s)";
        add_log(oss.str());
    }
    
    if (start_injection_) {
        start_injection_(
            param_set.pump2_volume, param_set.pump3_volume,
            param_set.pump4_volume, param_set.pump5_volume,
            param_set.speed, config_.accel);
        
        // 等待进样完成（根据最大泵量和速度计算预估时间 + 2秒余量）
        float max_volume = std::max({param_set.pump2_volume, param_set.pump3_volume,
                                     param_set.pump4_volume, param_set.pump5_volume});
        int wait_ms = static_cast<int>(max_volume / param_set.speed * 1000) + 2000;
        
        add_log("等待进样完成 (" + std::to_string(wait_ms / 1000) + "s)...");
        
        // 分段等待，以便可以响应停止请求
        int waited = 0;
        while (waited < wait_ms && !stop_requested_) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            waited += 100;
        }
    }
    
    result.inject_duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - step_start).count();
    
    if (stop_requested_) return;
    
    // 步骤4: 等待称重稳定
    step_start = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = TestState::WAITING_STABLE;
        add_log("[" + param_set.name + "] 循环 " + std::to_string(cycle_num) + ": 等待称重稳定...");
    }
    
    float full_weight = 0;
    if (!wait_for_weight_stable(30.0f)) {
        throw std::runtime_error("等待称重稳定超时");
    }
    
    if (get_weight_) {
        auto [weight, stable] = get_weight_();
        full_weight = weight;
    }
    
    result.full_weight = full_weight;
    result.injected_weight = full_weight - empty_weight;
    result.wait_stable_duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - step_start).count();
    
    result.total_duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - cycle_start).count();
    
    // 记录结果
    {
        std::lock_guard<std::mutex> lock(mutex_);
        results_.push_back(result);
        
        std::ostringstream oss;
        oss << "[" << param_set.name << "] 循环 " << cycle_num 
            << " 完成: 进样量=" << std::fixed << std::setprecision(2) << result.injected_weight 
            << "g (耗时=" << result.total_duration_ms / 1000.0 << "s)";
        add_log(oss.str());
    }
    
    // 写入数据库
    if (repository_ && current_run_id_ > 0) {
        repository_->insert_result(current_run_id_, result);
        repository_->update_run_state(current_run_id_, "running", global_cycle_);
    }
    
    // 恢复初始状态
    if (set_system_state_) {
        set_system_state_("INITIAL");
    }
}

bool TestController::wait_for_weight_stable(float timeout_sec) {
    if (!get_weight_) return false;
    
    auto start = std::chrono::steady_clock::now();
    int stable_count = 0;
    float last_weight = 0;
    
    while (!stop_requested_) {
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now() - start).count();
        if (elapsed >= timeout_sec) {
            return false;
        }
        
        auto [weight, stable] = get_weight_();
        
        if (stable && std::abs(weight - last_weight) < 0.5f) {
            stable_count++;
            if (stable_count >= 5) {
                return true;
            }
        } else {
            stable_count = 0;
        }
        
        last_weight = weight;
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    
    return false;
}

} // namespace workflows
