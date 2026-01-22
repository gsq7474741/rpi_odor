/**
 * @file    data_reporter.h
 * @brief   数据上报器 - 将传感器数据以JSON格式上报给树莓派
 */

#ifndef DATA_REPORTER_H
#define DATA_REPORTER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "core/sensor_types.h"

class DataReporter {
public:
    DataReporter();
    
    void begin(Stream& primary, Stream* secondary = nullptr);
    
    /**
     * @brief 设置活跃的输出串口
     */
    void setActiveSerial(Stream* serial) { 
        if (serial) _activeSerial = serial; 
    }
    
    /**
     * @brief 上报传感器数据 (使用统一的 SensorReading)
     * @param reading 传感器读数
     */
    void report(const SensorReading& reading);
    
    /**
     * @brief 发送就绪消息到所有串口
     * @param version 固件版本
     * @param sensorCount 传感器数量
     */
    void sendReady(const char* version, uint8_t sensorCount);
    
private:
    Stream* _serial;        // 主串口
    Stream* _serial2;       // 备用串口
    Stream* _activeSerial;  // 当前活跃串口
};

#endif
