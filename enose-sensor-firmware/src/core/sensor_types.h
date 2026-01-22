/**
 * @file    sensor_types.h
 * @brief   传感器类型无关的数据结构定义
 * 
 * 支持多种传感器类型:
 * - MOX_DIGITAL: BME688 等数字 MOX 传感器 (I2C/SPI)
 * - MOX_ANALOG: GM102B 等模拟 MOX 传感器 (通过 ADC)
 * - PID: PID 传感器
 */

#ifndef SENSOR_TYPES_H
#define SENSOR_TYPES_H

#include <Arduino.h>
#include <cmath>

/**
 * @brief 传感器类型枚举
 */
enum class SensorType : uint8_t {
    MOX_DIGITAL = 0,    // BME688 等数字 MOX (I2C转SPI)
    MOX_ANALOG  = 1,    // GM102B 等模拟 MOX (SPI ADC)
    PID         = 2,    // PID 传感器
    UNKNOWN     = 0xFF
};

/**
 * @brief 通用传感器读数结构
 * 
 * 所有传感器类型统一使用此结构上报数据
 */
struct SensorReading {
    uint32_t tick_ms;           // 设备时间戳 (ms)
    uint8_t  sensor_idx;        // 传感器索引
    uint32_t sensor_id;         // 传感器唯一ID
    
    // 主读数
    float    primary_value;     // MOX: 电阻(Ω), Analog: 电压(V), PID: ppb
    
    // 可选环境数据 (NAN 表示无效/不支持)
    float    temperature;       // °C
    float    humidity;          // %RH
    float    pressure;          // hPa
    
    // 元数据
    uint8_t  heater_step;       // 加热器步骤索引 (仅 MOX_DIGITAL, 0-9)
    uint8_t  adc_channel;       // ADC 通道 (仅 MOX_ANALOG)
    SensorType type;            // 传感器类型
    
    // 默认构造函数
    SensorReading() 
        : tick_ms(0)
        , sensor_idx(0)
        , sensor_id(0)
        , primary_value(0.0f)
        , temperature(NAN)
        , humidity(NAN)
        , pressure(NAN)
        , heater_step(0)
        , adc_channel(0)
        , type(SensorType::UNKNOWN)
    {}
    
    // 便捷方法: 检查是否有有效的环境数据
    bool hasTemperature() const { return !isnan(temperature); }
    bool hasHumidity() const { return !isnan(humidity); }
    bool hasPressure() const { return !isnan(pressure); }
};

/**
 * @brief 传感器配置结构 (用于动态配置)
 */
struct SensorConfig {
    // 通用配置
    uint8_t sensor_idx;
    
    // MOX_DIGITAL 专用: 加热器配置
    uint16_t heater_temps[10];      // 温度数组 (°C)
    uint16_t heater_durations[10];  // 持续时间数组 (ms 因子)
    uint8_t  heater_length;         // 加热器步骤数量 (1-10)
    
    // MOX_ANALOG 专用: ADC 配置
    float    adc_vref;              // 参考电压 (V)
    uint16_t adc_sample_rate;       // 采样率 (SPS)
    uint8_t  adc_gain;              // 增益设置
    
    SensorConfig() 
        : sensor_idx(0)
        , heater_length(10)
        , adc_vref(3.3f)
        , adc_sample_rate(100)
        , adc_gain(1)
    {
        // 默认加热器配置 (来自 BME688 开发套件)
        uint16_t default_temps[10] = {320, 100, 100, 100, 200, 200, 200, 320, 320, 320};
        uint16_t default_durs[10]  = {5, 2, 10, 30, 5, 5, 5, 5, 5, 5};
        memcpy(heater_temps, default_temps, sizeof(heater_temps));
        memcpy(heater_durations, default_durs, sizeof(heater_durations));
    }
};

/**
 * @brief 传感器错误码
 */
enum class SensorError : int8_t {
    OK                  = 0,
    NOT_INITIALIZED     = -1,
    INVALID_INDEX       = -2,
    COMMUNICATION_ERROR = -3,
    CONFIG_ERROR        = -4,
    TIMEOUT             = -5,
    NO_DATA             = -6,
    DRIVER_ERROR        = -10
};

#endif // SENSOR_TYPES_H
