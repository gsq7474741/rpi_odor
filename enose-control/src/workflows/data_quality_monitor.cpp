#include "workflows/data_quality_monitor.hpp"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <numeric>
#include <cmath>

namespace workflows {

// ============================================================
// EnvTracker helpers
// ============================================================

double DataQualityMonitor::EnvTracker::compute_rate(
    const std::deque<std::pair<int64_t, double>>& history) {
    if (history.size() < 2) return 0.0;
    
    auto& first = history.front();
    auto& last = history.back();
    double dt_min = (last.first - first.first) / 60000.0;  // ms -> min
    if (dt_min < 0.1) return 0.0;  // too short
    
    return std::abs(last.second - first.second) / dt_min;
}

bool DataQualityMonitor::EnvTracker::is_stable() const {
    if (latest_temp < ENV_TEMP_MIN || latest_temp > ENV_TEMP_MAX) return false;
    if (latest_humidity < ENV_HUMIDITY_MIN || latest_humidity > ENV_HUMIDITY_MAX) return false;
    if (temp_rate() > ENV_TEMP_RATE_MAX) return false;
    if (humidity_rate() > ENV_HUMIDITY_RATE_MAX) return false;
    return true;
}

// ============================================================
// Public API
// ============================================================

void DataQualityMonitor::initialize(const std::vector<HeaterGroupConfig>& groups) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    reset();
    groups_ = groups;
    
    // 为每个传感器设置 heater_profile 名称
    for (const auto& group : groups_) {
        for (int idx : group.sensor_indices) {
            if (idx >= 0 && idx < NUM_SENSORS) {
                sensors_[idx].heater_profile = group.profile_name;
            }
        }
    }
    
    initialized_ = true;
    spdlog::info("DataQualityMonitor: initialized with {} heater groups", groups_.size());
}

void DataQualityMonitor::on_phase_change(const std::string& phase_name) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    previous_phase_ = current_phase_;
    
    // 从 BASELINE 阶段离开时，锚定基线
    if (is_baseline_phase() && !is_phase(phase_name)) {
        anchor_baseline();
    }
    
    current_phase_ = phase_name;
    spdlog::info("DataQualityMonitor: phase changed to '{}'", phase_name);
}

void DataQualityMonitor::on_reading(int sensor_idx, int heater_step, double value,
                                     double temperature, double humidity, double pressure,
                                     int64_t time_ms) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (!initialized_) return;
    if (sensor_idx < 0 || sensor_idx >= NUM_SENSORS) return;
    if (heater_step < 0 || heater_step >= NUM_HEATER_STEPS) return;
    
    if (first_reading_ms_ == 0) first_reading_ms_ = time_ms;
    total_readings_++;
    reading_counter_++;
    
    auto& sensor = sensors_[sensor_idx];
    auto& step = sensor.steps[heater_step];
    
    // 更新基本状态
    sensor.last_any_reading_ms = time_ms;
    sensor.total_readings++;
    step.latest_value = value;
    step.last_seen_ms = time_ms;
    
    // 周期完整性检测
    check_cycle_integrity(sensor_idx, heater_step);
    
    // 饱和检测
    check_saturation(sensor_idx, value);
    
    // 环境参数 (只用第一个传感器的来更新，避免重复)
    if (sensor_idx == 0 && temperature != 0.0) {
        check_environment(temperature, humidity, time_ms);
    }
    
    // 定期检查（每 80 个读数 ~= 1 个完整周期 × 8 传感器）
    if (reading_counter_ >= 80) {
        reading_counter_ = 0;
        check_liveness(time_ms);
        check_reproducibility();
        check_group_consistency();
        check_response();
        check_data_completeness();
    }
}

