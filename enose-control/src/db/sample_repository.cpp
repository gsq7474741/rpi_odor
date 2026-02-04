#include "sample_repository.hpp"
#include <spdlog/spdlog.h>
#include <pqxx/pqxx>
#include <sstream>
#include <iomanip>
#include <openssl/sha.h>

namespace db {

// ============================================================
// SampleContext 实现
// ============================================================

nlohmann::json SampleContext::to_params_json() const {
    nlohmann::json j;
    
    // A. 液体参数
    nlohmann::json liquids_arr = nlohmann::json::array();
    for (const auto& liq : liquids) {
        liquids_arr.push_back(liq.to_json());
    }
    j["liquids"] = liquids_arr;
    j["total_volume_ml"] = total_volume_ml;
    j["flow_rate_ml_s"] = flow_rate_ml_s;
    
    // B. 采集参数
    j["gas_pump_pwm"] = gas_pump_pwm;
    j["termination_type"] = termination_type;
    j["termination_value"] = termination_value;
    j["max_duration_s"] = max_duration_s;
    
    // C. 加热器配置
    nlohmann::json heater_arr = nlohmann::json::array();
    for (const auto& cfg : heater_configs) {
        heater_arr.push_back(cfg.to_json());
    }
    j["heater_configs"] = heater_arr;
    
    // D. 清洗参数
    j["pre_wash_count"] = pre_wash_count;
    j["pre_wash_volume_ml"] = pre_wash_volume_ml;
    j["wash_liquid_id"] = wash_liquid_id;
    
    // E. 阶段
    j["phase_name"] = phase_name;
    
    return j;
}

std::string SampleContext::compute_hash() const {
    // 构建用于哈希的规范化参数
    nlohmann::json hash_params;
    
    // A. 液体参数（按 ID 排序）
    std::vector<nlohmann::json> sorted_liquids;
    for (const auto& liq : liquids) {
        sorted_liquids.push_back({
            {"id", liq.id},
            {"ratio", std::round(liq.ratio * 10000) / 10000}  // 4位小数
        });
    }
    std::sort(sorted_liquids.begin(), sorted_liquids.end(),
              [](const nlohmann::json& a, const nlohmann::json& b) {
                  return a["id"].get<std::string>() < b["id"].get<std::string>();
              });
    hash_params["liquids"] = sorted_liquids;
    hash_params["volume_ml"] = std::round(total_volume_ml * 100) / 100;
    hash_params["flow_rate"] = std::round(flow_rate_ml_s * 100) / 100;
    
    // B. 采集参数
    hash_params["pwm"] = gas_pump_pwm;
    hash_params["term_type"] = termination_type;
    hash_params["term_value"] = std::round(termination_value * 100) / 100;
    
    // C. 加热器配置（简化）
    nlohmann::json heater_arr = nlohmann::json::array();
    for (const auto& cfg : heater_configs) {
        if (!cfg.profile_name.empty()) {
            heater_arr.push_back({{"profile", cfg.profile_name}});
        } else {
            // 自定义曲线：用温度序列表示
            heater_arr.push_back({{"temps", cfg.temps}, {"durs", cfg.durs}});
        }
    }
    hash_params["heater"] = heater_arr;
    
    // D. 清洗参数
    hash_params["wash_count"] = pre_wash_count;
    
    // E. 阶段
    hash_params["phase"] = phase_name;
    
    // 规范化 JSON 并计算 SHA256
    std::string canonical = hash_params.dump();
    
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(canonical.c_str()),
           canonical.size(), hash);
    
    // 转换为 16 字符的十六进制字符串
    std::stringstream ss;
    for (int i = 0; i < 8; ++i) {
        ss << std::hex << std::setfill('0') << std::setw(2) << static_cast<int>(hash[i]);
    }
    return ss.str();
}

// ============================================================
// SampleRepository 实现
// ============================================================

