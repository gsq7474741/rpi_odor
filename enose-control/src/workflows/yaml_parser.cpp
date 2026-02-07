#include "yaml_parser.hpp"
#include <yaml-cpp/yaml.h>
#include <spdlog/spdlog.h>

namespace enose {
namespace workflows {

namespace experiment = ::enose::experiment;

// 辅助函数：解析液体类型
static experiment::LiquidType parse_liquid_type(const std::string& type_str) {
    if (type_str == "LIQUID_RINSE") return experiment::LIQUID_RINSE;
    if (type_str == "LIQUID_SAMPLE") return experiment::LIQUID_SAMPLE;
    if (type_str == "LIQUID_CALIBRATION") return experiment::LIQUID_CALIBRATION;
    return experiment::LIQUID_TYPE_UNSPECIFIED;
}

// 辅助函数：解析单个步骤
static bool parse_step(const YAML::Node& node, experiment::Step* step, std::string& error) {
    if (!node["name"]) {
        error = "步骤缺少 name 字段";
        return false;
    }
    step->set_name(node["name"].as<std::string>());
    
    // 解析 phase_name（编译器自动填充，用于集中式 phase 转换）
    if (node["phase_name"]) {
        step->set_phase_name(node["phase_name"].as<std::string>());
    }
    
    // 解析动作类型
    if (node["inject"]) {
        auto* action = step->mutable_inject();
        auto inject = node["inject"];
        
        if (inject["target_volume_ml"]) {
            action->set_target_volume_ml(inject["target_volume_ml"].as<double>());
        }
        if (inject["tolerance"]) {
            action->set_tolerance(inject["tolerance"].as<double>());
        } else {
            action->set_tolerance(1.0);
        }
        if (inject["flow_rate_ml_s"]) {
            action->set_flow_rate_ml_s(inject["flow_rate_ml_s"].as<double>());
        } else if (inject["flow_rate_ml_min"]) {
            // 兼容旧版 YAML 使用 ml/min 单位，转换为 ml/s
            action->set_flow_rate_ml_s(inject["flow_rate_ml_min"].as<double>() / 60.0);
        } else {
            action->set_flow_rate_ml_s(5.0);
        }
        if (inject["stable_timeout_s"]) {
            action->set_stable_timeout_s(inject["stable_timeout_s"].as<double>());
        } else {
            action->set_stable_timeout_s(30.0);
        }
        
        // 解析液体成分列表
        if (inject["components"] && inject["components"].IsSequence()) {
            for (const auto& comp_node : inject["components"]) {
                auto* comp = action->add_components();
                if (comp_node["liquid_id"]) {
                    comp->set_liquid_id(comp_node["liquid_id"].as<std::string>());
                }
                if (comp_node["ratio"]) {
                    comp->set_ratio(comp_node["ratio"].as<double>());
                } else {
                    comp->set_ratio(1.0);
                }
                if (comp_node["is_solvent"]) {
                    comp->set_is_solvent(comp_node["is_solvent"].as<bool>());
                }
            }
        }
        
        // 如果没有定义成分，添加默认液体成分
        if (action->components_size() == 0) {
            auto* comp = action->add_components();
            comp->set_liquid_id("default");
            comp->set_ratio(1.0);
        }
    }
    else if (node["wait"]) {
        auto* action = step->mutable_wait();
        auto wait = node["wait"];
        
        if (wait["duration_s"]) {
            action->set_duration_s(wait["duration_s"].as<double>());
        }
        if (wait["timeout_s"]) {
            action->set_timeout_s(wait["timeout_s"].as<double>());
        } else {
            action->set_timeout_s(300.0);
        }
    }
    else if (node["drain"]) {
        auto* action = step->mutable_drain();
        auto drain = node["drain"];
        
        if (drain["gas_pump_pwm"]) {
            action->set_gas_pump_pwm(drain["gas_pump_pwm"].as<int>());
        }
        if (drain["empty_tolerance_g"]) {
            action->set_empty_tolerance_g(drain["empty_tolerance_g"].as<double>());
        } else {
            action->set_empty_tolerance_g(10.0);
        }
        if (drain["stability_window_s"]) {
            action->set_stability_window_s(drain["stability_window_s"].as<double>());
        } else {
            action->set_stability_window_s(2.0);
        }
        if (drain["timeout_s"]) {
            action->set_timeout_s(drain["timeout_s"].as<double>());
        } else {
            action->set_timeout_s(60.0);
        }
    }
    else if (node["acquire"]) {
        auto* action = step->mutable_acquire();
        auto acquire = node["acquire"];
        
        if (acquire["gas_pump_pwm"]) {
            action->set_gas_pump_pwm(acquire["gas_pump_pwm"].as<int>());
        }
        
        // 终止条件1：固定时间
        if (acquire["duration_s"]) {
            action->set_duration_s(acquire["duration_s"].as<double>());
        }
        // 终止条件2：加热周期数
        if (acquire["heater_cycles"]) {
            action->set_heater_cycles(acquire["heater_cycles"].as<int>());
        }
        // 终止条件3：稳定性检测
        if (acquire["stability"]) {
            auto stability = acquire["stability"];
            auto* stab = action->mutable_stability();
            if (stability["window_s"]) {
                stab->set_window_s(stability["window_s"].as<double>());
            } else {
                stab->set_window_s(30.0);  // 默认30秒窗口
            }
            if (stability["threshold_percent"]) {
                stab->set_threshold_percent(stability["threshold_percent"].as<double>());
            } else {
                stab->set_threshold_percent(5.0);  // 默认5%阈值
            }
        }
        // 最大时长（超时保护）
        if (acquire["max_duration_s"]) {
            action->set_max_duration_s(acquire["max_duration_s"].as<double>());
        }
    }
    else if (node["set_state"]) {
        auto* action = step->mutable_set_state();
        auto set_state = node["set_state"];
        
        std::string state_str = set_state["state"].as<std::string>();
        if (state_str == "STATE_INITIAL") {
            action->set_state(experiment::STATE_INITIAL);
        } else if (state_str == "STATE_SAMPLE") {
            action->set_state(experiment::STATE_SAMPLE);
        } else if (state_str == "STATE_DRAIN") {
            action->set_state(experiment::STATE_DRAIN);
        }
    }
    else if (node["set_gas_pump"]) {
        auto* action = step->mutable_set_gas_pump();
        auto set_gas_pump = node["set_gas_pump"];
        
        if (set_gas_pump["pwm_percent"]) {
            action->set_pwm_percent(set_gas_pump["pwm_percent"].as<int>());
        }
    }
    else if (node["phase_marker"]) {
        auto* action = step->mutable_phase_marker();
        auto phase_marker = node["phase_marker"];
        
        if (phase_marker["phase_name"]) {
            action->set_phase_name(phase_marker["phase_name"].as<std::string>());
        }
        if (phase_marker["is_start"]) {
            action->set_is_start(phase_marker["is_start"].as<bool>());
        }
    }
    else if (node["loop"]) {
        auto* action = step->mutable_loop();
        auto loop = node["loop"];
        
        if (loop["count"]) {
            action->set_count(loop["count"].as<int>());
        }
        if (loop["steps"]) {
            for (const auto& sub_step_node : loop["steps"]) {
                auto* sub_step = action->add_steps();
                if (!parse_step(sub_step_node, sub_step, error)) {
                    return false;
                }
            }
        }
    }
    else if (node["wash"]) {
        auto* action = step->mutable_wash();
        auto wash = node["wash"];
        
        // 支持两种格式（向后兼容）：
        // 1. 体积格式 (wash_volume_ml / target_volume_ml) - 推荐
        // 2. 旧格式 (target_weight_g) - 向后兼容
        if (wash["target_volume_ml"]) {
            action->set_target_volume_ml(wash["target_volume_ml"].as<double>());
        } else if (wash["wash_volume_ml"]) {
            action->set_target_volume_ml(wash["wash_volume_ml"].as<double>());
        } else if (wash["target_weight_g"]) {
            action->set_target_volume_ml(wash["target_weight_g"].as<double>());
        } else {
            action->set_target_volume_ml(20.0); // 默认 20ml
        }
        
        if (wash["repeat_count"]) {
            action->set_repeat_count(wash["repeat_count"].as<int>());
        } else {
            action->set_repeat_count(1);
        }
        
        if (wash["fill_timeout_s"]) {
            action->set_fill_timeout_s(wash["fill_timeout_s"].as<double>());
        } else {
            action->set_fill_timeout_s(60.0);
        }
        
        if (wash["drain_timeout_s"]) {
            action->set_drain_timeout_s(wash["drain_timeout_s"].as<double>());
        } else {
            action->set_drain_timeout_s(60.0);
        }
        
        // 支持 gas_pump_pwm 或 drain_gas_pump_pwm
        if (wash["drain_gas_pump_pwm"]) {
            action->set_drain_gas_pump_pwm(wash["drain_gas_pump_pwm"].as<int>());
        } else if (wash["gas_pump_pwm"]) {
            action->set_drain_gas_pump_pwm(wash["gas_pump_pwm"].as<int>());
        } else {
            action->set_drain_gas_pump_pwm(50);
        }
        
        if (wash["empty_tolerance_g"]) {
            action->set_empty_tolerance_g(wash["empty_tolerance_g"].as<double>());
        } else {
            action->set_empty_tolerance_g(10.0);
        }
        
        if (wash["empty_stability_window_s"]) {
            action->set_empty_stability_window_s(wash["empty_stability_window_s"].as<double>());
        } else {
            action->set_empty_stability_window_s(2.0);
        }
        
        if (wash["wash_liquid_id"]) {
            action->set_wash_liquid_id(wash["wash_liquid_id"].as<std::string>());
        }
        if (wash["fill_mode"]) {
            action->set_fill_mode(wash["fill_mode"].as<std::string>());
        }
    }
    else if (node["preheat"]) {
        auto* action = step->mutable_preheat();
        auto preheat = node["preheat"];
        
        // 预热模式: cycles 或 duration_s (二选一)
        if (preheat["cycles"]) {
            action->set_cycles(preheat["cycles"].as<int>());
        } else if (preheat["duration_s"]) {
            action->set_duration_s(preheat["duration_s"].as<double>());
        }
        
        // 最大等待时间
        if (preheat["max_duration_s"]) {
            action->set_max_duration_s(preheat["max_duration_s"].as<double>());
        } else {
            action->set_max_duration_s(300.0);  // 默认5分钟
        }
        
        // 目标传感器索引
        if (preheat["sensor_indices"] && preheat["sensor_indices"].IsSequence()) {
            for (const auto& idx : preheat["sensor_indices"]) {
                action->add_sensor_indices(idx.as<int>());
            }
        }
        
        // 是否记录预热数据
        if (preheat["record_data"]) {
            action->set_record_data(preheat["record_data"].as<bool>());
        }
        
        // 气泵PWM
        if (preheat["gas_pump_pwm"]) {
            action->set_gas_pump_pwm(preheat["gas_pump_pwm"].as<int>());
        }
    }
    else if (node["configure_heater"]) {
        auto* action = step->mutable_configure_heater();
        auto ch = node["configure_heater"];
        
        if (ch["configs"] && ch["configs"].IsSequence()) {
            for (const auto& cfg_node : ch["configs"]) {
                auto* config = action->add_configs();
                
                // 配置预设名称
                if (cfg_node["profile_name"]) {
                    config->set_profile_name(cfg_node["profile_name"].as<std::string>());
                }
                
                // 温度序列
                if (cfg_node["temps"] && cfg_node["temps"].IsSequence()) {
                    for (const auto& t : cfg_node["temps"]) {
                        config->add_temps(t.as<int>());
                    }
                }
                
                // 持续时间序列
                if (cfg_node["durs"] && cfg_node["durs"].IsSequence()) {
                    for (const auto& d : cfg_node["durs"]) {
                        config->add_durs(d.as<int>());
                    }
                }
                
                // 目标传感器索引
                if (cfg_node["sensor_indices"] && cfg_node["sensor_indices"].IsSequence()) {
                    for (const auto& idx : cfg_node["sensor_indices"]) {
                        config->add_sensor_indices(idx.as<int>());
                    }
                }
            }
        }
    }
    else {
        error = "步骤 '" + step->name() + "' 缺少动作定义";
        return false;
    }
    
    return true;
}

YamlParser::ParseResult YamlParser::parse(const std::string& yaml_content) {
    ParseResult result;
    
    try {
        YAML::Node root = YAML::Load(yaml_content);
        
        // 解析基本信息
        if (root["id"]) {
            result.program.set_id(root["id"].as<std::string>());
        } else {
            result.error_message = "程序缺少 id 字段";
            return result;
        }
        
        if (root["name"]) {
            result.program.set_name(root["name"].as<std::string>());
        } else {
            result.error_message = "程序缺少 name 字段";
            return result;
        }
        
        if (root["description"]) {
            result.program.set_description(root["description"].as<std::string>());
        }
        
        if (root["version"]) {
            result.program.set_version(root["version"].as<std::string>());
        } else {
            result.program.set_version("1.0.0");
        }
        
        // 解析硬件约束
        auto* hardware = result.program.mutable_hardware();
        if (root["hardware"]) {
            auto hw = root["hardware"];
            if (hw["bottle_capacity_ml"]) {
                hardware->set_bottle_capacity_ml(hw["bottle_capacity_ml"].as<double>());
            } else {
                hardware->set_bottle_capacity_ml(150.0);
            }
            if (hw["max_fill_ml"]) {
                hardware->set_max_fill_ml(hw["max_fill_ml"].as<double>());
            } else {
                hardware->set_max_fill_ml(100.0);
            }
            if (hw["max_gas_pump_pwm"]) {
                hardware->set_max_gas_pump_pwm(hw["max_gas_pump_pwm"].as<int>());
            } else {
                hardware->set_max_gas_pump_pwm(100);
            }
            
            // 解析液体列表
            if (hw["liquids"]) {
                for (const auto& liq_node : hw["liquids"]) {
                    auto* liquid = hardware->add_liquids();
                    if (liq_node["id"]) {
                        liquid->set_id(liq_node["id"].as<std::string>());
                    }
                    if (liq_node["name"]) {
                        liquid->set_name(liq_node["name"].as<std::string>());
                    }
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
                    // 向后兼容: 旧 YAML 可能包含 pump_index/available_ml
                    if (liq_node["pump_index"]) {
                        liquid->set_pump_index(liq_node["pump_index"].as<int>());
                    }
#pragma GCC diagnostic pop
                    if (liq_node["type"]) {
                        liquid->set_type(parse_liquid_type(liq_node["type"].as<std::string>()));
                    }
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
                    if (liq_node["available_ml"]) {
                        liquid->set_available_ml(liq_node["available_ml"].as<double>());
                    }
#pragma GCC diagnostic pop
                    if (liq_node["density_g_ml"]) {
                        liquid->set_density_g_ml(liq_node["density_g_ml"].as<double>());
                    } else {
                        liquid->set_density_g_ml(1.0);
                    }
                }
            }
            
            // 如果没有定义液体，添加默认液体
            if (hardware->liquids_size() == 0) {
                auto* liquid = hardware->add_liquids();
                liquid->set_id("default");
                liquid->set_name("默认液体");
                liquid->set_type(experiment::LIQUID_SAMPLE);
                liquid->set_density_g_ml(1.0);
            }
        } else {
            // 设置默认硬件约束
            hardware->set_bottle_capacity_ml(150.0);
            hardware->set_max_fill_ml(100.0);
            hardware->set_max_gas_pump_pwm(100);
            auto* liquid = hardware->add_liquids();
            liquid->set_id("default");
            liquid->set_name("默认液体");
            liquid->set_type(experiment::LIQUID_SAMPLE);
            liquid->set_density_g_ml(1.0);
        }
        
        // 解析步骤
        if (!root["steps"] || !root["steps"].IsSequence()) {
            result.error_message = "程序缺少 steps 列表";
            return result;
        }
        
        for (const auto& step_node : root["steps"]) {
            auto* step = result.program.add_steps();
            if (!parse_step(step_node, step, result.error_message)) {
                return result;
            }
        }
        
        // 解析前端编译估算 (可选)
        if (root["_compile_estimate"]) {
            auto ce = root["_compile_estimate"];
            auto* est = result.program.mutable_compile_estimate();
            
            if (ce["total_duration_s"]) {
                est->set_estimated_duration_s(ce["total_duration_s"].as<double>());
            }
            if (ce["peak_liquid_level_ml"]) {
                est->set_peak_liquid_level_ml(ce["peak_liquid_level_ml"].as<double>());
            }
            
            // 解析泵消耗量
            if (ce["pump_estimates"] && ce["pump_estimates"].IsSequence()) {
                auto* pump_map = est->mutable_pump_consumption_ml();
                for (const auto& pe : ce["pump_estimates"]) {
                    if (pe["pump_index"] && pe["volume_ml"]) {
                        (*pump_map)[pe["pump_index"].as<int>()] = pe["volume_ml"].as<double>();
                    }
                }
            }
            
            // 解析液体消耗详情
            if (ce["liquid_consumption"] && ce["liquid_consumption"].IsSequence()) {
                for (const auto& lc : ce["liquid_consumption"]) {
                    auto* consumption = est->add_liquid_consumption();
                    if (lc["liquid_id"]) {
                        consumption->set_liquid_id(lc["liquid_id"].as<std::string>());
                    }
                    if (lc["liquid_name"]) {
                        consumption->set_liquid_name(lc["liquid_name"].as<std::string>());
                    }
                    if (lc["pump_index"]) {
                        consumption->set_pump_index(lc["pump_index"].as<int>());
                    }
                    if (lc["required_ml"]) {
                        consumption->set_required_ml(lc["required_ml"].as<double>());
                    }
                }
            }
            
            spdlog::debug("解析前端编译估算: duration={}s, peak={}ml",
                         est->estimated_duration_s(), est->peak_liquid_level_ml());
        }
        
        result.success = true;
        spdlog::info("YAML 解析成功: {} ({}个步骤)", 
                     result.program.name(), result.program.steps_size());
        
    } catch (const YAML::Exception& e) {
        result.error_message = std::string("YAML 解析错误: ") + e.what();
        spdlog::error("{}", result.error_message);
    } catch (const std::exception& e) {
        result.error_message = std::string("解析错误: ") + e.what();
        spdlog::error("{}", result.error_message);
    }
    
    return result;
}

} // namespace workflows
} // namespace enose
