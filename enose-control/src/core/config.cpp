#include "config.hpp"
#include <fstream>
#include <spdlog/spdlog.h>

namespace core {

// JSON 反序列化实现
void from_json(const nlohmann::json& j, DatabaseConfig& c) {
    if (j.contains("enabled")) j.at("enabled").get_to(c.enabled);
    if (j.contains("host")) j.at("host").get_to(c.host);
    if (j.contains("port")) j.at("port").get_to(c.port);
    if (j.contains("database")) j.at("database").get_to(c.database);
    if (j.contains("user")) j.at("user").get_to(c.user);
    if (j.contains("password")) j.at("password").get_to(c.password);
    if (j.contains("ssl_mode")) j.at("ssl_mode").get_to(c.ssl_mode);
    if (j.contains("pool_size")) j.at("pool_size").get_to(c.pool_size);
    if (j.contains("connect_timeout_sec")) j.at("connect_timeout_sec").get_to(c.connect_timeout_sec);
}

void from_json(const nlohmann::json& j, RedisConfig& c) {
    if (j.contains("enabled")) j.at("enabled").get_to(c.enabled);
    if (j.contains("host")) j.at("host").get_to(c.host);
    if (j.contains("port")) j.at("port").get_to(c.port);
    if (j.contains("password")) j.at("password").get_to(c.password);
    if (j.contains("database")) j.at("database").get_to(c.database);
    if (j.contains("pool_size")) j.at("pool_size").get_to(c.pool_size);
}

void from_json(const nlohmann::json& j, GpuWorkerConfig& c) {
    if (j.contains("host")) j.at("host").get_to(c.host);
    if (j.contains("port")) j.at("port").get_to(c.port);
    if (j.contains("api_path")) j.at("api_path").get_to(c.api_path);
}

void from_json(const nlohmann::json& j, LocalConfig& c) {
    if (j.contains("timescaledb")) j.at("timescaledb").get_to(c.timescaledb);
    if (j.contains("redis")) j.at("redis").get_to(c.redis);
}

void from_json(const nlohmann::json& j, CloudConfig& c) {
    if (j.contains("enabled")) j.at("enabled").get_to(c.enabled);
    if (j.contains("timescaledb")) j.at("timescaledb").get_to(c.timescaledb);
}

void from_json(const nlohmann::json& j, LanConfig& c) {
    if (j.contains("enabled")) j.at("enabled").get_to(c.enabled);
    if (j.contains("gpu_worker")) j.at("gpu_worker").get_to(c.gpu_worker);
    if (j.contains("timescaledb")) j.at("timescaledb").get_to(c.timescaledb);
}

void from_json(const nlohmann::json& j, GrpcConfig& c) {
    if (j.contains("host")) j.at("host").get_to(c.host);
    if (j.contains("port")) j.at("port").get_to(c.port);
}

void from_json(const nlohmann::json& j, SensorConfig& c) {
    if (j.contains("serial_port")) j.at("serial_port").get_to(c.serial_port);
    if (j.contains("baud_rate")) j.at("baud_rate").get_to(c.baud_rate);
    if (j.contains("channels")) j.at("channels").get_to(c.channels);
    if (j.contains("sample_rate_hz")) j.at("sample_rate_hz").get_to(c.sample_rate_hz);
}

void from_json(const nlohmann::json& j, ActuatorConfig& c) {
    if (j.contains("moonraker_host")) j.at("moonraker_host").get_to(c.moonraker_host);
    if (j.contains("moonraker_port")) j.at("moonraker_port").get_to(c.moonraker_port);
}

void from_json(const nlohmann::json& j, DataPipelineConfig& c) {
    if (j.contains("buffer_size")) j.at("buffer_size").get_to(c.buffer_size);
    if (j.contains("batch_write_interval_ms")) j.at("batch_write_interval_ms").get_to(c.batch_write_interval_ms);
    if (j.contains("redis_stream_name")) j.at("redis_stream_name").get_to(c.redis_stream_name);
    if (j.contains("redis_stream_max_len")) j.at("redis_stream_max_len").get_to(c.redis_stream_max_len);
    if (j.contains("dual_write_enabled")) j.at("dual_write_enabled").get_to(c.dual_write_enabled);
}

void from_json(const nlohmann::json& j, LoggingConfig& c) {
    if (j.contains("level")) j.at("level").get_to(c.level);
    if (j.contains("file")) j.at("file").get_to(c.file);
    if (j.contains("max_size_mb")) j.at("max_size_mb").get_to(c.max_size_mb);
    if (j.contains("max_files")) j.at("max_files").get_to(c.max_files);
}

// Config 单例实现
Config& Config::instance() {
    static Config instance;
    return instance;
}

bool Config::load(const std::string& config_path) {
    config_path_ = config_path;
    
    std::ifstream file(config_path);
    if (!file.is_open()) {
        spdlog::error("Config: Failed to open config file: {}", config_path);
        return false;
    }
    
    try {
        nlohmann::json j;
        file >> j;
        parse_json(j);
        spdlog::info("Config: Loaded configuration from {}", config_path);
        return true;
    }
    catch (const std::exception& e) {
        spdlog::error("Config: Failed to parse config file: {}", e.what());
        return false;
    }
}

bool Config::reload() {
    if (config_path_.empty()) {
        spdlog::error("Config: No config file path set");
        return false;
    }
    return load(config_path_);
}

void Config::parse_json(const nlohmann::json& j) {
    if (j.contains("local")) j.at("local").get_to(local);
    if (j.contains("cloud")) j.at("cloud").get_to(cloud);
    if (j.contains("lan")) j.at("lan").get_to(lan);
    if (j.contains("grpc")) j.at("grpc").get_to(grpc);
    if (j.contains("sensor")) j.at("sensor").get_to(sensor);
    if (j.contains("actuator")) j.at("actuator").get_to(actuator);
    if (j.contains("data_pipeline")) j.at("data_pipeline").get_to(data_pipeline);
    if (j.contains("logging")) j.at("logging").get_to(logging);
}

} // namespace core
