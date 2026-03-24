#include "experiment_validator.hpp"
#include <spdlog/spdlog.h>
#include <algorithm>
#include <numeric>
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
    
    // 前后端估算对比
    cross_validate_compile_estimate();
    
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
    
    // 液体消耗详情（根据液体类型选择对应的泵绑定）
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        LiquidConsumptionInfo info;
        info.liquid_id = liquid_id;
        info.liquid_name = inventory->name();
        
        // 根据液体类型选择泵绑定映射，获取第一个泵索引
        info.pump_index = -1;
        auto sample_it = sample_pump_bindings_.find(liquid_id);
        if (sample_it != sample_pump_bindings_.end() && !sample_it->second.empty()) {
            info.pump_index = sample_it->second.front();
        } else {
            auto wash_it = wash_pump_bindings_.find(liquid_id);
            if (wash_it != wash_pump_bindings_.end() && !wash_it->second.empty()) {
                // 清洗泵使用 100+ 偏移标记
                info.pump_index = 100 + wash_it->second.front();
            }
        }
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
        info.available_ml = inventory->available_ml();
#pragma GCC diagnostic pop
        
        // 计算该液体的消耗量 (从泵消耗中提取)
        auto it = pump_totals_.find(info.pump_index >= 100 ? info.pump_index - 100 : info.pump_index);
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
    sample_pump_bindings_.clear();
    wash_pump_bindings_.clear();
    pump_totals_.clear();
    current_liquid_level_ = 0;
    peak_liquid_level_ = 0;
    total_duration_ = 0;
    total_heater_cycles_ = 0;
    current_heater_cycle_duration_s_ = 0;
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
    
    // 从数据库查询泵绑定（YAML 中的 pump_index 已废弃）
    db::ConsumableRepository repo;
    
    // 查询样品泵绑定 (pump 0-7)，支持多个泵绑定同一液体
    auto pump_assignments = repo.get_pump_assignments();
    for (const auto& pa : pump_assignments) {
        if (pa.liquid_id.has_value()) {
            std::string liquid_id = std::to_string(pa.liquid_id.value());
            sample_pump_bindings_[liquid_id].push_back(pa.pump_index);
            spdlog::debug("样品泵绑定: 液体 {} -> 泵 {}", liquid_id, pa.pump_index);
        }
    }
    
    // 查询清洗泵绑定，支持多个清洗泵绑定同一液体
    auto wash_pump_assignments = repo.get_wash_pump_assignments();
    for (const auto& wpa : wash_pump_assignments) {
        if (wpa.liquid_id.has_value()) {
            std::string liquid_id = std::to_string(wpa.liquid_id.value());
            wash_pump_bindings_[liquid_id].push_back(wpa.pump_index);
            spdlog::debug("清洗泵绑定: 液体 {} -> 清洗泵 {}", liquid_id, wpa.pump_index);
        }
    }
}

void ExperimentValidator::validate_hardware_constraints() {
    if (!program_->has_hardware()) {
        add_error("hardware", "MISSING_HARDWARE", "缺少硬件约束定义");
        return;
    }
    
    const auto& hw = program_->hardware();
    
    // 检查是否有清洗液定义 (只在程序包含清洗步骤时才警告)
    bool has_rinse = false;
    for (const auto& liquid : hw.liquids()) {
        if (liquid.type() == experiment::LIQUID_RINSE) {
            has_rinse = true;
            break;
        }
    }
    
    // 检查程序是否包含清洗步骤
    bool has_wash_step = has_wash_step_recursive(program_->steps());
    
    if (!has_rinse && has_wash_step) {
        add_error("hardware.liquids", "NO_RINSE_LIQUID", 
                 "程序包含清洗步骤但未定义清洗液");
    }
    
    // 检查液体是否有泵绑定（根据液体类型选择对应的泵表）
    for (const auto& liquid : hw.liquids()) {
        if (liquid.type() == experiment::LIQUID_RINSE) {
            // 清洗液检查清洗泵绑定
            auto it = wash_pump_bindings_.find(liquid.id());
            if (it == wash_pump_bindings_.end() || it->second.empty()) {
                add_warning("hardware.liquids", "NO_WASH_PUMP_BINDING",
                           "清洗液 " + liquid.id() + " (" + liquid.name() + 
                           ") 未在耗材管理中绑定到清洗泵");
            }
        } else {
            // 样品液检查样品泵绑定
            auto it = sample_pump_bindings_.find(liquid.id());
            if (it == sample_pump_bindings_.end() || it->second.empty()) {
                add_warning("hardware.liquids", "NO_PUMP_BINDING",
                           "液体 " + liquid.id() + " (" + liquid.name() + 
                           ") 未在耗材管理中绑定到样品泵");
            }
        }
    }
    
    // 注：泵唯一性检查已移除，因为泵绑定在耗材管理中配置
    // 一个泵只能绑定一个液体，由数据库约束保证
}

