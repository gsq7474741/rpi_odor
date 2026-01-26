#include <boost/asio.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/asio/steady_timer.hpp>
#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <systemd/sd-daemon.h>
#include <iostream>
#include <thread>
#include "core/config.hpp"
#include "hal/sensor_driver.hpp"
#include "hal/actuator_driver.hpp"
#include "hal/load_cell_driver.hpp"
#include "workflows/system_state.hpp"
#include "grpc/grpc_server.hpp"
#include "db/connection_pool.hpp"
#include "db/test_run_repository.hpp"

// Global io_context to allow signal handling
boost::asio::io_context io_context;

// 默认配置文件路径
const std::string DEFAULT_CONFIG_PATH = "/home/user/rpi_odor/enose-control/config/config.json";

int main(int argc, char* argv[]) {
    try {
        // Initialize logger
        auto console = spdlog::stdout_color_mt("console");
        spdlog::set_default_logger(console);
        spdlog::set_level(spdlog::level::debug);
        spdlog::info("Starting Enose Control Service...");

        // 加载配置文件
        std::string config_path = DEFAULT_CONFIG_PATH;
        if (argc > 1) {
            config_path = argv[1];
        }
        
        auto& config = core::Config::instance();
        if (!config.load(config_path)) {
            spdlog::warn("Failed to load config from {}, using defaults", config_path);
        }
        
        // 从配置获取参数
        std::string sensor_port = config.sensor.serial_port;
        unsigned int sensor_baud = config.sensor.baud_rate;
        std::string moonraker_host = config.actuator.moonraker_host;
        std::string moonraker_port = std::to_string(config.actuator.moonraker_port);
        std::string grpc_address = config.grpc.address();
        
        // 设置日志级别
        if (config.logging.level == "debug") {
            spdlog::set_level(spdlog::level::debug);
        } else if (config.logging.level == "info") {
            spdlog::set_level(spdlog::level::info);
        } else if (config.logging.level == "warn") {
            spdlog::set_level(spdlog::level::warn);
        } else if (config.logging.level == "error") {
            spdlog::set_level(spdlog::level::err);
        }
        
        spdlog::info("Config loaded: gRPC={}, sensor={}, actuator={}:{}", 
                     grpc_address, sensor_port, moonraker_host, moonraker_port);

        // 初始化数据库连接池
        std::shared_ptr<db::TestRunRepository> repository;
        if (config.local.timescaledb.enabled) {
            std::string conn_str = config.local.timescaledb.connection_string();
            spdlog::info("Initializing database connection pool: host={}, db={}",
                         config.local.timescaledb.host, config.local.timescaledb.database);
            
            if (db::ConnectionPool::instance().initialize(conn_str, config.local.timescaledb.pool_size)) {
                repository = std::make_shared<db::TestRunRepository>();
                spdlog::info("Database connection pool initialized successfully");
            } else {
                spdlog::warn("Failed to initialize database connection pool, test persistence disabled");
            }
        } else {
            spdlog::info("Database not enabled in config, test persistence disabled");
        }

        // Drivers
        auto sensor_driver = std::make_shared<hal::SensorDriver>(io_context);
        auto actuator_driver = std::make_shared<hal::ActuatorDriver>(io_context);
        
        // Load Cell Driver (称重传感器)
        auto load_cell_driver = std::make_shared<hal::LoadCellDriver>(io_context, actuator_driver);
        
        // 加载 Load Cell 配置 (持久化)
        std::string load_cell_config_path = "/home/user/rpi_odor/enose-control/config/load_cell.json";
        load_cell_driver->load_config_from_file(load_cell_config_path);
        load_cell_driver->set_config_path(load_cell_config_path);

        // System State Machine
        auto system_state = std::make_shared<workflows::SystemState>(actuator_driver);

        // gRPC Server (包含传感器服务和称重服务)
        enose_grpc::GrpcServer grpc_srv(actuator_driver, system_state, sensor_driver, load_cell_driver, repository);
        grpc_srv.start(grpc_address);

        // Sensor Signals (调试用)
        sensor_driver->on_packet.connect([](const nlohmann::json& j) {
            spdlog::debug("Sensor Data: {}", j.dump());
        });

        // Actuator Signals
        actuator_driver->on_status_update.connect([](const nlohmann::json& j) {
            spdlog::debug("Actuator Status: {}", j.dump());
        });

        // Start Drivers
        try {
            sensor_driver->start(sensor_port, sensor_baud);
        } catch (const std::exception& e) {
            spdlog::warn("Could not start sensor driver on {}: {}", sensor_port, e.what());
        }

        actuator_driver->connect(moonraker_host, moonraker_port);
        
        // Start Load Cell Driver
        load_cell_driver->start();

        // Signal Handling (Ctrl+C)
        boost::asio::signal_set signals(io_context, SIGINT, SIGTERM);
        signals.async_wait([&](const boost::system::error_code&, int) {
            spdlog::info("Shutting down...");
            grpc_srv.stop();
            sensor_driver->stop();
            db::ConnectionPool::instance().shutdown();
            io_context.stop();
        });

        // Systemd watchdog timer (WatchdogSec=5, 发送间隔 = WatchdogSec / 2 = 2.5s)
        boost::asio::steady_timer watchdog_timer(io_context);
        std::function<void(const boost::system::error_code&)> watchdog_handler;
        watchdog_handler = [&](const boost::system::error_code& ec) {
            if (!ec) {
                sd_notify(0, "WATCHDOG=1");
                watchdog_timer.expires_after(std::chrono::milliseconds(2500));
                watchdog_timer.async_wait(watchdog_handler);
            }
        };
        watchdog_timer.expires_after(std::chrono::milliseconds(2500));
        watchdog_timer.async_wait(watchdog_handler);
        
        // 通知 systemd 服务已就绪
        sd_notify(0, "READY=1");
        spdlog::info("Systemd notified: READY=1");

        // Run loop
        spdlog::info("Service running. gRPC on {}, Press Ctrl+C to exit.", grpc_address);
        io_context.run();

    } catch (const std::exception& e) {
        spdlog::error("Unhandled exception: {}", e.what());
        return 1;
    }

    return 0;
}
