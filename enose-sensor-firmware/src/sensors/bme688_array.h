/**
 * @file    bme688_array.h
 * @brief   BME688 传感器阵列实现
 * 
 * 基于 Bosch BME688 开发套件，通过 I2C 扩展器 + SPI 通信
 * 支持 8 通道 MOX 气体传感器
 */

#ifndef BME688_ARRAY_H
#define BME688_ARRAY_H

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <bme68xLibrary.h>
#include "../core/sensor_array.h"
#include "../commMux.h"

// BME688 配置常量
#define BME688_NUM_SENSORS      8
#define BME688_HEATER_TIME_BASE 140
#define BME688_GAS_WAIT_SHARED  UINT8_C(140)

/**
 * @brief BME688 传感器阵列实现
 * 
 * 实现 ISensorArray 接口，管理 8 个 BME688 传感器
 */
class BME688Array : public ISensorArray {
public:
    BME688Array();
    
    // ISensorArray 接口实现
    SensorError init() override;
    uint8_t getSensorCount() const override { return BME688_NUM_SENSORS; }
    SensorType getSensorType() const override { return SensorType::MOX_DIGITAL; }
    bool readSensor(uint8_t idx, SensorReading& out) override;
    uint8_t getNextReadySensor() override;
    SensorError configure(const SensorConfig& config) override;
    bool isConfigured(uint8_t idx) const override;
    uint32_t getSensorId(uint8_t idx) const override;

private:
    // BME68x 驱动实例
    Bme68x _sensors[BME688_NUM_SENSORS];
    
    // 通信设置
    commMux _commSetup[BME688_NUM_SENSORS];
    
    // 传感器状态
    struct SensorState {
        uint32_t id;
        uint64_t wakeUpTime;
        uint8_t  nextGasIndex;
        uint8_t  mode;
        bool     configured;
        
        // 加热器配置
        uint16_t heaterTemps[10];
        uint16_t heaterDurations[10];
        uint8_t  heaterLength;
    };
    SensorState _state[BME688_NUM_SENSORS];
    
    // 临时数据缓冲
    bme68x_data _fieldData[3];
    
    // 私有方法
    int8_t initializeSensor(uint8_t idx);
    int8_t configureSensorHeater(uint8_t idx);
    bool selectNextSensor(uint64_t& wakeUpTime, uint8_t& idx, uint8_t mode);
    
    // 默认加热器配置
    void setDefaultHeaterProfile(uint8_t idx);
};

#endif // BME688_ARRAY_H
