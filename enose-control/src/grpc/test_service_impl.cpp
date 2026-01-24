#include "test_service_impl.hpp"
#include "../db/test_run_repository.hpp"
#include <spdlog/spdlog.h>
#include <google/protobuf/timestamp.pb.h>
#include <google/protobuf/util/time_util.h>

namespace grpc_service {

TestServiceImpl::TestServiceImpl(
    std::shared_ptr<workflows::SystemState> system_state,
    std::shared_ptr<hal::LoadCellDriver> load_cell,
    std::shared_ptr<db::TestRunRepository> repository)
    : system_state_(std::move(system_state))
    , load_cell_(std::move(load_cell))
    , repository_(std::move(repository))
    , test_controller_(repository_ ? 
          std::make_unique<workflows::TestController>(repository_) :
          std::make_unique<workflows::TestController>())
{
    // 设置回调函数
    test_controller_->set_system_state_callback(
        [this](const std::string& state) -> bool {
            if (state == "DRAIN") {
                system_state_->start_drain();
            } else if (state == "INITIAL") {
                system_state_->transition_to(workflows::SystemState::State::INITIAL);
            } else if (state == "INJECT") {
                // 进样状态由 start_injection 处理
            }
            return true;
        });
    
    test_controller_->set_injection_callback(
        [this](float p2, float p3, float p4, float p5, float speed, float accel) -> bool {
            workflows::SystemState::InjectionParams params;
            params.pump_2_volume = p2;
            params.pump_3_volume = p3;
            params.pump_4_volume = p4;
            params.pump_5_volume = p5;
            params.speed = speed;
            params.accel = accel;
            system_state_->start_inject(params);
            return true;
        });
    
    test_controller_->set_wait_empty_callback(
        [this](float tolerance, float timeout_sec, float stability_window_sec) -> std::pair<bool, float> {
            auto result = load_cell_->wait_for_empty_bottle(tolerance, timeout_sec, stability_window_sec);
            return {result.success, result.empty_weight};
        });
    
    test_controller_->set_get_weight_callback(
        [this]() -> std::pair<float, bool> {
            auto status = load_cell_->get_status();
            return {status.filtered_weight, status.is_stable};
        });
    
    test_controller_->set_reset_empty_weight_callback(
        [this]() {
            load_cell_->reset_dynamic_empty_weight();
        });
    
    spdlog::info("TestServiceImpl: Initialized");
}

::grpc::Status TestServiceImpl::StartTest(
    ::grpc::ServerContext* context,
    const ::enose::service::StartTestRequest* request,
    ::enose::service::TestStatusResponse* response)
{
    spdlog::info("TestServiceImpl: StartTest with {} param sets", request->param_sets_size());
    
    // 转换配置
    workflows::TestConfig config;
    for (const auto& ps : request->param_sets()) {
        if (ps.cycles() <= 0) continue;
        
        workflows::ParamSet param_set;
        param_set.id = ps.id();
        param_set.name = ps.name();
        param_set.pump2_volume = ps.pump2_volume();
        param_set.pump3_volume = ps.pump3_volume();
        param_set.pump4_volume = ps.pump4_volume();
        param_set.pump5_volume = ps.pump5_volume();
        param_set.speed = ps.speed();
        param_set.cycles = ps.cycles();
        config.param_sets.push_back(param_set);
    }
    
    config.accel = request->accel();
    config.empty_tolerance = request->empty_tolerance() > 0 ? request->empty_tolerance() : 5.0f;
    config.drain_stability_window = request->drain_stability_window() > 0 ? request->drain_stability_window() : 5.0f;
    
    // 启动测试
    bool success = test_controller_->start_test(config);
    if (!success) {
        response->set_state(::enose::service::TEST_ERROR);
        response->set_message("无法启动测试");
        return ::grpc::Status::OK;
    }
    
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::StopTest(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::TestStatusResponse* response)
{
    spdlog::info("TestServiceImpl: StopTest");
    
    test_controller_->stop_test();
    fill_status_response(response);
    
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::GetTestStatus(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::TestStatusResponse* response)
{
    fill_status_response(response);
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::GetTestResults(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::TestResultsResponse* response)
{
    auto results = test_controller_->get_results();
    
    for (const auto& r : results) {
        auto* result = response->add_results();
        result->set_param_set_id(r.param_set_id);
        result->set_param_set_name(r.param_set_name);
        result->set_cycle(r.cycle);
        result->set_total_volume(r.total_volume);
        result->set_pump2_volume(r.pump2_volume);
        result->set_pump3_volume(r.pump3_volume);
        result->set_pump4_volume(r.pump4_volume);
        result->set_pump5_volume(r.pump5_volume);
        result->set_speed(r.speed);
        result->set_empty_weight(r.empty_weight);
        result->set_full_weight(r.full_weight);
        result->set_injected_weight(r.injected_weight);
        result->set_drain_duration_ms(r.drain_duration_ms);
        result->set_wait_empty_duration_ms(r.wait_empty_duration_ms);
        result->set_inject_duration_ms(r.inject_duration_ms);
        result->set_wait_stable_duration_ms(r.wait_stable_duration_ms);
        result->set_total_duration_ms(r.total_duration_ms);
        
        auto* ts = result->mutable_timestamp();
        auto time_t = std::chrono::system_clock::to_time_t(r.timestamp);
        ts->set_seconds(time_t);
    }
    
    response->set_total_count(static_cast<int>(results.size()));
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::ClearTestResults(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::google::protobuf::Empty* response)
{
    spdlog::info("TestServiceImpl: ClearTestResults");
    test_controller_->clear_results();
    return ::grpc::Status::OK;
}

void TestServiceImpl::fill_status_response(::enose::service::TestStatusResponse* response) {
    auto status = test_controller_->get_status();
    
    response->set_state(convert_state(status.state));
    response->set_run_id(status.run_id);
    response->set_current_param_set(status.current_param_set);
    response->set_total_param_sets(status.total_param_sets);
    response->set_current_cycle(status.current_cycle);
    response->set_total_cycles(status.total_cycles);
    response->set_global_cycle(status.global_cycle);
    response->set_global_total_cycles(status.global_total_cycles);
    response->set_current_param_name(status.current_param_name);
    response->set_message(status.message);
    
    for (const auto& log : status.logs) {
        response->add_logs(log);
    }
    
    if (status.dynamic_empty_weight.has_value()) {
        response->set_has_dynamic_empty_weight(true);
        response->set_dynamic_empty_weight(status.dynamic_empty_weight.value());
    } else {
        response->set_has_dynamic_empty_weight(false);
        response->set_dynamic_empty_weight(0);
    }
}

::enose::service::TestState TestServiceImpl::convert_state(workflows::TestState state) {
    switch (state) {
        case workflows::TestState::IDLE:
            return ::enose::service::TEST_IDLE;
        case workflows::TestState::DRAINING:
            return ::enose::service::TEST_DRAINING;
        case workflows::TestState::WAITING_EMPTY:
            return ::enose::service::TEST_WAITING_EMPTY;
        case workflows::TestState::INJECTING:
            return ::enose::service::TEST_INJECTING;
        case workflows::TestState::WAITING_STABLE:
            return ::enose::service::TEST_WAITING_STABLE;
        case workflows::TestState::COMPLETE:
            return ::enose::service::TEST_COMPLETE;
        case workflows::TestState::ERROR:
            return ::enose::service::TEST_ERROR;
        case workflows::TestState::STOPPING:
            return ::enose::service::TEST_STOPPING;
        default:
            return ::enose::service::TEST_STATE_UNSPECIFIED;
    }
}

// === 历史数据查询实现 ===

::grpc::Status TestServiceImpl::ListTestRuns(
    ::grpc::ServerContext* context,
    const ::enose::service::ListTestRunsRequest* request,
    ::enose::service::ListTestRunsResponse* response)
{
    if (!repository_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "数据库未配置");
    }
    
    int limit = request->limit() > 0 ? request->limit() : 50;
    int offset = request->offset();
    std::string state_filter = request->state_filter();
    
    auto runs = repository_->list_runs(limit, offset, state_filter);
    
    for (const auto& run : runs) {
        auto* summary = response->add_runs();
        summary->set_run_id(run.id);
        
        auto created_time = std::chrono::system_clock::to_time_t(run.created_at);
        summary->mutable_created_at()->set_seconds(created_time);
        
        if (run.completed_at) {
            auto completed_time = std::chrono::system_clock::to_time_t(*run.completed_at);
            summary->mutable_completed_at()->set_seconds(completed_time);
        }
        
        summary->set_state(run.state);
        summary->set_current_step(run.current_step);
        summary->set_total_steps(run.total_steps);
        summary->set_error_message(run.error_message);
    }
    
    response->set_total_count(static_cast<int>(runs.size()));
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::GetTestRun(
    ::grpc::ServerContext* context,
    const ::enose::service::GetTestRunRequest* request,
    ::enose::service::TestRunDetail* response)
{
    if (!repository_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "数据库未配置");
    }
    
    auto run = repository_->get_run(request->run_id());
    if (!run) {
        return ::grpc::Status(::grpc::StatusCode::NOT_FOUND, "测试运行记录不存在");
    }
    
    response->set_run_id(run->id);
    
    auto created_time = std::chrono::system_clock::to_time_t(run->created_at);
    response->mutable_created_at()->set_seconds(created_time);
    
    if (run->completed_at) {
        auto completed_time = std::chrono::system_clock::to_time_t(*run->completed_at);
        response->mutable_completed_at()->set_seconds(completed_time);
    }
    
    response->set_state(run->state);
    response->set_config_json(run->config_json);
    response->set_current_step(run->current_step);
    response->set_total_steps(run->total_steps);
    response->set_error_message(run->error_message);
    
    // 获取结果列表
    auto results = repository_->get_results(request->run_id());
    for (const auto& r : results) {
        auto* result = response->add_results();
        result->set_param_set_id(r.param_set_id);
        result->set_param_set_name(r.param_set_name);
        result->set_cycle(r.cycle);
        result->set_total_volume(r.total_volume);
        result->set_pump2_volume(r.pump2_volume);
        result->set_pump3_volume(r.pump3_volume);
        result->set_pump4_volume(r.pump4_volume);
        result->set_pump5_volume(r.pump5_volume);
        result->set_speed(r.speed);
        result->set_empty_weight(r.empty_weight);
        result->set_full_weight(r.full_weight);
        result->set_injected_weight(r.injected_weight);
        result->set_drain_duration_ms(r.drain_duration_ms);
        result->set_wait_empty_duration_ms(r.wait_empty_duration_ms);
        result->set_inject_duration_ms(r.inject_duration_ms);
        result->set_wait_stable_duration_ms(r.wait_stable_duration_ms);
        result->set_total_duration_ms(r.total_duration_ms);
        
        auto time_t = std::chrono::system_clock::to_time_t(r.time);
        result->mutable_timestamp()->set_seconds(time_t);
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::GetTestRunResults(
    ::grpc::ServerContext* context,
    const ::enose::service::GetTestRunRequest* request,
    ::enose::service::TestResultsResponse* response)
{
    if (!repository_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "数据库未配置");
    }
    
    auto results = repository_->get_results(request->run_id());
    
    for (const auto& r : results) {
        auto* result = response->add_results();
        result->set_param_set_id(r.param_set_id);
        result->set_param_set_name(r.param_set_name);
        result->set_cycle(r.cycle);
        result->set_total_volume(r.total_volume);
        result->set_pump2_volume(r.pump2_volume);
        result->set_pump3_volume(r.pump3_volume);
        result->set_pump4_volume(r.pump4_volume);
        result->set_pump5_volume(r.pump5_volume);
        result->set_speed(r.speed);
        result->set_empty_weight(r.empty_weight);
        result->set_full_weight(r.full_weight);
        result->set_injected_weight(r.injected_weight);
        result->set_drain_duration_ms(r.drain_duration_ms);
        result->set_wait_empty_duration_ms(r.wait_empty_duration_ms);
        result->set_inject_duration_ms(r.inject_duration_ms);
        result->set_wait_stable_duration_ms(r.wait_stable_duration_ms);
        result->set_total_duration_ms(r.total_duration_ms);
        
        auto time_t = std::chrono::system_clock::to_time_t(r.time);
        result->mutable_timestamp()->set_seconds(time_t);
    }
    
    response->set_total_count(static_cast<int>(results.size()));
    return ::grpc::Status::OK;
}

::grpc::Status TestServiceImpl::GetWeightSamples(
    ::grpc::ServerContext* context,
    const ::enose::service::GetWeightSamplesRequest* request,
    ::enose::service::WeightSamplesResponse* response)
{
    if (!repository_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "数据库未配置");
    }
    
    int run_id = request->run_id();
    int limit = request->limit() > 0 ? request->limit() : 10000;
    
    std::optional<int> cycle;
    if (request->has_cycle()) {
        cycle = request->cycle();
    }
    
    auto samples = repository_->get_weight_samples(run_id, cycle, std::nullopt, std::nullopt, limit);
    
    for (const auto& s : samples) {
        auto* sample = response->add_samples();
        
        auto time_t = std::chrono::system_clock::to_time_t(s.time);
        sample->mutable_time()->set_seconds(time_t);
        
        sample->set_run_id(s.run_id);
        sample->set_cycle(s.cycle);
        sample->set_phase(s.phase);
        sample->set_weight(s.weight);
        sample->set_is_stable(s.is_stable);
        sample->set_trend(s.trend);
    }
    
    response->set_total_count(static_cast<int>(samples.size()));
    return ::grpc::Status::OK;
}

} // namespace grpc_service
