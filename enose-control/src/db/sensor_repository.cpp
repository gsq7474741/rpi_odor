#include "sensor_repository.hpp"
#include "connection_pool.hpp"
#include <spdlog/spdlog.h>
#include <pqxx/pqxx>
#include <sstream>
#include <iomanip>

namespace db {

SensorRepository::SensorRepository() {
    write_buffer_.reserve(batch_size_ * 2);
}

SensorRepository::~SensorRepository() {
    stop_background_flush();
    // 析构前刷新剩余数据
    flush();
}

// ============================================================
// 写入接口
// ============================================================

void SensorRepository::buffer_insert(const SensorReadingRecord& record) {
    SensorReadingRecord r = record;
    
    // 自动填充运行上下文
    {
        std::lock_guard<std::mutex> lock(context_mutex_);
        if (!r.run_id && current_run_id_) {
            r.run_id = current_run_id_;
        }
        if (!r.phase_name && !current_phase_.empty()) {
            r.phase_name = current_phase_;
        }
    }
    
    bool should_flush = false;
    {
        std::lock_guard<std::mutex> lock(buffer_mutex_);
        write_buffer_.push_back(std::move(r));
        should_flush = write_buffer_.size() >= batch_size_;
    }
    
    if (should_flush) {
        flush();
    }
}

void SensorRepository::flush() {
    std::vector<SensorReadingRecord> to_insert;
    {
        std::lock_guard<std::mutex> lock(buffer_mutex_);
        if (write_buffer_.empty()) return;
        to_insert.swap(write_buffer_);
        write_buffer_.reserve(batch_size_ * 2);
    }
    
    if (!to_insert.empty()) {
        if (!do_batch_insert(to_insert)) {
            spdlog::error("SensorRepository: batch insert failed, {} records lost", to_insert.size());
        }
    }
}

void SensorRepository::set_run_context(std::optional<int32_t> run_id, const std::string& phase_name) {
    std::lock_guard<std::mutex> lock(context_mutex_);
    current_run_id_ = run_id;
    current_phase_ = phase_name;
    spdlog::debug("SensorRepository: set run context run_id={}, phase='{}'", 
                  run_id.value_or(-1), phase_name);
}

void SensorRepository::clear_run_context() {
    std::lock_guard<std::mutex> lock(context_mutex_);
    current_run_id_.reset();
    current_phase_.clear();
    spdlog::debug("SensorRepository: cleared run context");
}

// ============================================================
// 批量写入实现
// ============================================================

bool SensorRepository::do_batch_insert(const std::vector<SensorReadingRecord>& records) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("SensorRepository: failed to acquire connection");
        return false;
    }
    
    try {
        pqxx::work txn(conn.get());
        
        // 使用 stream_to 高效批量写入
        auto stream = pqxx::stream_to::table(txn, "sensor_readings_v2",
            std::vector<std::string>{
                "time_ms", "device_tick_ms", "sensor_idx", "sensor_id", "sensor_type",
                "value", "temperature", "humidity", "pressure", "heater_step",
                "run_id", "phase_name"
            });
        
        for (const auto& r : records) {
            // 处理可选值
            std::optional<float> temp = r.temperature;
            std::optional<float> hum = r.humidity;
            std::optional<float> pres = r.pressure;
            std::optional<int16_t> hs = r.heater_step;
            std::optional<int32_t> rid = r.run_id;
            std::optional<std::string> phase = r.phase_name;
            
            stream.write_values(
                r.time_ms,
                r.device_tick_ms,
                r.sensor_idx,
                r.sensor_id,
                r.sensor_type,
                r.value,
                temp,
                hum,
                pres,
                hs,
                rid,
                phase
            );
        }
        
        stream.complete();
        txn.commit();
        
        spdlog::trace("SensorRepository: inserted {} records", records.size());
        return true;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: batch insert error: {}", e.what());
        return false;
    }
}

// ============================================================
// 后台刷新线程
// ============================================================

void SensorRepository::start_background_flush() {
    if (flush_running_.exchange(true)) {
        return; // 已经在运行
    }
    
    flush_thread_ = std::thread(&SensorRepository::flush_thread_func, this);
    spdlog::info("SensorRepository: background flush started (interval={}ms)", flush_interval_ms_);
}

void SensorRepository::stop_background_flush() {
    if (!flush_running_.exchange(false)) {
        return; // 没有在运行
    }
    
    flush_cv_.notify_all();
    if (flush_thread_.joinable()) {
        flush_thread_.join();
    }
    spdlog::info("SensorRepository: background flush stopped");
}

