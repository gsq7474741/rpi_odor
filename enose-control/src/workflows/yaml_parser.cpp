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
    
    // 解析动作类型
    if (node["inject"]) {
        auto* action = step->mutable_inject();
        auto inject = node["inject"];
        
        // 简化版：单液体进样
        if (inject["target_volume_ml"]) {
            action->set_target_volume_ml(inject["target_volume_ml"].as<double>());
        }
        if (inject["tolerance"]) {
            action->set_tolerance(inject["tolerance"].as<double>());
        } else {
            action->set_tolerance(1.0);
        }
        if (inject["flow_rate_ml_min"]) {
            action->set_flow_rate_ml_min(inject["flow_rate_ml_min"].as<double>());
        } else {
            action->set_flow_rate_ml_min(5.0);
        }
        if (inject["stable_timeout_s"]) {
            action->set_stable_timeout_s(inject["stable_timeout_s"].as<double>());
        } else {
            action->set_stable_timeout_s(30.0);
        }
        
        // 添加默认液体成分
        auto* comp = action->add_components();
        comp->set_liquid_id("default");
        comp->set_ratio(1.0);
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
        if (acquire["heater_cycles"]) {
            action->set_heater_cycles(acquire["heater_cycles"].as<int>());
        }
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
                    if (liq_node["pump_index"]) {
                        liquid->set_pump_index(liq_node["pump_index"].as<int>());
                    }
                    if (liq_node["type"]) {
                        liquid->set_type(parse_liquid_type(liq_node["type"].as<std::string>()));
                    }
                    if (liq_node["available_ml"]) {
                        liquid->set_available_ml(liq_node["available_ml"].as<double>());
                    }
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
                liquid->set_pump_index(2);
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
            liquid->set_pump_index(2);
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
