#pragma once

#include "workflows/system_state.hpp"
#include "workflows/hardware_state_machine.hpp"
#include <spdlog/spdlog.h>
#include <string>
#include <optional>
#include <utility>

namespace workflows {

/**
 * @brief 状态事务守卫 (RAII)
 * 
 * 用于保证原语执行的事务性：
 * - 构造时记录初始状态
 * - 析构时如未 commit 则 rollback 到初始状态
 * - 保证状态一致性
 * 
 * 使用方式:
 * @code
 * void execute_inject(const InjectAction& action) {
 *     StateTransactionGuard guard(system_state_, SystemState::State::INJECT);
 *     
 *     // 执行进样逻辑...
 *     
 *     guard.commit();  // 成功时提交
 * }
 * @endcode
 */
class StateTransactionGuard {
public:
    /**
     * @brief 构造事务守卫
     * @param state_machine 状态机引用
     * @param target_state 目标状态 (可选，若指定则自动切换)
     * @param action_name 动作名称 (用于日志)
     */
    explicit StateTransactionGuard(
        SystemState* state_machine,
        std::optional<SystemState::State> target_state = std::nullopt,
        std::string action_name = "unnamed"
    )
        : state_machine_(state_machine)
        , initial_state_(state_machine->get_state())
        , action_name_(std::move(action_name))
        , committed_(false)
    {
        spdlog::debug("StateTransactionGuard: Begin '{}' (initial state: {})",
            action_name_, SystemState::state_to_string(initial_state_));
        
        // 如果指定了目标状态，自动切换
        if (target_state.has_value()) {
            state_machine_->transition_to(target_state.value());
        }
    }
    
    ~StateTransactionGuard() {
        if (!committed_) {
            // 回滚：恢复到初始状态
            spdlog::warn("StateTransactionGuard: Rollback '{}' ({} → {})",
                action_name_,
                SystemState::state_to_string(state_machine_->get_state()),
                SystemState::state_to_string(initial_state_));
            
            state_machine_->transition_to(initial_state_);
        } else {
            spdlog::debug("StateTransactionGuard: Commit '{}' (final state: {})",
                action_name_,
                SystemState::state_to_string(state_machine_->get_state()));
        }
    }
    
    // 禁止拷贝
    StateTransactionGuard(const StateTransactionGuard&) = delete;
    StateTransactionGuard& operator=(const StateTransactionGuard&) = delete;
    
    // 允许移动
    StateTransactionGuard(StateTransactionGuard&& other) noexcept
        : state_machine_(other.state_machine_)
        , initial_state_(other.initial_state_)
        , action_name_(std::move(other.action_name_))
        , committed_(other.committed_)
    {
        other.committed_ = true;  // 防止被移动的对象析构时回滚
    }
    
    StateTransactionGuard& operator=(StateTransactionGuard&& other) noexcept {
        if (this != &other) {
            state_machine_ = other.state_machine_;
            initial_state_ = other.initial_state_;
            action_name_ = std::move(other.action_name_);
            committed_ = other.committed_;
            other.committed_ = true;
        }
        return *this;
    }
    
    /**
     * @brief 提交事务
     * 
     * 调用后析构时不会回滚
     */
    void commit() {
        committed_ = true;
    }
    
    /**
     * @brief 提交事务并恢复到指定状态
     * @param final_state 最终状态
     */
    void commit_with_state(SystemState::State final_state) {
        state_machine_->transition_to(final_state);
        committed_ = true;
    }
    
    /**
     * @brief 提交事务并恢复到初始状态
     */
    void commit_and_restore() {
        state_machine_->transition_to(initial_state_);
        committed_ = true;
    }
    
    /**
     * @brief 检查是否已提交
     */
    bool is_committed() const { return committed_; }
    
    /**
     * @brief 获取初始状态
     */
    SystemState::State get_initial_state() const { return initial_state_; }
    
    /**
     * @brief 获取当前状态
     */
    SystemState::State get_current_state() const { return state_machine_->get_state(); }

private:
    SystemState* state_machine_;
    SystemState::State initial_state_;
    std::string action_name_;
    bool committed_;
};

/**
 * @brief 原语执行结果
 */
struct ActionResult {
    bool success;
    std::string error_message;
    std::optional<std::string> execution_id;  // 用于幂等检查
    
    static ActionResult ok(std::string exec_id = "") {
        return {true, "", exec_id.empty() ? std::nullopt : std::make_optional(exec_id)};
    }
    
