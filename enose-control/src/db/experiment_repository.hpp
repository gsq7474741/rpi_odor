#pragma once

#include "connection_pool.hpp"
#include <optional>
#include <vector>
#include <string>
#include <chrono>

namespace db {

// ============================================================
// 实验运行记录
// ============================================================
struct ExperimentRunRecord {
    int64_t id{0};
    std::string program_id;
    std::string program_name;
    std::string program_yaml;
    std::string program_yaml_hash;  // SHA256 hash of program YAML
    std::string config_json;
    std::string state;  // running, paused, completed, error, aborted
    int current_step{0};
    int total_steps{0};
    std::string current_step_name;
    double elapsed_s{0.0};
    bool can_resume{false};
    std::string error_message;
    std::chrono::system_clock::time_point created_at;
    std::chrono::system_clock::time_point last_checkpoint_at;
};

// ============================================================
// 实验日志记录
// ============================================================
struct ExperimentLogRecord {
    int64_t id{0};
    int64_t run_id{0};
    std::string level;  // info, warn, error
    std::string message;
    std::chrono::system_clock::time_point timestamp;
};

// ============================================================
// 实验仓库
// ============================================================
class ExperimentRepository {
public:
    ExperimentRepository() = default;
    explicit ExperimentRepository(std::shared_ptr<ConnectionPool> pool);
    
    // 创建实验运行记录
    std::optional<int64_t> create_run(
        const std::string& program_id,
        const std::string& program_name,
        const std::string& program_yaml,
        const std::string& program_yaml_hash,
        const std::string& config_json,
        int total_steps);
    
    // 更新执行进度
    void update_progress(
        int64_t run_id,
        int current_step,
        const std::string& step_name,
        double elapsed_s);
    
    // 更新状态
    void update_state(int64_t run_id, const std::string& state);
    
    // 完成实验
    void complete_run(int64_t run_id);
    
    // 错误中止
    void fail_run(int64_t run_id, const std::string& error_message);
    
    // 用户中止
    void abort_run(int64_t run_id);
    
    // 暂停实验
    void pause_run(int64_t run_id);
    
    // 恢复实验
    void resume_run(int64_t run_id);
    
    // 获取可恢复的运行
    std::optional<ExperimentRunRecord> get_resumable_run();
    
    // 获取运行记录
    std::optional<ExperimentRunRecord> get_run(int64_t run_id);
    
    // 获取最近的运行记录
    std::vector<ExperimentRunRecord> get_recent_runs(int limit = 10);
    
    // 添加日志
    void add_log(int64_t run_id, const std::string& level, const std::string& message);
    
    // 获取日志
    std::vector<ExperimentLogRecord> get_logs(int64_t run_id, int limit = 100);

private:
    std::shared_ptr<ConnectionPool> pool_;
};

} // namespace db