template<typename T>
std::string SampleRepository::to_pg_array(const std::vector<T>& vec) {
    if (vec.empty()) return "{}";
    
    std::stringstream ss;
    ss << "{";
    for (size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) ss << ",";
        if constexpr (std::is_same_v<T, std::string>) {
            // 字符串需要引号和转义
            ss << "\"" << vec[i] << "\"";
        } else {
            ss << vec[i];
        }
    }
    ss << "}";
    return ss.str();
}

std::vector<std::string> SampleRepository::parse_pg_text_array(const std::string& arr) {
    std::vector<std::string> result;
    if (arr.empty() || arr == "{}") return result;
    
    // 简单解析: {a,b,c} 或 {"a","b","c"}
    std::string content = arr.substr(1, arr.size() - 2);  // 去掉 {}
    if (content.empty()) return result;
    
    std::stringstream ss(content);
    std::string item;
    while (std::getline(ss, item, ',')) {
        // 去掉引号
        if (!item.empty() && item.front() == '"') {
            item = item.substr(1);
        }
        if (!item.empty() && item.back() == '"') {
            item = item.substr(0, item.size() - 1);
        }
        result.push_back(item);
    }
    return result;
}

std::vector<double> SampleRepository::parse_pg_double_array(const std::string& arr) {
    std::vector<double> result;
    if (arr.empty() || arr == "{}") return result;
    
    std::string content = arr.substr(1, arr.size() - 2);
    if (content.empty()) return result;
    
    std::stringstream ss(content);
    std::string item;
    while (std::getline(ss, item, ',')) {
        try {
            result.push_back(std::stod(item));
        } catch (...) {
            result.push_back(0.0);
        }
    }
    return result;
}

std::vector<int16_t> SampleRepository::parse_pg_int16_array(const std::string& arr) {
    std::vector<int16_t> result;
    if (arr.empty() || arr == "{}") return result;
    
    std::string content = arr.substr(1, arr.size() - 2);
    if (content.empty()) return result;
    
    std::stringstream ss(content);
    std::string item;
    while (std::getline(ss, item, ',')) {
        try {
            result.push_back(static_cast<int16_t>(std::stoi(item)));
        } catch (...) {
            result.push_back(0);
        }
    }
    return result;
}

std::optional<int32_t> SampleRepository::create_sample(
    int32_t run_id,
    int32_t sample_idx,
    const SampleContext& ctx) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        // 提取液体参数
        std::vector<std::string> liquid_ids, liquid_names;
        std::vector<double> liquid_ratios;
        std::vector<int16_t> pump_indices;
        
        for (const auto& liq : ctx.liquids) {
            liquid_ids.push_back(liq.id);
            liquid_names.push_back(liq.name);
            liquid_ratios.push_back(liq.ratio);
            pump_indices.push_back(static_cast<int16_t>(liq.pump_index));
        }
        
        // 加热器配置 JSON
        nlohmann::json heater_json = nlohmann::json::array();
        for (const auto& cfg : ctx.heater_configs) {
            heater_json.push_back(cfg.to_json());
        }
        
        // 完整参数 JSON
        nlohmann::json params_json = ctx.to_params_json();
        
        auto result = txn.exec_params(R"(
            INSERT INTO samples (
                run_id, sample_idx, start_time_ms, params_hash,
                liquid_ids, liquid_names, liquid_ratios, pump_indices,
                total_volume_ml, flow_rate_ml_s,
                gas_pump_pwm, termination_type, termination_value, max_duration_s,
                heater_configs,
                pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                phase_name, params_json
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10,
                $11, $12, $13, $14,
                $15,
                $16, $17, $18,
                $19, $20
            ) RETURNING id
        )",
            run_id, sample_idx, ctx.start_time_ms, ctx.params_hash,
            to_pg_array(liquid_ids), to_pg_array(liquid_names),
            to_pg_array(liquid_ratios), to_pg_array(pump_indices),
            ctx.total_volume_ml, ctx.flow_rate_ml_s,
            static_cast<int16_t>(ctx.gas_pump_pwm), ctx.termination_type,
            ctx.termination_value, ctx.max_duration_s,
            heater_json.dump(),
            static_cast<int16_t>(ctx.pre_wash_count), ctx.pre_wash_volume_ml,
            ctx.wash_liquid_id,
            ctx.phase_name, params_json.dump()
        );
        
        txn.commit();
        
        if (!result.empty()) {
            int32_t sample_id = result[0][0].as<int32_t>();
            spdlog::info("SampleRepository: created sample id={} for run={} idx={}",
                         sample_id, run_id, sample_idx);
            return sample_id;
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::create_sample failed: {}", e.what());
    }
    
    return std::nullopt;
}

