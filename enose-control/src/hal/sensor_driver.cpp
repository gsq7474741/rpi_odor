#include "hal/sensor_driver.hpp"
#include <spdlog/spdlog.h>
#include <iostream>

namespace hal {

SensorDriver::SensorDriver(boost::asio::io_context& io)
    : io_(io), serial_(io) {}

SensorDriver::~SensorDriver() {
    stop();
}

bool SensorDriver::try_open_serial() {
    try {
        if (serial_.is_open()) {
            boost::system::error_code ec;
            serial_.close(ec);  // ignore close error
        }
        
        // 清空读缓冲区
        read_buffer_.consume(read_buffer_.size());
        
        serial_.open(device_);
        serial_.set_option(boost::asio::serial_port_base::baud_rate(baud_rate_));
        serial_.set_option(boost::asio::serial_port_base::character_size(8));
        serial_.set_option(boost::asio::serial_port_base::parity(boost::asio::serial_port_base::parity::none));
        serial_.set_option(boost::asio::serial_port_base::stop_bits(boost::asio::serial_port_base::stop_bits::one));
        serial_.set_option(boost::asio::serial_port_base::flow_control(boost::asio::serial_port_base::flow_control::none));
        return true;
    } catch (const std::exception& e) {
        spdlog::debug("SensorDriver: try_open_serial failed: {}", e.what());
        return false;
    }
}

void SensorDriver::start(const std::string& device, unsigned int baud_rate) {
    device_ = device;
    baud_rate_ = baud_rate;
    reconnect_count_ = 0;
    
    if (!try_open_serial()) {
        spdlog::error("SensorDriver: Failed to open {} @ {}", device, baud_rate);
        throw std::runtime_error("Failed to open serial port: " + device);
    }
    
    running_ = true;
    connected_ = true;
    spdlog::info("SensorDriver: Opened {} @ {}", device, baud_rate);
    
    do_read();
}

void SensorDriver::stop() {
    running_ = false;
    connected_ = false;
    
    // 取消重连定时器
    if (reconnect_timer_) {
        reconnect_timer_->cancel();
        reconnect_timer_.reset();
    }
    
    if (serial_.is_open()) {
        boost::system::error_code ec;
        serial_.close(ec);
        spdlog::info("SensorDriver: Closed");
    }
}

void SensorDriver::write(const nlohmann::json& cmd) {
    if (!running_) return;

    // 记录发送的命令
    std::string cmd_name = cmd.value("cmd", "unknown");
    int cmd_id = cmd.value("id", -1);
    
    if (!connected_) {
        spdlog::warn("SensorDriver: 串口断开中，丢弃命令 cmd={} id={}", cmd_name, cmd_id);
        return;
    }
    
    spdlog::info("SensorDriver: send: cmd={} id={}", cmd_name, cmd_id);

    std::string data = cmd.dump() + "\n";
    
    boost::asio::post(io_, [this, data]() {
        std::lock_guard<std::mutex> lock(write_mutex_);
        bool write_in_progress = !write_queue_.empty();
        write_queue_.push_back(data);
        if (!write_in_progress) {
            do_write();
        }
    });
}

void SensorDriver::do_write() {
    if (!running_ || !connected_) return;

    boost::asio::async_write(serial_,
        boost::asio::buffer(write_queue_.front()),
        [this](boost::system::error_code ec, std::size_t /*length*/) {
            if (!ec) {
                std::lock_guard<std::mutex> lock(write_mutex_);
                write_queue_.pop_front();
                if (!write_queue_.empty()) {
                    do_write();
                }
            } else if (ec != boost::asio::error::operation_aborted) {
                spdlog::error("SensorDriver: Write error: {}", ec.message());
                handle_disconnect();
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
                        
                        // 只记录响应（非 data 类型的包），data 类型太多不记录
                        std::string msg_type = j.value("type", "");
                        if (msg_type != "data") {
                            std::string cmd_name = j.value("cmd", "");
                            int cmd_id = j.value("id", -1);
                            bool success = j.value("success", true);
                            if (!cmd_name.empty()) {
                                spdlog::info("SensorDriver: recv: cmd={} id={} success={}", 
                                            cmd_name, cmd_id, success);
                            } else if (!msg_type.empty()) {
                                spdlog::info("SensorDriver: recv: type={}", msg_type);
                            }
                        }
                        
                        on_packet(j);
                    } catch (const std::exception& e) {
                        spdlog::warn("SensorDriver: JSON parse error: '{}' -> {}", line, e.what());
                    }
                }
                
                do_read();
            } else if (ec != boost::asio::error::operation_aborted) {
                spdlog::error("SensorDriver: Read error: {}", ec.message());
                handle_disconnect();
            }
        });
}

void SensorDriver::handle_disconnect() {
    if (!connected_) return;  // 已经在处理断连
    
    connected_ = false;
    reconnect_count_ = 0;
    
    // 关闭串口
    if (serial_.is_open()) {
        boost::system::error_code ec;
        serial_.close(ec);
    }
    
    // 清空写队列
    {
        std::lock_guard<std::mutex> lock(write_mutex_);
        write_queue_.clear();
    }
    
    spdlog::warn("SensorDriver: 串口断开，将尝试自动重连 (设备: {})", device_);
    
    // 通知订阅者
    on_disconnected();
    
    // 启动重连
    if (running_) {
        schedule_reconnect();
    }
}

void SensorDriver::schedule_reconnect() {
    if (!running_ || connected_) return;
    
    if (reconnect_count_ >= MAX_RECONNECT_ATTEMPTS) {
        spdlog::error("SensorDriver: 重连失败，已达最大重试次数 ({})", MAX_RECONNECT_ATTEMPTS);
        return;
    }
    
    reconnect_timer_ = std::make_unique<boost::asio::steady_timer>(io_);
    reconnect_timer_->expires_after(std::chrono::milliseconds(RECONNECT_INTERVAL_MS));
    reconnect_timer_->async_wait([this](boost::system::error_code ec) {
        if (ec || !running_ || connected_) return;
        
        reconnect_count_++;
        spdlog::info("SensorDriver: 重连尝试 {}/{} (设备: {})", 
                    reconnect_count_, MAX_RECONNECT_ATTEMPTS, device_);
        
        if (try_open_serial()) {
            connected_ = true;
            reconnect_count_ = 0;
            spdlog::info("SensorDriver: 重连成功！(设备: {})", device_);
            
            // 重新启动读取循环
            do_read();
            
            // 通知订阅者：连接已恢复，需要重新初始化固件
            on_reconnected();
        } else {
            // 继续尝试
            schedule_reconnect();
        }
    });
}

} // namespace hal
