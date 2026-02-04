#pragma once

#include "connection_pool.hpp"
#include <nlohmann/json.hpp>
#include <optional>
#include <vector>
#include <string>
#include <cstdint>

namespace db {

// ============================================================
// 液体成分信息
// ============================================================
struct LiquidInfo {
    std::string id;
    std::string name;
    double ratio{0.0};
    int32_t pump_index{-1};
    
    nlohmann::json to_json() const {
        return {
            {"id", id},
            {"name", name},
            {"ratio", ratio},
            {"pump_index", pump_index}
        };
    }
};

// ============================================================
// 加热器配置信息
// ============================================================
struct HeaterConfigInfo {
    std::vector<int32_t> sensor_indices;
    std::string profile_name;
    std::vector<int32_t> temps;
    std::vector<int32_t> durs;
    
    nlohmann::json to_json() const {
        return {
            {"sensor_indices", sensor_indices},
            {"profile_name", profile_name},
            {"temps", temps},
            {"durs", durs}
        };
    }
};

// ============================================================
// 样本上下文 - 收集所有影响实验结果的参数
// ============================================================
struct SampleContext {
    int32_t sample_id{-1};
    int32_t sample_idx{0};
    int64_t start_time_ms{0};
    int64_t end_time_ms{0};
    std::string params_hash;
    
    // A. 液体参数 (0-8 种)
    std::vector<LiquidInfo> liquids;
    double total_volume_ml{0.0};
    double flow_rate_ml_s{0.0};
    
    // B. 采集参数
    int32_t gas_pump_pwm{0};
    std::string termination_type;  // "duration", "cycles", "stability"
    double termination_value{0.0};
    double max_duration_s{0.0};
    
    // C. 加热器配置 (0-8 个传感器)
    std::vector<HeaterConfigInfo> heater_configs;
    
    // D. 清洗参数
    int32_t pre_wash_count{0};
    double pre_wash_volume_ml{0.0};
    std::string wash_liquid_id;
    
    // E. 阶段信息
    std::string phase_name;
    
    // F. 环境参数 (采集结束后计算)
    double avg_temperature_c{0.0};
    double avg_humidity_pct{0.0};
    double avg_pressure_hpa{0.0};
    
    // 序列化为完整参数 JSON
    nlohmann::json to_params_json() const;
    
    // 计算参数哈希 (用于聚合)
    std::string compute_hash() const;
    
    // 重置液体参数（下次进样时会更新）
    void reset_liquids() {
        liquids.clear();
        total_volume_ml = 0.0;
        flow_rate_ml_s = 0.0;
    }
    
    // 重置清洗计数
    void reset_wash_count() {
        pre_wash_count = 0;
        pre_wash_volume_ml = 0.0;
    }
};

// ============================================================
// 样本记录（从数据库读取）
// ============================================================
struct SampleRecord {
    int32_t id{0};
    int32_t run_id{0};
    int32_t sample_idx{0};
    int64_t start_time_ms{0};
    int64_t end_time_ms{0};
    std::string params_hash;
    
    // 液体参数
    std::vector<std::string> liquid_ids;
    std::vector<std::string> liquid_names;
    std::vector<double> liquid_ratios;
    std::vector<int16_t> pump_indices;
    double total_volume_ml{0.0};
    double flow_rate_ml_s{0.0};
    
    // 采集参数
    int16_t gas_pump_pwm{0};
    std::string termination_type;
    double termination_value{0.0};
    double max_duration_s{0.0};
    
    // 加热器配置
    std::string heater_configs_json;
    
    // 清洗参数
    int16_t pre_wash_count{0};
    double pre_wash_volume_ml{0.0};
    std::string wash_liquid_id;
    
    // 阶段
    std::string phase_name;
    
    // 环境参数
    double avg_temperature_c{0.0};
    double avg_humidity_pct{0.0};
    double avg_pressure_hpa{0.0};
    
    // 完整参数 JSON
    std::string params_json;
};

// ============================================================
// 环境统计
// ============================================================
struct EnvironmentStats {
    double avg_temp{0.0};
    double avg_humidity{0.0};
    double avg_pressure{0.0};
};

// ============================================================
// 样本仓库
// ============================================================
class SampleRepository {
public:
    SampleRepository() = default;
    
    // 创建样本记录（采集开始时调用）
    // 返回新创建的 sample_id
    std::optional<int32_t> create_sample(
        int32_t run_id,
        int32_t sample_idx,
        const SampleContext& ctx);
    
    // 完成样本记录（采集结束时调用）
    // 更新 end_time_ms 和环境参数
    bool complete_sample(
        int32_t sample_id,
        int64_t end_time_ms,
        const SampleContext& ctx);
    
    // 获取单个样本
    std::optional<SampleRecord> get_sample(int32_t sample_id);
    
    // 获取 run 的所有样本
    std::vector<SampleRecord> get_samples_by_run(int32_t run_id);
    
    // 按参数哈希查找样本（用于聚合）
    std::vector<SampleRecord> get_samples_by_hash(const std::string& params_hash);
    
    // 获取环境统计（用于计算平均值）
    EnvironmentStats get_environment_stats(int64_t start_time_ms, int64_t end_time_ms);
    
    // 删除样本
    bool delete_sample(int32_t sample_id);
    
    // 删除 run 的所有样本
    bool delete_samples_by_run(int32_t run_id);
    
private:
    // 辅助函数：将 vector 转换为 PostgreSQL 数组字符串
    template<typename T>
    std::string to_pg_array(const std::vector<T>& vec);
    
    // 辅助函数：解析 PostgreSQL 数组字符串
    std::vector<std::string> parse_pg_text_array(const std::string& arr);
    std::vector<double> parse_pg_double_array(const std::string& arr);
    std::vector<int16_t> parse_pg_int16_array(const std::string& arr);
};

} // namespace db
