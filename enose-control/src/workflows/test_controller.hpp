#pragma once

#include <atomic>
#include <chrono>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

namespace workflows {

// 测试状态枚举
enum class TestState {
    IDLE,           // 空闲
    DRAINING,       // 排废中
    WAITING_EMPTY,  // 等待空瓶稳定
    INJECTING,      // 进样中
    WAITING_STABLE, // 等待称重稳定
    COMPLETE,       // 测试完成
    ERROR,          // 错误状态
    STOPPING        // 正在停止
};

// 单组参数配置
struct ParamSet {
    int id;
    std::string name;
    float pump2_volume;  // mm
    float pump3_volume;  // mm
    float pump4_volume;  // mm
    float pump5_volume;  // mm
    float speed;         // mm/s
    int cycles;
};

// 测试配置
struct TestConfig {
    std::vector<ParamSet> param_sets;
    float accel;                    // mm/s²
    float empty_tolerance;          // g
    float drain_stability_window;   // s
};

// 单次测试结果
struct TestResult {
    int param_set_id;
    std::string param_set_name;
    int cycle;
    float total_volume;      // mm
    float pump2_volume;
    float pump3_volume;
    float pump4_volume;
    float pump5_volume;
    float speed;
    float empty_weight;      // g
    float full_weight;       // g
    float injected_weight;   // g
    int64_t drain_duration_ms;
    int64_t wait_empty_duration_ms;
    int64_t inject_duration_ms;
    int64_t wait_stable_duration_ms;
    int64_t total_duration_ms;
    std::chrono::system_clock::time_point timestamp;
};

// 测试状态信息
struct TestStatus {
    TestState state;
    int current_param_set;      // 1-based
    int total_param_sets;
    int current_cycle;          // 1-based
    int total_cycles;           // 当前参数组的总循环数
    int global_cycle;           // 全局循环计数
    int global_total_cycles;    // 全局总循环数
    std::string current_param_name;
    std::string message;
    std::vector<std::string> logs;  // 最近日志
    std::optional<float> dynamic_empty_weight;
};

// 回调函数类型
using SetSystemStateFunc = std::function<bool(const std::string& state)>;
using StartInjectionFunc = std::function<bool(float p2, float p3, float p4, float p5, float speed, float accel)>;
using WaitForEmptyBottleFunc = std::function<std::pair<bool, float>(float tolerance, float timeout_sec, float stability_window_sec)>;
using GetWeightFunc = std::function<std::pair<float, bool>()>;  // 返回 (weight, is_stable)
using ResetDynamicEmptyWeightFunc = std::function<void()>;

class TestController {
public:
    TestController();
    ~TestController();

    // 设置回调函数
    void set_system_state_callback(SetSystemStateFunc func) { set_system_state_ = std::move(func); }
    void set_injection_callback(StartInjectionFunc func) { start_injection_ = std::move(func); }
    void set_wait_empty_callback(WaitForEmptyBottleFunc func) { wait_for_empty_bottle_ = std::move(func); }
    void set_get_weight_callback(GetWeightFunc func) { get_weight_ = std::move(func); }
    void set_reset_empty_weight_callback(ResetDynamicEmptyWeightFunc func) { reset_dynamic_empty_weight_ = std::move(func); }

    // 启动测试
    bool start_test(const TestConfig& config);
    
    // 停止测试
    void stop_test();
    
    // 获取状态
    TestStatus get_status() const;
    
    // 获取结果
    std::vector<TestResult> get_results() const;
    
    // 清除结果
    void clear_results();

private:
    void test_thread_func();
    void run_single_cycle(const ParamSet& param_set, int cycle_num);
    void add_log(const std::string& msg);
    bool wait_for_weight_stable(float timeout_sec = 30.0f);

    // 回调函数
    SetSystemStateFunc set_system_state_;
    StartInjectionFunc start_injection_;
    WaitForEmptyBottleFunc wait_for_empty_bottle_;
    GetWeightFunc get_weight_;
    ResetDynamicEmptyWeightFunc reset_dynamic_empty_weight_;

    // 状态
    mutable std::mutex mutex_;
    std::atomic<TestState> state_{TestState::IDLE};
    std::atomic<bool> stop_requested_{false};
    
    // 测试配置
    TestConfig config_;
    
    // 进度
    int current_param_set_{0};
    int current_cycle_{0};
    int global_cycle_{0};
    int global_total_cycles_{0};
    std::string current_param_name_;
    std::string message_;
    
    // 日志 (保留最近100条)
    std::deque<std::string> logs_;
    static constexpr size_t MAX_LOGS = 100;
    
    // 结果
    std::vector<TestResult> results_;
    
    // 动态空瓶值
    std::optional<float> dynamic_empty_weight_;
    
    // 测试线程
    std::unique_ptr<std::thread> test_thread_;
};

} // namespace workflows