    static ActionResult fail(std::string error) {
        return {false, std::move(error), std::nullopt};
    }
};

/**
 * @brief 硬件状态事务守卫 (RAII) - 支持细粒度状态
 * 
 * 与 StateTransactionGuard 类似，但操作 HardwareStateMachine (L1)
 * 支持细粒度状态转换和回滚
 */
class HardwareTransactionGuard {
public:
    /**
     * @brief 构造事务守卫
     * @param hardware_sm HardwareStateMachine 引用
     * @param target_state 目标状态 (可选)
     * @param action_name 动作名称 (用于日志)
     */
    explicit HardwareTransactionGuard(
        HardwareStateMachine* hardware_sm,
        std::optional<HardwareState> target_state = std::nullopt,
        std::string action_name = "unnamed"
    )
        : hardware_sm_(hardware_sm)
        , initial_state_(hardware_sm ? hardware_sm->current_state() : HardwareState::IDLE)
        , action_name_(std::move(action_name))
        , committed_(false)
    {
        if (!hardware_sm_) {
            spdlog::warn("HardwareTransactionGuard: null hardware_sm for '{}'", action_name_);
            committed_ = true;  // 无效守卫，直接标记为已提交
            return;
        }
        
        spdlog::debug("HardwareTransactionGuard: Begin '{}' (initial state: {})",
            action_name_, HardwareStateMachine::state_to_string(initial_state_));
        
        // 如果指定了目标状态，尝试转换
        if (target_state.has_value()) {
            auto result = hardware_sm_->request_transition(target_state.value());
            if (!result.success) {
                spdlog::warn("HardwareTransactionGuard: Failed to transition to {} for '{}': {}",
                    HardwareStateMachine::state_to_string(target_state.value()), 
                    action_name_, result.error_message);
            }
        }
    }
    
    ~HardwareTransactionGuard() {
        if (!hardware_sm_) return;
        
        if (!committed_) {
            // 回滚：恢复到初始状态
            spdlog::warn("HardwareTransactionGuard: Rollback '{}' ({} → {})",
                action_name_,
                HardwareStateMachine::state_to_string(hardware_sm_->current_state()),
                HardwareStateMachine::state_to_string(initial_state_));
            
            hardware_sm_->force_transition(initial_state_);
        } else {
            spdlog::debug("HardwareTransactionGuard: Commit '{}' (final state: {})",
                action_name_,
                HardwareStateMachine::state_to_string(hardware_sm_->current_state()));
        }
    }
    
    // 禁止拷贝
    HardwareTransactionGuard(const HardwareTransactionGuard&) = delete;
    HardwareTransactionGuard& operator=(const HardwareTransactionGuard&) = delete;
    
    // 允许移动
    HardwareTransactionGuard(HardwareTransactionGuard&& other) noexcept
        : hardware_sm_(other.hardware_sm_)
        , initial_state_(other.initial_state_)
        , action_name_(std::move(other.action_name_))
        , committed_(other.committed_)
    {
        other.committed_ = true;
    }
    
    /**
     * @brief 提交事务
     */
    void commit() {
        committed_ = true;
    }
    
    /**
     * @brief 提交事务并转换到指定状态
     */
    void commit_with_state(HardwareState final_state) {
        if (hardware_sm_) {
            hardware_sm_->request_transition(final_state);
        }
        committed_ = true;
    }
    
    /**
     * @brief 提交事务并恢复到初始状态
     */
    void commit_and_restore() {
        if (hardware_sm_) {
            hardware_sm_->force_transition(initial_state_);
        }
        committed_ = true;
    }
    
    /**
     * @brief 检查守卫是否有效 (hardware_sm 非空)
     */
    bool is_valid() const { return hardware_sm_ != nullptr; }
    
    /**
     * @brief 检查是否已提交
     */
    bool is_committed() const { return committed_; }
    
    /**
     * @brief 获取初始状态
     */
    HardwareState get_initial_state() const { return initial_state_; }
    
    /**
     * @brief 获取当前状态
     */
    HardwareState get_current_state() const { 
        return hardware_sm_ ? hardware_sm_->current_state() : HardwareState::IDLE; 
    }

private:
    HardwareStateMachine* hardware_sm_;
    HardwareState initial_state_;
    std::string action_name_;
    bool committed_;
};

} // namespace workflows
