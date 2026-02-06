#include "workflows/executors/wash_executor.hpp"
#include <spdlog/spdlog.h>
#include <chrono>
#include <thread>

namespace workflows {

PreconditionResult WashExecutor::check_preconditions(
    const enose::experiment::Step& step) const
{
    std::vector<std::string> failures;
    
    if (!step.has_wash()) {
        failures.push_back("Step does not contain wash action");
        return PreconditionResult::fail(std::move(failures));
    }
    
    const auto& action = step.wash();
    
    // 检查重复次数
    if (action.repeat_count() <= 0) {
        failures.push_back("Repeat count must be positive");
    }
    
    // 检查目标清洗量
    if (action.target_volume_ml() <= 0) {
        failures.push_back("Target volume must be positive");
    }
    
    // 检查系统状态
    if (system_state_) {
        auto current_state = system_state_->get_state();
        if (current_state != SystemState::State::INITIAL) {
            failures.push_back("System must be in INITIAL state before wash");
        }
    }
    
    if (failures.empty()) {
        return PreconditionResult::ok();
    }
    return PreconditionResult::fail(std::move(failures));
}

ExecuteResult WashExecutor::execute(const enose::experiment::Step& step) {
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
    
    const auto& action = step.wash();
    
    // 目标清洗量 (ml)，需要线性校正转换为期望的称重传感器重量变化
    // 线性校正: expected_weight_change = target_ml * slope + offset
    // 反推实际量: actual_ml = (weight_change - offset) / slope
    float target_ml = action.target_volume_ml();
    float expected_weight_change = target_ml;  // 默认 1:1
    float slope = 1.0f;
    float offset = 0.0f;
    float lag_comp = 0.0f;
    float trigger_threshold = target_ml;
    
    if (load_cell_) {
        const auto& lc_config = load_cell_->get_config();
        slope = lc_config.ml_to_weight_slope;
        offset = lc_config.ml_to_weight_offset;
        lag_comp = lc_config.fill_lag_compensation_g;
        expected_weight_change = target_ml * slope + offset;
        trigger_threshold = expected_weight_change - lag_comp;
    }
    
    add_log("清洗: 目标=" + std::to_string(target_ml) + 
            "ml 期望Δw=" + std::to_string(expected_weight_change) + 
            "g 触发阈值=" + std::to_string(trigger_threshold) +
            "g (slope=" + std::to_string(slope) +
            " offset=" + std::to_string(offset) +
            " lag_comp=" + std::to_string(lag_comp) +
            "g) 重复" + std::to_string(action.repeat_count()) + "次" +
            " 排废PWM=" + std::to_string(action.drain_gas_pump_pwm()) + "%");
    
    // 排废气泵 PWM 值 (0.0 - 1.0)
    float drain_pwm = action.drain_gas_pump_pwm() / 100.0f;
    
    // 创建事务守卫 - 不自动切换状态，内部手动管理
    auto guard = create_guard(std::nullopt, "wash");
    
    for (int i = 0; i < action.repeat_count(); ++i) {
        if (check_stop_or_pause()) {
            return ExecuteResult::fail("Wash stopped by user");
        }
        
        add_log("清洗循环 " + std::to_string(i + 1) + "/" + std::to_string(action.repeat_count()));
        
        // 1. 排废确认空瓶稳态
        add_log("排废确认空瓶...");
        system_state_->transition_to(SystemState::State::DRAIN);
        // 使用用户配置的排废气泵 PWM，覆盖 DRAIN 状态预设的 100%
        system_state_->set_air_pump_pwm(drain_pwm);
        
        float baseline_weight = 0;
        if (load_cell_) {
            auto empty_result = load_cell_->wait_for_empty_bottle(
                action.empty_tolerance_g(),
                action.drain_timeout_s(),
                action.empty_stability_window_s(),
                [this]() { return check_stop_or_pause(); }
            );
            
            if (empty_result.stopped) {
                add_log("排废被中断");
                return ExecuteResult::fail("清洗被用户中断");
            } else if (!empty_result.success) {
                add_log("排废超时，继续清洗");
            }
            
            baseline_weight = load_cell_->get_filtered_weight();
            add_log("空瓶基线重量: " + std::to_string(baseline_weight) + "g");
        }
        
        if (check_stop_or_pause()) {
            return ExecuteResult::fail("Wash stopped by user");
        }
        
        // 2. 切换到 CLEAN 状态 (清洗泵开启)
        add_log("开始注入清洗液...");
        system_state_->transition_to(SystemState::State::CLEAN);
        
        // 3. 监测重量变化，达到阈值立即切换到排废
        // 使用 raw_weight 而非 filtered_weight，避免移动平均滤波延迟导致过冲
        // 线性校正: expected_weight_change = target_ml * slope + offset
        auto fill_start = std::chrono::steady_clock::now();
        auto fill_timeout = std::chrono::seconds(static_cast<int>(action.fill_timeout_s()));
        bool target_reached = false;
        
        while (!check_stop_or_pause()) {
            if (load_cell_) {
                // 用原始值检测阈值，避免滤波延迟
                float current_weight = load_cell_->get_raw_weight();
                float weight_change = current_weight - baseline_weight;
                
                if (weight_change >= trigger_threshold) {
                    float actual_ml = (slope > 0) ? (weight_change - offset) / slope : weight_change;
                    add_log("达到目标: 重量变化=" + std::to_string(weight_change) + 
                            "g (约" + std::to_string(actual_ml) + "ml)");
                    target_reached = true;
                    break;
                }
            }
            
            if (std::chrono::steady_clock::now() - fill_start > fill_timeout) {
                if (load_cell_) {
                    float current_weight = load_cell_->get_raw_weight();
                    float weight_change = current_weight - baseline_weight;
                    float actual_ml = (slope > 0) ? (weight_change - offset) / slope : weight_change;
                    add_log("清洗注入超时: 重量变化=" + std::to_string(weight_change) + 
                            "g (约" + std::to_string(actual_ml) + "ml, 目标" + std::to_string(target_ml) + "ml)");
                } else {
                    add_log("清洗注入超时");
                }
                break;
            }
            
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        
        if (check_stop_or_pause()) {
            return ExecuteResult::fail("Wash stopped by user");
        }
        
        // 4. 排废清洗液
        add_log("排废清洗液...");
        system_state_->transition_to(SystemState::State::DRAIN);
        // 使用用户配置的排废气泵 PWM
        system_state_->set_air_pump_pwm(drain_pwm);
        
        if (load_cell_) {
            auto drain_result = load_cell_->wait_for_empty_bottle(
                action.empty_tolerance_g(),
                action.drain_timeout_s(),
                action.empty_stability_window_s(),
                [this]() { return check_stop_or_pause(); }
            );
            
            if (drain_result.stopped) {
                add_log("排废被中断");
                return ExecuteResult::fail("清洗被用户中断");
            } else if (drain_result.success) {
                add_log("排废完成: " + std::to_string(drain_result.empty_weight) + "g");
            } else {
                add_log("排废超时");
            }
        }
    }
    
    // 提交事务
    guard.commit_and_restore();
    add_log("清洗完成");
    
    auto total_duration = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - start_time).count();
    
    return ExecuteResult::ok("", total_duration);
}

double WashExecutor::estimate_duration(const enose::experiment::Step& step) const {
    if (!step.has_wash()) return 0;
    
    const auto& action = step.wash();
    // 每次循环: 排废 + 填充 + 排废
    double per_cycle = action.drain_timeout_s() + action.fill_timeout_s() + action.drain_timeout_s();
    return per_cycle * action.repeat_count();
}

} // namespace workflows
