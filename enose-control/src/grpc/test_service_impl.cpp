#include "test_service_impl.hpp"
#include <spdlog/spdlog.h>
#include <google/protobuf/timestamp.pb.h>

namespace grpc_service {

TestServiceImpl::TestServiceImpl(
    std::shared_ptr<workflows::SystemState> system_state,
    std::shared_ptr<hal::LoadCellDriver> load_cell)
    : system_state_(std::move(system_state))
    , load_cell_(std::move(load_cell))
    , test_controller_(std::make_unique<workflows::TestController>())
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

} // namespace grpc_service
