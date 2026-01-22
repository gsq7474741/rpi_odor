# BME688 传感器驱动器重构方案

> 将原有独立数据采集系统改造为树莓派上位机的从设备

## 1. 项目概述

### 1.1 原始架构

```
ESP32 (独立运行)
├── WiFi 连接阿里云
├── SD 卡本地存储
├── RTC 时钟
├── 8x BME688 传感器采集
└── 标签管理 (按钮/云端)
```

### 1.2 目标架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         树莓派上位机                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐    │
│  │ 液路控制  │  │ 气路控制  │  │TimescaleDB│ │ 实验流程/UI/ML      │    │
│  │ 混合进样  │  │ 鼓泡洗气  │  │ 数据存储  │  │                      │    │
│  │ 清洗排废  │  │ 动态顶空  │  │          │  │                      │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │ USB Serial (115200/921600 baud)
┌───────────────────────────▼─────────────────────────────────────────────┐
│                     ESP32 传感器驱动器 (从设备)                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  命令解析器      │  │  sensorManager  │  │  数据上报 (JSON)        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
│                              │                                          │
│                    ┌─────────▼─────────┐                                │
│                    │  BME688 x8 传感器  │                                │
│                    └───────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 设计原则

- **ESP32 只负责**：传感器驱动、数据采集、带时间戳上报
- **树莓派负责**：时间戳对齐、标签管理、数据存储、实验流程控制
- **通信方式**：USB Serial (可靠、简单、供电方便)

---

## 2. 目录结构

### 2.1 保留 PlatformIO 框架

```
bme-dev-kit-odor/
├── platformio.ini              # ✅ 保留，修改依赖
├── partition.csv               # ✅ 保留
├── include/
│   └── README                  # ✅ 保留
├── lib/
│   └── README                  # ✅ 保留 (移除 LinkSDK)
├── src/
│   ├── main.cpp                # ⚠️ 重写
│   ├── sensor_manager.cpp      # ✅ 保留
│   ├── sensor_manager.h        # ✅ 保留
│   ├── commMux.cpp             # ✅ 保留
│   ├── commMux.h               # ✅ 保留
│   ├── demo_app.h              # ✅ 保留
│   ├── utils.cpp               # ⚠️ 精简
│   ├── utils.h                 # ⚠️ 精简
│   ├── led_controller.cpp      # ✅ 保留
│   ├── led_controller.h        # ✅ 保留
│   ├── cmd_handler.cpp         # 🆕 新增
│   ├── cmd_handler.h           # 🆕 新增
│   ├── data_reporter.cpp       # 🆕 新增
│   ├── data_reporter.h         # 🆕 新增
│   ├── *.bmeconfig             # ✅ 保留 (可选，也可由上位机下发)
│   │
│   │ # 以下文件删除
│   ├── bme68x_datalogger.cpp   # ❌ 删除
│   ├── bme68x_datalogger.h     # ❌ 删除
│   ├── bsec_datalogger.cpp     # ❌ 删除
│   ├── bsec_datalogger.h       # ❌ 删除
│   ├── ble_controller.cpp      # ❌ 删除
│   ├── ble_controller.h        # ❌ 删除
│   └── label_provider.*        # ❌ 删除
├── test/                       # ✅ 保留
├── docs/
│   └── REFACTOR_PLAN.md        # 🆕 本文档
└── rpi/                        # 🆕 树莓派端代码
    ├── bme688_driver.py
    ├── data_store.py
    ├── experiment_manager.py
    └── requirements.txt
```

### 2.2 修改后的 platformio.ini

```ini
; PlatformIO Project Configuration File

[env:featheresp32]
platform = espressif32
platform_packages =
    espressif/toolchain-xtensa-esp32 @ ^12.2.0
board = featheresp32
framework = arduino
build_unflags = -std=gnu++11 -std=c++11 -std=gnu99
build_flags = -std=gnu++20 -std=gnu17 -Wno-attributes -Wno-write-strings -frtti

board_build.partitions = partition.csv

; 监视器配置
monitor_speed = 115200

lib_deps =
    ; 保留：传感器驱动
    boschsensortec/BME68x Sensor library @ ^1.2.40408
    ; 可选：BSEC 算法库 (如需气体分类)
    ; boschsensortec/BSEC2 Software Library @ ^1.3.2200
    ; JSON 解析
    bblanchon/ArduinoJson @ ^6.19.4

; 以下依赖已移除:
; - greiman/SdFat (SD卡存储移到树莓派)
; - adafruit/RTClib (时间戳由上位机提供)
; - knolleary/PubSubClient (MQTT移到树莓派)
; - rweather/Crypto (云端加密移到树莓派)
; - xinyu198736/AliyunIoTSDK (云连接移到树莓派)
```

