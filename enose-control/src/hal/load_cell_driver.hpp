#pragma once

#include <boost/asio/io_context.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/signals2.hpp>
#include <nlohmann/json.hpp>
#include <deque>
#include <chrono>
#include <memory>
#include <string>
#include <atomic>

namespace hal {

class ActuatorDriver;

enum class WeightTrend { STABLE, INCREASING, DECREASING };

enum class CalibrationStep {
    IDLE,
    ZERO_POINT,
    REFERENCE_WEIGHT,
    VERIFY,
    COMPLETE
};

struct LoadCellConfig {
    std::string name = "my_hx711";
    
    // 读数反转 (如果传感器安装方向导致读数为负)
    bool invert_reading = true;
    
    // 滤波参数
    size_t filter_window_size = 10;
    
    // 稳定检测
    float stable_stddev_threshold = 2.0f;  // g
    float trend_threshold = 5.0f;          // g
    
    // 安全阈值
    float max_bottle_weight = 500.0f;      // g
    float overflow_margin = 50.0f;         // g
    
    // 排废检测
    float drain_stable_duration = 2.0f;    // s
    
    // 异常跳变检测
    float jump_threshold = 50.0f;          // g
    
    // 业务参数
    float empty_bottle_weight = 0.0f;      // g (空瓶基准)
    float overflow_threshold = 400.0f;     // g (溢出阈值)
    float drain_complete_margin = 10.0f;   // g (排空余量)
};

struct LoadCellStatus {
    float raw_weight = 0.0f;        // 原始读数 (g)
    float raw_percent = 0.0f;       // 原始百分比 (-100% ~ 100%)
    float filtered_weight = 0.0f;   // 滤波后读数 (g)
    float tared_weight = 0.0f;      // 去皮后读数 (g)
    float stddev = 0.0f;            // 标准差 (g)
    WeightTrend trend = WeightTrend::STABLE;
    bool is_stable = false;
    bool is_calibrated = false;     // 是否已标定
    bool overflow_warning = false;
    bool sensor_ok = false;
    std::chrono::steady_clock::time_point last_update;
};

class LoadCellDriver : public std::enable_shared_from_this<LoadCellDriver> {
public:
    LoadCellDriver(boost::asio::io_context& io, 
                   std::shared_ptr<ActuatorDriver> actuator,
                   const LoadCellConfig& config = {});
    ~LoadCellDriver();

    void start();
    void stop();

    void tare();
    
    float get_raw_weight() const { return status_.raw_weight; }
    float get_filtered_weight() const { return status_.filtered_weight; }
    float get_tared_weight() const { return status_.tared_weight; }
    
    bool is_stable() const { return status_.is_stable; }
    bool is_overflow_warning() const { return status_.overflow_warning; }
    WeightTrend get_trend() const { return status_.trend; }
    
    LoadCellStatus get_status() const { return status_; }
    const LoadCellConfig& get_config() const { return config_; }
    
    void set_max_bottle_weight(float weight) { config_.max_bottle_weight = weight; }
    void set_config(const LoadCellConfig& config) { config_ = config; }
    
    // 标定相关
    void start_calibration();
    void set_zero_point();
    void set_reference_weight(float grams);
    void save_calibration();
    void cancel_calibration();
    CalibrationStep get_calibration_step() const { return calibration_step_; }
    
    // 业务配置
    void set_empty_bottle_baseline();
    void set_overflow_threshold(float threshold);
    
    boost::signals2::signal<void(const LoadCellStatus&)> on_status_update;
    boost::signals2::signal<void(CalibrationStep, const std::string&)> on_calibration_update;
    boost::signals2::signal<void()> on_overflow_warning;
    boost::signals2::signal<void()> on_drain_complete;

private:
    void on_klipper_status(const nlohmann::json& status);
    void update_filter(float new_sample);
    void compute_statistics();
    void check_overflow();
    void check_drain_complete();
    void start_polling();
    void on_poll_response(const nlohmann::json& response);

    boost::asio::io_context& io_;
    std::shared_ptr<ActuatorDriver> actuator_;
    LoadCellConfig config_;
    LoadCellStatus status_;
    
    std::deque<float> samples_;
    float tare_offset_ = 0.0f;
    
    std::chrono::steady_clock::time_point stable_since_;
    bool was_stable_ = false;
    float last_trend_weight_ = 0.0f;
    
    boost::signals2::connection status_connection_;
    std::atomic<bool> running_{false};
    
    // 定时轮询
    std::unique_ptr<boost::asio::steady_timer> poll_timer_;
    
    // 标定状态
    CalibrationStep calibration_step_ = CalibrationStep::IDLE;
    float reference_weight_grams_ = 0.0f;
};

} // namespace hal
