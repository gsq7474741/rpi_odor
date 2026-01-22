# 固件架构说明

> enose-sensor-firmware 软件架构设计与模块说明

## 1. 架构概述

### 1.1 设计目标

- **模块化**: 传感器驱动与通信逻辑分离
- **可扩展**: 支持多种传感器类型
- **简洁**: 专注于数据采集，复杂逻辑交给上位机
- **可靠**: 稳定的串口通信，错误处理完善

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            main.cpp                                      │
│                         (主循环 / 初始化)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │   CmdHandler    │  │  DataReporter   │  │     LedController       │  │
│  │   命令处理器     │  │   数据上报器     │  │      LED 状态指示        │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────────────┘  │
│           │                    │                                         │
│           ▼                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      ISensorArray 接口                           │    │
│  │          (抽象接口，定义传感器阵列的统一操作)                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│           │                                                              │
│           ├─────────────────────┬─────────────────────┐                  │
│           ▼                     ▼                     ▼                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │   BME688Array   │  │AnalogSensorArray│  │   (Future...)   │          │
│  │  (数字 MOX)      │  │  (模拟 MOX)      │  │  (PID 等)       │          │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────┘          │
│           │                    │                                         │
│           ▼                    ▼                                         │
│  ┌─────────────────┐  ┌─────────────────┐                               │
│  │    commMux      │  │   SPI ADC       │                               │
│  │ (I2C + SPI 复用) │  │ (ADS1256 等)    │                               │
│  └─────────────────┘  └─────────────────┘                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块

### 2.1 main.cpp

**职责**: 程序入口，初始化各模块，运行主循环。

**主要流程**:

```cpp
void setup() {
    // 1. 初始化串口
    Serial.begin(SERIAL_BAUDRATE);
    
    // 2. 初始化各模块
    ledCtlr.begin();
    cmdHandler.begin(Serial, &Serial2);
    reporter.begin(Serial, &Serial2);
    
    // 3. 设置命令回调
    cmdHandler.setInitCallback(...);
    cmdHandler.setStartCallback(...);
    cmdHandler.setStopCallback(...);
    
    // 4. 发送就绪消息
    reporter.sendReady(FIRMWARE_VERSION, sensors->getSensorCount());
}

void loop() {
    // 1. 更新 LED 状态
    ledCtlr.update(toRetCode(lastError));
    
    // 2. 处理上位机命令
    cmdHandler.process();
    
    // 3. 采集并上报数据
    if (isRunning) {
        uint8_t idx = sensors->getNextReadySensor();
        if (idx != 0xFF) {
            SensorReading reading;
            if (sensors->readSensor(idx, reading)) {
                reporter.report(reading);
            }
        }
    }
}
```

### 2.2 CmdHandler

**职责**: 解析上位机命令，调用相应回调，发送响应。

**关键特性**:
- 双串口监听
- JSON 解析 (ArduinoJson)
- 回调机制解耦命令处理

**命令处理流程**:

```
串口输入 → JSON 解析 → handleCommand() → cmdXxx() → 发送响应
                                ↓
                         调用回调函数
```

**支持的命令**:

| 命令 | 方法 | 说明 |
|------|------|------|
| sync | `cmdSync()` | 时间同步 |
| init | `cmdInit()` | 初始化传感器 |
| config | `cmdConfig()` | 配置加热器 |
| start | `cmdStart()` | 开始采集 |
| stop | `cmdStop()` | 停止采集 |
| status | `cmdStatus()` | 获取状态 |
| reset | `cmdReset()` | 重启设备 |

### 2.3 DataReporter

**职责**: 将传感器数据格式化为 JSON 并发送到串口。

**关键特性**:
- 统一的 `SensorReading` 结构
- 根据传感器类型输出不同字段
- 支持双串口输出

**输出字段逻辑**:

```cpp
void report(const SensorReading& reading) {
    doc["type"] = "data";
    doc["tick"] = reading.tick_ms;
    doc["s"] = reading.sensor_idx;
    doc["id"] = reading.sensor_id;
    doc["v"] = reading.primary_value;
    
    // 根据类型添加特定字段
    switch (reading.type) {
        case SensorType::MOX_DIGITAL:
            doc["st"] = "mox_d";
            doc["gi"] = reading.heater_step;
            break;
        case SensorType::MOX_ANALOG:
            doc["st"] = "mox_a";
            doc["ch"] = reading.adc_channel;
            break;
    }
    
    // 可选环境数据
    if (reading.hasTemperature()) doc["T"] = reading.temperature;
    if (reading.hasHumidity()) doc["H"] = reading.humidity;
    if (reading.hasPressure()) doc["P"] = reading.pressure;
}
```