bool ExperimentValidator::has_wash_step_recursive(
    const google::protobuf::RepeatedPtrField<experiment::Step>& steps) {
    for (const auto& step : steps) {
        if (step.has_wash()) {
            return true;
        }
        if (step.has_loop()) {
            if (has_wash_step_recursive(step.loop().steps())) {
                return true;
            }
        }
    }
    return false;
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
            
        case experiment::Step::kWash:
            // Wash 动作的资源计算
            calculate_wash_resources(step.wash());
            break;
            
        case experiment::Step::kConfigureHeater:
            // ConfigureHeater 是瞬时操作，但需跟踪加热器配置以精确计算后续周期时长
            update_heater_config(step.configure_heater());
            break;
            
        case experiment::Step::kPreheat:
            // Preheat 动作的时长计算
            calculate_preheat_resources(step.preheat());
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
        } else {
            // 进样只能使用样品泵，检查液体是否绑定到样品泵
            auto pump_it = sample_pump_bindings_.find(comp.liquid_id());
            if (pump_it == sample_pump_bindings_.end() || pump_it->second.empty()) {
                // 检查是否只绑定到清洗泵
                auto wash_it = wash_pump_bindings_.find(comp.liquid_id());
                if (wash_it != wash_pump_bindings_.end() && !wash_it->second.empty()) {
                    add_error(comp_path + ".pump_binding", "WRONG_PUMP_TYPE",
                             "液体 " + comp.liquid_id() + " (" + liquid->name() + 
                             ") 只绑定到清洗泵，不能用于进样。请在耗材管理中将该液体绑定到样品泵");
                } else {
                    add_error(comp_path + ".pump_binding", "NO_PUMP_BINDING",
                             "液体 " + comp.liquid_id() + " (" + liquid->name() + 
                             ") 未在耗材管理中绑定到样品泵");
                }
            }
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
    
    // 检查最大时间 - 只有非固定时间模式才需要
    // 如果使用 duration_s 固定时间模式，则不需要 max_duration_s
    bool is_fixed_duration = (action.termination_case() == experiment::AcquireAction::kDurationS);
    if (!is_fixed_duration && action.max_duration_s() <= 0) {
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
    
    // 计算总比例用于归一化
    double total_ratio = 0;
    for (const auto& comp : action.components()) {
        total_ratio += comp.ratio();
    }
    if (total_ratio <= 0) total_ratio = 1.0;
    
    // 累加每个泵的消耗（进样使用样品泵，选择编号最小的）
    for (const auto& comp : action.components()) {
        auto pump_it = sample_pump_bindings_.find(comp.liquid_id());
        if (pump_it != sample_pump_bindings_.end() && !pump_it->second.empty()) {
            int32_t pump_index = pump_it->second.front();
            double comp_volume = volume * comp.ratio() / total_ratio;
            pump_totals_[pump_index] += comp_volume;
        }
    }
    
    // 更新液位
    current_liquid_level_ += volume;
    peak_liquid_level_ = std::max(peak_liquid_level_, current_liquid_level_);
    
    // 估算时间: 多泵并行时，用最大单泵体积 / 流速（对齐前端逻辑）
    double flow_rate = action.flow_rate_ml_s();
    if (flow_rate > 0) {
        double max_pump_volume = get_inject_max_pump_volume(action);
        total_duration_ += max_pump_volume / flow_rate;
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
            total_duration_ += action.heater_cycles() * get_heater_cycle_duration_s();
            break;
            
        case experiment::WaitAction::kStability:
            // 稳态模式：无法准确估算，使用 timeout × 0.5 作为乐观估计
            total_duration_ += action.timeout_s() * 0.5;
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
            total_duration_ += action.heater_cycles() * get_heater_cycle_duration_s();
            break;
            
        case experiment::AcquireAction::kStability:
            // 稳态模式：无法准确估算，使用 max_duration_s × 0.5 作为乐观估计
            total_duration_ += action.max_duration_s() * 0.5;
            break;
            
        default:
            // 使用最大时间
            total_duration_ += action.max_duration_s();
            break;
    }
}

void ExperimentValidator::calculate_wash_resources(const experiment::WashAction& action) {
    // 清洗动作的资源计算
    // 清洗流程: 先排废 → 注入清洗液 → 再排废
    
    // 1. 先排废（清空当前液体）
    current_liquid_level_ = 0;
    
    // 2. 注入清洗液 - 使用目标清洗量作为估算
    double wash_volume = action.target_volume_ml();
    current_liquid_level_ = wash_volume;  // 从0开始注入
    if (current_liquid_level_ > peak_liquid_level_) {
        peak_liquid_level_ = current_liquid_level_;
    }
    
    // 3. 清洗后排废
    current_liquid_level_ = 0;
    
    // 时长估算: 每次循环 = 排废确认空瓶 + 注入清洗液 + 排废清洗液
    double single_cycle = action.drain_timeout_s() + action.fill_timeout_s() + action.drain_timeout_s();
    total_duration_ += single_cycle * action.repeat_count();
}

void ExperimentValidator::calculate_preheat_resources(const experiment::PreheatAction& action) {
    // 预热动作的时长计算
    if (action.has_duration_s()) {
        // 固定时间模式
        total_duration_ += action.duration_s();
    } else if (action.has_cycles()) {
        // 加热器循环模式 - 从数据库加热器配置精确计算
        total_duration_ += action.cycles() * get_heater_cycle_duration_s();
        total_heater_cycles_ += action.cycles();
    } else if (action.has_stability()) {
        // 稳态检测模式 - 无法准确估算，使用 max_duration_s 的一半作为乐观估计
        total_duration_ += action.max_duration_s() * 0.5;
    } else {
        // 使用最大时间
        total_duration_ += action.max_duration_s();
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
    // 使用数据库查询液体余量
    db::ConsumableRepository repo;
    
    // 统计每个液体ID的总消耗量（根据液体类型选择对应的泵绑定）
    std::map<std::string, double> liquid_consumption;
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        // 根据液体类型选择泵绑定映射
        const std::vector<int32_t>* pump_list = nullptr;
        auto sample_it = sample_pump_bindings_.find(liquid_id);
        if (sample_it != sample_pump_bindings_.end() && !sample_it->second.empty()) {
            pump_list = &sample_it->second;
        } else {
            auto wash_it = wash_pump_bindings_.find(liquid_id);
            if (wash_it != wash_pump_bindings_.end() && !wash_it->second.empty()) {
                pump_list = &wash_it->second;
            }
        }
        
        if (pump_list) {
            // 使用第一个泵（编号最小的）
            auto it = pump_totals_.find(pump_list->front());
            if (it != pump_totals_.end()) {
                liquid_consumption[liquid_id] += it->second;
            }
        }
    }
    
    // 检查每个液体的消耗是否超过可用量的90%
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        // 尝试将液体ID转换为整数
        int liquid_id_int = 0;
        try {
            liquid_id_int = std::stoi(liquid_id);
        } catch (...) {
            continue;
        }
        
        // 获取该液体的消耗量
        double required = 0;
        auto it = liquid_consumption.find(liquid_id);
        if (it != liquid_consumption.end()) {
            required = it->second;
        }
        if (required <= 0) continue;
        
        // 从数据库查询余量
        double available = repo.get_liquid_available_volume(liquid_id_int);
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
        if (available <= 0 && inventory->available_ml() > 0) {
            available = inventory->available_ml();
        }
#pragma GCC diagnostic pop
        
        if (required > available * 0.9 && required <= available) {
            add_warning("hardware.liquids", "LOW_LIQUID_MARGIN",
                       "液体 " + liquid_id + " 余量不足10%，建议补充或减少用量");
        }
    }
}

