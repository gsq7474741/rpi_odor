#pragma once

#include <grpcpp/grpcpp.h>
#include "enose_service.grpc.pb.h"
#include "hal/sensor_driver.hpp"
#include "db/sensor_repository.hpp"
#include <memory>
#include <mutex>
#include <queue>
#include <vector>
#include <condition_variable>
#include <atomic>

namespace workflows { class DataQualityMonitor; }

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

    // 加热器预设管理
    ::grpc::Status ListHeaterProfiles(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::HeaterProfileListResponse* response) override;

    ::grpc::Status GetHeaterProfile(
        ::grpc::ServerContext* context,
        const ::enose::service::GetHeaterProfileRequest* request,
        ::enose::service::HeaterProfileResponse* response) override;

    ::grpc::Status CreateHeaterProfile(
        ::grpc::ServerContext* context,
        const ::enose::service::HeaterProfileRequest* request,
        ::enose::service::HeaterProfileResponse* response) override;

    ::grpc::Status UpdateHeaterProfile(
        ::grpc::ServerContext* context,
        const ::enose::service::HeaterProfileRequest* request,
        ::enose::service::HeaterProfileResponse* response) override;

    ::grpc::Status DeleteHeaterProfile(
        ::grpc::ServerContext* context,
        const ::enose::service::DeleteHeaterProfileRequest* request,
        ::google::protobuf::Empty* response) override;

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
    boost::signals2::connection disconnect_connection_;
    boost::signals2::connection reconnect_connection_;
    
    // 重连后固件恢复
    void on_sensor_disconnected();
    void on_sensor_reconnected();
    void replay_cached_state();
    
    // 缓存的固件状态（用于重连后恢复）
    std::mutex state_cache_mutex_;
    std::vector<nlohmann::json> cached_heater_configs_;  // 最后发送的 config 命令
    bool cached_sensor_running_{false};                   // 传感器是否在采集中
    std::vector<int> cached_active_sensors_;              // 活跃的传感器列表
    
    // 传感器数据持久化
    std::unique_ptr<db::SensorRepository> sensor_repo_;
    std::atomic<bool> persistence_enabled_{false};
    
public:
    // 数据持久化控制
    void enable_persistence(bool enable = true);
    void set_run_context(int32_t run_id, const std::string& phase_name = "");
    void clear_run_context();
    db::SensorRepository* sensor_repository() { return sensor_repo_.get(); }
    
    // 数据质量监控
    void set_quality_monitor(workflows::DataQualityMonitor* monitor) { quality_monitor_ = monitor; }
    void clear_quality_monitor() { quality_monitor_ = nullptr; }
    
    // 传感器运行状态查询
    bool is_sensor_running() const { return cached_sensor_running_; }
    
    // 传感器状态缓存（供 ExperimentService 调用，重连后自动恢复）
    void cache_heater_config(const nlohmann::json& config_cmd);
    void cache_heater_configs(const std::vector<nlohmann::json>& configs);
    void cache_sensor_started(const std::vector<int>& active_sensors = {});
    void cache_sensor_stopped();
    void clear_state_cache();
    
private:
    workflows::DataQualityMonitor* quality_monitor_{nullptr};
};

} // namespace enose_grpc
