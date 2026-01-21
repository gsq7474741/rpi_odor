#include "hal/load_cell_driver.hpp"
#include "hal/actuator_driver.hpp"
#include <spdlog/spdlog.h>
#include <numeric>
#include <cmath>
#include <algorithm>

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
        status_.filtered_weight = sum / static_cast<float>(samples_.size());
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
        }
        
        auto stable_duration = std::chrono::duration<float>(now - stable_since_).count();
        if (stable_duration >= config_.drain_stable_duration) {
            float weight_diff = std::abs(status_.filtered_weight - last_trend_weight_);
            if (weight_diff < config_.trend_threshold) {
                spdlog::info("LoadCellDriver: Drain complete detected (stable for {:.1f}s)",
                             stable_duration);
                on_drain_complete();
                last_trend_weight_ = status_.filtered_weight;
            }
        }
    } else {
        was_stable_ = false;
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
    
    // 发送 ACCEPT 命令保存标定结果
    actuator_->send_gcode("ACCEPT");
    
    calibration_step_ = CalibrationStep::COMPLETE;
    spdlog::info("LoadCellDriver: Calibration saved");
    on_calibration_update(calibration_step_, "标定已保存");
    
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

void LoadCellDriver::set_empty_bottle_baseline() {
    config_.empty_bottle_weight = status_.filtered_weight;
    tare_offset_ = status_.filtered_weight;
    spdlog::info("LoadCellDriver: Empty bottle baseline set to {:.1f}g", config_.empty_bottle_weight);
}

void LoadCellDriver::set_overflow_threshold(float threshold) {
    config_.overflow_threshold = threshold;
    spdlog::info("LoadCellDriver: Overflow threshold set to {:.1f}g", threshold);
}

} // namespace hal
