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
    
    // G. 组合实验元数据
    if (!reagent_batch_id.empty()) j["reagent_batch_id"] = reagent_batch_id;
    if (!reagent_prep_date.empty()) j["reagent_prep_date"] = reagent_prep_date;
    if (prev_sample_id > 0) j["prev_sample_id"] = prev_sample_id;
    if (samples_since_wash > 0) j["samples_since_wash"] = samples_since_wash;
    if (sensor_hours_at_sample > 0) j["sensor_hours_at_sample"] = sensor_hours_at_sample;
    if (is_anchor) j["is_anchor"] = true;
    if (is_blank) j["is_blank"] = true;
    if (!experiment_phase.empty()) j["experiment_phase"] = experiment_phase;
    if (!sequence_block.empty()) j["sequence_block"] = sequence_block;
    if (randomization_seed != 0) j["randomization_seed"] = randomization_seed;
    if (!wash_residual_response.empty()) j["wash_residual_response"] = wash_residual_response;
    
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

std::vector<bool> SampleRepository::parse_pg_bool_array(const std::string& arr) {
    std::vector<bool> result;
    if (arr.empty() || arr == "{}") return result;
    
    std::string content = arr.substr(1, arr.size() - 2);
    if (content.empty()) return result;
    
    std::stringstream ss(content);
    std::string item;
    while (std::getline(ss, item, ',')) {
        result.push_back(item == "t" || item == "true" || item == "1");
    }
    return result;
}

std::vector<float> SampleRepository::parse_pg_float_array(const std::string& arr) {
    std::vector<float> result;
    if (arr.empty() || arr == "{}") return result;
    
    std::string content = arr.substr(1, arr.size() - 2);
    if (content.empty()) return result;
    
    std::stringstream ss(content);
    std::string item;
    while (std::getline(ss, item, ',')) {
        try {
            result.push_back(std::stof(item));
        } catch (...) {
            result.push_back(0.0f);
        }
    }
    return result;
}

