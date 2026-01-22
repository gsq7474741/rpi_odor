/**
 * @file    sensor_array.h
 * @brief   传感器阵列抽象接口
 * 
 * 所有传感器实现都需要实现此接口，包括:
 * - BME688Array (数字 MOX)
 * - AnalogSensorArray (模拟 MOX, 通过 SPI ADC)
 */

#ifndef SENSOR_ARRAY_H
#define SENSOR_ARRAY_H

#include "sensor_types.h"

/**
 * @brief 传感器阵列抽象接口
 * 
 * 定义了所有传感器阵列必须实现的基本操作
 */
class ISensorArray {
public:
    virtual ~ISensorArray() = default;
    
    /**
     * @brief 初始化传感器阵列
     * @return SensorError::OK 成功, 其他值表示错误
     */
    virtual SensorError init() = 0;
    
    /**
     * @brief 获取传感器数量
     * @return 传感器数量
     */
    virtual uint8_t getSensorCount() const = 0;
    
    /**
     * @brief 获取传感器类型
     * @return 传感器类型
     */
    virtual SensorType getSensorType() const = 0;
    
    /**
     * @brief 读取指定传感器数据 (非阻塞)
     * @param idx 传感器索引
     * @param out 输出的传感器读数
     * @return true 有新数据, false 无数据或错误
     */
    virtual bool readSensor(uint8_t idx, SensorReading& out) = 0;
    
    /**
     * @brief 获取下一个可读的传感器索引 (调度用)
     * @return 传感器索引, 0xFF 表示暂无可读传感器
     */
    virtual uint8_t getNextReadySensor() = 0;
    
    /**
     * @brief 配置指定传感器
     * @param config 传感器配置
     * @return SensorError::OK 成功
     */
    virtual SensorError configure(const SensorConfig& config) {
        (void)config;
        return SensorError::OK;
    }
    
    /**
     * @brief 检查传感器是否已配置
     * @param idx 传感器索引
     * @return true 已配置
     */
    virtual bool isConfigured(uint8_t idx) const {
        (void)idx;
        return true;
    }
    
    /**
     * @brief 获取传感器唯一ID
     * @param idx 传感器索引
     * @return 传感器ID, 0 表示无效
     */
    virtual uint32_t getSensorId(uint8_t idx) const = 0;
};

#endif // SENSOR_ARRAY_H
