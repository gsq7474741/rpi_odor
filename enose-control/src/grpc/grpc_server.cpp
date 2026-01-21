#include "grpc/grpc_server.hpp"
#include "grpc/control_service_impl.hpp"
#include "grpc/sensor_service_impl.hpp"
#include "grpc/load_cell_service_impl.hpp"
#include "hal/load_cell_driver.hpp"
#include <spdlog/spdlog.h>

namespace enose_grpc {

GrpcServer::GrpcServer(
    std::shared_ptr<hal::ActuatorDriver> actuator,
    std::shared_ptr<workflows::SystemState> system_state,
    std::shared_ptr<hal::SensorDriver> sensor,
    std::shared_ptr<hal::LoadCellDriver> load_cell
) : actuator_(std::move(actuator))
  , system_state_(std::move(system_state))
  , sensor_(std::move(sensor))
  , load_cell_(std::move(load_cell)) {}

GrpcServer::~GrpcServer() {
    stop();
}

void GrpcServer::start(const std::string& address) {
    if (running_) {
        spdlog::warn("GrpcServer: Already running");
        return;
    }

    server_thread_ = std::thread([this, address]() {
        // 创建服务实现
        ControlServiceImpl control_service(actuator_, system_state_);
        std::unique_ptr<SensorServiceImpl> sensor_service;
        std::unique_ptr<LoadCellServiceImpl> load_cell_service;
        
        if (sensor_) {
            sensor_service = std::make_unique<SensorServiceImpl>(sensor_);
        }
        if (load_cell_) {
            load_cell_service = std::make_unique<LoadCellServiceImpl>(load_cell_);
        }
        
        // 构建服务器
        ::grpc::ServerBuilder builder;
        builder.AddListeningPort(address, ::grpc::InsecureServerCredentials());
        builder.RegisterService(&control_service);
        if (sensor_service) {
            builder.RegisterService(sensor_service.get());
        }
        if (load_cell_service) {
            builder.RegisterService(load_cell_service.get());
        }
        
        server_ = builder.BuildAndStart();
        
        if (server_) {
            spdlog::info("GrpcServer: Listening on {}", address);
            running_ = true;
            server_->Wait();
        } else {
            spdlog::error("GrpcServer: Failed to start on {}", address);
        }
        
        running_ = false;
    });
}

void GrpcServer::stop() {
    if (server_) {
        spdlog::info("GrpcServer: Shutting down...");
        server_->Shutdown();
    }
    
    if (server_thread_.joinable()) {
        server_thread_.join();
    }
    
    running_ = false;
}

} // namespace enose_grpc
