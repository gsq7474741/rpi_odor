#include "experiment_validator.hpp"
#include <spdlog/spdlog.h>
#include <algorithm>
#include <cmath>

namespace enose::workflows {

ValidationResultInfo ExperimentValidator::validate(const experiment::ExperimentProgram& program) {
    reset();
    program_ = &program;
    
    spdlog::info("开始验证实验程序: {}", program.id());
    
    // 构建液体映射
    build_liquid_map();
    
    // 验证硬件约束
    validate_hardware_constraints();
    
    // 验证步骤
    validate_steps(program.steps(), "steps");
    
    // 安全检查
    check_overflow_risk();
    check_empty_aspiration_risk();
    check_liquid_sufficiency();
    
    // 构建结果
    ValidationResultInfo result;
    result.valid = errors_.empty();
    result.errors = std::move(errors_);
    result.warnings = std::move(warnings_);
    
    // 资源预估
    result.estimate.pump_consumption_ml = pump_totals_;
    result.estimate.peak_liquid_level_ml = peak_liquid_level_;
    result.estimate.estimated_duration_s = total_duration_;
    result.estimate.heater_cycles = total_heater_cycles_;
    
    // 液体消耗详情
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        LiquidConsumptionInfo info;
        info.liquid_id = liquid_id;
        info.liquid_name = inventory->name();
        info.pump_index = inventory->pump_index();
        info.available_ml = inventory->available_ml();
        
        // 计算该液体的消耗量 (从泵消耗中提取)
        auto it = pump_totals_.find(inventory->pump_index());
        info.required_ml = (it != pump_totals_.end()) ? it->second : 0.0;
        info.sufficient = info.required_ml <= info.available_ml;
        
        result.estimate.liquid_consumption.push_back(info);
    }
    
    spdlog::info("验证完成: valid={}, errors={}, warnings={}", 
                 result.valid, result.errors.size(), result.warnings.size());
    
    return result;
}

experiment::ValidationResult ExperimentValidator::to_proto(const ValidationResultInfo& result) {
    experiment::ValidationResult proto;
    proto.set_valid(result.valid);
    
    // 转换错误
    for (const auto& err : result.errors) {
        auto* e = proto.add_errors();
        e->set_path(err.path);
        e->set_code(err.code);
        e->set_message(err.message);
        e->set_severity(experiment::ValidationError::ERROR);
    }
    
    // 转换警告
    for (const auto& warn : result.warnings) {
        auto* w = proto.add_warnings();
        w->set_path(warn.path);
        w->set_code(warn.code);
        w->set_message(warn.message);
        w->set_severity(experiment::ValidationError::WARNING);
    }
    
    // 转换资源预估
    auto* est = proto.mutable_estimate();
    for (const auto& [pump, consumption] : result.estimate.pump_consumption_ml) {
        (*est->mutable_pump_consumption_ml())[pump] = consumption;
    }
    est->set_peak_liquid_level_ml(result.estimate.peak_liquid_level_ml);
    est->set_estimated_duration_s(result.estimate.estimated_duration_s);
    est->set_heater_cycles(result.estimate.heater_cycles);
    
    // 转换液体消耗
    for (const auto& lc : result.estimate.liquid_consumption) {
        auto* c = est->add_liquid_consumption();
        c->set_liquid_id(lc.liquid_id);
        c->set_liquid_name(lc.liquid_name);
        c->set_pump_index(lc.pump_index);
        c->set_required_ml(lc.required_ml);
        c->set_available_ml(lc.available_ml);
        c->set_sufficient(lc.sufficient);
    }
    
    return proto;
}

void ExperimentValidator::reset() {
    program_ = nullptr;
    errors_.clear();
    warnings_.clear();
    liquid_map_.clear();
    pump_totals_.clear();
    current_liquid_level_ = 0;
    peak_liquid_level_ = 0;
    total_duration_ = 0;
    total_heater_cycles_ = 0;
}

void ExperimentValidator::build_liquid_map() {
    if (!program_->has_hardware()) return;
    
    const auto& hw = program_->hardware();
    for (const auto& liquid : hw.liquids()) {
        if (liquid_map_.count(liquid.id())) {
            add_error("hardware.liquids", "DUPLICATE_LIQUID_ID",
                     "重复的液体ID: " + liquid.id());
        } else {
            liquid_map_[liquid.id()] = &liquid;
        }
    }
}