---

## 3. 通信协议

### 3.1 物理层

| 参数 | 值 |
|------|-----|
| 接口 | USB Serial (CP2104) |
| 波特率 | 115200 (默认) / 921600 (高速) |
| 数据格式 | 8N1 |
| 帧分隔 | `\n` (换行符) |

### 3.2 消息格式 (JSON)

#### 上位机 → ESP32 (命令)

```json
{"cmd": "sync", "id": 1}
{"cmd": "init", "id": 2, "params": {"config_file": "default.bmeconfig"}}
{"cmd": "init_inline", "id": 3, "params": {"config": {...}}}
{"cmd": "start", "id": 4, "params": {"sensors": [0,1,2,3,4,5,6,7]}}
{"cmd": "stop", "id": 5}
{"cmd": "status", "id": 6}
{"cmd": "reset", "id": 7}
```

#### ESP32 → 上位机 (响应)

```json
{"type": "ack", "id": 1, "ok": true, "tick_ms": 12345678}
{"type": "ack", "id": 2, "ok": true, "sensors": 8}
{"type": "ack", "id": 4, "ok": true}
{"type": "error", "id": 3, "code": -9, "msg": "CONFIG_FILE_ERROR"}
```

#### ESP32 → 上位机 (数据流)

```json
{"type": "data", "tick": 12345678, "s": 0, "id": 3456789, "T": 25.32, "P": 1013.25, "H": 45.12, "R": 123456.7, "gi": 3}
```

| 字段 | 说明 | 单位 |
|------|------|------|
| `tick` | ESP32 启动后毫秒数 | ms |
| `s` | 传感器索引 | 0-7 |
| `id` | 传感器唯一ID | - |
| `T` | 温度 | °C |
| `P` | 气压 | hPa |
| `H` | 相对湿度 | % |
| `R` | 气体电阻 | Ω |
| `gi` | 加热器步骤索引 | 0-9 |

### 3.3 时间同步流程

```
1. 树莓派发送: {"cmd": "sync", "id": 1}
2. ESP32 响应: {"type": "ack", "id": 1, "ok": true, "tick_ms": 5000}
3. 树莓派计算: time_offset = datetime.now() - timedelta(milliseconds=5000)
4. 后续数据对齐: real_time = time_offset + timedelta(milliseconds=tick)
```

---

## 4. ESP32 端代码

### 4.1 cmd_handler.h

```cpp
#ifndef CMD_HANDLER_H
#define CMD_HANDLER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include "sensor_manager.h"
#include "demo_app.h"

class CmdHandler {
public:
    // 回调类型定义
    using StartCallback = std::function<void(const std::vector<uint8_t>&)>;
    using StopCallback = std::function<void()>;

    CmdHandler();
    
    void begin(Stream& serial);
    void setStartCallback(StartCallback cb) { _onStart = cb; }
    void setStopCallback(StopCallback cb) { _onStop = cb; }
    
    // 处理串口输入，返回是否有命令被处理
    bool process();
    
    // 发送响应
    void sendAck(int id, bool ok, JsonObject extra = JsonObject());
    void sendError(int id, int code, const char* msg);
    
private:
    Stream* _serial;
    String _buffer;
    sensorManager* _sensorMgr;
    
    StartCallback _onStart;
    StopCallback _onStop;
    
    void handleCommand(const JsonDocument& doc);
    void cmdSync(int id);
    void cmdInit(int id, JsonObject params);
    void cmdStart(int id, JsonObject params);
    void cmdStop(int id);
    void cmdStatus(int id);
    void cmdReset(int id);
};

#endif
```

### 4.2 cmd_handler.cpp

