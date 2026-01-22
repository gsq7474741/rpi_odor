/**
 * @file    data_reporter.cpp
 * @brief   数据上报器实现
 */

#include "data_reporter.h"

DataReporter::DataReporter() 
    : _serial(nullptr), _serial2(nullptr), _activeSerial(nullptr) {}

void DataReporter::begin(Stream& primary, Stream* secondary) {
    _serial = &primary;
    _serial2 = secondary;
    _activeSerial = _serial;  // 默认使用主串口
}

void DataReporter::report(const SensorReading& reading) {
    if (!_activeSerial) return;
    
    StaticJsonDocument<256> doc;
    doc["type"] = "data";
    doc["tick"] = reading.tick_ms;
    doc["s"] = reading.sensor_idx;
    doc["id"] = reading.sensor_id;
    doc["v"] = serialized(String(reading.primary_value, 1));
    
    // 传感器类型标识
    switch (reading.type) {
        case SensorType::MOX_DIGITAL:
            doc["st"] = "mox_d";
            doc["gi"] = reading.heater_step;
            break;
        case SensorType::MOX_ANALOG:
            doc["st"] = "mox_a";
            doc["ch"] = reading.adc_channel;
            break;
        case SensorType::PID:
            doc["st"] = "pid";
            break;
        default:
            doc["st"] = "unknown";
            break;
    }
    
    // 可选环境数据 (仅当有效时输出)
    if (reading.hasTemperature()) {
        doc["T"] = serialized(String(reading.temperature, 2));
    }
    if (reading.hasHumidity()) {
        doc["H"] = serialized(String(reading.humidity, 2));
    }
    if (reading.hasPressure()) {
        doc["P"] = serialized(String(reading.pressure, 2));
    }
    
    serializeJson(doc, *_activeSerial);
    _activeSerial->println();
}

void DataReporter::sendReady(const char* version, uint8_t sensorCount) {
    // 发送就绪消息到所有可用串口
    StaticJsonDocument<128> doc;
    doc["type"] = "ready";
    doc["version"] = version;
    doc["sensors"] = sensorCount;
    
    if (_serial) {
        serializeJson(doc, *_serial);
        _serial->println();
    }
    if (_serial2) {
        serializeJson(doc, *_serial2);
        _serial2->println();
    }
}
