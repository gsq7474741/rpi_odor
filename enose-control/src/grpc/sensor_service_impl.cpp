#include "grpc/sensor_service_impl.hpp"
#include <spdlog/spdlog.h>
#include <chrono>

namespace enose_grpc {

SensorServiceImpl::SensorServiceImpl(std::shared_ptr<hal::SensorDriver> sensor)
    : sensor_(std::move(sensor)) {
    
    // 连接传感器数据包回调
    packet_connection_ = sensor_->on_packet.connect(
        [this](const nlohmann::json& packet) {
            on_sensor_packet(packet);
        }
    );
    
    connected_ = true;
}

SensorServiceImpl::~SensorServiceImpl() {
    packet_connection_.disconnect();
}

void SensorServiceImpl::on_sensor_packet(const nlohmann::json& packet) {
    std::string msg_type = packet.value("type", "");
    
    if (msg_type == "data") {
        // 传感器数据 - 转发给所有订阅者
        ::enose::service::SensorReading reading;
        reading.set_tick_ms(packet.value("tick", 0ULL));
        reading.set_sensor_idx(packet.value("s", 0U));
        reading.set_sensor_id(packet.value("id", 0U));
        reading.set_value(packet.value("v", packet.value("R", 0.0)));
        reading.set_sensor_type(packet.value("st", "mox_d"));
        reading.set_heater_step(packet.value("gi", 0U));
        reading.set_adc_channel(packet.value("ch", 0U));
        
        if (packet.contains("T")) {
            reading.set_temperature(packet["T"].get<double>());
        }
        if (packet.contains("H")) {
            reading.set_humidity(packet["H"].get<double>());
        }
        if (packet.contains("P")) {
            reading.set_pressure(packet["P"].get<double>());
        }
        
        // 广播给所有订阅者
        std::lock_guard<std::mutex> lock(subscribers_mutex_);
        for (auto it = subscribers_.begin(); it != subscribers_.end(); ) {
            if (!(*it)->Write(reading)) {
                it = subscribers_.erase(it);
            } else {
                ++it;
            }
        }
    }
    else if (msg_type == "ready") {
        // 设备就绪消息
        firmware_version_ = packet.value("version", "");
        sensor_count_ = packet.value("sensors", 8U);
        spdlog::info("SensorService: Device ready, firmware={}, sensors={}", 
                     firmware_version_, sensor_count_.load());
    }
    else if (msg_type == "ack" || msg_type == "error" || msg_type == "status") {
        // 命令响应 - 放入响应队列
        std::lock_guard<std::mutex> lock(response_mutex_);
        response_queue_.push(packet);
        response_cv_.notify_one();
    }
}

nlohmann::json SensorServiceImpl::send_command_and_wait(const std::string& cmd, const nlohmann::json& params) {
    int id = ++cmd_id_;
    
    nlohmann::json msg;
    msg["cmd"] = cmd;
    msg["id"] = id;
    if (!params.empty()) {
        msg["params"] = params;
    }
    
    // 清空响应队列
    {
        std::lock_guard<std::mutex> lock(response_mutex_);
        while (!response_queue_.empty()) {
            response_queue_.pop();
        }
    }
    
    // 发送命令
    sensor_->write(msg);
    
    // 等待响应 (3秒超时)
    std::unique_lock<std::mutex> lock(response_mutex_);
    if (response_cv_.wait_for(lock, std::chrono::seconds(3), [this]() {
        return !response_queue_.empty();
    })) {
        nlohmann::json response = response_queue_.front();
        response_queue_.pop();
        return response;
    }
    
    // 超时
    return {{"ok", false}, {"error", "Timeout waiting for response"}};
}

::grpc::Status SensorServiceImpl::SendCommand(
    ::grpc::ServerContext* context,
    const ::enose::service::SensorCommandRequest* request,
    ::enose::service::SensorCommandResponse* response
) {
    spdlog::info("gRPC: SensorService.SendCommand: {}", request->command());
    
    try {
        nlohmann::json params;
        if (request->has_params_json()) {
            params = nlohmann::json::parse(request->params_json());
        }
        
        nlohmann::json resp = send_command_and_wait(request->command(), params);
        
        // 检查是否超时
        if (resp.contains("error") && resp["error"] == "Timeout waiting for response") {
            response->set_success(false);
            response->set_message("Timeout waiting for response");
            response->set_data_json(resp.dump());
            return ::grpc::Status::OK;
        }
        
        // status 和 ack 类型的响应视为成功
        std::string msg_type = resp.value("type", "");
        bool ok = resp.value("ok", msg_type == "status" || msg_type == "ack");
        response->set_success(ok);
        
        if (ok) {
            response->set_message("Command executed successfully");
            
            // 更新状态
            if (request->command() == "start") {
                running_ = true;
            } else if (request->command() == "stop") {
                running_ = false;
            } else if (request->command() == "init") {
                sensor_count_ = resp.value("sensors", 8U);
            }
        } else {
            response->set_message(resp.value("error", resp.value("msg", "Command failed")));
        }
        
        response->set_data_json(resp.dump());
        
    } catch (const std::exception& e) {
        response->set_success(false);
        response->set_message(std::string("Error: ") + e.what());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::SubscribeSensorReadings(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::grpc::ServerWriter<::enose::service::SensorReading>* writer
) {
    spdlog::info("gRPC: SensorService.SubscribeSensorReadings - client connected");
    
    // 添加到订阅者列表
    {
        std::lock_guard<std::mutex> lock(subscribers_mutex_);
        subscribers_.push_back(writer);
    }
    
    // 等待客户端断开
    while (!context->IsCancelled()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    // 从订阅者列表移除
    {
        std::lock_guard<std::mutex> lock(subscribers_mutex_);
        subscribers_.erase(
            std::remove(subscribers_.begin(), subscribers_.end(), writer),
            subscribers_.end()
        );
    }
    
    spdlog::info("gRPC: SensorService.SubscribeSensorReadings - client disconnected");
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::GetSensorStatus(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::SensorBoardStatus* response
) {
    spdlog::debug("gRPC: SensorService.GetSensorStatus");
    
    response->set_connected(connected_);
    response->set_running(running_);
    response->set_sensor_count(sensor_count_);
    response->set_firmware_version(firmware_version_);
    response->set_port(port_);
    
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::ConfigureHeater(
    ::grpc::ServerContext* context,
    const ::enose::service::HeaterConfigRequest* request,
    ::enose::service::HeaterConfigResponse* response
) {
    spdlog::info("gRPC: SensorService.ConfigureHeater");
    
    try {
        nlohmann::json params;
        
        // 转换 temps
        std::vector<int> temps;
        for (auto t : request->temps()) {
            temps.push_back(static_cast<int>(t));
        }
        params["temps"] = temps;
        
        // 转换 durs
        std::vector<int> durs;
        for (auto d : request->durs()) {
            durs.push_back(static_cast<int>(d));
        }
        params["durs"] = durs;
        
        // 转换 sensors (如果指定)
        if (request->sensors_size() > 0) {
            std::vector<int> sensors;
            for (auto s : request->sensors()) {
                sensors.push_back(static_cast<int>(s));
            }
            params["sensors"] = sensors;
        }
        
        nlohmann::json resp = send_command_and_wait("config", params);
        
        bool ok = resp.value("ok", false);
        response->set_success(ok);
        response->set_message(ok ? "Heater configured" : resp.value("error", "Unknown error"));
        
    } catch (const std::exception& e) {
        response->set_success(false);
        response->set_message(std::string("Error: ") + e.what());
    }
    
    return ::grpc::Status::OK;
}

} // namespace enose_grpc