bool SampleRepository::complete_sample(
    int32_t sample_id,
    int64_t end_time_ms,
    const SampleContext& ctx) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            UPDATE samples SET
                end_time_ms = $2,
                avg_temperature_c = $3,
                avg_humidity_pct = $4,
                avg_pressure_hpa = $5
            WHERE id = $1
        )",
            sample_id, end_time_ms,
            ctx.avg_temperature_c, ctx.avg_humidity_pct, ctx.avg_pressure_hpa
        );
        
        txn.commit();
        
        spdlog::info("SampleRepository: completed sample id={} end_time={}",
                     sample_id, end_time_ms);
        return result.affected_rows() > 0;
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::complete_sample failed: {}", e.what());
    }
    
    return false;
}

std::optional<SampleRecord> SampleRepository::get_sample(int32_t sample_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            SELECT id, run_id, sample_idx, start_time_ms, end_time_ms, params_hash,
                   liquid_ids, liquid_names, liquid_ratios, pump_indices,
                   total_volume_ml, flow_rate_ml_s,
                   gas_pump_pwm, termination_type, termination_value, max_duration_s,
                   heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                   phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                   params_json
            FROM samples WHERE id = $1
        )", sample_id);
        
        txn.commit();
        
        if (!result.empty()) {
            const auto& row = result[0];
            SampleRecord rec;
            rec.id = row[0].as<int32_t>();
            rec.run_id = row[1].as<int32_t>();
            rec.sample_idx = row[2].as<int32_t>();
            rec.start_time_ms = row[3].as<int64_t>();
            rec.end_time_ms = row[4].is_null() ? 0 : row[4].as<int64_t>();
            rec.params_hash = row[5].as<std::string>();
            
            rec.liquid_ids = parse_pg_text_array(row[6].is_null() ? "" : row[6].as<std::string>());
            rec.liquid_names = parse_pg_text_array(row[7].is_null() ? "" : row[7].as<std::string>());
            rec.liquid_ratios = parse_pg_double_array(row[8].is_null() ? "" : row[8].as<std::string>());
            rec.pump_indices = parse_pg_int16_array(row[9].is_null() ? "" : row[9].as<std::string>());
            
            rec.total_volume_ml = row[10].is_null() ? 0 : row[10].as<double>();
            rec.flow_rate_ml_s = row[11].is_null() ? 0 : row[11].as<double>();
            rec.gas_pump_pwm = row[12].as<int16_t>();
            rec.termination_type = row[13].is_null() ? "" : row[13].as<std::string>();
            rec.termination_value = row[14].is_null() ? 0 : row[14].as<double>();
            rec.max_duration_s = row[15].is_null() ? 0 : row[15].as<double>();
            rec.heater_configs_json = row[16].is_null() ? "[]" : row[16].as<std::string>();
            rec.pre_wash_count = row[17].is_null() ? 0 : row[17].as<int16_t>();
            rec.pre_wash_volume_ml = row[18].is_null() ? 0 : row[18].as<double>();
            rec.wash_liquid_id = row[19].is_null() ? "" : row[19].as<std::string>();
            rec.phase_name = row[20].is_null() ? "" : row[20].as<std::string>();
            rec.avg_temperature_c = row[21].is_null() ? 0 : row[21].as<double>();
            rec.avg_humidity_pct = row[22].is_null() ? 0 : row[22].as<double>();
            rec.avg_pressure_hpa = row[23].is_null() ? 0 : row[23].as<double>();
            rec.params_json = row[24].as<std::string>();
            
            return rec;
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::get_sample failed: {}", e.what());
    }
    
    return std::nullopt;
}