QualitySnapshot DataQualityMonitor::get_snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    
    QualitySnapshot snap;
    snap.quality_score = compute_score();
    snap.overall_level = compute_overall_level();
    snap.active_alert_count = static_cast<int>(active_alerts_.size());
    
    // 收集告警 (最多 20 条)
    int count = 0;
    for (const auto& [id, alert] : active_alerts_) {
        if (count >= 20) break;
        snap.alerts.push_back(alert);
        count++;
    }
    
    // 传感器健康
    for (int i = 0; i < NUM_SENSORS; i++) {
        SensorHealthInfo health;
        health.sensor_idx = i;
        health.alive = (sensors_[i].last_any_reading_ms > 0);
        health.completed_cycles = sensors_[i].completed_cycles;
        health.saturated = sensors_[i].saturated_now;
        health.heater_profile = sensors_[i].heater_profile;
        
        // 计算最差步的 CV
        double worst_cv = 0.0;
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            double cv = sensors_[i].steps[s].compute_cv();
            if (cv > worst_cv) worst_cv = cv;
        }
        health.cycle_cv = worst_cv;
        
        // 响应比 (如果有基线)
        if (is_sample_phase()) {
            double max_ratio = 0.0;
            for (int s = 0; s < NUM_HEATER_STEPS; s++) {
                auto& st = sensors_[i].steps[s];
                if (st.has_baseline() && st.baseline_value > 0 && st.latest_value > 0) {
                    double ratio = std::abs(st.latest_value - st.baseline_value) / st.baseline_value;
                    if (ratio > max_ratio) max_ratio = ratio;
                }
            }
            health.response_ratio = max_ratio;
        }
        
        snap.sensor_health.push_back(health);
    }
    
    // 环境
    snap.current_temp_c = env_.latest_temp;
    snap.current_humidity_pct = env_.latest_humidity;
    snap.env_stable = env_.is_stable();
    
    // 周期统计
    int total_cycles = 0;
    double total_cv = 0.0;
    int cv_count = 0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        if (sensors_[i].completed_cycles > total_cycles)
            total_cycles = sensors_[i].completed_cycles;
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            double cv = sensors_[i].steps[s].compute_cv();
            if (sensors_[i].steps[s].cycle_values.size() >= 3) {
                total_cv += cv;
                cv_count++;
            }
        }
    }
    snap.completed_cycles = total_cycles;
    snap.mean_cycle_cv = cv_count > 0 ? total_cv / cv_count : 0.0;
    
    return snap;
}

QualitySummary DataQualityMonitor::finalize_sample() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    QualitySummary summary;
    summary.score = compute_score();
    summary.level = compute_level(summary.score);
    
    // 生成 JSON 报告
    nlohmann::json report;
    report["score"] = summary.score;
    report["level"] = summary.level;
    report["total_readings"] = total_readings_;
    report["saturation_count"] = saturation_count_;
    report["env_alert_count"] = env_alert_count_;
    report["broken_cycles"] = broken_cycles_;
    
    // 传感器详情
    nlohmann::json sensors_json;
    for (int i = 0; i < NUM_SENSORS; i++) {
        nlohmann::json sj;
        sj["alive"] = (sensors_[i].last_any_reading_ms > 0);
        sj["cycles"] = sensors_[i].completed_cycles;
        sj["readings"] = sensors_[i].total_readings;
        sj["profile"] = sensors_[i].heater_profile;
        
        // 最差步 CV
        double worst_cv = 0.0;
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            double cv = sensors_[i].steps[s].compute_cv();
            if (cv > worst_cv) worst_cv = cv;
        }
        sj["mean_cv"] = worst_cv;
        
        sensors_json[std::to_string(i)] = sj;
    }
    report["sensors"] = sensors_json;
    
    // 告警汇总
    nlohmann::json alerts_json = nlohmann::json::array();
    for (const auto& [id, alert] : active_alerts_) {
        alerts_json.push_back({
            {"flag", alert.flag},
            {"severity", alert.severity},
            {"count", alert.count},
            {"sensor_idx", alert.sensor_idx},
            {"message", alert.message}
        });
    }
    report["alerts_summary"] = alerts_json;
    
    // 基线状态
    bool baseline_recorded = false;
    for (int i = 0; i < NUM_SENSORS; i++) {
        if (sensors_[i].steps[0].has_baseline()) {
            baseline_recorded = true;
            break;
        }
    }
    report["baseline_recorded"] = baseline_recorded;
    
    // 数据完整性
    int expected = total_readings_;  // 简化：用实际总读数
    int missing = 0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        missing += sensors_[i].missing_steps;
    }
    report["data_completeness"] = expected > 0 ? 
        1.0 - (static_cast<double>(missing) / expected) : 1.0;
    
    summary.report_json = report.dump();
    
    spdlog::info("DataQualityMonitor: finalized sample score={:.1f} level={}", 
                 summary.score, summary.level);
    
    return summary;
}

