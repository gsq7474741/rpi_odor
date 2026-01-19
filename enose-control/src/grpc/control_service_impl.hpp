#pragma once

#include <grpcpp/grpcpp.h>
#include <memory>
#include "enose_service.grpc.pb.h"
#include "workflows/system_state.hpp"

namespace hal {
class ActuatorDriver;
}

namespace enose_grpc {

/**
 * @brief gRPC ControlService 实现
 * 
 * 提供系统控制接口，包括：
 * - 获取/设置系统状态
 * - 手动控制外设
 * - 泵控制
 * - 事件订阅
 */
class ControlServiceImpl final : public enose::service::ControlService::Service {
public:
    ControlServiceImpl(
        std::shared_ptr<hal::ActuatorDriver> actuator,
        std::shared_ptr<workflows::SystemState> system_state
    );

    // 获取系统状态
    ::grpc::Status GetStatus(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::SystemStatus* response
    ) override;

    // 设置系统状态
    ::grpc::Status SetSystemState(
        ::grpc::ServerContext* context,
        const ::enose::service::SetSystemStateRequest* request,
        ::enose::service::SetSystemStateResponse* response
    ) override;

    // 手动控制外设
    ::grpc::Status ManualControl(
        ::grpc::ServerContext* context,
        const ::enose::service::ManualControlRequest* request,
        ::enose::service::ManualControlResponse* response
    ) override;

    // 运行泵
    ::grpc::Status RunPump(
        ::grpc::ServerContext* context,
        const ::enose::service::RunPumpRequest* request,
        ::enose::service::RunPumpResponse* response
    ) override;

    // 停止所有泵
    ::grpc::Status StopAllPumps(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::StopAllPumpsResponse* response
    ) override;

    // 订阅事件流
    ::grpc::Status SubscribeEvents(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::grpc::ServerWriter<::enose::data::Event>* writer
    ) override;

    // 订阅外设状态更新
    ::grpc::Status SubscribePeripheralStatus(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::grpc::ServerWriter<::enose::service::PeripheralStatus>* writer
    ) override;

private:
    std::shared_ptr<hal::ActuatorDriver> actuator_;
    std::shared_ptr<workflows::SystemState> system_state_;
    
    // 将内部状态转换为 proto 消息
    void fill_peripheral_status(::enose::service::PeripheralStatus* status);
};

} // namespace enose_grpc
