#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <vector>
#include <limits>

namespace workflows {

// ============================================================
// 加热器分组配置 (实验启动时从 ConfigureHeaterAction 解析)
// ============================================================
struct HeaterGroupConfig {
    std::string profile_name;
    std::vector<int> sensor_indices;
    std::vector<int> temps;   // 温度序列 (°C)
    std::vector<int> durs;    // 持续时间 (×140ms)
};

// ============================================================
// 质量告警
// ============================================================
struct QualityAlert {
    std::string id;           // 唯一标识 (用于去重合并)
    std::string flag;         // SENSOR_DEAD / CYCLE_BROKEN / LOW_REPRODUCIBILITY / ...
    std::string severity;     // INFO / WARNING / ERROR
    std::string message;
    int sensor_idx{-1};       // -1=全局
    int heater_step{-1};      // -1=全局
    double value{0.0};
    double threshold{0.0};
    int64_t first_seen_ms{0};
    int64_t last_seen_ms{0};
    int count{1};
};

// ============================================================
// 单传感器健康状态
// ============================================================
struct SensorHealthInfo {
    int sensor_idx{0};
    bool alive{false};
    int completed_cycles{0};
    double cycle_cv{0.0};        // 周期可重复性 CV (最差的 step)
    bool saturated{false};
    double response_ratio{0.0};  // 相对基线的响应比
    std::string heater_profile;
};

// ============================================================
// 质量快照 (用于实时查询)
// ============================================================
struct QualitySnapshot {
    int overall_level{0};        // 0=UNKNOWN,1=GOOD,2=WARNING,3=POOR
    double quality_score{100.0};
    int active_alert_count{0};
    std::vector<QualityAlert> alerts;
    std::vector<SensorHealthInfo> sensor_health;
    double current_temp_c{0.0};
    double current_humidity_pct{0.0};
    bool env_stable{true};
    int completed_cycles{0};
    double mean_cycle_cv{0.0};
};

// ============================================================
// 质量汇总 (样本结束时生成)
// ============================================================
struct QualitySummary {
    double score{100.0};
    std::string level;   // "good" / "warning" / "poor"
    std::string report_json;  // 完整 JSON 报告
};

// ============================================================
// 常量
// ============================================================
static constexpr int NUM_SENSORS = 8;
static constexpr int NUM_HEATER_STEPS = 10;
static constexpr int CYCLE_HISTORY_SIZE = 10;  // 保留最近 N 个周期的值

// 饱和阈值 (BME688 物理极限)
static constexpr double SATURATION_LOW = 10.0;          // Ω
static constexpr double SATURATION_HIGH = 10000000.0;   // 10 MΩ

// 环境参数范围
static constexpr double ENV_TEMP_MIN = 15.0;   // °C
static constexpr double ENV_TEMP_MAX = 40.0;
static constexpr double ENV_HUMIDITY_MIN = 10.0;  // %
static constexpr double ENV_HUMIDITY_MAX = 90.0;

// 环境变化速率阈值 (per minute)
static constexpr double ENV_TEMP_RATE_MAX = 2.0;      // °C/min
static constexpr double ENV_HUMIDITY_RATE_MAX = 10.0;  // %/min

// 周期可重复性阈值
static constexpr double BASELINE_CV_THRESHOLD = 0.05;   // 5%

// 存活检测超时 (ms)
static constexpr int64_t LIVENESS_TIMEOUT_MS = 15000;  // 15s (~2 个完整加热周期)

// 响应检测阈值
static constexpr double RESPONSE_WEAK_THRESHOLD = 0.05;  // 5% 变化

// ============================================================
// DataQualityMonitor
// 加热周期感知 + 阶段感知的实时数据质量监控器
// ============================================================
class DataQualityMonitor {
public:
    DataQualityMonitor() = default;

    // 实验启动时：传入传感器加热配置分组
    void initialize(const std::vector<HeaterGroupConfig>& groups);

    // 阶段切换时调用
    void on_phase_change(const std::string& phase_name);

    // 每个传感器读数到达时调用
    void on_reading(int sensor_idx, int heater_step, double value,
                    double temperature, double humidity, double pressure,
                    int64_t time_ms);

    // 获取实时质量快照
    QualitySnapshot get_snapshot() const;

    // 样本结束时：生成质量报告
    QualitySummary finalize_sample();

    // 重置（新样本开始）
    void reset_for_new_sample();

    // 完全重置（新实验开始）
    void reset();

private:
    // ============================================================
    // 每步追踪器
    // ============================================================
    struct StepTracker {
        std::deque<double> cycle_values;  // 最近 N 周期的值
        double baseline_value{std::numeric_limits<double>::quiet_NaN()};
        int64_t last_seen_ms{0};
        double latest_value{0.0};
        
        void add_cycle_value(double v) {
            cycle_values.push_back(v);
            while (cycle_values.size() > CYCLE_HISTORY_SIZE) {
                cycle_values.pop_front();
            }
        }
        