void SampleRepository::parse_sample_row(const pqxx::row& row, SampleRecord& rec) {
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
    rec.liquid_is_solvent = parse_pg_bool_array(row[10].is_null() ? "" : row[10].as<std::string>());
    
    rec.total_volume_ml = row[11].is_null() ? 0 : row[11].as<double>();
    rec.flow_rate_ml_s = row[12].is_null() ? 0 : row[12].as<double>();
    rec.gas_pump_pwm = row[13].as<int16_t>();
    rec.termination_type = row[14].is_null() ? "" : row[14].as<std::string>();
    rec.termination_value = row[15].is_null() ? 0 : row[15].as<double>();
    rec.max_duration_s = row[16].is_null() ? 0 : row[16].as<double>();
    rec.heater_configs_json = row[17].is_null() ? "[]" : row[17].as<std::string>();
    rec.pre_wash_count = row[18].is_null() ? 0 : row[18].as<int16_t>();
    rec.pre_wash_volume_ml = row[19].is_null() ? 0 : row[19].as<double>();
    rec.wash_liquid_id = row[20].is_null() ? "" : row[20].as<std::string>();
    rec.phase_name = row[21].is_null() ? "" : row[21].as<std::string>();
    rec.avg_temperature_c = row[22].is_null() ? 0 : row[22].as<double>();
    rec.avg_humidity_pct = row[23].is_null() ? 0 : row[23].as<double>();
    rec.avg_pressure_hpa = row[24].is_null() ? 0 : row[24].as<double>();
    rec.params_json = row[25].as<std::string>();
    
    // 组合实验元数据 (columns 26-37)
    rec.reagent_batch_id = row[26].is_null() ? "" : row[26].as<std::string>();
    rec.reagent_prep_date = row[27].is_null() ? "" : row[27].as<std::string>();
    rec.prev_sample_id = row[28].is_null() ? 0 : row[28].as<int32_t>();
    rec.samples_since_wash = row[29].is_null() ? 0 : row[29].as<int16_t>();
    rec.sensor_hours_at_sample = row[30].is_null() ? 0.0f : row[30].as<float>();
    rec.is_anchor = row[31].is_null() ? false : row[31].as<bool>();
    rec.is_blank = row[32].is_null() ? false : row[32].as<bool>();
    rec.experiment_phase = row[33].is_null() ? "" : row[33].as<std::string>();
    rec.sequence_block = row[34].is_null() ? "" : row[34].as<std::string>();
    rec.randomization_seed = row[35].is_null() ? 0 : row[35].as<int32_t>();
    rec.wash_residual_response = parse_pg_float_array(row[36].is_null() ? "" : row[36].as<std::string>());
    rec.quality_score = row[37].is_null() ? 0.0f : row[37].as<float>();
    rec.quality_level = row[38].is_null() ? "" : row[38].as<std::string>();
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
        std::vector<std::string> liquid_is_solvent;
        
        for (const auto& liq : ctx.liquids) {
            liquid_ids.push_back(liq.id);
            liquid_names.push_back(liq.name);
            liquid_ratios.push_back(liq.ratio);
            pump_indices.push_back(static_cast<int16_t>(liq.pump_index));
            liquid_is_solvent.push_back(liq.is_solvent ? "t" : "f");
        }
        
        // 加热器配置 JSON
        nlohmann::json heater_json = nlohmann::json::array();
        for (const auto& cfg : ctx.heater_configs) {
            heater_json.push_back(cfg.to_json());
        }
        
        // 完整参数 JSON
        nlohmann::json params_json = ctx.to_params_json();
        
        // 组合实验元数据: wash_residual_response 转 PG 数组
        std::string wash_res_arr = "{}";
        if (!ctx.wash_residual_response.empty()) {
            std::stringstream wss;
            wss << "{";
            for (size_t i = 0; i < ctx.wash_residual_response.size(); ++i) {
                if (i > 0) wss << ",";
                wss << ctx.wash_residual_response[i];
            }
            wss << "}";
            wash_res_arr = wss.str();
        }
        
        auto result = txn.exec_params(R"(
            INSERT INTO samples (
                run_id, sample_idx, start_time_ms, params_hash,
                liquid_ids, liquid_names, liquid_ratios, pump_indices,
                liquid_is_solvent,
                total_volume_ml, flow_rate_ml_s,
                gas_pump_pwm, termination_type, termination_value, max_duration_s,
                heater_configs,
                pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                phase_name, params_json,
                reagent_batch_id, reagent_prep_date,
                prev_sample_id, samples_since_wash,
                sensor_hours_at_sample, is_anchor, is_blank,
                experiment_phase, sequence_block, randomization_seed,
                wash_residual_response
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9,
                $10, $11,
                $12, $13, $14, $15,
                $16,
                $17, $18, $19,
                $20, $21,
                NULLIF($22, ''), NULLIF($23, '')::date,
                NULLIF($24, 0), $25,
                NULLIF($26, 0), $27, $28,
                NULLIF($29, ''), NULLIF($30, ''), NULLIF($31, 0),
                $32::real[]
            ) RETURNING id
        )",
            run_id, sample_idx, ctx.start_time_ms, ctx.params_hash,
            to_pg_array(liquid_ids), to_pg_array(liquid_names),
            to_pg_array(liquid_ratios), to_pg_array(pump_indices),
            to_pg_array(liquid_is_solvent),
            ctx.total_volume_ml, ctx.flow_rate_ml_s,
            static_cast<int16_t>(ctx.gas_pump_pwm), ctx.termination_type,
            ctx.termination_value, ctx.max_duration_s,
            heater_json.dump(),
            static_cast<int16_t>(ctx.pre_wash_count), ctx.pre_wash_volume_ml,
            ctx.wash_liquid_id,
            ctx.phase_name, params_json.dump(),
            ctx.reagent_batch_id, ctx.reagent_prep_date,
            ctx.prev_sample_id, static_cast<int16_t>(ctx.samples_since_wash),
            ctx.sensor_hours_at_sample, ctx.is_anchor, ctx.is_blank,
            ctx.experiment_phase, ctx.sequence_block, ctx.randomization_seed,
            wash_res_arr
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
                   liquid_is_solvent,
                   total_volume_ml, flow_rate_ml_s,
                   gas_pump_pwm, termination_type, termination_value, max_duration_s,
                   heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                   phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                   params_json,
                   reagent_batch_id, reagent_prep_date,
                   prev_sample_id, samples_since_wash, sensor_hours_at_sample,
                   is_anchor, is_blank, experiment_phase,
                   sequence_block, randomization_seed, wash_residual_response,
                   quality_score, quality_level
            FROM samples WHERE id = $1
        )", sample_id);
        
        txn.commit();
        
        if (!result.empty()) {
            const auto& row = result[0];
            SampleRecord rec;
            parse_sample_row(row, rec);
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
                   liquid_is_solvent,
                   total_volume_ml, flow_rate_ml_s,
                   gas_pump_pwm, termination_type, termination_value, max_duration_s,
                   heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                   phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                   params_json,
                   reagent_batch_id, reagent_prep_date,
                   prev_sample_id, samples_since_wash, sensor_hours_at_sample,
                   is_anchor, is_blank, experiment_phase,
                   sequence_block, randomization_seed, wash_residual_response,
                   quality_score, quality_level
            FROM samples WHERE run_id = $1 ORDER BY sample_idx
        )", run_id);
        
        txn.commit();
        
        for (const auto& row : result) {
            SampleRecord rec;
            parse_sample_row(row, rec);
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
                   liquid_is_solvent,
                   total_volume_ml, flow_rate_ml_s,
                   gas_pump_pwm, termination_type, termination_value, max_duration_s,
                   heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                   phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                   params_json,
                   reagent_batch_id, reagent_prep_date,
                   prev_sample_id, samples_since_wash, sensor_hours_at_sample,
                   is_anchor, is_blank, experiment_phase,
                   sequence_block, randomization_seed, wash_residual_response,
                   quality_score, quality_level
            FROM samples WHERE params_hash = $1 ORDER BY run_id, sample_idx
        )", params_hash);
        
        txn.commit();
        
        for (const auto& row : result) {
            SampleRecord rec;
            parse_sample_row(row, rec);
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

// ============================================================
// Phase 转换管理
// ============================================================

std::optional<int32_t> SampleRepository::create_phase_transition(
    int32_t sample_id,
    const std::string& phase_name,
    int64_t start_time_ms,
    int16_t phase_order) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            INSERT INTO sample_phase_transitions (
                sample_id, phase_name, start_time_ms, phase_order
            ) VALUES ($1, $2, $3, $4)
            ON CONFLICT (sample_id, phase_order) DO UPDATE
                SET phase_name = $2, start_time_ms = $3, end_time_ms = NULL
            RETURNING id
        )",
            sample_id, phase_name, start_time_ms, phase_order
        );
        
        txn.commit();
        
        if (!result.empty()) {
            int32_t id = result[0][0].as<int32_t>();
            spdlog::debug("SampleRepository: created phase transition id={} for sample={} phase={} order={}",
                         id, sample_id, phase_name, phase_order);
            return id;
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::create_phase_transition failed: {}", e.what());
    }
    
    return std::nullopt;
}

