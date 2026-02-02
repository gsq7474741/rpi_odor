#pragma once

#include <memory>
#include <chrono>
#include <array>
#include <optional>
#include <string>

namespace db {
class ConsumableRepository;
}

namespace workflows {

struct PeripheralState;

/**
 * @brief 硬件运行时间跟踪器
 * 
 * 在底层自动跟踪硬件运行时间，当硬件从运行→停止时自动累加到数据库。
 * 这样无论是实验执行还是手动控制，都会被统计。
 */
class RuntimeTracker {
public:
    explicit RuntimeTracker(std::shared_ptr<db::ConsumableRepository> repo);
    ~RuntimeTracker() = default;

    /**
     * @brief 当外设状态变化时调用
     * 
     * 比较新旧状态，检测哪些硬件开始/停止运行，并更新统计
     * 
     * @param old_state 变化前的外设状态
     * @param new_state 变化后的外设状态
     */
    void on_peripheral_state_change(const PeripheralState& old_state, 
                                     const PeripheralState& new_state);

    /**
     * @brief 强制刷新所有正在运行的硬件的计时
     * 
     * 在程序退出或需要立即保存时调用
     */
    void flush_all();

    /**
     * @brief 获取某个硬件当前的运行时长（秒）
     * 
     * 如果硬件正在运行，返回从开始到现在的时长
     * 如果硬件未运行，返回 0
     */
    int64_t get_current_runtime_seconds(const std::string& consumable_id) const;

private:
    // 硬件索引
    enum HardwareIndex {
        PUMP_0 = 0,
        PUMP_1,
        PUMP_2,
        PUMP_3,
        PUMP_4,
        PUMP_5,
        PUMP_6,
        PUMP_7,
        AIR_PUMP,
        CLEANING_PUMP,
        HARDWARE_COUNT
    };

    // 耗材 ID 映射
    static constexpr const char* CONSUMABLE_IDS[] = {
        "pump_tube_0",
        "pump_tube_1",
        "pump_tube_2",
        "pump_tube_3",
        "pump_tube_4",
        "pump_tube_5",
        "pump_tube_6",
        "pump_tube_7",
        "air_pump",      // 气泵本身（会同时更新 carbon_filter 和 vacuum_filter）
        "cleaning_pump", // 清洗泵（可选跟踪）
    };

    // 记录硬件开始运行的时间点
    std::array<std::optional<std::chrono::steady_clock::time_point>, HARDWARE_COUNT> start_times_;

    // 记录运行时间并重置计时器
    void record_and_reset(HardwareIndex index);

    // 开始计时
    void start_tracking(HardwareIndex index);

    // 检查是否正在运行
    bool is_running(HardwareIndex index) const;

    std::shared_ptr<db::ConsumableRepository> repo_;
};

} // namespace workflows
