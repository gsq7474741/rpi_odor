#include <boost/asio.hpp>
#include <boost/asio/signal_set.hpp>
#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <iostream>
#include <thread>
#include "hal/sensor_driver.hpp"
#include "hal/actuator_driver.hpp"
#include "hal/load_cell_driver.hpp"
#include "workflows/system_state.hpp"
#include "grpc/grpc_server.hpp"

// Global io_context to allow signal handling
boost::asio::io_context io_context;

int main(int argc, char* argv[]) {
    try {
        // Initialize logger
        auto console = spdlog::stdout_color_mt("console");
        spdlog::set_default_logger(console);
        spdlog::set_level(spdlog::level::debug);
        spdlog::info("Starting Enose Control Service...");

        // Configuration (Hardcoded for now, should load from config)
        std::string sensor_port = "/dev/ttyUSB0"; 
        unsigned int sensor_baud = 115200;
        std::string moonraker_host = "127.0.0.1";
        std::string moonraker_port = "7125";
        std::string grpc_address = "0.0.0.0:50051";

        // Parse command line arguments
        if (argc > 1) sensor_port = argv[1];
        if (argc > 2) moonraker_host = argv[2];
        if (argc > 3) grpc_address = argv[3];

        // Drivers
        auto sensor_driver = std::make_shared<hal::SensorDriver>(io_context);
        auto actuator_driver = std::make_shared<hal::ActuatorDriver>(io_context);
        
        // Load Cell Driver (称重传感器)
        auto load_cell_driver = std::make_shared<hal::LoadCellDriver>(io_context, actuator_driver);

        // System State Machine
        auto system_state = std::make_shared<workflows::SystemState>(actuator_driver);

        // gRPC Server (包含传感器服务和称重服务)
        enose_grpc::GrpcServer grpc_srv(actuator_driver, system_state, sensor_driver, load_cell_driver);
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
            io_context.stop();
        });

        // Run loop
        spdlog::info("Service running. gRPC on {}, Press Ctrl+C to exit.", grpc_address);
        io_context.run();

    } catch (const std::exception& e) {
        spdlog::error("Unhandled exception: {}", e.what());
        return 1;
    }

    return 0;
}
