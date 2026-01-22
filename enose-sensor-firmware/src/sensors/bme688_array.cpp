/**
 * @file    bme688_array.cpp
 * @brief   BME688 传感器阵列实现
 */

#include "bme688_array.h"
#include "../utils.h"

BME688Array::BME688Array() {
    for (uint8_t i = 0; i < BME688_NUM_SENSORS; i++) {
        _state[i].id = 0;
        _state[i].wakeUpTime = 0;
        _state[i].nextGasIndex = 0;
        _state[i].mode = BME68X_SLEEP_MODE;
        _state[i].configured = false;
        _state[i].heaterLength = 10;
    }
}

SensorError BME688Array::init() {
    // 初始化 I2C 和 SPI 通信
    commMuxBegin(Wire, SPI);
    
    for (uint8_t i = 0; i < BME688_NUM_SENSORS; i++) {
        // 配置通信多路复用
        _commSetup[i] = commMuxSetConfig(Wire, SPI, i, _commSetup[i]);
        
        // 初始化传感器
        int8_t rslt = initializeSensor(i);
        if (rslt != BME68X_OK) {
            return SensorError::DRIVER_ERROR;
        }
        
        // 设置默认加热器配置
        setDefaultHeaterProfile(i);
        
        // 配置传感器
        rslt = configureSensorHeater(i);
        if (rslt != BME68X_OK) {
            return SensorError::CONFIG_ERROR;
        }
        
        _state[i].configured = true;
    }
    
    return SensorError::OK;
}

int8_t BME688Array::initializeSensor(uint8_t idx) {
    _sensors[idx].begin(BME68X_SPI_INTF, commMuxRead, commMuxWrite, 
                        commMuxDelay, &_commSetup[idx]);
    int8_t rslt = _sensors[idx].status;
    
    if (rslt == BME68X_OK) {
        _state[idx].id = _sensors[idx].getUniqueId();
    }
    
    return rslt;
}

void BME688Array::setDefaultHeaterProfile(uint8_t idx) {
    // 默认加热器配置 (来自 BME688 开发套件)
    uint16_t defaultTemps[10] = {320, 100, 100, 100, 200, 200, 200, 320, 320, 320};
    uint16_t defaultDurs[10]  = {5, 2, 10, 30, 5, 5, 5, 5, 5, 5};
    
    memcpy(_state[idx].heaterTemps, defaultTemps, sizeof(defaultTemps));
    memcpy(_state[idx].heaterDurations, defaultDurs, sizeof(defaultDurs));
    _state[idx].heaterLength = 10;
}

int8_t BME688Array::configureSensorHeater(uint8_t idx) {
    _sensors[idx].setTPH();
    int8_t rslt = _sensors[idx].status;
    if (rslt != BME68X_OK) {
        return rslt;
    }
    
    // 计算共享加热时长
    uint32_t sharedHeatrDur = BME688_HEATER_TIME_BASE - 
        (_sensors[idx].getMeasDur(BME68X_PARALLEL_MODE) / INT64_C(1000));
    
    // 设置加热器配置
    _sensors[idx].setHeaterProf(
        _state[idx].heaterTemps,
        _state[idx].heaterDurations,
        sharedHeatrDur,
        _state[idx].heaterLength
    );
    
    return _sensors[idx].status;
}

SensorError BME688Array::configure(const SensorConfig& config) {
    uint8_t idx = config.sensor_idx;
    if (idx >= BME688_NUM_SENSORS) {
        return SensorError::INVALID_INDEX;
    }
    
    // 更新加热器配置
    memcpy(_state[idx].heaterTemps, config.heater_temps, sizeof(_state[idx].heaterTemps));
    memcpy(_state[idx].heaterDurations, config.heater_durations, sizeof(_state[idx].heaterDurations));
    _state[idx].heaterLength = config.heater_length;
    
    // 重置状态 - 必须重置所有相关字段才能让传感器重新开始采集
    _state[idx].nextGasIndex = 0;
    _state[idx].mode = BME68X_SLEEP_MODE;  // 重置为睡眠模式，下次读取时会唤醒
    _state[idx].wakeUpTime = 0;            // 立即可读
    
    // 应用配置
    int8_t rslt = configureSensorHeater(idx);
    if (rslt != BME68X_OK) {
        return SensorError::DRIVER_ERROR;
    }
    
    _state[idx].configured = true;
    return SensorError::OK;
}

