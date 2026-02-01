#pragma once

#include "workflows/action_executor.hpp"
#include "workflows/transaction_guard.hpp"
#include "hal/sensor_driver.hpp"
#include "db/sensor_repository.hpp"
#include <memory>

namespace workflows {

/**
 * @brief 加热器配置执行器
 * 
 * 负责执行 ConfigureHeaterAction，包含：
 * - 加载加热配置预设 (从数据库)
 * - 向固件发送 config 命令
 * - 记录配置分配到数据库
 */
class HeaterConfigExecutor : public ActionExecutorBase {
public:
    HeaterConfigExecutor(
        std::shared_ptr<SystemState> system_state,
        std::shared_ptr<hal::SensorDriver> sensor,
        std::shared_ptr<db::SensorRepository> sensor_repo = nullptr,
        std::shared_ptr<HardwareStateMachine> hardware_state = nullptr)
        : ActionExecutorBase(std::move(system_state), std::move(hardware_state))
        , sensor_(std::move(sensor))
        , sensor_repo_(std::move(sensor_repo))
    {}
    
    std::string name() const override { return "configure_heater"; }
    
    PreconditionResult check_preconditions(
        const enose::experiment::Step& step) const override;
    
    ExecuteResult execute(const enose::experiment::Step& step) override;
    
    double estimate_duration(
        const enose::experiment::Step& step) const override {
        return 0.5; // 配置命令很快
    }
    
    bool is_idempotent() const override { return true; }
    
    std::vector<std::string> required_resources() const override {
        return {"sensor"};
    }

private:
    std::shared_ptr<hal::SensorDriver> sensor_;
    std::shared_ptr<db::SensorRepository> sensor_repo_;
    
    // 发送配置命令到固件
    bool send_config_command(
        const std::vector<int32_t>& temps,
        const std::vector<int32_t>& durs,
        const std::vector<int32_t>& sensor_indices);
};

} // namespace workflows
