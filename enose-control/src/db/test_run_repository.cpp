#include "test_run_repository.hpp"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <iomanip>
#include <sstream>

namespace db {

std::string TestRunRepository::format_timestamp(const std::chrono::system_clock::time_point& tp) {
    auto time_t = std::chrono::system_clock::to_time_t(tp);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        tp.time_since_epoch()) % 1000;
    
    std::ostringstream oss;
    oss << std::put_time(std::gmtime(&time_t), "%Y-%m-%d %H:%M:%S");
    oss << '.' << std::setfill('0') << std::setw(3) << ms.count();
    return oss.str();
}

std::chrono::system_clock::time_point TestRunRepository::parse_timestamp(const std::string& ts) {
    std::tm tm = {};
    std::istringstream ss(ts);
    ss >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");
    return std::chrono::system_clock::from_time_t(std::mktime(&tm));
}

std::optional<int> TestRunRepository::create_run(const std::string& config_json, int total_steps) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) {
            spdlog::error("Failed to acquire database connection");
            return std::nullopt;
        }
        
        pqxx::work txn(conn.get());
        auto result = txn.exec_params(
            "INSERT INTO runs (config_json, total_steps, state) VALUES ($1, $2, 'running') RETURNING id",
            config_json, total_steps
        );
        txn.commit();
        
        if (!result.empty()) {
            int run_id = result[0][0].as<int>();
            spdlog::info("Created test run with id={}", run_id);
            return run_id;
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to create run: {}", e.what());
    }
    return std::nullopt;
}

bool TestRunRepository::update_run_state(int run_id, const std::string& state, 
                                          int current_step, const std::string& error_msg) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        
        if (current_step >= 0 && !error_msg.empty()) {
            txn.exec_params(
                "UPDATE runs SET state=$1, current_step=$2, error_message=$3 WHERE id=$4",
                state, current_step, error_msg, run_id
            );
        } else if (current_step >= 0) {
            txn.exec_params(
                "UPDATE runs SET state=$1, current_step=$2 WHERE id=$3",
                state, current_step, run_id
            );
        } else if (!error_msg.empty()) {
            txn.exec_params(
                "UPDATE runs SET state=$1, error_message=$2 WHERE id=$3",
                state, error_msg, run_id
            );
        } else {
            txn.exec_params(
                "UPDATE runs SET state=$1 WHERE id=$2",
                state, run_id
            );
        }
        
        txn.commit();
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to update run state: {}", e.what());
        return false;
    }
}

bool TestRunRepository::complete_run(int run_id, const std::string& state) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec_params(
            "UPDATE runs SET state=$1, completed_at=NOW() WHERE id=$2",
            state, run_id
        );
        txn.commit();
        
        spdlog::info("Completed test run id={} with state={}", run_id, state);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to complete run: {}", e.what());
        return false;
    }
}

std::optional<TestRunRecord> TestRunRepository::get_run(int run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        auto result = txn.exec_params(
            "SELECT id, created_at, completed_at, state, config_json, "
            "current_step, total_steps, error_message, metadata "
            "FROM runs WHERE id=$1",
            run_id
        );
        txn.commit();
        
        if (result.empty()) return std::nullopt;
        
        TestRunRecord record;
        record.id = result[0]["id"].as<int>();
        record.created_at = parse_timestamp(result[0]["created_at"].as<std::string>());
        if (!result[0]["completed_at"].is_null()) {
            record.completed_at = parse_timestamp(result[0]["completed_at"].as<std::string>());
        }
        record.state = result[0]["state"].as<std::string>();
        record.config_json = result[0]["config_json"].as<std::string>();
        record.current_step = result[0]["current_step"].as<int>();
        record.total_steps = result[0]["total_steps"].as<int>();
        if (!result[0]["error_message"].is_null()) {
            record.error_message = result[0]["error_message"].as<std::string>();
        }
        if (!result[0]["metadata"].is_null()) {
            record.metadata_json = result[0]["metadata"].as<std::string>();
        }
        
        return record;
    } catch (const std::exception& e) {
        spdlog::error("Failed to get run: {}", e.what());
        return std::nullopt;
    }
}

std::optional<TestRunRecord> TestRunRepository::get_running_test() {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        
        pqxx::work txn(conn.get());
        auto result = txn.exec(
            "SELECT id, created_at, completed_at, state, config_json, "
            "current_step, total_steps, error_message, metadata "
            "FROM runs WHERE state='running' ORDER BY created_at DESC LIMIT 1"
        );
        txn.commit();
        
        if (result.empty()) return std::nullopt;
        
        TestRunRecord record;
        record.id = result[0]["id"].as<int>();
        record.created_at = parse_timestamp(result[0]["created_at"].as<std::string>());
        record.state = result[0]["state"].as<std::string>();
        record.config_json = result[0]["config_json"].as<std::string>();
        record.current_step = result[0]["current_step"].as<int>();
        record.total_steps = result[0]["total_steps"].as<int>();
        
        return record;
    } catch (const std::exception& e) {
        spdlog::error("Failed to get running test: {}", e.what());
        return std::nullopt;
    }
}