bool BME688Array::isConfigured(uint8_t idx) const {
    if (idx >= BME688_NUM_SENSORS) return false;
    return _state[idx].configured;
}

uint32_t BME688Array::getSensorId(uint8_t idx) const {
    if (idx >= BME688_NUM_SENSORS) return 0;
    return _state[idx].id;
}

bool BME688Array::selectNextSensor(uint64_t& wakeUpTime, uint8_t& idx, uint8_t mode) {
    idx = 0xFF;
    for (uint8_t i = 0; i < BME688_NUM_SENSORS; i++) {
        if ((_state[i].mode == mode) && (_state[i].wakeUpTime < wakeUpTime)) {
            wakeUpTime = _state[i].wakeUpTime;
            idx = i;
        }
    }
    return (idx < BME688_NUM_SENSORS);
}

uint8_t BME688Array::getNextReadySensor() {
    uint8_t idx;
    uint64_t wakeUpTime = utils::getTickMs() + 20;
    
    if (selectNextSensor(wakeUpTime, idx, BME68X_PARALLEL_MODE) ||
        selectNextSensor(wakeUpTime, idx, BME68X_SLEEP_MODE)) {
        return idx;
    }
    return 0xFF;
}

bool BME688Array::readSensor(uint8_t idx, SensorReading& out) {
    if (idx >= BME688_NUM_SENSORS) {
        return false;
    }
    
    SensorState& state = _state[idx];
    uint64_t timeStamp = utils::getTickMs();
    
    if (!state.configured || (timeStamp < state.wakeUpTime)) {
        return false;
    }
    
    // 唤醒传感器
    if (state.mode == BME68X_SLEEP_MODE) {
        state.mode = BME68X_PARALLEL_MODE;
        _sensors[idx].setOpMode(BME68X_PARALLEL_MODE);
        state.nextGasIndex = 0;
        state.wakeUpTime = timeStamp + BME688_GAS_WAIT_SHARED;
        return false;
    }
    
    // 读取数据
    uint8_t nFields = _sensors[idx].fetchData();
    bme68x_data* sensorData = _sensors[idx].getAllData();
    
    for (int k = 0; k < 3; k++) {
        _fieldData[k] = sensorData[k];
    }
    
    for (uint8_t i = 0; i < nFields; i++) {
        if (_fieldData[i].status & BME68X_GASM_VALID_MSK) {
            // 计算索引差值，处理回绕情况
            // 使用有符号类型避免下溢问题
            int16_t deltaIndex = (int16_t)_fieldData[i].gas_index - (int16_t)state.nextGasIndex;
            
            // 处理回绕：如果 gas_index 回绕到 0，deltaIndex 会是负数
            // 此时将其调整为正值（相对于 heaterLength 的回绕距离）
            if (deltaIndex < 0) {
                deltaIndex += state.heaterLength;
            }
            
            // 跳过明显不匹配的数据（允许一定的滞后）
            if (deltaIndex < 0 || deltaIndex >= state.heaterLength) {
                continue;
            }
            
            // 填充输出结构
            out.tick_ms = (uint32_t)millis();
            out.sensor_idx = idx;
            out.sensor_id = state.id;
            out.primary_value = _fieldData[i].gas_resistance;
            out.temperature = _fieldData[i].temperature;
            out.humidity = _fieldData[i].humidity;
            out.pressure = _fieldData[i].pressure * 0.01f;  // Pa -> hPa
            out.heater_step = _fieldData[i].gas_index;
            out.adc_channel = 0;
            out.type = SensorType::MOX_DIGITAL;
            
            // 更新状态
            state.nextGasIndex = _fieldData[i].gas_index + 1;
            if (state.nextGasIndex >= state.heaterLength) {
                state.nextGasIndex = 0;
            }
            state.wakeUpTime = timeStamp + BME688_GAS_WAIT_SHARED;
            
            return true;
        }
    }
    
    // 无有效数据，更新等待时间
    state.wakeUpTime = timeStamp + BME688_GAS_WAIT_SHARED;
    return false;
}
