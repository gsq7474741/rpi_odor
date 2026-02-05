#include "experiment_service_impl.hpp"
#include "../workflows/yaml_parser.hpp"
#include "../workflows/transaction_guard.hpp"
#include "../workflows/executors/executors.hpp"
#include <spdlog/spdlog.h>
#include <google/protobuf/util/time_util.h>
#include <openssl/sha.h>
#include <iomanip>
#include <sstream>

namespace grpc_service {

namespace experiment = ::enose::experiment;

ExperimentServiceImpl::ExperimentServiceImpl(
    std::shared_ptr<workflows::SystemState> system_state,
    std::shared_ptr<hal::LoadCellDriver> load_cell,
    std::shared_ptr<hal::SensorDriver> sensor_driver,
    std::shared_ptr<db::ConsumableRepository> consumable_repo)
    : system_state_(std::move(system_state))
    , load_cell_(std::move(load_cell))
    , sensor_driver_(std::move(sensor_driver))
    , consumable_repo_(std::move(consumable_repo)) {
    
    // Phase 3: 初始化 Action Executors
    init_executors();
    
    spdlog::info("ExperimentService 初始化完成");
}

ExperimentServiceImpl::~ExperimentServiceImpl() {
    // 停止执行线程
    stop_requested_ = true;
    pause_cv_.notify_all();
    event_cv_.notify_all();
    
    if (execution_thread_ && execution_thread_->joinable()) {
        execution_thread_->join();
    }
}

::grpc::Status ExperimentServiceImpl::ValidateProgram(
    ::grpc::ServerContext* context,
    const experiment::ValidateProgramRequest* request,
    experiment::ValidationResult* response) {
    
    try {
        spdlog::info("收到验证请求: {}", request->program().id());
        
        auto result = validator_.validate(request->program());
        *response = enose::workflows::ExperimentValidator::to_proto(result);
        
        return ::grpc::Status::OK;
    } catch (const std::exception& e) {
        spdlog::error("验证程序时发生异常: {}", e.what());
        response->set_valid(false);
        auto* err = response->add_errors();
        err->set_path("");
        err->set_code("INTERNAL_ERROR");
        err->set_message(std::string("验证异常: ") + e.what());
        return ::grpc::Status::OK;
    } catch (...) {
        spdlog::error("验证程序时发生未知异常");
        response->set_valid(false);
        auto* err = response->add_errors();
        err->set_path("");
        err->set_code("INTERNAL_ERROR");
        err->set_message("验证时发生未知异常");
        return ::grpc::Status::OK;
    }
}

::grpc::Status ExperimentServiceImpl::LoadProgram(
    ::grpc::ServerContext* context,
    const experiment::LoadProgramRequest* request,
    experiment::LoadProgramResponse* response) {
    
    try {
        std::lock_guard<std::mutex> lock(mutex_);
        
        // 检查当前状态
        if (state_ == experiment::EXP_RUNNING || state_ == experiment::EXP_PAUSED) {
            response->set_success(false);
            response->set_error_message("实验正在运行中，无法加载新程序");
            return ::grpc::Status::OK;
        }
        
        // 获取程序 (支持 YAML 字符串或结构化程序)
        experiment::ExperimentProgram program;
        
        std::string yaml_content;
        if (request->has_yaml_content()) {
            spdlog::info("从 YAML 加载实验程序");
            yaml_content = request->yaml_content();
            auto parse_result = enose::workflows::YamlParser::parse(yaml_content);
            if (!parse_result.success) {
                response->set_success(false);
                response->set_error_message("YAML 解析失败: " + parse_result.error_message);
                return ::grpc::Status::OK;
            }
            program = std::move(parse_result.program);
        } else if (request->has_program()) {
            program = request->program();
            // 结构化程序转换为 YAML 字符串用于 hash 计算
            yaml_content = program.SerializeAsString();  // 使用序列化作为 hash 输入
        } else {
            response->set_success(false);
            response->set_error_message("请求中没有程序数据");
            return ::grpc::Status::OK;
        }
        
        spdlog::info("加载实验程序: {}", program.id());
        
        // 验证程序
        validation_result_ = validator_.validate(program);
        *response->mutable_validation() = enose::workflows::ExperimentValidator::to_proto(validation_result_);
        
        if (!validation_result_.valid) {
            response->set_success(false);
            response->set_error_message("程序验证失败");
            state_ = experiment::EXP_IDLE;
            return ::grpc::Status::OK;
        }
        
        // 保存程序和 YAML 内容
        loaded_program_ = std::make_unique<experiment::ExperimentProgram>(std::move(program));
        loaded_program_yaml_ = std::move(yaml_content);
        
        // 计算 SHA256 hash
        unsigned char hash[SHA256_DIGEST_LENGTH];
        SHA256(reinterpret_cast<const unsigned char*>(loaded_program_yaml_.c_str()),
               loaded_program_yaml_.size(), hash);
        
        // 转换为 32 字符的十六进制字符串
        std::stringstream ss;
        for (int i = 0; i < 16; i++) {
            ss << std::hex << std::setw(2) << std::setfill('0') << (int)hash[i];
        }
        loaded_program_yaml_hash_ = ss.str();
        
        state_ = experiment::EXP_LOADED;
        response->set_success(true);
        
        spdlog::info("程序 hash: {}", loaded_program_yaml_hash_);
        
        emit_event(experiment::ExperimentEvent::PROGRAM_LOADED, 
                   "程序已加载: " + loaded_program_->name());
        
        spdlog::info("程序加载成功: {}", loaded_program_->id());
        return ::grpc::Status::OK;
    } catch (const std::exception& e) {
        spdlog::error("加载程序时发生异常: {}", e.what());
        response->set_success(false);
        response->set_error_message(std::string("加载异常: ") + e.what());
        return ::grpc::Status::OK;
    } catch (...) {
        spdlog::error("加载程序时发生未知异常");
        response->set_success(false);
        response->set_error_message("加载时发生未知异常");
        return ::grpc::Status::OK;
    }
}

::grpc::Status ExperimentServiceImpl::StartExperiment(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    experiment::ExperimentStatusResponse* response) {
    
    std::unique_lock<std::mutex> lock(mutex_);
    
    if (state_ != experiment::EXP_LOADED) {
        fill_status_response(response);
        return ::grpc::Status(::grpc::StatusCode::FAILED_PRECONDITION, 
                             "需要先加载程序才能启动");
    }
    
    spdlog::info("启动实验: {}", loaded_program_->id());
    
    // 确保之前的执行线程已结束
    if (execution_thread_ && execution_thread_->joinable()) {
        spdlog::warn("等待之前的执行线程结束...");
        // 先释放锁再等待，避免死锁
        lock.unlock();
        execution_thread_->join();
        lock.lock();
        spdlog::info("之前的执行线程已结束");
    }
    execution_thread_.reset();
    
    // 重置状态
    stop_requested_ = false;
    pause_requested_ = false;
    current_step_index_ = 0;
    current_step_name_.clear();
    loop_iteration_ = 0;
    loop_total_ = 0;
    logs_.clear();
    error_message_.clear();
    start_time_ = std::chrono::steady_clock::now();
    
    // 创建实验运行记录（用于断点续作）
    if (experiment_repo_) {
        auto run_id = experiment_repo_->create_run(
            loaded_program_->id(),
            loaded_program_->name(),
            loaded_program_yaml_,       // program_yaml
            loaded_program_yaml_hash_,  // program_yaml_hash
            "{}",                        // config_json
            loaded_program_->steps_size());
        if (run_id) {
            current_run_id_ = static_cast<int32_t>(*run_id);
            spdlog::info("创建实验运行记录: run_id={}, hash={}", *run_id, loaded_program_yaml_hash_);
        }
    }
    
    // 启动执行线程
    state_ = experiment::EXP_RUNNING;
    execution_thread_ = std::make_unique<std::thread>(
        &ExperimentServiceImpl::execution_thread_func, this);
    
    emit_event(experiment::ExperimentEvent::EXPERIMENT_STARTED, "实验已启动");
    
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::StopExperiment(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    experiment::ExperimentStatusResponse* response) {
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    // 如果是已加载状态或终态（已完成/错误/已中止），卸载程序
    if (state_ == experiment::EXP_LOADED ||
        state_ == experiment::EXP_COMPLETED ||
        state_ == experiment::EXP_ERROR ||
        state_ == experiment::EXP_ABORTED) {
        spdlog::info("卸载程序 (当前状态: {})", static_cast<int>(state_));
        loaded_program_.reset();
        state_ = experiment::EXP_IDLE;
        // 重置执行状态
        current_step_index_ = 0;
        current_step_name_.clear();
        loop_iteration_ = 0;
        loop_total_ = 0;
        error_message_.clear();
        // 注意: 不能在持有 mutex_ 的情况下调用 add_log (会死锁)
        // 直接添加日志
        auto now = std::chrono::system_clock::now();
        auto time_t = std::chrono::system_clock::to_time_t(now);
        char buf[64];
        std::strftime(buf, sizeof(buf), "%H:%M:%S", std::localtime(&time_t));
        logs_.push_back(std::string(buf) + " 程序已卸载");
        if (logs_.size() > 100) logs_.erase(logs_.begin());
        
        fill_status_response(response);
        return ::grpc::Status::OK;
    }
    
    // 如果是空闲状态，直接返回
    if (state_ == experiment::EXP_IDLE) {
        fill_status_response(response);
        return ::grpc::Status::OK;
    }
    
    // 如果是运行中/暂停状态，请求停止
    if (state_ == experiment::EXP_RUNNING || state_ == experiment::EXP_PAUSED) {
        spdlog::info("停止实验");
        stop_requested_ = true;
        pause_cv_.notify_all();
        state_ = experiment::EXP_ABORTING;
        emit_event(experiment::ExperimentEvent::EXPERIMENT_STOPPED, "实验已停止");
    }
    
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::PauseExperiment(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    experiment::ExperimentStatusResponse* response) {
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (state_ != experiment::EXP_RUNNING) {
        fill_status_response(response);
        return ::grpc::Status::OK;
    }
    
    spdlog::info("暂停实验");
    
    pause_requested_ = true;
    state_ = experiment::EXP_PAUSED;
    
    emit_event(experiment::ExperimentEvent::EXPERIMENT_PAUSED, "实验已暂停");
    
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::ResumeExperiment(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    experiment::ExperimentStatusResponse* response) {
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (state_ != experiment::EXP_PAUSED) {
        fill_status_response(response);
        return ::grpc::Status::OK;
    }
    
    spdlog::info("恢复实验");
    
    pause_requested_ = false;
    state_ = experiment::EXP_RUNNING;
    pause_cv_.notify_all();
    
    emit_event(experiment::ExperimentEvent::EXPERIMENT_RESUMED, "实验已恢复");
    
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::GetExperimentStatus(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    experiment::ExperimentStatusResponse* response) {
    
    std::lock_guard<std::mutex> lock(mutex_);
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::SubscribeExperimentEvents(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    ::grpc::ServerWriter<experiment::ExperimentEvent>* writer) {
    
    spdlog::info("新的事件订阅者");
    subscriber_count_++;
    
    while (!context->IsCancelled()) {
        experiment::ExperimentEvent event;
        {
            std::unique_lock<std::mutex> lock(event_mutex_);
            event_cv_.wait_for(lock, std::chrono::seconds(1), [this] {
                return !event_queue_.empty() || stop_requested_;
            });
            
            if (stop_requested_ && event_queue_.empty()) {
                break;
            }
            
            if (event_queue_.empty()) {
                continue;
            }
            
            event = std::move(event_queue_.front());
            event_queue_.pop();
        }
        
        if (!writer->Write(event)) {
            break;
        }
    }
    
    subscriber_count_--;
    spdlog::info("事件订阅者断开");
    return ::grpc::Status::OK;
}

void ExperimentServiceImpl::execution_thread_func() {
    spdlog::info("实验执行线程启动");
    
    // 初始化样本上下文
    current_sample_ctx_ = db::SampleContext{};
    
    // 设置传感器数据的运行上下文（关联 run_id）
    if (sensor_repo_ && current_run_id_) {
        sensor_repo_->set_run_context(*current_run_id_, "");
        spdlog::info("传感器数据关联到 run_id={}", *current_run_id_);
    }
    
    try {
        execute_steps(loaded_program_->steps());
        
        // 检查是否被中止
        // 注意: 不能在持有 mutex_ 的情况下调用 add_log (会死锁)
        bool was_stopped = false;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            was_stopped = stop_requested_;
            if (was_stopped) {
                state_ = experiment::EXP_ABORTED;
            } else {
                state_ = experiment::EXP_COMPLETED;
            }
        }
        // 在 mutex_ 释放后调用 add_log 和 emit_event
        if (was_stopped) {
            add_log("实验已中止");
            // 更新数据库状态
            if (experiment_repo_ && current_run_id_) {
                experiment_repo_->abort_run(*current_run_id_);
            }
        } else {
            add_log("实验完成");
            emit_event(experiment::ExperimentEvent::EXPERIMENT_COMPLETED, "实验已完成");
            // 更新数据库状态
            if (experiment_repo_ && current_run_id_) {
                experiment_repo_->complete_run(*current_run_id_);
            }
        }
    } catch (const std::exception& e) {
        std::string err_msg = e.what();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            state_ = experiment::EXP_ERROR;
            error_message_ = err_msg;
        }
        // 在 mutex_ 释放后调用
        add_log("实验错误: " + err_msg);
        emit_event(experiment::ExperimentEvent::EXPERIMENT_ERROR, err_msg);
        spdlog::error("实验执行错误: {}", err_msg);
        // 更新数据库状态
        if (experiment_repo_ && current_run_id_) {
            experiment_repo_->fail_run(*current_run_id_, err_msg);
        }
    }
    
    // 清除传感器数据的运行上下文
    if (sensor_repo_) {
        sensor_repo_->clear_run_context();
        spdlog::info("传感器数据运行上下文已清除");
    }
    
    // 恢复系统状态
    system_state_->transition_to(workflows::SystemState::State::INITIAL);
    
    spdlog::info("实验执行线程结束");
}

void ExperimentServiceImpl::execute_steps(
    const google::protobuf::RepeatedPtrField<experiment::Step>& steps) {
    
    for (int i = 0; i < steps.size(); ++i) {
        if (check_stop_or_pause()) return;
        
        {
            std::lock_guard<std::mutex> lock(mutex_);
            current_step_index_ = i;
            current_step_name_ = steps[i].name();
        }
        
        execute_step(steps[i]);
        
        // 更新数据库进度（断点续作）
        if (experiment_repo_ && current_run_id_) {
            auto elapsed = std::chrono::steady_clock::now() - start_time_;
            double elapsed_s = std::chrono::duration<double>(elapsed).count();
            experiment_repo_->update_progress(
                *current_run_id_, i, steps[i].name(), elapsed_s);
        }
    }
}

void ExperimentServiceImpl::execute_step(const experiment::Step& step) {
    add_log("执行步骤: " + step.name());
    emit_event(experiment::ExperimentEvent::STEP_STARTED, step.name());
    
    switch (step.action_case()) {
        case experiment::Step::kInject:
            execute_inject(step.inject());
            break;
        case experiment::Step::kWait:
            execute_wait(step.wait());
            break;
        case experiment::Step::kDrain:
            execute_drain(step.drain());
            break;
        case experiment::Step::kAcquire:
            execute_acquire(step.acquire());
            break;
        case experiment::Step::kSetState:
            execute_set_state(step.set_state());
            break;
        case experiment::Step::kSetGasPump:
            execute_set_gas_pump(step.set_gas_pump());
            break;
        case experiment::Step::kLoop:
            execute_loop(step.loop());
            break;
        case experiment::Step::kPhaseMarker:
            execute_phase_marker(step.phase_marker());
            break;
        case experiment::Step::kWash:
            execute_wash(step.wash());
            break;
        case experiment::Step::kConfigureHeater:
            execute_configure_heater(step.configure_heater());
            break;
        case experiment::Step::kPreheat:
            execute_preheat(step.preheat());
            break;
        default:
            spdlog::warn("未知的步骤动作类型");
            break;
    }
    
    emit_event(experiment::ExperimentEvent::STEP_COMPLETED, step.name());
}

void ExperimentServiceImpl::execute_inject(const experiment::InjectAction& action) {
    add_log("进样: 目标量=" + std::to_string(action.target_volume_ml()) + "ml");
    
    // 使用事务守卫保证状态一致性 (Phase 1.3)
    workflows::StateTransactionGuard guard(
        system_state_.get(),
        workflows::SystemState::State::INJECT,
        "inject"
    );
    
    // 计算每个泵的进样量 (单位: ml, Klipper 已配置 1mm=1ml)
    double total_volume = action.target_volume_ml();
    workflows::SystemState::InjectionParams params;
    params.speed = action.flow_rate_ml_min() / 60.0;  // ml/min -> ml/s
    params.accel = params.speed * 2;  // 默认加速度
    
    // 更新样本上下文 - 液体参数
    current_sample_ctx_.liquids.clear();
    current_sample_ctx_.total_volume_ml = total_volume;
    current_sample_ctx_.flow_rate_ml_s = params.speed;
    
    // 根据液体配方设置各泵进样量
    // 注意: 泵绑定从数据库 pump_assignments 表查询，不再使用 YAML 中的 pump_index
    for (const auto& comp : action.components()) {
        double volume_ml = total_volume * comp.ratio();
        
        // 从数据库查询液体绑定的泵
        int liquid_id = 0;
        try {
            liquid_id = std::stoi(comp.liquid_id());
        } catch (...) {
            add_log("警告: 无法解析液体ID: " + comp.liquid_id());
            continue;
        }
        
        // 查询绑定到该液体的所有泵
        std::vector<db::PumpAssignmentRecord> pumps;
        if (consumable_repo_) {
            pumps = consumable_repo_->get_pumps_by_liquid_id(liquid_id);
        }
        
        if (pumps.empty()) {
            add_log("错误: 液体 " + comp.liquid_id() + " 未绑定到任何泵，请在耗材管理中配置");
            continue;
        }
        
        // 选择余量最多的泵
        auto best_pump = std::max_element(pumps.begin(), pumps.end(),
            [](const db::PumpAssignmentRecord& a, const db::PumpAssignmentRecord& b) {
                return a.remaining_volume_ml() < b.remaining_volume_ml();
            });
        
        int pump_index = best_pump->pump_index;
        double remaining = best_pump->remaining_volume_ml();
        
        // 检查余量是否足够
        if (remaining < volume_ml) {
            add_log("警告: 泵 " + std::to_string(pump_index) + " 余量不足 (" + 
                    std::to_string(remaining) + "ml < " + std::to_string(volume_ml) + "ml)");
        }
        
        // 获取液体名称（从 YAML 或数据库）
        std::string liquid_name = comp.liquid_id();
        for (const auto& liquid : loaded_program_->hardware().liquids()) {
            if (liquid.id() == comp.liquid_id()) {
                liquid_name = liquid.name();
                break;
            }
        }
        
        add_log("液体 " + liquid_name + " -> 泵 " + std::to_string(pump_index) + 
                " (" + std::to_string(volume_ml) + "ml)");
        
        // 记录到样本上下文
        db::LiquidInfo liq_info;
        liq_info.id = comp.liquid_id();
        liq_info.name = liquid_name;
        liq_info.ratio = comp.ratio();
        liq_info.pump_index = pump_index;
        current_sample_ctx_.liquids.push_back(liq_info);
        
        // 设置泵进样量
        switch (pump_index) {
            case 0: params.pump_0_volume = volume_ml; break;
            case 1: params.pump_1_volume = volume_ml; break;
            case 2: params.pump_2_volume = volume_ml; break;
            case 3: params.pump_3_volume = volume_ml; break;
            case 4: params.pump_4_volume = volume_ml; break;
            case 5: params.pump_5_volume = volume_ml; break;
            case 6: params.pump_6_volume = volume_ml; break;
            case 7: params.pump_7_volume = volume_ml; break;
        }
    }
    
    // 启动进样
    system_state_->start_inject(params);
    
    // 开环控制: 根据体积和流速计算等待时间
    // 步进电机精确控制体积，无需称重反馈
    double flow_rate_ml_s = action.flow_rate_ml_min() / 60.0;  // ml/min -> ml/s
    
    // 计算最大泵体积（多泵并行时取最大值）
    double max_pump_volume = std::max({
        params.pump_0_volume, params.pump_1_volume,
        params.pump_2_volume, params.pump_3_volume,
        params.pump_4_volume, params.pump_5_volume,
        params.pump_6_volume, params.pump_7_volume
    });
    
    // 等待时间 = 最大体积 / 速度 + 2秒余量
    int wait_ms = static_cast<int>(max_pump_volume / params.speed * 1000) + 2000;
    add_log("等待进样完成 (" + std::to_string(wait_ms / 1000.0) + "s)...");
    
    // 分段等待，以便可以响应停止请求
    int waited = 0;
    while (waited < wait_ms && !check_stop_or_pause()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        waited += 100;
    }
    
    if (!check_stop_or_pause()) {
        add_log("进样完成: " + std::to_string(total_volume) + "ml");
    }
    
    // 泵运行时间由 RuntimeTracker 在 SystemState 层自动统计
    // 这里只记录液体消耗量 (用于泵容量余量跟踪) - 单位已经是 ml
    if (consumable_repo_) {
        if (params.pump_0_volume > 0) consumable_repo_->add_pump_consumption(0, params.pump_0_volume);
        if (params.pump_1_volume > 0) consumable_repo_->add_pump_consumption(1, params.pump_1_volume);
        if (params.pump_2_volume > 0) consumable_repo_->add_pump_consumption(2, params.pump_2_volume);
        if (params.pump_3_volume > 0) consumable_repo_->add_pump_consumption(3, params.pump_3_volume);
        if (params.pump_4_volume > 0) consumable_repo_->add_pump_consumption(4, params.pump_4_volume);
        if (params.pump_5_volume > 0) consumable_repo_->add_pump_consumption(5, params.pump_5_volume);
        if (params.pump_6_volume > 0) consumable_repo_->add_pump_consumption(6, params.pump_6_volume);
        if (params.pump_7_volume > 0) consumable_repo_->add_pump_consumption(7, params.pump_7_volume);
    }
    
    // 提交事务并恢复到初始状态 (Phase 1.3)
    guard.commit_and_restore();
}

void ExperimentServiceImpl::execute_wait(const experiment::WaitAction& action) {
    switch (action.condition_case()) {
        case experiment::WaitAction::kDurationS: {
            add_log("等待: " + std::to_string(action.duration_s()) + "秒");
            auto end = std::chrono::steady_clock::now() + 
                      std::chrono::milliseconds(static_cast<int>(action.duration_s() * 1000));
            while (std::chrono::steady_clock::now() < end) {
                if (check_stop_or_pause()) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            break;
        }
        
        case experiment::WaitAction::kHeaterCycles: {
            add_log("等待加热器循环: " + std::to_string(action.heater_cycles()) + "次");
            // TODO: 实现加热器循环等待
            int cycles = action.heater_cycles();
            int cycle_time_ms = 2500;  // 假设每个循环2.5秒
            auto end = std::chrono::steady_clock::now() + 
                      std::chrono::milliseconds(cycles * cycle_time_ms);
            while (std::chrono::steady_clock::now() < end) {
                if (check_stop_or_pause()) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            break;
        }
        
        case experiment::WaitAction::kEmpty: {
            add_log("等待空瓶");
            auto result = load_cell_->wait_for_empty_bottle(
                action.empty().tolerance_g(),
                action.timeout_s(),
                action.empty().stability_window_s(),
                [this]() { return check_stop_or_pause(); }
            );
            if (result.stopped) {
                add_log("空瓶检测被中断");
            } else if (result.success) {
                add_log("空瓶检测完成: " + std::to_string(result.empty_weight) + "g");
            } else {
                add_log("空瓶检测超时");
            }
            break;
        }
        
        default:
            add_log("等待: 未知条件类型");
            break;
    }
}

void ExperimentServiceImpl::execute_drain(const experiment::DrainAction& action) {
    add_log("排废: 气泵PWM=" + std::to_string(action.gas_pump_pwm()) + "%, " +
            "稳定窗口=" + std::to_string(action.stability_window_s()) + "s");
    
    // 使用事务守卫保证状态一致性 (Phase 1.3)
    workflows::StateTransactionGuard guard(
        system_state_.get(),
        workflows::SystemState::State::DRAIN,
        "drain"
    );
    
    // 设置气泵PWM（排废时需要气流辅助）
    if (action.gas_pump_pwm() > 0) {
        float pwm = action.gas_pump_pwm() / 100.0f;
        system_state_->set_air_pump_pwm(pwm);
    }
    
    // 等待空瓶稳定（重量不再下降 + 稳定窗口）
    // wait_for_empty_bottle 已实现:
    // 1. 检测重量是否稳定（连续3次读数变化<1g）
    // 2. 稳定后等待 stability_window_s，期间重量变化<0.5g
    auto result = load_cell_->wait_for_empty_bottle(
        action.empty_tolerance_g(),
        action.timeout_s(),
        action.stability_window_s(),
        [this]() { return check_stop_or_pause(); }
    );
    
    if (result.stopped) {
        add_log("排废被中断");
    } else if (result.success) {
        add_log("排废完成: " + std::to_string(result.empty_weight) + "g");
    } else {
        add_log("排废超时");
    }
    
    // 提交事务并恢复到初始状态 (Phase 1.3)
    guard.commit_and_restore();
}

void ExperimentServiceImpl::execute_acquire(const experiment::AcquireAction& action) {
    add_log("采集: 气泵PWM=" + std::to_string(action.gas_pump_pwm()) + "%");
    
    // 使用事务守卫保证状态一致性 (Phase 1.3)
    workflows::StateTransactionGuard guard(
        system_state_.get(),
        workflows::SystemState::State::SAMPLE,
        "acquire"
    );
    
    // 更新样本上下文 - 采集参数
    current_sample_ctx_.gas_pump_pwm = action.gas_pump_pwm();
    current_sample_ctx_.max_duration_s = action.max_duration_s();
    
    // 解析终止条件
    switch (action.termination_case()) {
        case experiment::AcquireAction::kDurationS:
            current_sample_ctx_.termination_type = "duration";
            current_sample_ctx_.termination_value = action.duration_s();
            break;
        case experiment::AcquireAction::kHeaterCycles:
            current_sample_ctx_.termination_type = "cycles";
            current_sample_ctx_.termination_value = action.heater_cycles();
            break;
        case experiment::AcquireAction::kStability:
            current_sample_ctx_.termination_type = "stability";
            current_sample_ctx_.termination_value = action.stability().threshold_percent();
            break;
        default:
            current_sample_ctx_.termination_type = "duration";
            current_sample_ctx_.termination_value = action.max_duration_s();
            break;
    }
    
    // 计算参数哈希并创建样本记录
    current_sample_ctx_.params_hash = current_sample_ctx_.compute_hash();
    current_sample_ctx_.start_time_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    
    if (sample_repo_ && current_run_id_) {
        auto sample_id = sample_repo_->create_sample(
            *current_run_id_,
            current_sample_ctx_.sample_idx,
            current_sample_ctx_
        );
        if (sample_id) {
            current_sample_ctx_.sample_id = *sample_id;
            current_sample_ctx_.sample_idx++;
            add_log("创建样本记录: id=" + std::to_string(*sample_id));
            
            // 设置传感器上下文 - 使后续的 sensor_readings 关联到此 sample_id
            if (sensor_repo_) {
                sensor_repo_->set_sample_context(*sample_id);
                spdlog::debug("传感器数据关联到 sample_id={}", *sample_id);
            }
        }
    }
    
    // TODO: 设置气泵PWM到指定值
    
    // 根据终止条件等待
    switch (action.termination_case()) {
        case experiment::AcquireAction::kDurationS: {
            // 1. 固定时间等待
            add_log("采集模式: 固定时间 " + std::to_string(action.duration_s()) + "s");
            auto end = std::chrono::steady_clock::now() + 
                      std::chrono::milliseconds(static_cast<int>(action.duration_s() * 1000));
            while (std::chrono::steady_clock::now() < end) {
                if (check_stop_or_pause()) return;  // guard 析构时会自动回滚
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            break;
        }
        
        case experiment::AcquireAction::kHeaterCycles: {
            // 2. 等待完整的加热配置周期 (通过传感器上报的 heater_step 判断)
            add_log("采集模式: 加热周期 x" + std::to_string(action.heater_cycles()));
            wait_for_heater_cycles(action.heater_cycles(), action.max_duration_s());
            break;
        }
        
        case experiment::AcquireAction::kStability: {
            // 3. 稳定性条件 - 监测传感器读数变化
            add_log("采集模式: 稳定性检测");
            wait_for_sensor_stability(
                action.stability().window_s(),
                action.stability().threshold_percent(),
                action.max_duration_s()
            );
            break;
        }
        
        default: {
            // 默认: 使用最大时间
            add_log("采集模式: 默认最大时间 " + std::to_string(action.max_duration_s()) + "s");
            auto end = std::chrono::steady_clock::now() + 
                      std::chrono::milliseconds(static_cast<int>(action.max_duration_s() * 1000));
            while (std::chrono::steady_clock::now() < end) {
                if (check_stop_or_pause()) return;  // guard 析构时会自动回滚
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            break;
        }
    }
    
    // 采集结束，完成样本记录
    if (sample_repo_ && current_sample_ctx_.sample_id >= 0) {
        int64_t end_time_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        
        // 获取环境参数平均值
        auto env_stats = sample_repo_->get_environment_stats(
            current_sample_ctx_.start_time_ms, end_time_ms);
        current_sample_ctx_.avg_temperature_c = env_stats.avg_temp;
        current_sample_ctx_.avg_humidity_pct = env_stats.avg_humidity;
        current_sample_ctx_.avg_pressure_hpa = env_stats.avg_pressure;
        
        sample_repo_->complete_sample(
            current_sample_ctx_.sample_id, end_time_ms, current_sample_ctx_);
        add_log("完成样本记录: id=" + std::to_string(current_sample_ctx_.sample_id));
        
        // 清除传感器上下文
        if (sensor_repo_) {
            sensor_repo_->clear_sample_context();
        }
    }
    
    // 重置清洗计数
    current_sample_ctx_.reset_wash_count();
    
    add_log("采集完成");
    
    // 提交事务并恢复到初始状态 (Phase 1.3)
    guard.commit_and_restore();
}

void ExperimentServiceImpl::execute_set_state(const experiment::SetStateAction& action) {
    add_log("设置系统状态: " + std::to_string(static_cast<int>(action.state())));
    system_state_->transition_to(convert_state(action.state()));
}

void ExperimentServiceImpl::execute_set_gas_pump(const experiment::SetGasPumpAction& action) {
    add_log("设置气泵PWM: " + std::to_string(action.pwm_percent()) + "%");
    
    // 气泵运行时间由 RuntimeTracker 在 SystemState 层自动统计
    float pwm = action.pwm_percent() / 100.0f;
    system_state_->set_air_pump_pwm(pwm);
}

void ExperimentServiceImpl::execute_loop(const experiment::LoopAction& action) {
    int count = action.count();
    add_log("循环开始: " + std::to_string(count) + "次");
    
    {
        std::lock_guard<std::mutex> lock(mutex_);
        loop_total_ = count;
    }
    
    for (int i = 0; i < count; ++i) {
        if (check_stop_or_pause()) return;
        
        {
            std::lock_guard<std::mutex> lock(mutex_);
            loop_iteration_ = i + 1;
        }
        
        add_log("循环迭代: " + std::to_string(i + 1) + "/" + std::to_string(count));
        emit_event(experiment::ExperimentEvent::LOOP_ITERATION, 
                  "迭代 " + std::to_string(i + 1));
        
        execute_steps(action.steps());
    }
    
    {
        std::lock_guard<std::mutex> lock(mutex_);
        loop_iteration_ = 0;
        loop_total_ = 0;
    }
    
    add_log("循环结束");
}

void ExperimentServiceImpl::execute_phase_marker(const experiment::PhaseMarkerAction& action) {
    int64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    
    if (action.is_start()) {
        add_log("阶段开始: " + action.phase_name());
        emit_event(experiment::ExperimentEvent::PHASE_STARTED, action.phase_name());
        
        // 更新样本上下文 - 阶段信息
        current_sample_ctx_.phase_name = action.phase_name();
        
        // 更新传感器数据的阶段上下文
        if (sensor_repo_ && current_run_id_) {
            sensor_repo_->set_run_context(*current_run_id_, action.phase_name());
            spdlog::debug("传感器数据阶段更新: {}", action.phase_name());
        }
        
        // 记录 Phase 转换到 sample_phase_transitions 表
        // 只在有活跃 sample 时记录（sample_id >= 0）
        if (sample_repo_ && current_sample_ctx_.sample_id >= 0) {
            // 先完成上一个 phase（如果有）
            int16_t current_order = sample_repo_->get_current_phase_order(current_sample_ctx_.sample_id);
            if (current_order >= 0) {
                sample_repo_->complete_phase_transition(
                    current_sample_ctx_.sample_id, current_order, now_ms);
            }
            
            // 创建新的 phase 转换记录
            int16_t new_order = current_order + 1;
            sample_repo_->create_phase_transition(
                current_sample_ctx_.sample_id,
                action.phase_name(),
                now_ms,
                new_order);
            
            spdlog::debug("Phase 转换记录: sample_id={} phase={} order={}",
                         current_sample_ctx_.sample_id, action.phase_name(), new_order);
        }
    } else {
        add_log("阶段结束: " + action.phase_name());
        emit_event(experiment::ExperimentEvent::PHASE_ENDED, action.phase_name());
        
        // 阶段结束时清除阶段名（但保留 run_id）
        if (sensor_repo_ && current_run_id_) {
            sensor_repo_->set_run_context(*current_run_id_, "");
        }
        
        // 完成当前 Phase 转换记录
        if (sample_repo_ && current_sample_ctx_.sample_id >= 0) {
            int16_t current_order = sample_repo_->get_current_phase_order(current_sample_ctx_.sample_id);
            if (current_order >= 0) {
                sample_repo_->complete_phase_transition(
                    current_sample_ctx_.sample_id, current_order, now_ms);
            }
        }
    }
}

void ExperimentServiceImpl::execute_wash(const experiment::WashAction& action) {
    // target_weight_g 实际存储的是目标注入量 (ml)，需要转换为期望的测量重量变化
    // 由于瓶子斜挂在称重传感器上，测量的重量变化 ≠ 实际注入量
    // 线性校正: expected_weight_change = target_ml * pump_mm_to_ml
    const auto& lc_config = load_cell_->get_config();
    float target_ml = action.target_weight_g();  // YAML 中配置的是 ml
    float expected_weight_change = target_ml * lc_config.pump_mm_to_ml;
    
    add_log("清洗: 目标注入量=" + std::to_string(target_ml) + 
            "ml (期望重量变化=" + std::to_string(expected_weight_change) + 
            "g), 重复" + std::to_string(action.repeat_count()) + "次");
    
    // 更新样本上下文 - 清洗参数
    current_sample_ctx_.pre_wash_count += action.repeat_count();
    current_sample_ctx_.pre_wash_volume_ml = target_ml;
    // TODO: 获取清洗液 ID（从 loaded_program_->hardware().wash_liquid_id()）
    
    // 使用事务守卫保证状态一致性 (Phase 1.3)
    // 注意: wash 是复合操作，内部有多次状态转换，guard 只保证最终恢复到 INITIAL
    workflows::StateTransactionGuard guard(
        system_state_.get(),
        std::nullopt,  // 不自动切换，内部手动管理
        "wash"
    );
    
    for (int i = 0; i < action.repeat_count(); ++i) {
        if (check_stop_or_pause()) return;  // guard 析构时会自动回滚到 INITIAL
        
        add_log("清洗循环 " + std::to_string(i + 1) + "/" + std::to_string(action.repeat_count()));
        
        // 1. 排废确认空瓶稳态 (baseline)
        add_log("排废确认空瓶...");
        system_state_->transition_to(workflows::SystemState::State::DRAIN);
        
        auto empty_result = load_cell_->wait_for_empty_bottle(
            action.empty_tolerance_g(),
            action.drain_timeout_s(),
            action.empty_stability_window_s(),
            [this]() { return check_stop_or_pause(); }
        );
        
        if (empty_result.stopped) {
            add_log("排废被中断");
            return;
        } else if (!empty_result.success) {
            add_log("排废超时，继续清洗");
        }
        
        float baseline_weight = load_cell_->get_filtered_weight();
        add_log("空瓶基线重量: " + std::to_string(baseline_weight) + "g");
        
        if (check_stop_or_pause()) return;
        
        // 2. 切换到 CLEAN 状态 (清洗泵开启)
        add_log("开始注入清洗液...");
        system_state_->transition_to(workflows::SystemState::State::CLEAN);
        
        // 3. 监测重量变化，达到阈值立即切换到排废
        // 使用线性校正后的期望重量变化值进行比较
        auto fill_start = std::chrono::steady_clock::now();
        auto fill_timeout = std::chrono::seconds(static_cast<int>(action.fill_timeout_s()));
        bool target_reached = false;
        
        while (!check_stop_or_pause()) {
            float current_weight = load_cell_->get_filtered_weight();
            float weight_change = current_weight - baseline_weight;
            
            // 使用校正后的期望重量变化值进行比较
            if (weight_change >= expected_weight_change) {
                // 反推实际注入量用于日志
                float actual_ml = weight_change / lc_config.pump_mm_to_ml;
                add_log("达到目标: 重量变化=" + std::to_string(weight_change) + 
                        "g (约" + std::to_string(actual_ml) + "ml)");
                target_reached = true;
                break;
            }
            
            if (std::chrono::steady_clock::now() - fill_start > fill_timeout) {
                float actual_ml = weight_change / lc_config.pump_mm_to_ml;
                add_log("清洗注入超时: 重量变化=" + std::to_string(weight_change) + 
                        "g (约" + std::to_string(actual_ml) + "ml, 目标" + std::to_string(target_ml) + "ml)");
                break;
            }
            
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        
        if (check_stop_or_pause()) return;
        
        // 4. 排废直到空瓶稳定
        add_log("排废清洗液...");
        system_state_->transition_to(workflows::SystemState::State::DRAIN);
        
        auto drain_result = load_cell_->wait_for_empty_bottle(
            action.empty_tolerance_g(),
            action.drain_timeout_s(),
            action.empty_stability_window_s(),
            [this]() { return check_stop_or_pause(); }
        );
        
        if (drain_result.stopped) {
            add_log("排废被中断");
            return;
        } else if (drain_result.success) {
            add_log("排废完成: " + std::to_string(drain_result.empty_weight) + "g");
        } else {
            add_log("排废超时");
        }
    }
    
    // 提交事务并恢复到初始状态 (Phase 1.3)
    guard.commit_and_restore();
    add_log("清洗完成");
}

bool ExperimentServiceImpl::wait_for_heater_cycles(int count, double timeout_s) {
    if (!sensor_driver_) {
        add_log("警告: 无传感器驱动，使用估算时间");
        // 降级: 无传感器时用估算时间 (假设每个周期约 26 秒，可根据实际配置调整)
        double estimated_cycle_time = 26.0;
        double total_time = count * estimated_cycle_time;
        auto end = std::chrono::steady_clock::now() + 
                  std::chrono::milliseconds(static_cast<int>(std::min(total_time, timeout_s) * 1000));
        while (std::chrono::steady_clock::now() < end) {
            if (check_stop_or_pause()) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        return true;
    }
    
    add_log("等待 " + std::to_string(count) + " 个加热周期完成");
    
    int completed_cycles = 0;
    int last_heater_step = -1;
    int max_heater_step = 0;  // 记录观察到的最大步数
    bool seen_first_cycle = false;
    
    auto start = std::chrono::steady_clock::now();
    auto timeout = std::chrono::seconds(static_cast<int>(timeout_s));
    
    // 订阅传感器数据，监听 heater_step 变化
    std::mutex cycle_mutex;
    std::condition_variable cycle_cv;
    
    auto conn = sensor_driver_->on_packet.connect([&](const nlohmann::json& packet) {
        if (!packet.contains("type") || packet["type"] != "reading") return;
        if (!packet.contains("heater_step")) return;
        
        int current_step = packet["heater_step"].get<int>();
        
        std::lock_guard<std::mutex> lock(cycle_mutex);
        
        // 更新观察到的最大步数
        if (current_step > max_heater_step) {
            max_heater_step = current_step;
        }
        
        // 检测周期完成: 从非0步回到0步
        if (last_heater_step > 0 && current_step == 0 && seen_first_cycle) {
            completed_cycles++;
            add_log("完成加热周期 " + std::to_string(completed_cycles) + "/" + std::to_string(count));
            cycle_cv.notify_all();
        }
        
        // 第一次看到步数从大变小，标记为已见过第一个周期
        if (last_heater_step > current_step && !seen_first_cycle) {
            seen_first_cycle = true;
        }
        
        last_heater_step = current_step;
    });
    
    // 等待完成指定数量的周期
    {
        std::unique_lock<std::mutex> lock(cycle_mutex);
        while (completed_cycles < count) {
            if (check_stop_or_pause()) {
                conn.disconnect();
                return false;
            }
            
            if (std::chrono::steady_clock::now() - start > timeout) {
                add_log("等待加热周期超时");
                conn.disconnect();
                return false;
            }
            
            cycle_cv.wait_for(lock, std::chrono::milliseconds(100));
        }
    }
    
    conn.disconnect();
    add_log("加热周期等待完成");
    return true;
}

bool ExperimentServiceImpl::wait_for_sensor_stability(double window_s, double threshold_percent, double timeout_s) {
    if (!sensor_driver_) {
        add_log("警告: 无传感器驱动，使用最大时间");
        auto end = std::chrono::steady_clock::now() + 
                  std::chrono::milliseconds(static_cast<int>(timeout_s * 1000));
        while (std::chrono::steady_clock::now() < end) {
            if (check_stop_or_pause()) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        return true;
    }
    
    add_log("等待传感器稳定 (窗口=" + std::to_string(window_s) + "s, 阈值=" + 
            std::to_string(threshold_percent) + "%)");
    
    std::deque<double> readings;
    auto window_duration = std::chrono::milliseconds(static_cast<int>(window_s * 1000));
    auto start = std::chrono::steady_clock::now();
    auto timeout = std::chrono::seconds(static_cast<int>(timeout_s));
    
    std::mutex readings_mutex;
    bool stable = false;
    
    auto conn = sensor_driver_->on_packet.connect([&](const nlohmann::json& packet) {
        if (!packet.contains("type") || packet["type"] != "reading") return;
        if (!packet.contains("value")) return;
        
        double value = packet["value"].get<double>();
        
        std::lock_guard<std::mutex> lock(readings_mutex);
        readings.push_back(value);
        
        // 只保留窗口内的数据
        auto now = std::chrono::steady_clock::now();
        while (readings.size() > 1 && 
               (now - start) > window_duration && 
               readings.size() > static_cast<size_t>(window_s * 10)) {  // 假设约 10Hz 采样
            readings.pop_front();
        }
        
        // 检查稳定性: 计算变化百分比
        if (readings.size() >= 10) {
            double min_val = *std::min_element(readings.begin(), readings.end());
            double max_val = *std::max_element(readings.begin(), readings.end());
            double mean_val = (min_val + max_val) / 2.0;
            
            if (mean_val > 0) {
                double variation_percent = ((max_val - min_val) / mean_val) * 100.0;
                if (variation_percent <= threshold_percent) {
                    stable = true;
                }
            }
        }
    });
    
    while (!stable) {
        if (check_stop_or_pause()) {
            conn.disconnect();
            return false;
        }
        
        if (std::chrono::steady_clock::now() - start > timeout) {
            add_log("等待稳定超时");
            conn.disconnect();
            return false;
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    conn.disconnect();
    add_log("传感器已稳定");
    return true;
}

void ExperimentServiceImpl::add_log(const std::string& message) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    // 添加时间戳
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    char buf[64];
    std::strftime(buf, sizeof(buf), "%H:%M:%S", std::localtime(&time_t));
    
    std::string log_entry = std::string(buf) + " " + message;
    logs_.push_back(log_entry);
    
    // 只保留最近100条日志
    if (logs_.size() > 100) {
        logs_.erase(logs_.begin());
    }
    
    spdlog::info("[实验] {}", message);
}

void ExperimentServiceImpl::emit_event(
    experiment::ExperimentEvent::EventType type,
    const std::string& message,
    const std::map<std::string, std::string>& data) {
    
    if (subscriber_count_ == 0) return;
    
    experiment::ExperimentEvent event;
    *event.mutable_timestamp() = google::protobuf::util::TimeUtil::GetCurrentTime();
    event.set_type(type);
    event.set_message(message);
    event.set_step_name(current_step_name_);
    
    for (const auto& [key, value] : data) {
        (*event.mutable_data())[key] = value;
    }
    
    {
        std::lock_guard<std::mutex> lock(event_mutex_);
        event_queue_.push(std::move(event));
    }
    event_cv_.notify_all();
}

void ExperimentServiceImpl::fill_status_response(experiment::ExperimentStatusResponse* response) {
    response->set_state(state_);
    
    if (loaded_program_) {
        response->set_program_id(loaded_program_->id());
        response->set_program_name(loaded_program_->name());
        response->set_total_steps(loaded_program_->steps_size());
    }
    
    // 设置 YAML hash
    if (!loaded_program_yaml_hash_.empty()) {
        response->set_program_yaml_hash(loaded_program_yaml_hash_);
    }
    
    // 设置 run_id
    if (current_run_id_.has_value()) {
        response->set_run_id(current_run_id_.value());
    }
    
    response->set_current_step_index(current_step_index_);
    response->set_current_step_name(current_step_name_);
    response->set_loop_iteration(loop_iteration_);
    response->set_loop_total(loop_total_);
    
    // 计算进度
    if (loaded_program_ && loaded_program_->steps_size() > 0) {
        int progress = (current_step_index_ * 100) / loaded_program_->steps_size();
        response->set_progress_percent(progress);
    }
    
    // 计算已运行时间
    if (state_ == experiment::EXP_RUNNING || state_ == experiment::EXP_PAUSED) {
        auto elapsed = std::chrono::steady_clock::now() - start_time_;
        response->set_elapsed_s(
            std::chrono::duration_cast<std::chrono::seconds>(elapsed).count());
    }
    
    // 估算剩余时间
    if (validation_result_.valid && response->progress_percent() > 0) {
        double total_est = validation_result_.estimate.estimated_duration_s;
        double remaining = total_est * (100 - response->progress_percent()) / 100;
        response->set_remaining_s(remaining);
    }
    
    // 添加日志
    for (const auto& log : logs_) {
        response->add_logs(log);
    }
    
    if (!error_message_.empty()) {
        response->set_error(error_message_);
    }
}

bool ExperimentServiceImpl::check_stop_or_pause() {
    if (stop_requested_) return true;
    if (pause_requested_) {
        wait_if_paused();
    }
    return stop_requested_;
}

void ExperimentServiceImpl::wait_if_paused() {
    std::unique_lock<std::mutex> lock(pause_mutex_);
    pause_cv_.wait(lock, [this] {
        return !pause_requested_ || stop_requested_;
    });
}

workflows::SystemState::State ExperimentServiceImpl::convert_state(experiment::SystemState state) {
    switch (state) {
        case experiment::STATE_INITIAL: return workflows::SystemState::State::INITIAL;
        case experiment::STATE_DRAIN: return workflows::SystemState::State::DRAIN;
        case experiment::STATE_CLEAN: return workflows::SystemState::State::CLEAN;
        case experiment::STATE_SAMPLE: return workflows::SystemState::State::SAMPLE;
        case experiment::STATE_INJECT: return workflows::SystemState::State::INJECT;
        default: return workflows::SystemState::State::INITIAL;
    }
}

// ============== Phase 3: Action Executor Integration ==============

void ExperimentServiceImpl::init_executors() {
    // Phase 3 修复: 实例化 HardwareStateMachine (解决 Gemini 评估指出的"僵尸代码"问题)
    hardware_state_machine_ = std::make_shared<workflows::HardwareStateMachine>(system_state_);
    spdlog::info("HardwareStateMachine 初始化完成");
    
    // 创建并注册各原语执行器，注入 HardwareStateMachine
    auto inject_exec = std::make_shared<workflows::InjectExecutor>(
        system_state_, load_cell_, hardware_state_machine_);
    auto drain_exec = std::make_shared<workflows::DrainExecutor>(
        system_state_, load_cell_, hardware_state_machine_);
    auto acquire_exec = std::make_shared<workflows::AcquireExecutor>(
        system_state_, load_cell_, sensor_driver_, hardware_state_machine_);
    auto wash_exec = std::make_shared<workflows::WashExecutor>(
        system_state_, load_cell_, hardware_state_machine_);
    
    // 注册到 map
    executors_["inject"] = inject_exec;
    executors_["drain"] = drain_exec;
    executors_["acquire"] = acquire_exec;
    executors_["wash"] = wash_exec;
    
    spdlog::info("Action Executors 初始化完成: {} 个执行器 (已注入 HardwareStateMachine)", executors_.size());
}

bool ExperimentServiceImpl::try_execute_with_executor(const experiment::Step& step) {
    std::string action_type;
    
    switch (step.action_case()) {
        case experiment::Step::kInject: action_type = "inject"; break;
        case experiment::Step::kDrain: action_type = "drain"; break;
        case experiment::Step::kAcquire: action_type = "acquire"; break;
        case experiment::Step::kWash: action_type = "wash"; break;
        default: return false;  // 未支持的动作类型
    }
    
    auto it = executors_.find(action_type);
    if (it == executors_.end()) {
        return false;  // 没有对应的执行器
    }
    
    auto& executor = it->second;
    
    // 检查前置条件
    auto precond = executor->check_preconditions(step);
    if (!precond) {
        std::string errors;
        for (const auto& e : precond.failed_conditions) {
            errors += e + "; ";
        }
        add_log("前置条件检查失败: " + errors);
        // 降级到原有实现
        return false;
    }
    
    // 执行
    auto result = executor->execute(step);
    
    if (!result.success) {
        add_log("Executor 执行失败: " + result.error_message);
        // 可以选择降级或报错
        return false;
    }
    
    add_log("Executor 执行成功 (耗时 " + std::to_string(result.duration_s) + "s)");
    return true;
}

void ExperimentServiceImpl::execute_configure_heater(
    const experiment::ConfigureHeaterAction& action) {
    add_log("配置加热器");
    
    // 更新样本上下文 - 加热器配置
    current_sample_ctx_.heater_configs.clear();
    
    for (const auto& config : action.configs()) {
        db::HeaterConfigInfo info;
        
        // 复制传感器索引
        for (int idx : config.sensor_indices()) {
            info.sensor_indices.push_back(idx);
        }
        
        info.profile_name = config.profile_name();
        
        // 复制温度和持续时间数组
        for (int temp : config.temps()) {
            info.temps.push_back(temp);
        }
        for (int dur : config.durs()) {
            info.durs.push_back(dur);
        }
        
        current_sample_ctx_.heater_configs.push_back(info);
        
        add_log("  传感器 " + std::to_string(info.sensor_indices.size()) + 
                " 个, 配置: " + (info.profile_name.empty() ? "自定义" : info.profile_name));
    }
    
    // TODO: 实际应用加热器配置到硬件
    // 这部分应该由 HeaterConfigExecutor 处理
}

void ExperimentServiceImpl::execute_preheat(const experiment::PreheatAction& action) {
    add_log("传感器预热");
    
    // 使用事务守卫切换到 SAMPLE 状态（让气体流经传感器）
    workflows::StateTransactionGuard guard(
        system_state_.get(),
        workflows::SystemState::State::SAMPLE,
        "preheat"
    );
    
    // 设置气泵PWM (预热时需要通气)
    if (action.gas_pump_pwm() > 0) {
        float pwm = action.gas_pump_pwm() / 100.0f;
        system_state_->set_air_pump_pwm(pwm);
        add_log("气泵PWM: " + std::to_string(action.gas_pump_pwm()) + "%");
    }
    
    // 如果 record_data 为 true，设置传感器数据的阶段上下文
    if (action.record_data() && sensor_repo_ && current_run_id_) {
        sensor_repo_->set_run_context(*current_run_id_, "PREHEAT");
        add_log("预热数据将记录到数据库 (phase=PREHEAT)");
    }
    
    // 根据预热模式等待
    switch (action.mode_case()) {
        case experiment::PreheatAction::kCycles: {
            // 等待指定数量的加热周期
            add_log("预热模式: " + std::to_string(action.cycles()) + " 个加热周期");
            wait_for_heater_cycles(action.cycles(), action.max_duration_s());
            break;
        }
        case experiment::PreheatAction::kDurationS: {
            // 等待指定时间
            add_log("预热模式: " + std::to_string(action.duration_s()) + " 秒");
            auto end = std::chrono::steady_clock::now() + 
                      std::chrono::milliseconds(static_cast<int>(action.duration_s() * 1000));
            while (std::chrono::steady_clock::now() < end) {
                if (check_stop_or_pause()) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            break;
        }
        default: {
            // 默认使用最大时间
            add_log("预热模式: 默认最大时间 " + std::to_string(action.max_duration_s()) + " 秒");
            auto end = std::chrono::steady_clock::now() + 
                      std::chrono::milliseconds(static_cast<int>(action.max_duration_s() * 1000));
            while (std::chrono::steady_clock::now() < end) {
                if (check_stop_or_pause()) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            break;
        }
    }
    
    // 如果记录了预热数据，清除阶段上下文（保留 run_id）
    if (action.record_data() && sensor_repo_ && current_run_id_) {
        sensor_repo_->set_run_context(*current_run_id_, "");
    }
    
    // 提交事务并恢复到初始状态
    guard.commit_and_restore();
    add_log("预热完成");
}

} // namespace grpc_service