void DataQualityMonitor::reset_for_new_sample() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    // 保留传感器分组和基线，重置统计
    active_alerts_.clear();
    first_reading_ms_ = 0;
    total_readings_ = 0;
    saturation_count_ = 0;
    env_alert_count_ = 0;
    broken_cycles_ = 0;
    reading_counter_ = 0;
    
    for (auto& sensor : sensors_) {
        sensor.completed_cycles = 0;
        sensor.total_readings = 0;
        sensor.missing_steps = 0;
        sensor.stuck_count = 0;
        sensor.saturated_now = false;
        sensor.expected_next_step = 0;
        std::fill(std::begin(sensor.current_cycle_steps_seen), 
                  std::end(sensor.current_cycle_steps_seen), false);
        for (auto& step : sensor.steps) {
            step.cycle_values.clear();
            // baseline 保留！
        }
    }
    
    spdlog::info("DataQualityMonitor: reset for new sample (baselines preserved)");
}

void DataQualityMonitor::reset() {
    // 不需要锁 —— 由调用者保证安全或在 initialize() 中已持锁
    initialized_ = false;
    current_phase_.clear();
    previous_phase_.clear();
    groups_.clear();
    active_alerts_.clear();
    env_.reset();
    first_reading_ms_ = 0;
    total_readings_ = 0;
    saturation_count_ = 0;
    env_alert_count_ = 0;
    broken_cycles_ = 0;
    reading_counter_ = 0;
    
    for (auto& sensor : sensors_) {
        sensor.reset();
    }
}

// ============================================================
// 检测项实现
// ============================================================

void DataQualityMonitor::check_liveness(int64_t now_ms) {
    for (int i = 0; i < NUM_SENSORS; i++) {
        auto& sensor = sensors_[i];
        if (sensor.last_any_reading_ms == 0) {
            // 从未收到数据
            if (now_ms - first_reading_ms_ > LIVENESS_TIMEOUT_MS) {
                raise_alert("SENSOR_DEAD", "ERROR",
                    "传感器 S" + std::to_string(i) + " 无数据",
                    i, -1, 0, 0, now_ms);
            }
        } else {
            int64_t gap = now_ms - sensor.last_any_reading_ms;
            if (gap > LIVENESS_TIMEOUT_MS) {
                raise_alert("SENSOR_DEAD", "ERROR",
                    "传感器 S" + std::to_string(i) + " 失联 " + 
                    std::to_string(gap / 1000) + "s",
                    i, -1, static_cast<double>(gap), 
                    static_cast<double>(LIVENESS_TIMEOUT_MS), now_ms);
            } else {
                clear_alert(make_alert_id("SENSOR_DEAD", i, -1));
            }
        }
    }
}

