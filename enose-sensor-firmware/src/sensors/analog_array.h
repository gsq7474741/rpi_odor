/**
 * @file    analog_array.h
 * @brief   模拟传感器阵列实现 (通过 SPI ADC)
 * 
 * 支持多种 ADC 芯片:
 * - ADS1256: 24-bit, 8通道
 * - MCP3208: 12-bit, 8通道
 */

#ifndef ANALOG_ARRAY_H
#define ANALOG_ARRAY_H

#include <Arduino.h>
#include <SPI.h>
#include "../core/sensor_array.h"

/**
 * @brief 支持的 ADC 芯片类型
 */
enum class AdcType : uint8_t {
    ADS1256 = 0,    // 24-bit, 8通道, SPI
    MCP3208 = 1,    // 12-bit, 8通道, SPI
};

/**
 * @brief 模拟传感器阵列实现
 * 
 * 用于 GM102B 等模拟 MOX 传感器，通过 SPI ADC 读取
 */
class AnalogSensorArray : public ISensorArray {
public:
    /**
     * @brief 构造函数
     * @param type ADC 芯片类型
     * @param csPin SPI 片选引脚
     * @param channelCount 通道数量 (1-8)
     */
    AnalogSensorArray(AdcType type, uint8_t csPin, uint8_t channelCount);
    
    // ISensorArray 接口实现
    SensorError init() override;
    uint8_t getSensorCount() const override { return _channelCount; }
    SensorType getSensorType() const override { return SensorType::MOX_ANALOG; }
    bool readSensor(uint8_t idx, SensorReading& out) override;
    uint8_t getNextReadySensor() override;
    SensorError configure(const SensorConfig& config) override;
    uint32_t getSensorId(uint8_t idx) const override;
    
    // 模拟传感器特有配置
    void setReferenceVoltage(float vref) { _vref = vref; }
    void setSampleInterval(uint32_t intervalMs) { _sampleIntervalMs = intervalMs; }
    
private:
    AdcType _adcType;
    uint8_t _csPin;
    uint8_t _channelCount;
    float _vref;
    uint32_t _sampleIntervalMs;
    
    // 每通道状态
    struct ChannelState {
        uint32_t lastReadTime;
        float lastValue;
        bool ready;
    };
    ChannelState _channels[8];
    
    uint8_t _nextChannel;
    bool _initialized;
    
    // ADC 读取实现
    float readAds1256(uint8_t channel);
    float readMcp3208(uint8_t channel);
    float readAdcChannel(uint8_t channel);
    
    // SPI 通信
    void spiBeginTransaction();
    void spiEndTransaction();
    uint8_t spiTransfer(uint8_t data);
};

#endif // ANALOG_ARRAY_H
