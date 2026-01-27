#include "workflows/executors/acquire_executor.hpp"
#include <spdlog/spdlog.h>
#include <chrono>
#include <thread>

namespace workflows {

PreconditionResult AcquireExecutor::check_preconditions(
    const enose::experiment::Step& step) const
{
    std::vector<std::string> failures;
    
    if (!step.has_acquire()) {
        failures.push_back("Step does not contain acquire action");
        return PreconditionResult::fail(std::move(failures));
    }
    
    const auto& action = step.acquire();
    
    // 检查气泵PWM范围
    if (action.gas_pump_pwm() < 0 || action.gas_pump_pwm() > 100) {
        failures.push_back("Gas pump PWM must be between 0 and 100");
    }
    
    // 检查系统状态
    if (system_state_) {
        auto current_state = system_state_->get_state();
        if (current_state != SystemState::State::INITIAL) {
            failures.push_back("System must be in INITIAL state before acquire");
        }
    }
    
    // 检查硬件状态机 (如果有)
    if (hardware_state_) {
        if (!hardware_state_->can_transition_to(HardwareState::SAMPLE_ACQUIRING)) {
            failures.push_back("Cannot transition to ACQUIRE state");
        }
    }
    
    if (failures.empty()) {
        return PreconditionResult::ok();
    }
    return PreconditionResult::fail(std::move(failures));
}

ExecuteResult AcquireExecutor::execute(const enose::experiment::Step& step) {
    auto start_time = std::chrono::steady_clock::now();
    
    // 前置条件检查
    auto precond = check_preconditions(step);
    if (!precond) {
        std::string errors;
        for (const auto& e : precond.failed_conditions) {
            errors += e + "; ";
        }
        return ExecuteResult::fail("Precondition failed: " + errors);
    }
    
    const auto& action = step.acquire();
    add_log("采集: 气泵PWM=" + std::to_string(action.gas_pump_pwm()) + "%");
    
    // 创建事务守卫
    auto guard = create_guard(SystemState::State::SAMPLE, "acquire");
    
    // TODO: 设置气泵PWM到指定值
    
    // 根据终止条件等待
    switch (action.termination_case()) {
        case enose::experiment::AcquireAction::kDurationS: {
            add_log("采集模式: 固定时间 " + std::to_string(action.duration_s()) + "s");
            wait_for_duration(action.duration_s());
            break;
        }
        
        case enose::experiment::AcquireAction::kHeaterCycles: {
            add_log("采集模式: 加热周期 x" + std::to_string(action.heater_cycles()));
            wait_for_heater_cycles(action.heater_cycles(), action.max_duration_s());
            break;
        }
        
        case enose::experiment::AcquireAction::kStability: {
            add_log("采集模式: 稳定性检测");
            wait_for_stability(
                action.stability().window_s(),
                action.stability().threshold_percent(),
                action.max_duration_s()
            );
            break;
        }
        
        default: {
            add_log("采集模式: 默认最大时间 " + std::to_string(action.max_duration_s()) + "s");
            wait_for_duration(action.max_duration_s());
            break;
        }
    }
    
    add_log("采集完成");
    
    // 提交事务
    guard.commit_and_restore();
    
    auto total_duration = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - start_time).count();
    
    return ExecuteResult::ok("", total_duration);
}

void AcquireExecutor::wait_for_duration(double seconds) {
    auto end = std::chrono::steady_clock::now() + 
               std::chrono::milliseconds(static_cast<int>(seconds * 1000));
    while (std::chrono::steady_clock::now() < end) {
        if (check_stop_or_pause()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

void AcquireExecutor::wait_for_heater_cycles(int count, double timeout_s) {
    if (!sensor_) {
        add_log("警告: 无传感器驱动，使用估算时间");
        double estimated_cycle_time = 26.0;
        double total_time = count * estimated_cycle_time;
        wait_for_duration(std::min(total_time, timeout_s));
        return;
    }
    
    add_log("等待 " + std::to_string(count) + " 个加热周期完成");
    
    int completed_cycles = 0;
    int last_heater_step = -1;
    bool seen_first_cycle = false;
    
    auto start = std::chrono::steady_clock::now();
    auto timeout = std::chrono::seconds(static_cast<int>(timeout_s));
    
    std::mutex cycle_mutex;
    std::condition_variable cycle_cv;
    
    auto conn = sensor_->on_packet.connect([&](const nlohmann::json& packet) {
        if (!packet.contains("type") || packet["type"] != "reading") return;
        if (!packet.contains("heater_step")) return;
        
        int current_step = packet["heater_step"].get<int>();
        
        std::lock_guard<std::mutex> lock(cycle_mutex);
        
        if (last_heater_step > 0 && current_step == 0 && seen_first_cycle) {
            completed_cycles++;
            add_log("完成加热周期 " + std::to_string(completed_cycles) + "/" + std::to_string(count));
            cycle_cv.notify_all();
        }
        
        if (last_heater_step > current_step && !seen_first_cycle) {
            seen_first_cycle = true;
        }
        
        last_heater_step = current_step;
    });
    
    {
        std::unique_lock<std::mutex> lock(cycle_mutex);
        while (completed_cycles < count) {
            if (check_stop_or_pause()) {
                conn.disconnect();
                return;
            }
            
            if (std::chrono::steady_clock::now() - start > timeout) {
                add_log("等待加热周期超时");
                conn.disconnect();
                return;
            }
            
            cycle_cv.wait_for(lock, std::chrono::milliseconds(100));
        }
    }
    
    conn.disconnect();
    add_log("加热周期等待完成");
}

void AcquireExecutor::wait_for_stability(double window_s, double threshold_percent, double timeout_s) {
    if (!sensor_) {
        add_log("警告: 无传感器驱动，使用最大时间");
        wait_for_duration(timeout_s);
        return;
    }
    
    add_log("等待传感器稳定 (窗口=" + std::to_string(window_s) + 
            "s, 阈值=" + std::to_string(threshold_percent) + "%)");
    
    // TODO: 实现稳定性检测逻辑
    // 暂时使用超时等待
    wait_for_duration(timeout_s);
}

double AcquireExecutor::estimate_duration(const enose::experiment::Step& step) const {
    if (!step.has_acquire()) return 0;
    
    const auto& action = step.acquire();
    
    switch (action.termination_case()) {
        case enose::experiment::AcquireAction::kDurationS:
            return action.duration_s();
        case enose::experiment::AcquireAction::kHeaterCycles:
            return action.heater_cycles() * 26.0;  // 估算每周期26秒
        default:
            return action.max_duration_s();
    }
}

} // namespace workflows