void ExperimentValidator::validate_hardware_constraints() {
    if (!program_->has_hardware()) {
        add_error("hardware", "MISSING_HARDWARE", "缺少硬件约束定义");
        return;
    }
    
    const auto& hw = program_->hardware();
    
    // 检查是否有清洗液定义
    bool has_rinse = false;
    for (const auto& liquid : hw.liquids()) {
        if (liquid.type() == experiment::LIQUID_RINSE) {
            has_rinse = true;
            break;
        }
    }
    
    if (!has_rinse) {
        add_warning("hardware.liquids", "NO_RINSE_LIQUID", 
                   "未定义清洗液，清洗步骤可能无法执行");
    }
    
    // 检查泵索引唯一性
    std::map<int32_t, std::string> pump_to_liquid;
    for (const auto& liquid : hw.liquids()) {
        auto it = pump_to_liquid.find(liquid.pump_index());
        if (it != pump_to_liquid.end()) {
            add_error("hardware.liquids", "DUPLICATE_PUMP_INDEX",
                     "泵" + std::to_string(liquid.pump_index()) + 
                     "被多个液体使用: " + it->second + ", " + liquid.id());
        } else {
            pump_to_liquid[liquid.pump_index()] = liquid.id();
        }
    }
}

void ExperimentValidator::validate_steps(
    const google::protobuf::RepeatedPtrField<experiment::Step>& steps,
    const std::string& path_prefix) {
    
    for (int i = 0; i < steps.size(); ++i) {
        std::string path = path_prefix + "[" + std::to_string(i) + "]";
        validate_step(steps[i], path);
    }
}

void ExperimentValidator::validate_step(const experiment::Step& step, const std::string& path) {
    // 检查步骤名称
    if (step.name().empty()) {
        add_warning(path + ".name", "EMPTY_STEP_NAME", "步骤名称为空");
    }
    
    // 根据动作类型验证
    switch (step.action_case()) {
        case experiment::Step::kInject:
            validate_inject_action(step.inject(), path + ".inject");
            calculate_inject_resources(step.inject());
            break;
            
        case experiment::Step::kWait:
            validate_wait_action(step.wait(), path + ".wait");
            calculate_wait_resources(step.wait());
            break;
            
        case experiment::Step::kDrain:
            validate_drain_action(step.drain(), path + ".drain");
            calculate_drain_resources(step.drain());
            break;
            
        case experiment::Step::kAcquire:
            validate_acquire_action(step.acquire(), path + ".acquire");
            calculate_acquire_resources(step.acquire());
            break;
            
        case experiment::Step::kSetState:
            // SetState 动作无需额外验证
            break;
            
        case experiment::Step::kSetGasPump:
            // SetGasPump 动作无需额外验证
            break;
            
        case experiment::Step::kLoop:
            validate_loop_action(step.loop(), path + ".loop");
            break;
            
        case experiment::Step::kPhaseMarker:
            // PhaseMarker 动作无需额外验证
            break;
            
        case experiment::Step::ACTION_NOT_SET:
            add_error(path, "NO_ACTION", "步骤未指定动作");
            break;
    }
}

void ExperimentValidator::validate_inject_action(
    const experiment::InjectAction& action, const std::string& path) {
    
    // 检查液体引用
    for (int i = 0; i < action.components_size(); ++i) {
        const auto& comp = action.components(i);
        std::string comp_path = path + ".components[" + std::to_string(i) + "]";
        
        const auto* liquid = find_liquid(comp.liquid_id());
        if (!liquid) {
            add_error(comp_path + ".liquid_id", "UNKNOWN_LIQUID",
                     "未知的液体ID: " + comp.liquid_id());
        }
    }
    
    // 检查目标量
    if (!action.has_target_volume_ml() && !action.has_target_weight_g()) {
        add_error(path, "NO_TARGET", "进样动作未指定目标量");
    }
    
    // 检查容差合理性
    double target = get_inject_volume(action);
    if (action.tolerance() > target * 0.5) {
        add_warning(path + ".tolerance", "LARGE_TOLERANCE",
                   "容差过大，可能影响实验精度");
    }
}

void ExperimentValidator::validate_wait_action(
    const experiment::WaitAction& action, const std::string& path) {
    
    // 检查是否指定了条件
    if (action.condition_case() == experiment::WaitAction::CONDITION_NOT_SET) {
        add_error(path, "NO_CONDITION", "等待动作未指定条件");
    }
    
    // 检查超时设置
    if (action.timeout_s() <= 0) {
        add_warning(path + ".timeout_s", "NO_TIMEOUT", "未设置超时，可能导致无限等待");
    }
}

