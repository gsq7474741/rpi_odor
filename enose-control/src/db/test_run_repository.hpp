#pragma once

#include "connection_pool.hpp"
#include "../workflows/test_controller.hpp"
#include <optional>
#include <vector>
#include <chrono>

namespace db {

// 测试运行记录 (对应 runs 表)
struct TestRunRecord {
    int id{0};
    std::chrono::system_clock::time_point created_at;
    std::optional<std::chrono::system_clock::time_point> completed_at;
    std::string state;  // running, completed, error, aborted
    std::string config_json;
    int current_step{0};
    int total_steps{0};
    std::string error_message;
    std::string metadata_json;
};

// 测试结果记录 (对应 test_results 表)
struct TestResultRecord {
    int id{0};
    int run_id{0};
    std::chrono::system_clock::time_point time;
    int param_set_id{0};
    std::string param_set_name;
    int cycle{0};
    float total_volume{0};
    float pump0_volume{0};
    float pump1_volume{0};
    float pump2_volume{0};
    float pump3_volume{0};
    float pump4_volume{0};
    float pump5_volume{0};
    float pump6_volume{0};
    float pump7_volume{0};
    float speed{0};
    float empty_weight{0};
    float full_weight{0};
    float injected_weight{0};
    int64_t drain_duration_ms{0};
    int64_t wait_empty_duration_ms{0};
    int64_t inject_duration_ms{0};
    int64_t wait_stable_duration_ms{0};
    int64_t total_duration_ms{0};
};

// 称重样本记录 (对应 weight_samples 表)
struct WeightSampleRecord {
    std::chrono::system_clock::time_point time;
    int run_id{0};
    int cycle{0};
    std::string phase;
    float weight{0};
    bool is_stable{false};
    std::string trend;
};

class TestRunRepository {
public:
    TestRunRepository() = default;
    
    // === 测试运行管理 ===
    
    // 创建新的测试运行记录，返回 run_id
    std::optional<int> create_run(const std::string& config_json, int total_steps);
    
    // 更新运行状态
    bool update_run_state(int run_id, const std::string& state, 
                          int current_step = -1, const std::string& error_msg = "");
    
    // 完成测试运行
    bool complete_run(int run_id, const std::string& state);
    
    // 获取运行记录
    std::optional<TestRunRecord> get_run(int run_id);
    
    // 获取当前正在运行的测试
    std::optional<TestRunRecord> get_running_test();
    
    // 获取测试运行列表 (分页)
    std::vector<TestRunRecord> list_runs(int limit = 50, int offset = 0, 
                                          const std::string& state_filter = "");
    
    // === 测试结果管理 ===
    
    // 插入测试结果
    bool insert_result(int run_id, const workflows::TestResult& result);
    
    // 获取测试结果
    std::vector<TestResultRecord> get_results(int run_id);
    
    // === 称重样本管理 ===
    
    // 批量插入称重样本 (高性能)
    bool insert_weight_samples(const std::vector<WeightSampleRecord>& samples);
    
    // 插入单个称重样本
    bool insert_weight_sample(int run_id, int cycle, const std::string& phase,
                              float weight, bool is_stable, const std::string& trend);
    
    // 获取称重样本 (用于绘图)
    std::vector<WeightSampleRecord> get_weight_samples(int run_id, 
        std::optional<int> cycle = std::nullopt,
        std::optional<std::chrono::system_clock::time_point> start_time = std::nullopt,
        std::optional<std::chrono::system_clock::time_point> end_time = std::nullopt,
        int limit = 10000);
    
    // 获取最近的称重样本 (用于实时图表)
    std::vector<WeightSampleRecord> get_recent_weight_samples(int run_id, int last_n = 100);

private:
    std::string format_timestamp(const std::chrono::system_clock::time_point& tp);
    std::chrono::system_clock::time_point parse_timestamp(const std::string& ts);
};

} // namespace db
