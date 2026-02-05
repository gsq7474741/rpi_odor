#include "experiment_repository.hpp"
#include <spdlog/spdlog.h>

namespace db {

ExperimentRepository::ExperimentRepository(std::shared_ptr<ConnectionPool> pool)
    : pool_(std::move(pool)) {}

std::optional<int64_t> ExperimentRepository::create_run(
    const std::string& program_id,
    const std::string& program_name,
    const std::string& program_yaml,
    const std::string& program_yaml_hash,
    const std::string& config_json,
    int total_steps) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) {
            spdlog::error("ExperimentRepository: Failed to acquire connection");
            return std::nullopt;
        }
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            "INSERT INTO runs (program_id, program_name, program_yaml, program_yaml_hash, config_json, "
            "total_steps, state, can_resume, last_checkpoint_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, 'running', true, NOW()) RETURNING id",
            program_id, program_name, program_yaml, program_yaml_hash, config_json, total_steps);
        
        txn.commit();
        
        if (!result.empty()) {
            int64_t run_id = result[0][0].as<int64_t>();
            spdlog::info("创建实验运行记录: run_id={}, hash={}", run_id, program_yaml_hash);
            return run_id;
        }
    } catch (const std::exception& e) {
        spdlog::error("创建实验运行记录失败: {}", e.what());
    }
    
    return std::nullopt;
}

void ExperimentRepository::update_progress(
    int64_t run_id,
    int current_step,
    const std::string& step_name,
    double elapsed_s) {
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET current_step = $1, current_step_name = $2, "
            "elapsed_s = $3, last_checkpoint_at = NOW(), can_resume = true "
            "WHERE id = $4",
            current_step, step_name, elapsed_s, run_id);
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("更新实验进度失败: {}", e.what());
    }
}

void ExperimentRepository::update_state(int64_t run_id, const std::string& state) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET state = $1, last_checkpoint_at = NOW() WHERE id = $2",
            state, run_id);
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("更新实验状态失败: {}", e.what());
    }
}

void ExperimentRepository::complete_run(int64_t run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET state = 'completed', completed_at = NOW(), can_resume = false "
            "WHERE id = $1",
            run_id);
        
        txn.commit();
        spdlog::info("实验完成: run_id={}", run_id);
    } catch (const std::exception& e) {
        spdlog::error("完成实验记录失败: {}", e.what());
    }
}

void ExperimentRepository::fail_run(int64_t run_id, const std::string& error_message) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET state = 'error', completed_at = NOW(), can_resume = false, "
            "error_message = $1 WHERE id = $2",
            error_message, run_id);
        
        txn.commit();
        spdlog::error("实验失败: run_id={}, error={}", run_id, error_message);
    } catch (const std::exception& e) {
        spdlog::error("记录实验失败状态失败: {}", e.what());
    }
}

void ExperimentRepository::abort_run(int64_t run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET state = 'aborted', completed_at = NOW(), can_resume = false "
            "WHERE id = $1",
            run_id);
        
        txn.commit();
        spdlog::info("实验中止: run_id={}", run_id);
    } catch (const std::exception& e) {
        spdlog::error("记录实验中止状态失败: {}", e.what());
    }
}

void ExperimentRepository::pause_run(int64_t run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET state = 'paused', last_checkpoint_at = NOW(), can_resume = true "
            "WHERE id = $1",
            run_id);
        
        txn.commit();
        spdlog::info("实验暂停: run_id={}", run_id);
    } catch (const std::exception& e) {
        spdlog::error("暂停实验失败: {}", e.what());
    }
}

void ExperimentRepository::resume_run(int64_t run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "UPDATE runs SET state = 'running', last_checkpoint_at = NOW() WHERE id = $1",
            run_id);
        
        txn.commit();
        spdlog::info("实验恢复: run_id={}", run_id);
    } catch (const std::exception& e) {
        spdlog::error("恢复实验失败: {}", e.what());
    }
}

std::optional<ExperimentRunRecord> ExperimentRepository::get_resumable_run() {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        pqxx::work txn(conn.get());
        
        auto result = txn.exec(
            "SELECT id, program_id, program_name, program_yaml, program_yaml_hash, config_json, state, "
            "current_step, total_steps, current_step_name, elapsed_s, can_resume, "
            "error_message, created_at, last_checkpoint_at "
            "FROM runs WHERE can_resume = true AND state IN ('running', 'paused') "
            "ORDER BY last_checkpoint_at DESC LIMIT 1");
        
        txn.commit();
        
        if (!result.empty()) {
            ExperimentRunRecord record;
            record.id = result[0][0].as<int64_t>();
            record.program_id = result[0][1].as<std::string>("");
            record.program_name = result[0][2].as<std::string>("");
            record.program_yaml = result[0][3].as<std::string>("");
            record.program_yaml_hash = result[0][4].as<std::string>("");
            record.config_json = result[0][5].as<std::string>("{}");
            record.state = result[0][6].as<std::string>();
            record.current_step = result[0][7].as<int>(0);
            record.total_steps = result[0][8].as<int>(0);
            record.current_step_name = result[0][9].as<std::string>("");
            record.elapsed_s = result[0][10].as<double>(0.0);
            record.can_resume = result[0][11].as<bool>(false);
            record.error_message = result[0][12].as<std::string>("");
            
            spdlog::info("找到可恢复的实验: run_id={}, step={}/{}", 
                        record.id, record.current_step, record.total_steps);
            return record;
        }
    } catch (const std::exception& e) {
        spdlog::error("查询可恢复实验失败: {}", e.what());
    }
    
    return std::nullopt;
}

