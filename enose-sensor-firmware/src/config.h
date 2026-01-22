/**
 * @file    config.h
 * @brief   编译时配置文件
 * 
 * 通过修改此文件切换不同的传感器类型和配置
 */

#ifndef CONFIG_H
#define CONFIG_H

// ============================================================================
// 传感器类型选择
// ============================================================================
#define SENSOR_TYPE_BME688      1   // BME688 数字 MOX (I2C扩展器+SPI)
#define SENSOR_TYPE_ANALOG      2   // 模拟 MOX (SPI ADC, 如 GM102B)

// 当前使用的传感器类型 (修改此处切换)
#define SENSOR_TYPE             SENSOR_TYPE_BME688

// ============================================================================
// BME688 配置 (仅当 SENSOR_TYPE == SENSOR_TYPE_BME688 时生效)
// ============================================================================
#if SENSOR_TYPE == SENSOR_TYPE_BME688

#define NUM_SENSORS             8       // 传感器数量
#define HAS_TEMPERATURE         1       // 支持温度读取
#define HAS_HUMIDITY            1       // 支持湿度读取
#define HAS_PRESSURE            1       // 支持气压读取

#endif // SENSOR_TYPE_BME688

// ============================================================================
// 模拟传感器配置 (仅当 SENSOR_TYPE == SENSOR_TYPE_ANALOG 时生效)
// ============================================================================
#if SENSOR_TYPE == SENSOR_TYPE_ANALOG

#define NUM_SENSORS             8       // 传感器通道数
#define ADC_TYPE_ADS1256        1       // 24-bit ADC
#define ADC_TYPE_MCP3208        2       // 12-bit ADC

#define ADC_TYPE                ADC_TYPE_ADS1256
#define ADC_CS_PIN              5       // SPI 片选引脚
#define ADC_VREF                3.3f    // 参考电压
#define ADC_SAMPLE_INTERVAL_MS  10      // 采样间隔 (ms)

#define HAS_TEMPERATURE         0       // 模拟传感器无温度
#define HAS_HUMIDITY            0
#define HAS_PRESSURE            0

#endif // SENSOR_TYPE_ANALOG

// ============================================================================
// 通信配置
// ============================================================================
#define SERIAL_BAUDRATE         115200

// 双串口模式：同时监听 USB 和 GPIO 16/17，哪个先收到命令就用哪个
#define DUAL_SERIAL_MODE        1       // 1=启用, 0=仅USB
#define SERIAL2_RX_PIN          16
#define SERIAL2_TX_PIN          17

// ============================================================================
// 固件版本
// ============================================================================
#define FIRMWARE_VERSION        "2.1.0"

#endif // CONFIG_H
