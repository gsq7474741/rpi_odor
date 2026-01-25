#include "hal/load_cell_driver.hpp"
#include "hal/actuator_driver.hpp"
#include <spdlog/spdlog.h>
#include <numeric>
#include <cmath>
#include <algorithm>
#include <fstream>

namespace hal {

LoadCellDriver::LoadCellDriver(boost::asio::io_context& io,
                               std::shared_ptr<ActuatorDriver> actuator,
                               const LoadCellConfig& config)
    : io_(io)
    , actuator_(std::move(actuator))
    , config_(config)
{
    spdlog::info("LoadCellDriver: Initialized for sensor '{}'", config_.name);
}

LoadCellDriver::~LoadCellDriver() {
    stop();
}

void LoadCellDriver::start() {
    if (running_) return;
    running_ = true;
    
    status_connection_ = actuator_->on_status_update.connect(
        [this](const nlohmann::json& status) {
            on_klipper_status(status);
        });
    
    // 启动定时轮询 (WebSocket 订阅只在值变化时推送，需要主动查询)
    poll_timer_ = std::make_unique<boost::asio::steady_timer>(io_);
    start_polling();
    
    spdlog::info("LoadCellDriver: Started monitoring with polling");
}

void LoadCellDriver::stop() {
    if (!running_) return;
    running_ = false;
    status_connection_.disconnect();
    if (poll_timer_) {
        poll_timer_->cancel();
    }
    spdlog::info("LoadCellDriver: Stopped monitoring");
}

void LoadCellDriver::start_polling() {
    if (!running_) return;
    
    // 查询 load_cell 对象状态
    std::string object_name = "load_cell " + config_.name;
    actuator_->query_object(object_name, [this](const nlohmann::json& response) {
        on_poll_response(response);
    });
    
    // 每 200ms 轮询一次
    poll_timer_->expires_after(std::chrono::milliseconds(200));
    poll_timer_->async_wait([this](const boost::system::error_code& ec) {
        if (!ec && running_) {
            start_polling();
        }
    });
}

void LoadCellDriver::on_poll_response(const nlohmann::json& response) {
    try {
        if (!response.contains("result") || !response["result"].contains("status")) {
            return;
        }
        
        const auto& status = response["result"]["status"];
        on_klipper_status(status);
    } catch (const std::exception& e) {
        spdlog::warn("LoadCellDriver: Failed to parse poll response: {}", e.what());
    }
}

void LoadCellDriver::tare() {
    std::string cmd = "LOAD_CELL_TARE LOAD_CELL=" + config_.name;
    actuator_->send_gcode(cmd);
    
    tare_offset_ = status_.filtered_weight;
    spdlog::info("LoadCellDriver: Tare executed, offset = {:.2f}g", tare_offset_);
}

void LoadCellDriver::on_klipper_status(const nlohmann::json& status) {
    try {
        std::string key = "load_cell " + config_.name;
        if (!status.contains(key)) return;
        
        const auto& lc = status[key];
        
        // 读取原始百分比
        if (lc.contains("raw_sample")) {
            // raw_sample 是 -1.0 到 1.0 的范围，转换为百分比
            status_.raw_percent = lc["raw_sample"].get<float>() * 100.0f;
        }
        
        // 读取标定后的克数
        if (lc.contains("force_g")) {
            float force_g = lc["force_g"].get<float>();
            
            // 如果配置了反转读数
            if (config_.invert_reading) {
                force_g = -force_g;
            }
            
            status_.raw_weight = force_g;
            status_.is_calibrated = true;
            
            update_filter(force_g);
            compute_statistics();
            check_overflow();
            check_drain_complete();
        } else {
            status_.is_calibrated = false;
        }
        
        status_.sensor_ok = true;
        status_.last_update = std::chrono::steady_clock::now();
        
        on_status_update(status_);
        
    } catch (const std::exception& e) {
        spdlog::warn("LoadCellDriver: Failed to parse status: {}", e.what());
    }
}

void LoadCellDriver::update_filter(float new_sample) {
    samples_.push_back(new_sample);
    
    while (samples_.size() > config_.filter_window_size) {
        samples_.pop_front();
    }
    
    if (!samples_.empty()) {
        float sum = std::accumulate(samples_.begin(), samples_.end(), 0.0f);
        float raw_filtered = sum / static_cast<float>(samples_.size());
        
        // 直接使用原始测量值，不应用校准
        // weight_scale/weight_offset 仅用于进样时的 mm->g 转换补偿
        status_.filtered_weight = raw_filtered;
        status_.tared_weight = status_.filtered_weight - tare_offset_;
    }
}

void LoadCellDriver::compute_statistics() {
    if (samples_.size() < 3) {
        status_.stddev = 0.0f;
        status_.is_stable = false;
        status_.trend = WeightTrend::STABLE;
        return;
    }
    
    float mean = status_.filtered_weight;
    float variance = 0.0f;
    for (const auto& s : samples_) {
        float diff = s - mean;
        variance += diff * diff;
    }
    status_.stddev = std::sqrt(variance / static_cast<float>(samples_.size()));
    
    status_.is_stable = (status_.stddev < config_.stable_stddev_threshold);
    
    if (samples_.size() >= config_.filter_window_size) {
        size_t half = samples_.size() / 2;
        float recent_sum = 0.0f, older_sum = 0.0f;
        
        for (size_t i = 0; i < half; ++i) {
            older_sum += samples_[i];
        }
        for (size_t i = half; i < samples_.size(); ++i) {
            recent_sum += samples_[i];
        }
        
        float recent_avg = recent_sum / static_cast<float>(samples_.size() - half);
        float older_avg = older_sum / static_cast<float>(half);
        float delta = recent_avg - older_avg;
        
        if (delta > config_.trend_threshold) {
            status_.trend = WeightTrend::INCREASING;
        } else if (delta < -config_.trend_threshold) {
            status_.trend = WeightTrend::DECREASING;
        } else {
            status_.trend = WeightTrend::STABLE;
        }
    }
}

void LoadCellDriver::check_overflow() {
    float threshold = config_.max_bottle_weight - config_.overflow_margin;
    bool warning = (status_.tared_weight > threshold);
    
    if (warning && !status_.overflow_warning) {
        spdlog::warn("LoadCellDriver: Overflow warning! Weight {:.1f}g > threshold {:.1f}g",
                     status_.tared_weight, threshold);
        on_overflow_warning();
    }
    
    status_.overflow_warning = warning;
}

void LoadCellDriver::check_drain_complete() {
    auto now = std::chrono::steady_clock::now();
    
    if (status_.is_stable && status_.trend == WeightTrend::STABLE) {
        if (!was_stable_) {
            stable_since_ = now;
            was_stable_ = true;
            drain_complete_fired_ = false;  // 重新进入稳定状态时重置
        }
        
        auto stable_duration = std::chrono::duration<float>(now - stable_since_).count();
        if (stable_duration >= config_.drain_stable_duration && !drain_complete_fired_) {
            float weight_diff = std::abs(status_.filtered_weight - last_trend_weight_);
            if (weight_diff < config_.trend_threshold) {
                spdlog::info("LoadCellDriver: Drain complete detected (stable for {:.1f}s)",
                             stable_duration);
                on_drain_complete();
                last_trend_weight_ = status_.filtered_weight;
                drain_complete_fired_ = true;  // 标记已触发，防止重复
            }
        }
    } else {
        was_stable_ = false;
        drain_complete_fired_ = false;  // 不稳定时重置
        last_trend_weight_ = status_.filtered_weight;
    }
}

// ============================================================
// 标定方法实现
// ============================================================

void LoadCellDriver::start_calibration() {
    calibration_step_ = CalibrationStep::ZERO_POINT;
    
    // 启动 Klipper 标定向导
    std::string cmd = "LOAD_CELL_CALIBRATE LOAD_CELL=" + config_.name;
    actuator_->send_gcode(cmd);
    
    spdlog::info("LoadCellDriver: Calibration started, waiting for zero point");
    on_calibration_update(calibration_step_, "请移除悬臂上的所有物体，然后点击「设置零点」");
}

void LoadCellDriver::set_zero_point() {
    if (calibration_step_ != CalibrationStep::ZERO_POINT) {
        spdlog::warn("LoadCellDriver: set_zero_point called in wrong step");
        return;
    }
    
    // 发送 TARE 命令
    actuator_->send_gcode("TARE");
    
    calibration_step_ = CalibrationStep::REFERENCE_WEIGHT;
    spdlog::info("LoadCellDriver: Zero point set, current raw: {:.2f}%", status_.raw_percent);
    on_calibration_update(calibration_step_, "零点已设置。请放置已知重量的物体，输入重量后点击「确认标定」");
}

void LoadCellDriver::set_reference_weight(float grams) {
    if (calibration_step_ != CalibrationStep::REFERENCE_WEIGHT) {
        spdlog::warn("LoadCellDriver: set_reference_weight called in wrong step");
        return;
    }
    
    reference_weight_grams_ = grams;
    
    // 发送 CALIBRATE 命令
    std::string cmd = "CALIBRATE GRAMS=" + std::to_string(static_cast<int>(grams));
    actuator_->send_gcode(cmd);
    
    calibration_step_ = CalibrationStep::VERIFY;
    spdlog::info("LoadCellDriver: Reference weight set to {:.1f}g", grams);
    on_calibration_update(calibration_step_, "标定完成，请验证读数。点击「保存」确认或「重新标定」");
}

void LoadCellDriver::save_calibration() {
    if (calibration_step_ != CalibrationStep::VERIFY) {
        spdlog::warn("LoadCellDriver: save_calibration called in wrong step");
        return;
    }
    
    // 发送 ACCEPT 命令接受标定结果
    actuator_->send_gcode("ACCEPT");
    spdlog::info("LoadCellDriver: Calibration accepted");
    
    // 发送 SAVE_CONFIG 命令保存到 printer.cfg 并重启 Klipper
    // 注意：SAVE_CONFIG 会导致 Klipper 重启，前端需要处理断开重连
    actuator_->send_gcode("SAVE_CONFIG");
    spdlog::info("LoadCellDriver: SAVE_CONFIG sent, Klipper will restart");
    
    calibration_step_ = CalibrationStep::COMPLETE;
    on_calibration_update(calibration_step_, "标定已保存到 printer.cfg，Klipper 正在重启...");
    
    // 重置状态
    calibration_step_ = CalibrationStep::IDLE;
}

void LoadCellDriver::cancel_calibration() {
    if (calibration_step_ == CalibrationStep::IDLE) {
        return;
    }
    
    // 发送 ABORT 命令取消标定
    actuator_->send_gcode("ABORT");
    
    calibration_step_ = CalibrationStep::IDLE;
    spdlog::info("LoadCellDriver: Calibration cancelled");
    on_calibration_update(calibration_step_, "标定已取消");
}

// ============================================================
// 业务配置方法实现
// ============================================================

void LoadCellDriver::set_overflow_threshold(float threshold) {
    config_.overflow_threshold = threshold;
    spdlog::info("LoadCellDriver: Overflow threshold set to {:.1f}g", threshold);
}

void LoadCellDriver::set_pump_calibration(float slope, float offset) {
    config_.pump_mm_to_ml = slope;
    config_.pump_mm_offset = offset;
    spdlog::info("LoadCellDriver: Pump calibration set: slope={:.4f} g/mm, offset={:.2f} g", slope, offset);
    
    // 自动保存到配置文件
    if (save_config()) {
        spdlog::info("LoadCellDriver: Pump calibration saved to config file");
    }
}

// ============================================================
// 动态空瓶值方法实现
// ============================================================

LoadCellDriver::WaitForEmptyResult LoadCellDriver::wait_for_empty_bottle(
    float tolerance, float timeout_sec, float stability_window_sec) {
    
    WaitForEmptyResult result;
    
    // 获取参考空瓶值：优先使用动态值
    float reference_weight = dynamic_empty_weight_.value_or(0.0f);
    
    spdlog::info("LoadCellDriver: Waiting for empty bottle (ref={:.1f}g, tol={:.1f}g, timeout={:.1f}s, window={:.1f}s)",
                 reference_weight, tolerance, timeout_sec, stability_window_sec);
    
    auto start_time = std::chrono::steady_clock::now();
    int stable_count = 0;
    float last_weight = 0.0f;
    std::optional<std::chrono::steady_clock::time_point> window_start_time;
    float stable_weight = 0.0f;
    
    while (true) {
        auto elapsed = std::chrono::duration<float>(std::chrono::steady_clock::now() - start_time).count();
        if (elapsed >= timeout_sec) {
            result.success = false;
            result.error_message = "等待空瓶稳定超时";
            spdlog::warn("LoadCellDriver: Wait for empty bottle timeout");
            return result;
        }
        
        float current_weight = status_.filtered_weight;
        bool is_stable = status_.is_stable;
        
        // 对于第一次使用（没有参考值），只需要等待稳定
        bool is_near_reference = (reference_weight == 0.0f) || 
                                  (std::abs(current_weight - reference_weight) <= tolerance);
        
        if (is_near_reference && is_stable) {
            if (std::abs(current_weight - last_weight) < 1.0f) {
                stable_count++;
                if (stable_count >= 3) {
                    // 达到稳态
                    if (stability_window_sec <= 0) {
                        // 不使用稳定窗口，直接更新空瓶值并返回
                        dynamic_empty_weight_ = current_weight;
                        result.success = true;
                        result.empty_weight = current_weight;
                        spdlog::info("LoadCellDriver: Empty bottle detected: {:.1f}g", current_weight);
                        return result;
                    }
                    
                    if (!window_start_time.has_value()) {
                        window_start_time = std::chrono::steady_clock::now();
                        stable_weight = current_weight;
                        spdlog::info("LoadCellDriver: Stability window started ({:.1f}g)", current_weight);
                    } else {
                        if (std::abs(current_weight - stable_weight) >= 0.5f) {
                            // 重量变化，刷新窗口
                            window_start_time = std::chrono::steady_clock::now();
                            stable_weight = current_weight;
                            spdlog::info("LoadCellDriver: New stable state ({:.1f}g), reset window", current_weight);
                        } else {
                            auto window_elapsed = std::chrono::duration<float>(
                                std::chrono::steady_clock::now() - *window_start_time).count();
                            if (window_elapsed >= stability_window_sec) {
                                // 窗口完成，更新空瓶值并返回
                                dynamic_empty_weight_ = current_weight;
                                result.success = true;
                                result.empty_weight = current_weight;
                                spdlog::info("LoadCellDriver: Stability window complete, empty weight: {:.1f}g", current_weight);
                                return result;
                            }
                        }
                    }
                }
            } else {
                stable_count = 0;
                if (window_start_time.has_value()) {
                    spdlog::debug("LoadCellDriver: Weight change, reset window");
                    window_start_time.reset();
                }
            }
        } else {
            stable_count = 0;
            if (window_start_time.has_value()) {
                window_start_time.reset();
            }
        }
        
        last_weight = current_weight;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
}

void LoadCellDriver::reset_dynamic_empty_weight() {
    dynamic_empty_weight_.reset();
    spdlog::info("LoadCellDriver: Dynamic empty weight reset");
}

std::optional<float> LoadCellDriver::get_dynamic_empty_weight() const {
    return dynamic_empty_weight_;
}

// ============================================================
// 配置持久化方法实现
// ============================================================

bool LoadCellDriver::load_config_from_file(const std::filesystem::path& path) {
    try {
        if (!std::filesystem::exists(path)) {
            spdlog::info("LoadCellDriver: Config file not found: {}", path.string());
            return false;
        }
        
        std::ifstream file(path);
        if (!file.is_open()) {
            spdlog::warn("LoadCellDriver: Failed to open config file: {}", path.string());
            return false;
        }
        
        nlohmann::json j;
        file >> j;
        
        // 加载业务配置参数
        if (j.contains("overflow_threshold")) {
            config_.overflow_threshold = j["overflow_threshold"].get<float>();
        }
        if (j.contains("drain_complete_margin")) {
            config_.drain_complete_margin = j["drain_complete_margin"].get<float>();
        }
        if (j.contains("stable_stddev_threshold")) {
            config_.stable_stddev_threshold = j["stable_stddev_threshold"].get<float>();
        }
        // 可选: 加载其他配置
        if (j.contains("invert_reading")) {
            config_.invert_reading = j["invert_reading"].get<bool>();
        }
        if (j.contains("filter_window_size")) {
            config_.filter_window_size = j["filter_window_size"].get<size_t>();
        }
        if (j.contains("pump_mm_to_ml")) {
            config_.pump_mm_to_ml = j["pump_mm_to_ml"].get<float>();
        }
        if (j.contains("pump_mm_offset")) {
            config_.pump_mm_offset = j["pump_mm_offset"].get<float>();
        }
        if (j.contains("weight_scale")) {
            config_.weight_scale = j["weight_scale"].get<float>();
        }
        if (j.contains("weight_offset")) {
            config_.weight_offset = j["weight_offset"].get<float>();
        }
        
        config_path_ = path;
        spdlog::info("LoadCellDriver: Config loaded from {}", path.string());
        spdlog::info("  overflow_threshold: {:.1f}g", config_.overflow_threshold);
        spdlog::info("  drain_complete_margin: {:.1f}g", config_.drain_complete_margin);
        spdlog::info("  stable_stddev_threshold: {:.1f}g", config_.stable_stddev_threshold);
        spdlog::info("  pump_mm_to_ml: {:.4f} g/mm, pump_mm_offset: {:.2f} g", config_.pump_mm_to_ml, config_.pump_mm_offset);
        spdlog::info("  weight_scale: {:.4f}, weight_offset: {:.4f}g", config_.weight_scale, config_.weight_offset);
        
        return true;
    } catch (const std::exception& e) {
        spdlog::error("LoadCellDriver: Failed to load config: {}", e.what());
        return false;
    }
}

bool LoadCellDriver::save_config_to_file(const std::filesystem::path& path) const {
    try {
        // 确保目录存在
        auto parent = path.parent_path();
        if (!parent.empty() && !std::filesystem::exists(parent)) {
            std::filesystem::create_directories(parent);
        }
        
        nlohmann::json j;
        j["overflow_threshold"] = config_.overflow_threshold;
        j["drain_complete_margin"] = config_.drain_complete_margin;
        j["stable_stddev_threshold"] = config_.stable_stddev_threshold;
        j["invert_reading"] = config_.invert_reading;
        j["filter_window_size"] = config_.filter_window_size;
        j["pump_mm_to_ml"] = config_.pump_mm_to_ml;
        j["pump_mm_offset"] = config_.pump_mm_offset;
        j["weight_scale"] = config_.weight_scale;
        j["weight_offset"] = config_.weight_offset;
        
        std::ofstream file(path);
        if (!file.is_open()) {
            spdlog::error("LoadCellDriver: Failed to open config file for writing: {}", path.string());
            return false;
        }
        
        file << j.dump(2);
        spdlog::info("LoadCellDriver: Config saved to {}", path.string());
        return true;
    } catch (const std::exception& e) {
        spdlog::error("LoadCellDriver: Failed to save config: {}", e.what());
        return false;
    }
}

bool LoadCellDriver::save_config() {
    if (config_path_.empty()) {
        spdlog::warn("LoadCellDriver: No config path set, cannot save");
        return false;
    }
    return save_config_to_file(config_path_);
}

} // namespace hal