void SensorRepository::flush_thread_func() {
    while (flush_running_) {
        {
            std::unique_lock<std::mutex> lock(flush_mutex_);
            flush_cv_.wait_for(lock, std::chrono::milliseconds(flush_interval_ms_),
                              [this] { return !flush_running_.load(); });
        }
        
        if (flush_running_) {
            flush();
        }
    }
    
    // 停止前最后一次刷新
    flush();
}

// ============================================================
// 查询接口
// ============================================================

std::vector<SensorReadingRecord> SensorRepository::query_by_time_range(
    int64_t start_ms,
    int64_t end_ms,
    std::optional<int16_t> sensor_idx,
    int limit) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("SensorRepository: failed to acquire connection for query");
        return {};
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT time_ms, device_tick_ms, sensor_idx, sensor_id, sensor_type, "
            << "value, temperature, humidity, pressure, heater_step, run_id, phase_name "
            << "FROM sensor_readings_v2 "
            << "WHERE time_ms >= " << start_ms << " AND time_ms <= " << end_ms;
        
        if (sensor_idx) {
            sql << " AND sensor_idx = " << *sensor_idx;
        }
        
        sql << " ORDER BY time_ms DESC LIMIT " << limit;
        
        auto result = txn.exec(sql.str());
        
        std::vector<SensorReadingRecord> records;
        records.reserve(result.size());
        
        for (const auto& row : result) {
            SensorReadingRecord r;
            r.time_ms = row["time_ms"].as<int64_t>();
            r.device_tick_ms = row["device_tick_ms"].as<int64_t>();
            r.sensor_idx = row["sensor_idx"].as<int16_t>();
            r.sensor_id = row["sensor_id"].as<int32_t>();
            r.sensor_type = row["sensor_type"].as<int16_t>();
            r.value = row["value"].as<double>();
            
            if (!row["temperature"].is_null()) r.temperature = row["temperature"].as<float>();
            if (!row["humidity"].is_null()) r.humidity = row["humidity"].as<float>();
            if (!row["pressure"].is_null()) r.pressure = row["pressure"].as<float>();
            if (!row["heater_step"].is_null()) r.heater_step = row["heater_step"].as<int16_t>();
            if (!row["run_id"].is_null()) r.run_id = row["run_id"].as<int32_t>();
            if (!row["phase_name"].is_null()) r.phase_name = row["phase_name"].as<std::string>();
            
            records.push_back(std::move(r));
        }
        
        return records;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: query_by_time_range error: {}", e.what());
        return {};
    }
}

std::vector<SensorReadingRecord> SensorRepository::query_by_run(
    int32_t run_id,
    std::optional<int64_t> start_ms,
    std::optional<int64_t> end_ms,
    std::optional<int16_t> sensor_idx) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return {};
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT time_ms, device_tick_ms, sensor_idx, sensor_id, sensor_type, "
            << "value, temperature, humidity, pressure, heater_step, run_id, phase_name "
            << "FROM sensor_readings_v2 "
            << "WHERE run_id = " << run_id;
        
        if (start_ms) sql << " AND time_ms >= " << *start_ms;
        if (end_ms) sql << " AND time_ms <= " << *end_ms;
        if (sensor_idx) sql << " AND sensor_idx = " << *sensor_idx;
        
        sql << " ORDER BY time_ms ASC";
        
        auto result = txn.exec(sql.str());
        
        std::vector<SensorReadingRecord> records;
        records.reserve(result.size());
        
        for (const auto& row : result) {
            SensorReadingRecord r;
            r.time_ms = row["time_ms"].as<int64_t>();
            r.device_tick_ms = row["device_tick_ms"].as<int64_t>();
            r.sensor_idx = row["sensor_idx"].as<int16_t>();
            r.sensor_id = row["sensor_id"].as<int32_t>();
            r.sensor_type = row["sensor_type"].as<int16_t>();
            r.value = row["value"].as<double>();
            
            if (!row["temperature"].is_null()) r.temperature = row["temperature"].as<float>();
            if (!row["humidity"].is_null()) r.humidity = row["humidity"].as<float>();
            if (!row["pressure"].is_null()) r.pressure = row["pressure"].as<float>();
            if (!row["heater_step"].is_null()) r.heater_step = row["heater_step"].as<int16_t>();
            if (!row["run_id"].is_null()) r.run_id = row["run_id"].as<int32_t>();
            if (!row["phase_name"].is_null()) r.phase_name = row["phase_name"].as<std::string>();
            
            records.push_back(std::move(r));
        }
        
        return records;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: query_by_run error: {}", e.what());
        return {};
    }
}

