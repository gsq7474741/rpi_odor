# 硬件连接指南 - BTT Octopus Pro V1.0 for RPi Odor

本文档基于 `ARCHITECTURE.md` 和 BTT Octopus Pro V1.0 引脚定义，详细说明电子鼻系统的硬件连接方案。

## 1. 步进电机 (蠕动泵)

系统使用 8 个蠕动泵，分别对应 Octopus Pro 的 8 个电机接口。
**驱动器设置**: 使用 TMC2209，跳线帽设置为 UART 模式。

| 泵编号 | 功能 | Octopus 接口 | 步进引脚 (STEP) | 方向引脚 (DIR) | 使能引脚 (EN) | UART 引脚 | G1 轴映射 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pump 0** | 样品泵 0 | **MOTOR 0** | PF13 | PF12 | PF14 | PC4 | A |
| **Pump 1** | 样品泵 1 | **MOTOR 1** | PG0 | PG1 | PF15 | PD11 | B |
| **Pump 2** | 样品泵 2 | **MOTOR 2** | PF11 | PG3 | PG5 | PC6 | C |
| **Pump 3** | 样品泵 3 | **MOTOR 3** | PG4 | PC1 | PA0 | PC7 | D |
| **Pump 4** | 样品泵 4 | **MOTOR 4** | PF9 | PF10 | PG2 | PF2 | H |
| **Pump 5** | 样品泵 5 | **MOTOR 5** | PC13 | PF0 | PF1 | PE4 | I |
| **Pump 6** | 样品泵 6 | **MOTOR 6** | PE2 | PE3 | PD4 | PE1 | J |
| **Pump 7** | 样品泵 7 | **MOTOR 7** | PE6 | PA14 | PE0 | PD3 | K |

> **提示**: 
> 1. **驱动器配置**: 所有泵使用 TMC2209 驱动器，通过 UART 模式通信，运行电流 0.8A，启用静音模式 (StealthChop)。
> 2. **并行控制**: 通过 `REGISTER_PUMPS_TO_AXIS` 宏将泵注册到 G1 坐标轴 (A/B/C/D/H/I/J/K)，支持单条 G1 命令同时控制多个泵。
> 3. **单位转换**: `rotation_distance=1.492` 配置使得 1mm = 1ml，速度单位为 ml/s，最大速度 6.0 ml/s (约 240 RPM)。
> 4. **MOTOR 2 双接口**: 为双 Z 轴打印机设计，内部并联，对于蠕动泵应用任选一个接口即可。
> 5. **堵转检测 (Diag) 跳线**: **不需要插**。蠕动泵不需要归位或堵转检测，插入该跳线可能导致信号异常。

## 2. 功率设备 (加热/气泵/阀门)

请确保输入电压 (POWER IN) 与您的外设电压匹配 (通常为 24V)。

| 设备名称 | 架构标识 | Octopus 接口 | 控制引脚 | 类型 | 逻辑 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **气室加热带** | `heater_chamber` | **BED_OUT** | PA1 | 热床接口 | - | 已禁用，预留用于温控加热 |
| **废液阀** | `valve_waste` | **HE0** | PA2 | 开关输出 | 0=关闭, 1=开启 | 废液排放阀门 |
| **夹管三通阀** | `valve_pinch` | **HE1** | PA3 | 开关输出 | 0=气路, 1=液路 | 气液路切换 |
| **三通气阀** | `valve_air` | **HE2** | PB10 | 开关输出 | 0=排气, 1=气室 | 气路方向控制 |
| **出气阀** | `valve_outlet` | **HE3** | PB11 | 开关输出 | 0=开启, 1=关闭 | 反向逻辑，默认开启 |

### 扩展设备连接