```cpp
#include "cmd_handler.h"
#include "utils.h"

CmdHandler::CmdHandler() : _serial(nullptr), _sensorMgr(nullptr) {}

void CmdHandler::begin(Stream& serial) {
    _serial = &serial;
}

bool CmdHandler::process() {
    while (_serial->available()) {
        char c = _serial->read();
        if (c == '\n') {
            if (_buffer.length() > 0) {
                StaticJsonDocument<1024> doc;
                DeserializationError err = deserializeJson(doc, _buffer);
                _buffer = "";
                
                if (!err) {
                    handleCommand(doc);
                    return true;
                }
            }
        } else if (c != '\r') {
            _buffer += c;
        }
    }
    return false;
}

void CmdHandler::handleCommand(const JsonDocument& doc) {
    const char* cmd = doc["cmd"];
    int id = doc["id"] | 0;
    JsonObject params = doc["params"];
    
    if (strcmp(cmd, "sync") == 0) {
        cmdSync(id);
    } else if (strcmp(cmd, "init") == 0) {
        cmdInit(id, params);
    } else if (strcmp(cmd, "start") == 0) {
        cmdStart(id, params);
    } else if (strcmp(cmd, "stop") == 0) {
        cmdStop(id);
    } else if (strcmp(cmd, "status") == 0) {
        cmdStatus(id);
    } else if (strcmp(cmd, "reset") == 0) {
        cmdReset(id);
    } else {
        sendError(id, -1, "UNKNOWN_CMD");
    }
}

void CmdHandler::cmdSync(int id) {
    StaticJsonDocument<128> doc;
    doc["type"] = "ack";
    doc["id"] = id;
    doc["ok"] = true;
    doc["tick_ms"] = millis();
    serializeJson(doc, *_serial);
    _serial->println();
}

void CmdHandler::cmdInit(int id, JsonObject params) {
    // 从文件或内联配置初始化
    const char* configFile = params["config_file"] | "default.bmeconfig";
    // 注意: 如果移除了SD卡，需要使用内联配置或硬编码配置
    // demoRetCode ret = _sensorMgr->begin(configFile);
    
    // 临时: 使用硬编码配置初始化所有传感器
    demoRetCode ret = EDK_OK; // 需要实现
    
    if (ret >= EDK_OK) {
        sendAck(id, true);
    } else {
        sendError(id, ret, "INIT_FAILED");
    }
}

void CmdHandler::cmdStart(int id, JsonObject params) {
    JsonArray sensors = params["sensors"];
    std::vector<uint8_t> sensorList;
    
    if (sensors.isNull()) {
        // 默认所有传感器
        for (uint8_t i = 0; i < 8; i++) sensorList.push_back(i);
    } else {
        for (JsonVariant v : sensors) {
            sensorList.push_back(v.as<uint8_t>());
        }
    }
    
    if (_onStart) _onStart(sensorList);
    sendAck(id, true);
}

void CmdHandler::cmdStop(int id) {
    if (_onStop) _onStop();
    sendAck(id, true);
}

void CmdHandler::cmdStatus(int id) {
    StaticJsonDocument<512> doc;
    doc["type"] = "status";
    doc["id"] = id;
    doc["tick_ms"] = millis();
    doc["running"] = true; // 需要实际状态
    
    JsonArray arr = doc.createNestedArray("sensors");
    for (uint8_t i = 0; i < 8; i++) {
        bme68xSensor* sensor = sensorManager::getSensor(i);
        if (sensor) {
            JsonObject obj = arr.createNestedObject();
            obj["idx"] = i;
            obj["id"] = sensor->id;
            obj["ok"] = sensor->isConfigured;
        }
    }
    
    serializeJson(doc, *_serial);
    _serial->println();
}

void CmdHandler::cmdReset(int id) {
    sendAck(id, true);
    delay(100);
    ESP.restart();
}

void CmdHandler::sendAck(int id, bool ok, JsonObject extra) {
    StaticJsonDocument<256> doc;
    doc["type"] = "ack";
    doc["id"] = id;
    doc["ok"] = ok;
    
    for (JsonPair kv : extra) {
        doc[kv.key()] = kv.value();
    }
    
    serializeJson(doc, *_serial);
    _serial->println();
}

void CmdHandler::sendError(int id, int code, const char* msg) {
    StaticJsonDocument<256> doc;
    doc["type"] = "error";
    doc["id"] = id;
    doc["code"] = code;
    doc["msg"] = msg;
    serializeJson(doc, *_serial);
    _serial->println();
}
```

