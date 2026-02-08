#include "preheat_executor.hpp"
#include "workflows/stability_monitor.hpp"
#include "enose_experiment.pb.h"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <chrono>
#include <thread>
#include <mutex>
#include <condition_variable>

namespace workflows {

PreconditionResult PreheatExecutor::check_preconditions(
    const enose::experiment::Step& step) const {
    
    if (!step.has_preheat()) {
        return PreconditionResult::fail({"Step does not contain preheat action"});
    }
    
    const auto& action = step.preheat();
    
    // 检查必须指定预热模式
    if (!action.has_cycles() && !action.has_duration_s() && !action.has_stability()) {
        return PreconditionResult::fail({"Preheat action must specify cycles, duration_s, or stability"});
    }
    
    // 检查最大时间
    if (action.max_duration_s() <= 0) {
        return PreconditionResult::fail({"max_duration_s must be positive"});
    }
    
    // 检查传感器驱动
    if (!sensor_) {
        return PreconditionResult::fail({"Sensor driver not available"});
    }
    
    return PreconditionResult::ok();
}

ExecuteResult PreheatExecutor::execute(const enose::experiment::Step& step) {
    const auto& action = step.preheat();
    
    const char* mode_str = action.has_cycles() ? "cycles" : 
                           action.has_stability() ? "stability" : "duration";
    spdlog::info("PreheatExecutor: starting preheat, mode={}, max_duration={}s",
                 mode_str, action.max_duration_s());
    
    // 1. 设置气泵 PWM (如果指定)
    if (action.gas_pump_pwm() > 0) {
        spdlog::debug("PreheatExecutor: setting gas pump PWM to {}%", action.gas_pump_pwm());
        // 通过 SystemState 设置气泵 (如果已实现)
        // system_state_->set_gas_pump(action.gas_pump_pwm());
    }
    
    // 2. 发送 start 命令启动传感器采集
    if (sensor_) {
        spdlog::info("PreheatExecutor: sending start command to sensor");
        nlohmann::json start_cmd;
        start_cmd["cmd"] = "start";
        start_cmd["id"] = 0;
        start_cmd["params"]["sensors"] = {0, 1, 2, 3, 4, 5, 6, 7};
        sensor_->write(start_cmd);
        
        // 等待传感器初始化
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        spdlog::debug("PreheatExecutor: sensor start command sent");
    } else {
        spdlog::warn("PreheatExecutor: no sensor driver, skipping start command");
    }
    
    // 3. 启用数据持久化 (如果需要记录数据)
    if (action.record_data() && sensor_repo_) {
        spdlog::debug("PreheatExecutor: enabling data persistence with phase PREHEAT");
        sensor_repo_->set_run_context(std::nullopt, "PREHEAT");
    }
    
    // 4. 根据模式等待预热完成
    try {
        if (action.has_cycles()) {
            wait_for_heater_cycles(action.cycles(), action.max_duration_s());
        } else if (action.has_stability()) {
            wait_for_stability(
                action.stability().window_s(),
                action.stability().threshold_percent(),
                action.max_duration_s());
        } else if (action.has_duration_s()) {
            wait_for_duration(action.duration_s());
        }
    } catch (const std::exception& e) {
        spdlog::error("PreheatExecutor: error during preheat wait: {}", e.what());
        return ExecuteResult::fail(e.what());
    }
    
    spdlog::info("PreheatExecutor: preheat complete");
    return ExecuteResult::ok();
}

double PreheatExecutor::estimate_duration(
    const enose::experiment::Step& step) const {
    
    if (!step.has_preheat()) return 0;
    
    const auto& action = step.preheat();
    
    if (action.has_duration_s()) {
        return action.duration_s();
    }
    
    if (action.has_cycles()) {
        // 从数据库查询当前活跃的加热器配置，精确计算周期时长
        double cycle_duration = 26.0; // 默认估算值
        if (sensor_repo_) {
            auto assignment = sensor_repo_->get_active_assignment(0);
            if (assignment && !assignment->durs_snapshot.empty()) {
                double total_ms = 0;
                for (auto d : assignment->durs_snapshot) {
                    total_ms += d * 140.0;
                }
                cycle_duration = total_ms / 1000.0;
            }
        }
        return action.cycles() * cycle_duration;
    }
    
    if (action.has_stability()) {
        // 稳态模式：无法准确估算，使用 max_duration_s 的一半作为乐观估计
        return action.max_duration_s() * 0.5;
    }
    
    return action.max_duration_s();
}

void PreheatExecutor::wait_for_duration(double seconds) {
    spdlog::debug("PreheatExecutor: waiting for {} seconds", seconds);
    
    auto start = std::chrono::steady_clock::now();
    auto end = start + std::chrono::duration<double>(seconds);
    
    while (std::chrono::steady_clock::now() < end) {
        // 检查停止标志
        if (check_stop_or_pause()) {
            spdlog::info("PreheatExecutor: wait interrupted by stop request");
            return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

void PreheatExecutor::wait_for_heater_cycles(int count, double timeout_s) {
    spdlog::debug("PreheatExecutor: waiting for {} heater cycles, timeout={}s", count, timeout_s);
    
    int completed_cycles = 0;
    int last_heater_step = -1;
    bool seen_first_cycle = false;
    
    std::mutex cycle_mutex;
    std::condition_variable cycle_cv;
    
    // 订阅传感器数据包 (固件字段: "gi" = heater step index)
    auto conn = sensor_->on_packet.connect([&](const nlohmann::json& packet) {
        if (!packet.contains("type") || packet["type"] != "data") return;
        if (!packet.contains("gi")) return;
        
        int current_step = packet["gi"].get<int>();
        
        std::lock_guard<std::mutex> lock(cycle_mutex);
        
        // 检测周期完成 (从高步骤回到0)
        if (last_heater_step > 0 && current_step == 0 && seen_first_cycle) {
            completed_cycles++;
            spdlog::debug("PreheatExecutor: completed cycle {}/{}", completed_cycles, count);
            cycle_cv.notify_all();
        }
        
        // 标记第一个周期开始
        if (last_heater_step > current_step && !seen_first_cycle) {
            seen_first_cycle = true;
            spdlog::debug("PreheatExecutor: first cycle started");
        }
        
        last_heater_step = current_step;
    });
    
    auto start = std::chrono::steady_clock::now();
    auto timeout = std::chrono::duration<double>(timeout_s);
    
    std::unique_lock<std::mutex> lock(cycle_mutex);
    
    while (completed_cycles < count) {
        if (check_stop_or_pause()) {
            spdlog::info("PreheatExecutor: cycle wait interrupted by stop request");
            return;
        }
        
        auto elapsed = std::chrono::steady_clock::now() - start;
        if (elapsed >= timeout) {
            spdlog::warn("PreheatExecutor: timeout waiting for heater cycles ({}/{})", 
                        completed_cycles, count);
            return;
        }
        
        auto remaining = timeout - elapsed;
        cycle_cv.wait_for(lock, remaining);
    }
    
    spdlog::info("PreheatExecutor: all {} heater cycles completed", count);
}

void PreheatExecutor::wait_for_stability(double window_s, double threshold_percent, double timeout_s) {
    if (!sensor_) {
        spdlog::warn("PreheatExecutor: no sensor driver, using timeout for stability wait");
        wait_for_duration(timeout_s);
        return;
    }
    
    StabilityMonitor::Config config{
        .window_s = window_s,
        .threshold_percent = threshold_percent,
        .timeout_s = timeout_s,
        .log_prefix = "PreheatExecutor"
    };
    
    StabilityMonitor::wait_for_stability(
        *sensor_, config,
        [this]() { return check_stop_or_pause(); },
        [this](const std::string& msg) { add_log(msg); }
    );
}

} // namespace workflows
