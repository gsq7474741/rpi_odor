#include "grpc/grpc_server.hpp"
#include "grpc/control_service_impl.hpp"
#include "grpc/sensor_service_impl.hpp"
#include "grpc/load_cell_service_impl.hpp"
#include "grpc/test_service_impl.hpp"
#include "grpc/experiment_service_impl.hpp"
#include "grpc/consumable_service_impl.hpp"
#include "hal/load_cell_driver.hpp"
#include "db/consumable_repository.hpp"
#include "db/experiment_repository.hpp"
#include "db/sample_repository.hpp"
#include "db/phase_transition_repository.hpp"
#include <spdlog/spdlog.h>

namespace enose_grpc {

GrpcServer::GrpcServer(
    std::shared_ptr<hal::ActuatorDriver> actuator,
    std::shared_ptr<workflows::SystemState> system_state,
    std::shared_ptr<hal::SensorDriver> sensor,
    std::shared_ptr<hal::LoadCellDriver> load_cell,
    std::shared_ptr<db::TestRunRepository> repository,
    std::shared_ptr<db::ConsumableRepository> consumable_repo
) : actuator_(std::move(actuator))
  , system_state_(std::move(system_state))
  , sensor_(std::move(sensor))
  , load_cell_(std::move(load_cell))
  , repository_(std::move(repository))
  , consumable_repo_(std::move(consumable_repo)) {}

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
        ControlServiceImpl control_service(actuator_, system_state_, load_cell_);
        std::unique_ptr<SensorServiceImpl> sensor_service;
        std::unique_ptr<LoadCellServiceImpl> load_cell_service;
        std::unique_ptr<grpc_service::TestServiceImpl> test_service;
        std::unique_ptr<grpc_service::ExperimentServiceImpl> experiment_service;
        std::unique_ptr<grpc_service::ConsumableServiceImpl> consumable_service;
        
        if (sensor_) {
            sensor_service = std::make_unique<SensorServiceImpl>(sensor_);
        }
        if (load_cell_) {
            load_cell_service = std::make_unique<LoadCellServiceImpl>(load_cell_);
            // TestService 需要 system_state, load_cell 和 repository
            test_service = std::make_unique<grpc_service::TestServiceImpl>(system_state_, load_cell_, repository_);
            // ExperimentService 需要 system_state, load_cell, sensor 和 consumable_repo
            experiment_service = std::make_unique<grpc_service::ExperimentServiceImpl>(system_state_, load_cell_, sensor_, consumable_repo_);
        }
        
        // ConsumableService 不需要外部依赖
        consumable_service = std::make_unique<grpc_service::ConsumableServiceImpl>();
        
        // 创建并关联服务之间共享的仓库
        if (experiment_service) {
            // 创建实验相关的仓库
            auto experiment_repo = std::make_shared<db::ExperimentRepository>();
            auto sample_repo = std::make_shared<db::SampleRepository>();
            auto phase_transition_repo = std::make_shared<db::PhaseTransitionRepository>();
            
            experiment_service->set_experiment_repository(experiment_repo);
            experiment_service->set_sample_repository(sample_repo);
            experiment_service->set_phase_transition_repository(phase_transition_repo);
            spdlog::info("GrpcServer: Initialized ExperimentRepository, SampleRepository, PhaseTransitionRepository");
            
            // 共享 SensorRepository，使 ExperimentService 设置的 run_id 能关联到传感器数据
            if (sensor_service) {
                auto sensor_repo = sensor_service->sensor_repository();
                if (sensor_repo) {
                    experiment_service->set_sensor_repository(
                        std::shared_ptr<db::SensorRepository>(sensor_repo, [](db::SensorRepository*){}));
                    spdlog::info("GrpcServer: Shared SensorRepository between ExperimentService and SensorService");
                }
                // 关联 SensorService 引用，用于注入质量监控器
                experiment_service->set_sensor_service(sensor_service.get());
            }
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
        if (test_service) {
            builder.RegisterService(test_service.get());
        }
        if (experiment_service) {
            builder.RegisterService(experiment_service.get());
        }
        if (consumable_service) {
            builder.RegisterService(consumable_service.get());
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
        spdlog::info("GrpcServer: Shutting down (5s deadline for in-flight RPCs)...");
        // 带 deadline 的 Shutdown：给活跃的流式 RPC 5 秒时间完成，
        // 超时后强制取消所有 context（使 IsCancelled() 返回 true）
        auto deadline = std::chrono::system_clock::now() + std::chrono::seconds(5);
        server_->Shutdown(deadline);
        spdlog::info("GrpcServer: gRPC server shutdown complete");
    }
    
    if (server_thread_.joinable()) {
        server_thread_.join();
    }
    
    running_ = false;
}

} // namespace enose_grpc
