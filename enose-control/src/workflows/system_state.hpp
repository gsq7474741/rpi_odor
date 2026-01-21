#pragma once

#include <memory>
#include <functional>
#include <string>
#include <array>

namespace hal {
class ActuatorDriver;
}

namespace workflows {

/**
 * @brief 泵运行状态
 */
enum class PumpState {
    STOPPED,    // 停止
    RUNNING,    // 运行中
};

/**
 * @brief 外设状态结构体
 * 
 * 包含所有可控外设的状态，对应 HARDWARE_CONNECTIONS.md
 */
struct PeripheralState {
    // === 阀门 (Valves) ===
    float valve_waste;      // 0: 关闭, 1: 开启 (PA2)
    float valve_pinch;      // 0: 液路, 1: 气路 (PA3)
    float valve_air;        // 0: 排气, 1: 气室 (PB10)
    float valve_outlet;     // 0: 开启, 1: 关闭 (PB11, 反向逻辑)
    
    // === 泵 (Pumps) ===
    float air_pump_pwm;     // 0.0 - 1.0 气泵 PWM (PB6)
    float cleaning_pump;    // 0.0 - 1.0 清洗泵 (PA8/FAN0)
    PumpState pump_2;       // 样品泵 0 (MOTOR2, 步进)
    PumpState pump_3;       // 样品泵 1 (MOTOR3, 步进)
    PumpState pump_4;       // 样品泵 2 (MOTOR4, 步进)
    PumpState pump_5;       // 样品泵 3 (MOTOR5, 步进)
    
    // === 加热器 (Heater) ===
    float heater_chamber;   // 0.0 - 1.0 气室加热带 (PA1/BED_OUT)
    
    // === 传感器 (只读, 不在状态表中控制) ===
    // sensor_chamber (PF4) - 气室温度
    // scale (PG6/PG9)      - HX711 称重模块
    
    bool operator==(const PeripheralState& other) const {
        return valve_waste == other.valve_waste &&
               valve_pinch == other.valve_pinch &&
               valve_air == other.valve_air &&
               valve_outlet == other.valve_outlet &&
               air_pump_pwm == other.air_pump_pwm &&
               cleaning_pump == other.cleaning_pump &&
               pump_2 == other.pump_2 &&
               pump_3 == other.pump_3 &&
               pump_4 == other.pump_4 &&
               pump_5 == other.pump_5 &&
               heater_chamber == other.heater_chamber;
    }
};

/**
 * @brief 系统全局状态机
 * 
 * 管理所有外设的状态，提供状态切换接口
 */
class SystemState {
public:
    enum class State {
        INITIAL,    ///< 开机初始状态
        DRAIN,      ///< 排废状态
        CLEAN,      ///< 清洗状态
        SAMPLE,     ///< 采样状态
        INJECT,     ///< 进样状态 (阀门同CLEAN，使用蠕动泵进样)
    };

    /**
     * @brief 进样参数结构体
     * 
     * 指定每个蠕动泵的进样量 (单位待标定，目前为步进电机步数)
     */
    struct InjectionParams {
        float pump_2_volume = 0;  // 蠕动泵0 进样量
        float pump_3_volume = 0;  // 蠕动泵1 进样量
        float pump_4_volume = 0;  // 蠕动泵2 进样量
        float pump_5_volume = 0;  // 蠕动泵3 进样量
        float speed = 10.0f;      // 进样速度 (mm/s)
        float accel = 100.0f;     // 加速度 (mm/s²)
    };

    using StateCallback = std::function<void(State, State)>;  // (old_state, new_state)

    explicit SystemState(std::shared_ptr<hal::ActuatorDriver> actuator);
    ~SystemState() = default;

    /**
     * @brief 切换到排废状态
     */
    void start_drain();

    /**
     * @brief 停止排废，返回初始状态
     */
    void stop_drain();

    /**
     * @brief 切换到清洗状态
     */
    void start_clean();

    /**
     * @brief 停止清洗，返回初始状态
     */
    void stop_clean();

    /**
     * @brief 开始进样
     * @param params 进样参数 (每个泵的进样量)
     */
    void start_inject(const InjectionParams& params);

    /**
     * @brief 停止进样，返回初始状态
     */
    void stop_inject();

    /**
     * @brief 强制切换到指定状态
     */
    void transition_to(State target_state);

    /**
     * @brief 获取当前状态
     */
    State get_state() const { return current_state_; }

    /**
     * @brief 获取当前外设状态快照
     */
    const PeripheralState& get_peripheral_state() const { return current_peripheral_state_; }

    /**
     * @brief 获取指定系统状态对应的外设状态
     */
    static const PeripheralState& get_state_definition(State state);

    /**
     * @brief 状态名称
     */
    static const char* state_to_string(State state);

    /**
     * @brief 设置状态变化回调
     */
    void set_state_callback(StateCallback callback) { state_callback_ = std::move(callback); }

private:
    void apply_peripheral_state(const PeripheralState& state);

    std::shared_ptr<hal::ActuatorDriver> actuator_;
    State current_state_{State::INITIAL};
    PeripheralState current_peripheral_state_;
    StateCallback state_callback_;

    // 状态定义表
    static const PeripheralState STATE_DEFINITIONS[];
};

} // namespace workflows
