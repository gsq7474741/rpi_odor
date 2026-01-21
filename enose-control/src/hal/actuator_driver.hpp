#pragma once

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/signals2.hpp>
#include <nlohmann/json.hpp>
#include <memory>
#include <string>
#include <queue>
#include <functional>
#include <unordered_map>

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;

namespace hal {

class ActuatorDriver : public std::enable_shared_from_this<ActuatorDriver> {
public:
    ActuatorDriver(net::io_context& io);
    ~ActuatorDriver();

    /**
     * @brief Connect to Moonraker WebSocket
     * @param host IP address (e.g. "127.0.0.1")
     * @param port Port (e.g. "7125")
     */
    void connect(const std::string& host, const std::string& port);

    /**
     * @brief Send G-code command via JSON-RPC
     */
    void send_gcode(const std::string& gcode);

    /**
     * @brief Subscribe to object model updates
     * @param objects List of objects to subscribe to (e.g., "heater_bed", "toolhead")
     */
    void subscribe_objects();

    /**
     * @brief Query a specific Klipper object
     * @param object_name Object name (e.g., "load_cell my_hx711")
     * @param callback Callback with query response
     */
    void query_object(const std::string& object_name, 
                      std::function<void(const nlohmann::json&)> callback);

    /**
     * @brief Check if Klipper firmware is ready (not in shutdown state)
     */
    bool is_firmware_ready() const { return firmware_ready_; }

    /**
     * @brief Signal for status updates (weight, temperature, etc.)
     */
    boost::signals2::signal<void(const nlohmann::json&)> on_status_update;

private:
    void on_resolve(beast::error_code ec, tcp::resolver::results_type results);
    void on_connect(beast::error_code ec, tcp::resolver::results_type::endpoint_type ep);
    void on_handshake(beast::error_code ec);
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes_transferred);
    void send_next();
    void do_write();
    void query_printer_info();
    void schedule_printer_info_query();

    net::io_context& io_;
    websocket::stream<beast::tcp_stream> ws_;
    tcp::resolver resolver_;
    std::string host_;
    beast::flat_buffer buffer_;
    
    std::queue<std::string> send_queue_;
    net::steady_timer printer_info_timer_;
    int rpc_id_{1};
    int printer_info_rpc_id_{-1};  // 用于识别 printer.info 响应
    bool connected_{false};
    bool firmware_ready_{true};  // Klipper 固件状态 (shutdown 后为 false)
    
    // RPC 回调存储
    std::unordered_map<int, std::function<void(const nlohmann::json&)>> rpc_callbacks_;
};

} // namespace hal