void DataQualityMonitor::check_cycle_integrity(int sensor_idx, int heater_step) {
    auto& sensor = sensors_[sensor_idx];
    
    // 检测周期完成: step 回到 0 且之前已经见过非零步
    bool cycle_completed = false;
    if (heater_step == 0 && sensor.total_readings > 1) {
        bool had_non_zero_steps = false;
        for (int s = 1; s < NUM_HEATER_STEPS; s++) {
            if (sensor.current_cycle_steps_seen[s]) {
                had_non_zero_steps = true;
                break;
            }
        }
        if (had_non_zero_steps) {
            cycle_completed = true;
            
            // 检测是否跳过了步
            int last_expected = sensor.expected_next_step;
            if (last_expected != 0 && last_expected > 1) {
                sensor.missing_steps += (NUM_HEATER_STEPS - last_expected);
                broken_cycles_++;
            }
        }
    }
    
    if (cycle_completed) {
        sensor.completed_cycles++;
        
        // 将上一周期各步的 latest_value 推入 cycle_values
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            if (sensor.current_cycle_steps_seen[s]) {
                sensor.steps[s].add_cycle_value(sensor.steps[s].latest_value);
            }
        }
        
        // 重置当前周期步跟踪
        std::fill(std::begin(sensor.current_cycle_steps_seen), 
                  std::end(sensor.current_cycle_steps_seen), false);
    }
    
    // 标记当前步已见
    sensor.current_cycle_steps_seen[heater_step] = true;
    
    // 更新期望下一步
    sensor.expected_next_step = (heater_step + 1) % NUM_HEATER_STEPS;
}

void DataQualityMonitor::check_saturation(int sensor_idx, double value) {
    auto& sensor = sensors_[sensor_idx];
    
    if (value < SATURATION_LOW || value > SATURATION_HIGH) {
        sensor.saturated_now = true;
        saturation_count_++;
        
        std::string msg = "传感器 S" + std::to_string(sensor_idx);
        double threshold;
        if (value < SATURATION_LOW) {
            msg += " 低饱和 (R=" + std::to_string(static_cast<int>(value)) + "Ω)";
            threshold = SATURATION_LOW;
        } else {
            msg += " 高饱和 (R=" + std::to_string(static_cast<int>(value / 1000)) + "kΩ)";
            threshold = SATURATION_HIGH;
        }
        
        auto now_ms = sensors_[sensor_idx].last_any_reading_ms;
        raise_alert("SATURATION", "ERROR", msg, sensor_idx, -1, value, threshold, now_ms);
    } else {
        sensor.saturated_now = false;
        clear_alert(make_alert_id("SATURATION", sensor_idx, -1));
    }
}

void DataQualityMonitor::check_environment(double temperature, double humidity, int64_t time_ms) {
    env_.add(temperature, humidity, time_ms);
    
    // 温度范围
    if (temperature < ENV_TEMP_MIN || temperature > ENV_TEMP_MAX) {
        env_alert_count_++;
        raise_alert("ENV_TEMP_RANGE", "WARNING",
            "环境温度异常 T=" + std::to_string(static_cast<int>(temperature)) + "°C",
            -1, -1, temperature, 
            temperature < ENV_TEMP_MIN ? ENV_TEMP_MIN : ENV_TEMP_MAX, time_ms);
    } else {
        clear_alert(make_alert_id("ENV_TEMP_RANGE", -1, -1));
    }
    
    // 湿度范围
    if (humidity < ENV_HUMIDITY_MIN || humidity > ENV_HUMIDITY_MAX) {
        env_alert_count_++;
        raise_alert("ENV_HUMIDITY_RANGE", "WARNING",
            "环境湿度异常 RH=" + std::to_string(static_cast<int>(humidity)) + "%",
            -1, -1, humidity,
            humidity < ENV_HUMIDITY_MIN ? ENV_HUMIDITY_MIN : ENV_HUMIDITY_MAX, time_ms);
    } else {
        clear_alert(make_alert_id("ENV_HUMIDITY_RANGE", -1, -1));
    }
    
    // 温度变化速率
    double temp_rate = env_.temp_rate();
    if (temp_rate > ENV_TEMP_RATE_MAX) {
        env_alert_count_++;
        raise_alert("ENV_TEMP_RATE", "WARNING",
            "温度变化过快 " + std::to_string(temp_rate).substr(0, 4) + "°C/min",
            -1, -1, temp_rate, ENV_TEMP_RATE_MAX, time_ms);
    } else {
        clear_alert(make_alert_id("ENV_TEMP_RATE", -1, -1));
    }
    
    // 湿度变化速率
    double hum_rate = env_.humidity_rate();
    if (hum_rate > ENV_HUMIDITY_RATE_MAX) {
        env_alert_count_++;
        raise_alert("ENV_HUMIDITY_RATE", "WARNING",
            "湿度变化过快 " + std::to_string(hum_rate).substr(0, 4) + "%/min",
            -1, -1, hum_rate, ENV_HUMIDITY_RATE_MAX, time_ms);
    } else {
        clear_alert(make_alert_id("ENV_HUMIDITY_RATE", -1, -1));
    }
}