### 4.3 data_reporter.h

```cpp
#ifndef DATA_REPORTER_H
#define DATA_REPORTER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <bme68xLibrary.h>

class DataReporter {
public:
    DataReporter();
    
    void begin(Stream& serial);
    
    // 上报单个数据点
    void report(uint8_t sensorIdx, uint32_t sensorId, const bme68x_data* data);
    
private:
    Stream* _serial;
    StaticJsonDocument<256> _doc;
};

#endif
```

### 4.4 data_reporter.cpp

```cpp
#include "data_reporter.h"

DataReporter::DataReporter() : _serial(nullptr) {}

void DataReporter::begin(Stream& serial) {
    _serial = &serial;
}

void DataReporter::report(uint8_t sensorIdx, uint32_t sensorId, const bme68x_data* data) {
    if (!_serial || !data) return;
    
    _doc.clear();
    _doc["type"] = "data";
    _doc["tick"] = millis();
    _doc["s"] = sensorIdx;
    _doc["id"] = sensorId;
    _doc["T"] = serialized(String(data->temperature, 2));
    _doc["P"] = serialized(String(data->pressure * 0.01f, 2));
    _doc["H"] = serialized(String(data->humidity, 2));
    _doc["R"] = serialized(String(data->gas_resistance, 1));
    _doc["gi"] = data->gas_index;
    
    serializeJson(_doc, *_serial);
    _serial->println();
}
```

### 4.5 main.cpp (重写)

```cpp
/**
 * BME688 Sensor Driver for Raspberry Pi Host
 * 
 * 功能: 作为树莓派的传感器从设备，通过串口上报数据
 */

#include <Arduino.h>
#include "sensor_manager.h"
#include "cmd_handler.h"
#include "data_reporter.h"
#include "led_controller.h"
#include "commMux.h"

// 全局对象
sensorManager sensorMgr;
CmdHandler cmdHandler;
DataReporter reporter;
ledController ledCtlr;

// 运行状态
bool isRunning = false;
demoRetCode lastRetCode = EDK_OK;

void setup() {
    Serial.begin(115200);
    while (!Serial) { delay(10); }
    
    // 初始化 LED
    ledCtlr.begin();
    
    // 初始化命令处理器
    cmdHandler.begin(Serial);
    cmdHandler.setStartCallback([](const std::vector<uint8_t>& sensors) {
        isRunning = true;
    });
    cmdHandler.setStopCallback([]() {
        isRunning = false;
    });
    
    // 初始化数据上报器
    reporter.begin(Serial);
    
    // 预初始化传感器 (使用硬编码配置)
    lastRetCode = sensorMgr.initializeAllSensors();
    
    // 发送就绪信号
    Serial.println("{\"type\":\"ready\",\"version\":\"2.0.0\",\"sensors\":8}");
}

void loop() {
    // 更新 LED 状态
    ledCtlr.update(lastRetCode);
    
    // 处理命令
    cmdHandler.process();
    
    // 采集并上报数据
    if (isRunning && lastRetCode >= EDK_OK) {
        uint8_t sensorIdx;
        
        while (sensorManager::scheduleSensor(sensorIdx)) {
            bme68x_data* sensorData[3];
            bme68xSensor* sensor = sensorManager::getSensor(sensorIdx);
            
            if (sensor == nullptr) continue;
            
            lastRetCode = sensorMgr.collectData(sensorIdx, sensorData);
            
            if (lastRetCode >= EDK_OK) {
                for (const auto data : sensorData) {
                    if (data != nullptr) {
                        reporter.report(sensorIdx, sensor->id, data);
                    }
                }
            }
        }
    }
}
```

### 4.6 utils.h (精简版)

