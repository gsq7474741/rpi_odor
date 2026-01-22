# 硬件连接指南 - BTT Octopus Pro V1.1 for RPi Odor

本文档基于 `ARCHITECTURE.md` 和 BTT Octopus Pro V1.1 引脚定义，详细说明电子鼻系统的硬件连接方案。

## 1. 步进电机 (蠕动泵)

系统使用 8 个蠕动泵，分别对应 Octopus Pro 的 8 个电机接口。
**驱动器设置**: 推荐使用 TMC2209，跳线帽设置为 UART 模式。

| 泵编号 | 功能 | Octopus 接口 | 步进引脚 (STEP) | 方向引脚 (DIR) | 使能引脚 (EN) | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pump 0** | (未安装) | **MOTOR 0** | PF13 | PF12 | PF14 | 可以在 printer.cfg 中注释掉 |
| **Pump 1** | (未安装) | **MOTOR 1** | PG0 | PG1 | PF15 | 可以在 printer.cfg 中注释掉 |
| **Pump 2** | 样品泵 0 (Sample 0) | **MOTOR 2** | PF11 | PG3 | PG5 | 有两个接口 (MOTOR 2-1/2-2)，内部并联，任选一个即可 |
| **Pump 3** | 样品泵 1 (Sample 1) | **MOTOR 3** | PG4 | PC1 | PA0 | |
| **Pump 4** | 样品泵 2 (Sample 2) | **MOTOR 4** | PF9 | PF10 | PG2 | |
| **Pump 5** | 样品泵 3 (Sample 3) | **MOTOR 5** | PC13 | PF0 | PF1 | |
| **Pump 6** | (未安装) | **MOTOR 6** | PE2 | PE3 | PD4 | 可以在 printer.cfg 中注释掉 |
| **Pump 7** | (未安装) | **MOTOR 7** | PE6 | PA14 | PE0 | 可以在 printer.cfg 中注释掉 |

> **提示**: 
> 1. **未使用的电机位**: 可以不插驱动模块，也不插电机。建议在 Klipper 配置中注释掉对应的 `[manual_stepper]` 部分，以免报错。
> 2. **MOTOR 2 双接口**: 这是为了方便双 Z 轴打印机设计的（两个电机同步转动）。对于蠕动泵应用，这两个口是完全并联的，插任意一个都可以，效果一样。
> 3. **堵转检测 (Diag) 跳线**: **不需要插**。这是用于无传感器归位 (Sensorless Homing) 的，蠕动泵不需要归位，也不需要检测堵转。如果不小心插了，可能会导致限位开关引脚信号异常。

## 2. 功率设备 (加热/气泵/阀门)

请确保输入电压 (POWER IN) 与您的外设电压匹配 (通常为 24V)。

| 设备名称 | 架构标识 | Octopus 接口 | 控制引脚 | 类型 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **气室加热带** | `heater_chamber` | **BED_OUT** | PA1 | 热床接口 | 功率大，需配合 T0 热敏电阻 |
| **废液阀** | `valve_waste` | **HE0** | PA2 | 加热棒接口 | 原 HE0 接口 |
| **夹管三通阀** | `valve_pinch` | **HE1** | PA3 | 加热棒接口 | 用于切换 气路/液路 |
| **三通气阀** | `valve_air` | **HE2** | PB10 | 加热棒接口 | 用于切换 排气/气室 |
| **出气阀** | `valve_outlet` | **HE3** | PB11 | 加热棒接口 | 气路通断控制 |

### 扩展设备连接

**清洗泵** 连接到 **CNC 风扇接口**，使用 24V DC 泵。

| 设备名称 | 架构标识 | Octopus 接口 | 控制引脚 | 类型 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **清洗泵** | `cleaning_pump` | **FAN0** | PA8 | CNC风扇接口 | 24V DC 泵，确保 V_FAN 跳线设为 24V |

> **提示**: Octopus Pro 拥有 6 个可控风扇接口 (FAN0-FAN5)，它们都是 MOS 管输出，非常适合驱动 24V 直流气泵/水泵 (电流 < 1A)。如果泵的功率很大 (>2A)，建议通过该接口控制外接继电器或 MOS 模块。

> **注意**: 
> 1. **气泵接线**: 您的气泵为三线制 (VCC, GND, PWM)。请将 VCC/GND 接到常通电源 (如 FAN 接口设为常开)，将 PWM 信号线接到 **BLTouch Servo (PB6)** 引脚。
> 2. **接口调整**: 已将加热带改至 **BED_OUT (PA1)** 以支持更大功率（如需）；废液阀改至 **HE0 (PA0)**。

## 3. 传感器

| 传感器名称 | 架构标识 | Octopus 接口 | 信号引脚 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| **气室温度** | `sensor_chamber` | **T0** | PF4 | NTC 100K 热敏电阻 |
| **称重模块** | `my_hx711` (HX711) | **SPI3_MISO** | PB4 | DOUT (数据) |
| | | **SPI3_SCK** | PB3 | SCLK (时钟) |
| **气泵控制** | `air_pump_pwm` | **BL_TOUCH** | PB6 | 伺服引脚，用于 PWM 信号 |

## 4. 通信与电源

*   **主电源**: 24V DC 开关电源接入 `POWER` 和 `MOTOR POWER` 接口。
*   **通信**: 通过 USB Type-C 连接到树莓派 USB 接口。
*   **跳线设置**:
    *   **V_FAN**: 设置为 VIN (24V) 以驱动 24V 气泵。
    *   **USB Power**: 移除跳线，避免从树莓派吸取过多电流（主板由 24V 供电）。

## 5. Klipper 配置说明

生成的配置文件位于 `klipper-config/printer.cfg`。

### HX711 称重模块
Klipper 官方主线已支持 `[load_cell]` 配置，使用 `sensor_type: hx711`。

配置示例：
```ini
[load_cell my_hx711]
sensor_type: hx711
sclk_pin: PB3    # SPI3_SCK
dout_pin: PB4    # SPI3_MISO
```

标定步骤：
1. 空盘时运行: `LOAD_CELL_DIAGNOSTIC LOAD_CELL=my_hx711`
2. 放已知重量后运行 `LOAD_CELL_CALIBRATE`