std::optional<ExperimentRunRecord> ExperimentRepository::get_run(int64_t run_id) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return std::nullopt;
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            "SELECT id, program_id, program_name, program_yaml, program_yaml_hash, config_json, state, "
            "current_step, total_steps, current_step_name, elapsed_s, can_resume, "
            "error_message, created_at, last_checkpoint_at "
            "FROM runs WHERE id = $1",
            run_id);
        
        txn.commit();
        
        if (!result.empty()) {
            ExperimentRunRecord record;
            record.id = result[0][0].as<int64_t>();
            record.program_id = result[0][1].as<std::string>("");
            record.program_name = result[0][2].as<std::string>("");
            record.program_yaml = result[0][3].as<std::string>("");
            record.program_yaml_hash = result[0][4].as<std::string>("");
            record.config_json = result[0][5].as<std::string>("{}");
            record.state = result[0][6].as<std::string>();
            record.current_step = result[0][7].as<int>(0);
            record.total_steps = result[0][8].as<int>(0);
            record.current_step_name = result[0][9].as<std::string>("");
            record.elapsed_s = result[0][10].as<double>(0.0);
            record.can_resume = result[0][11].as<bool>(false);
            record.error_message = result[0][12].as<std::string>("");
            return record;
        }
    } catch (const std::exception& e) {
        spdlog::error("查询实验运行记录失败: {}", e.what());
    }
    
    return std::nullopt;
}

std::vector<ExperimentRunRecord> ExperimentRepository::get_recent_runs(int limit) {
    std::vector<ExperimentRunRecord> records;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return records;
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            "SELECT id, program_id, program_name, program_yaml, program_yaml_hash, config_json, state, "
            "current_step, total_steps, current_step_name, elapsed_s, can_resume, "
            "error_message, created_at, last_checkpoint_at "
            "FROM runs ORDER BY created_at DESC LIMIT $1",
            limit);
        
        txn.commit();
        
        for (const auto& row : result) {
            ExperimentRunRecord record;
            record.id = row[0].as<int64_t>();
            record.program_id = row[1].as<std::string>("");
            record.program_name = row[2].as<std::string>("");
            record.program_yaml = row[3].as<std::string>("");
            record.program_yaml_hash = row[4].as<std::string>("");
            record.config_json = row[5].as<std::string>("{}");
            record.state = row[6].as<std::string>();
            record.current_step = row[7].as<int>(0);
            record.total_steps = row[8].as<int>(0);
            record.current_step_name = row[9].as<std::string>("");
            record.elapsed_s = row[10].as<double>(0.0);
            record.can_resume = row[11].as<bool>(false);
            record.error_message = row[12].as<std::string>("");
            records.push_back(record);
        }
    } catch (const std::exception& e) {
        spdlog::error("查询最近运行记录失败: {}", e.what());
    }
    
    return records;
}

void ExperimentRepository::add_log(int64_t run_id, const std::string& level, const std::string& message) {
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return;
        pqxx::work txn(conn.get());
        
        txn.exec_params(
            "INSERT INTO experiment_logs (run_id, level, message) VALUES ($1, $2, $3)",
            run_id, level, message);
        
        txn.commit();
    } catch (const std::exception& e) {
        spdlog::error("添加实验日志失败: {}", e.what());
    }
}

std::vector<ExperimentLogRecord> ExperimentRepository::get_logs(int64_t run_id, int limit) {
    std::vector<ExperimentLogRecord> logs;
    
    try {
        auto conn = ConnectionPool::instance().acquire();
        if (!conn.valid()) return logs;
        pqxx::work txn(conn.get());
        
        auto result = txn.exec_params(
            "SELECT id, run_id, level, message, timestamp "
            "FROM experiment_logs WHERE run_id = $1 "
            "ORDER BY timestamp DESC LIMIT $2",
            run_id, limit);
        
        txn.commit();
        
        for (const auto& row : result) {
            ExperimentLogRecord log;
            log.id = row[0].as<int64_t>();
            log.run_id = row[1].as<int64_t>();
            log.level = row[2].as<std::string>();
            log.message = row[3].as<std::string>();
            logs.push_back(log);
        }
    } catch (const std::exception& e) {
        spdlog::error("查询实验日志失败: {}", e.what());
    }
    
    return logs;
}

} // namespace db
