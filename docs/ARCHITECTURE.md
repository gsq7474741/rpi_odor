# 电子鼻气味采集系统 - 架构设计文档

> 版本: 1.0.0  
> 更新日期: 2026-01-13

---

## 1. 项目概述

### 1.1 系统目标

构建一套自动化电子鼻气味采集系统，用于：
- 精确配制多组分液体样品
- 顶空气体采集与传感器阵列检测
- 实时数据质量监控
- 机器学习特征提取与模型训练

### 1.2 核心特性

| 特性 | 描述 |
|------|------|
| **多通道进样** | 4路样品蠠动泵 + 1路清洗泵(DC)，支持任意配方 |
| **闭环控制** | 称重反馈实现精确定量 |
| **多模式采气** | 支持旁路吹扫、液面扫气、液下鼓泡 |
| **温控防冷凝** | 出气端加热保持气路通畅 |
| **实时质检** | Python 分析服务在线检测数据质量 |
| **Web 可视化** | Next.js 前端实时监控与操作 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户层 (User Layer)                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    enose-ui (Next.js + TypeScript)                    │  │
│  │         实验配置 │ 手动控制 │ 实时曲线 │ 告警面板 │ 数据导出          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              ▲                                               │
│                              │ gRPC / WebSocket                              │
│                              ▼                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                            服务层 (Service Layer)                            │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐  │
│  │     enose-control (C++)         │◄─►│    enose-analytics (Python)     │  │
│  │  ┌───────────────────────────┐  │   │  ┌───────────────────────────┐  │  │
│  │  │ Executor (状态机)          │  │   │  │ 数据质量检测              │  │  │
│  │  │ IO Driver (硬件驱动)       │  │   │  │ 在线统计分析              │  │  │
│  │  │ Data Pump (数据转发)       │  │   │  │ 模型推理 (可选)           │  │  │
│  │  └───────────────────────────┘  │   │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘   └─────────────────────────────────┘  │
│                 │                                                            │
│                 │ Serial/USB                                                 │
│                 ▼                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                           硬件层 (Hardware Layer)                            │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐  │
│  │   传感器板 (ESP32 + BME688×8)   │   │   执行器板 (Octopus + Klipper)   │  │
│  │  ┌───────────────────────────┐  │   │  ┌───────────────────────────┐  │  │
│  │  │ 8通道 MOX 气体传感器       │  │   │  │ 8× 蠕动泵 (1清洗+7液体)    │  │  │
│  │  │ 温度/湿度/气压采集         │  │   │  │ 1× 气泵 (PWM)             │  │  │
│  │  │ JSON 串口通信             │  │   │  │ 4× 电磁阀                 │  │  │
│  │  └───────────────────────────┘  │   │  │ 1× 加热器 (PID)           │  │  │
│  └─────────────────────────────────┘   │  │ 1× 称重传感器 (HX711)      │  │  │
│                                        │  └───────────────────────────┘  │  │
│                                        └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 通信拓扑

```
                    ┌──────────────┐
                    │  Raspberry   │
                    │     Pi 5     │
                    └──────┬───────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │  USB/TTL  │   │  USB/TTL  │   │  Ethernet │
     │ (Serial)  │   │ (Serial)  │   │    /WiFi  │
     └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │  ESP32    │   │  Octopus  │   │   enose   │
     │ 传感器板  │   │  执行器板  │   │    -ui    │
     └───────────┘   └───────────┘   └───────────┘
```

---

## 3. 硬件组成

### 3.1 传感器板抽象定义 (Sensor Board Abstraction)

为适配不同类型的传感器板，系统定义了统一的传感器板元数据结构：