void ExperimentValidator::validate_drain_action(
    const experiment::DrainAction& action, const std::string& path) {
    
    // 检查当前是否有液体可排
    if (current_liquid_level_ <= 0) {
        add_warning(path, "EMPTY_DRAIN", "排废时瓶中可能没有液体");
    }
}

void ExperimentValidator::validate_acquire_action(
    const experiment::AcquireAction& action, const std::string& path) {
    
    // 检查终止条件
    if (action.termination_case() == experiment::AcquireAction::TERMINATION_NOT_SET) {
        add_error(path, "NO_TERMINATION", "采集动作未指定终止条件");
    }
    
    // 检查最大时间
    if (action.max_duration_s() <= 0) {
        add_warning(path + ".max_duration_s", "NO_MAX_DURATION", 
                   "未设置最大时间，可能导致长时间运行");
    }
}

void ExperimentValidator::validate_loop_action(
    const experiment::LoopAction& action, const std::string& path) {
    
    // 验证循环体
    if (action.steps_size() == 0) {
        add_error(path + ".steps", "EMPTY_LOOP", "循环体为空");
        return;
    }
    
    // 模拟执行循环以计算资源
    // 注意: 这里只验证一次，但资源计算需要乘以循环次数
    double saved_level = current_liquid_level_;
    double saved_duration = total_duration_;
    int32_t saved_cycles = total_heater_cycles_;
    std::map<int32_t, double> saved_pump_totals = pump_totals_;
    
    // 验证一次循环
    validate_steps(action.steps(), path + ".steps");
    
    // 计算单次循环的资源增量
    double level_delta = current_liquid_level_ - saved_level;
    double duration_delta = total_duration_ - saved_duration;
    int32_t cycles_delta = total_heater_cycles_ - saved_cycles;
    
    std::map<int32_t, double> pump_delta;
    for (const auto& [pump, total] : pump_totals_) {
        auto it = saved_pump_totals.find(pump);
        double prev = (it != saved_pump_totals.end()) ? it->second : 0.0;
        pump_delta[pump] = total - prev;
    }
    
    // 应用循环次数
    int count = action.count();
    current_liquid_level_ = saved_level + level_delta * count;
    total_duration_ = saved_duration + duration_delta * count;
    total_heater_cycles_ = saved_cycles + cycles_delta * count;
    
    for (const auto& [pump, delta] : pump_delta) {
        pump_totals_[pump] = saved_pump_totals[pump] + delta * count;
    }
    
    // 更新峰值
    peak_liquid_level_ = std::max(peak_liquid_level_, current_liquid_level_);
}

void ExperimentValidator::calculate_inject_resources(const experiment::InjectAction& action) {
    double volume = get_inject_volume(action);
    
    // 累加每个泵的消耗
    for (const auto& comp : action.components()) {
        const auto* liquid = find_liquid(comp.liquid_id());
        if (liquid) {
            double comp_volume = volume * comp.ratio();
            pump_totals_[liquid->pump_index()] += comp_volume;
        }
    }
    
    // 更新液位
    current_liquid_level_ += volume;
    peak_liquid_level_ = std::max(peak_liquid_level_, current_liquid_level_);
    
    // 估算时间: 体积 / 流速 + 稳定时间
    double flow_rate = action.flow_rate_ml_min();
    if (flow_rate > 0) {
        total_duration_ += (volume / flow_rate) * 60;  // 转换为秒
    }
    total_duration_ += action.stable_timeout_s();
}

void ExperimentValidator::calculate_drain_resources(const experiment::DrainAction& action) {
    // 排废后液位清零
    current_liquid_level_ = 0;
    
    // 估算时间
    total_duration_ += action.timeout_s();
}

void ExperimentValidator::calculate_wait_resources(const experiment::WaitAction& action) {
    switch (action.condition_case()) {
        case experiment::WaitAction::kDurationS:
            total_duration_ += action.duration_s();
            break;
            
        case experiment::WaitAction::kHeaterCycles:
            total_heater_cycles_ += action.heater_cycles();
            // 假设每个加热周期约 2-3 秒
            total_duration_ += action.heater_cycles() * 2.5;
            break;
            
        case experiment::WaitAction::kStability:
            total_duration_ += action.stability().window_s();
            break;
            
        case experiment::WaitAction::kWeight:
        case experiment::WaitAction::kEmpty:
            // 使用超时作为估算
            total_duration_ += action.timeout_s() * 0.5;  // 假设平均等待一半时间
            break;
            
        default:
            break;
    }
}