void ExperimentValidator::check_liquid_sufficiency() {
    // 使用 ConsumableRepository 从数据库查询液体的实际余量
    db::ConsumableRepository repo;
    
    // 统计每个液体ID的总消耗量（根据液体类型选择对应的泵绑定）
    std::map<std::string, double> liquid_consumption;
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        // 根据液体类型选择泵绑定映射
        const std::vector<int32_t>* pump_list = nullptr;
        auto sample_it = sample_pump_bindings_.find(liquid_id);
        if (sample_it != sample_pump_bindings_.end() && !sample_it->second.empty()) {
            pump_list = &sample_it->second;
        } else {
            auto wash_it = wash_pump_bindings_.find(liquid_id);
            if (wash_it != wash_pump_bindings_.end() && !wash_it->second.empty()) {
                pump_list = &wash_it->second;
            }
        }
        
        if (pump_list) {
            // 使用第一个泵（编号最小的）
            auto it = pump_totals_.find(pump_list->front());
            if (it != pump_totals_.end()) {
                liquid_consumption[liquid_id] += it->second;
            }
        }
    }
    
    for (const auto& [liquid_id, inventory] : liquid_map_) {
        // 尝试将液体ID转换为整数，用于数据库查询
        int liquid_id_int = 0;
        try {
            liquid_id_int = std::stoi(liquid_id);
        } catch (...) {
            // 非数字ID，跳过数据库查询，使用YAML中的available_ml
            continue;
        }
        
        // 从数据库查询该液体绑定的所有泵的总余量
        double available = repo.get_liquid_available_volume(liquid_id_int);
        
        // 如果数据库没有余量信息，回退到YAML中的值
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
        if (available <= 0 && inventory->available_ml() > 0) {
            available = inventory->available_ml();
        }
#pragma GCC diagnostic pop
        
        // 获取该液体的消耗量
        double required = 0;
        auto it = liquid_consumption.find(liquid_id);
        if (it != liquid_consumption.end()) {
            required = it->second;
        }
        
        if (required > 0 && required > available) {
            add_warning("hardware.liquids", "INSUFFICIENT_LIQUID",
                     "液体 " + liquid_id + " 余量不足: 需要 " + 
                     std::to_string(required) + " ml，仅有 " + 
                     std::to_string(available) + " ml（执行时将在不足处暂停等待补充）");
        }
        
        spdlog::debug("液体余量检查: id={}, required={} ml, available={} ml", 
                     liquid_id, required, available);
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
        // 使用加权平均密度估算体积
        double total_ratio = 0;
        double weighted_density = 0;
        for (const auto& comp : action.components()) {
            total_ratio += comp.ratio();
            const auto* liquid = find_liquid(comp.liquid_id());
            if (liquid && liquid->density_g_ml() > 0) {
                weighted_density += liquid->density_g_ml() * comp.ratio();
            } else {
                weighted_density += 1.0 * comp.ratio();  // 默认密度 1.0
            }
        }
        double avg_density = (total_ratio > 0) ? weighted_density / total_ratio : 1.0;
        return action.target_weight_g() / avg_density;
    }
    return 0;
}

