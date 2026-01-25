#include "hal/actuator_driver.hpp"
#include <spdlog/spdlog.h>
#include <iostream>
#include <format>
#include <cmath>

namespace hal {

ActuatorDriver::ActuatorDriver(net::io_context& io)
    : io_(io), ws_(io), resolver_(io), printer_info_timer_(io) {}

ActuatorDriver::~ActuatorDriver() {
    if (connected_) {
        // Best effort close
        // ws_.close(websocket::close_code::normal);
    }
}

void ActuatorDriver::connect(const std::string& host, const std::string& port) {
    host_ = host;
    spdlog::info("ActuatorDriver: Connecting to {}:{}", host, port);
    resolver_.async_resolve(host, port,
        beast::bind_front_handler(&ActuatorDriver::on_resolve, shared_from_this()));
}

void ActuatorDriver::on_resolve(beast::error_code ec, tcp::resolver::results_type results) {
    if (ec) {
        spdlog::error("ActuatorDriver: Resolve failed: {}", ec.message());
        return;
    }

    beast::get_lowest_layer(ws_).expires_after(std::chrono::seconds(30));
    beast::get_lowest_layer(ws_).async_connect(results,
        beast::bind_front_handler(&ActuatorDriver::on_connect, shared_from_this()));
}

void ActuatorDriver::on_connect(beast::error_code ec, tcp::resolver::results_type::endpoint_type ep) {
    if (ec) {
        spdlog::error("ActuatorDriver: Connect failed: {}", ec.message());
        return;
    }

    beast::get_lowest_layer(ws_).expires_never();
    
    // Set suggested timeout settings for the websocket
    ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::client));

    // Set a decorator to change the User-Agent of the handshake
    ws_.set_option(websocket::stream_base::decorator(
        [](websocket::request_type& req)
        {
            req.set(http::field::user_agent,
                std::string(BOOST_BEAST_VERSION_STRING) +
                " websocket-client-coro");
        }));

    ws_.async_handshake(host_, "/websocket",
        beast::bind_front_handler(&ActuatorDriver::on_handshake, shared_from_this()));
}

void ActuatorDriver::on_handshake(beast::error_code ec) {
    if (ec) {
        spdlog::error("ActuatorDriver: Handshake failed: {}", ec.message());
        return;
    }

    spdlog::info("ActuatorDriver: Connected!");
    connected_ = true;

    // Start reading
    do_read();

    // Subscribe to objects
    subscribe_objects();
    
    // 开始定时查询 printer.info
    query_printer_info();
    
    // 启动呼吸灯 (急停指示灯)
    start_breathing_led();
}

void ActuatorDriver::do_read() {
    ws_.async_read(buffer_,
        beast::bind_front_handler(&ActuatorDriver::on_read, shared_from_this()));
}

void ActuatorDriver::on_read(beast::error_code ec, std::size_t bytes_transferred) {
    if (ec) {
        spdlog::error("ActuatorDriver: Read failed: {}", ec.message());
        connected_ = false;
        return;
    }

    // Parse JSON
    std::string data = beast::buffers_to_string(buffer_.data());
    buffer_.consume(buffer_.size()); // Clear buffer

    try {
        auto j = nlohmann::json::parse(data);
        
        // Check if it's a notification
        if (j.contains("method") && j["method"] == "notify_status_update") {
            if (j.contains("params") && j["params"].is_array() && !j["params"].empty()) {
                on_status_update(j["params"][0]);
            }
        }
        // 检测 Klipper shutdown 状态
        else if (j.contains("method") && j["method"] == "notify_klippy_shutdown") {
            spdlog::warn("ActuatorDriver: Klipper shutdown detected!");
            firmware_ready_ = false;
        }
        else if (j.contains("method") && j["method"] == "notify_klippy_ready") {
            spdlog::info("ActuatorDriver: Klipper ready!");
            firmware_ready_ = true;
        }
        // 处理 printer.info 响应
        else if (j.contains("id") && j["id"].get<int>() == printer_info_rpc_id_ && j.contains("result")) {
            auto& result = j["result"];
            if (result.contains("state")) {
                std::string state = result["state"].get<std::string>();
                bool was_ready = firmware_ready_;
                firmware_ready_ = (state == "ready");
                if (was_ready != firmware_ready_) {
                    spdlog::info("ActuatorDriver: Klipper state changed to '{}', firmware_ready={}", state, firmware_ready_);
                }
            }
            // 安排下一次查询
            schedule_printer_info_query();
        }
        // G-code 命令响应 (包括 query_object 回调)
        else if (j.contains("id") && j.contains("result")) {
            int id = j["id"].get<int>();
            // RPC 响应日志已禁用 (高频轮询会产生大量日志)
            // pdlog::debug("ActuatorDriver: RPC[{}] response: {}", id, j["result"].dump());
            
            // 检查是否有注册的回调
            auto it = rpc_callbacks_.find(id);
            if (it != rpc_callbacks_.end()) {
                it->second(j);
                rpc_callbacks_.erase(it);
            }
        }
        // G-code 命令错误
        else if (j.contains("id") && j.contains("error")) {
            int id = j["id"].get<int>();
            spdlog::error("ActuatorDriver: RPC[{}] error: {}", id, j["error"].dump());
            
            // 移除失败的回调
            rpc_callbacks_.erase(id);
        }

    } catch (const std::exception& e) {
        spdlog::warn("ActuatorDriver: JSON parse error: {}", e.what());
    }

    do_read();
}

