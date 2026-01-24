#pragma once

#include "enose_experiment.pb.h"
#include <string>
#include <vector>
#include <map>
#include <optional>

namespace enose::workflows {

// 验证错误
struct ValidationErrorInfo {
    std::string path;       // 错误位置, e.g., "steps[2].inject"
    std::string code;       // 错误代码, e.g., "OVERFLOW_RISK"
    std::string message;    // 可读消息
    enum class Severity { ERROR, WARNING, INFO } severity;
};

// 液体消耗信息
struct LiquidConsumptionInfo {
    std::string liquid_id;
    std::string liquid_name;
    int32_t pump_index;
    double required_ml;
    double available_ml;
    bool sufficient;
};

// 资源预估
struct ResourceEstimateInfo {
    std::map<int32_t, double> pump_consumption_ml;  // 每个泵的消耗量
    double peak_liquid_level_ml;                     // 峰值液位
    double estimated_duration_s;                     // 预计时长
    int32_t heater_cycles;                          // 加热器循环数
    std::vector<LiquidConsumptionInfo> liquid_consumption;
};

// 验证结果
struct ValidationResultInfo {
    bool valid;
    std::vector<ValidationErrorInfo> errors;
    std::vector<ValidationErrorInfo> warnings;
    ResourceEstimateInfo estimate;
};

/**
 * 实验程序验证器
 * 
 * 执行多层验证:
 * - L1: Proto schema 验证 (由 protobuf 自动处理)
 * - L2: protovalidate 约束 (由 buf validate 处理)
 * - L3: 语义验证 (本类实现)
 *   - 引用完整性检查
 *   - 资源消耗计算
 *   - 物理约束检查
 *   - 安全约束检查
 */
class ExperimentValidator {
public:
    ExperimentValidator() = default;
    
    /**
     * 验证实验程序
     * @param program 实验程序
     * @return 验证结果
     */
    ValidationResultInfo validate(const experiment::ExperimentProgram& program);
    
    /**
     * 将验证结果转换为 proto 消息
     */
    static experiment::ValidationResult to_proto(const ValidationResultInfo& result);

private:
    // 当前验证上下文
    const experiment::ExperimentProgram* program_ = nullptr;
    std::vector<ValidationErrorInfo> errors_;
    std::vector<ValidationErrorInfo> warnings_;
    
    // 液体ID到库存的映射
    std::map<std::string, const experiment::LiquidInventory*> liquid_map_;
    
    // 资源追踪
    std::map<int32_t, double> pump_totals_;  // 每个泵的累计消耗
    double current_liquid_level_ = 0;         // 当前液位
    double peak_liquid_level_ = 0;            // 峰值液位
    double total_duration_ = 0;               // 累计时长
    int32_t total_heater_cycles_ = 0;         // 累计加热器循环
    
    // 验证步骤
    void reset();
    void build_liquid_map();
    void validate_hardware_constraints();
    void validate_steps(const google::protobuf::RepeatedPtrField<experiment::Step>& steps,
                       const std::string& path_prefix);
    void validate_step(const experiment::Step& step, const std::string& path);
    
    // 动作验证
    void validate_inject_action(const experiment::InjectAction& action, const std::string& path);
    void validate_wait_action(const experiment::WaitAction& action, const std::string& path);
    void validate_drain_action(const experiment::DrainAction& action, const std::string& path);
    void validate_acquire_action(const experiment::AcquireAction& action, const std::string& path);
    void validate_loop_action(const experiment::LoopAction& action, const std::string& path);
    
    // 资源计算
    void calculate_inject_resources(const experiment::InjectAction& action);
    void calculate_drain_resources(const experiment::DrainAction& action);
    void calculate_wait_resources(const experiment::WaitAction& action);
    void calculate_acquire_resources(const experiment::AcquireAction& action);
    
    // 安全检查
    void check_overflow_risk();
    void check_empty_aspiration_risk();
    void check_liquid_sufficiency();
    
    // 辅助函数
    void add_error(const std::string& path, const std::string& code, const std::string& message);
    void add_warning(const std::string& path, const std::string& code, const std::string& message);
    double get_inject_volume(const experiment::InjectAction& action);
    const experiment::LiquidInventory* find_liquid(const std::string& liquid_id);
};

} // namespace enose::workflows