std::vector<SensorReadingRecord> SensorRepository::query_by_heater_cycle(
    int32_t run_id,
    int16_t sensor_idx,
    int16_t heater_step,
    std::optional<int64_t> start_ms,
    std::optional<int64_t> end_ms) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return {};
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT time_ms, device_tick_ms, sensor_idx, sensor_id, sensor_type, "
            << "value, temperature, humidity, pressure, heater_step, run_id, phase_name "
            << "FROM sensor_readings_v2 "
            << "WHERE run_id = " << run_id
            << " AND sensor_idx = " << sensor_idx
            << " AND heater_step = " << heater_step;
        
        if (start_ms) sql << " AND time_ms >= " << *start_ms;
        if (end_ms) sql << " AND time_ms <= " << *end_ms;
        
        sql << " ORDER BY time_ms ASC";
        
        auto result = txn.exec(sql.str());
        
        std::vector<SensorReadingRecord> records;
        records.reserve(result.size());
        
        for (const auto& row : result) {
            SensorReadingRecord r;
            r.time_ms = row["time_ms"].as<int64_t>();
            r.device_tick_ms = row["device_tick_ms"].as<int64_t>();
            r.sensor_idx = row["sensor_idx"].as<int16_t>();
            r.sensor_id = row["sensor_id"].as<int32_t>();
            r.sensor_type = row["sensor_type"].as<int16_t>();
            r.value = row["value"].as<double>();
            
            if (!row["temperature"].is_null()) r.temperature = row["temperature"].as<float>();
            if (!row["humidity"].is_null()) r.humidity = row["humidity"].as<float>();
            if (!row["pressure"].is_null()) r.pressure = row["pressure"].as<float>();
            if (!row["heater_step"].is_null()) r.heater_step = row["heater_step"].as<int16_t>();
            if (!row["run_id"].is_null()) r.run_id = row["run_id"].as<int32_t>();
            if (!row["phase_name"].is_null()) r.phase_name = row["phase_name"].as<std::string>();
            
            records.push_back(std::move(r));
        }
        
        return records;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: query_by_heater_cycle error: {}", e.what());
        return {};
    }
}

std::vector<HeaterCycleStats> SensorRepository::query_heater_cycle_stats(
    int32_t run_id,
    std::optional<int16_t> sensor_idx,
    std::optional<int16_t> heater_step) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return {};
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT bucket_ms, run_id, sensor_idx, heater_step, "
            << "sample_count, mean_value, std_value, min_value, max_value, "
            << "first_value, last_value, avg_temp, avg_humidity, avg_pressure "
            << "FROM sensor_heater_cycles "
            << "WHERE run_id = " << run_id;
        
        if (sensor_idx) sql << " AND sensor_idx = " << *sensor_idx;
        if (heater_step) sql << " AND heater_step = " << *heater_step;
        
        sql << " ORDER BY bucket_ms ASC, sensor_idx ASC, heater_step ASC";
        
        auto result = txn.exec(sql.str());
        
        std::vector<HeaterCycleStats> stats;
        stats.reserve(result.size());
        
        for (const auto& row : result) {
            HeaterCycleStats s;
            s.bucket_ms = row["bucket_ms"].as<int64_t>();
            if (!row["run_id"].is_null()) s.run_id = row["run_id"].as<int32_t>();
            s.sensor_idx = row["sensor_idx"].as<int16_t>();
            s.heater_step = row["heater_step"].as<int16_t>();
            s.sample_count = row["sample_count"].as<int64_t>();
            s.mean_value = row["mean_value"].as<double>();
            if (!row["std_value"].is_null()) s.std_value = row["std_value"].as<double>();
            s.min_value = row["min_value"].as<double>();
            s.max_value = row["max_value"].as<double>();
            s.first_value = row["first_value"].as<double>();
            s.last_value = row["last_value"].as<double>();
            if (!row["avg_temp"].is_null()) s.avg_temp = row["avg_temp"].as<double>();
            if (!row["avg_humidity"].is_null()) s.avg_humidity = row["avg_humidity"].as<double>();
            if (!row["avg_pressure"].is_null()) s.avg_pressure = row["avg_pressure"].as<double>();
            
            stats.push_back(std::move(s));
        }
        
        return stats;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: query_heater_cycle_stats error: {}", e.what());
        return {};
    }
}

