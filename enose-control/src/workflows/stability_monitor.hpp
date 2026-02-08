#pragma once

#include "hal/sensor_driver.hpp"
#include <deque>
#include <map>
#include <mutex>
#include <functional>
#include <string>
#include <chrono>
#include <algorithm>
#include <thread>
#include <spdlog/spdlog.h>

namespace workflows {

/**
 * @brief 传感器稳态检测结果
 */
struct StabilityResult {
    bool stabilized;        // 是否所有组都已稳定
    bool interrupted;       // 是否被外部中断 (stop/pause)
    double elapsed_s;       // 耗时 (秒)
    int total_groups;       // 总分组数
    int stable_groups;      // 已稳定分组数
    int data_packets;       // 收到的有效数据包数
};

/**
 * @brief 传感器稳态监测器
 * 
 * 按 (sensor_idx, heater_step) 分组追踪传感器读数，
 * 在滑动窗口内检测 min-max 变化百分比。
 * 所有有足够数据的组都低于阈值时判定为稳定。
 * 
 * 同时用于 Preheat 和 Acquire 阶段。
 */
class StabilityMonitor {
public:
    struct Config {
        double window_s;            // 稳定窗口 (秒)
        double threshold_percent;   // 变化率阈值 (%)
        double timeout_s;           // 超时 (秒)
        std::string log_prefix;     // 日志前缀 (如 "PreheatExecutor", "AcquireExecutor")
    };
    
