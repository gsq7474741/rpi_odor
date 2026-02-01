#include "heater_config_executor.hpp"
#include "enose_experiment.pb.h"
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>

namespace workflows {

PreconditionResult HeaterConfigExecutor::check_preconditions(
    const enose::experiment::Step& step) const {
    
    if (!step.has_configure_heater()) {
        return PreconditionResult::fail({"Step does not contain configure_heater action"});
    }
    
    const auto& action = step.configure_heater();
    
    // 检查至少有一个配置
    if (action.configs_size() == 0) {
        return PreconditionResult::fail({"ConfigureHeaterAction must have at least one config"});
    }
    
    // 检查每个配置
    for (const auto& config : action.configs()) {
        // 必须指定 profile_name 或自定义曲线
        if (config.profile_name().empty() && config.temps_size() == 0) {
            return PreconditionResult::fail({"HeaterConfig must specify profile_name or custom temps/durs"});
        }
        
        // 如果指定自定义曲线，temps 和 durs 长度必须相等
        if (config.temps_size() > 0 && config.temps_size() != config.durs_size()) {
            return PreconditionResult::fail({"temps and durs arrays must have the same length"});
        }
    }
    
    // 检查传感器驱动
    if (!sensor_) {
        return PreconditionResult::fail({"Sensor driver not available"});
    }
    
    return PreconditionResult::ok();
}

ExecuteResult HeaterConfigExecutor::execute(const enose::experiment::Step& step) {
    const auto& action = step.configure_heater();
    
    spdlog::info("HeaterConfigExecutor: configuring {} heater configs", action.configs_size());
    
    for (const auto& config : action.configs()) {
        std::vector<int32_t> temps;
        std::vector<int32_t> durs;
        std::string profile_name;
        
        // 优先使用自定义曲线
        if (config.temps_size() > 0) {
            temps.assign(config.temps().begin(), config.temps().end());
            durs.assign(config.durs().begin(), config.durs().end());
            profile_name = "custom";
            spdlog::debug("HeaterConfigExecutor: using custom heater curve ({} steps)", temps.size());
        } else {
            // 从数据库加载预设
            profile_name = config.profile_name();
            
            if (!sensor_repo_) {
                return ExecuteResult::fail("SensorRepository not available to load profile");
            }
            
            auto profile = sensor_repo_->get_heater_profile_by_name(profile_name);
            if (!profile) {
                return ExecuteResult::fail("Heater profile not found: " + profile_name);
            }
            
            temps.assign(profile->temps.begin(), profile->temps.end());
            durs.assign(profile->durs.begin(), profile->durs.end());
            
            spdlog::debug("HeaterConfigExecutor: loaded profile '{}' ({} steps)", 
                         profile_name, temps.size());
        }
        
        // 获取目标传感器列表
        std::vector<int32_t> sensor_indices;
        if (config.sensor_indices_size() > 0) {
            sensor_indices.assign(config.sensor_indices().begin(), config.sensor_indices().end());
        }
        // 空列表表示全部传感器
        
        // 发送配置命令到固件
        if (!send_config_command(temps, durs, sensor_indices)) {
            return ExecuteResult::fail("Failed to send heater config command");
        }
        
        // 记录配置分配到数据库
        if (sensor_repo_) {
            db::HeaterProfileRecord profile_rec;
            profile_rec.name = profile_name;
            for (auto t : temps) profile_rec.temps.push_back(static_cast<int16_t>(t));
            for (auto d : durs) profile_rec.durs.push_back(static_cast<int16_t>(d));
            
            if (sensor_indices.empty()) {
                // 全部传感器
                for (int16_t idx = 0; idx < 8; ++idx) {
                    sensor_repo_->start_heater_assignment(idx, profile_rec, std::nullopt, "");
                }
            } else {
                for (auto idx : sensor_indices) {
                    sensor_repo_->start_heater_assignment(
                        static_cast<int16_t>(idx), profile_rec, std::nullopt, "");
                }
            }
        }
    }
    
    spdlog::info("HeaterConfigExecutor: heater configuration complete");
    return ExecuteResult::ok();
}

bool HeaterConfigExecutor::send_config_command(
    const std::vector<int32_t>& temps,
    const std::vector<int32_t>& durs,
    const std::vector<int32_t>& sensor_indices) {
    
    nlohmann::json cmd;
    cmd["cmd"] = "config";
    cmd["id"] = 0;
    cmd["params"]["temps"] = temps;
    cmd["params"]["durs"] = durs;
    
    if (!sensor_indices.empty()) {
        cmd["params"]["sensors"] = sensor_indices;
    }
    
    spdlog::debug("HeaterConfigExecutor: sending config command: {}", cmd.dump());
    
    try {
        sensor_->write(cmd);
        return true;
    } catch (const std::exception& e) {
        spdlog::error("HeaterConfigExecutor: failed to send config command: {}", e.what());
        return false;
    }
}

} // namespace workflows
