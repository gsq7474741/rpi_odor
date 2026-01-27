#include "experiment_service_impl.hpp"
#include "../workflows/yaml_parser.hpp"
#include "../workflows/transaction_guard.hpp"
#include "../workflows/executors/executors.hpp"
#include <spdlog/spdlog.h>
#include <google/protobuf/util/time_util.h>

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
    
    spdlog::info("收到验证请求: {}", request->program().id());
    
    auto result = validator_.validate(request->program());
    *response = enose::workflows::ExperimentValidator::to_proto(result);
    
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::LoadProgram(
    ::grpc::ServerContext* context,
    const experiment::LoadProgramRequest* request,
    experiment::LoadProgramResponse* response) {
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    // 检查当前状态
    if (state_ == experiment::EXP_RUNNING || state_ == experiment::EXP_PAUSED) {
        response->set_success(false);
        response->set_error_message("实验正在运行中，无法加载新程序");
        return ::grpc::Status::OK;
    }
    
    // 获取程序 (支持 YAML 字符串或结构化程序)
    experiment::ExperimentProgram program;
    
    if (request->has_yaml_content()) {
        spdlog::info("从 YAML 加载实验程序");
        auto parse_result = enose::workflows::YamlParser::parse(request->yaml_content());
        if (!parse_result.success) {
            response->set_success(false);
            response->set_error_message("YAML 解析失败: " + parse_result.error_message);
            return ::grpc::Status::OK;
        }
        program = std::move(parse_result.program);
    } else if (request->has_program()) {
        program = request->program();
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
    
    // 保存程序
    loaded_program_ = std::make_unique<experiment::ExperimentProgram>(std::move(program));
    state_ = experiment::EXP_LOADED;
    response->set_success(true);
    
    emit_event(experiment::ExperimentEvent::PROGRAM_LOADED, 
               "程序已加载: " + loaded_program_->name());
    
    spdlog::info("程序加载成功: {}", loaded_program_->id());
    return ::grpc::Status::OK;
}

::grpc::Status ExperimentServiceImpl::StartExperiment(
    ::grpc::ServerContext* context,
    const google::protobuf::Empty* request,
    experiment::ExperimentStatusResponse* response) {
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (state_ != experiment::EXP_LOADED) {
        fill_status_response(response);
        return ::grpc::Status(::grpc::StatusCode::FAILED_PRECONDITION, 
                             "需要先加载程序才能启动");
    }
    
    spdlog::info("启动实验: {}", loaded_program_->id());
    
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
        } else {
            add_log("实验完成");
            emit_event(experiment::ExperimentEvent::EXPERIMENT_COMPLETED, "实验已完成");
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
    
    // 计算每个泵的进样量
    double total_volume = action.target_volume_ml();
    workflows::SystemState::InjectionParams params;
    params.speed = action.flow_rate_ml_min() / 60.0 * 1000;  // 转换为 mm/s (假设 1ml ≈ 1000mm)
    params.accel = params.speed * 2;  // 默认加速度
    
    // 根据液体配方设置各泵进样量
    for (const auto& comp : action.components()) {
        double volume_mm = total_volume * comp.ratio() * 1000;  // ml to mm
        
        // 查找液体对应的泵
        for (const auto& liquid : loaded_program_->hardware().liquids()) {
            if (liquid.id() == comp.liquid_id()) {
                switch (liquid.pump_index()) {
                    case 2: params.pump_2_volume = volume_mm; break;
                    case 3: params.pump_3_volume = volume_mm; break;
                    case 4: params.pump_4_volume = volume_mm; break;
                    case 5: params.pump_5_volume = volume_mm; break;
                }
                break;
            }
        }
    }
    
    // 启动进样
    system_state_->start_inject(params);
    
    // 等待进样完成 (通过称重反馈)
    double target_weight = action.has_target_weight_g() ? 
                          action.target_weight_g() : 
                          total_volume;  // 假设密度≈1
    double tolerance = action.tolerance();
    auto timeout = std::chrono::seconds(static_cast<int>(action.stable_timeout_s()));
    auto start = std::chrono::steady_clock::now();
    
    while (!check_stop_or_pause()) {
        float current_weight = load_cell_->get_filtered_weight();
        if (current_weight >= target_weight - tolerance) {
            add_log("进样完成: " + std::to_string(current_weight) + "g");
            break;
        }
        
        if (std::chrono::steady_clock::now() - start > timeout) {
            add_log("进样超时");
            break;
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    // 计算进样时间并更新耗材统计
    auto inject_duration = std::chrono::steady_clock::now() - start;
    int64_t inject_seconds = std::chrono::duration_cast<std::chrono::seconds>(inject_duration).count();
    
    if (consumable_repo_ && inject_seconds > 0) {
        // 记录每个使用的泵的运行时间
        if (params.pump_0_volume > 0) consumable_repo_->add_runtime("pump_tube_0", inject_seconds);
        if (params.pump_1_volume > 0) consumable_repo_->add_runtime("pump_tube_1", inject_seconds);
        if (params.pump_2_volume > 0) consumable_repo_->add_runtime("pump_tube_2", inject_seconds);
        if (params.pump_3_volume > 0) consumable_repo_->add_runtime("pump_tube_3", inject_seconds);
        if (params.pump_4_volume > 0) consumable_repo_->add_runtime("pump_tube_4", inject_seconds);
        if (params.pump_5_volume > 0) consumable_repo_->add_runtime("pump_tube_5", inject_seconds);
        if (params.pump_6_volume > 0) consumable_repo_->add_runtime("pump_tube_6", inject_seconds);
        if (params.pump_7_volume > 0) consumable_repo_->add_runtime("pump_tube_7", inject_seconds);
        spdlog::debug("记录泵运行时间: {}秒", inject_seconds);
        
        // 记录液体消耗量 (pump volume 单位是 mm，转换为 ml: 约 0.1 ml/mm，可根据实际泵管校准)
        constexpr double MM_TO_ML = 0.1;  // 1mm 进样距离 ≈ 0.1ml 液体
        if (params.pump_0_volume > 0) consumable_repo_->add_pump_consumption(0, params.pump_0_volume * MM_TO_ML);
        if (params.pump_1_volume > 0) consumable_repo_->add_pump_consumption(1, params.pump_1_volume * MM_TO_ML);
        if (params.pump_2_volume > 0) consumable_repo_->add_pump_consumption(2, params.pump_2_volume * MM_TO_ML);
        if (params.pump_3_volume > 0) consumable_repo_->add_pump_consumption(3, params.pump_3_volume * MM_TO_ML);
        if (params.pump_4_volume > 0) consumable_repo_->add_pump_consumption(4, params.pump_4_volume * MM_TO_ML);
        if (params.pump_5_volume > 0) consumable_repo_->add_pump_consumption(5, params.pump_5_volume * MM_TO_ML);
        if (params.pump_6_volume > 0) consumable_repo_->add_pump_consumption(6, params.pump_6_volume * MM_TO_ML);
        if (params.pump_7_volume > 0) consumable_repo_->add_pump_consumption(7, params.pump_7_volume * MM_TO_ML);
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
                action.empty().stability_window_s()
            );
            if (result.success) {
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
    add_log("排废");
    
    // 使用事务守卫保证状态一致性 (Phase 1.3)
    workflows::StateTransactionGuard guard(
        system_state_.get(),
        workflows::SystemState::State::DRAIN,
        "drain"
    );
    
    // 设置气泵PWM
    // TODO: 实现气泵PWM控制
    
    // 等待空瓶
    auto result = load_cell_->wait_for_empty_bottle(
        action.empty_tolerance_g(),
        action.timeout_s(),
        action.stability_window_s()
    );
    
    if (result.success) {
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
    
    float pwm = action.pwm_percent() / 100.0f;
    
    // 记录气泵运行时间
    if (pwm > 0 && !gas_pump_running_) {
        // 气泵开始运行
        gas_pump_start_time_ = std::chrono::steady_clock::now();
        gas_pump_running_ = true;
    } else if (pwm == 0 && gas_pump_running_) {
        // 气泵停止，记录运行时间
        auto duration = std::chrono::steady_clock::now() - gas_pump_start_time_;
        int64_t seconds = std::chrono::duration_cast<std::chrono::seconds>(duration).count();
        
        if (consumable_repo_ && seconds > 0) {
            // 记录活性炭管和真空过滤器的运行时间
            consumable_repo_->add_runtime("carbon_filter", seconds);
            consumable_repo_->add_runtime("vacuum_filter", seconds);
            spdlog::debug("记录气泵运行时间: {}秒 (活性炭管+真空过滤器)", seconds);
        }
        gas_pump_running_ = false;
    }
    
    // TODO: 实际发送 PWM 控制命令到硬件
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
    if (action.is_start()) {
        add_log("阶段开始: " + action.phase_name());
        emit_event(experiment::ExperimentEvent::PHASE_STARTED, action.phase_name());
    } else {
        add_log("阶段结束: " + action.phase_name());
        emit_event(experiment::ExperimentEvent::PHASE_ENDED, action.phase_name());
    }
}

void ExperimentServiceImpl::execute_wash(const experiment::WashAction& action) {
    add_log("清洗: 目标重量变化=" + std::to_string(action.target_weight_g()) + 
            "g, 重复" + std::to_string(action.repeat_count()) + "次");
    
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
            action.empty_stability_window_s()
        );
        
        if (!empty_result.success) {
            add_log("排废超时，继续清洗");
        }
        
        float baseline_weight = load_cell_->get_filtered_weight();
        add_log("空瓶基线重量: " + std::to_string(baseline_weight) + "g");
        
        if (check_stop_or_pause()) return;
        
        // 2. 切换到 CLEAN 状态 (清洗泵开启)
        add_log("开始注入清洗液...");
        system_state_->transition_to(workflows::SystemState::State::CLEAN);
        
        // 3. 监测重量变化，达到阈值立即切换到排废
        auto fill_start = std::chrono::steady_clock::now();
        auto fill_timeout = std::chrono::seconds(static_cast<int>(action.fill_timeout_s()));
        bool target_reached = false;
        
        while (!check_stop_or_pause()) {
            float current_weight = load_cell_->get_filtered_weight();
            float weight_change = current_weight - baseline_weight;
            
            if (weight_change >= action.target_weight_g()) {
                add_log("达到目标重量变化: " + std::to_string(weight_change) + "g");
                target_reached = true;
                break;
            }
            
            if (std::chrono::steady_clock::now() - fill_start > fill_timeout) {
                add_log("清洗注入超时，当前重量变化: " + std::to_string(weight_change) + "g");
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
            action.empty_stability_window_s()
        );
        
        if (drain_result.success) {
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

} // namespace grpc_service