void ActuatorDriver::send_gcode(const std::string& gcode, bool silent) {
    if (!connected_) return;

    // 使用 post 确保在 io_context 线程中执行，实现线程安全和非阻塞
    net::post(io_, [this, self = shared_from_this(), gcode, silent]() {
        nlohmann::json req;
        req["jsonrpc"] = "2.0";
        req["method"] = "printer.gcode.script";
        req["params"] = {{"script", gcode}};
        int id = rpc_id_++;
        req["id"] = id;
        
        if (!silent) {
            spdlog::info("ActuatorDriver: RPC[{}] send: {}", id, gcode);
        }

        std::string msg = req.dump();
        
        send_queue_.push(msg);
        if (send_queue_.size() == 1) {
            do_write();
        }
    });
}

void ActuatorDriver::subscribe_objects() {
    // Subscribe to heater_bed (simulated weight sensor sometimes attached here or sensors), 
    // and potentially other objects
    nlohmann::json req;
    req["jsonrpc"] = "2.0";
    req["method"] = "printer.objects.subscribe";
    
    // Subscribe to everything relevant
    nlohmann::json objects;
    objects["heaters"] = nullptr;
    objects["display_status"] = nullptr;
    objects["load_cell my_hx711"] = nullptr;  // 称重传感器 
    
    req["params"] = {{"objects", objects}};
    req["id"] = rpc_id_++;

    std::string msg = req.dump();
    send_queue_.push(msg);
    if (send_queue_.size() == 1) {
        do_write();
    }
}

void ActuatorDriver::do_write() {
    if (send_queue_.empty()) return;

    ws_.async_write(net::buffer(send_queue_.front()),
        [this, self = shared_from_this()](beast::error_code ec, std::size_t /*bytes*/) {
            if (ec) {
                spdlog::error("ActuatorDriver: Write failed: {}", ec.message());
                return;
            }
            
            send_queue_.pop();
            if (!send_queue_.empty()) {
                do_write();
            }
        });
}

void ActuatorDriver::query_object(const std::string& object_name, 
                                   std::function<void(const nlohmann::json&)> callback) {
    if (!connected_) {
        spdlog::warn("ActuatorDriver: Cannot query object, not connected");
        return;
    }
    
    nlohmann::json req;
    req["jsonrpc"] = "2.0";
    req["method"] = "printer.objects.query";
    
    nlohmann::json objects;
    objects[object_name] = nullptr;
    
    req["params"] = {{"objects", objects}};
    int id = rpc_id_++;
    req["id"] = id;
    
    // 注册回调
    rpc_callbacks_[id] = std::move(callback);
    
    std::string msg = req.dump();
    send_queue_.push(msg);
    if (send_queue_.size() == 1) {
        do_write();
    }
}

void ActuatorDriver::query_printer_info() {
    if (!connected_) return;
    
    nlohmann::json req;
    req["jsonrpc"] = "2.0";
    req["method"] = "printer.info";
    printer_info_rpc_id_ = rpc_id_++;
    req["id"] = printer_info_rpc_id_;
    
    std::string msg = req.dump();
    send_queue_.push(msg);
    if (send_queue_.size() == 1) {
        do_write();
    }
}

void ActuatorDriver::schedule_printer_info_query() {
    printer_info_timer_.expires_after(std::chrono::seconds(2));
    printer_info_timer_.async_wait([this, self = shared_from_this()](beast::error_code ec) {
        if (!ec && connected_) {
            query_printer_info();
        }
    });
}

void ActuatorDriver::start_breathing_led() {
    if (breathing_led_running_) return;
    
    breathing_led_running_ = true;
    breathing_led_phase_ = 0.0f;
    breathing_led_timer_ = std::make_unique<net::steady_timer>(io_);
    
    spdlog::info("ActuatorDriver: Starting breathing LED");
    breathing_led_tick();
}

void ActuatorDriver::stop_breathing_led() {
    if (!breathing_led_running_) return;
    
    breathing_led_running_ = false;
    if (breathing_led_timer_) {
        breathing_led_timer_->cancel();
        breathing_led_timer_.reset();
    }
    spdlog::info("ActuatorDriver: Stopped breathing LED");
}

void ActuatorDriver::breathing_led_tick() {
    if (!breathing_led_running_ || !connected_) return;
    
    // 使用正弦波生成呼吸效果 (0.0 ~ 1.0)
    // 周期约 2 秒 (50ms * 40 steps)
    float value = (std::sin(breathing_led_phase_) + 1.0f) / 2.0f;
    
    // 最小亮度 0.1，避免完全熄灭
    value = 0.1f + value * 0.9f;
    
    // 发送 G-code 设置 LED 亮度 (静默模式，不输出日志)
    std::string gcode = std::format("SET_PIN PIN=estop_led VALUE={:.2f}", value);
    send_gcode(gcode, true);
    
    // 更新相位 (每次增加约 0.157 弧度，约 40 步完成一个周期)
    breathing_led_phase_ += 0.157f;
    if (breathing_led_phase_ > 6.283f) {  // 2 * PI
        breathing_led_phase_ -= 6.283f;
    }
    
    // 50ms 后再次触发
    breathing_led_timer_->expires_after(std::chrono::milliseconds(50));
    breathing_led_timer_->async_wait([this, self = shared_from_this()](beast::error_code ec) {
        if (!ec && breathing_led_running_) {
            breathing_led_tick();
        }
    });
}

} // namespace hal