### 2.4 LedController

**职责**: 通过 LED 闪烁模式指示系统状态。

**闪烁模式**:

| 模式 | 周期 | 含义 |
|------|------|------|
| 快闪 | 100ms | 错误状态 |
| 慢闪 | 1000ms | 正常运行 |

---

## 3. 传感器抽象层

### 3.1 ISensorArray 接口

**位置**: `core/sensor_array.h`

**职责**: 定义传感器阵列的统一接口，使上层代码与具体传感器类型解耦。

**接口定义**:

```cpp
class ISensorArray {
public:
    virtual ~ISensorArray() = default;
    
    // 初始化
    virtual SensorError init() = 0;
    
    // 基本信息
    virtual uint8_t getSensorCount() const = 0;
    virtual SensorType getSensorType() const = 0;
    virtual uint32_t getSensorId(uint8_t idx) const = 0;
    virtual bool isConfigured(uint8_t idx) const;
    
    // 数据采集
    virtual bool readSensor(uint8_t idx, SensorReading& out) = 0;
    virtual uint8_t getNextReadySensor() = 0;
    
    // 配置
    virtual SensorError configure(const SensorConfig& config);
};
```

### 3.2 SensorReading 结构

**位置**: `core/sensor_types.h`

**职责**: 统一的传感器读数结构，适用于所有传感器类型。

```cpp
struct SensorReading {
    uint32_t tick_ms;           // 设备时间戳
    uint8_t  sensor_idx;        // 传感器索引
    uint32_t sensor_id;         // 传感器唯一 ID
    
    float    primary_value;     // 主读数 (电阻/电压/ppb)
    
    float    temperature;       // 温度 (NAN = 无效)
    float    humidity;          // 湿度 (NAN = 无效)
    float    pressure;          // 气压 (NAN = 无效)
    
    uint8_t  heater_step;       // 加热器步骤 (MOX_DIGITAL)
    uint8_t  adc_channel;       // ADC 通道 (MOX_ANALOG)
    SensorType type;            // 传感器类型
};
```

### 3.3 SensorConfig 结构

**职责**: 传感器配置结构，用于动态配置。

```cpp
struct SensorConfig {
    uint8_t sensor_idx;
    
    // MOX_DIGITAL: 加热器配置
    uint16_t heater_temps[10];
    uint16_t heater_durations[10];
    uint8_t  heater_length;
    
    // MOX_ANALOG: ADC 配置
    float    adc_vref;
    uint16_t adc_sample_rate;
    uint8_t  adc_gain;
};
```

---

## 4. 传感器实现

### 4.1 BME688Array

**位置**: `sensors/bme688_array.cpp`

**职责**: 实现 BME688 数字 MOX 传感器阵列的驱动。

**通信方式**: I2C (TCA9548A 多路复用) + SPI

**加热器工作模式**: 并行模式 (`BME68X_PARALLEL_MODE`)

**数据采集流程**:

```
getNextReadySensor() → readSensor() → 检查唤醒时间
                                ↓
                    是否需要唤醒？ → 设置并行模式，等待
                                ↓ 否
                    fetchData() → 检查 GASM_VALID_MSK
                                ↓
                    填充 SensorReading → 返回
```

**状态管理**:

```cpp
struct SensorState {
    uint32_t id;            // 传感器唯一 ID
    uint64_t wakeUpTime;    // 下次可读时间
    uint8_t  nextGasIndex;  // 下一个加热器步骤
    uint8_t  mode;          // 当前模式
    bool     configured;    // 是否已配置
    
    uint16_t heaterTemps[10];
    uint16_t heaterDurations[10];
    uint8_t  heaterLength;
};
```

### 4.2 AnalogSensorArray

**位置**: `sensors/analog_array.cpp`

**职责**: 实现模拟 MOX 传感器阵列的驱动 (通过 SPI ADC)。

**支持的 ADC**:
- ADS1256 (24-bit)
- MCP3208 (12-bit)

**数据采集流程**:

```
getNextReadySensor() → 检查采样间隔
                ↓
        readAdcChannel() → SPI 通信
                ↓
        填充 SensorReading → 返回
```

---

## 5. 配置系统

### 5.1 config.h

**职责**: 编译时配置，选择传感器类型和通信参数。

**配置层次**:

```cpp
// 1. 传感器类型选择
#define SENSOR_TYPE         SENSOR_TYPE_BME688

// 2. 传感器特定配置
#if SENSOR_TYPE == SENSOR_TYPE_BME688
    #define NUM_SENSORS     8
    #define HAS_TEMPERATURE 1
    // ...
#elif SENSOR_TYPE == SENSOR_TYPE_ANALOG
    #define ADC_TYPE        ADC_TYPE_ADS1256
    #define ADC_CS_PIN      5
    // ...
#endif

// 3. 通信配置
#define SERIAL_BAUDRATE     115200
#define DUAL_SERIAL_MODE    1

// 4. 固件版本
#define FIRMWARE_VERSION    "2.1.0"
```

