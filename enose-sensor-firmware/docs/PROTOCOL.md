# 通信协议详解

> enose-sensor-firmware 与上位机 (enose-control) 之间的 JSON over Serial 通信协议

## 1. 物理层

| 参数 | 值 | 说明 |
|------|-----|------|
| 接口 | USB Serial / UART | CP2104 或 GPIO 16/17 |
| 波特率 | 115200 | 可在 `config.h` 中修改 |
| 数据位 | 8 | - |
| 停止位 | 1 | - |
| 校验 | 无 | - |
| 帧分隔 | `\n` | 每条消息以换行符结尾 |

### 1.1 双串口模式

当 `DUAL_SERIAL_MODE=1` 时，固件同时监听两个串口：
- **主串口 (USB)**: Serial，通过 USB-TTL 芯片连接
- **备用串口 (GPIO)**: Serial2，GPIO 16 (RX) / 17 (TX)

收到命令后，响应和数据会发送到收到命令的那个串口。

---

## 2. 消息格式

所有消息都是 JSON 格式，以换行符 `\n` 结尾。

### 2.1 消息类型

| 方向 | 类型 | 说明 |
|------|------|------|
| 上位机 → ESP32 | 命令 | `cmd` 字段标识命令类型 |
| ESP32 → 上位机 | 就绪 | `type: "ready"` |
| ESP32 → 上位机 | 确认 | `type: "ack"` |
| ESP32 → 上位机 | 状态 | `type: "status"` |
| ESP32 → 上位机 | 错误 | `type: "error"` |
| ESP32 → 上位机 | 数据 | `type: "data"` |

---

## 3. 命令详解

### 3.1 sync - 时间同步

获取 ESP32 当前 tick 值，用于时间戳对齐。

**请求**:
```json
{"cmd": "sync", "id": 1}
```

**响应**:
```json
{"type": "ack", "id": 1, "ok": true, "tick_ms": 12345678}
```

**时间同步算法**:
```python
# 上位机侧
response = send_cmd({"cmd": "sync", "id": 1})
esp32_tick = response["tick_ms"]
time_offset = datetime.now() - timedelta(milliseconds=esp32_tick)

# 后续数据对齐
real_time = time_offset + timedelta(milliseconds=data["tick"])
```

### 3.2 init - 初始化传感器

初始化传感器阵列，使用默认加热器配置。

**请求**:
```json
{"cmd": "init", "id": 2}
```

或指定配置文件（已废弃，仅兼容）:
```json
{"cmd": "init", "id": 2, "params": {"config_file": "default.bmeconfig"}}
```

**响应**:
```json
{"type": "ack", "id": 2, "ok": true, "sensors": 8}
```

**错误响应**:
```json
{"type": "error", "id": 2, "code": -10, "msg": "INIT_FAILED"}
```

### 3.3 config - 配置加热器

动态配置 BME688 传感器的加热器曲线。仅适用于 `SENSOR_TYPE_BME688`。

