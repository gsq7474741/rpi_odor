#include "workflows/executors/inject_executor.hpp"
#include <spdlog/spdlog.h>
#include <chrono>
#include <thread>

namespace workflows {

PreconditionResult InjectExecutor::check_preconditions(
    const enose::experiment::Step& step) const
{
    std::vector<std::string> failures;
    
    if (!step.has_inject()) {
        failures.push_back("Step does not contain inject action");
        return PreconditionResult::fail(std::move(failures));
    }
    
    const auto& action = step.inject();
    
    // 检查目标体积
    if (action.target_volume_ml() <= 0) {
        failures.push_back("Target volume must be positive");
    }
    
    // 检查液体组分
    if (action.components_size() == 0) {
        failures.push_back("No liquid components specified");
    }
    
    // 检查比例总和
    double ratio_sum = 0;
    for (const auto& comp : action.components()) {
        ratio_sum += comp.ratio();
    }
    if (std::abs(ratio_sum - 1.0) > 0.01) {
        failures.push_back("Component ratios must sum to 1.0");
    }
    
    // 检查系统状态
    if (system_state_) {
        auto current_state = system_state_->get_state();
        if (current_state != SystemState::State::INITIAL) {
            failures.push_back("System must be in INITIAL state before inject");
        }
    }
    
    // 检查硬件状态机 (如果有)
    if (hardware_state_) {
        if (!hardware_state_->can_transition_to(HardwareState::INJECT_PREPARING)) {
            failures.push_back("Cannot transition to INJECT state");
        }
    }
    
    if (failures.empty()) {
        return PreconditionResult::ok();
    }
    return PreconditionResult::fail(std::move(failures));
}

ExecuteResult InjectExecutor::execute(const enose::experiment::Step& step) {
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
    
    const auto& action = step.inject();
    add_log("进样: 目标量=" + std::to_string(action.target_volume_ml()) + "ml");
    
    // 创建事务守卫
    auto guard = create_guard(SystemState::State::INJECT, "inject");
    
    // 计算每个泵的进样量
    double total_volume = action.target_volume_ml();
    SystemState::InjectionParams params;
    params.speed = action.flow_rate_ml_min() / 60.0 * 1000;  // 转换为 mm/s
    params.accel = params.speed * 2;
    
    // 根据液体配方设置各泵进样量
    // 注意: 需要外部提供液体ID到泵索引的映射
    // 这里简化处理，使用组件顺序作为泵索引 (pump_2 ~ pump_5)
    int pump_offset = 2;  // 从 pump_2 开始
    for (int i = 0; i < action.components_size() && i < 4; ++i) {
        const auto& comp = action.components(i);
        double volume_mm = total_volume * comp.ratio() * 1000;  // ml to mm
        
        int pump_idx = pump_offset + i;
        switch (pump_idx) {
            case 2: params.pump_2_volume = volume_mm; break;
            case 3: params.pump_3_volume = volume_mm; break;
            case 4: params.pump_4_volume = volume_mm; break;
            case 5: params.pump_5_volume = volume_mm; break;
        }
    }
    
    // 启动进样
    system_state_->start_inject(params);
    
    // 等待进样完成 (通过称重反馈)
    double target_weight = action.has_target_weight_g() ? 
                          action.target_weight_g() : 
                          total_volume;  // 假设密度≈1
    double tolerance = action.tolerance();
    auto timeout = std::chrono::seconds(static_cast<int>(action.stable_timeout_s()));
    auto inject_start = std::chrono::steady_clock::now();
    
    while (!check_stop_or_pause()) {
        if (load_cell_) {
            float current_weight = load_cell_->get_filtered_weight();
            if (current_weight >= target_weight - tolerance) {
                add_log("进样完成: " + std::to_string(current_weight) + "g");
                break;
            }
        }
        
        if (std::chrono::steady_clock::now() - inject_start > timeout) {
            add_log("进样超时");
            break;
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    // 计算执行时间
    auto inject_duration = std::chrono::steady_clock::now() - inject_start;
    int64_t inject_seconds = std::chrono::duration_cast<std::chrono::seconds>(inject_duration).count();
    
    // 记录耗材消耗 (通过回调)
    if (consumable_callback_ && inject_seconds > 0) {
        constexpr double MM_TO_ML = 0.1;
        if (params.pump_0_volume > 0) consumable_callback_("pump_tube_0", params.pump_0_volume * MM_TO_ML);
        if (params.pump_1_volume > 0) consumable_callback_("pump_tube_1", params.pump_1_volume * MM_TO_ML);
        if (params.pump_2_volume > 0) consumable_callback_("pump_tube_2", params.pump_2_volume * MM_TO_ML);
        if (params.pump_3_volume > 0) consumable_callback_("pump_tube_3", params.pump_3_volume * MM_TO_ML);
        if (params.pump_4_volume > 0) consumable_callback_("pump_tube_4", params.pump_4_volume * MM_TO_ML);
        if (params.pump_5_volume > 0) consumable_callback_("pump_tube_5", params.pump_5_volume * MM_TO_ML);
        if (params.pump_6_volume > 0) consumable_callback_("pump_tube_6", params.pump_6_volume * MM_TO_ML);
        if (params.pump_7_volume > 0) consumable_callback_("pump_tube_7", params.pump_7_volume * MM_TO_ML);
    }
    
    // 提交事务
    guard.commit_and_restore();
    
    auto total_duration = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - start_time).count();
    
    return ExecuteResult::ok("", total_duration);
}

double InjectExecutor::estimate_duration(const enose::experiment::Step& step) const {
    if (!step.has_inject()) return 0;
    
    const auto& action = step.inject();
    double volume = action.target_volume_ml();
    double flow_rate = action.flow_rate_ml_min();
    
    if (flow_rate > 0) {
        return (volume / flow_rate) * 60.0 + 5.0;  // 加5秒稳定时间
    }
    return action.stable_timeout_s();
}

} // namespace workflows
