#pragma once

#include <grpcpp/grpcpp.h>
#include "enose_service.grpc.pb.h"
#include "hal/sensor_driver.hpp"
#include <memory>
#include <mutex>
#include <queue>
#include <condition_variable>
#include <atomic>

namespace enose_grpc {

class SensorServiceImpl final : public ::enose::service::SensorService::Service {
public:
    SensorServiceImpl(std::shared_ptr<hal::SensorDriver> sensor);
    ~SensorServiceImpl();

    ::grpc::Status SendCommand(
        ::grpc::ServerContext* context,
        const ::enose::service::SensorCommandRequest* request,
        ::enose::service::SensorCommandResponse* response) override;

    ::grpc::Status SubscribeSensorReadings(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::grpc::ServerWriter<::enose::service::SensorReading>* writer) override;

    ::grpc::Status GetSensorStatus(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::SensorBoardStatus* response) override;

    ::grpc::Status ConfigureHeater(
        ::grpc::ServerContext* context,
        const ::enose::service::HeaterConfigRequest* request,
        ::enose::service::HeaterConfigResponse* response) override;

private:
    void on_sensor_packet(const nlohmann::json& packet);
    nlohmann::json send_command_and_wait(const std::string& cmd, const nlohmann::json& params = {});

    std::shared_ptr<hal::SensorDriver> sensor_;
    
    // 传感器板状态
    std::atomic<bool> connected_{false};
    std::atomic<bool> running_{false};
    std::atomic<uint32_t> sensor_count_{8};
    std::string firmware_version_;
    std::string port_;
    
    // 命令响应队列
    std::mutex response_mutex_;
    std::condition_variable response_cv_;
    std::queue<nlohmann::json> response_queue_;
    std::atomic<int> cmd_id_{0};
    
    // 数据流订阅者
    std::mutex subscribers_mutex_;
    std::vector<::grpc::ServerWriter<::enose::service::SensorReading>*> subscribers_;
    
    // 信号连接
    boost::signals2::connection packet_connection_;
};

} // namespace enose_grpc