| 设备名称 | 架构标识 | Octopus 接口 | 控制引脚 | 类型 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **清洗泵** | `cleaning_pump` | **FAN0** | PA8 | PWM 输出 | 24V DC 泵，确保 V_FAN 跳线设为 24V |
| **急停指示灯** | `estop_led` | **FAN1** | PE5 | PWM 输出 | 呼吸灯效果，急停时熄灭 |
| **进样风扇** | `inject_fan` | **FAN2** | PD12 | 开关输出 | 与夹管阀联动，液路时开启 |
| **进样风扇2** | `inject_fan_2` | **FAN3** | PD13 | 开关输出 | 与夹管阀联动，液路时开启 |
| **急停按钮** | `estop_button` | **POWER_DET** | PA9 | 数字输入 | NC 常闭开关，按下触发 M112 |

> **提示**: 
> 1. **风扇接口**: Octopus Pro 拥有 6 个可控风扇接口 (FAN0-FAN5)，均为 MOS 管输出，适合驱动 24V DC 负载 (< 1A)。大功率设备建议通过继电器或外接 MOS 模块。
> 2. **气泵接线**: 气泵为三线制 (VCC, GND, PWM)，VCC/GND 接 24V 电源，PWM 信号线接 **BLTouch Servo (PB6)** 引脚。
> 3. **急停系统**: 急停按钮使用 NC (常闭) 开关，按下时触发 Klipper M112 急停；急停指示灯平时呼吸闪烁，急停时熄灭。

## 3. 传感器

| 传感器名称 | 架构标识 | Octopus 接口 | 信号引脚 | 类型 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **气室温度** | `sensor_chamber` | **T0** | PF4 | NTC 100K | 已禁用，预留温控加热用 |
| **称重模块** | `my_hx711` | **SPI3** | PB4 (DOUT) | HX711 | 数据线 |
| | | | PB3 (SCLK) | | 时钟线，采样率 10Hz |
| **气泵 PWM** | `air_pump_pwm` | **BL_TOUCH** | PB6 | PWM 输出 | 三线气泵的信号线 |

## 4. 通信与电源

*   **主电源**: 24V DC 开关电源接入 `POWER` 和 `MOTOR POWER` 接口。
*   **通信**: 通过 USB Type-C 连接到树莓派 USB 接口。
*   **跳线设置**:
    *   **V_FAN**: 设置为 VIN (24V) 以驱动 24V 气泵。
    *   **USB Power**: 移除跳线，避免从树莓派吸取过多电流（主板由 24V 供电）。

## 5. Klipper 配置说明

配置文件位于 `klipper-config/printer.cfg`。

### 5.1 泵并行控制

系统使用 `REGISTER_PUMPS_TO_AXIS` 宏将 8 个泵注册到 G1 坐标轴，实现单条命令并行控制：

```gcode
REGISTER_PUMPS_TO_AXIS
G1 A10 B20 C30 D40 H50 I60 J70 K80 F480
# A~K 对应 pump_0~7，数值为体积 (ml)，F 为速度 (ml/min)
```

### 5.2 称重传感器

使用 Klipper 原生 `[load_cell]` 支持：

```ini
[load_cell my_hx711]
sensor_type: hx711
sclk_pin: PB3
dout_pin: PB4
sample_rate: 10
```

标定步骤：

1. 空盘时运行: `QUERY_LOAD_CELL SENSOR=my_hx711`
2. 放已知重量后运行: `LOAD_CELL_CALIBRATE`

### 5.3 急停系统

* **按钮**: PA9 引脚，NC 常闭开关，按下触发 M112
* **指示灯**: PE5 引脚，由后端控制呼吸效果 (50ms 周期，正弦波)

### 5.4 WebSocket 通信

C++ 后端通过 Moonraker WebSocket (端口 7125) 与 Klipper 通信：

* 发送 G-code 命令 (`printer.gcode.script`)
* 订阅状态更新 (`notify_status_update`)
* 监听固件状态 (`notify_klippy_ready/shutdown`)
* 查询称重数据 (`load_cell my_hx711`)