```cpp
#ifndef UTILS_H
#define UTILS_H

#include <Arduino.h>
#include "demo_app.h"

class utils {
public:
    static uint64_t getTickMs() {
        return millis();
    }
    
    static String getMacAddress() {
        uint8_t mac[6];
        esp_efuse_mac_get_default(mac);
        char macStr[18];
        snprintf(macStr, sizeof(macStr), "%02X%02X%02X%02X%02X%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        return String(macStr);
    }
};

#endif
```

---

## 5. 树莓派端代码

### 5.1 目录结构

```
rpi/
├── bme688_driver.py      # ESP32 通信驱动
├── data_store.py         # TimescaleDB 数据存储
├── experiment_manager.py # 实验流程管理
├── config.py             # 配置文件
├── requirements.txt      # Python 依赖
└── examples/
    └── simple_collect.py # 简单采集示例
```

### 5.2 requirements.txt

```
pyserial>=3.5
psycopg2-binary>=2.9
pandas>=2.0
numpy>=1.24
```

### 5.3 bme688_driver.py

```python
"""
BME688 ESP32 驱动通信模块
"""
import serial
import json
import threading
import queue
from datetime import datetime, timedelta
from typing import Callable, Optional, List, Dict, Any
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class SensorData:
    """传感器数据点"""
    timestamp: datetime
    tick_ms: int
    sensor_idx: int
    sensor_id: int
    temperature: float
    pressure: float
    humidity: float
    gas_resistance: float
    gas_index: int


class BME688Driver:
    """BME688 ESP32 驱动"""
    
    def __init__(self, port: str = '/dev/ttyUSB0', baudrate: int = 115200):
        self.port = port
        self.baudrate = baudrate
        self.ser: Optional[serial.Serial] = None
        self._cmd_id = 0
        self._pending_acks: Dict[int, queue.Queue] = {}
        self._time_offset: Optional[datetime] = None
        self._data_callback: Optional[Callable[[SensorData], None]] = None
        self._running = False
        self._read_thread: Optional[threading.Thread] = None
    
    def connect(self) -> bool:
        """连接设备"""
        try:
            self.ser = serial.Serial(self.port, self.baudrate, timeout=1)
            self._running = True
            self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._read_thread.start()
            
            # 等待设备就绪
            import time
            time.sleep(2)
            return True
        except Exception as e:
            logger.error(f"连接失败: {e}")
            return False
    
    def disconnect(self):
        """断开连接"""
        self._running = False
        if self._read_thread:
            self._read_thread.join(timeout=2)
        if self.ser:
            self.ser.close()
    
    def _send_cmd(self, cmd: str, params: dict = None, timeout: float = 5.0) -> dict:
        """发送命令并等待响应"""
        self._cmd_id += 1
        cmd_id = self._cmd_id
        
        msg = {"cmd": cmd, "id": cmd_id}
        if params:
            msg["params"] = params
        
        # 创建响应队列
        ack_queue = queue.Queue()
        self._pending_acks[cmd_id] = ack_queue
        
        # 发送
        line = json.dumps(msg) + '\n'
        self.ser.write(line.encode())
        logger.debug(f"发送: {line.strip()}")
        
        # 等待响应
        try:
            response = ack_queue.get(timeout=timeout)
            return response
        except queue.Empty:
            raise TimeoutError(f"命令 {cmd} 超时")
        finally:
            del self._pending_acks[cmd_id]
    
    def _read_loop(self):
        """读取线程"""
        while self._running:
            try:
                if self.ser.in_waiting:
                    line = self.ser.readline().decode().strip()
                    if line:
                        self._handle_message(line)
            except Exception as e:
                logger.error(f"读取错误: {e}")
    
    def _handle_message(self, line: str):
        """处理接收的消息"""
        try:
            msg = json.loads(line)
            msg_type = msg.get("type")
            
            if msg_type in ("ack", "error", "status"):
                # 响应消息
                cmd_id = msg.get("id")
                if cmd_id in self._pending_acks:
                    self._pending_acks[cmd_id].put(msg)
            
            elif msg_type == "data":
                # 数据消息
                self._handle_data(msg)
            
            elif msg_type == "ready":
                logger.info(f"设备就绪: {msg}")
        
        except json.JSONDecodeError:
            logger.warning(f"无效JSON: {line}")
    
    def _handle_data(self, msg: dict):
        """处理数据消息"""
        if not self._time_offset or not self._data_callback:
            return
        
        tick_ms = msg["tick"]
        timestamp = self._time_offset + timedelta(milliseconds=tick_ms)
        
        data = SensorData(
            timestamp=timestamp,
            tick_ms=tick_ms,
            sensor_idx=msg["s"],
            sensor_id=msg["id"],
            temperature=float(msg["T"]),
            pressure=float(msg["P"]),
            humidity=float(msg["H"]),
            gas_resistance=float(msg["R"]),
            gas_index=msg["gi"]
        )
        
        self._data_callback(data)
    
    # ========== 公共 API ==========
    
    def sync_time(self) -> bool:
        """同步时间"""
        response = self._send_cmd("sync")
        if response.get("ok"):
            tick_ms = response["tick_ms"]
            self._time_offset = datetime.now() - timedelta(milliseconds=tick_ms)
            logger.info(f"时间同步成功, offset: {self._time_offset}")
            return True
        return False
    
    def init(self, config_file: str = None, config: dict = None) -> bool:
        """初始化传感器"""
        params = {}
        if config_file:
            params["config_file"] = config_file
        if config:
            params["config"] = config
        
        response = self._send_cmd("init", params)
        return response.get("ok", False)
    
    def start(self, sensors: List[int] = None) -> bool:
        """开始采集"""
        params = {}
        if sensors:
            params["sensors"] = sensors
        
        response = self._send_cmd("start", params)
        return response.get("ok", False)
    
    def stop(self) -> bool:
        """停止采集"""
        response = self._send_cmd("stop")
        return response.get("ok", False)
    
    def get_status(self) -> dict:
        """获取状态"""
        return self._send_cmd("status")
    
    def set_data_callback(self, callback: Callable[[SensorData], None]):
        """设置数据回调"""
        self._data_callback = callback


# ========== 使用示例 ==========
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    
    driver = BME688Driver('/dev/ttyUSB0')
    
    if driver.connect():
        driver.sync_time()
        driver.init()
        
        def on_data(data: SensorData):
            print(f"[{data.timestamp}] S{data.sensor_idx}: "
                  f"T={data.temperature:.1f}°C, R={data.gas_resistance:.0f}Ω")
        
        driver.set_data_callback(on_data)
        driver.start()
        
        try:
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            driver.stop()
            driver.disconnect()
```

