#pragma once

#include "workflows/action_executor.hpp"
#include "workflows/transaction_guard.hpp"
#include "hal/load_cell_driver.hpp"
#include "hal/sensor_driver.hpp"
#include <memory>

namespace workflows {

/**
 * @brief 采集原语执行器
 * 
 * 负责执行 AcquireAction，包含：
 * - 状态切换到 SAMPLE
 * - 设置气泵 PWM
 * - 根据终止条件等待 (固定时间/加热周期/稳定性)
 * - 恢复初始状态
 */
class AcquireExecutor : public ActionExecutorBase {
public:
    AcquireExecutor(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<hal::LoadCellDriver> load_cell,
        std::shared_ptr<hal::SensorDriver> sensor,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : ActionExecutorBase(std::move(system_state), std::move(hardware_state))
        , load_cell_(std::move(load_cell))
        , sensor_(std::move(sensor))
    {}
    
    std::string name() const override { return "acquire"; }
    
    PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const override;
    
    ExecuteResult execute(const enose::experiment::Step& step) override;
    
    double estimate_duration(
        const enose::experiment::Step& step) const override;
    
    // 采集的幂等性取决于终止条件
    bool is_idempotent() const override { return false; }
    
    std::vector<std::string> required_resources() const override {
        return {"gas_pump", "sensor", "valves"};
    }

private:
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
    std::shared_ptr<hal::SensorDriver> sensor_;
    
    // 等待辅助方法
    void wait_for_duration(double seconds);
    void wait_for_heater_cycles(int count, double timeout_s);
    void wait_for_stability(double window_s, double threshold_percent, double timeout_s);
};

} // namespace workflows