// ============================================================
// 元数据管理
// ============================================================

void SensorRepository::upsert_sensor_metadata(const SensorMetadataRecord& meta) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("SensorRepository: failed to acquire connection for upsert metadata");
        return;
    }
    
    try {
        pqxx::work txn(conn.get());
        
        // 构建数组字面量
        std::ostringstream temps_arr, durs_arr;
        temps_arr << "ARRAY[";
        durs_arr << "ARRAY[";
        for (size_t i = 0; i < meta.heater_temps.size(); ++i) {
            if (i > 0) { temps_arr << ","; durs_arr << ","; }
            temps_arr << meta.heater_temps[i];
            if (i < meta.heater_durs.size()) durs_arr << meta.heater_durs[i];
        }
        temps_arr << "]::SMALLINT[]";
        durs_arr << "]::SMALLINT[]";
        
        std::ostringstream sql;
        sql << "INSERT INTO sensor_metadata (sensor_id, sensor_idx, device_id, sensor_type, "
            << "heater_temps, heater_durs, heater_length, adc_vref, adc_sample_rate, adc_gain, notes, updated_at) "
            << "VALUES ("
            << meta.sensor_id << ", "
            << meta.sensor_idx << ", "
            << txn.quote(meta.device_id) << ", "
            << meta.sensor_type << ", "
            << temps_arr.str() << ", "
            << durs_arr.str() << ", "
            << meta.heater_length << ", "
            << (meta.adc_vref ? std::to_string(*meta.adc_vref) : "NULL") << ", "
            << (meta.adc_sample_rate ? std::to_string(*meta.adc_sample_rate) : "NULL") << ", "
            << (meta.adc_gain ? std::to_string(*meta.adc_gain) : "NULL") << ", "
            << txn.quote(meta.notes) << ", NOW()) "
            << "ON CONFLICT (sensor_id) DO UPDATE SET "
            << "sensor_idx = EXCLUDED.sensor_idx, "
            << "device_id = EXCLUDED.device_id, "
            << "sensor_type = EXCLUDED.sensor_type, "
            << "heater_temps = EXCLUDED.heater_temps, "
            << "heater_durs = EXCLUDED.heater_durs, "
            << "heater_length = EXCLUDED.heater_length, "
            << "adc_vref = EXCLUDED.adc_vref, "
            << "adc_sample_rate = EXCLUDED.adc_sample_rate, "
            << "adc_gain = EXCLUDED.adc_gain, "
            << "notes = EXCLUDED.notes, "
            << "updated_at = NOW()";
        
        txn.exec(sql.str());
        txn.commit();
        
        spdlog::debug("SensorRepository: upserted metadata for sensor_id={}", meta.sensor_id);
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: upsert metadata error: {}", e.what());
    }
}

std::optional<SensorMetadataRecord> SensorRepository::get_sensor_metadata(int32_t sensor_id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return std::nullopt;
    }
    
    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec(
            "SELECT sensor_id, sensor_idx, device_id, sensor_type, "
            "heater_temps, heater_durs, heater_length, "
            "adc_vref, adc_sample_rate, adc_gain, notes "
            "FROM sensor_metadata WHERE sensor_id = " + std::to_string(sensor_id));
        
        if (result.empty()) return std::nullopt;
        
        const auto& row = result[0];
        SensorMetadataRecord meta;
        meta.sensor_id = row["sensor_id"].as<int32_t>();
        meta.sensor_idx = row["sensor_idx"].as<int16_t>();
        meta.device_id = row["device_id"].as<std::string>();
        meta.sensor_type = row["sensor_type"].as<int16_t>();
        meta.heater_length = row["heater_length"].as<int16_t>();
        
        if (!row["adc_vref"].is_null()) meta.adc_vref = row["adc_vref"].as<float>();
        if (!row["adc_sample_rate"].is_null()) meta.adc_sample_rate = row["adc_sample_rate"].as<int16_t>();
        if (!row["adc_gain"].is_null()) meta.adc_gain = row["adc_gain"].as<int16_t>();
        if (!row["notes"].is_null()) meta.notes = row["notes"].as<std::string>();
        
        // TODO: 解析数组字段 heater_temps, heater_durs
        
        return meta;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: get_sensor_metadata error: {}", e.what());
        return std::nullopt;
    }
}