void ExperimentValidator::calculate_acquire_resources(const experiment::AcquireAction& action) {
    switch (action.termination_case()) {
        case experiment::AcquireAction::kDurationS:
            total_duration_ += action.duration_s();
            break;
            
        case experiment::AcquireAction::kHeaterCycles:
            total_heater_cycles_ += action.heater_cycles();
            total_duration_ += action.heater_cycles() * 2.5;
            break;
            
        case experiment::AcquireAction::kStability:
            total_duration_ += action.stability().window_s();
            break;
            
        default:
            // 使用最大时间
            total_duration_ += action.max_duration_s();
            break;
    }
}

void ExperimentValidator::check_overflow_risk() {
    if (!program_->has_hardware()) return;
    
    const auto& hw = program_->hardware();
    double max_fill = hw.max_fill_ml();
    double capacity = hw.bottle_capacity_ml();
    
    if (peak_liquid_level_ > max_fill) {
        add_error("", "OVERFLOW_RISK",
                 "峰值液位(" + std::to_string(peak_liquid_level_) + 
                 " ml)超过最大液位(" + std::to_string(max_fill) + " ml)，有溢出风险");
    } else if (peak_liquid_level_ > max_fill * 0.9) {
        add_warning("", "HIGH_FILL_LEVEL",
                   "峰值液位接近最大液位，建议预留更多余量");
    }
    
    if (peak_liquid_level_ > capacity) {
        add_error("", "CAPACITY_EXCEEDED",
                 "峰值液位超过瓶子容量(" + std::to_string(capacity) + " ml)");
    }
}

void ExperimentValidator::check_empty_aspiration_risk() {
    // 检查每个液体的消耗是否超过可用量的90%
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        auto it = pump_totals_.find(inventory->pump_index());
        if (it == pump_totals_.end()) continue;
        
        double required = it->second;
        double available = inventory->available_ml();
        
        if (required > available * 0.9 && required <= available) {
            add_warning("hardware.liquids", "LOW_LIQUID_MARGIN",
                       "液体 " + liquid_id + " 余量不足10%，建议补充或减少用量");
        }
    }
}

void ExperimentValidator::check_liquid_sufficiency() {
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        auto it = pump_totals_.find(inventory->pump_index());
        if (it == pump_totals_.end()) continue;
        
        double required = it->second;
        double available = inventory->available_ml();
        
        if (required > available) {
            add_error("hardware.liquids", "INSUFFICIENT_LIQUID",
                     "液体 " + liquid_id + " 不足: 需要 " + 
                     std::to_string(required) + " ml，仅有 " + 
                     std::to_string(available) + " ml");
        }
    }
}

void ExperimentValidator::add_error(const std::string& path, const std::string& code, 
                                    const std::string& message) {
    errors_.push_back({path, code, message, ValidationErrorInfo::Severity::ERROR});
    spdlog::error("[验证错误] {} - {}: {}", path, code, message);
}

void ExperimentValidator::add_warning(const std::string& path, const std::string& code, 
                                      const std::string& message) {
    warnings_.push_back({path, code, message, ValidationErrorInfo::Severity::WARNING});
    spdlog::warn("[验证警告] {} - {}: {}", path, code, message);
}

double ExperimentValidator::get_inject_volume(const experiment::InjectAction& action) {
    if (action.has_target_volume_ml()) {
        return action.target_volume_ml();
    } else if (action.has_target_weight_g()) {
        // 使用平均密度估算体积
        double total_density = 0;
        int count = 0;
        for (const auto& comp : action.components()) {
            const auto* liquid = find_liquid(comp.liquid_id());
            if (liquid && liquid->density_g_ml() > 0) {
                total_density += liquid->density_g_ml() * comp.ratio();
                count++;
            }
        }
        double avg_density = (count > 0) ? total_density : 1.0;  // 默认密度 1.0
        return action.target_weight_g() / avg_density;
    }
    return 0;
}

const experiment::LiquidInventory* ExperimentValidator::find_liquid(const std::string& liquid_id) {
    auto it = liquid_map_.find(liquid_id);
    return (it != liquid_map_.end()) ? it->second : nullptr;
}

} // namespace enose::workflows