void DataQualityMonitor::check_reproducibility() {
    // 仅在 BASELINE / RECOVERY 阶段做严格检测
    // PREHEAT 阶段降级为 INFO
    if (is_sample_phase()) return;  // SAMPLE 阶段不检测
    
    std::string severity = is_preheat_phase() ? "INFO" : "WARNING";
    double threshold = BASELINE_CV_THRESHOLD;
    
    for (int i = 0; i < NUM_SENSORS; i++) {
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            auto& step = sensors_[i].steps[s];
            if (step.cycle_values.size() < 3) continue;
            
            double cv = step.compute_cv();
            if (cv > threshold) {
                auto now_ms = sensors_[i].last_any_reading_ms;
                raise_alert("LOW_REPRODUCIBILITY", severity,
                    "S" + std::to_string(i) + " step" + std::to_string(s) +
                    " CV=" + std::to_string(cv * 100).substr(0, 4) + "% > " +
                    std::to_string(threshold * 100).substr(0, 3) + "%",
                    i, s, cv, threshold, now_ms);
            } else {
                clear_alert(make_alert_id("LOW_REPRODUCIBILITY", i, s));
            }
        }
    }
}

void DataQualityMonitor::check_group_consistency() {
    // 仅在 BASELINE / SAMPLE 阶段检测
    if (!is_baseline_phase() && !is_sample_phase()) return;
    
    for (const auto& group : groups_) {
        if (group.sensor_indices.size() < 2) continue;  // 单传感器组跳过
        
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            // 收集组内各传感器该步的最新周期值
            std::vector<std::pair<int, double>> values;
            for (int idx : group.sensor_indices) {
                if (idx < 0 || idx >= NUM_SENSORS) continue;
                auto& step = sensors_[idx].steps[s];
                if (!step.cycle_values.empty()) {
                    values.push_back({idx, step.cycle_values.back()});
                }
            }
            
            if (values.size() < 2) continue;
            
            // 计算均值和标准差
            double sum = 0.0;
            for (auto& [idx, v] : values) sum += v;
            double mean = sum / values.size();
            
            double sum2 = 0.0;
            for (auto& [idx, v] : values) {
                double d = v - mean;
                sum2 += d * d;
            }
            double stddev = std::sqrt(sum2 / values.size());
            
            if (mean <= 0 || stddev <= 0) continue;
            
            // 检测离群者 (> 3σ)
            for (auto& [idx, v] : values) {
                double z = std::abs(v - mean) / stddev;
                if (z > 3.0) {
                    auto now_ms = sensors_[idx].last_any_reading_ms;
                    raise_alert("GROUP_OUTLIER", "INFO",
                        "S" + std::to_string(idx) + " 在组 " + group.profile_name +
                        " step" + std::to_string(s) + " 偏差 " + 
                        std::to_string(z).substr(0, 4) + "σ",
                        idx, s, z, 3.0, now_ms);
                } else {
                    clear_alert(make_alert_id("GROUP_OUTLIER", idx, s));
                }
            }
        }
    }
}

