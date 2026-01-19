#pragma once

#include <boost/asio.hpp>
#include <boost/signals2.hpp>
#include <nlohmann/json.hpp>
#include <string>
#include <atomic>
#include <memory>
#include <deque>

namespace hal {

class SensorDriver {
public:
    SensorDriver(boost::asio::io_context& io);
    ~SensorDriver();

    /**
     * @brief Start the serial communication
     * @param device Device path (e.g., /dev/ttyUSB0)
     * @param baud_rate Baud rate (e.g., 115200)
     */
    void start(const std::string& device, unsigned int baud_rate);

    /**
     * @brief Stop communication
     */
    void stop();

    /**
     * @brief Send a JSON command to the sensor board
     */
    void write(const nlohmann::json& cmd);

    /**
     * @brief Signal emitted when a valid JSON packet is received
     */
    boost::signals2::signal<void(const nlohmann::json&)> on_packet;

private:
    void do_read();
    void process_buffer();
    void do_write();

    boost::asio::io_context& io_;
    boost::asio::serial_port serial_;
    boost::asio::streambuf read_buffer_;
    std::string line_buffer_;
    
    std::deque<std::string> write_queue_;
    std::atomic<bool> running_{false};
};

} // namespace hal