std::vector<SampleRecord> SampleRepository::get_samples_by_run(int32_t run_id) {
    std::vector<SampleRecord> samples;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            SELECT id, run_id, sample_idx, start_time_ms, end_time_ms, params_hash,
                   liquid_ids, liquid_names, liquid_ratios, pump_indices,
                   total_volume_ml, flow_rate_ml_s,
                   gas_pump_pwm, termination_type, termination_value, max_duration_s,
                   heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                   phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                   params_json
            FROM samples WHERE run_id = $1 ORDER BY sample_idx
        )", run_id);
        
        txn.commit();
        
        for (const auto& row : result) {
            SampleRecord rec;
            rec.id = row[0].as<int32_t>();
            rec.run_id = row[1].as<int32_t>();
            rec.sample_idx = row[2].as<int32_t>();
            rec.start_time_ms = row[3].as<int64_t>();
            rec.end_time_ms = row[4].is_null() ? 0 : row[4].as<int64_t>();
            rec.params_hash = row[5].as<std::string>();
            rec.liquid_ids = parse_pg_text_array(row[6].is_null() ? "" : row[6].as<std::string>());
            rec.liquid_names = parse_pg_text_array(row[7].is_null() ? "" : row[7].as<std::string>());
            rec.liquid_ratios = parse_pg_double_array(row[8].is_null() ? "" : row[8].as<std::string>());
            rec.pump_indices = parse_pg_int16_array(row[9].is_null() ? "" : row[9].as<std::string>());
            rec.total_volume_ml = row[10].is_null() ? 0 : row[10].as<double>();
            rec.flow_rate_ml_s = row[11].is_null() ? 0 : row[11].as<double>();
            rec.gas_pump_pwm = row[12].as<int16_t>();
            rec.termination_type = row[13].is_null() ? "" : row[13].as<std::string>();
            rec.termination_value = row[14].is_null() ? 0 : row[14].as<double>();
            rec.max_duration_s = row[15].is_null() ? 0 : row[15].as<double>();
            rec.heater_configs_json = row[16].is_null() ? "[]" : row[16].as<std::string>();
            rec.pre_wash_count = row[17].is_null() ? 0 : row[17].as<int16_t>();
            rec.pre_wash_volume_ml = row[18].is_null() ? 0 : row[18].as<double>();
            rec.wash_liquid_id = row[19].is_null() ? "" : row[19].as<std::string>();
            rec.phase_name = row[20].is_null() ? "" : row[20].as<std::string>();
            rec.avg_temperature_c = row[21].is_null() ? 0 : row[21].as<double>();
            rec.avg_humidity_pct = row[22].is_null() ? 0 : row[22].as<double>();
            rec.avg_pressure_hpa = row[23].is_null() ? 0 : row[23].as<double>();
            rec.params_json = row[24].as<std::string>();
            samples.push_back(rec);
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::get_samples_by_run failed: {}", e.what());
    }
    
    return samples;
}

