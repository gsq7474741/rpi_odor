#pragma once

#include "workflows/action_executor.hpp"
#include "workflows/transaction_guard.hpp"
#include "hal/sensor_driver.hpp"
#include "db/sensor_repository.hpp"
#include <memory>

namespace workflows {

/**
 * @brief 预热原语执行器
 * 
 * 负责执行 PreheatAction，包含：
 * - 设置气泵 PWM
 * - 启动传感器采集
 * - 启用数据持久化 (phase_name = "PREHEAT")
 * - 根据模式等待 (周期数/固定时间)
 * - 等待预热完成
 */
class PreheatExecutor : public ActionExecutorBase {
public:
    PreheatExecutor(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<hal::SensorDriver> sensor,
        std::shared_ptr<db::SensorRepository> sensor_repo = nullptr,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : ActionExecutorBase(std::move(system_state), std::move(hardware_state))
        , sensor_(std::move(sensor))
        , sensor_repo_(std::move(sensor_repo))
    {}
    
    std::string name() const override { return "preheat"; }
    
    PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const override;
    
    ExecuteResult execute(const enose::experiment::Step& step) override;
    
    double estimate_duration(
        const enose::experiment::Step& step) const override;
    
    bool is_idempotent() const override { return true; }
    
    std::vector<std::string> required_resources() const override {
        return {"gas_pump", "sensor"};
    }

private:
    std::shared_ptr<hal::SensorDriver> sensor_;
    std::shared_ptr<db::SensorRepository> sensor_repo_;
    
    // 等待辅助方法
    void wait_for_duration(double seconds);
    void wait_for_heater_cycles(int count, double timeout_s);
};

} // namespace workflows
