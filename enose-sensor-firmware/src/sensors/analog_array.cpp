/**
 * @file    analog_array.cpp
 * @brief   模拟传感器阵列实现
 */

#include "analog_array.h"

// ADS1256 寄存器和命令
#define ADS1256_CMD_RDATA   0x01
#define ADS1256_CMD_WREG    0x50
#define ADS1256_REG_MUX     0x01
#define ADS1256_SPI_SPEED   1000000

// MCP3208 命令
#define MCP3208_START_BIT   0x04
#define MCP3208_SINGLE_END  0x02
#define MCP3208_SPI_SPEED   1000000

AnalogSensorArray::AnalogSensorArray(AdcType type, uint8_t csPin, uint8_t channelCount)
    : _adcType(type)
    , _csPin(csPin)
    , _channelCount(min(channelCount, (uint8_t)8))
    , _vref(3.3f)
    , _sampleIntervalMs(10)
    , _nextChannel(0)
    , _initialized(false)
{
    for (uint8_t i = 0; i < 8; i++) {
        _channels[i].lastReadTime = 0;
        _channels[i].lastValue = 0.0f;
        _channels[i].ready = false;
    }
}

SensorError AnalogSensorArray::init() {
    pinMode(_csPin, OUTPUT);
    digitalWrite(_csPin, HIGH);
    
    SPI.begin();
    
    // ADC 特定初始化
    switch (_adcType) {
        case AdcType::ADS1256:
            // ADS1256 初始化: 设置数据速率等
            // 简化实现，实际可能需要更多配置
            break;
            
        case AdcType::MCP3208:
            // MCP3208 无需特殊初始化
            break;
    }
    
    _initialized = true;
    return SensorError::OK;
}

void AnalogSensorArray::spiBeginTransaction() {
    uint32_t speed = (_adcType == AdcType::ADS1256) ? ADS1256_SPI_SPEED : MCP3208_SPI_SPEED;
    SPI.beginTransaction(SPISettings(speed, MSBFIRST, SPI_MODE1));
    digitalWrite(_csPin, LOW);
}

void AnalogSensorArray::spiEndTransaction() {
    digitalWrite(_csPin, HIGH);
    SPI.endTransaction();
}

uint8_t AnalogSensorArray::spiTransfer(uint8_t data) {
    return SPI.transfer(data);
}

float AnalogSensorArray::readAds1256(uint8_t channel) {
    spiBeginTransaction();
    
    // 设置 MUX 寄存器选择通道 (单端模式: channel vs AINCOM)
    spiTransfer(ADS1256_CMD_WREG | ADS1256_REG_MUX);
    spiTransfer(0x00);  // 写入 1 个寄存器
    spiTransfer((channel << 4) | 0x08);  // AINx vs AINCOM
    
    delayMicroseconds(10);
    
    // 读取数据
    spiTransfer(ADS1256_CMD_RDATA);
    delayMicroseconds(10);
    
    uint32_t raw = 0;
    raw |= ((uint32_t)spiTransfer(0xFF) << 16);
    raw |= ((uint32_t)spiTransfer(0xFF) << 8);
    raw |= spiTransfer(0xFF);
    
    spiEndTransaction();
    
    // 转换为电压 (24-bit 有符号)
    if (raw & 0x800000) {
        raw |= 0xFF000000;  // 符号扩展
    }
    int32_t signedRaw = (int32_t)raw;
    float voltage = (signedRaw / 8388607.0f) * _vref;  // 2^23 - 1
    
    return voltage;
}

float AnalogSensorArray::readMcp3208(uint8_t channel) {
    spiBeginTransaction();
    
    // MCP3208 命令格式: 0000 01SC CC00 0000 0000
    // S = 1 (单端), C = 通道号
    uint8_t cmd1 = MCP3208_START_BIT | MCP3208_SINGLE_END | ((channel >> 2) & 0x01);
    uint8_t cmd2 = (channel & 0x03) << 6;
    
    spiTransfer(cmd1);
    uint8_t b1 = spiTransfer(cmd2);
    uint8_t b2 = spiTransfer(0x00);
    
    spiEndTransaction();
    
    // 12-bit 结果
    uint16_t raw = ((b1 & 0x0F) << 8) | b2;
    float voltage = (raw / 4095.0f) * _vref;
    
    return voltage;
}

float AnalogSensorArray::readAdcChannel(uint8_t channel) {
    switch (_adcType) {
        case AdcType::ADS1256:
            return readAds1256(channel);
        case AdcType::MCP3208:
            return readMcp3208(channel);
        default:
            return 0.0f;
    }
}

uint8_t AnalogSensorArray::getNextReadySensor() {
    if (!_initialized) return 0xFF;
    
    uint32_t now = millis();
    
    // 轮询找下一个可读通道
    for (uint8_t i = 0; i < _channelCount; i++) {
        uint8_t ch = (_nextChannel + i) % _channelCount;
        if ((now - _channels[ch].lastReadTime) >= _sampleIntervalMs) {
            _nextChannel = (ch + 1) % _channelCount;
            return ch;
        }
    }
    
    return 0xFF;
}

bool AnalogSensorArray::readSensor(uint8_t idx, SensorReading& out) {
    if (!_initialized || idx >= _channelCount) {
        return false;
    }
    
    uint32_t now = millis();
    
    // 读取 ADC
    float voltage = readAdcChannel(idx);
    
    // 填充输出
    out.tick_ms = now;
    out.sensor_idx = idx;
    out.sensor_id = idx + 1;  // 简单 ID
    out.primary_value = voltage;
    out.temperature = NAN;    // 模拟传感器无温度
    out.humidity = NAN;
    out.pressure = NAN;
    out.heater_step = 0;
    out.adc_channel = idx;
    out.type = SensorType::MOX_ANALOG;
    
    // 更新状态
    _channels[idx].lastReadTime = now;
    _channels[idx].lastValue = voltage;
    _channels[idx].ready = true;
    
    return true;
}

SensorError AnalogSensorArray::configure(const SensorConfig& config) {
    _vref = config.adc_vref;
    // 可扩展更多配置
    return SensorError::OK;
}

uint32_t AnalogSensorArray::getSensorId(uint8_t idx) const {
    if (idx >= _channelCount) return 0;
    return idx + 1;  // 简单 ID
}