bool SampleRepository::complete_phase_transition(int32_t sample_id, int16_t phase_order, int64_t end_time_ms) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            UPDATE sample_phase_transitions
            SET end_time_ms = $3
            WHERE sample_id = $1 AND phase_order = $2
        )",
            sample_id, phase_order, end_time_ms
        );
        
        txn.commit();
        
        spdlog::debug("SampleRepository: completed phase transition sample={} order={} end_time={}",
                     sample_id, phase_order, end_time_ms);
        return result.affected_rows() > 0;
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::complete_phase_transition failed: {}", e.what());
    }
    
    return false;
}

std::vector<PhaseTransitionRecord> SampleRepository::get_phase_transitions(int32_t sample_id) {
    std::vector<PhaseTransitionRecord> transitions;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            SELECT id, sample_id, phase_name, start_time_ms, end_time_ms, phase_order
            FROM sample_phase_transitions
            WHERE sample_id = $1
            ORDER BY phase_order
        )", sample_id);
        
        txn.commit();
        
        for (const auto& row : result) {
            PhaseTransitionRecord rec;
            rec.id = row[0].as<int32_t>();
            rec.sample_id = row[1].as<int32_t>();
            rec.phase_name = row[2].as<std::string>();
            rec.start_time_ms = row[3].as<int64_t>();
            rec.end_time_ms = row[4].is_null() ? std::nullopt : std::optional<int64_t>(row[4].as<int64_t>());
            rec.phase_order = row[5].as<int16_t>();
            transitions.push_back(rec);
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::get_phase_transitions failed: {}", e.what());
    }
    
    return transitions;
}

int16_t SampleRepository::get_current_phase_order(int32_t sample_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(R"(
            SELECT COALESCE(MAX(phase_order), -1)
            FROM sample_phase_transitions
            WHERE sample_id = $1
        )", sample_id);
        
        txn.commit();
        
        if (!result.empty() && !result[0][0].is_null()) {
            return result[0][0].as<int16_t>();
        }
        
    } catch (const std::exception& e) {
        spdlog::error("SampleRepository::get_current_phase_order failed: {}", e.what());
    }
    
    return -1;
}

// 显式实例化模板
template std::string SampleRepository::to_pg_array<std::string>(const std::vector<std::string>&);
template std::string SampleRepository::to_pg_array<double>(const std::vector<double>&);
template std::string SampleRepository::to_pg_array<int16_t>(const std::vector<int16_t>&);

} // namespace db