void DataQualityMonitor::check_response() {
    // 仅在 SAMPLE 阶段检测
    if (!is_sample_phase()) return;
    
    for (int i = 0; i < NUM_SENSORS; i++) {
        bool has_response = false;
        
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            auto& step = sensors_[i].steps[s];
            if (!step.has_baseline()) continue;
            if (step.baseline_value <= 0 || step.latest_value <= 0) continue;
            
            double ratio = std::abs(step.latest_value - step.baseline_value) / step.baseline_value;
            if (ratio > RESPONSE_WEAK_THRESHOLD) {
                has_response = true;
                break;
            }
        }
        
        if (!has_response && sensors_[i].completed_cycles >= 2) {
            auto now_ms = sensors_[i].last_any_reading_ms;
            raise_alert("WEAK_RESPONSE", "INFO",
                "S" + std::to_string(i) + " 响应微弱 (变化 < " +
                std::to_string(static_cast<int>(RESPONSE_WEAK_THRESHOLD * 100)) + "%)",
                i, -1, 0.0, RESPONSE_WEAK_THRESHOLD, now_ms);
        } else {
            clear_alert(make_alert_id("WEAK_RESPONSE", i, -1));
        }
    }
}

void DataQualityMonitor::check_data_completeness() {
    for (int i = 0; i < NUM_SENSORS; i++) {
        auto& sensor = sensors_[i];
        if (sensor.completed_cycles < 2) continue;
        
        int expected_readings = sensor.completed_cycles * NUM_HEATER_STEPS;
        double missing_ratio = expected_readings > 0 ?
            static_cast<double>(sensor.missing_steps) / expected_readings : 0.0;
        
        if (missing_ratio > 0.2) {
            auto now_ms = sensor.last_any_reading_ms;
            raise_alert("DATA_INCOMPLETE", "WARNING",
                "S" + std::to_string(i) + " 数据不完整 (" +
                std::to_string(static_cast<int>(missing_ratio * 100)) + "% 丢失)",
                i, -1, missing_ratio, 0.2, now_ms);
        } else {
            clear_alert(make_alert_id("DATA_INCOMPLETE", i, -1));
        }
    }
}

// ============================================================
// 告警管理
// ============================================================

std::string DataQualityMonitor::make_alert_id(const std::string& flag, int sensor_idx, int heater_step) const {
    return flag + ":" + std::to_string(sensor_idx) + ":" + std::to_string(heater_step);
}

void DataQualityMonitor::raise_alert(const std::string& flag, const std::string& severity,
                                      const std::string& message, int sensor_idx, int heater_step,
                                      double value, double threshold, int64_t time_ms) {
    std::string id = make_alert_id(flag, sensor_idx, heater_step);
    
    auto it = active_alerts_.find(id);
    if (it != active_alerts_.end()) {
        // 已存在 -> 更新计数和时间
        it->second.last_seen_ms = time_ms;
        it->second.count++;
        it->second.value = value;
        it->second.message = message;
    } else {
        // 新告警
        QualityAlert alert;
        alert.id = id;
        alert.flag = flag;
        alert.severity = severity;
        alert.message = message;
        alert.sensor_idx = sensor_idx;
        alert.heater_step = heater_step;
        alert.value = value;
        alert.threshold = threshold;
        alert.first_seen_ms = time_ms;
        alert.last_seen_ms = time_ms;
        alert.count = 1;
        active_alerts_[id] = alert;
        
        spdlog::warn("DataQualityMonitor: [{}] {}", severity, message);
    }
}

void DataQualityMonitor::clear_alert(const std::string& alert_id) {
    active_alerts_.erase(alert_id);
}

// ============================================================
// 基线锚定
// ============================================================

void DataQualityMonitor::anchor_baseline() {
    int anchored = 0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            auto& step = sensors_[i].steps[s];
            if (step.cycle_values.size() >= 2) {
                double sum = 0.0;
                for (double v : step.cycle_values) sum += v;
                step.baseline_value = sum / step.cycle_values.size();
                anchored++;
            }
        }
    }
    spdlog::info("DataQualityMonitor: anchored {} baselines from BASELINE phase", anchored);
}

// ============================================================
// 评分
// ============================================================