const experiment::LiquidInventory* ExperimentValidator::find_liquid(const std::string& liquid_id) {
    auto it = liquid_map_.find(liquid_id);
    return (it != liquid_map_.end()) ? it->second : nullptr;
}

void ExperimentValidator::update_heater_config(const experiment::ConfigureHeaterAction& action) {
    // 从 ConfigureHeater 动作中提取加热器配置，计算精确的单周期时长
    // 取第一个 config（通常所有传感器使用相同配置）
    if (action.configs_size() == 0) return;
    
    const auto& config = action.configs(0);
    
    std::vector<int32_t> durs;
    
    if (config.temps_size() > 0 && config.durs_size() > 0) {
        // 自定义曲线，直接使用 durs
        durs.assign(config.durs().begin(), config.durs().end());
    } else if (!config.profile_name().empty()) {
        // 从数据库加载预设
        db::SensorRepository sensor_repo;
        auto profile = sensor_repo.get_heater_profile_by_name(config.profile_name());
        if (profile) {
            durs.assign(profile->durs.begin(), profile->durs.end());
            spdlog::debug("从数据库加载加热器预设 '{}': {} 步", 
                         config.profile_name(), durs.size());
        } else {
            spdlog::warn("未找到加热器预设 '{}', 使用估算值", config.profile_name());
        }
    }
    
    if (!durs.empty()) {
        // 精确计算: sum(durs) × 140ms
        double total_ms = 0;
        for (auto d : durs) {
            total_ms += d * 140.0;
        }
        current_heater_cycle_duration_s_ = total_ms / 1000.0;
        spdlog::info("加热器单周期精确时长: {:.2f}s ({}步, sum_durs={})", 
                    current_heater_cycle_duration_s_, durs.size(),
                    std::accumulate(durs.begin(), durs.end(), 0));
    }
}

