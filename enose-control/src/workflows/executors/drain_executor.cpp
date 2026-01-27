#include "workflows/executors/drain_executor.hpp"
#include <spdlog/spdlog.h>
#include <chrono>

namespace workflows {

PreconditionResult DrainExecutor::check_preconditions(
    const enose::experiment::Step& step) const
{
    std::vector<std::string> failures;
    
    if (!step.has_drain()) {
        failures.push_back("Step does not contain drain action");
        return PreconditionResult::fail(std::move(failures));
    }
    
    // 检查系统状态
    if (system_state_) {
        auto current_state = system_state_->get_state();
        if (current_state != SystemState::State::INITIAL && 
            current_state != SystemState::State::INJECT) {
            failures.push_back("System must be in INITIAL or INJECT state before drain");
        }
    }
    
    // 检查硬件状态机 (如果有)
    if (hardware_state_) {
        if (!hardware_state_->can_transition_to(HardwareState::DRAIN_RUNNING)) {
            failures.push_back("Cannot transition to DRAIN state");
        }
    }
    
    if (failures.empty()) {
        return PreconditionResult::ok();
    }
    return PreconditionResult::fail(std::move(failures));
}

ExecuteResult DrainExecutor::execute(const enose::experiment::Step& step) {
    auto start_time = std::chrono::steady_clock::now();
    
    // 前置条件检查
    auto precond = check_preconditions(step);
    if (!precond) {
        std::string errors;
        for (const auto& e : precond.failed_conditions) {
            errors += e + "; ";
        }
        return ExecuteResult::fail("Precondition failed: " + errors);
    }
    
    const auto& action = step.drain();
    add_log("排废");
    
    // 创建事务守卫
    auto guard = create_guard(SystemState::State::DRAIN, "drain");
    
    // 等待空瓶
    if (load_cell_) {
        auto result = load_cell_->wait_for_empty_bottle(
            action.empty_tolerance_g(),
            action.timeout_s(),
            action.stability_window_s()
        );
        
        if (result.success) {
            add_log("排废完成: " + std::to_string(result.empty_weight) + "g");
        } else {
            add_log("排废超时");
        }
    } else {
        // 无称重传感器，使用超时等待
        auto timeout = std::chrono::seconds(static_cast<int>(action.timeout_s()));
        auto start = std::chrono::steady_clock::now();
        while (!check_stop_or_pause() && 
               std::chrono::steady_clock::now() - start < timeout) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        add_log("排废完成 (无称重反馈)");
    }
    
    // 提交事务
    guard.commit_and_restore();
    
    auto total_duration = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - start_time).count();
    
    return ExecuteResult::ok("", total_duration);
}

double DrainExecutor::estimate_duration(const enose::experiment::Step& step) const {
    if (!step.has_drain()) return 0;
    return step.drain().timeout_s();
}

} // namespace workflows
