#include "experiment_service_impl.hpp"
#include "../workflows/yaml_parser.hpp"
#include <spdlog/spdlog.h>
#include <google/protobuf/util/time_util.h>

namespace grpc_service {

namespace experiment = ::enose::experiment;

ExperimentServiceImpl::ExperimentServiceImpl(
    std::shared_ptr<workflows::SystemState> system_state,
    std::shared_ptr<hal::LoadCellDriver> load_cell,
    std::shared_ptr<db::ConsumableRepository> consumable_repo)
    : system_state_(std::move(system_state))
    , load_cell_(std::move(load_cell))
    , consumable_repo_(std::move(consumable_repo)) {
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
        default:
            spdlog::warn("未知的步骤动作类型");
            break;
    }
    
    emit_event(experiment::ExperimentEvent::STEP_COMPLETED, step.name());
}

void ExperimentServiceImpl::execute_inject(const experiment::InjectAction& action) {
    add_log("进样: 目标量=" + std::to_string(action.target_volume_ml()) + "ml");
    
    // 切换到进样状态
    system_state_->transition_to(workflows::SystemState::State::INJECT);
    
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
    
    // 停止进样
    system_state_->transition_to(workflows::SystemState::State::INITIAL);
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
    
    // 切换到排废状态
    system_state_->transition_to(workflows::SystemState::State::DRAIN);
    
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
    
    // 恢复初始状态
    system_state_->transition_to(workflows::SystemState::State::INITIAL);
}

void ExperimentServiceImpl::execute_acquire(const experiment::AcquireAction& action) {
    add_log("采集: 气泵PWM=" + std::to_string(action.gas_pump_pwm()) + "%");
    
    // 切换到采样状态
    system_state_->transition_to(workflows::SystemState::State::SAMPLE);
    
    // TODO: 设置气泵PWM
    
    // 根据终止条件等待
    double duration_s = 0;
    switch (action.termination_case()) {
        case experiment::AcquireAction::kDurationS:
            duration_s = action.duration_s();
            break;
        case experiment::AcquireAction::kHeaterCycles:
            duration_s = action.heater_cycles() * 2.5;  // 假设每个循环2.5秒
            break;
        default:
            duration_s = action.max_duration_s();
            break;
    }
    
    auto end = std::chrono::steady_clock::now() + 
              std::chrono::milliseconds(static_cast<int>(duration_s * 1000));
    while (std::chrono::steady_clock::now() < end) {
        if (check_stop_or_pause()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    add_log("采集完成");
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

} // namespace grpc_service