std::vector<SensorMetadataRecord> SensorRepository::list_sensor_metadata(const std::string& device_id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return {};
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT sensor_id, sensor_idx, device_id, sensor_type, "
            << "heater_temps, heater_durs, heater_length, "
            << "adc_vref, adc_sample_rate, adc_gain, notes "
            << "FROM sensor_metadata";
        
        if (!device_id.empty()) {
            sql << " WHERE device_id = " << txn.quote(device_id);
        }
        
        sql << " ORDER BY sensor_idx";
        
        auto result = txn.exec(sql.str());
        
        std::vector<SensorMetadataRecord> records;
        for (const auto& row : result) {
            SensorMetadataRecord meta;
            meta.sensor_id = row["sensor_id"].as<int32_t>();
            meta.sensor_idx = row["sensor_idx"].as<int16_t>();
            meta.device_id = row["device_id"].as<std::string>();
            meta.sensor_type = row["sensor_type"].as<int16_t>();
            meta.heater_length = row["heater_length"].as<int16_t>();
            
            if (!row["adc_vref"].is_null()) meta.adc_vref = row["adc_vref"].as<float>();
            if (!row["adc_sample_rate"].is_null()) meta.adc_sample_rate = row["adc_sample_rate"].as<int16_t>();
            if (!row["adc_gain"].is_null()) meta.adc_gain = row["adc_gain"].as<int16_t>();
            if (!row["notes"].is_null()) meta.notes = row["notes"].as<std::string>();
            
            records.push_back(std::move(meta));
        }
        
        return records;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: list_sensor_metadata error: {}", e.what());
        return {};
    }
}

// ============================================================
// 统计接口
// ============================================================

int64_t SensorRepository::count_readings(
    std::optional<int32_t> run_id,
    std::optional<int64_t> start_ms,
    std::optional<int64_t> end_ms) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return 0;
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT COUNT(*) FROM sensor_readings_v2 WHERE 1=1";
        
        if (run_id) sql << " AND run_id = " << *run_id;
        if (start_ms) sql << " AND time_ms >= " << *start_ms;
        if (end_ms) sql << " AND time_ms <= " << *end_ms;
        
        auto result = txn.exec(sql.str());
        return result[0][0].as<int64_t>();
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: count_readings error: {}", e.what());
        return 0;
    }
}

std::pair<int64_t, int64_t> SensorRepository::get_time_range(std::optional<int32_t> run_id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        return {0, 0};
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT MIN(time_ms), MAX(time_ms) FROM sensor_readings_v2";
        
        if (run_id) sql << " WHERE run_id = " << *run_id;
        
        auto result = txn.exec(sql.str());
        
        if (result.empty() || result[0][0].is_null()) {
            return {0, 0};
        }
        
        return {result[0][0].as<int64_t>(), result[0][1].as<int64_t>()};
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: get_time_range error: {}", e.what());
        return {0, 0};
    }
}

// ============================================================
// 加热配置管理
// ============================================================

// 辅助函数: 将 vector<int16_t> 转换为 PostgreSQL 数组字面量
static std::string to_pg_array(const std::vector<int16_t>& vec) {
    std::ostringstream ss;
    ss << "ARRAY[";
    for (size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) ss << ",";
        ss << vec[i];
    }
    ss << "]::SMALLINT[]";
    return ss.str();
}

// 辅助函数: 解析 PostgreSQL 数组为 vector<int16_t>
static std::vector<int16_t> parse_pg_array(const std::string& arr_str) {
    std::vector<int16_t> result;
    if (arr_str.empty() || arr_str == "{}") return result;
    
    // 移除花括号
    std::string s = arr_str;
    if (s.front() == '{') s = s.substr(1);
    if (s.back() == '}') s = s.substr(0, s.size() - 1);
    
    std::istringstream iss(s);
    std::string token;
    while (std::getline(iss, token, ',')) {
        if (!token.empty()) {
            result.push_back(static_cast<int16_t>(std::stoi(token)));
        }
    }
    return result;
}

