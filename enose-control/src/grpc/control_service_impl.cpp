#include "grpc/control_service_impl.hpp"
#include "hal/actuator_driver.hpp"
#include <spdlog/spdlog.h>
#include <format>

namespace grpc_server {

ControlServiceImpl::ControlServiceImpl(
    std::shared_ptr<hal::ActuatorDriver> actuator,
    std::shared_ptr<workflows::SystemState> system_state
) : actuator_(std::move(actuator))
  , system_state_(std::move(system_state)) {}

::grpc::Status ControlServiceImpl::GetStatus(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::SystemStatus* response
) {
    spdlog::debug("gRPC: GetStatus called");
    
    // 设置当前状态
    auto state = system_state_->get_state();
    switch (state) {
        case workflows::SystemState::State::INITIAL:
            response->set_current_state(::enose::service::INITIAL);
            break;
        case workflows::SystemState::State::DRAIN:
            response->set_current_state(::enose::service::DRAIN);
            break;
        default:
            response->set_current_state(::enose::service::SYSTEM_STATE_UNSPECIFIED);
    }
    
    // 填充外设状态
    fill_peripheral_status(response->mutable_peripheral_status());
    
    // 设置连接状态 (简化实现)
    response->set_moonraker_connected(true);
    response->set_sensor_connected(true);
    
    return ::grpc::Status::OK;
}

::grpc::Status ControlServiceImpl::SetSystemState(
    ::grpc::ServerContext* context,
    const ::enose::service::SetSystemStateRequest* request,
    ::enose::service::SetSystemStateResponse* response
) {
    spdlog::info("gRPC: SetSystemState to {}", static_cast<int>(request->target_state()));
    
    try {
        switch (request->target_state()) {
            case ::enose::service::INITIAL:
                system_state_->stop_drain();
                response->set_success(true);
                response->set_message("Switched to INITIAL state");
                response->set_new_state(::enose::service::INITIAL);
                break;
            case ::enose::service::DRAIN:
                system_state_->start_drain();
                response->set_success(true);
                response->set_message("Switched to DRAIN state");
                response->set_new_state(::enose::service::DRAIN);
                break;
            default:
                response->set_success(false);
                response->set_message("Unknown target state");
        }
    } catch (const std::exception& e) {
        response->set_success(false);
        response->set_message(std::format("Error: {}", e.what()));
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ControlServiceImpl::ManualControl(
    ::grpc::ServerContext* context,
    const ::enose::service::ManualControlRequest* request,
    ::enose::service::ManualControlResponse* response
) {
    spdlog::info("gRPC: ManualControl {} = {}", request->peripheral_name(), request->value());
    
    try {
        std::string gcode = std::format("SET_PIN PIN={} VALUE={}", 
                                        request->peripheral_name(), 
                                        request->value());
        actuator_->send_gcode(gcode);
        response->set_success(true);
        response->set_message("Command sent");
    } catch (const std::exception& e) {
        response->set_success(false);
        response->set_message(std::format("Error: {}", e.what()));
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ControlServiceImpl::RunPump(
    ::grpc::ServerContext* context,
    const ::enose::service::RunPumpRequest* request,
    ::enose::service::RunPumpResponse* response
) {
    spdlog::info("gRPC: RunPump {} speed={}", request->pump_name(), request->speed());
    
    try {
        const auto& pump_name = request->pump_name();
        
        if (pump_name == "cleaning_pump") {
            // DC 泵使用 PWM
            std::string gcode = std::format("SET_PIN PIN=cleaning_pump VALUE={}", request->speed());
            actuator_->send_gcode(gcode);
        } else {
            // 步进泵使用 MANUAL_STEPPER
            float distance = request->has_distance() ? request->distance() : 100.0f;
            float accel = request->has_accel() ? request->accel() : 100.0f;
            
            // 先重置位置 (相对位置模式)
            actuator_->send_gcode(std::format("MANUAL_STEPPER STEPPER={} SET_POSITION=0", pump_name));
            // 然后运行
            std::string gcode = std::format(
                "MANUAL_STEPPER STEPPER={} SPEED={} ACCEL={} MOVE={} SYNC=0",
                pump_name, request->speed(), accel, distance
            );
            actuator_->send_gcode(gcode);
        }
        
        response->set_success(true);
        response->set_message("Pump started");
    } catch (const std::exception& e) {
        response->set_success(false);
        response->set_message(std::format("Error: {}", e.what()));
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ControlServiceImpl::StopAllPumps(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::StopAllPumpsResponse* response
) {
    spdlog::info("gRPC: StopAllPumps");
    
    try {
        actuator_->send_gcode("STOP_ALL_PUMPS");
        actuator_->send_gcode("SET_PIN PIN=cleaning_pump VALUE=0");
        response->set_success(true);
        response->set_message("All pumps stopped");
    } catch (const std::exception& e) {
        response->set_success(false);
        response->set_message(std::format("Error: {}", e.what()));
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ControlServiceImpl::SubscribeEvents(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::grpc::ServerWriter<::enose::data::Event>* writer
) {
    spdlog::info("gRPC: SubscribeEvents - client connected");
    
    // 简化实现: 保持连接直到客户端断开
    while (!context->IsCancelled()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    spdlog::info("gRPC: SubscribeEvents - client disconnected");
    return ::grpc::Status::OK;
}

::grpc::Status ControlServiceImpl::SubscribePeripheralStatus(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::grpc::ServerWriter<::enose::service::PeripheralStatus>* writer
) {
    spdlog::info("gRPC: SubscribePeripheralStatus - client connected");
    
    // 定期发送状态更新
    while (!context->IsCancelled()) {
        ::enose::service::PeripheralStatus status;
        fill_peripheral_status(&status);
        
        if (!writer->Write(status)) {
            break;
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    
    spdlog::info("gRPC: SubscribePeripheralStatus - client disconnected");
    return ::grpc::Status::OK;
}

void ControlServiceImpl::fill_peripheral_status(::enose::service::PeripheralStatus* status) {
    const auto& state = system_state_->get_peripheral_state();
    
    status->set_valve_waste(state.valve_waste);
    status->set_valve_pinch(state.valve_pinch);
    status->set_valve_air(state.valve_air);
    status->set_valve_outlet(state.valve_outlet);
    status->set_air_pump_pwm(state.air_pump_pwm);
    status->set_cleaning_pump(state.cleaning_pump);
    status->set_heater_chamber(state.heater_chamber);
    
    // 泵状态
    status->set_pump_2(state.pump_2 == workflows::PumpState::RUNNING 
        ? ::enose::service::PeripheralStatus::RUNNING 
        : ::enose::service::PeripheralStatus::STOPPED);
    status->set_pump_3(state.pump_3 == workflows::PumpState::RUNNING 
        ? ::enose::service::PeripheralStatus::RUNNING 
        : ::enose::service::PeripheralStatus::STOPPED);
    status->set_pump_4(state.pump_4 == workflows::PumpState::RUNNING 
        ? ::enose::service::PeripheralStatus::RUNNING 
        : ::enose::service::PeripheralStatus::STOPPED);
    status->set_pump_5(state.pump_5 == workflows::PumpState::RUNNING 
        ? ::enose::service::PeripheralStatus::RUNNING 
        : ::enose::service::PeripheralStatus::STOPPED);
}

} // namespace grpc_server