### 5.4 data_store.py

```python
"""
TimescaleDB 数据存储模块
"""
import psycopg2
from psycopg2.extras import execute_batch
from datetime import datetime
from typing import List, Optional
from dataclasses import dataclass
import logging

from bme688_driver import SensorData

logger = logging.getLogger(__name__)


class DataStore:
    """TimescaleDB 数据存储"""
    
    SCHEMA_SQL = """
    -- 实验表
    CREATE TABLE IF NOT EXISTS experiments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        start_time TIMESTAMPTZ DEFAULT NOW(),
        end_time TIMESTAMPTZ,
        config JSONB,
        notes TEXT
    );
    
    -- 标签表
    CREATE TABLE IF NOT EXISTS labels (
        id SERIAL PRIMARY KEY,
        experiment_id INT REFERENCES experiments(id),
        label_name VARCHAR(50),
        label_value INT,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ
    );
    
    -- 传感器数据表
    CREATE TABLE IF NOT EXISTS sensor_data (
        time TIMESTAMPTZ NOT NULL,
        experiment_id INT,
        sensor_idx SMALLINT,
        sensor_id INT,
        temperature REAL,
        pressure REAL,
        humidity REAL,
        gas_resistance REAL,
        gas_index SMALLINT
    );
    
    -- 创建 TimescaleDB 超表 (如果尚未创建)
    SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE);
    
    -- 索引
    CREATE INDEX IF NOT EXISTS idx_sensor_data_experiment 
        ON sensor_data (experiment_id, time DESC);
    """
    
    def __init__(self, dbname: str = 'odor_lab', host: str = 'localhost',
                 user: str = 'postgres', password: str = ''):
        self.conn = psycopg2.connect(
            dbname=dbname, host=host, user=user, password=password
        )
        self.buffer: List[tuple] = []
        self.buffer_size = 100
        self.current_experiment_id: Optional[int] = None
    
    def init_schema(self):
        """初始化数据库表结构"""
        with self.conn.cursor() as cur:
            cur.execute(self.SCHEMA_SQL)
        self.conn.commit()
        logger.info("数据库表结构初始化完成")
    
    def start_experiment(self, name: str, config: dict = None) -> int:
        """开始新实验"""
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO experiments (name, config) VALUES (%s, %s) RETURNING id",
                (name, psycopg2.extras.Json(config))
            )
            self.current_experiment_id = cur.fetchone()[0]
        self.conn.commit()
        logger.info(f"开始实验: {name} (ID: {self.current_experiment_id})")
        return self.current_experiment_id
    
    def end_experiment(self):
        """结束当前实验"""
        if self.current_experiment_id:
            self.flush()
            with self.conn.cursor() as cur:
                cur.execute(
                    "UPDATE experiments SET end_time = NOW() WHERE id = %s",
                    (self.current_experiment_id,)
                )
            self.conn.commit()
            logger.info(f"结束实验 ID: {self.current_experiment_id}")
            self.current_experiment_id = None
    
    def set_label(self, label_name: str, label_value: int):
        """设置当前标签 (结束上一个标签并开始新标签)"""
        now = datetime.now()
        
        with self.conn.cursor() as cur:
            # 结束上一个标签
            cur.execute(
                """UPDATE labels SET end_time = %s 
                   WHERE experiment_id = %s AND end_time IS NULL""",
                (now, self.current_experiment_id)
            )
            # 开始新标签
            cur.execute(
                """INSERT INTO labels (experiment_id, label_name, label_value, start_time)
                   VALUES (%s, %s, %s, %s)""",
                (self.current_experiment_id, label_name, label_value, now)
            )
        self.conn.commit()
        logger.info(f"设置标签: {label_name} = {label_value}")
    
    def add_data(self, data: SensorData):
        """添加数据点到缓冲区"""
        self.buffer.append((
            data.timestamp,
            self.current_experiment_id,
            data.sensor_idx,
            data.sensor_id,
            data.temperature,
            data.pressure,
            data.humidity,
            data.gas_resistance,
            data.gas_index
        ))
        
        if len(self.buffer) >= self.buffer_size:
            self.flush()
    
    def flush(self):
        """刷新缓冲区到数据库"""
        if not self.buffer:
            return
        
        with self.conn.cursor() as cur:
            execute_batch(cur, """
                INSERT INTO sensor_data 
                (time, experiment_id, sensor_idx, sensor_id,
                 temperature, pressure, humidity, gas_resistance, gas_index)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, self.buffer)
        self.conn.commit()
        logger.debug(f"写入 {len(self.buffer)} 条数据")
        self.buffer.clear()
    
    def close(self):
        """关闭连接"""
        self.flush()
        self.conn.close()
```

