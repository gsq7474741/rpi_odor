#pragma once

#include "workflows/system_state.hpp"
#include <spdlog/spdlog.h>
#include <string>
#include <optional>
#include <functional>
#include <vector>
#include <unordered_map>
#include <mutex>

namespace workflows {

/**
 * @brief 细分硬件状态枚举
 * 
 * 相比 SystemState::State，提供更细粒度的状态划分，
 * 用于更精确地控制状态转换和验证前置/后置条件。
 */
enum class HardwareState {
    // === 空闲状态 ===
    IDLE,                   ///< 系统空闲，所有设备停止
    
    // === 进样相关 ===
    INJECT_PREPARING,       ///< 进样准备中 (阀门切换)
    INJECT_RUNNING,         ///< 进样进行中 (泵运转)
    INJECT_STABILIZING,     ///< 进样稳定中 (等待称重)
    
    // === 排废相关 ===
    DRAIN_PREPARING,        ///< 排废准备中
    DRAIN_RUNNING,          ///< 排废进行中
    
    // === 清洗相关 ===
    CLEAN_PREPARING,        ///< 清洗准备中
    CLEAN_FILLING,          ///< 清洗液注入中
    CLEAN_DRAINING,         ///< 清洗液排出中
    
    // === 采样相关 ===
    SAMPLE_PREPARING,       ///< 采样准备中
    SAMPLE_ACQUIRING,       ///< 数据采集中
    
    // === 错误状态 ===
    ERROR,                  ///< 错误状态
    EMERGENCY_STOP,         ///< 紧急停止
    
    // === 状态数量 ===
    COUNT
};

/**
 * @brief 状态转换结果
 */
struct TransitionResult {
    bool success;
    std::string error_message;
    HardwareState previous_state;
    HardwareState current_state;
    
    static TransitionResult ok(HardwareState prev, HardwareState curr) {
        return {true, "", prev, curr};
    }
    
    static TransitionResult fail(const std::string& error, HardwareState state) {
        return {false, error, state, state};
    }
};

/**
 * @brief 状态转换规则
 */
struct TransitionRule {
    HardwareState from;
    HardwareState to;
    std::function<bool()> guard;        ///< 守卫条件 (返回 true 才能转换)
    std::function<void()> on_enter;     ///< 进入新状态时的动作
    std::function<void()> on_exit;      ///< 离开旧状态时的动作
};

/**
 * @brief 硬件状态机
 * 
 * 提供细粒度状态管理，支持：
 * - 状态转换验证
 * - 守卫条件检查
 * - 进入/离开动作
 * - 状态监听
 */
class HardwareStateMachine {
public:
    using StateCallback = std::function<void(HardwareState, HardwareState)>;
    
    explicit HardwareStateMachine(std::shared_ptr<SystemState> legacy_state);
    ~HardwareStateMachine() = default;
    
    /**
     * @brief 请求状态转换
     * @param target 目标状态
     * @return 转换结果
     */
    TransitionResult request_transition(HardwareState target);
    
    /**
     * @brief 强制转换到指定状态 (跳过守卫检查)
     * @param target 目标状态
     * @return 转换结果
     */
    TransitionResult force_transition(HardwareState target);
    
    /**
     * @brief 检查是否可以转换到目标状态
     * @param target 目标状态
     * @return 是否可以转换
     */
    bool can_transition_to(HardwareState target) const;
    
    /**
     * @brief 获取当前状态
     */
    HardwareState current_state() const { return current_state_; }
    
    /**
     * @brief 获取状态名称
     */
    static const char* state_to_string(HardwareState state);
    
    /**
     * @brief 设置状态变化回调
     */
    void set_state_callback(StateCallback callback) { 
        std::lock_guard<std::mutex> lock(mutex_);
        state_callback_ = std::move(callback); 
    }
    
    /**
     * @brief 获取可用的转换目标
     */
    std::vector<HardwareState> get_available_transitions() const;
    
    /**
     * @brief 映射到旧版 SystemState::State
     */
    SystemState::State to_legacy_state(HardwareState state) const;
    
    /**
     * @brief 从旧版状态映射
     */
    HardwareState from_legacy_state(SystemState::State state) const;
    
    /**
     * @brief 紧急停止
     */
    TransitionResult emergency_stop();
    
    /**
     * @brief 从错误状态恢复
     */
    TransitionResult recover_from_error();

private:
    void initialize_transition_rules();
    void apply_legacy_state(HardwareState state);
    
    /**
     * @brief 反向同步回调：当 SystemState (L0) 变化时调用
     * 
     * 解决 Gemini 评估指出的"双重状态机同步风险"：
     * 当底层状态（如急停、硬件事件）直接修改 SystemState 时，
     * HardwareStateMachine 能够感知并同步更新自己的状态。
     */
    void on_legacy_state_changed(SystemState::State old_state, SystemState::State new_state);
    
    std::shared_ptr<SystemState> legacy_state_;
    HardwareState current_state_{HardwareState::IDLE};
    std::vector<TransitionRule> transition_rules_;
    StateCallback state_callback_;
    mutable std::mutex mutex_;
    
    // 状态转换矩阵 (from -> [to1, to2, ...])
    std::unordered_map<HardwareState, std::vector<HardwareState>> valid_transitions_;
};

/**
 * @brief 状态名称字符串数组
 */
inline const char* HardwareStateMachine::state_to_string(HardwareState state) {
    static const char* names[] = {
        "IDLE",
        "INJECT_PREPARING",
        "INJECT_RUNNING",
        "INJECT_STABILIZING",
        "DRAIN_PREPARING",
        "DRAIN_RUNNING",
        "CLEAN_PREPARING",
        "CLEAN_FILLING",
        "CLEAN_DRAINING",
        "SAMPLE_PREPARING",
        "SAMPLE_ACQUIRING",
        "ERROR",
        "EMERGENCY_STOP",
    };
    auto idx = static_cast<size_t>(state);
    if (idx < sizeof(names) / sizeof(names[0])) {
        return names[idx];
    }
    return "UNKNOWN";
}

} // namespace workflows
