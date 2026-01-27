#pragma once

#include "workflows/action_executor.hpp"
#include "workflows/transaction_guard.hpp"
#include "hal/load_cell_driver.hpp"
#include <memory>

namespace workflows {

/**
 * @brief 排废原语执行器
 * 
 * 负责执行 DrainAction，包含：
 * - 状态切换到 DRAIN
 * - 等待空瓶稳定
 * - 恢复初始状态
 */
class DrainExecutor : public ActionExecutorBase {
public:
    DrainExecutor(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<hal::LoadCellDriver> load_cell,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : ActionExecutorBase(std::move(system_state), std::move(hardware_state))
        , load_cell_(std::move(load_cell))
    {}
    
    std::string name() const override { return "drain"; }
    
    PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const override;
    
    ExecuteResult execute(const enose::experiment::Step& step) override;
    
    double estimate_duration(
        const enose::experiment::Step& step) const override;
    
    // 排废是幂等的 - 多次执行结果相同
    bool is_idempotent() const override { return true; }
    
    std::vector<std::string> required_resources() const override {
        return {"valves", "load_cell"};
    }

private:
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
};

} // namespace workflows