std::vector<TestRunRecord> TestRunRepository::list_runs(int limit, int offset, 
                                                         const std::string& state_filter) {
    std::vector<TestRunRecord> records;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return records;
        
        pqxx::work txn(conn.get());
        pqxx::result result;
        
        if (state_filter.empty()) {
            result = txn.exec_params(
                "SELECT id, created_at, completed_at, state, config_json, "
                "current_step, total_steps, error_message, metadata "
                "FROM runs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
                limit, offset
            );
        } else {
            result = txn.exec_params(
                "SELECT id, created_at, completed_at, state, config_json, "
                "current_step, total_steps, error_message, metadata "
                "FROM runs WHERE state=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
                state_filter, limit, offset
            );
        }
        txn.commit();
        
        for (const auto& row : result) {
            TestRunRecord record;
            record.id = row["id"].as<int>();
            record.created_at = parse_timestamp(row["created_at"].as<std::string>());
            if (!row["completed_at"].is_null()) {
                record.completed_at = parse_timestamp(row["completed_at"].as<std::string>());
            }
            record.state = row["state"].as<std::string>();
            record.config_json = row["config_json"].as<std::string>();
            record.current_step = row["current_step"].as<int>();
            record.total_steps = row["total_steps"].as<int>();
            records.push_back(record);
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to list runs: {}", e.what());
    }
    
    return records;
}

bool TestRunRepository::insert_result(int run_id, const workflows::TestResult& result) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec_params(
            "INSERT INTO test_results (run_id, param_set_id, param_set_name, cycle, "
            "total_volume, pump0_volume, pump1_volume, pump2_volume, pump3_volume, "
            "pump4_volume, pump5_volume, pump6_volume, pump7_volume, "
            "speed, empty_weight, full_weight, injected_weight, "
            "drain_duration_ms, wait_empty_duration_ms, inject_duration_ms, "
            "wait_stable_duration_ms, total_duration_ms) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)",
            run_id, result.param_set_id, result.param_set_name, result.cycle,
            result.total_volume, result.pump0_volume, result.pump1_volume,
            result.pump2_volume, result.pump3_volume,
            result.pump4_volume, result.pump5_volume,
            result.pump6_volume, result.pump7_volume, result.speed,
            result.empty_weight, result.full_weight, result.injected_weight,
            result.drain_duration_ms, result.wait_empty_duration_ms,
            result.inject_duration_ms, result.wait_stable_duration_ms, result.total_duration_ms
        );
        txn.commit();
        
        spdlog::debug("Inserted test result for run_id={}, cycle={}", run_id, result.cycle);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to insert result: {}", e.what());
        return false;
    }
}

std::vector<TestResultRecord> TestRunRepository::get_results(int run_id) {
    std::vector<TestResultRecord> records;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return records;
        
        pqxx::work txn(conn.get());
        auto result = txn.exec_params(
            "SELECT * FROM test_results WHERE run_id=$1 ORDER BY time",
            run_id
        );
        txn.commit();
        
        for (const auto& row : result) {
            TestResultRecord record;
            record.id = row["id"].as<int>();
            record.run_id = row["run_id"].as<int>();
            record.time = parse_timestamp(row["time"].as<std::string>());
            record.param_set_id = row["param_set_id"].as<int>();
            record.param_set_name = row["param_set_name"].as<std::string>();
            record.cycle = row["cycle"].as<int>();
            record.total_volume = row["total_volume"].as<float>();
            record.pump0_volume = row["pump0_volume"].as<float>(0);
            record.pump1_volume = row["pump1_volume"].as<float>(0);
            record.pump2_volume = row["pump2_volume"].as<float>();
            record.pump3_volume = row["pump3_volume"].as<float>();
            record.pump4_volume = row["pump4_volume"].as<float>();
            record.pump5_volume = row["pump5_volume"].as<float>();
            record.pump6_volume = row["pump6_volume"].as<float>(0);
            record.pump7_volume = row["pump7_volume"].as<float>(0);
            record.speed = row["speed"].as<float>();
            record.empty_weight = row["empty_weight"].as<float>();
            record.full_weight = row["full_weight"].as<float>();
            record.injected_weight = row["injected_weight"].as<float>();
            record.drain_duration_ms = row["drain_duration_ms"].as<int64_t>();
            record.wait_empty_duration_ms = row["wait_empty_duration_ms"].as<int64_t>();
            record.inject_duration_ms = row["inject_duration_ms"].as<int64_t>();
            record.wait_stable_duration_ms = row["wait_stable_duration_ms"].as<int64_t>();
            record.total_duration_ms = row["total_duration_ms"].as<int64_t>();
            records.push_back(record);
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to get results: {}", e.what());
    }
    
    return records;
}

