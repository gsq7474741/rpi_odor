#pragma once

#include "workflows/hardware_state_machine.hpp"
#include "workflows/transaction_guard.hpp"
#include "enose_experiment.pb.h"
#include <memory>
#include <string>
#include <vector>
#include <optional>
#include <functional>
#include <unordered_map>
#include <chrono>
#include <atomic>

namespace workflows {

/**
 * @brief 原语执行结果
 */
struct ExecuteResult {
    bool success;
    std::string error_message;
    std::optional<std::string> execution_id;  // 用于幂等检查
    double duration_s{0};                      // 执行时间
    
    static ExecuteResult ok(std::string exec_id = "", double duration = 0) {
        return {true, "", 
                exec_id.empty() ? std::nullopt : std::make_optional(exec_id),
                duration};
    }
    
    static ExecuteResult fail(const std::string& error) {
        return {false, error, std::nullopt, 0};
    }
};

/**
 * @brief 前置条件检查结果
 */
struct PreconditionResult {
    bool satisfied;
    std::vector<std::string> failed_conditions;
    
    static PreconditionResult ok() {
        return {true, {}};
    }
    
    static PreconditionResult fail(std::vector<std::string> conditions) {
        return {false, std::move(conditions)};
    }
    
    operator bool() const { return satisfied; }
};

/**
 * @brief 原语执行器接口
 * 
 * 封装每个原语的执行逻辑，提供：
 * - 前置条件验证
 * - 事务性执行
 * - 后置条件保证
 */
class IActionExecutor {
public:
    virtual ~IActionExecutor() = default;
    
    /**
     * @brief 获取执行器名称
     */
    virtual std::string name() const = 0;
    
    /**
     * @brief 检查是否可以执行
     * @param step 步骤定义
     * @return 前置条件检查结果
     */
    virtual PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const = 0;
    
    /**
     * @brief 执行原语
     * @param step 步骤定义
     * @return 执行结果
     */
    virtual ExecuteResult execute(const enose::experiment::Step& step) = 0;
    
    /**
     * @brief 获取预计执行时间
     * @param step 步骤定义
     * @return 预计时间（秒）
     */
    virtual double estimate_duration(
        const enose::experiment::Step& step) const = 0;
    
    /**
     * @brief 是否幂等
     */
    virtual bool is_idempotent() const = 0;
    
    /**
     * @brief 获取资源需求
     */
    virtual std::vector<std::string> required_resources() const = 0;
};

/**
 * @brief 原语执行器基类
 * 
 * 提供通用的事务管理和日志功能
 */
class ActionExecutorBase : public IActionExecutor {
public:
    ActionExecutorBase(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : system_state_(std::move(system_state))
        , hardware_state_(std::move(hardware_state))
    {}
    
protected:
    /**
     * @brief 创建事务守卫
     */
    StateTransactionGuard create_guard(
        std::optional<SystemState::State> target_state,
        const std::string& action_name)
    {
        return StateTransactionGuard(
            system_state_.get(),
            target_state,
            action_name
        );
    }
    
    /**
     * @brief 生成唯一执行ID (用于幂等性)
     * @param action_name 动作名称
     * @return 格式: {action_name}_{timestamp_ms}_{random}
     */
    std::string generate_execution_id(const std::string& action_name) {
        auto now = std::chrono::system_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();
        return action_name + "_" + std::to_string(ms) + "_" + 
               std::to_string(execution_counter_++);
    }
    
    /**
     * @brief 添加日志
     */
    void add_log(const std::string& message);
    
    /**
     * @brief 检查停止/暂停请求
     */
    bool check_stop_or_pause();
    
    std::shared_ptr<SystemState> system_state_;
    std::shared_ptr<HardwareStateMachine> hardware_state_;
    
    // 日志和控制回调 (由外部设置)
    std::function<void(const std::string&)> log_callback_;
    std::function<bool()> stop_check_callback_;
    
private:
    static inline std::atomic<uint64_t> execution_counter_{0};
};

/**
 * @brief 原语执行器工厂
 */
class ActionExecutorFactory {
public:
    /**
     * @brief 获取单例
     */
    static ActionExecutorFactory& instance();
    
    /**
     * @brief 注册执行器
     */
    template<typename T>
    void register_executor() {
        auto executor = std::make_shared<T>();
        executors_[executor->name()] = executor;
    }
    
    /**
     * @brief 获取执行器
     * @param action_type 动作类型名称
     * @return 执行器指针，不存在则返回 nullptr
     */
    std::shared_ptr<IActionExecutor> get_executor(const std::string& action_type);
    
    /**
     * @brief 根据 Step 获取执行器
     */
    std::shared_ptr<IActionExecutor> get_executor_for_step(
        const enose::experiment::Step& step);

private:
    ActionExecutorFactory() = default;
    std::unordered_map<std::string, std::shared_ptr<IActionExecutor>> executors_;
};

} // namespace workflows