```yaml
# 传感器板配置示例 (sensor_board.yaml)
sensor_board:
  # 基础信息
  id: "bme688-devkit-v1"
  name: "BME688 Development Kit"
  vendor: "Bosch"
  firmware_version: "1.0.0"
  
  # 通信配置
  communication:
    protocol: "serial"           # serial | spi | i2c | usb
    baudrate: 115200
    data_format: "json"          # json | binary | protobuf
    port_pattern: "/dev/ttyUSB*" # 设备匹配模式
  
  # 通道配置
  channels:
    count: 8                     # 主传感器通道数
    type: "mox"                  # mox | pid | ec | ir
    sensors:
      - index: 0
        model: "BME688"
        unit: "ohm"              # 电阻值单位
        range: [100, 1000000]    # 有效量程
      # ... 通道 1-7 类似
  
  # 环境通道 (温湿度等)
  environment_channels:
    - name: "temperature"
      unit: "celsius"
      source: "per_channel"      # per_channel | shared | external
      range: [-40, 85]
    - name: "humidity"
      unit: "percent_rh"
      source: "per_channel"
      range: [0, 100]
    - name: "pressure"
      unit: "hPa"
      source: "per_channel"
      range: [300, 1100]
  
  # 采样配置
  sampling:
    mode: "continuous"           # continuous | on_demand
    base_rate_hz: 1.0            # 基础采样率
  
  # 时间戳配置
  timestamp:
    source: "device"             # device | host | ntp
    resolution_us: 1000          # 时间戳分辨率 (微秒)
    sync_method: "startup"       # startup | periodic | on_demand
    max_drift_ms: 100            # 最大允许漂移
  
  # 数据帧格式
  frame_format:
    fields:
      - name: "tick"
        type: "uint64"
        description: "设备启动后的毫秒数"
      - name: "sensor_index"
        type: "uint8"
        description: "传感器通道索引"
      - name: "gas_resistance"
        type: "float32"
        description: "气体电阻值"
      - name: "temperature"
        type: "float32"
        description: "温度"
      - name: "humidity"
        type: "float32"
        description: "相对湿度"
      - name: "pressure"
        type: "float32"
        description: "气压"
      - name: "heater_step"
        type: "uint8"
        description: "当前加热器步进"
```

#### 3.1.1 时间戳对齐策略

| 策略 | 描述 | 适用场景 |
|------|------|---------|
| **device_tick** | 使用设备本地 tick，上位机记录接收时间 | 低延迟要求 |
| **host_interpolate** | 上位机根据接收时间插值对齐 | 多板同步 |
| **ntp_sync** | 设备和上位机都使用 NTP 时间 | 高精度要求 |

```python
# 时间戳对齐伪代码
class TimestampAligner:
    def __init__(self, board_config):
        self.sync_method = board_config.timestamp.sync_method
        self.offset_ms = 0  # 设备时间与主机时间的偏移
    
    def sync(self, device_tick, host_time):
        """同步设备时间与主机时间"""
        self.offset_ms = host_time - device_tick
    
    def align(self, device_tick) -> float:
        """将设备 tick 转换为统一时间戳"""
        return device_tick + self.offset_ms
```

#### 3.1.2 当前实现: BME688 开发套件

| 组件 | 型号/规格 | 数量 | 功能 |
|------|----------|------|------|
| 主控 | ESP32 (Feather) | 1 | 控制与通信 |
| 气体传感器 | BME688 | 8 | MOX 气体检测 + T/H/P |
| 通信接口 | USB-TTL | 1 | 115200 baud, JSON |

**通信协议**: JSON over Serial（详见 `bme-dev-kit-odor` 项目）

#### 3.1.3 扩展示例: PID 传感器阵列

```yaml
# 未来可能的 PID 传感器板配置
sensor_board:
  id: "pid-array-v1"
  name: "PID Sensor Array"
  channels:
    count: 4
    type: "pid"
    sensors:
      - index: 0
        model: "PID-A1"
        unit: "ppb"
        range: [0, 10000]
  environment_channels:
    - name: "temperature"
      source: "shared"  # 共享一个温度传感器
  sampling:
    mode: "continuous"
    base_rate_hz: 10.0
```

### 3.2 执行器板 (Actuator Board)