int32_t SensorRepository::create_heater_profile(const HeaterProfileRecord& profile) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("SensorRepository: failed to acquire connection");
        return -1;
    }
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "INSERT INTO heater_profiles (name, description, temps, durs, "
            << "preheat_mode, preheat_cycles, preheat_duration_s, is_builtin) VALUES ("
            << txn.quote(profile.name) << ", "
            << txn.quote(profile.description) << ", "
            << to_pg_array(profile.temps) << ", "
            << to_pg_array(profile.durs) << ", "
            << txn.quote(profile.preheat_mode) << ", "
            << (profile.preheat_cycles ? std::to_string(*profile.preheat_cycles) : "NULL") << ", "
            << (profile.preheat_duration_s ? std::to_string(*profile.preheat_duration_s) : "NULL") << ", "
            << (profile.is_builtin ? "TRUE" : "FALSE")
            << ") RETURNING id";
        
        auto result = txn.exec(sql.str());
        txn.commit();
        
        int32_t id = result[0][0].as<int32_t>();
        spdlog::info("SensorRepository: created heater profile '{}' with id={}", profile.name, id);
        return id;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: create_heater_profile error: {}", e.what());
        return -1;
    }
}

bool SensorRepository::update_heater_profile(const HeaterProfileRecord& profile) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return false;
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "UPDATE heater_profiles SET "
            << "name = " << txn.quote(profile.name) << ", "
            << "description = " << txn.quote(profile.description) << ", "
            << "temps = " << to_pg_array(profile.temps) << ", "
            << "durs = " << to_pg_array(profile.durs) << ", "
            << "preheat_mode = " << txn.quote(profile.preheat_mode) << ", "
            << "preheat_cycles = " << (profile.preheat_cycles ? std::to_string(*profile.preheat_cycles) : "NULL") << ", "
            << "preheat_duration_s = " << (profile.preheat_duration_s ? std::to_string(*profile.preheat_duration_s) : "NULL") << ", "
            << "updated_at = NOW() "
            << "WHERE id = " << profile.id << " AND is_builtin = FALSE";
        
        auto result = txn.exec(sql.str());
        txn.commit();
        
        return result.affected_rows() > 0;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: update_heater_profile error: {}", e.what());
        return false;
    }
}

bool SensorRepository::delete_heater_profile(int32_t id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return false;
    
    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec(
            "DELETE FROM heater_profiles WHERE id = " + std::to_string(id) + " AND is_builtin = FALSE"
        );
        txn.commit();
        
        return result.affected_rows() > 0;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: delete_heater_profile error: {}", e.what());
        return false;
    }
}

std::optional<HeaterProfileRecord> SensorRepository::get_heater_profile(int32_t id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return std::nullopt;
    
    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec(
            "SELECT id, name, description, temps, durs, preheat_mode, "
            "preheat_cycles, preheat_duration_s, is_builtin FROM heater_profiles WHERE id = " + std::to_string(id)
        );
        
        if (result.empty()) return std::nullopt;
        
        const auto& row = result[0];
        HeaterProfileRecord rec;
        rec.id = row["id"].as<int32_t>();
        rec.name = row["name"].as<std::string>();
        if (!row["description"].is_null()) rec.description = row["description"].as<std::string>();
        rec.temps = parse_pg_array(row["temps"].as<std::string>());
        rec.durs = parse_pg_array(row["durs"].as<std::string>());
        rec.preheat_mode = row["preheat_mode"].as<std::string>();
        if (!row["preheat_cycles"].is_null()) rec.preheat_cycles = row["preheat_cycles"].as<int16_t>();
        if (!row["preheat_duration_s"].is_null()) rec.preheat_duration_s = row["preheat_duration_s"].as<int16_t>();
        rec.is_builtin = row["is_builtin"].as<bool>();
        
        return rec;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: get_heater_profile error: {}", e.what());
        return std::nullopt;
    }
}

std::optional<HeaterProfileRecord> SensorRepository::get_heater_profile_by_name(const std::string& name) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return std::nullopt;
    
    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec(
            "SELECT id, name, description, temps, durs, preheat_mode, "
            "preheat_cycles, preheat_duration_s, is_builtin FROM heater_profiles WHERE name = " + txn.quote(name)
        );
        
        if (result.empty()) return std::nullopt;
        
        const auto& row = result[0];
        HeaterProfileRecord rec;
        rec.id = row["id"].as<int32_t>();
        rec.name = row["name"].as<std::string>();
        if (!row["description"].is_null()) rec.description = row["description"].as<std::string>();
        rec.temps = parse_pg_array(row["temps"].as<std::string>());
        rec.durs = parse_pg_array(row["durs"].as<std::string>());
        rec.preheat_mode = row["preheat_mode"].as<std::string>();
        if (!row["preheat_cycles"].is_null()) rec.preheat_cycles = row["preheat_cycles"].as<int16_t>();
        if (!row["preheat_duration_s"].is_null()) rec.preheat_duration_s = row["preheat_duration_s"].as<int16_t>();
        rec.is_builtin = row["is_builtin"].as<bool>();
        
        return rec;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: get_heater_profile_by_name error: {}", e.what());
        return std::nullopt;
    }
}

