# enose-sensor-firmware

> 电子鼻传感器板固件 - 作为树莓派上位机的传感器从设备

[![PlatformIO](https://img.shields.io/badge/PlatformIO-ESP32-orange)](https://platformio.org/)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue)](LICENSE)
[![Firmware Version](https://img.shields.io/badge/Version-2.1.0-green)](src/config.h)

## 概述

本项目是电子鼻气味采集系统的传感器板固件，运行在 ESP32 微控制器上，作为树莓派上位机 (`enose-control`) 的从设备。

### 在系统中的位置

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            服务层 (Raspberry Pi 5)                           │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐  │
│  │     enose-control (C++)         │   │    enose-analytics (Python)     │  │
│  │     实验流程 / 硬件驱动           │   │    数据质检 / 统计分析           │  │
│  └─────────────────────────────────┘   └─────────────────────────────────┘  │
│                 │                                                            │
│                 │ USB Serial (115200 baud, JSON)                             │
│                 ▼                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                           硬件层 (ESP32)                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              enose-sensor-firmware  ◄── 本项目                       │    │
│  │  ┌───────────────────────────────────────────────────────┐  │    │
│  │  │  BME688 x8 (数字 MOX)  或  GM102B x8 (模拟 MOX via SPI ADC)   │  │    │
│  │  │  温度 / 湿度 / 气压 / 气体电阻                                  │  │    │
│  │  └───────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 核心特性

| 特性 | 描述 |
|------|------|
| **多传感器类型支持** | BME688 数字 MOX、模拟 MOX (GM102B 等) |
| **抽象接口设计** | `ISensorArray` 接口，便于扩展新传感器类型 |
| **双串口模式** | 同时监听 USB 和 GPIO 串口，自动切换 |
| **JSON 通信** | 简单可靠的 JSON over Serial 协议 |
| **可配置加热器** | BME688 支持动态配置 10 步加热器曲线 |
| **LED 状态指示** | 闪烁频率指示运行状态和错误 |

---

## 快速开始

### 硬件需求

- **主控板**: Adafruit Feather ESP32 (或兼容板)
- **传感器板**: 
  - BME688 Development Kit (8 通道数字 MOX) - 默认
  - 或 GM102B 阵列 + ADS1256/MCP3208 ADC (模拟 MOX)
- **连接**: USB 线 (数据+供电)

### 开发环境

1. 安装 [PlatformIO](https://platformio.org/install)
2. 克隆仓库并打开项目：
   ```bash
   git clone <repo-url>
   cd enose-sensor-firmware
   code .  # 使用 VSCode + PlatformIO 插件
   ```

### 编译和烧录

```bash
# 编译
pio run

# 烧录
pio run --target upload

# 打开串口监视器
pio device monitor
```

---

## 配置

编辑 `src/config.h` 切换传感器类型和通信配置：

```c
// 传感器类型选择
#define SENSOR_TYPE         SENSOR_TYPE_BME688  // 或 SENSOR_TYPE_ANALOG

// 通信配置
#define SERIAL_BAUDRATE     115200
#define DUAL_SERIAL_MODE    1   // 启用双串口模式

// 模拟传感器专用 (SENSOR_TYPE_ANALOG)
#define ADC_TYPE            ADC_TYPE_ADS1256
#define ADC_CS_PIN          5
#define NUM_SENSORS         8
```

---

## 通信协议

### 物理层

| 参数 | 值 |
|------|-----|
| 接口 | USB Serial (CP2104) 或 GPIO 16/17 |
| 波特率 | 115200 (默认) |
| 数据格式 | 8N1 |
| 帧分隔 | `\n` (换行符) |

### 命令格式

**上位机 → ESP32**:
```json
{"cmd": "sync", "id": 1}
{"cmd": "init", "id": 2}
{"cmd": "config", "id": 3, "params": {"sensors": [0,1], "temps": [...], "durs": [...]}}
{"cmd": "start", "id": 4, "params": {"sensors": [0,1,2,3,4,5,6,7]}}
{"cmd": "stop", "id": 5}
{"cmd": "status", "id": 6}
{"cmd": "reset", "id": 7}
```

**ESP32 → 上位机 (响应)**:
```json
{"type": "ready", "version": "2.1.0", "sensors": 8}
{"type": "ack", "id": 1, "ok": true, "tick_ms": 12345}
{"type": "error", "id": 3, "code": -9, "msg": "CONFIG_FAILED"}
```

**ESP32 → 上位机 (数据流)**:
```json
{"type": "data", "tick": 12345, "s": 0, "id": 123456, "v": 12345.6, "st": "mox_d", "gi": 3, "T": 25.32, "H": 45.1, "P": 1013.2}
```

### 数据字段说明

| 字段 | 说明 | 单位 | 适用类型 |
|------|------|------|----------|
| `tick` | ESP32 启动后毫秒数 | ms | 全部 |
| `s` | 传感器索引 | 0-7 | 全部 |
| `id` | 传感器唯一 ID | - | 全部 |
| `v` | 主读数 (电阻/电压/ppb) | Ω/V/ppb | 全部 |
| `st` | 传感器类型 | `mox_d`/`mox_a`/`pid` | 全部 |
| `gi` | 加热器步骤索引 | 0-9 | 仅 mox_d |
| `ch` | ADC 通道 | 0-7 | 仅 mox_a |
| `T` | 温度 | °C | 可选 |
| `H` | 相对湿度 | % | 可选 |
| `P` | 气压 | hPa | 可选 |

---

## 项目结构

```
enose-sensor-firmware/
├── platformio.ini              # PlatformIO 配置
├── partition.csv               # ESP32 分区表
├── src/
│   ├── main.cpp                # 主程序入口
│   ├── config.h                # 编译时配置
│   ├── cmd_handler.*           # 串口命令处理器
│   ├── data_reporter.*         # 数据上报器
│   ├── led_controller.*        # LED 状态指示
│   ├── commMux.*               # I2C/SPI 多路复用 (BME688)
│   ├── utils.*                 # 工具函数
│   ├── demo_app.h              # 错误码定义 (兼容)
│   ├── core/
│   │   ├── sensor_array.h      # 传感器阵列抽象接口
│   │   └── sensor_types.h      # 统一数据类型定义
│   └── sensors/
│       ├── bme688_array.*      # BME688 数字 MOX 实现
│       └── analog_array.*      # 模拟 MOX 实现 (SPI ADC)
├── docs/
│   ├── PROTOCOL.md             # 通信协议详细文档
│   ├── HARDWARE.md             # 硬件连接指南
│   └── ARCHITECTURE.md         # 固件架构说明
└── test/
    └── serial_test/            # 串口测试脚本
```

---

## 扩展开发

### 添加新传感器类型

1. 在 `core/sensor_types.h` 中添加新的 `SensorType` 枚举值
2. 创建新的实现类，继承 `ISensorArray` 接口
3. 在 `config.h` 中添加配置选项
4. 在 `main.cpp` 中添加条件编译

示例接口：
```cpp
class ISensorArray {
public:
    virtual SensorError init() = 0;
    virtual uint8_t getSensorCount() const = 0;
    virtual SensorType getSensorType() const = 0;
    virtual bool readSensor(uint8_t idx, SensorReading& out) = 0;
    virtual uint8_t getNextReadySensor() = 0;
    virtual SensorError configure(const SensorConfig& config);
    virtual uint32_t getSensorId(uint8_t idx) const = 0;
};
```

---

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| LED 快速闪烁 (100ms) | 传感器初始化失败 | 检查 I2C/SPI 连接 |
| LED 慢速闪烁 (1s) | 正常运行 | - |
| 无串口输出 | 波特率不匹配 | 确认 115200 baud |
| `CONFIG_FAILED` 错误 | 加热器参数无效 | 检查 temps/durs 数组长度为 10 |
| 数据不连续 | 传感器唤醒延迟 | 正常，每次采集约 140ms 间隔 |

---

## 相关文档

- [通信协议详解](docs/PROTOCOL.md)
- [硬件连接指南](docs/HARDWARE.md)
- [固件架构说明](docs/ARCHITECTURE.md)
- [系统总架构](../docs/ARCHITECTURE.md)

---

## 许可证

本项目基于 BSD-3-Clause 许可证开源。部分代码来自 Bosch Sensortec，保留原有版权声明。