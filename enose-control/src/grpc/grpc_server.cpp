#include "grpc/grpc_server.hpp"
#include "grpc/control_service_impl.hpp"
#include <spdlog/spdlog.h>

namespace grpc_server {

GrpcServer::GrpcServer(
    std::shared_ptr<hal::ActuatorDriver> actuator,
    std::shared_ptr<workflows::SystemState> system_state
) : actuator_(std::move(actuator))
  , system_state_(std::move(system_state)) {}

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
        
        // 构建服务器
        ::grpc::ServerBuilder builder;
        builder.AddListeningPort(address, ::grpc::InsecureServerCredentials());
        builder.RegisterService(&control_service);
        
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

} // namespace grpc_server