std::vector<SampleRecord> SampleRepository::get_samples_by_hash(const std::string& params_hash) {
    std::vector<SampleRecord> samples;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            SELECT id, run_id, sample_idx, start_time_ms, end_time_ms, params_hash,
                   liquid_ids, liquid_names, liquid_ratios, pump_indices,
                   total_volume_ml, flow_rate_ml_s,
                   gas_pump_pwm, termination_type, termination_value, max_duration_s,
                   heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                   phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                   params_json
            FROM samples WHERE params_hash = $1 ORDER BY run_id, sample_idx
        )", params_hash);
        
        txn.commit();
        
        for (const auto& row : result) {
            SampleRecord rec;
            rec.id = row[0].as<int32_t>();
            rec.run_id = row[1].as<int32_t>();
            rec.sample_idx = row[2].as<int32_t>();
            rec.start_time_ms = row[3].as<int64_t>();
            rec.end_time_ms = row[4].is_null() ? 0 : row[4].as<int64_t>();
            rec.params_hash = row[5].as<std::string>();
            rec.liquid_ids = parse_pg_text_array(row[6].is_null() ? "" : row[6].as<std::string>());
            rec.liquid_names = parse_pg_text_array(row[7].is_null() ? "" : row[7].as<std::string>());
            rec.liquid_ratios = parse_pg_double_array(row[8].is_null() ? "" : row[8].as<std::string>());
            rec.pump_indices = parse_pg_int16_array(row[9].is_null() ? "" : row[9].as<std::string>());
            rec.total_volume_ml = row[10].is_null() ? 0 : row[10].as<double>();
            rec.flow_rate_ml_s = row[11].is_null() ? 0 : row[11].as<double>();
            rec.gas_pump_pwm = row[12].as<int16_t>();
            rec.termination_type = row[13].is_null() ? "" : row[13].as<std::string>();
            rec.termination_value = row[14].is_null() ? 0 : row[14].as<double>();
            rec.max_duration_s = row[15].is_null() ? 0 : row[15].as<double>();
            rec.heater_configs_json = row[16].is_null() ? "[]" : row[16].as<std::string>();
            rec.pre_wash_count = row[17].is_null() ? 0 : row[17].as<int16_t>();
            rec.pre_wash_volume_ml = row[18].is_null() ? 0 : row[18].as<double>();
            rec.wash_liquid_id = row[19].is_null() ? "" : row[19].as<std::string>();
            rec.phase_name = row[20].is_null() ? "" : row[20].as<std::string>();
            rec.avg_temperature_c = row[21].is_null() ? 0 : row[21].as<double>();
            rec.avg_humidity_pct = row[22].is_null() ? 0 : row[22].as<double>();
            rec.avg_pressure_hpa = row[23].is_null() ? 0 : row[23].as<double>();
            rec.params_json = row[24].as<std::string>();
            samples.push_back(rec);
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::get_samples_by_hash failed: {}", e.what());
    }
    
    return samples;
}

EnvironmentStats SampleRepository::get_environment_stats(int64_t start_time_ms, int64_t end_time_ms) {
    EnvironmentStats stats;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            SELECT AVG(temperature), AVG(humidity), AVG(pressure)
            FROM sensor_readings_v2
            WHERE time_ms >= $1 AND time_ms <= $2 AND sensor_idx = 0
        )", start_time_ms, end_time_ms);
        
        txn.commit();
        
        if (!result.empty() && !result[0][0].is_null()) {
            stats.avg_temp = result[0][0].as<double>();
            stats.avg_humidity = result[0][1].is_null() ? 0 : result[0][1].as<double>();
            stats.avg_pressure = result[0][2].is_null() ? 0 : result[0][2].as<double>();
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::get_environment_stats failed: {}", e.what());
    }
    
    return stats;
}

bool SampleRepository::delete_sample(int32_t sample_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params("DELETE FROM samples WHERE id = $1", sample_id);
        
        txn.commit();
        
        return result.affected_rows() > 0;
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::delete_sample failed: {}", e.what());
    }
    
    return false;
}

bool SampleRepository::delete_samples_by_run(int32_t run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params("DELETE FROM samples WHERE run_id = $1", run_id);
        
        txn.commit();
        
        spdlog::info("SampleRepository: deleted {} samples for run {}",
                     result.affected_rows(), run_id);
        return true;
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::delete_samples_by_run failed: {}", e.what());
    }
    
    return false;
}

// 显式实例化模板
template std::string SampleRepository::to_pg_array<std::string>(const std::vector<std::string>&);
template std::string SampleRepository::to_pg_array<double>(const std::vector<double>&);
template std::string SampleRepository::to_pg_array<int16_t>(const std::vector<int16_t>&);

} // namespace db
