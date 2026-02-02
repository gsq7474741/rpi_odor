#include "workflows/runtime_tracker.hpp"
#include "workflows/system_state.hpp"
#include "db/consumable_repository.hpp"
#include <spdlog/spdlog.h>

namespace workflows {

RuntimeTracker::RuntimeTracker(std::shared_ptr<db::ConsumableRepository> repo)
    : repo_(std::move(repo)) {
    // 初始化所有开始时间为空
    start_times_.fill(std::nullopt);
}

void RuntimeTracker::on_peripheral_state_change(const PeripheralState& old_state,
                                                  const PeripheralState& new_state) {
    // === 蠕动泵 pump_0 ~ pump_7 ===
    // 检测 STOPPED -> RUNNING (开始计时)
    // 检测 RUNNING -> STOPPED (停止计时并记录)
    
    auto check_pump = [&](PumpState old_pump, PumpState new_pump, HardwareIndex idx) {
        if (old_pump == PumpState::STOPPED && new_pump == PumpState::RUNNING) {
            start_tracking(idx);
        } else if (old_pump == PumpState::RUNNING && new_pump == PumpState::STOPPED) {
            record_and_reset(idx);
        }
    };

    check_pump(old_state.pump_0, new_state.pump_0, PUMP_0);
    check_pump(old_state.pump_1, new_state.pump_1, PUMP_1);
    check_pump(old_state.pump_2, new_state.pump_2, PUMP_2);
    check_pump(old_state.pump_3, new_state.pump_3, PUMP_3);
    check_pump(old_state.pump_4, new_state.pump_4, PUMP_4);
    check_pump(old_state.pump_5, new_state.pump_5, PUMP_5);
    check_pump(old_state.pump_6, new_state.pump_6, PUMP_6);
    check_pump(old_state.pump_7, new_state.pump_7, PUMP_7);

    // === 气泵 (air_pump_pwm) ===
    // pwm: 0 -> >0 开始计时
    // pwm: >0 -> 0 停止计时并记录
    bool old_air_running = old_state.air_pump_pwm > 0;
    bool new_air_running = new_state.air_pump_pwm > 0;
    
    if (!old_air_running && new_air_running) {
        start_tracking(AIR_PUMP);
    } else if (old_air_running && !new_air_running) {
        record_and_reset(AIR_PUMP);
    }

    // === 清洗泵 (cleaning_pump) ===
    // 同样逻辑
    bool old_clean_running = old_state.cleaning_pump > 0;
    bool new_clean_running = new_state.cleaning_pump > 0;
    
    if (!old_clean_running && new_clean_running) {
        start_tracking(CLEANING_PUMP);
    } else if (old_clean_running && !new_clean_running) {
        record_and_reset(CLEANING_PUMP);
    }
}

void RuntimeTracker::start_tracking(HardwareIndex index) {
    start_times_[index] = std::chrono::steady_clock::now();
    spdlog::debug("RuntimeTracker: Started tracking {}", CONSUMABLE_IDS[index]);
}

void RuntimeTracker::record_and_reset(HardwareIndex index) {
    if (!start_times_[index].has_value()) {
        return;  // 没有开始时间，跳过
    }

    auto duration = std::chrono::steady_clock::now() - start_times_[index].value();
    int64_t seconds = std::chrono::duration_cast<std::chrono::seconds>(duration).count();
    
    start_times_[index] = std::nullopt;  // 重置

    if (seconds <= 0) {
        return;  // 运行时间太短，不记录
    }

    if (!repo_) {
        spdlog::warn("RuntimeTracker: No repository, cannot record runtime for {}", 
                     CONSUMABLE_IDS[index]);
        return;
    }

    // 记录到数据库
    if (index == AIR_PUMP) {
        // 气泵同时更新活性炭管和真空过滤器
        repo_->add_runtime("carbon_filter", seconds);
        repo_->add_runtime("vacuum_filter", seconds);
        spdlog::info("RuntimeTracker: Recorded air pump runtime {}s -> carbon_filter + vacuum_filter", 
                     seconds);
    } else if (index == CLEANING_PUMP) {
        // 清洗泵暂不跟踪寿命（DC泵，无耗材概念）
        spdlog::debug("RuntimeTracker: Cleaning pump ran for {}s (not tracked)", seconds);
    } else {
        // 蠕动泵管
        repo_->add_runtime(CONSUMABLE_IDS[index], seconds);
        spdlog::info("RuntimeTracker: Recorded {} runtime {}s", CONSUMABLE_IDS[index], seconds);
    }
}

bool RuntimeTracker::is_running(HardwareIndex index) const {
    return start_times_[index].has_value();
}

int64_t RuntimeTracker::get_current_runtime_seconds(const std::string& consumable_id) const {
    // 查找对应的索引
    for (int i = 0; i < HARDWARE_COUNT; ++i) {
        if (consumable_id == CONSUMABLE_IDS[i] && start_times_[i].has_value()) {
            auto duration = std::chrono::steady_clock::now() - start_times_[i].value();
            return std::chrono::duration_cast<std::chrono::seconds>(duration).count();
        }
    }
    return 0;
}

void RuntimeTracker::flush_all() {
    spdlog::info("RuntimeTracker: Flushing all running hardware timers");
    
    for (int i = 0; i < HARDWARE_COUNT; ++i) {
        if (start_times_[i].has_value()) {
            record_and_reset(static_cast<HardwareIndex>(i));
        }
    }
}

} // namespace workflows