double ExperimentValidator::get_heater_cycle_duration_s() const {
    if (current_heater_cycle_duration_s_ > 0) {
        return current_heater_cycle_duration_s_;
    }
    // 未配置加热器时的估算值 (10步 × 平均 ~2.6s = 26s)
    return 26.0;
}

double ExperimentValidator::get_inject_max_pump_volume(const experiment::InjectAction& action) {
    double volume = get_inject_volume(action);
    
    double total_ratio = 0;
    for (const auto& comp : action.components()) {
        total_ratio += comp.ratio();
    }
    if (total_ratio <= 0) return volume;
    
    // 多泵并行: 取最大单泵体积（与前端 compiler.ts 对齐）
    double max_pump_volume = 0;
    for (const auto& comp : action.components()) {
        double comp_volume = volume * comp.ratio() / total_ratio;
        max_pump_volume = std::max(max_pump_volume, comp_volume);
    }
    
    return max_pump_volume > 0 ? max_pump_volume : volume;
}

void ExperimentValidator::cross_validate_compile_estimate() {
    if (!program_->has_compile_estimate()) {
        // 没有前端编译估算，跳过对比
        return;
    }
    
    const auto& fe = program_->compile_estimate();  // frontend estimate
    constexpr double tolerance = 0.10;  // 允许 10% 误差
    
    // 对比总时长
    if (total_duration_ > 0 && fe.estimated_duration_s() > 0) {
        double diff = std::abs(fe.estimated_duration_s() - total_duration_) / total_duration_;
        if (diff > tolerance) {
            add_warning("_compile_estimate.total_duration_s", "DURATION_MISMATCH",
                       "前后端时长估算差异超过10%: 前端=" + 
                       std::to_string(fe.estimated_duration_s()) + 
                       "s, 后端=" + std::to_string(total_duration_) + "s");
        }
    }
    
    // 对比峰值液位
    if (peak_liquid_level_ > 0 && fe.peak_liquid_level_ml() > 0) {
        double diff = std::abs(fe.peak_liquid_level_ml() - peak_liquid_level_) / peak_liquid_level_;
        if (diff > tolerance) {
            add_warning("_compile_estimate.peak_liquid_level_ml", "PEAK_LEVEL_MISMATCH",
                       "前后端峰值液位估算差异超过10%: 前端=" + 
                       std::to_string(fe.peak_liquid_level_ml()) + 
                       "ml, 后端=" + std::to_string(peak_liquid_level_) + "ml");
        }
    }
    
    // 对比各泵消耗量
    for (const auto& [pump_idx, backend_volume] : pump_totals_) {
        auto it = fe.pump_consumption_ml().find(pump_idx);
        if (it != fe.pump_consumption_ml().end()) {
            double frontend_volume = it->second;
            if (backend_volume > 0) {
                double diff = std::abs(frontend_volume - backend_volume) / backend_volume;
                if (diff > tolerance) {
                    add_warning("_compile_estimate.pump_consumption_ml[" + std::to_string(pump_idx) + "]",
                               "PUMP_VOLUME_MISMATCH",
                               "泵" + std::to_string(pump_idx) + " 用量估算差异超过10%: 前端=" + 
                               std::to_string(frontend_volume) + "ml, 后端=" + 
                               std::to_string(backend_volume) + "ml");
                }
            }
        }
    }
    
    spdlog::debug("前后端估算对比完成: 前端duration={}s, 后端duration={}s",
                 fe.estimated_duration_s(), total_duration_);
}

} // namespace enose::workflows