### 5.5 experiment_manager.py

```python
"""
实验流程管理
"""
from datetime import datetime
import time
import logging
from typing import Callable, List

from bme688_driver import BME688Driver, SensorData
from data_store import DataStore

logger = logging.getLogger(__name__)


class ExperimentManager:
    """实验管理器"""
    
    def __init__(self, serial_port: str = '/dev/ttyUSB0',
                 db_name: str = 'odor_lab'):
        self.driver = BME688Driver(serial_port)
        self.store = DataStore(dbname=db_name)
        self._label_schedule: List[tuple] = []  # [(time_sec, label_name, label_value), ...]
    
    def setup(self):
        """初始化设备和数据库"""
        # 初始化数据库
        self.store.init_schema()
        
        # 连接设备
        if not self.driver.connect():
            raise RuntimeError("无法连接传感器设备")
        
        # 同步时间
        if not self.driver.sync_time():
            raise RuntimeError("时间同步失败")
        
        # 初始化传感器
        if not self.driver.init():
            raise RuntimeError("传感器初始化失败")
        
        # 设置数据回调
        self.driver.set_data_callback(self._on_data)
        
        logger.info("实验系统初始化完成")
    
    def _on_data(self, data: SensorData):
        """数据回调"""
        self.store.add_data(data)
    
    def set_label_schedule(self, schedule: List[tuple]):
        """
        设置标签时间表
        schedule: [(elapsed_sec, label_name, label_value), ...]
        """
        self._label_schedule = sorted(schedule, key=lambda x: x[0])
    
    def run_experiment(self, name: str, duration_sec: int,
                       config: dict = None):
        """
        运行实验
        
        Args:
            name: 实验名称
            duration_sec: 实验时长 (秒)
            config: 实验配置
        """
        # 开始实验
        self.store.start_experiment(name, config)
        self.driver.start()
        
        start_time = time.time()
        label_idx = 0
        
        try:
            while True:
                elapsed = time.time() - start_time
                
                if elapsed >= duration_sec:
                    break
                
                # 检查标签时间表
                while (label_idx < len(self._label_schedule) and 
                       elapsed >= self._label_schedule[label_idx][0]):
                    _, label_name, label_value = self._label_schedule[label_idx]
                    self.store.set_label(label_name, label_value)
                    label_idx += 1
                
                time.sleep(0.1)
        
        finally:
            self.driver.stop()
            self.store.end_experiment()
            logger.info("实验结束")
    
    def cleanup(self):
        """清理资源"""
        self.driver.disconnect()
        self.store.close()


# ========== 使用示例 ==========
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    manager = ExperimentManager(
        serial_port='/dev/ttyUSB0',
        db_name='odor_lab'
    )
    
    try:
        manager.setup()
        
        # 设置标签时间表: 
        # 0-30秒: 背景空气
        # 30-60秒: 样品1
        # 60-90秒: 清洗
        manager.set_label_schedule([
            (0, "background", 0),
            (30, "sample_1", 1),
            (60, "flush", 0),
        ])
        
        # 运行 90 秒实验
        manager.run_experiment(
            name="酒精气味测试",
            duration_sec=90,
            config={"sample": "ethanol", "concentration": "100ppm"}
        )
    
    finally:
        manager.cleanup()
```