### 5.2 条件编译

**main.cpp 中的传感器实例化**:

```cpp
#if SENSOR_TYPE == SENSOR_TYPE_BME688
    #include "sensors/bme688_array.h"
    BME688Array sensorArray;
#elif SENSOR_TYPE == SENSOR_TYPE_ANALOG
    #include "sensors/analog_array.h"
    AnalogSensorArray sensorArray(
        (AdcType)(ADC_TYPE - 1),
        ADC_CS_PIN,
        NUM_SENSORS
    );
#endif

ISensorArray* sensors = &sensorArray;
```

---

## 6. 错误处理

### 6.1 错误码体系

**新错误码** (`SensorError`):

```cpp
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
```

**兼容错误码** (`demoRetCode`):

```cpp
enum demoRetCode {
    EDK_BME68X_DRIVER_ERROR = -10,
    EDK_SENSOR_MANAGER_CONFIG_FILE_ERROR = -9,
    // ...
    EDK_OK = 0,
    EDK_SENSOR_MANAGER_DATA_MISS_WARNING = 1
};
```

### 6.2 错误传播

```
传感器驱动 → SensorError → toRetCode() → demoRetCode → LED/响应
```

---

## 7. 扩展指南

### 7.1 添加新传感器类型

1. **定义枚举值** (`sensor_types.h`):
```cpp
enum class SensorType : uint8_t {
    // ...
    PID = 2,
    EC  = 3,  // 新增
};
```

2. **创建实现类** (`sensors/ec_array.h/cpp`):
```cpp
class ECArray : public ISensorArray {
public:
    SensorError init() override;
    uint8_t getSensorCount() const override;
    // ... 实现所有纯虚函数
};
```

3. **添加配置选项** (`config.h`):
```cpp
#define SENSOR_TYPE_EC  3

#if SENSOR_TYPE == SENSOR_TYPE_EC
    #define NUM_SENSORS 4
    // EC 传感器特定配置
#endif
```

4. **添加条件编译** (`main.cpp`):
```cpp
#elif SENSOR_TYPE == SENSOR_TYPE_EC
    #include "sensors/ec_array.h"
    ECArray sensorArray;
```

5. **更新数据上报** (`data_reporter.cpp`):
```cpp
case SensorType::EC:
    doc["st"] = "ec";
    doc["cond"] = reading.primary_value;  // 电导率
    break;
```

### 7.2 添加新命令

1. **在 `CmdHandler` 中添加处理**:
```cpp
void CmdHandler::handleCommand(const JsonDocument& doc) {
    // ...
    else if (strcmp(cmd, "calibrate") == 0) {
        cmdCalibrate(id, doc);
    }
}

void CmdHandler::cmdCalibrate(int id, const JsonDocument& doc) {
    // 实现校准逻辑
    sendAck(id, true);
}
```

2. **在头文件中声明**:
```cpp
void cmdCalibrate(int id, const JsonDocument& doc);
```

---

## 8. 依赖关系

```
platformio.ini
├── espressif32 (平台)
├── arduino (框架)
└── lib_deps
    ├── boschsensortec/BME68x Sensor library
    └── bblanchon/ArduinoJson
```

**已移除的依赖** (功能迁移到上位机):
- SdFat (SD 卡存储)
- RTClib (RTC 时钟)
- PubSubClient (MQTT)
- Crypto (加密)
- AliyunIoTSDK (阿里云)

---

## 9. 内存使用

**ESP32 资源分配**:

| 资源 | 使用 | 说明 |
|------|------|------|
| Flash | ~800KB | 程序代码 |
| RAM | ~50KB | 运行时数据 |
| JSON 缓冲 | 1KB | 命令解析 |
| 数据缓冲 | 256B | 单条数据 |

**分区表** (`partition.csv`):
```
# Name,   Type, SubType, Offset,   Size
nvs,      data, nvs,     0x9000,   0x5000
otadata,  data, ota,     0xe000,   0x2000
app0,     app,  ota_0,   0x10000,  0x140000
app1,     app,  ota_1,   0x150000, 0x140000
spiffs,   data, spiffs,  0x290000, 0x170000
```

---

## 10. 未来规划

- [ ] 支持 PID 传感器
- [ ] 支持 IR 传感器
- [ ] OTA 固件更新
- [ ] 配置持久化 (NVS)
- [ ] 数据压缩传输
- [ ] 多板级联