        // 周期间变异系数
        double compute_cv() const {
            if (cycle_values.size() < 3) return 0.0;
            double sum = 0.0, sum2 = 0.0;
            for (double v : cycle_values) {
                sum += v;
                sum2 += v * v;
            }
            double n = static_cast<double>(cycle_values.size());
            double mean = sum / n;
            if (mean <= 0.0) return 0.0;
            double var = (sum2 / n) - (mean * mean);
            if (var < 0.0) var = 0.0;
            return std::sqrt(var) / mean;
        }
        
        bool has_baseline() const {
            return !std::isnan(baseline_value);
        }
    };

    // ============================================================
    // 传感器追踪器
    // ============================================================
    struct SensorTracker {
        StepTracker steps[NUM_HEATER_STEPS];
        int expected_next_step{0};
        int64_t last_any_reading_ms{0};
        int completed_cycles{0};
        int total_readings{0};
        int missing_steps{0};        // 跳过的步数
        int stuck_count{0};          // 卡步计数
        bool saturated_now{false};
        std::string heater_profile;  // 配置名称
        
        // 跟踪当前周期已见到的步
        bool current_cycle_steps_seen[NUM_HEATER_STEPS] = {};
        
        void reset() {
            for (auto& s : steps) {
                s.cycle_values.clear();
                s.baseline_value = std::numeric_limits<double>::quiet_NaN();
                s.last_seen_ms = 0;
                s.latest_value = 0.0;
            }
            expected_next_step = 0;
            last_any_reading_ms = 0;
            completed_cycles = 0;
            total_readings = 0;
            missing_steps = 0;
            stuck_count = 0;
            saturated_now = false;
            std::fill(std::begin(current_cycle_steps_seen), std::end(current_cycle_steps_seen), false);
        }
    };

    // ============================================================
    // 环境追踪器
    // ============================================================
    struct EnvTracker {
        std::deque<std::pair<int64_t, double>> temp_history;    // (time_ms, value)
        std::deque<std::pair<int64_t, double>> humidity_history;
        double latest_temp{0.0};
        double latest_humidity{0.0};
        static constexpr size_t MAX_ENV_HISTORY = 120;  // ~2 分钟
        
        void add(double temp, double humidity, int64_t time_ms) {
            latest_temp = temp;
            latest_humidity = humidity;
            temp_history.push_back({time_ms, temp});
            humidity_history.push_back({time_ms, humidity});
            while (temp_history.size() > MAX_ENV_HISTORY) temp_history.pop_front();
            while (humidity_history.size() > MAX_ENV_HISTORY) humidity_history.pop_front();
        }
        
        // 计算变化速率 (per minute)
        double temp_rate() const { return compute_rate(temp_history); }
        double humidity_rate() const { return compute_rate(humidity_history); }
        
        bool is_stable() const;
        
        void reset() {
            temp_history.clear();
            humidity_history.clear();
            latest_temp = 0.0;
            latest_humidity = 0.0;
        }
        
    private:
        static double compute_rate(const std::deque<std::pair<int64_t, double>>& history);
    };

    // ============================================================
    // 内部方法
    // ============================================================
    
    // 检测项
    void check_liveness(int64_t now_ms);
    void check_cycle_integrity(int sensor_idx, int heater_step);
    void check_saturation(int sensor_idx, double value);
    void check_environment(double temperature, double humidity, int64_t time_ms);
    void check_reproducibility();
    void check_group_consistency();
    void check_response();
    void check_data_completeness();
    
    // 告警管理
    void raise_alert(const std::string& flag, const std::string& severity,
                     const std::string& message, int sensor_idx, int heater_step,
                     double value, double threshold, int64_t time_ms);
    void clear_alert(const std::string& alert_id);
    std::string make_alert_id(const std::string& flag, int sensor_idx, int heater_step) const;
    
    // 锚定基线
    void anchor_baseline();
    
    // 评分
    double compute_score() const;
    std::string compute_level(double score) const;
    int compute_overall_level() const;
    
    // 阶段判断
    bool is_phase(const std::string& name) const;
    bool is_baseline_phase() const;
    bool is_sample_phase() const;
    bool is_preheat_phase() const;
    bool is_recovery_phase() const;
    
    // ============================================================
    // 状态
    // ============================================================
    mutable std::mutex mutex_;
    bool initialized_{false};
    std::string current_phase_;
    std::string previous_phase_;
    
    std::array<SensorTracker, NUM_SENSORS> sensors_;
    EnvTracker env_;
    
    // 传感器分组
    std::vector<HeaterGroupConfig> groups_;
    
    // 活跃告警
    std::map<std::string, QualityAlert> active_alerts_;
    
    // 统计
    int64_t first_reading_ms_{0};
    int total_readings_{0};
    int saturation_count_{0};
    int env_alert_count_{0};
    int broken_cycles_{0};
    
    // 周期检测计数器 (用于定期触发检查)
    int reading_counter_{0};
};

} // namespace workflows
