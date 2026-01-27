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
    
    // 检查目标重量
    if (action.target_weight_g() <= 0) {
        failures.push_back("Target weight must be positive");
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
    add_log("清洗: 目标重量变化=" + std::to_string(action.target_weight_g()) + 
            "g, 重复" + std::to_string(action.repeat_count()) + "次");
    
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
        
        float baseline_weight = 0;
        if (load_cell_) {
            auto empty_result = load_cell_->wait_for_empty_bottle(
                action.empty_tolerance_g(),
                action.drain_timeout_s(),
                action.empty_stability_window_s()
            );
            
            if (!empty_result.success) {
                add_log("排废超时，继续清洗");
            }
            
            baseline_weight = load_cell_->get_filtered_weight();
            add_log("空瓶基线重量: " + std::to_string(baseline_weight) + "g");
        }
        
        if (check_stop_or_pause()) {
            return ExecuteResult::fail("Wash stopped by user");
        }
        
        // 2. 切换到 CLEAN 状态
        add_log("开始注入清洗液...");
        system_state_->transition_to(SystemState::State::CLEAN);
        
        // 3. 监测重量变化
        auto fill_start = std::chrono::steady_clock::now();
        auto fill_timeout = std::chrono::seconds(static_cast<int>(action.fill_timeout_s()));
        bool target_reached = false;
        
        while (!check_stop_or_pause()) {
            if (load_cell_) {
                float current_weight = load_cell_->get_filtered_weight();
                float weight_change = current_weight - baseline_weight;
                
                if (weight_change >= action.target_weight_g()) {
                    add_log("达到目标重量变化: " + std::to_string(weight_change) + "g");
                    target_reached = true;
                    break;
                }
            }
            
            if (std::chrono::steady_clock::now() - fill_start > fill_timeout) {
                add_log("清洗注入超时");
                break;
            }
            
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        
        if (check_stop_or_pause()) {
            return ExecuteResult::fail("Wash stopped by user");
        }
        
        // 4. 排废
        add_log("排废清洗液...");
        system_state_->transition_to(SystemState::State::DRAIN);
        
        if (load_cell_) {
            auto drain_result = load_cell_->wait_for_empty_bottle(
                action.empty_tolerance_g(),
                action.drain_timeout_s(),
                action.empty_stability_window_s()
            );
            
            if (drain_result.success) {
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
