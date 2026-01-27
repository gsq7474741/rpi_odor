#pragma once

#include <memory>
#include <mutex>
#include <thread>
#include <atomic>
#include <queue>
#include <condition_variable>
#include <grpcpp/grpcpp.h>
#include "enose_experiment.grpc.pb.h"
#include "../workflows/experiment_validator.hpp"
#include "../workflows/system_state.hpp"
#include "../hal/load_cell_driver.hpp"
#include "../hal/sensor_driver.hpp"
#include "../db/consumable_repository.hpp"

namespace grpc_service {

/**
 * 实验服务实现
 * 
 * 提供实验程序的验证、加载、执行功能
 */
class ExperimentServiceImpl final : public ::enose::experiment::ExperimentService::Service {
public:
    ExperimentServiceImpl(
        std::shared_ptr<workflows::SystemState> system_state,
        std::shared_ptr<hal::LoadCellDriver> load_cell,
        std::shared_ptr<hal::SensorDriver> sensor_driver = nullptr,
        std::shared_ptr<db::ConsumableRepository> consumable_repo = nullptr);
    
    ~ExperimentServiceImpl();
    
    // gRPC 方法实现
    ::grpc::Status ValidateProgram(
        ::grpc::ServerContext* context,
        const ::enose::experiment::ValidateProgramRequest* request,
        ::enose::experiment::ValidationResult* response) override;
    
    ::grpc::Status LoadProgram(
        ::grpc::ServerContext* context,
        const ::enose::experiment::LoadProgramRequest* request,
        ::enose::experiment::LoadProgramResponse* response) override;
    
    ::grpc::Status StartExperiment(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::experiment::ExperimentStatusResponse* response) override;
    
    ::grpc::Status StopExperiment(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::experiment::ExperimentStatusResponse* response) override;
    
    ::grpc::Status PauseExperiment(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::experiment::ExperimentStatusResponse* response) override;
    
    ::grpc::Status ResumeExperiment(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::experiment::ExperimentStatusResponse* response) override;
    
    ::grpc::Status GetExperimentStatus(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::experiment::ExperimentStatusResponse* response) override;
    
    ::grpc::Status SubscribeExperimentEvents(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::grpc::ServerWriter<::enose::experiment::ExperimentEvent>* writer) override;

private:
    // 依赖
    std::shared_ptr<workflows::SystemState> system_state_;
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
    std::shared_ptr<hal::SensorDriver> sensor_driver_;
    std::shared_ptr<db::ConsumableRepository> consumable_repo_;
    enose::workflows::ExperimentValidator validator_;
    
    // 状态
    std::mutex mutex_;
    ::enose::experiment::ExperimentState state_ = ::enose::experiment::EXP_IDLE;
    std::unique_ptr<::enose::experiment::ExperimentProgram> loaded_program_;
    enose::workflows::ValidationResultInfo validation_result_;
    
    // 执行线程
    std::unique_ptr<std::thread> execution_thread_;
    std::atomic<bool> stop_requested_{false};
    std::atomic<bool> pause_requested_{false};
    std::condition_variable pause_cv_;
    std::mutex pause_mutex_;
    
    // 执行状态
    int current_step_index_ = 0;
    std::string current_step_name_;
    int loop_iteration_ = 0;
    int loop_total_ = 0;
    std::chrono::steady_clock::time_point start_time_;
    std::vector<std::string> logs_;
    std::string error_message_;
    
    // 事件队列 (用于订阅者)
    std::mutex event_mutex_;
    std::condition_variable event_cv_;
    std::queue<::enose::experiment::ExperimentEvent> event_queue_;
    std::atomic<int> subscriber_count_{0};
    
    // 执行方法
    void execution_thread_func();
    void execute_steps(const ::google::protobuf::RepeatedPtrField<::enose::experiment::Step>& steps);
    void execute_step(const ::enose::experiment::Step& step);
    
    // 动作执行
    void execute_inject(const ::enose::experiment::InjectAction& action);
    void execute_wait(const ::enose::experiment::WaitAction& action);
    void execute_drain(const ::enose::experiment::DrainAction& action);
    void execute_acquire(const ::enose::experiment::AcquireAction& action);
    void execute_set_state(const ::enose::experiment::SetStateAction& action);
    void execute_set_gas_pump(const ::enose::experiment::SetGasPumpAction& action);
    void execute_loop(const ::enose::experiment::LoopAction& action);
    void execute_phase_marker(const ::enose::experiment::PhaseMarkerAction& action);
    void execute_wash(const ::enose::experiment::WashAction& action);
    
    // 等待辅助方法
    bool wait_for_heater_cycles(int count, double timeout_s);
    bool wait_for_sensor_stability(double window_s, double threshold_percent, double timeout_s);
    
    // 辅助方法
    void add_log(const std::string& message);
    void emit_event(::enose::experiment::ExperimentEvent::EventType type, 
                   const std::string& message = "",
                   const std::map<std::string, std::string>& data = {});
    void fill_status_response(::enose::experiment::ExperimentStatusResponse* response);
    bool check_stop_or_pause();
    void wait_if_paused();
    
    // 转换系统状态
    workflows::SystemState::State convert_state(::enose::experiment::SystemState state);
    
    // 气泵运行时间跟踪
    std::chrono::steady_clock::time_point gas_pump_start_time_;
    bool gas_pump_running_{false};
};

} // namespace grpc_service