**请求**:
```json
{
  "cmd": "config",
  "id": 3,
  "params": {
    "sensors": [0, 1, 2],
    "temps": [320, 100, 100, 100, 200, 200, 200, 320, 320, 320],
    "durs": [5, 2, 10, 30, 5, 5, 5, 5, 5, 5]
  }
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `sensors` | int[] | 目标传感器索引，省略则配置全部 |
| `temps` | int[10] | 加热器温度数组 (°C)，必须 10 个元素 |
| `durs` | int[10] | 加热器持续时间因子，必须 10 个元素 |

**响应**:
```json
{"type": "ack", "id": 3, "ok": true}
```

### 3.4 start - 开始采集

启动数据采集，可指定采集的传感器。

**请求**:
```json
{"cmd": "start", "id": 4, "params": {"sensors": [0, 1, 2, 3, 4, 5, 6, 7]}}
```

省略 `sensors` 则采集全部：
```json
{"cmd": "start", "id": 4}
```

**响应**:
```json
{"type": "ack", "id": 4, "ok": true}
```

**错误**（已在采集中）:
```json
{"type": "error", "id": 4, "code": -6, "msg": "ALREADY_RUNNING"}
```

### 3.5 stop - 停止采集

停止数据采集。

**请求**:
```json
{"cmd": "stop", "id": 5}
```

**响应**:
```json
{"type": "ack", "id": 5, "ok": true}
```

### 3.6 status - 获取状态

获取固件和传感器状态。

**请求**:
```json
{"cmd": "status", "id": 6}
```

**响应**:
```json
{
  "type": "status",
  "id": 6,
  "tick_ms": 12345678,
  "running": true,
  "sensors": [
    {"idx": 0, "id": 1234567, "ok": true},
    {"idx": 1, "id": 1234568, "ok": true},
    ...
  ]
}
```

### 3.7 reset - 重启设备

软重启 ESP32。

**请求**:
```json
{"cmd": "reset", "id": 7}
```

**响应**:
```json
{"type": "ack", "id": 7, "ok": true}
```

设备会在响应后约 100ms 重启。

---

## 4. 数据消息

采集启动后，ESP32 会持续上报传感器数据。

### 4.1 数据格式

**BME688 (数字 MOX)**:
```json
{
  "type": "data",
  "tick": 12345678,
  "s": 0,
  "id": 1234567,
  "v": 123456.7,
  "st": "mox_d",
  "gi": 3,
  "T": 25.32,
  "H": 45.12,
  "P": 1013.25
}
```

**模拟 MOX**:
```json
{
  "type": "data",
  "tick": 12345678,
  "s": 0,
  "id": 0,
  "v": 2.456,
  "st": "mox_a",
  "ch": 0
}
```

### 4.2 字段说明

| 字段 | 类型 | 说明 | 适用类型 |
|------|------|------|----------|
| `type` | string | 固定为 `"data"` | 全部 |
| `tick` | uint32 | ESP32 启动后毫秒数 | 全部 |
| `s` | uint8 | 传感器索引 (0-7) | 全部 |
| `id` | uint32 | 传感器唯一 ID | 全部 |
| `v` | float | 主读数 | 全部 |
| `st` | string | 传感器类型标识 | 全部 |
| `gi` | uint8 | 加热器步骤索引 (0-9) | mox_d |
| `ch` | uint8 | ADC 通道 | mox_a |
| `T` | float | 温度 (°C) | 可选 |
| `H` | float | 相对湿度 (%) | 可选 |
| `P` | float | 气压 (hPa) | 可选 |

### 4.3 传感器类型标识

| `st` 值 | 说明 |
|---------|------|
| `mox_d` | BME688 数字 MOX |
| `mox_a` | 模拟 MOX (SPI ADC) |
| `pid` | PID 传感器 (保留) |

### 4.4 主读数 (`v`) 单位

| 传感器类型 | 单位 | 说明 |
|-----------|------|------|
| mox_d | Ω | 气体电阻 |
| mox_a | V | ADC 电压 |
| pid | ppb | 浓度 |

---

## 5. 错误码

| 码值 | 常量 | 说明 |
|------|------|------|
| -10 | `EDK_BME68X_DRIVER_ERROR` | BME68x 驱动错误 |
| -9 | `EDK_SENSOR_MANAGER_CONFIG_FILE_ERROR` | 配置文件错误 |
| -8 | `EDK_SENSOR_MANAGER_SENSOR_INDEX_ERROR` | 传感器索引无效 |
| -7 | `EDK_SENSOR_MANAGER_JSON_DESERIAL_ERROR` | JSON 反序列化错误 |
| -6 | `EDK_SENSOR_MANAGER_JSON_FORMAT_ERROR` | JSON 格式错误 / 已在运行 |
| -5 | - | 无初始化处理器 |
| -4 | - | 未知命令 |
| -3 | - | 缺少 cmd 字段 |
| -2 | - | 缓冲区溢出 |
| -1 | - | JSON 解析错误 |
| 0 | `EDK_OK` | 成功 |

---

## 6. 就绪消息

设备启动后会发送就绪消息：

```json
{"type": "ready", "version": "2.1.0", "sensors": 8}
```

| 字段 | 说明 |
|------|------|
| `version` | 固件版本 |
| `sensors` | 传感器数量 |

---

## 7. 典型交互流程

```
上位机                          ESP32
   |                              |
   |                              | (启动)
   |<-------- ready --------------|
   |                              |
   |-------- sync --------------->|
   |<-------- ack (tick_ms) ------|
   |                              |
   |-------- init --------------->|
   |<-------- ack (sensors) ------|
   |                              |
   |-------- config ------------->| (可选)
   |<-------- ack ----------------|
   |                              |
   |-------- start -------------->|
   |<-------- ack ----------------|
   |                              |
   |<-------- data --------------|
   |<-------- data --------------|
   |<-------- data --------------|
   |          ...                 |
   |                              |
   |-------- stop --------------->|
   |<-------- ack ----------------|
   |                              |
```

---

## 8. 注意事项

1. **命令 ID**: 每个命令应有唯一 `id`，用于匹配响应
2. **超时**: 建议命令超时设为 5 秒
3. **数据频率**: BME688 每通道约 140ms 一次数据
4. **缓冲区**: 命令最大 1024 字节，超出会返回 `BUFFER_OVERFLOW` 错误
5. **重启**: `reset` 命令会导致连接断开，需重新建立