---

## 6. 数据查询示例

### 6.1 获取实验数据 + 标签

```sql
SELECT 
    d.time,
    d.sensor_idx,
    d.temperature,
    d.humidity,
    d.gas_resistance,
    d.gas_index,
    l.label_name,
    l.label_value
FROM sensor_data d
LEFT JOIN labels l ON 
    d.experiment_id = l.experiment_id 
    AND d.time >= l.start_time 
    AND (l.end_time IS NULL OR d.time < l.end_time)
WHERE d.experiment_id = 1
ORDER BY d.time;
```

### 6.2 按分钟聚合

```sql
SELECT 
    time_bucket('1 minute', time) AS minute,
    sensor_idx,
    AVG(temperature) AS avg_temp,
    AVG(gas_resistance) AS avg_gas,
    COUNT(*) AS points
FROM sensor_data
WHERE experiment_id = 1
GROUP BY minute, sensor_idx
ORDER BY minute, sensor_idx;
```

### 6.3 导出为 CSV

```sql
COPY (
    SELECT * FROM sensor_data WHERE experiment_id = 1
) TO '/tmp/experiment_1.csv' WITH CSV HEADER;
```

---

## 7. 部署检查清单

### ESP32 端

- [ ] 更新 `platformio.ini` 依赖
- [ ] 删除不需要的源文件
- [ ] 添加 `cmd_handler.*` 和 `data_reporter.*`
- [ ] 重写 `main.cpp`
- [ ] 精简 `utils.*` (移除 SD/RTC 依赖)
- [ ] 编译测试
- [ ] 串口通信测试

### 树莓派端

- [ ] 安装 PostgreSQL + TimescaleDB
- [ ] 创建数据库 `odor_lab`
- [ ] 安装 Python 依赖
- [ ] 测试串口连接
- [ ] 初始化数据库表结构
- [ ] 运行采集测试

---

## 8. 后续扩展

1. **液路/气路控制集成**: 在 `ExperimentManager` 中添加其他硬件控制
2. **Web UI**: 使用 Flask/FastAPI + Vue 创建实验控制界面  
3. **Grafana 可视化**: 连接 TimescaleDB 实时监控
4. **机器学习管道**: 使用采集的数据训练气味分类模型
