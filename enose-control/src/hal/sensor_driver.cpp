#include "hal/sensor_driver.hpp"
#include <spdlog/spdlog.h>
#include <iostream>

namespace hal {

SensorDriver::SensorDriver(boost::asio::io_context& io)
    : io_(io), serial_(io) {}

SensorDriver::~SensorDriver() {
    stop();
}

void SensorDriver::start(const std::string& device, unsigned int baud_rate) {
    try {
        serial_.open(device);
        serial_.set_option(boost::asio::serial_port_base::baud_rate(baud_rate));
        serial_.set_option(boost::asio::serial_port_base::character_size(8));
        serial_.set_option(boost::asio::serial_port_base::parity(boost::asio::serial_port_base::parity::none));
        serial_.set_option(boost::asio::serial_port_base::stop_bits(boost::asio::serial_port_base::stop_bits::one));
        serial_.set_option(boost::asio::serial_port_base::flow_control(boost::asio::serial_port_base::flow_control::none));

        running_ = true;
        spdlog::info("SensorDriver: Opened {} @ {}", device, baud_rate);
        
        do_read();
    } catch (const std::exception& e) {
        spdlog::error("SensorDriver: Failed to open {}: {}", device, e.what());
        throw;
    }
}

void SensorDriver::stop() {
    running_ = false;
    if (serial_.is_open()) {
        serial_.close();
        spdlog::info("SensorDriver: Closed");
    }
}

void SensorDriver::write(const nlohmann::json& cmd) {
    if (!running_) return;

    std::string data = cmd.dump() + "\n";
    
    boost::asio::post(io_, [this, data]() {
        bool write_in_progress = !write_queue_.empty();
        write_queue_.push_back(data);
        if (!write_in_progress) {
            do_write();
        }
    });
}

void SensorDriver::do_write() {
    if (!running_) return;

    boost::asio::async_write(serial_,
        boost::asio::buffer(write_queue_.front()),
        [this](boost::system::error_code ec, std::size_t /*length*/) {
            if (!ec) {
                write_queue_.pop_front();
                if (!write_queue_.empty()) {
                    do_write();
                }
            } else {
                spdlog::error("SensorDriver: Write error: {}", ec.message());
            }
        });
}

void SensorDriver::do_read() {
    if (!running_) return;

    boost::asio::async_read_until(serial_, read_buffer_, '\n',
        [this](boost::system::error_code ec, std::size_t bytes_transferred) {
            if (!ec) {
                std::istream is(&read_buffer_);
                std::string line;
                std::getline(is, line);
                
                // Trim CR/LF
                while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) {
                    line.pop_back();
                }

                if (!line.empty()) {
                    try {
                        auto j = nlohmann::json::parse(line);
                        on_packet(j);
                    } catch (const std::exception& e) {
                        spdlog::warn("SensorDriver: JSON parse error: '{}' -> {}", line, e.what());
                    }
                }
                
                do_read();
            } else if (ec != boost::asio::error::operation_aborted) {
                spdlog::error("SensorDriver: Read error: {}", ec.message());
                // Simple retry mechanism or close
                // stop(); 
            }
        });
}

} // namespace hal
