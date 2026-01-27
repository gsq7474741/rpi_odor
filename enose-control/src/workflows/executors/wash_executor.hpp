#pragma once

#include "workflows/action_executor.hpp"
#include "workflows/transaction_guard.hpp"
#include "hal/load_cell_driver.hpp"
#include <memory>

namespace workflows {

/**
 * @brief 清洗原语执行器
 * 
 * 负责执行 WashAction，包含：
 * - 多次循环清洗
 * - 每次循环: 排废 -> 注入清洗液 -> 排废
 * - 监测重量变化
 * - 恢复初始状态
 */
class WashExecutor : public ActionExecutorBase {
public:
    WashExecutor(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<hal::LoadCellDriver> load_cell,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : ActionExecutorBase(std::move(system_state), std::move(hardware_state))
        , load_cell_(std::move(load_cell))
    {}
    
    std::string name() const override { return "wash"; }
    
    PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const override;
    
    ExecuteResult execute(const enose::experiment::Step& step) override;
    
    double estimate_duration(
        const enose::experiment::Step& step) const override;
    
    // 清洗不是幂等的 - 会消耗清洗液
    bool is_idempotent() const override { return false; }
    
    std::vector<std::string> required_resources() const override {
        return {"clean_pump", "valves", "load_cell"};
    }

private:
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
};

} // namespace workflows
