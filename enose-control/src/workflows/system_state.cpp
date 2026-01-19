#include "workflows/system_state.hpp"
#include "hal/actuator_driver.hpp"
#include <spdlog/spdlog.h>
#include <format>
#include <thread>
#include <chrono>

namespace workflows {

// 状态定义表 - 索引对应 State 枚举值
const PeripheralState SystemState::STATE_DEFINITIONS[] = {
    // INITIAL (开机初始状态)
    {
        // 阀门
        .valve_waste = 0,       // 关闭
        .valve_pinch = 0,       // 气路
        .valve_air = 0,         // 排气
        .valve_outlet = 0,      // 开启 (反向逻辑)
        // 泵
        .air_pump_pwm = 0.0f,   // 停止
        .cleaning_pump = 0.0f,  // 停止
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        // 加热器
        .heater_chamber = 0.0f, // 关闭
    },
    // DRAIN (排废状态)
    {
        // 阀门
        .valve_waste = 1,       // 开启
        .valve_pinch = 0,       // 气路
        .valve_air = 0,         // 排气
        .valve_outlet = 1,      // 关闭 (反向逻辑)
        // 泵
        .air_pump_pwm = 1.0f,   // 100%
        .cleaning_pump = 0.0f,  // 停止
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        // 加热器
        .heater_chamber = 0.0f, // 保持 (排废时不改变加热状态)
    },
    // CLEAN (清洗状态): 出气阀开, 气体三通阀指向大气, 清洗泵开, 夹管阀液路, 排废阀门关
    {
        // 阀门
        .valve_waste = 0,       // 关闭
        .valve_pinch = 1,       // 液路 (1=液路, 0=气路)
        .valve_air = 0,         // 排气 (0=大气)
        .valve_outlet = 0,      // 开启 (反向逻辑, 0=开)
        // 泵
        .air_pump_pwm = 0.0f,   // 停止
        .cleaning_pump = 1.0f,  // 100%
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        // 加热器
        .heater_chamber = 0.0f, // 关闭
    },
    // SAMPLE (采样状态): 排废关, 夹管阀气路, 出气阀开, 三通阀指向气室, 气泵开
    {
        // 阀门
        .valve_waste = 0,       // 关闭
        .valve_pinch = 0,       // 气路 (0=气路)
        .valve_air = 1,         // 气室 (1=气室)
        .valve_outlet = 0,      // 开启 (反向逻辑, 0=开)
        // 泵
        .air_pump_pwm = 1.0f,   // 100%
        .cleaning_pump = 0.0f,  // 停止
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        // 加热器
        .heater_chamber = 0.0f, // 保持
    },
};

SystemState::SystemState(std::shared_ptr<hal::ActuatorDriver> actuator)
    : actuator_(std::move(actuator))
    , current_peripheral_state_(STATE_DEFINITIONS[static_cast<int>(State::INITIAL)]) {}

void SystemState::start_drain() {
    transition_to(State::DRAIN);
}

void SystemState::stop_drain() {
    transition_to(State::INITIAL);
}

void SystemState::start_clean() {
    transition_to(State::CLEAN);
}

void SystemState::stop_clean() {
    transition_to(State::INITIAL);
}

void SystemState::transition_to(State target_state) {
    if (current_state_ == target_state) {
        spdlog::debug("SystemState: Already in state {}", state_to_string(target_state));
        return;
    }

    State old_state = current_state_;
    current_state_ = target_state;

    spdlog::info("SystemState: {} -> {}", 
                 state_to_string(old_state), 
                 state_to_string(target_state));

    // 应用新状态对应的外设配置
    const auto& new_peripheral_state = STATE_DEFINITIONS[static_cast<int>(target_state)];
    apply_peripheral_state(new_peripheral_state);

    if (state_callback_) {
        state_callback_(old_state, target_state);
    }
}

void SystemState::apply_peripheral_state(const PeripheralState& state) {
    if (!actuator_) {
        spdlog::error("SystemState: No actuator driver available");
        return;
    }

    // 只发送有变化的命令，减少通信开销
    if (state.valve_outlet != current_peripheral_state_.valve_outlet) {
        actuator_->send_gcode(std::format("SET_PIN PIN=valve_outlet VALUE={}", state.valve_outlet));
    }
    
    if (state.valve_pinch != current_peripheral_state_.valve_pinch) {
        actuator_->send_gcode(std::format("SET_PIN PIN=valve_pinch VALUE={}", state.valve_pinch));
    }
    
    if (state.valve_waste != current_peripheral_state_.valve_waste) {
        actuator_->send_gcode(std::format("SET_PIN PIN=valve_waste VALUE={}", state.valve_waste));
    }
    
    if (state.valve_air != current_peripheral_state_.valve_air) {
        actuator_->send_gcode(std::format("SET_PIN PIN=valve_air VALUE={}", state.valve_air));
    }
    
    if (state.air_pump_pwm != current_peripheral_state_.air_pump_pwm) {
        actuator_->send_gcode(std::format("SET_PIN PIN=air_pump_pwm VALUE={}", state.air_pump_pwm));
    }
    
    if (state.cleaning_pump != current_peripheral_state_.cleaning_pump) {
        // 清洗泵软启动：1秒内从当前值渐变到目标值，避免启动震动
        float start_val = current_peripheral_state_.cleaning_pump;
        float end_val = state.cleaning_pump;
        if (end_val > start_val) {
            // 启动：渐进增加 (10步，每步100ms，共1秒)
            constexpr int steps = 10;
            constexpr int step_delay_ms = 100;
            float step_val = (end_val - start_val) / steps;
            for (int i = 1; i <= steps; ++i) {
                float val = start_val + step_val * i;
                actuator_->send_gcode(std::format("SET_PIN PIN=cleaning_pump VALUE={:.2f}", val));
                std::this_thread::sleep_for(std::chrono::milliseconds(step_delay_ms));
            }
            spdlog::info("SystemState: Cleaning pump soft-started to {:.0f}%", end_val * 100);
        } else {
            // 停止：直接关闭
            actuator_->send_gcode(std::format("SET_PIN PIN=cleaning_pump VALUE={}", state.cleaning_pump));
        }
    }
    
    // 步进泵控制 (只处理停止命令，运行需要单独调用)
    if (state.pump_2 == PumpState::STOPPED && current_peripheral_state_.pump_2 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_2 ENABLE=0");
    }
    if (state.pump_3 == PumpState::STOPPED && current_peripheral_state_.pump_3 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_3 ENABLE=0");
    }
    if (state.pump_4 == PumpState::STOPPED && current_peripheral_state_.pump_4 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_4 ENABLE=0");
    }
    if (state.pump_5 == PumpState::STOPPED && current_peripheral_state_.pump_5 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_5 ENABLE=0");
    }
    
    // 加热器控制 (通过 Klipper heater_generic)
    // 注: heater_chamber 在 printer.cfg 中被注释，待启用后取消注释
    // if (state.heater_chamber != current_peripheral_state_.heater_chamber) {
    //     actuator_->send_gcode(std::format("SET_HEATER_TEMPERATURE HEATER=heater_chamber TARGET={}", state.heater_chamber * 100));
    // }

    current_peripheral_state_ = state;
}

const PeripheralState& SystemState::get_state_definition(State state) {
    return STATE_DEFINITIONS[static_cast<int>(state)];
}

const char* SystemState::state_to_string(State state) {
    switch (state) {
        case State::INITIAL: return "INITIAL";
        case State::DRAIN:   return "DRAIN";
        case State::CLEAN:   return "CLEAN";
        case State::SAMPLE:  return "SAMPLE";
        default:             return "UNKNOWN";
    }
}

} // namespace workflows
