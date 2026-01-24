#pragma once

#include <string>
#include <optional>
#include <nlohmann/json.hpp>

namespace core {

// 数据库连接配置
struct DatabaseConfig {
    bool enabled = true;
    std::string host = "localhost";
    int port = 5432;
    std::string database = "enose";
    std::string user = "enose";
    std::string password;
    std::string ssl_mode;
    int pool_size = 5;
    int connect_timeout_sec = 10;
    
    // 生成连接字符串
    std::string connection_string() const {
        std::string conn = "host=" + host + 
                          " port=" + std::to_string(port) +
                          " dbname=" + database +
                          " user=" + user +
                          " password=" + password;
        if (!ssl_mode.empty()) {
            conn += " sslmode=" + ssl_mode;
        }
        return conn;
    }
};

// Redis 连接配置
struct RedisConfig {
    bool enabled = true;
    std::string host = "localhost";
    int port = 6379;
    std::string password;
    int database = 0;
    int pool_size = 3;
};

// GPU Worker 配置 (局域网推理服务)
struct GpuWorkerConfig {
    std::string host;
    int port = 8000;
    std::string api_path = "/api/inference";
    
    std::string url() const {
        return "http://" + host + ":" + std::to_string(port) + api_path;
    }
};

// 本地服务配置
struct LocalConfig {
    DatabaseConfig timescaledb;
    RedisConfig redis;
};

// 云端配置
struct CloudConfig {
    bool enabled = false;
    DatabaseConfig timescaledb;
};

// 局域网配置
struct LanConfig {
    bool enabled = false;
    GpuWorkerConfig gpu_worker;
    DatabaseConfig timescaledb;
};

// gRPC 服务配置
struct GrpcConfig {
    std::string host = "0.0.0.0";
    int port = 50051;
    
    std::string address() const {
        return host + ":" + std::to_string(port);
    }
};

// 传感器配置
struct SensorConfig {
    std::string serial_port = "/dev/ttyUSB0";
    int baud_rate = 115200;
    int channels = 16;
    int sample_rate_hz = 10;
};

// 执行器配置
struct ActuatorConfig {
    std::string moonraker_host = "127.0.0.1";
    int moonraker_port = 7125;
};

// 数据管线配置
struct DataPipelineConfig {
    int buffer_size = 1000;
    int batch_write_interval_ms = 100;
    std::string redis_stream_name = "sensor_data";
    int redis_stream_max_len = 10000;
    bool dual_write_enabled = false;
};

// 日志配置
struct LoggingConfig {
    std::string level = "info";
    std::string file = "/var/log/enose-control/enose.log";
    int max_size_mb = 100;
    int max_files = 5;
};

// 主配置类
class Config {
public:
    // 单例访问
    static Config& instance();
    
    // 加载配置文件
    bool load(const std::string& config_path);
    
    // 重新加载配置
    bool reload();
    
    // 获取配置路径
    const std::string& config_path() const { return config_path_; }
    
    // 各模块配置
    LocalConfig local;
    CloudConfig cloud;
    LanConfig lan;
    GrpcConfig grpc;
    SensorConfig sensor;
    ActuatorConfig actuator;
    DataPipelineConfig data_pipeline;
    LoggingConfig logging;

private:
    Config() = default;
    Config(const Config&) = delete;
    Config& operator=(const Config&) = delete;
    
    void parse_json(const nlohmann::json& j);
    
    std::string config_path_;
};

// JSON 序列化支持
void from_json(const nlohmann::json& j, DatabaseConfig& c);
void from_json(const nlohmann::json& j, RedisConfig& c);
void from_json(const nlohmann::json& j, GpuWorkerConfig& c);
void from_json(const nlohmann::json& j, LocalConfig& c);
void from_json(const nlohmann::json& j, CloudConfig& c);
void from_json(const nlohmann::json& j, LanConfig& c);
void from_json(const nlohmann::json& j, GrpcConfig& c);
void from_json(const nlohmann::json& j, SensorConfig& c);
void from_json(const nlohmann::json& j, ActuatorConfig& c);
void from_json(const nlohmann::json& j, DataPipelineConfig& c);
void from_json(const nlohmann::json& j, LoggingConfig& c);

} // namespace core
