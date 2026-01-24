#pragma once

#include <grpcpp/grpcpp.h>
#include <memory>
#include <string>
#include <thread>

namespace hal {
class ActuatorDriver;
class SensorDriver;
class LoadCellDriver;
}

namespace workflows {
class SystemState;
}

namespace db {
class TestRunRepository;
}

namespace enose_grpc {

/**
 * @brief gRPC 服务器管理类
 * 
 * 负责启动和管理 gRPC 服务
 */
class GrpcServer {
public:
    GrpcServer(
        std::shared_ptr<hal::ActuatorDriver> actuator,
        std::shared_ptr<workflows::SystemState> system_state,
        std::shared_ptr<hal::SensorDriver> sensor = nullptr,
        std::shared_ptr<hal::LoadCellDriver> load_cell = nullptr,
        std::shared_ptr<db::TestRunRepository> repository = nullptr
    );
    ~GrpcServer();

    /**
     * @brief 启动 gRPC 服务器
     * @param address 监听地址 (e.g., "0.0.0.0:50051")
     */
    void start(const std::string& address = "0.0.0.0:50051");

    /**
     * @brief 停止 gRPC 服务器
     */
    void stop();

    /**
     * @brief 检查服务器是否正在运行
     */
    bool is_running() const { return running_; }

private:
    std::shared_ptr<hal::ActuatorDriver> actuator_;
    std::shared_ptr<workflows::SystemState> system_state_;
    std::shared_ptr<hal::SensorDriver> sensor_;
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
    std::shared_ptr<db::TestRunRepository> repository_;
    std::unique_ptr<::grpc::Server> server_;
    std::thread server_thread_;
    bool running_{false};
};

} // namespace enose_grpc
