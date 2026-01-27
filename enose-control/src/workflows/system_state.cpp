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
        .pump_0 = PumpState::STOPPED,
        .pump_1 = PumpState::STOPPED,
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        .pump_6 = PumpState::STOPPED,
        .pump_7 = PumpState::STOPPED,
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
        .pump_0 = PumpState::STOPPED,
        .pump_1 = PumpState::STOPPED,
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        .pump_6 = PumpState::STOPPED,
        .pump_7 = PumpState::STOPPED,
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
        .pump_0 = PumpState::STOPPED,
        .pump_1 = PumpState::STOPPED,
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        .pump_6 = PumpState::STOPPED,
        .pump_7 = PumpState::STOPPED,
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
        .pump_0 = PumpState::STOPPED,
        .pump_1 = PumpState::STOPPED,
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        .pump_6 = PumpState::STOPPED,
        .pump_7 = PumpState::STOPPED,
        // 加热器
        .heater_chamber = 0.0f, // 保持
    },
    // INJECT (进样状态): 阀门同CLEAN, 但使用蠕动泵而不是清洗泵
    {
        // 阀门 (同 CLEAN)
        .valve_waste = 0,       // 关闭
        .valve_pinch = 1,       // 液路 (1=液路)
        .valve_air = 0,         // 排气 (0=大气)
        .valve_outlet = 0,      // 开启 (反向逻辑, 0=开)
        // 泵: 不使用清洗泵, 使用蠕动泵 (由 start_inject 单独控制)
        .air_pump_pwm = 0.0f,   // 停止
        .cleaning_pump = 0.0f,  // 停止
        .pump_0 = PumpState::STOPPED,  // 由 start_inject 控制
        .pump_1 = PumpState::STOPPED,
        .pump_2 = PumpState::STOPPED,
        .pump_3 = PumpState::STOPPED,
        .pump_4 = PumpState::STOPPED,
        .pump_5 = PumpState::STOPPED,
        .pump_6 = PumpState::STOPPED,
        .pump_7 = PumpState::STOPPED,
        // 加热器
        .heater_chamber = 0.0f, // 关闭
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

void SystemState::start_inject(const InjectionParams& params) {
    // 先切换到 INJECT 状态 (设置阀门)
    transition_to(State::INJECT);
    
    // 使用 GCODE_AXIS 实现真正的并行运动
    // 1. 注册泵到 A/B/C/D 轴 (宏内部会归零位置)
    actuator_->send_gcode("REGISTER_PUMPS_TO_AXIS");
    
    // 2. 使用单条 G1 命令同时驱动所有泵
    // 速度转换: params.speed (mm/s) -> F (mm/min) = speed * 60
    // 轴映射: A=pump_0, B=pump_1, C=pump_2, D=pump_3, H=pump_4, I=pump_5, J=pump_6, K=pump_7
    // 注意: 跳过E(挤出机专用)/F(feedrate)/G(G-code前缀)
    float feedrate = params.speed * 60.0f;
    
    std::string g1_cmd = std::format("G1 A{:.3f} B{:.3f} C{:.3f} D{:.3f} H{:.3f} I{:.3f} J{:.3f} K{:.3f} F{:.1f}",
        params.pump_0_volume,  // A = pump_0
        params.pump_1_volume,  // B = pump_1
        params.pump_2_volume,  // C = pump_2
        params.pump_3_volume,  // D = pump_3
        params.pump_4_volume,  // H = pump_4
        params.pump_5_volume,  // I = pump_5
        params.pump_6_volume,  // J = pump_6
        params.pump_7_volume,  // K = pump_7
        feedrate);
    
    actuator_->send_gcode(g1_cmd);
    
    // 更新泵状态
    if (params.pump_0_volume > 0) current_peripheral_state_.pump_0 = PumpState::RUNNING;
    if (params.pump_1_volume > 0) current_peripheral_state_.pump_1 = PumpState::RUNNING;
    if (params.pump_2_volume > 0) current_peripheral_state_.pump_2 = PumpState::RUNNING;
    if (params.pump_3_volume > 0) current_peripheral_state_.pump_3 = PumpState::RUNNING;
    if (params.pump_4_volume > 0) current_peripheral_state_.pump_4 = PumpState::RUNNING;
    if (params.pump_5_volume > 0) current_peripheral_state_.pump_5 = PumpState::RUNNING;
    if (params.pump_6_volume > 0) current_peripheral_state_.pump_6 = PumpState::RUNNING;
    if (params.pump_7_volume > 0) current_peripheral_state_.pump_7 = PumpState::RUNNING;
    
    spdlog::info("SystemState: Parallel inject G1 A{:.3f} B{:.3f} C{:.3f} D{:.3f} H{:.3f} I{:.3f} J{:.3f} K{:.3f} F{:.1f}",
        params.pump_0_volume, params.pump_1_volume,
        params.pump_2_volume, params.pump_3_volume, 
        params.pump_4_volume, params.pump_5_volume,
        params.pump_6_volume, params.pump_7_volume, feedrate);
}

void SystemState::stop_inject() {
    // 使用 Klipper 插件的异步停止命令
    // ENOSE_ASYNC_STOP 会:
    // 1. 通过 reactor 回调立即执行（绕过 G-code 队列）
    // 2. 重置 motion_queuing 时间变量阻止后续步进生成
    // 3. 清空 trapq 并取消 GCODE_AXIS 注册
    // 4. 禁用电机
    // 延迟约 ~1 秒（已发送到 MCU 的步进会执行完）
    actuator_->send_gcode("ENOSE_ASYNC_STOP");
    
    spdlog::info("SystemState: ENOSE_ASYNC_STOP sent, pumps will stop in ~1s");
    
    current_peripheral_state_.pump_0 = PumpState::STOPPED;
    current_peripheral_state_.pump_1 = PumpState::STOPPED;
    current_peripheral_state_.pump_2 = PumpState::STOPPED;
    current_peripheral_state_.pump_3 = PumpState::STOPPED;
    current_peripheral_state_.pump_4 = PumpState::STOPPED;
    current_peripheral_state_.pump_5 = PumpState::STOPPED;
    current_peripheral_state_.pump_6 = PumpState::STOPPED;
    current_peripheral_state_.pump_7 = PumpState::STOPPED;
    
    transition_to(State::INITIAL);
}

bool SystemState::is_any_pump_running() const {
    return current_peripheral_state_.pump_0 == PumpState::RUNNING ||
           current_peripheral_state_.pump_1 == PumpState::RUNNING ||
           current_peripheral_state_.pump_2 == PumpState::RUNNING ||
           current_peripheral_state_.pump_3 == PumpState::RUNNING ||
           current_peripheral_state_.pump_4 == PumpState::RUNNING ||
           current_peripheral_state_.pump_5 == PumpState::RUNNING ||
           current_peripheral_state_.pump_6 == PumpState::RUNNING ||
           current_peripheral_state_.pump_7 == PumpState::RUNNING;
}

void SystemState::transition_to(State target_state) {
    if (current_state_ == target_state) {
        spdlog::debug("SystemState: Already in state {}", state_to_string(target_state));
        return;
    }

    // 如果有泵正在运行，先停止（自动停止策略）
    if (is_any_pump_running()) {
        spdlog::info("SystemState: Pumps running, auto-stopping before state transition");
        // 发送异步停止命令
        actuator_->send_gcode("ENOSE_ASYNC_STOP");
        // 更新泵状态
        current_peripheral_state_.pump_0 = PumpState::STOPPED;
        current_peripheral_state_.pump_1 = PumpState::STOPPED;
        current_peripheral_state_.pump_2 = PumpState::STOPPED;
        current_peripheral_state_.pump_3 = PumpState::STOPPED;
        current_peripheral_state_.pump_4 = PumpState::STOPPED;
        current_peripheral_state_.pump_5 = PumpState::STOPPED;
        current_peripheral_state_.pump_6 = PumpState::STOPPED;
        current_peripheral_state_.pump_7 = PumpState::STOPPED;
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
        // 风扇与夹管阀联动：夹管阀通电(1)时风扇转，断电(0)时风扇停
        actuator_->send_gcode(std::format("SET_PIN PIN=inject_fan VALUE={}", state.valve_pinch));
        actuator_->send_gcode(std::format("SET_PIN PIN=inject_fan_2 VALUE={}", state.valve_pinch));
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
    if (state.pump_0 == PumpState::STOPPED && current_peripheral_state_.pump_0 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_0 ENABLE=0");
    }
    if (state.pump_1 == PumpState::STOPPED && current_peripheral_state_.pump_1 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_1 ENABLE=0");
    }
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
    if (state.pump_6 == PumpState::STOPPED && current_peripheral_state_.pump_6 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_6 ENABLE=0");
    }
    if (state.pump_7 == PumpState::STOPPED && current_peripheral_state_.pump_7 == PumpState::RUNNING) {
        actuator_->send_gcode("MANUAL_STEPPER STEPPER=pump_7 ENABLE=0");
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
        case State::INJECT:  return "INJECT";
        default:             return "UNKNOWN";
    }
}

} // namespace workflows