std::vector<HeaterProfileRecord> SensorRepository::list_heater_profiles(bool include_builtin) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return {};
    
    try {
        pqxx::work txn(conn.get());
        
        std::string sql = "SELECT id, name, description, temps, durs, preheat_mode, "
                          "preheat_cycles, preheat_duration_s, is_builtin FROM heater_profiles";
        if (!include_builtin) {
            sql += " WHERE is_builtin = FALSE";
        }
        sql += " ORDER BY is_builtin DESC, name";
        
        auto result = txn.exec(sql);
        
        std::vector<HeaterProfileRecord> records;
        for (const auto& row : result) {
            HeaterProfileRecord rec;
            rec.id = row["id"].as<int32_t>();
            rec.name = row["name"].as<std::string>();
            if (!row["description"].is_null()) rec.description = row["description"].as<std::string>();
            rec.temps = parse_pg_array(row["temps"].as<std::string>());
            rec.durs = parse_pg_array(row["durs"].as<std::string>());
            rec.preheat_mode = row["preheat_mode"].as<std::string>();
            if (!row["preheat_cycles"].is_null()) rec.preheat_cycles = row["preheat_cycles"].as<int16_t>();
            if (!row["preheat_duration_s"].is_null()) rec.preheat_duration_s = row["preheat_duration_s"].as<int16_t>();
            rec.is_builtin = row["is_builtin"].as<bool>();
            records.push_back(std::move(rec));
        }
        
        return records;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: list_heater_profiles error: {}", e.what());
        return {};
    }
}

// ============================================================
// 传感器加热配置分配
// ============================================================

int32_t SensorRepository::start_heater_assignment(
    int16_t sensor_idx,
    const HeaterProfileRecord& profile,
    std::optional<int32_t> run_id,
    const std::string& phase_name) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) {
        spdlog::error("SensorRepository: failed to acquire connection");
        return -1;
    }
    
    try {
        pqxx::work txn(conn.get());
        
        // 获取当前时间戳 (毫秒)
        auto now = std::chrono::system_clock::now();
        auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();
        
        // 结束该传感器之前的活跃分配
        txn.exec(
            "UPDATE sensor_heater_assignments SET end_time_ms = " + std::to_string(now_ms) +
            " WHERE sensor_idx = " + std::to_string(sensor_idx) + " AND end_time_ms IS NULL"
        );
        
        // 创建新分配
        std::ostringstream sql;
        sql << "INSERT INTO sensor_heater_assignments "
            << "(start_time_ms, sensor_idx, heater_profile_id, temps_snapshot, durs_snapshot, run_id, phase_name) VALUES ("
            << now_ms << ", "
            << sensor_idx << ", "
            << (profile.id > 0 ? std::to_string(profile.id) : "NULL") << ", "
            << to_pg_array(profile.temps) << ", "
            << to_pg_array(profile.durs) << ", "
            << (run_id ? std::to_string(*run_id) : "NULL") << ", "
            << (phase_name.empty() ? "NULL" : txn.quote(phase_name))
            << ") RETURNING id";
        
        auto result = txn.exec(sql.str());
        txn.commit();
        
        int32_t id = result[0][0].as<int32_t>();
        spdlog::info("SensorRepository: started heater assignment id={} for sensor {} with profile '{}'",
                     id, sensor_idx, profile.name);
        return id;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: start_heater_assignment error: {}", e.what());
        return -1;
    }
}

void SensorRepository::end_heater_assignment(int32_t assignment_id) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return;
    
    try {
        pqxx::work txn(conn.get());
        
        auto now = std::chrono::system_clock::now();
        auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();
        
        txn.exec(
            "UPDATE sensor_heater_assignments SET end_time_ms = " + std::to_string(now_ms) +
            " WHERE id = " + std::to_string(assignment_id)
        );
        txn.commit();
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: end_heater_assignment error: {}", e.what());
    }
}