| 组件 | 型号/规格 | 数量 | 功能 |
|------|----------|------|------|
| 主控板 | BTT Octopus Pro (STM32F446) | 1 | Klipper 固件 |
| 步进驱动 | TMC2209 | 8 | 蠕动泵驱动 |
| 蠕动泵 | 6-4变径 4*6硅胶 | 8 | 泵0清洗 + 泵1-7液体进样 |
| 汇流排 | 主8边4 10通 | 1 | 多通道液体汇流 |
| 气泵 | KVP04-24 (3*5硅胶) | 1 | PWM 载气/鼓泡 |
| 活性炭过滤管 | - | 1 | 空气净化 |
| 真空过滤器 | ZFC-100-06B | 1 | 气路过滤 |
| 单向阀 | 4*6硅胶 | 1 | 防倒流 |
| 洗气瓶 | 150ml 下口 (GL14 16#PBT头) | 1 | 鼓泡/顶空 |
| 电磁阀 | 24V DC | 4 | 气路/液路切换 |
| 称重模块 | HX711 + 压力传感器 | 1 | 洗气瓶下方，闭环定量 |
| 加热带 | 24V | 1 | 气室前防冷凝 |
| 热敏电阻 | NTC 100K | 1 | 温度反馈 |

**通信协议**: Klipper 虚拟串口 (`/tmp/printer`) 或 Moonraker HTTP API

### 3.3 气路/液路设计

```
气路流程:
空气 → 活性炭过滤管 → 真空过滤器(ZFC-100-06B) → 气泵(KVP04-24,PWM)
     → 单向阀 → 夹管三通阀 ─┬─→ 洗气瓶(鼓泡) → 出气阀 → 三通气阀 ─┬─→ 加热带 → 传感器板 → 气室 → 排气
                            │                                    │
                            └─→ (气路直通时)  ─────────────────────┘

液路流程:
液体瓶(0-3) → 样品泵(pump_2-5) ─┐
                              ├─→ 主8边4 10通(汇流) → 夹管三通阀 → 洗气瓶
清洗瓶 → 清洗泵(FAN0 DC) ──────┘
                                                    ↓
                                              废液阀 → 废液桶
```

### 3.4 阀门状态定义

| 阀门 | 标识 | 状态 0 | 状态 1 |
|------|------|--------|--------|
| 夹管三通阀 | `valve_pinch` | 液路通 | 气路通 |
| 废液阀 | `valve_waste` | 关闭 | 排废开 |
| 出气阀 | `valve_outlet` | 关闭 (堵头) | 开启 (气通) |
| 三通气阀 | `valve_air` | 排气 | 气室通 |

### 3.5 气路模式说明

> ⚠️ **重要**: 系统默认工作在 **鼓泡模式**，无法通过电磁阀自动切换到吹扫模式。
> 切换到吹扫模式需要 **手动调整洗气瓶的进气管高度**（将进气管提升到液面以上）。

| 模式 | 进气管位置 | 工作方式 | 用途 |
|------|-----------|---------|------|
| **鼓泡模式** (默认) | 液面以下 | 气体从液体底部通过产生气泡 | 采样、平衡 |
| **吹扫模式** (手动) | 液面以上 | 气体从液面上方吹过 | 基线恢复 (空瓶时) |

---

## 4. 软件服务

### 4.1 enose-control (C++)

**职责**: 硬件控制、实验状态机、业务逻辑校验

| 模块 | 功能 |
|------|------|
| **Executor** | 按 Phase 执行实验计划状态机 |
| **IO Driver** | 串口驱动 MCU，控制泵/阀，带重试/超时/错误上报 |
| **Data Pump** | 采集/转发 SensorFrame，汇总 AnalysisResult |

**技术栈**: C++17, gRPC, Protobuf, Boost.Asio, spdlog

**gRPC 服务接口** (定义于 `proto/enose_service.proto`):

| 服务 | 方法 | 描述 |
|------|------|------|
| **ControlService** | `GetStatus` | 获取系统状态和所有外设状态 |
| | `SetSystemState` | 切换系统状态 (INITIAL/DRAIN) |
| | `ManualControl` | 手动控制单个外设 |
| | `RunPump` | 启动泵 (步进泵需指定速度/距离) |
| | `StopAllPumps` | 停止所有泵 |
| | `SubscribeEvents` | 订阅系统事件流 (Server Streaming) |
| | `SubscribePeripheralStatus` | 订阅外设状态更新流 |
| **DataService** | `SubscribeSensorData` | 订阅传感器数据流 |
| | `SubscribeAnalysisResults` | 订阅分析结果流 |

**默认端口**: `50051`

### 4.2 enose-analytics (Python)

**职责**: 实时数据质量检测、在线统计、可选模型推理

| 模块 | 功能 |
|------|------|
| **Quality Checker** | 基线稳定性、漂移、饱和、噪声检测 |
| **Statistics** | 在线均值/方差/趋势计算 |
| **Model Inference** | 可选的在线模型打分 |

**技术栈**: Python 3.11+, gRPC, NumPy, Pandas, Matplotlib, scikit-learn

**质检指标**:

| 指标 | 标识 | 描述 |
|------|------|------|
| 基线不稳 | `QF_BASELINE_UNSTABLE` | 吹扫期间信号斜率过大 |
| 传感器饱和 | `QF_SENSOR_SATURATION` | 信号超出有效量程 |
| 噪声过大 | `QF_EXCESS_NOISE` | 信号方差超过阈值 |
| 湿度异常 | `QF_HUMIDITY_OUT_OF_RANGE` | 相对湿度超出范围 |
| 温度异常 | `QF_TEMP_OUT_OF_RANGE` | 温度超出范围 |
| 流量异常 | `QF_FLOW_SUSPECTED` | 信号特征暗示流量问题 |

### 4.3 enose-ui (Next.js + TypeScript)

**职责**: 实验配置、手动控制、运行监控、数据可视化

| 页面 | 功能 |
|------|------|
| **Dashboard** | 系统状态总览、当前运行信息 |
| **Experiment** | 实验计划编辑、配方管理 |
| **Control** | 手动控制面板 (调试用) |
| **Monitor** | 实时曲线、传感器数据 |
| **Alerts** | 告警列表、质检结果 |
| **History** | 历史数据查询、导出 |

**技术栈**: Next.js 14, TypeScript, TailwindCSS, Recharts, gRPC-Web

---

## 5. 工作流程

### 5.1 标准实验流程

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    单样本采集周期                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│  ┌───────┐   ┌─────────────┐   ┌─────────┐   ┌─────────────────────────────────────────┐   │
│  │ DOSE  │──►│ EQUILIBRATE │──►│ ACQUIRE │──►│              CLEANUP (×N)               │   │
│  │ 进样  │   │  平衡（混合） │   │  采集   │   │  ┌───────┐   ┌───────┐   ┌───────────┐ │   │
│  └───────┘   └─────────────┘   └─────────┘   │  │ DRAIN │──►│ RINSE │──►│ DRAIN     │ │   │
│                                              │  │ 排废  │   │ 清洗  │   │ 再排废    │ │   │
│                                              │  └───────┘   └───────┘   └───────────┘ │   │
│                                              └─────────────────────────────────────────┘   │
│                                                              │                             │
│                                                              ▼                             │
│                                              ┌─────────────────────────────────────────┐   │
│                                              │           BASELINE_RECOVERY             │   │
│                                              │      空瓶进气恢复基线 (可能短暂失压)      │   │
│                                              └─────────────────────────────────────────┘   │
│                                                              │                             │
└──────────────────────────────────────────────────────────────┼─────────────────────────────┘
                                                               │
                                                               ▼
                                                        (下一个样本)
```

> ⚠️ **注意**: 在 `BASELINE_RECOVERY` 阶段，由于洗气瓶为空瓶状态进行基线恢复，
> 气室可能会有一段时间处于 **无正压状态**，这是正常现象。

### 5.2 状态机定义

```
                              ┌──────────────┐
                              │     IDLE     │◄────────────────┐
                              │    空闲      │                 │
                              └──────┬───────┘                 │
                                     │ StartRun               │
                                     ▼                         │
                              ┌──────────────┐                 │
                    ┌────────►│ INITIALIZING │                 │
                    │         │    初始化    │                 │
                    │         └──────┬───────┘                 │
                    │                │                         │
                    │                ▼                         │
                    │         ┌──────────────┐                 │
                    │         │   HEATING    │                 │
                    │         │    预热      │                 │
                    │         └──────┬───────┘                 │
                    │                │ temp >= target          │
                    │                ▼                         │
                    │         ┌──────────────┐                 │
           Reset    │         │   RUNNING    │─────────────────┤ Finished
                    │         │   运行中     │                 │
                    │         └──────┬───────┘                 │
                    │                │ Abort                   │
                    │                ▼                         │
                    │         ┌──────────────┐                 │
                    │         │   ABORTED    │─────────────────┘
                    │         │   已中止     │
                    │         └──────────────┘
                    │
                    │         ┌──────────────┐
                    └─────────│    ERROR     │
                              │    故障      │
                              └──────────────┘
```

### 5.3 Phase 详细定义

| Phase | valve_pinch | valve_waste | valve_outlet | valve_air | 泵动作 | 说明 |
|-------|-------------|-------------|--------------|-----------|--------|------|
| **DOSE** | 液路(0) | 关(0) | 关(0) | 气室(1) | 蠕动泵按配方 | 称重闭环进样 |
| **EQUILIBRATE** | 气路(1) | 关(0) | 开(1) | 气室(1) | 气泵低速 | 鼓泡平衡顶空 |
| **ACQUIRE** | 气路(1) | 关(0) | 开(1) | 气室(1) | 气泵设定流量 | 采集传感器数据 |
| **DRAIN** | 气路(1) | 开(1) | 开(1) | 排气(0) | 气泵全速 | 顶空加压排液 |
| **RINSE** | 液路(0) | 关(0) | 关(0) | 气室(1) | 清洗泵 | 注入清洗液 |
| **BASELINE_RECOVERY** | 气路(1) | 关(0) | 开(1) | 气室(1) | 气泵 PWM | 空瓶鼓泡恢复基线 |

### 5.4 清洗排废循环 (CLEANUP)

每个样本采集完成后，需要执行 **N 次** 清洗排废循环（N 可配置，默认 2-3 次）：

```
for i in range(cleanup_cycles):  # 默认 2-3 次
    DRAIN()      # 排废
    RINSE()      # 注入清洗液
    DRAIN()      # 再次排废
```

清洗完成后进入 `BASELINE_RECOVERY` 阶段，使用空瓶进行基线恢复。

---

## 6. 通信协议

### 6.1 服务间通信

| 通信路径 | 协议 | 方向 | 内容 |
|----------|------|------|------|
| UI → Control | gRPC (unary) | 请求/响应 | 实验计划、控制命令 |
| Control → UI | gRPC (stream) | 服务端推送 | Event, SensorFrame |
| Control → Analytics | gRPC (stream) | 双向流 | SensorFrame → AnalysisResult |
| Analytics → Control | gRPC (stream) | 客户端推送 | AnalysisResult (质检告警) |

### 6.2 核心消息类型

```protobuf
// 传感器帧
message SensorFrame {
  Timestamp ts = 1;
  uint64 seq = 2;
  repeated double mox = 3;    // 8通道 MOX 读数
  double temp_c = 4;
  double rh = 5;
  Id run_id = 10;
  string phase_name = 11;
  GasMode gas_mode = 12;
}

// 分析结果
message AnalysisResult {
  Timestamp ts = 1;
  uint64 sensor_seq = 2;
  repeated Metric metrics = 3;
  repeated QualityFlag flags = 4;
  repeated string recommendations = 10;
}

// 系统事件
message Event {
  Timestamp ts = 1;
  uint64 seq = 2;
  EventType type = 3;
  Severity severity = 4;
  string text = 5;
  repeated KeyValue fields = 6;
}
```

### 6.3 传感器板通信 (ESP32)

**协议**: JSON over Serial @ 115200 baud

**命令格式** (Host → ESP32):
```json
{"cmd": "start", "id": 1, "params": {"sensors": [0,1,2,3,4,5,6,7]}}
```

**响应格式** (ESP32 → Host):
```json
{"type": "ack", "id": 1, "ok": true}
```

**数据格式** (ESP32 → Host):
```json
{"type": "data", "tick": 12345, "s": 0, "id": 123456, "T": 25.3, "P": 1013.2, "H": 45.1, "R": 12345.6, "gi": 3}
```

### 6.4 执行器板通信 (Klipper)

**协议**: Moonraker HTTP API 或虚拟串口 G-code

**示例命令**:
```gcode
SET_PIN PIN=valve_pinch VALUE=1      ; 切换到气路
MANUAL_STEPPER STEPPER=pump_1 MOVE=100 SPEED=10 SYNC=0  ; 泵1运行
SET_PIN PIN=air_pump VALUE=0.8       ; 气泵 80% 功率
SET_HEATER_TEMPERATURE HEATER=outlet_heater TARGET=80  ; 设置加热温度
```

---

## 7. 数据流

### 7.1 实验数据流

```
BME688 Sensors ──► ESP32 ──► enose-control ──┬──► TimescaleDB (存储)
                                              │
                                              ├──► enose-analytics (质检)
                                              │
                                              └──► enose-ui (可视化)
```

### 7.2 数据存储

| 表 | 内容 | 保留策略 |
|----|------|---------|
| `sensor_frames` | 原始传感器数据 | 压缩后保留 1 年 |
| `events` | 系统事件日志 | 保留 3 个月 |
| `analysis_results` | 质检结果 | 保留 6 个月 |
| `experiments` | 实验元数据 | 永久保留 |

---

## 8. 部署架构

### 8.1 单机部署 (推荐)

```
┌─────────────────────────────────────────┐
│            Raspberry Pi 5               │
│  ┌─────────────────────────────────┐   │
│  │       Docker Compose            │   │
│  │  ┌───────────┬───────────────┐  │   │
│  │  │ control   │ analytics     │  │   │
│  │  │ (C++)     │ (Python)      │  │   │
│  │  ├───────────┼───────────────┤  │   │
│  │  │ ui        │ timescaledb   │  │   │
│  │  │ (Next.js) │ (PostgreSQL)  │  │   │
│  │  └───────────┴───────────────┘  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  USB ──► ESP32 (传感器)                 │
│  USB ──► Octopus (执行器)               │
└─────────────────────────────────────────┘
```

### 8.2 目录结构

```
rpi_odor/
├── docs/
│   └── ARCHITECTURE.md          # 本文档
├── protos/
│   └── enose/v1/enose.proto     # Protobuf 定义
├── enose-control/               # C++ 控制服务
│   ├── src/
│   ├── include/
│   └── CMakeLists.txt
├── enose-analytics/             # Python 分析服务
│   ├── src/
│   ├── requirements.txt
│   └── pyproject.toml
├── enose-ui/                    # Next.js 前端
│   ├── src/
│   └── package.json
├── klipper-config/              # Klipper 配置
│   └── printer.cfg
├── docker-compose.yml
└── README.md
```

---

## 9. 开发路线图

### Phase 1: 基础功能 (MVP)
- [ ] ESP32 传感器板固件 (已完成 refactor/rpi-driver)
- [ ] C++ 控制服务骨架
- [ ] Klipper 配置文件
- [ ] 基础 Protobuf 定义
- [ ] 手动控制 API

### Phase 2: 自动化
- [ ] 实验状态机
- [ ] 称重闭环控制
- [ ] 温度 PID 控制
- [ ] Python 质检基础指标

### Phase 3: 可视化
- [ ] Next.js UI 框架
- [ ] 实时曲线
- [ ] 实验配置界面
- [ ] 告警面板

### Phase 4: 高级功能
- [ ] 流量标定
- [ ] 自动清洗
- [ ] 模型在线推理
- [ ] 数据导出与报告

---

## 10. 附录

### A. 硬件采购清单

| 类别 | 名称 | 型号 | 数量 | 备注 |
|------|------|------|------|------|
| 主控 | 树莓派 | Pi 5 8GB | 1 | 建议配散热风扇 |
| 传感器 | BME688 开发套件 | Bosch Dev Kit | 1 | 含 8 个传感器 |
| 执行器主板 | BTT Octopus Pro | STM32F446 | 1 | |
| 步进驱动 | TMC2209 | UART 版 | 8 | 泵0清洗+泵1-7液体 |
| 蠕动泵 | 步进蠕动泵 | 6-4变径 4*6硅胶 | 8 | 泵0清洗+泵1-7液体 |
| 汇流排 | 多通道分配器 | 主板4×10通 | 1 | 液体汇流 |
| 气泵 | 微型气泵 | KVP04-24 (3*5硅胶) | 1 | PWM 可调 |
| 活性炭过滤管 | 空气净化 | - | 1 | 进气端 |
| 真空过滤器 | 气路过滤 | ZFC-100-06B | 1 | 气泵前 |
| 单向阀 | 防倒流 | 4*6硅胶 | 1 | 气泵后 |
| 洗气瓶 | 下口瓶 | 150ml GL14 16#PBT头 | 1 | 鼓泡/顶空 |
| 电磁阀 | 夹管三通/出气/三通气/废液 | 24V DC | 4 | |
| 称重模块 | HX711 + 传感器 | 5kg | 1 | 洗气瓶下方 |
| 加热套件 | 加热带 + NTC | 24V + 100K | 1 | 气室前防冷凝 |
| 硅胶管 | 气路/液路 | 4*6 / 6*8 / 8*12 | 若干 | |
| 快拧接头 | 管路连接 | M3 / GL14 16#PBT | 若干 | |

### B. 参考资料

- [Klipper 文档](https://www.klipper3d.org/Overview.html)
- [Moonraker API](https://moonraker.readthedocs.io/en/latest/web_api/)
- [BME688 数据手册](https://www.bosch-sensortec.com/products/environmental-sensors/gas-sensors/bme688/)
- [gRPC C++ 快速入门](https://grpc.io/docs/languages/cpp/quickstart/)
- [Next.js 文档](https://nextjs.org/docs)
