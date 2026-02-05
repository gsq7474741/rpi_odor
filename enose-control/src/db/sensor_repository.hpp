#pragma once

#include "connection_pool.hpp"
#include <optional>
#include <vector>
#include <chrono>
#include <string>
#include <mutex>
#include <atomic>
#include <thread>
#include <condition_variable>

namespace db {

// ============================================================
// 传感器读数记录 (对应 sensor_readings_v2 表)
// ============================================================
struct SensorReadingRecord {
    int64_t time_ms{0};           // 主机接收时间 (Unix 毫秒)
    int64_t device_tick_ms{0};    // 设备原始 tick
    int16_t sensor_idx{0};        // 传感器索引 0-7
    int32_t sensor_id{0};         // 传感器硬件 ID
    int16_t sensor_type{0};       // 0=mox_d, 1=mox_a, 2=pid
    double value{0.0};            // 主读数
    std::optional<float> temperature;
    std::optional<float> humidity;
    std::optional<float> pressure;
    std::optional<int16_t> heater_step;
    std::optional<int32_t> run_id;
    std::optional<std::string> phase_name;
    std::optional<int32_t> sample_id;  // 样本 ID (用于聚合分析)
};

// ============================================================
// 传感器元数据记录 (对应 sensor_metadata 表)
// ============================================================
struct SensorMetadataRecord {
    int32_t sensor_id{0};
    int16_t sensor_idx{0};
    std::string device_id{"default"};
    int16_t sensor_type{0};
    std::vector<int16_t> heater_temps;   // 加热器温度序列 (°C)
    std::vector<int16_t> heater_durs;    // 加热器持续时间 (×140ms)
    int16_t heater_length{0};            // 加热器步数
    std::optional<float> adc_vref;
    std::optional<int16_t> adc_sample_rate;
    std::optional<int16_t> adc_gain;
    std::string notes;
};

// ============================================================
// 加热配置预设记录 (对应 heater_profiles 表)
// ============================================================
struct HeaterProfileRecord {
    int32_t id{0};
    std::string name;
    std::string description;
    std::vector<int16_t> temps;          // 温度序列 (°C)
    std::vector<int16_t> durs;           // 持续时间 (×140ms)
    std::string preheat_mode{"cycles"};  // "cycles" 或 "duration"
    std::optional<int16_t> preheat_cycles;      // 预热周期数 (恒温模式)
    std::optional<int16_t> preheat_duration_s;  // 预热时间秒 (温度扫描模式)
    bool is_builtin{false};
};

// ============================================================
// 传感器加热配置分配记录 (对应 sensor_heater_assignments 表)
// ============================================================
struct HeaterAssignmentRecord {
    int32_t id{0};
    int64_t start_time_ms{0};            // 配置生效开始时间
    std::optional<int64_t> end_time_ms;  // 配置结束时间 (NULL=当前活跃)
    int16_t sensor_idx{0};
    std::optional<int32_t> heater_profile_id;
    std::vector<int16_t> temps_snapshot;  // 实际使用的配置快照
    std::vector<int16_t> durs_snapshot;
    std::optional<int32_t> run_id;
    std::optional<std::string> phase_name;
    std::string notes;
};

// ============================================================
// 加热周期聚合记录 (对应 sensor_heater_cycles 视图)
// ============================================================
struct HeaterCycleStats {
    int64_t bucket_ms{0};
    std::optional<int32_t> run_id;
    int16_t sensor_idx{0};
    int16_t heater_step{0};
    int64_t sample_count{0};
    double mean_value{0.0};
    std::optional<double> std_value;
    double min_value{0.0};
    double max_value{0.0};
    double first_value{0.0};
    double last_value{0.0};
    std::optional<double> avg_temp;
    std::optional<double> avg_humidity;
    std::optional<double> avg_pressure;
};

// ============================================================
// 传感器类型枚举
// ============================================================
enum class SensorType : int16_t {
    MOX_DIGITAL = 0,
    MOX_ANALOG = 1,
    PID = 2,
    UNKNOWN = -1
};

// 字符串转传感器类型
inline SensorType sensor_type_from_string(const std::string& s) {
    if (s == "mox_d") return SensorType::MOX_DIGITAL;
    if (s == "mox_a") return SensorType::MOX_ANALOG;
    if (s == "pid") return SensorType::PID;
    return SensorType::UNKNOWN;
}

// ============================================================
// 传感器数据仓库
// 支持高吞吐批量写入和 ML 友好的查询接口
// ============================================================
class SensorRepository {
public:
    SensorRepository();
    ~SensorRepository();
    
    // 禁止拷贝
    SensorRepository(const SensorRepository&) = delete;
    SensorRepository& operator=(const SensorRepository&) = delete;
    
    // ============================================================
    // 写入接口
    // ============================================================
    
    // 缓冲写入 (非阻塞, 自动批量刷新)
    void buffer_insert(const SensorReadingRecord& record);
    
    // 立即刷新缓冲区到数据库
    void flush();
    