double DataQualityMonitor::compute_score() const {
    double score = 100.0;
    
    // 传感器存活惩罚 (最高 -40)
    int dead = 0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        if (first_reading_ms_ > 0 && sensors_[i].last_any_reading_ms == 0) {
            dead++;
        }
    }
    score -= dead * 5.0;
    
    // 周期完整性惩罚 (最高 -20)
    int total_cycles = 0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        total_cycles += sensors_[i].completed_cycles;
    }
    if (total_cycles > 0) {
        double broken_ratio = static_cast<double>(broken_cycles_) / total_cycles;
        score -= broken_ratio * 20.0;
    }
    
    // 周期可重复性惩罚 (最高 -20, 仅 BASELINE/RECOVERY 有意义)
    double worst_cv = 0.0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        for (int s = 0; s < NUM_HEATER_STEPS; s++) {
            double cv = sensors_[i].steps[s].compute_cv();
            if (cv > worst_cv) worst_cv = cv;
        }
    }
    if (worst_cv > BASELINE_CV_THRESHOLD) {
        score -= std::min(20.0, (worst_cv - BASELINE_CV_THRESHOLD) * 200.0);
    }
    
    // 饱和惩罚 (最高 -30)
    if (total_readings_ > 0) {
        double sat_ratio = static_cast<double>(saturation_count_) / total_readings_;
        score -= sat_ratio * 30.0;
    }
    
    // 数据完整性惩罚 (最高 -10)
    int total_missing = 0;
    int total_expected = 0;
    for (int i = 0; i < NUM_SENSORS; i++) {
        total_missing += sensors_[i].missing_steps;
        total_expected += sensors_[i].completed_cycles * NUM_HEATER_STEPS;
    }
    if (total_expected > 0) {
        double missing_ratio = static_cast<double>(total_missing) / total_expected;
        score -= missing_ratio * 10.0;
    }
    
    // 环境不稳定惩罚 (最高 -10)
    score -= std::min(10.0, env_alert_count_ * 2.0);
    
    return std::max(0.0, std::min(100.0, score));
}

std::string DataQualityMonitor::compute_level(double score) const {
    if (score >= 80.0) return "good";
    if (score >= 50.0) return "warning";
    return "poor";
}

int DataQualityMonitor::compute_overall_level() const {
    double score = compute_score();
    if (score >= 80.0) return 1;  // QUALITY_GOOD
    if (score >= 50.0) return 2;  // QUALITY_WARNING
    return 3;                     // QUALITY_POOR
}

// ============================================================
// 阶段判断
// ============================================================

bool DataQualityMonitor::is_phase(const std::string& name) const {
    // 大小写不敏感比较
    std::string upper;
    upper.reserve(current_phase_.size());
    for (char c : current_phase_) upper += static_cast<char>(std::toupper(c));
    
    std::string upper_name;
    upper_name.reserve(name.size());
    for (char c : name) upper_name += static_cast<char>(std::toupper(c));
    
    return upper == upper_name;
}

bool DataQualityMonitor::is_baseline_phase() const {
    std::string upper;
    for (char c : current_phase_) upper += static_cast<char>(std::toupper(c));
    return upper.find("BASELINE") != std::string::npos;
}

bool DataQualityMonitor::is_sample_phase() const {
    std::string upper;
    for (char c : current_phase_) upper += static_cast<char>(std::toupper(c));
    return upper.find("SAMPLE") != std::string::npos || 
           upper.find("ACQUIRE") != std::string::npos ||
           upper.find("DOSE") != std::string::npos;
}

bool DataQualityMonitor::is_preheat_phase() const {
    std::string upper;
    for (char c : current_phase_) upper += static_cast<char>(std::toupper(c));
    return upper.find("PREHEAT") != std::string::npos;
}

bool DataQualityMonitor::is_recovery_phase() const {
    std::string upper;
    for (char c : current_phase_) upper += static_cast<char>(std::toupper(c));
    return upper.find("RECOVERY") != std::string::npos || 
           upper.find("PURGE") != std::string::npos ||
           upper.find("RINSE") != std::string::npos;
}

} // namespace workflows
