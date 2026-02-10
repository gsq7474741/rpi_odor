#include "grpc/sensor_service_impl.hpp"
#include "workflows/data_quality_monitor.hpp"
#include <spdlog/spdlog.h>
#include <chrono>
#include <cstdint>

namespace enose_grpc {

SensorServiceImpl::SensorServiceImpl(std::shared_ptr<hal::SensorDriver> sensor)
    : sensor_(std::move(sensor))
    , sensor_repo_(std::make_unique<db::SensorRepository>()) {
    
    // 连接传感器数据包回调
    packet_connection_ = sensor_->on_packet.connect(
        [this](const nlohmann::json& packet) {
            on_sensor_packet(packet);
        }
    );
    
    // 连接断线/重连信号
    disconnect_connection_ = sensor_->on_disconnected.connect(
        [this]() { on_sensor_disconnected(); }
    );
    reconnect_connection_ = sensor_->on_reconnected.connect(
        [this]() { on_sensor_reconnected(); }
    );
    
    // 启动后台刷新线程
    sensor_repo_->start_background_flush();
    
    connected_ = true;
    spdlog::info("SensorService: initialized with data persistence support");
}

SensorServiceImpl::~SensorServiceImpl() {
    packet_connection_.disconnect();
    disconnect_connection_.disconnect();
    reconnect_connection_.disconnect();
    if (sensor_repo_) {
        sensor_repo_->stop_background_flush();
        sensor_repo_->flush();
    }
}

void SensorServiceImpl::on_sensor_packet(const nlohmann::json& packet) {
    std::string msg_type = packet.value("type", "");
    
    // 传感器固件发送的数据类型是 "data"
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
        {
            std::lock_guard<std::mutex> lock(subscribers_mutex_);
            for (auto it = subscribers_.begin(); it != subscribers_.end(); ) {
                if (!(*it)->Write(reading)) {
                    it = subscribers_.erase(it);
                } else {
                    ++it;
                }
            }
        }
        
        // 数据持久化 (如果启用或 run_id 已设置)
        bool should_persist = sensor_repo_ && (persistence_enabled_ || sensor_repo_->should_persist());
        // 首次数据包时记录调试信息
        static std::atomic<int> packet_count{0};
        int count = ++packet_count;
        if (count == 1 || count % 500 == 0) {
            spdlog::info("SensorService: data packet #{}, persist={}, enabled={}, should_persist={}", 
                          count, should_persist, persistence_enabled_.load(), 
                          sensor_repo_ ? sensor_repo_->should_persist() : false);
        }
        if (should_persist) {
            db::SensorReadingRecord record;
            // 使用当前时间戳 (毫秒)
            auto now = std::chrono::system_clock::now();
            auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();
            record.time_ms = ms;
            record.device_tick_ms = packet.value("tick", 0LL);
            record.sensor_idx = static_cast<int16_t>(packet.value("s", 0));
            record.sensor_id = static_cast<int32_t>(packet.value("id", 0));
            record.value = packet.value("v", packet.value("R", 0.0));
            
            // 传感器类型
            std::string st = packet.value("st", "mox_d");
            if (st == "mox_d") record.sensor_type = 0;
            else if (st == "mox_a") record.sensor_type = 1;
            else if (st == "pid") record.sensor_type = 2;
            else record.sensor_type = -1;
            
            // 可选字段
            if (packet.contains("T")) record.temperature = packet["T"].get<float>();
            if (packet.contains("H")) record.humidity = packet["H"].get<float>();
            if (packet.contains("P")) record.pressure = packet["P"].get<float>();
            if (packet.contains("gi")) record.heater_step = static_cast<int16_t>(packet["gi"].get<int>());
            
            // run_id 和 phase_name 由 SensorRepository 自动填充
            sensor_repo_->buffer_insert(record);
        }
        
        // 转发到数据质量监控器
        if (quality_monitor_) {
            auto now = std::chrono::system_clock::now();
            auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();
            quality_monitor_->on_reading(
                packet.value("s", 0),
                packet.value("gi", 0),
                packet.value("v", packet.value("R", 0.0)),
                packet.value("T", 0.0),
                packet.value("H", 0.0),
                packet.value("P", 0.0),
                ms);
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

// ============================================================
// 数据持久化控制
// ============================================================

void SensorServiceImpl::enable_persistence(bool enable) {
    persistence_enabled_ = enable;
    spdlog::info("SensorService: data persistence {}", enable ? "enabled" : "disabled");
}

void SensorServiceImpl::set_run_context(int32_t run_id, const std::string& phase_name) {
    if (sensor_repo_) {
        sensor_repo_->set_run_context(run_id, phase_name);
    }
}

void SensorServiceImpl::clear_run_context() {
    if (sensor_repo_) {
        sensor_repo_->clear_run_context();
    }
}

// ============================================================
// 加热器预设管理
// ============================================================

namespace {
    void record_to_proto(const db::HeaterProfileRecord& rec, ::enose::service::HeaterProfile* proto) {
        proto->set_id(rec.id);
        proto->set_name(rec.name);
        proto->set_description(rec.description);
        for (auto t : rec.temps) proto->add_temps(t);
        for (auto d : rec.durs) proto->add_durs(d);
        proto->set_preheat_mode(rec.preheat_mode);
        proto->set_preheat_cycles(rec.preheat_cycles.value_or(0));
        proto->set_preheat_duration_s(rec.preheat_duration_s.value_or(0));
        proto->set_is_builtin(rec.is_builtin);
    }
    
    db::HeaterProfileRecord proto_to_record(const ::enose::service::HeaterProfile& proto) {
        db::HeaterProfileRecord rec;
        rec.id = proto.id();
        rec.name = proto.name();
        rec.description = proto.description();
        for (int i = 0; i < proto.temps_size(); ++i) {
            rec.temps.push_back(static_cast<int16_t>(proto.temps(i)));
        }
        for (int i = 0; i < proto.durs_size(); ++i) {
            rec.durs.push_back(static_cast<int16_t>(proto.durs(i)));
        }
        rec.preheat_mode = proto.preheat_mode();
        if (proto.preheat_cycles() > 0) rec.preheat_cycles = proto.preheat_cycles();
        if (proto.preheat_duration_s() > 0) rec.preheat_duration_s = proto.preheat_duration_s();
        rec.is_builtin = proto.is_builtin();
        return rec;
    }
}

::grpc::Status SensorServiceImpl::ListHeaterProfiles(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::HeaterProfileListResponse* response) {
    
    if (!sensor_repo_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "Database not available");
    }
    
    try {
        auto profiles = sensor_repo_->list_heater_profiles(true);
        for (const auto& rec : profiles) {
            record_to_proto(rec, response->add_profiles());
        }
    } catch (const std::exception& e) {
        return ::grpc::Status(::grpc::StatusCode::INTERNAL, e.what());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::GetHeaterProfile(
    ::grpc::ServerContext* context,
    const ::enose::service::GetHeaterProfileRequest* request,
    ::enose::service::HeaterProfileResponse* response) {
    
    if (!sensor_repo_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "Database not available");
    }
    
    try {
        std::optional<db::HeaterProfileRecord> rec;
        
        if (request->has_id()) {
            rec = sensor_repo_->get_heater_profile(request->id());
        } else if (request->has_name()) {
            rec = sensor_repo_->get_heater_profile_by_name(request->name());
        } else {
            return ::grpc::Status(::grpc::StatusCode::INVALID_ARGUMENT, "Must specify id or name");
        }
        
        if (!rec) {
            return ::grpc::Status(::grpc::StatusCode::NOT_FOUND, "Profile not found");
        }
        
        record_to_proto(*rec, response->mutable_profile());
    } catch (const std::exception& e) {
        return ::grpc::Status(::grpc::StatusCode::INTERNAL, e.what());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::CreateHeaterProfile(
    ::grpc::ServerContext* context,
    const ::enose::service::HeaterProfileRequest* request,
    ::enose::service::HeaterProfileResponse* response) {
    
    if (!sensor_repo_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "Database not available");
    }
    
    try {
        auto rec = proto_to_record(request->profile());
        int32_t id = sensor_repo_->create_heater_profile(rec);
        
        auto created = sensor_repo_->get_heater_profile(id);
        if (created) {
            record_to_proto(*created, response->mutable_profile());
        }
    } catch (const std::exception& e) {
        return ::grpc::Status(::grpc::StatusCode::INTERNAL, e.what());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::UpdateHeaterProfile(
    ::grpc::ServerContext* context,
    const ::enose::service::HeaterProfileRequest* request,
    ::enose::service::HeaterProfileResponse* response) {
    
    if (!sensor_repo_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "Database not available");
    }
    
    try {
        auto rec = proto_to_record(request->profile());
        
        // 不允许更新内置预设
        auto existing = sensor_repo_->get_heater_profile(rec.id);
        if (existing && existing->is_builtin) {
            return ::grpc::Status(::grpc::StatusCode::PERMISSION_DENIED, "Cannot modify builtin profile");
        }
        
        bool ok = sensor_repo_->update_heater_profile(rec);
        if (!ok) {
            return ::grpc::Status(::grpc::StatusCode::NOT_FOUND, "Profile not found");
        }
        
        auto updated = sensor_repo_->get_heater_profile(rec.id);
        if (updated) {
            record_to_proto(*updated, response->mutable_profile());
        }
    } catch (const std::exception& e) {
        return ::grpc::Status(::grpc::StatusCode::INTERNAL, e.what());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status SensorServiceImpl::DeleteHeaterProfile(
    ::grpc::ServerContext* context,
    const ::enose::service::DeleteHeaterProfileRequest* request,
    ::google::protobuf::Empty* response) {
    
    if (!sensor_repo_) {
        return ::grpc::Status(::grpc::StatusCode::UNAVAILABLE, "Database not available");
    }
    
    try {
        // 不允许删除内置预设
        auto existing = sensor_repo_->get_heater_profile(request->id());
        if (existing && existing->is_builtin) {
            return ::grpc::Status(::grpc::StatusCode::PERMISSION_DENIED, "Cannot delete builtin profile");
        }
        
        bool ok = sensor_repo_->delete_heater_profile(request->id());
        if (!ok) {
            return ::grpc::Status(::grpc::StatusCode::NOT_FOUND, "Profile not found");
        }
    } catch (const std::exception& e) {
        return ::grpc::Status(::grpc::StatusCode::INTERNAL, e.what());
    }
    
    return ::grpc::Status::OK;
}

// ============================================================
// 断线/重连处理
// ============================================================

void SensorServiceImpl::on_sensor_disconnected() {
    connected_ = false;
    spdlog::warn("SensorService: 传感器串口断开");
}

void SensorServiceImpl::on_sensor_reconnected() {
    spdlog::info("SensorService: 传感器串口已重连，开始恢复固件状态...");
    connected_ = true;
    
    // ESP32 断电重启后需要等待它发送 ready 消息
    // ready 消息会在 on_sensor_packet 中处理，更新 firmware_version_ 和 sensor_count_
    // 这里等待一小段时间让 ESP32 完成初始化
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));
    
    replay_cached_state();
}

void SensorServiceImpl::replay_cached_state() {
    std::lock_guard<std::mutex> lock(state_cache_mutex_);
    
    // 1. 发送 sync 命令
    {
        nlohmann::json sync_cmd;
        sync_cmd["cmd"] = "sync";
        sync_cmd["id"] = ++cmd_id_;
        sensor_->write(sync_cmd);
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        spdlog::info("SensorService: 重连恢复 - sync 已发送");
    }
    
    // 2. 发送 init 命令
    {
        nlohmann::json init_cmd;
        init_cmd["cmd"] = "init";
        init_cmd["id"] = ++cmd_id_;
        sensor_->write(init_cmd);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        spdlog::info("SensorService: 重连恢复 - init 已发送");
    }
    
    // 3. 重发缓存的加热器配置
    for (size_t i = 0; i < cached_heater_configs_.size(); i++) {
        auto config_cmd = cached_heater_configs_[i];
        config_cmd["id"] = ++cmd_id_;
        sensor_->write(config_cmd);
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        spdlog::info("SensorService: 重连恢复 - config {}/{} 已发送", 
                    i + 1, cached_heater_configs_.size());
    }
    
    // 4. 如果之前在采集中，重发 start 命令
    if (cached_sensor_running_) {
        nlohmann::json start_cmd;
        start_cmd["cmd"] = "start";
        start_cmd["id"] = ++cmd_id_;
        if (!cached_active_sensors_.empty()) {
            start_cmd["params"]["sensors"] = cached_active_sensors_;
        } else {
            start_cmd["params"]["sensors"] = {0, 1, 2, 3, 4, 5, 6, 7};
        }
        sensor_->write(start_cmd);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        running_ = true;
        spdlog::info("SensorService: 重连恢复 - start 已发送，传感器采集已恢复");
    }
    
    spdlog::info("SensorService: 固件状态恢复完成");
}

// ============================================================
// 传感器状态缓存
// ============================================================

void SensorServiceImpl::cache_heater_config(const nlohmann::json& config_cmd) {
    std::lock_guard<std::mutex> lock(state_cache_mutex_);
    cached_heater_configs_.push_back(config_cmd);
    spdlog::debug("SensorService: 缓存 heater config (共 {} 条)", cached_heater_configs_.size());
}

void SensorServiceImpl::cache_heater_configs(const std::vector<nlohmann::json>& configs) {
    std::lock_guard<std::mutex> lock(state_cache_mutex_);
    cached_heater_configs_ = configs;
    spdlog::debug("SensorService: 替换缓存 heater configs (共 {} 条)", configs.size());
}

void SensorServiceImpl::cache_sensor_started(const std::vector<int>& active_sensors) {
    std::lock_guard<std::mutex> lock(state_cache_mutex_);
    cached_sensor_running_ = true;
    cached_active_sensors_ = active_sensors;
    spdlog::debug("SensorService: 缓存 sensor started (活跃传感器: {} 个)", active_sensors.size());
}

void SensorServiceImpl::cache_sensor_stopped() {
    std::lock_guard<std::mutex> lock(state_cache_mutex_);
    cached_sensor_running_ = false;
    cached_active_sensors_.clear();
    spdlog::debug("SensorService: 缓存 sensor stopped");
}

void SensorServiceImpl::clear_state_cache() {
    std::lock_guard<std::mutex> lock(state_cache_mutex_);
    cached_heater_configs_.clear();
    cached_sensor_running_ = false;
    cached_active_sensors_.clear();
    spdlog::debug("SensorService: 清除状态缓存");
}

} // namespace enose_grpc
