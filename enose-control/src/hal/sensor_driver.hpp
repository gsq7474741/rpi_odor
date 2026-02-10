#pragma once

#include <boost/asio.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/signals2.hpp>
#include <nlohmann/json.hpp>
#include <string>
#include <atomic>
#include <memory>
#include <deque>
#include <mutex>

namespace hal {

class SensorDriver {
public:
    SensorDriver(boost::asio::io_context& io);
    ~SensorDriver();

    /**
     * @brief Start the serial communication
     * @param device Device path (e.g., /dev/enose-sensor)
     * @param baud_rate Baud rate (e.g., 115200)
     */
    void start(const std::string& device, unsigned int baud_rate);

    /**
     * @brief Stop communication (disables auto-reconnect)
     */
    void stop();

    /**
     * @brief Send a JSON command to the sensor board
     */
    void write(const nlohmann::json& cmd);

    /**
     * @brief Check if the serial port is currently connected and readable
     */
    bool is_connected() const { return connected_; }

    /**
     * @brief Signal emitted when a valid JSON packet is received
     */
    boost::signals2::signal<void(const nlohmann::json&)> on_packet;

    /**
     * @brief Signal emitted when the serial connection is lost
     */
    boost::signals2::signal<void()> on_disconnected;

    /**
     * @brief Signal emitted when the serial connection is re-established
     * The firmware (ESP32) will have reset, so init/config/start must be re-sent.
     */
    boost::signals2::signal<void()> on_reconnected;

    static constexpr int MAX_RECONNECT_ATTEMPTS = 60;    // 最多重试 60 次
    static constexpr int RECONNECT_INTERVAL_MS  = 2000;  // 每次间隔 2 秒

private:
    void do_read();
    void process_buffer();
    void do_write();
    void handle_disconnect();
    void schedule_reconnect();
    bool try_open_serial();

    boost::asio::io_context& io_;
    boost::asio::serial_port serial_;
    boost::asio::streambuf read_buffer_;
    std::string line_buffer_;
    
    std::deque<std::string> write_queue_;
    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};

    // 重连相关
    std::string device_;
    unsigned int baud_rate_ = 0;
    std::unique_ptr<boost::asio::steady_timer> reconnect_timer_;
    int reconnect_count_ = 0;
    std::mutex write_mutex_;
};

} // namespace hal