void SensorRepository::end_active_assignments(int16_t sensor_idx) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return;
    
    try {
        pqxx::work txn(conn.get());
        
        auto now = std::chrono::system_clock::now();
        auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();
        
        txn.exec(
            "UPDATE sensor_heater_assignments SET end_time_ms = " + std::to_string(now_ms) +
            " WHERE sensor_idx = " + std::to_string(sensor_idx) + " AND end_time_ms IS NULL"
        );
        txn.commit();
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: end_active_assignments error: {}", e.what());
    }
}

std::optional<HeaterAssignmentRecord> SensorRepository::get_active_assignment(int16_t sensor_idx) {
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return std::nullopt;
    
    try {
        pqxx::work txn(conn.get());
        
        auto result = txn.exec(
            "SELECT id, start_time_ms, end_time_ms, sensor_idx, heater_profile_id, "
            "temps_snapshot, durs_snapshot, run_id, phase_name, notes "
            "FROM sensor_heater_assignments "
            "WHERE sensor_idx = " + std::to_string(sensor_idx) + " AND end_time_ms IS NULL "
            "ORDER BY start_time_ms DESC LIMIT 1"
        );
        
        if (result.empty()) return std::nullopt;
        
        const auto& row = result[0];
        HeaterAssignmentRecord rec;
        rec.id = row["id"].as<int32_t>();
        rec.start_time_ms = row["start_time_ms"].as<int64_t>();
        if (!row["end_time_ms"].is_null()) rec.end_time_ms = row["end_time_ms"].as<int64_t>();
        rec.sensor_idx = row["sensor_idx"].as<int16_t>();
        if (!row["heater_profile_id"].is_null()) rec.heater_profile_id = row["heater_profile_id"].as<int32_t>();
        rec.temps_snapshot = parse_pg_array(row["temps_snapshot"].as<std::string>());
        rec.durs_snapshot = parse_pg_array(row["durs_snapshot"].as<std::string>());
        if (!row["run_id"].is_null()) rec.run_id = row["run_id"].as<int32_t>();
        if (!row["phase_name"].is_null()) rec.phase_name = row["phase_name"].as<std::string>();
        if (!row["notes"].is_null()) rec.notes = row["notes"].as<std::string>();
        
        return rec;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: get_active_assignment error: {}", e.what());
        return std::nullopt;
    }
}

std::vector<HeaterAssignmentRecord> SensorRepository::get_assignments_in_range(
    int64_t start_ms, int64_t end_ms,
    std::optional<int16_t> sensor_idx) {
    
    auto& pool = ConnectionPool::instance();
    auto conn = pool.acquire();
    if (!conn.valid()) return {};
    
    try {
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT id, start_time_ms, end_time_ms, sensor_idx, heater_profile_id, "
            << "temps_snapshot, durs_snapshot, run_id, phase_name, notes "
            << "FROM sensor_heater_assignments "
            << "WHERE start_time_ms <= " << end_ms
            << " AND (end_time_ms IS NULL OR end_time_ms >= " << start_ms << ")";
        
        if (sensor_idx) {
            sql << " AND sensor_idx = " << *sensor_idx;
        }
        
        sql << " ORDER BY sensor_idx, start_time_ms";
        
        auto result = txn.exec(sql.str());
        
        std::vector<HeaterAssignmentRecord> records;
        for (const auto& row : result) {
            HeaterAssignmentRecord rec;
            rec.id = row["id"].as<int32_t>();
            rec.start_time_ms = row["start_time_ms"].as<int64_t>();
            if (!row["end_time_ms"].is_null()) rec.end_time_ms = row["end_time_ms"].as<int64_t>();
            rec.sensor_idx = row["sensor_idx"].as<int16_t>();
            if (!row["heater_profile_id"].is_null()) rec.heater_profile_id = row["heater_profile_id"].as<int32_t>();
            rec.temps_snapshot = parse_pg_array(row["temps_snapshot"].as<std::string>());
            rec.durs_snapshot = parse_pg_array(row["durs_snapshot"].as<std::string>());
            if (!row["run_id"].is_null()) rec.run_id = row["run_id"].as<int32_t>();
            if (!row["phase_name"].is_null()) rec.phase_name = row["phase_name"].as<std::string>();
            if (!row["notes"].is_null()) rec.notes = row["notes"].as<std::string>();
            records.push_back(std::move(rec));
        }
        
        return records;
        
    } catch (const std::exception& e) {
        spdlog::error("SensorRepository: get_assignments_in_range error: {}", e.what());
        return {};
    }
}

} // namespace db