    // 设置运行上下文 (用于自动填充 run_id 和 phase_name)
    // 当设置有效 run_id 时自动启用持久化
    void set_run_context(std::optional<int32_t> run_id, const std::string& phase_name = "");
    void clear_run_context();
    
    // 检查是否应该持久化数据 (有有效的 run_id 时返回 true)
    bool should_persist() const;
    
    // 设置样本上下文 (用于自动填充 sample_id)
    void set_sample_context(int32_t sample_id);
    void clear_sample_context();
    
    // ============================================================
    // 查询接口
    // ============================================================
    
    // 按时间范围查询
    std::vector<SensorReadingRecord> query_by_time_range(
        int64_t start_ms,
        int64_t end_ms,
        std::optional<int16_t> sensor_idx = std::nullopt,
        int limit = 10000);
    
    // 按 run_id 查询
    std::vector<SensorReadingRecord> query_by_run(
        int32_t run_id,
        std::optional<int64_t> start_ms = std::nullopt,
        std::optional<int64_t> end_ms = std::nullopt,
        std::optional<int16_t> sensor_idx = std::nullopt);
    
    // 按加热周期查询 (用于 ML 特征提取)
    std::vector<SensorReadingRecord> query_by_heater_cycle(
        int32_t run_id,
        int16_t sensor_idx,
        int16_t heater_step,
        std::optional<int64_t> start_ms = std::nullopt,
        std::optional<int64_t> end_ms = std::nullopt);
    
    // 获取加热周期聚合统计 (从连续聚合视图)
    std::vector<HeaterCycleStats> query_heater_cycle_stats(
        int32_t run_id,
        std::optional<int16_t> sensor_idx = std::nullopt,
        std::optional<int16_t> heater_step = std::nullopt);
    
    // ============================================================
    // 元数据管理
    // ============================================================
    
    void upsert_sensor_metadata(const SensorMetadataRecord& meta);
    std::optional<SensorMetadataRecord> get_sensor_metadata(int32_t sensor_id);
    std::vector<SensorMetadataRecord> list_sensor_metadata(const std::string& device_id = "");
    
    // ============================================================
    // 加热配置管理
    // ============================================================
    
    // 加热预设 CRUD
    int32_t create_heater_profile(const HeaterProfileRecord& profile);
    bool update_heater_profile(const HeaterProfileRecord& profile);
    bool delete_heater_profile(int32_t id);
    std::optional<HeaterProfileRecord> get_heater_profile(int32_t id);
    std::optional<HeaterProfileRecord> get_heater_profile_by_name(const std::string& name);
    std::vector<HeaterProfileRecord> list_heater_profiles(bool include_builtin = true);
    
    // 传感器加热配置分配
    int32_t start_heater_assignment(
        int16_t sensor_idx,
        const HeaterProfileRecord& profile,
        std::optional<int32_t> run_id = std::nullopt,
        const std::string& phase_name = "");
    
    void end_heater_assignment(int32_t assignment_id);
    void end_active_assignments(int16_t sensor_idx);
    
    std::optional<HeaterAssignmentRecord> get_active_assignment(int16_t sensor_idx);
    std::vector<HeaterAssignmentRecord> get_assignments_in_range(
        int64_t start_ms, int64_t end_ms,
        std::optional<int16_t> sensor_idx = std::nullopt);
    
    // ============================================================
    // 统计接口
    // ============================================================
    
    // 获取数据计数
    int64_t count_readings(
        std::optional<int32_t> run_id = std::nullopt,
        std::optional<int64_t> start_ms = std::nullopt,
        std::optional<int64_t> end_ms = std::nullopt);
    
    // 获取时间范围
    std::pair<int64_t, int64_t> get_time_range(std::optional<int32_t> run_id = std::nullopt);
    
    // ============================================================
    // 配置
    // ============================================================
    
    // 设置批量大小 (默认 100)
    void set_batch_size(size_t size) { batch_size_ = size; }
    
    // 设置自动刷新间隔 (默认 1000ms)
    void set_flush_interval_ms(int64_t ms) { flush_interval_ms_ = ms; }
    
    // 启动/停止后台刷新线程
    void start_background_flush();
    void stop_background_flush();
    
private:
    // 批量写入实现 (使用 COPY 协议)
    bool do_batch_insert(const std::vector<SensorReadingRecord>& records);
    
    // 后台刷新线程
    void flush_thread_func();
    
    // 写入缓冲区
    std::vector<SensorReadingRecord> write_buffer_;
    std::mutex buffer_mutex_;
    
    // 运行上下文
    std::optional<int32_t> current_run_id_;
    std::string current_phase_;
    std::optional<int32_t> current_sample_id_;  // 样本 ID
    mutable std::mutex context_mutex_;
    
    // 配置
    size_t batch_size_{100};
    int64_t flush_interval_ms_{1000};
    
    // 后台刷新线程
    std::thread flush_thread_;
    std::atomic<bool> flush_running_{false};
    std::condition_variable flush_cv_;
    std::mutex flush_mutex_;
};

} // namespace db
