#pragma once

#include "workflows/action_executor.hpp"
#include "workflows/transaction_guard.hpp"
#include "hal/load_cell_driver.hpp"
#include <memory>

namespace workflows {

/**
 * @brief 进样原语执行器
 * 
 * 负责执行 InjectAction，包含：
 * - 状态切换到 INJECT
 * - 启动蠕动泵
 * - 监测重量变化直到达到目标
 * - 记录耗材消耗
 * - 恢复初始状态
 */
class InjectExecutor : public ActionExecutorBase {
public:
    InjectExecutor(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<hal::LoadCellDriver> load_cell,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : ActionExecutorBase(std::move(system_state), std::move(hardware_state))
        , load_cell_(std::move(load_cell))
    {}
    
    std::string name() const override { return "inject"; }
    
    PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const override;
    
    ExecuteResult execute(const enose::experiment::Step& step) override;
    
    double estimate_duration(
        const enose::experiment::Step& step) const override;
    
    bool is_idempotent() const override { return false; }
    
    std::vector<std::string> required_resources() const override {
        return {"peristaltic_pump", "load_cell", "valves"};
    }

private:
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
    
    // 注入回调 (由外部设置)
    std::function<void(const std::string&, float)> consumable_callback_;
};

} // namespace workflows