bool TestRunRepository::insert_weight_sample(int run_id, int cycle, const std::string& phase,
                                              float weight, bool is_stable, const std::string& trend) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        txn.exec_params(
            "INSERT INTO weight_samples (time, run_id, cycle, phase, weight, is_stable, trend) "
            "VALUES (NOW(), $1, $2, $3, $4, $5, $6)",
            run_id, cycle, phase, weight, is_stable, trend
        );
        txn.commit();
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to insert weight sample: {}", e.what());
        return false;
    }
}

bool TestRunRepository::insert_weight_samples(const std::vector<WeightSampleRecord>& samples) {
    if (samples.empty()) return true;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return false;
        
        pqxx::work txn(conn.get());
        
        // 使用 COPY 或批量 INSERT 提高性能
        std::ostringstream sql;
        sql << "INSERT INTO weight_samples (time, run_id, cycle, phase, weight, is_stable, trend) VALUES ";
        
        bool first = true;
        for (const auto& s : samples) {
            if (!first) sql << ",";
            first = false;
            sql << "('" << format_timestamp(s.time) << "',"
                << s.run_id << ","
                << s.cycle << ","
                << txn.quote(s.phase) << ","
                << s.weight << ","
                << (s.is_stable ? "true" : "false") << ","
                << txn.quote(s.trend) << ")";
        }
        
        txn.exec(sql.str());
        txn.commit();
        
        spdlog::debug("Inserted {} weight samples", samples.size());
        return true;
    } catch (const std::exception& e) {
        spdlog::error("Failed to insert weight samples: {}", e.what());
        return false;
    }
}

std::vector<WeightSampleRecord> TestRunRepository::get_weight_samples(int run_id,
    std::optional<int> cycle,
    std::optional<std::chrono::system_clock::time_point> start_time,
    std::optional<std::chrono::system_clock::time_point> end_time,
    int limit) {
    
    std::vector<WeightSampleRecord> records;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return records;
        
        pqxx::work txn(conn.get());
        
        std::ostringstream sql;
        sql << "SELECT time, run_id, cycle, phase, weight, is_stable, trend "
            << "FROM weight_samples WHERE run_id=" << run_id;
        
        if (cycle) {
            sql << " AND cycle=" << *cycle;
        }
        if (start_time) {
            sql << " AND time >= '" << format_timestamp(*start_time) << "'";
        }
        if (end_time) {
            sql << " AND time <= '" << format_timestamp(*end_time) << "'";
        }
        
        sql << " ORDER BY time LIMIT " << limit;
        
        auto result = txn.exec(sql.str());
        txn.commit();
        
        for (const auto& row : result) {
            WeightSampleRecord record;
            record.time = parse_timestamp(row["time"].as<std::string>());
            record.run_id = row["run_id"].as<int>();
            record.cycle = row["cycle"].as<int>();
            record.phase = row["phase"].as<std::string>();
            record.weight = row["weight"].as<float>();
            record.is_stable = row["is_stable"].as<bool>();
            if (!row["trend"].is_null()) {
                record.trend = row["trend"].as<std::string>();
            }
            records.push_back(record);
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to get weight samples: {}", e.what());
    }
    
    return records;
}

std::vector<WeightSampleRecord> TestRunRepository::get_recent_weight_samples(int run_id, int last_n) {
    std::vector<WeightSampleRecord> records;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return records;
        
        pqxx::work txn(conn.get());
        auto result = txn.exec_params(
            "SELECT time, run_id, cycle, phase, weight, is_stable, trend "
            "FROM weight_samples WHERE run_id=$1 "
            "ORDER BY time DESC LIMIT $2",
            run_id, last_n
        );
        txn.commit();
        
        // 反转顺序使其按时间正序
        for (auto it = result.rbegin(); it != result.rend(); ++it) {
            WeightSampleRecord record;
            record.time = parse_timestamp((*it)["time"].as<std::string>());
            record.run_id = (*it)["run_id"].as<int>();
            record.cycle = (*it)["cycle"].as<int>();
            record.phase = (*it)["phase"].as<std::string>();
            record.weight = (*it)["weight"].as<float>();
            record.is_stable = (*it)["is_stable"].as<bool>();
            if (!(*it)["trend"].is_null()) {
                record.trend = (*it)["trend"].as<std::string>();
            }
            records.push_back(record);
        }
    } catch (const std::exception& e) {
        spdlog::error("Failed to get recent weight samples: {}", e.what());
    }
    
    return records;
}

} // namespace db
