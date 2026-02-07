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
#include "../workflows/hardware_state_machine.hpp"
#include "../workflows/action_executor.hpp"
#include "../hal/load_cell_driver.hpp"
#include "../hal/sensor_driver.hpp"
#include "../db/consumable_repository.hpp"
#include "../db/sample_repository.hpp"
#include "../db/experiment_repository.hpp"
#include "../db/sensor_repository.hpp"
#include "../db/phase_transition_repository.hpp"
#include "../workflows/data_quality_monitor.hpp"

// 前向声明
namespace enose_grpc { class SensorServiceImpl; }

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
    std::shared_ptr<db::SampleRepository> sample_repo_;
    std::shared_ptr<db::ExperimentRepository> experiment_repo_;
    std::shared_ptr<db::SensorRepository> sensor_repo_;  // 用于设置运行上下文
    std::shared_ptr<db::PhaseTransitionRepository> phase_transition_repo_;  // 记录 sample 内的 phase 转换
    enose_grpc::SensorServiceImpl* sensor_service_{nullptr};  // 弱引用，不拥有
    enose::workflows::ExperimentValidator validator_;
    
    // 状态
    std::mutex mutex_;
    ::enose::experiment::ExperimentState state_ = ::enose::experiment::EXP_IDLE;
    std::unique_ptr<::enose::experiment::ExperimentProgram> loaded_program_;
    std::string loaded_program_yaml_;      // 原始 YAML 内容
    std::string loaded_program_yaml_hash_; // YAML 内容的 SHA256 hash
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
    
    // 当前 run 和样本上下文
    std::optional<int32_t> current_run_id_;
    db::SampleContext current_sample_ctx_;
    int16_t current_phase_order_ = 0;  // 当前 sample 内的 phase 序号
    std::string current_phase_name_;   // 当前活跃的 phase 名称（集中管理）
    
    // Phase 转换缓冲：sample 创建前的 phase 暂存于此，创建后 flush 到 DB
    struct PendingPhaseTransition {
        std::string phase_name;
        int64_t start_time_ms = 0;
        int64_t end_time_ms = 0;   // 0 表示尚未结束
        int16_t phase_order = 0;
    };
    std::vector<PendingPhaseTransition> pending_phases_;
    
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
    void execute_configure_heater(const ::enose::experiment::ConfigureHeaterAction& action);
    void execute_preheat(const ::enose::experiment::PreheatAction& action);
    
public:
    // 设置传感器服务引用（用于设置 sample_id 上下文）
    void set_sensor_service(enose_grpc::SensorServiceImpl* service) { sensor_service_ = service; }
    
    // 设置样本仓库
    void set_sample_repository(std::shared_ptr<db::SampleRepository> repo) { sample_repo_ = repo; }
    
    // 设置实验仓库
    void set_experiment_repository(std::shared_ptr<db::ExperimentRepository> repo) { experiment_repo_ = repo; }
    
    // 设置传感器仓库（用于关联传感器数据与 run_id/phase）
    void set_sensor_repository(std::shared_ptr<db::SensorRepository> repo) { sensor_repo_ = repo; }
    
    // 设置 Phase 转换仓库
    void set_phase_transition_repository(std::shared_ptr<db::PhaseTransitionRepository> repo) { phase_transition_repo_ = repo; }
    
private:
    
    // Phase 转换辅助方法（集中管理）
    void auto_start_phase(const std::string& phase_name);
    void auto_end_phase(const std::string& phase_name);
    void auto_end_current_phase();
    void flush_pending_phases(int32_t sample_id);
    
    // 等待辅助方法
    bool wait_for_heater_cycles(int count, double timeout_s);
    bool wait_for_sensor_stability(double window_s, double threshold_percent, double timeout_s);
    
    // 辅助方法
    void add_log(const std::string& message);
    void emit_event(::enose::experiment::ExperimentEvent::EventType type, 
                   const std::string& message = "",
                   const std::map<std::string, std::string>& data = {});
    void fill_status_response(::enose::experiment::ExperimentStatusResponse* response);
    bool check_stop_or_pause();  // 步骤间调用：检查停止+暂停（暂停时阻塞）
    bool check_stop();           // 步骤内调用：仅检查停止（步骤是原子操作，不被暂停打断）
    void wait_if_paused();
    
    // 转换系统状态
    workflows::SystemState::State convert_state(::enose::experiment::SystemState state);
    
    // 气泵运行时间由 RuntimeTracker 在 SystemState 层自动统计
    
    // Action Executors (Phase 3)
    std::shared_ptr<workflows::HardwareStateMachine> hardware_state_machine_;
    std::unordered_map<std::string, std::shared_ptr<workflows::IActionExecutor>> executors_;
    void init_executors();
    bool try_execute_with_executor(const ::enose::experiment::Step& step);
    
    // 数据质量监控
    workflows::DataQualityMonitor quality_monitor_;
};

} // namespace grpc_service
