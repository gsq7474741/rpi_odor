/**
 * BME688 Sensor Driver for Raspberry Pi Host
 * 
 * 功能: 作为树莓派的传感器从设备，通过串口接收命令并上报数据
 * 
 * 通信协议:
 *   上位机 -> ESP32: JSON 命令 (sync, init, start, stop, status, reset)
 *   ESP32 -> 上位机: JSON 响应/数据流
 * 
 * 重构说明:
 *   - 使用 ISensorArray 抽象接口支持多种传感器类型
 *   - 通过 config.h 编译时选择传感器类型
 */

#include <Arduino.h>
#include "config.h"
#include "core/sensor_array.h"
#include "cmd_handler.h"
#include "data_reporter.h"
#include "led_controller.h"
#include "utils.h"

// 根据配置选择传感器实现
#if SENSOR_TYPE == SENSOR_TYPE_BME688
    #include "sensors/bme688_array.h"
    BME688Array sensorArray;
#elif SENSOR_TYPE == SENSOR_TYPE_ANALOG
    #include "sensors/analog_array.h"
    AnalogSensorArray sensorArray(
        (AdcType)(ADC_TYPE - 1),  // 转换配置值到枚举
        ADC_CS_PIN,
        NUM_SENSORS
    );
#endif

// 全局传感器接口指针
ISensorArray* sensors = &sensorArray;

// 全局对象
CmdHandler cmdHandler;
DataReporter reporter;
ledController ledCtlr;

// 运行状态
bool isRunning = false;
SensorError lastError = SensorError::OK;
std::vector<uint8_t> activeSensors;

// 兼容旧的 demoRetCode (用于 LED 和 cmd_handler)
demoRetCode toRetCode(SensorError err) {
    return (err == SensorError::OK) ? EDK_OK : EDK_BME68X_DRIVER_ERROR;
}

void setup() {
    // 初始化主串口 (USB)
    Serial.begin(SERIAL_BAUDRATE);
    while (!Serial) { 
        delay(10); 
    }
    
    #if DUAL_SERIAL_MODE
    // 初始化备用串口 (GPIO 16/17)
    Serial2.begin(SERIAL_BAUDRATE, SERIAL_8N1, SERIAL2_RX_PIN, SERIAL2_TX_PIN);
    #endif
    
    // 初始化工具模块
    utils::begin();
    
    // 初始化 LED
    ledCtlr.begin();
    
    // 初始化命令处理器 (双串口模式)
    #if DUAL_SERIAL_MODE
    cmdHandler.begin(Serial, &Serial2);
    #else
    cmdHandler.begin(Serial);
    #endif
    cmdHandler.setSensorArray(sensors);
    
    // 设置命令回调
    cmdHandler.setInitCallback([](const String& configFile) -> demoRetCode {
        // 初始化传感器阵列
        lastError = sensors->init();
        return toRetCode(lastError);
    });

    cmdHandler.setConfigCallback([](const JsonDocument& doc) -> demoRetCode {
        JsonArrayConst sensorsArr = doc["params"]["sensors"];
        JsonArrayConst temps = doc["params"]["temps"];
        JsonArrayConst durs = doc["params"]["durs"];

        // 仅 BME688 支持加热器配置
        #if SENSOR_TYPE == SENSOR_TYPE_BME688
        if (temps.size() != 10 || durs.size() != 10) {
            return EDK_SENSOR_MANAGER_JSON_FORMAT_ERROR;
        }

        SensorConfig config;
        for (int i = 0; i < 10; i++) {
            config.heater_temps[i] = temps[i].as<uint16_t>();
            config.heater_durations[i] = durs[i].as<uint16_t>();
        }
        config.heater_length = 10;

        std::vector<uint8_t> targetSensors;
        if (sensorsArr.isNull()) {
            for (uint8_t i = 0; i < sensors->getSensorCount(); i++) {
                targetSensors.push_back(i);
            }
        } else {
            for (JsonVariantConst v : sensorsArr) {
                targetSensors.push_back(v.as<uint8_t>());
            }
        }

        for (uint8_t idx : targetSensors) {
            config.sensor_idx = idx;
            SensorError err = sensors->configure(config);
            if (err != SensorError::OK) {
                return EDK_SENSOR_MANAGER_CONFIG_FILE_ERROR;
            }
        }
        #endif
        
        return EDK_OK;
    });
    
    cmdHandler.setStartCallback([](const std::vector<uint8_t>& sensorList) {
        activeSensors = sensorList;
        isRunning = true;
    });
    
    cmdHandler.setStopCallback([]() {
        isRunning = false;
        activeSensors.clear();
    });
    
    // 初始化数据上报器 (双串口模式)
    #if DUAL_SERIAL_MODE
    reporter.begin(Serial, &Serial2);
    #else
    reporter.begin(Serial);
    #endif
    
    // 发送就绪信号 (会发送到所有串口)
    reporter.sendReady(FIRMWARE_VERSION, sensors->getSensorCount());
}

void loop() {
    // 更新 LED 状态
    ledCtlr.update(toRetCode(lastError));
    
    // 处理上位机命令
    if (cmdHandler.process()) {
        // 命令被处理，同步活跃串口到 reporter
        reporter.setActiveSerial(cmdHandler.getActiveSerial());
    }
    
    // 采集并上报数据
    if (isRunning && lastError == SensorError::OK) {
        uint8_t sensorIdx = sensors->getNextReadySensor();
        
        if (sensorIdx != 0xFF) {
            // 检查传感器是否在活跃列表中
            bool isActive = activeSensors.empty(); // 如果为空则全部活跃
            for (uint8_t idx : activeSensors) {
                if (idx == sensorIdx) {
                    isActive = true;
                    break;
                }
            }
            
            if (isActive) {
                SensorReading reading;
                if (sensors->readSensor(sensorIdx, reading)) {
                    reporter.report(reading);
                }
            }
        }
    }
}