    /**
     * @brief 执行稳态检测
     * 
     * @param sensor      传感器驱动 (用于连接 on_packet 信号)
     * @param config      检测配置
     * @param stop_check  停止检查回调 (返回 true 表示需要停止)
     * @param user_log    用户可见日志回调 (可选)
     * @return StabilityResult 检测结果
     */
    static StabilityResult wait_for_stability(
        hal::SensorDriver& sensor,
        const Config& config,
        std::function<bool()> stop_check,
        std::function<void(const std::string&)> user_log = nullptr)
    {
        const auto& prefix = config.log_prefix;
        
        spdlog::info("{}: waiting for sensor stability "
                     "(window={}s, threshold={}%, timeout={}s)",
                     prefix, config.window_s, config.threshold_percent, config.timeout_s);
        
        if (user_log) {
            user_log("等待传感器稳定 (窗口=" + std::to_string(config.window_s) + 
                     "s, 阈值=" + std::to_string(config.threshold_percent) + 
                     "%, 超时=" + std::to_string(config.timeout_s) + "s)");
        }
        
        // 按 (sensor_idx, heater_step) 分组追踪读数
        // key = sensor_idx * 16 + heater_step
        struct GroupTracker {
            std::deque<double> values;
            double latest_variation = 100.0;
            bool stable = false;
        };
        
        std::map<int, GroupTracker> groups;
        std::mutex groups_mutex;
        bool all_stable = false;
        int total_packets = 0;
        int data_packets = 0;
        auto last_log_time = std::chrono::steady_clock::now();
        
        // BME688: 每传感器每步约 140ms，一个完整周期约 11.2s (8*10*140ms)
        // 窗口内每组最多保留 window_s / 10 个读数 (每步每周期约 1 个读数)
        const size_t min_readings_per_group = 3;
        const size_t max_readings_per_group = std::max<size_t>(
            5, static_cast<size_t>(config.window_s / 10.0));
        
        spdlog::info("{}: stability config: min_readings={}, max_readings={} per (sensor,step) group",
                     prefix, min_readings_per_group, max_readings_per_group);
        
        auto conn = sensor.on_packet.connect([&](const nlohmann::json& packet) {
            if (!packet.contains("type") || packet["type"] != "data") return;
            
            total_packets++;
            
            // 固件字段: "s" = sensor_idx, "gi" = heater_step, "v"/"R" = value
            if (!packet.contains("s") || !packet.contains("gi")) {
                if (total_packets <= 3) {
                    spdlog::warn("{}: data packet missing 's' or 'gi' fields: {}",
                                 prefix, packet.dump().substr(0, 200));
                }
                return;
            }
            
            int sensor_idx = packet["s"].get<int>();
            int heater_step = packet["gi"].get<int>();
            double value = packet.value("v", packet.value("R", 0.0));
            
            if (value <= 0) return;
            
            data_packets++;
            int key = sensor_idx * 16 + heater_step;
            
            std::lock_guard<std::mutex> lock(groups_mutex);
            auto& group = groups[key];
            group.values.push_back(value);
            
            // 保留窗口内的数据
            while (group.values.size() > max_readings_per_group) {
                group.values.pop_front();
            }
            
            // 检查该组稳定性: min-max 变化百分比
            if (group.values.size() >= min_readings_per_group) {
                double min_val = *std::min_element(group.values.begin(), group.values.end());
                double max_val = *std::max_element(group.values.begin(), group.values.end());
                double mean_val = (min_val + max_val) / 2.0;
                
                if (mean_val > 0) {
                    group.latest_variation = ((max_val - min_val) / mean_val) * 100.0;
                    group.stable = (group.latest_variation <= config.threshold_percent);
                }
            }
            
            // 检查是否所有组都稳定 (至少 2 个组有足够数据)
            if (groups.size() >= 2) {
                int groups_with_data = 0;
                int stable_groups = 0;
                for (const auto& [k, g] : groups) {
                    if (g.values.size() >= min_readings_per_group) {
                        groups_with_data++;
                        if (g.stable) stable_groups++;
                    }
                }
                if (groups_with_data >= 2 && stable_groups == groups_with_data) {
                    all_stable = true;
                }
            }
        });
        
        auto start = std::chrono::steady_clock::now();
        auto timeout = std::chrono::duration<double>(config.timeout_s);
        constexpr auto log_interval = std::chrono::seconds(5);
        
        while (!all_stable) {
            if (stop_check()) {
                spdlog::info("{}: stability wait interrupted by stop request", prefix);
                conn.disconnect();
                auto elapsed_s = std::chrono::duration<double>(
                    std::chrono::steady_clock::now() - start).count();
                return {false, true, elapsed_s, 
                        static_cast<int>(groups.size()), 0, data_packets};
            }
            
            auto now = std::chrono::steady_clock::now();
            auto elapsed = now - start;
            
            if (elapsed > timeout) {
                // 超时: 打印最终状态
                std::lock_guard<std::mutex> lock(groups_mutex);
                spdlog::warn("{}: TIMEOUT after {:.1f}s, total_packets={}, data_packets={}, groups={}",
                             prefix, std::chrono::duration<double>(elapsed).count(), 
                             total_packets, data_packets, groups.size());
                
                int stable_count = 0;
                for (const auto& [key, g] : groups) {
                    int si = key / 16;
                    int hs = key % 16;
                    spdlog::warn("  sensor[{}] step[{}]: readings={}, variation={:.2f}%, stable={}",
                                 si, hs, g.values.size(), g.latest_variation, g.stable);
                    if (g.stable) stable_count++;
                }
                
                if (user_log) {
                    user_log("等待稳定超时: " + std::to_string(static_cast<int>(config.timeout_s)) + 
                             "s, " + std::to_string(data_packets) + " 条数据, " + 
                             std::to_string(groups.size()) + " 个分组");
                }
                
                conn.disconnect();
                auto elapsed_s = std::chrono::duration<double>(elapsed).count();
                return {false, false, elapsed_s, 
                        static_cast<int>(groups.size()), stable_count, data_packets};
            }
            
            // 周期性进度日志
            if (now - last_log_time >= log_interval) {
                last_log_time = now;
                std::lock_guard<std::mutex> lock(groups_mutex);
                
                int groups_with_data = 0;
                int stable_count = 0;
                double worst_variation = 0;
                int worst_si = -1, worst_hs = -1;
                
                for (const auto& [key, g] : groups) {
                    if (g.values.size() >= min_readings_per_group) {
                        groups_with_data++;
                        if (g.stable) stable_count++;
                        if (g.latest_variation > worst_variation) {
                            worst_variation = g.latest_variation;
                            worst_si = key / 16;
                            worst_hs = key % 16;
                        }
                    }
                }
                
                spdlog::info("{}: stability progress [{:.0f}s/{:.0f}s] "
                             "packets={} groups={} stable={}/{} "
                             "worst=sensor[{}]step[{}] {:.2f}% (threshold={}%)",
                             prefix, std::chrono::duration<double>(elapsed).count(), 
                             config.timeout_s,
                             data_packets, groups.size(), stable_count, groups_with_data,
                             worst_si, worst_hs, worst_variation, config.threshold_percent);
                
                if (user_log) {
                    user_log("稳定检测: " + std::to_string(stable_count) + "/" + 
                             std::to_string(groups_with_data) + " 组已稳定, 最大变化=" + 
                             std::to_string(static_cast<int>(worst_variation * 100) / 100.0) + "%");
                }
            }
            
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        
        conn.disconnect();
        
        auto elapsed_s = std::chrono::duration<double>(
            std::chrono::steady_clock::now() - start).count();
        
        {
            std::lock_guard<std::mutex> lock(groups_mutex);
            spdlog::info("{}: ALL STABLE after {:.1f}s, groups={}, data_packets={}",
                         prefix, elapsed_s, groups.size(), data_packets);
            for (const auto& [key, g] : groups) {
                int si = key / 16;
                int hs = key % 16;
                spdlog::debug("  sensor[{}] step[{}]: readings={}, variation={:.2f}%",
                              si, hs, g.values.size(), g.latest_variation);
            }
        }
        
        if (user_log) {
            user_log("传感器已稳定 (耗时" + std::to_string(static_cast<int>(elapsed_s)) + 
                     "s, " + std::to_string(groups.size()) + "个分组)");
        }
        
        return {true, false, elapsed_s, 
                static_cast<int>(groups.size()), static_cast<int>(groups.size()), data_packets};
    }
};

} // namespace workflows
