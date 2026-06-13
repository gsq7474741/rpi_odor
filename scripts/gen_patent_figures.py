"""
专利申请书风格附图生成脚本。

风格要求：
  - 纯黑白线框（不使用填充色或彩色），与中国/PCT 专利说明书附图一致
  - 单线粗细 1.0pt，字体 SimHei，DPI 200
  - 元素：矩形（功能块）、双线矩形（核心模块）、菱形（决策）、
         圆角矩形（外部系统）、虚线（事件/异步信号）、实线（命令/数据流）

输出目录: docs/figures/
"""

from __future__ import annotations

import os
from pathlib import Path

import matplotlib
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Polygon, Rectangle

# -------------------- 全局样式 --------------------
matplotlib.rcParams['font.sans-serif'] = ['SimHei']
matplotlib.rcParams['axes.unicode_minus'] = False
matplotlib.rcParams['font.size'] = 9
matplotlib.rcParams['lines.linewidth'] = 1.0
matplotlib.rcParams['patch.linewidth'] = 1.0
matplotlib.rcParams['axes.linewidth'] = 1.0

LW = 1.0           # 默认线宽
LW_BOLD = 1.6      # 强调线宽（核心模块的双线效果用此宽度代替）
ARROW_KW = dict(arrowstyle='-|>', mutation_scale=10, lw=LW, color='black')
DASHED_ARROW_KW = dict(arrowstyle='-|>', mutation_scale=10, lw=LW,
                       color='black', linestyle=(0, (4, 2)))

OUTPUT_DIR = Path(__file__).resolve().parent.parent / 'docs' / 'figures'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# -------------------- 通用绘图原语 --------------------
def setup_ax(ax: plt.Axes, w: float, h: float, title: str = '') -> None:
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.set_aspect('equal')
    ax.axis('off')
    if title:
        # 专利附图标题通常以"图 N"形式出现，正文已说明，此处仅用于本脚本预览
        ax.set_title(title, fontsize=10, pad=4)


def rect(ax, x, y, w, h, text='', fontsize=9, double=False, dashed=False):
    """绘制矩形。double=True 时画双线表示核心模块；dashed=True 为虚线框。"""
    ls = (0, (4, 2)) if dashed else '-'
    ax.add_patch(Rectangle((x, y), w, h, fill=False, lw=LW, ls=ls))
    if double:
        inset = 0.08
        ax.add_patch(Rectangle((x + inset, y + inset),
                               w - 2 * inset, h - 2 * inset,
                               fill=False, lw=LW))
    if text:
        ax.text(x + w / 2, y + h / 2, text,
                ha='center', va='center', fontsize=fontsize)


def rrect(ax, x, y, w, h, text='', fontsize=9, pad=0.12):
    """圆角矩形（用于外部系统）。"""
    box = FancyBboxPatch((x + pad, y + pad), w - 2 * pad, h - 2 * pad,
                         boxstyle=f'round,pad=0,rounding_size={pad}',
                         fill=False, lw=LW)
    ax.add_patch(box)
    if text:
        ax.text(x + w / 2, y + h / 2, text, ha='center', va='center',
                fontsize=fontsize)


def diamond(ax, cx, cy, w, h, text='', fontsize=9):
    pts = [(cx, cy + h / 2), (cx + w / 2, cy),
           (cx, cy - h / 2), (cx - w / 2, cy)]
    ax.add_patch(Polygon(pts, fill=False, lw=LW, closed=True))
    if text:
        ax.text(cx, cy, text, ha='center', va='center', fontsize=fontsize)


def arrow(ax, p1, p2, dashed=False, label=None, label_offset=(0, 0.15),
          fontsize=8, conn='arc3,rad=0'):
    kw = dict(DASHED_ARROW_KW if dashed else ARROW_KW)
    kw['connectionstyle'] = conn
    ax.add_patch(FancyArrowPatch(p1, p2, **kw))
    if label:
        mx = (p1[0] + p2[0]) / 2 + label_offset[0]
        my = (p1[1] + p2[1]) / 2 + label_offset[1]
        ax.text(mx, my, label, ha='center', va='center', fontsize=fontsize,
                bbox=dict(boxstyle='round,pad=0.15', fc='white', ec='none'))


def label(ax, x, y, text, fontsize=9, ha='center', va='center', white_bg=False):
    kw = dict(ha=ha, va=va, fontsize=fontsize)
    if white_bg:
        kw['bbox'] = dict(boxstyle='round,pad=0.18', fc='white', ec='none')
    ax.text(x, y, text, **kw)


def save(fig, name):
    path = OUTPUT_DIR / name
    fig.savefig(path, dpi=200, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f'  -> {path}')


# ============================================================
# 图3 系统五层架构总体框图
# ============================================================
def fig3_system_architecture():
    fig, ax = plt.subplots(figsize=(13, 8))
    setup_ax(ax, 26, 16, '图3 系统五层架构总体框图')

    # 五层主体（缩小宽度到 16，让出右侧给数据库旁挂）
    layers = [
        ('L5 人机交互层  enose-ui (Next.js + React Flow)', 13.5),
        ('L4 微服务层  enose-control (C++ gRPC)  /  enose-analytics (Python gRPC)', 11.0),
        ('L3 工作流与状态机层  执行器 / 状态机 / 监控器 / 校验器', 8.5),
        ('L2 硬件抽象层 (HAL)  ActuatorDriver / SensorDriver / LoadCellDriver', 6.0),
        ('L1 下位机与固件层  Klipper @ BTT Octopus Pro  /  ESP32 传感器固件', 3.5),
        ('L0 物理硬件层  蠕动泵x8 / 气泵 / 电磁阀x4 / 加热带 / BME688x8 / HX711 / 气室', 1.0),
    ]
    for text, y in layers:
        rect(ax, 1.0, y - 0.7, 18.0, 1.4, text, fontsize=9.5)

    # 层间通信箭头（双向）放到左右两侧
    arrows = [
        (13.5, 11.0, 'HTTP / SSE / gRPC-Web'),
        (11.0, 8.5, '函数调用 / 共享数据库'),
        (8.5, 6.0, 'Boost.Signals2 信号槽'),
        (6.0, 3.5, 'Moonraker WS / USB 串口'),
        (3.5, 1.0, 'G-code / PWM / I2C'),
    ]
    for y1, y2, txt in arrows:
        arrow(ax, (19.4, y1 - 0.7), (19.4, y2 + 0.7))
        arrow(ax, (0.6, y2 + 0.7), (0.6, y1 - 0.7))
        label(ax, 10.0, (y1 + y2) / 2, txt, fontsize=8)

    # 数据库 / 缓存（右外侧旁挂，挂在 L4 旁）
    rrect(ax, 20.5, 11.5, 5.0, 1.8, 'TimescaleDB\n(15 张表 + 压缩)', fontsize=8.5)
    rrect(ax, 20.5, 9.0, 5.0, 1.8, 'Redis 缓存\n(对齐序列)', fontsize=8.5)
    # 旁挂连线
    arrow(ax, (19.0, 11.0), (20.5, 12.0), dashed=True)
    arrow(ax, (20.5, 12.0), (19.0, 11.0), dashed=True)
    arrow(ax, (19.0, 11.0), (20.5, 9.5), dashed=True)
    arrow(ax, (20.5, 9.5), (19.0, 11.0), dashed=True)

    save(fig, 'fig03_system_architecture.png')


# ============================================================
# 图4 液体进样与气路控制流程图（阶段-阀门/泵 状态时序）
# ============================================================
def fig4_phase_timeline():
    fig, ax = plt.subplots(figsize=(12, 7))
    setup_ax(ax, 24, 14, '图4 液体进样与气路控制阶段-外设状态时序图')

    phases = ['PREHEAT', 'DOSE', 'EQUILIBRATE', 'ACQUIRE', 'DRAIN', 'RINSE', 'BASELINE']
    n = len(phases)
    x0, x_w = 4.0, 2.8

    # 阶段标题行
    for i, p in enumerate(phases):
        x = x0 + i * x_w
        rect(ax, x, 12.0, x_w, 1.2, p, fontsize=9)

    # 外设行
    rows = [
        ('夹管三通阀',   ['气路', '液路', '气路', '气路', '气路', '液路', '气路']),
        ('废液阀',       ['关',   '关',   '关',   '关',   '开',   '关',   '关']),
        ('出气阀',       ['开',   '关',   '关',   '开',   '开',   '关',   '开']),
        ('三通气阀',     ['气室', '排气', '气室', '气室', '排气', '排气', '气室']),
        ('样品泵×8',     ['停',   '进样', '停',   '停',   '停',   '停',   '停']),
        ('清洗泵',       ['停',   '停',   '停',   '停',   '停',   '注入', '停']),
        ('气泵 PWM',     ['低',   '0',    '低',   '中',   '高',   '0',    '中']),
    ]
    for r, (name, vals) in enumerate(rows):
        y = 10.5 - r * 1.4
        # 行名
        rect(ax, 0.4, y, 3.4, 1.2, name, fontsize=9)
        # 各阶段状态
        for i, v in enumerate(vals):
            x = x0 + i * x_w
            rect(ax, x, y, x_w, 1.2, v, fontsize=8.5)

    # 底部时间轴箭头
    arrow(ax, (x0, 0.4), (x0 + n * x_w, 0.4))
    label(ax, x0 + n * x_w / 2, 0.1, '时间 t →', fontsize=9)

    save(fig, 'fig04_phase_timeline.png')


# ============================================================
# 图9 四级分层实验执行架构示意图（含 RAII 守卫）
# ============================================================
def fig9_layered_executor():
    fig, ax = plt.subplots(figsize=(13, 9))
    setup_ax(ax, 26, 18, '图9 四级分层实验执行架构与 RAII 事务守卫')

    # 主体宽度收缩到 20，右侧留 6 给 RAII 守卫旁注
    rect(ax, 1, 15.5, 20, 1.6,
         'L3a 实验执行器 ExperimentService::execution_thread_func\n(顺序遍历步骤 / 阶段切换 / 注入 DataQualityMonitor / 用户余量断点)',
         fontsize=9, double=True)
    rect(ax, 1, 12.0, 20, 2.6,
         'L3b 原语执行器  IActionExecutor + ActionExecutorFactory\n'
         '  InjectExecutor    DrainExecutor    WashExecutor\n'
         '  AcquireExecutor   PreheatExecutor  HeaterConfigExecutor',
         fontsize=9, double=True)
    rect(ax, 1, 7.5, 10, 3.5,
         'L3c 硬件状态机 HardwareStateMachine\n'
         '13 个细粒度状态：\n'
         '  IDLE / *_PREPARING / *_RUNNING / *_STABILIZING\n'
         '  / ERROR / EMERGENCY_STOP\n'
         '+ 状态转换矩阵 valid_transitions_',
         fontsize=8.5, double=True)
    rect(ax, 14, 7.5, 7, 3.5,
         'L3d 系统状态机 SystemState\n'
         '5 个工作状态：\n'
         '  INITIAL / DRAIN / CLEAN /\n  SAMPLE / INJECT\n'
         '+ PeripheralState 矩阵\n+ 差分下发\n  apply_peripheral_state',
         fontsize=8.5, double=True)

    # L0 硬件
    rect(ax, 1, 4.0, 20, 1.6,
         'Klipper @ BTT Octopus Pro  <-(Moonraker WS)->  ActuatorDriver',
         fontsize=9)

    # 右侧 RAII 守卫旁注（不再遮挡 L3b 内部）
    rect(ax, 21.5, 12.0, 4.0, 2.6,
         'RAII 事务守卫\nStateTransactionGuard\n构造记录初态\n析构自动回滚\ncommit_and_restore',
         fontsize=8, dashed=True)
    arrow(ax, (21.5, 13.3), (21.0, 13.3), dashed=True)

    # 调用箭头
    arrow(ax, (11, 15.5), (11, 14.6))
    arrow(ax, (6, 12.0), (6, 11.0))                            # L3b→L3c
    label(ax, 6, 11.5, 'request_transition', fontsize=8, white_bg=True)
    arrow(ax, (17, 12.0), (17, 11.0))                          # L3b→L3d
    label(ax, 17, 11.5, 'state-change call', fontsize=8, white_bg=True)
    # L3c↔L3d 互动：拉开 L3d 到 x=14 后，中间空隙 x=11..14 有 3 个单位
    arrow(ax, (11, 9.8), (14, 9.8))                            # L3c→L3d 预检（上方）
    label(ax, 12.5, 10.1, '预检', fontsize=8, white_bg=True)
    arrow(ax, (14, 8.5), (11, 8.5), dashed=True)               # L3d→L3c 反向同步（下方）
    label(ax, 12.5, 8.85, 'set_state_callback  反向同步',
          fontsize=7.5, white_bg=True)
    arrow(ax, (17, 7.5), (17, 5.6))                            # L3d→Klipper

    # 右侧 RAII 守卫示意（移到画布右外侧，不遮挡 L3b 内文本）

    # 旁挂监控器
    rect(ax, 0.4, 1.8, 6, 1.5, 'RuntimeTracker\n(外设状态差分计时)', fontsize=8.5, dashed=True)
    rect(ax, 7.8, 1.8, 6, 1.5, 'DataQualityMonitor\n(加热周期/阶段感知)', fontsize=8.5, dashed=True)
    rect(ax, 15.2, 1.8, 6, 1.5, 'StabilityMonitor\n(传感器×加热步分组判稳)', fontsize=8.5, dashed=True)
    for x in (3.4, 10.8, 18.2):
        arrow(ax, (x, 3.3), (x, 4.0), dashed=True)

    save(fig, 'fig09_layered_executor.png')


# ============================================================
# 图10 GCODE_AXIS 并行进样时序图
# ============================================================
def fig10_gcode_axis_timing():
    fig, ax = plt.subplots(figsize=(12, 9))
    setup_ax(ax, 24, 18, '图10 基于 GCODE_AXIS 的多通道并行进样时序图')

    # 上半：8 轴速度曲线（共享 t0/t3，各轴峰值明显不同→体现不同体积）
    axes_names = ['A (泵0)', 'B (泵1)', 'C (泵2)', 'D (泵3)',
                  'H (泵4)', 'I (泵5)', 'J (泵6)', 'K (泵7)']
    base_y = 7.5
    track_h = 0.9
    t0, t1, t2, t3 = 4.0, 5.5, 18.5, 20.0    # 共享关键时刻（8 轴同时开始/结束）
    # 8 轴的峰值相对高度（映射为各自体积 v_i）
    peak_ratios = [0.85, 0.40, 0.65, 0.30, 0.75, 0.55, 0.20, 0.50]
    volumes_ml = [4.5, 1.8, 3.2, 1.0, 3.8, 2.5, 0.6, 2.2]

    for i, name in enumerate(axes_names):
        y = base_y + i * (track_h + 0.1)
        # 轴标签包含轴名 + 体积
        label(ax, 3.0, y + track_h / 2,
              f'{name}  V={volumes_ml[i]:.1f}ml',
              fontsize=8.5, ha='right')
        # 时间轨道
        ax.plot([t0 - 0.5, 22], [y, y], color='black', lw=LW * 0.6)
        # 轴峰值不同 → 梯形高度不同 → 体积不同
        peak = y + track_h * peak_ratios[i]
        ax.plot([t0, t1, t2, t3], [y, peak, peak, y], color='black', lw=LW)
        # 标出峰值速度指示
        label(ax, t1 - 0.3, peak, f'v{i}', fontsize=7, ha='right',
              va='bottom')

    # 时间轴
    arrow(ax, (3.5, 6.5), (22.5, 6.5))
    label(ax, 22.5, 6.2, 't', fontsize=9, ha='left')
    for tx, lab in [(t0, 't0\n指令下发'),
                    (t1, 't1\n加速完成'),
                    (t2, 't2\n减速开始'),
                    (t3, 't3\n全部停止')]:
        ax.plot([tx, tx], [6.4, 6.6], color='black', lw=LW)
        label(ax, tx, 5.9, lab, fontsize=8)

    # 下半：指令时序
    rect(ax, 0.5, 3.0, 23, 2.0,
         '上位机下发单条 G-code: '
         '"G1  A{v0}  B{v1}  C{v2}  D{v3}  H{v4}  I{v5}  J{v6}  K{v7}  F{feedrate}"\n'
         '（Klipper 运动规划器在统一时基下做加减速插值，8 轴严格同步开始/结束）',
         fontsize=9, double=True)

    rect(ax, 0.5, 0.3, 11.0, 2.0,
         '配置阶段：\n'
         'REGISTER_PUMPS_TO_AXIS\n'
         '  pump_0→A  pump_1→B  pump_2→C  pump_3→D\n'
         '  pump_4→H  pump_5→I  pump_6→J  pump_7→K',
         fontsize=8.5, dashed=True)

    rect(ax, 12.0, 0.3, 11.5, 2.0,
         '停止：ENOSE_ASYNC_STOP\n'
         '  reactor 异步回调 → 重置 need_step_gen_time\n'
         '  → wipe_trapq → remove_extra_axis → do_enable(False)\n'
         '  → commanded_pos = 0  （≈ 1 s 内可靠停止）',
         fontsize=8.5, dashed=True)

    # 顶部标题区（上移到 y=16.3，与最高 peak ≈14.95 之间留 ~1.3 单位空白）
    rect(ax, 0.5, 16.3, 23, 1.3,
         '本发明：单条 G1 指令并行驱动 8 台步进蠕动泵 (传统方案需 8 条顺序指令)',
         fontsize=9.5)

    save(fig, 'fig10_gcode_axis_timing.png')


# ============================================================
# 图11 称重闭环控制框图
# ============================================================
def fig11_load_cell_feedback():
    fig, ax = plt.subplots(figsize=(13, 6))
    setup_ax(ax, 26, 12, '图11 带滞后补偿的称重闭环进样/清洗控制框图')

    # 主回路（从左到右）
    rect(ax, 0.5, 7.5, 3.5, 2.0, '目标体积\nV_ml', fontsize=9)
    rect(ax, 4.5, 7.5, 3.8, 2.0,
         '线性标定模型\ndw = V * slope + offset',
         fontsize=8.5, double=True)
    rect(ax, 8.8, 7.5, 3.8, 2.0,
         '滞后补偿\ntrig = dw - lag_comp',
         fontsize=8.5, double=True)
    # 比较节点
    diamond(ax, 14.5, 8.5, 1.6, 1.8, '比较', fontsize=8)
    rect(ax, 16.5, 7.5, 3.8, 2.0,
         '停泵触发\n(InjectExecutor)',
         fontsize=8.5)
    rect(ax, 20.8, 7.5, 4.5, 2.0,
         'ActuatorDriver\n→ Klipper → 蠕动泵',
         fontsize=8.5)

    # 反馈回路
    rect(ax, 20.8, 3.0, 4.5, 2.0,
         '洗气瓶 + HX711\n称重传感器',
         fontsize=8.5)
    rect(ax, 14.5, 3.0, 4.5, 2.0,
         'LoadCellDriver\n滑窗滤波/稳定性/趋势',
         fontsize=8.5, double=True)
    rect(ax, 8.8, 3.0, 4.5, 2.0,
         '实测增量\ndw_measured',
         fontsize=9)

    # 箭头：前向
    arrow(ax, (4.0, 8.5), (4.5, 8.5))
    arrow(ax, (8.3, 8.5), (8.8, 8.5))
    arrow(ax, (12.6, 8.5), (13.7, 8.5))
    arrow(ax, (15.3, 8.5), (16.5, 8.5))
    arrow(ax, (20.3, 8.5), (20.8, 8.5))
    # 物理：泵 → 瓶
    arrow(ax, (23.0, 7.5), (23.0, 5.0), label='输液', label_offset=(0.5, 0))
    # 反馈
    arrow(ax, (20.8, 4.0), (19.0, 4.0))
    arrow(ax, (14.5, 4.0), (13.3, 4.0))
    arrow(ax, (8.8, 4.0), (8.8, 7.0), dashed=False)
    # 反馈到比较节点
    arrow(ax, (10.7, 5.0), (14.5, 7.6), label='dw_measured', label_offset=(0, 0.3))

    # 底部说明
    rect(ax, 0.5, 0.6, 25.0, 1.6,
         '配套机制：（i）"称重模式 / 定时模式"双模可选；（ii）wait_for_empty_bottle 动态空瓶判定；'
         '（iii）零点-参考值两步标定；（iv）连续 N 次未达稳定阈值触发超时保护',
         fontsize=8.5, dashed=True)

    save(fig, 'fig11_load_cell_feedback.png')


# ============================================================
# 图12 归一化时间轴重采样算法示意图
# ============================================================
def fig12_aligned_series():
    fig, ax = plt.subplots(figsize=(12, 8))
    setup_ax(ax, 24, 16, '图12 多通道异步采集的归一化时间轴重采样对齐算法')

    rng = np.random.default_rng(7)

    # ---- (a) 原始异步数据：3 颗示例传感器 ----
    label(ax, 12, 15.3, '(a) 原始异步采集（每颗传感器加热配置不同，采样时刻不均匀）',
          fontsize=9.5)
    sensors = [('传感器 0', 13.5), ('传感器 1', 12.2), ('传感器 2', 10.9)]
    t_min_real, t_max_real = 1.5, 22.0
    for name, y in sensors:
        label(ax, 1.0, y, name, fontsize=8.5, ha='left')
        # 时间基线
        ax.plot([3.5, 22.5], [y, y], color='black', lw=LW * 0.6)
        # 不均匀采样点
        n_pts = rng.integers(18, 28)
        pts = np.sort(rng.uniform(t_min_real, t_max_real, n_pts))
        for t in pts:
            ax.plot([t], [y], marker='o', color='black', ms=2.5,
                    markerfacecolor='white', mew=LW)
        # 用细折线连接
        # 数据值随便给个变化形状（视觉上各传感器不同）
        vals = 0.25 + 0.18 * np.sin(0.3 * (pts - t_min_real) + sensors.index((name, y)))
        ax.plot(pts, y + vals, color='black', lw=LW * 0.6,
                linestyle=(0, (2, 2)))

    # ---- (b) 归一化时间 ----
    label(ax, 12, 9.6, '(b) 对每颗传感器独立做时间归一化  t_norm = (t - t_min) / (t_max - t_min)',
          fontsize=9.5)
    arrow(ax, (12, 10.4), (12, 9.9))

    # ---- (c) 共享网格 + 插值 ----
    label(ax, 12, 8.2, '(c) 在共享 N 点采样网格 grid = linspace(0, 1, N) 上做 linear / PCHIP 插值',
          fontsize=9.5)
    grid_y = 6.6
    ax.plot([3.5, 22.5], [grid_y, grid_y], color='black', lw=LW * 0.6)
    N = 12
    grid_xs = np.linspace(4.0, 22.0, N)
    for gx in grid_xs:
        ax.plot([gx, gx], [grid_y - 0.18, grid_y + 0.18],
                color='black', lw=LW)
    label(ax, 1.0, grid_y, '统一网格', fontsize=8.5, ha='left')
    label(ax, 22.7, grid_y, '0  ··· 1', fontsize=8, ha='left')

    # ---- (d) 输出矩阵 ----
    arrow(ax, (12, 5.9), (12, 5.2))
    rect(ax, 6.5, 2.0, 11.0, 3.0,
         '输出对齐序列  shape = (N, 32)\n'
         '32 通道排列：'
         'value × 8  →  temperature × 8  →  humidity × 8  →  pressure × 8\n'
         '附带元数据：每颗传感器原始点数、时间跨度、插值方法',
         fontsize=9, double=True)

    # ---- 配套优化（移到画面下方，避免遮挡上方传感器时间轴） ----
    rect(ax, 0.5, 0.1, 11.0, 1.8,
         '配套：Redis 缓存\n + 失败退避 + 并发去重锁',
         fontsize=8.5, dashed=True)
    rect(ax, 12.5, 0.1, 11.0, 1.8,
         '后台 SeriesBackfillTask\n监听新样品 -> 自动回填对齐序列',
         fontsize=8.5, dashed=True)

    save(fig, 'fig12_aligned_series.png')


# ============================================================
# 图13 数据质量监控双感知数据结构
# ============================================================
def fig13_quality_monitor():
    fig, ax = plt.subplots(figsize=(12, 8))
    setup_ax(ax, 24, 16, '图13 加热周期感知 × 阶段感知的实时数据质量监控')

    # 左：8 传感器 × 10 加热步 矩阵
    label(ax, 7, 15.2, '(a) 双感知矩阵  SensorTracker[8] × StepTracker[10]', fontsize=9.5)
    mx0, my0 = 1.5, 7.0
    cell_w, cell_h = 1.2, 0.7
    for s in range(8):
        # 行标签
        label(ax, mx0 - 0.4, my0 + s * cell_h + cell_h / 2,
              f'S{s}', fontsize=8, ha='right')
        for k in range(10):
            x = mx0 + k * cell_w
            y = my0 + s * cell_h
            rect(ax, x, y, cell_w, cell_h, '', fontsize=8)
    # 列标签
    for k in range(10):
        label(ax, mx0 + k * cell_w + cell_w / 2, my0 + 8 * cell_h + 0.3,
              f'step\n{k}', fontsize=7)
    # 单元格内含义
    rect(ax, mx0 + 3 * cell_w, my0 + 6 * cell_h, cell_w, cell_h, '', fontsize=8, double=True)
    arrow(ax, (mx0 + 14.0, my0 + 6 * cell_h + 0.35),
          (mx0 + 3 * cell_w + cell_w, my0 + 6 * cell_h + cell_h / 2),
          dashed=True)
    rect(ax, mx0 + 14.0, my0 + 6.5 * cell_h - 0.5, 5.5, 1.2,
         '每格存放：cycle_values 滑窗\n(最近 N 周期此步的读数)',
         fontsize=8, dashed=True)

    # 阶段感知
    rect(ax, mx0 + 14.0, my0 + 1.5, 5.5, 1.5,
         '阶段感知：\non_phase_change()\n离开 BASELINE 时\nanchor_baseline()',
         fontsize=8, dashed=True)
    arrow(ax, (mx0 + 14.0, my0 + 2.0), (mx0 + 12.0, my0 + 2.0), dashed=True)

    # 右下：11 类并发检测
    label(ax, 12, 4.8, '(b) 11 类并发质量检测（每读数即时 + 每 80 读数批量）', fontsize=9.5)
    items = [
        'cycle_integrity\n(跳步/卡步)',
        'saturation\n(电阻饱和)',
        'environment\n(温湿度漂移)',
        'liveness\n(心跳超时)',
        'reproducibility\n(周期 CV)',
        'group_consistency\n(同组一致性)',
        'response\n(响应比)',
        'data_completeness\n(丢包率)',
        'noise_std\n(噪声标准差)',
        'drift\n(基线漂移)',
        'baseline_cv\n(基线变异)',
    ]
    cols = 6
    cw, ch = 3.7, 1.0
    for i, t in enumerate(items):
        r, c = divmod(i, cols)
        x = 0.5 + c * (cw + 0.1)
        y = 3.5 - r * (ch + 0.1)
        rect(ax, x, y, cw, ch, t, fontsize=7.5)

    # 顶部聚合
    rect(ax, 0.5, 0.4, 23.0, 0.9,
         '聚合 → 告警去重合并 (alert_id = flag + sensor_idx + heater_step) → '
         '量化质量评分(0~100) → 写入 samples.quality_score',
         fontsize=8.5, double=True)

    save(fig, 'fig13_quality_monitor.png')


# ============================================================
# 图15 软件微服务架构图
# ============================================================
def fig15_microservices():
    fig, ax = plt.subplots(figsize=(12, 9))
    setup_ax(ax, 24, 18, '图15 软件微服务架构与多端协同')

    # 顶部：前端
    rect(ax, 1, 15.2, 22, 1.8,
         'enose-ui (Next.js + TypeScript + React Flow + shadcn/ui)\n'
         '  /system  /consumables  /run  /workflow  /data-center  /experiments',
         fontsize=9, double=True)

    # 中间：两个微服务（左右并排）
    rect(ax, 1, 8.5, 11, 5.5,
         'enose-control  (C++17 / Boost.Asio / gRPC)\n\n'
         '  ControlService        手动控制 / 紧急停止 / 状态订阅\n'
         '  ExperimentService     程序校验 / 加载 / 执行 / 暂停 / 恢复\n'
         '  ConsumableService     液体 / 泵绑定 / 耗材寿命 / 标签\n'
         '  SensorService         传感器命令 / 加热预设 CRUD\n'
         '  LoadCellService       标定 / 读数 / 标线\n'
         '  TestService           独立单元测试流程',
         fontsize=8.5, double=True)
    rect(ax, 12.5, 8.5, 10.5, 5.5,
         'enose-analytics  (Python / gRPC)\n\n'
         '  AnalyticsService      实时质检 / 可视化 / 对齐序列\n'
         '  ModelService          训练任务 / 推理 / 进度流\n'
         '  LabelService          人工标签\n'
         '  MLLabelService        8 种自动标签策略\n'
         '  SampleService         样品查询\n'
         '  DataService / ExportService',
         fontsize=8.5, double=True)

    # 协议（左侧）——两条箭头上下错开，标签右移加白底
    arrow(ax, (4.5, 15.2), (4.5, 14.0))
    arrow(ax, (5.5, 14.0), (5.5, 15.2), dashed=True)
    label(ax, 8.5, 14.6, 'gRPC-Web (Next.js API Route)',
          fontsize=8, white_bg=True)
    # 协议（右侧）
    arrow(ax, (17.5, 15.2), (17.5, 14.0))
    arrow(ax, (18.5, 14.0), (18.5, 15.2), dashed=True)
    label(ax, 21.0, 14.6, 'gRPC-Web + SSE 推流',
          fontsize=8, white_bg=True)

    # 控制服务 ↔ 分析服务（数据库共享）
    arrow(ax, (12, 11.2), (12.5, 11.2), dashed=True)
    label(ax, 12.25, 11.5, 'DB', fontsize=7.5)

    # 数据持久化层
    rect(ax, 1, 5.2, 11, 2.4,
         'TimescaleDB (15 张表)\n'
         'sensor_readings_v2 / samples / runs / phases / labels / models …\n'
         '（hypertable 自动分片 + segment_by 列式压缩）',
         fontsize=8.5)
    rect(ax, 12.5, 5.2, 10.5, 2.4,
         'Redis\n'
         '对齐序列缓存 / 会话状态 / 任务去重锁',
         fontsize=8.5)

    arrow(ax, (6, 8.5), (6, 7.6))
    arrow(ax, (6, 7.6), (6, 8.5), dashed=True)
    arrow(ax, (17, 8.5), (17, 7.6))
    arrow(ax, (17, 7.6), (17, 8.5), dashed=True)

    # 底部：硬件
    rect(ax, 1, 1.8, 11, 2.2,
         '硬件层（受控）\n'
         'Klipper @ BTT Octopus Pro  ←(Moonraker WS / G-code)→\n'
         '8× 步进蠕动泵 / 气泵 / 4 阀 / HX711',
         fontsize=8.5)
    rect(ax, 12.5, 1.8, 10.5, 2.2,
         '传感器层\n'
         'ESP32 固件  ←(USB 串口 / JSON)→\n'
         '8× BME688 (10 步加热曲线/颗)',
         fontsize=8.5)
    arrow(ax, (6, 5.2), (6, 4.0))
    arrow(ax, (6, 4.0), (6, 5.2), dashed=True)
    arrow(ax, (17, 5.2), (17, 4.0))
    arrow(ax, (17, 4.0), (17, 5.2), dashed=True)

    # 底注
    label(ax, 12, 0.7,
          '所有跨服务通信均以 Protobuf 严格定义，由 buf generate 一致生成 C++ / Python / TypeScript 三端代码',
          fontsize=8.5)

    save(fig, 'fig15_microservices.png')


# ============================================================
# 图16 机器学习数据流水线
# ============================================================
def fig16_ml_pipeline():
    fig, ax = plt.subplots(figsize=(13, 8.5))
    setup_ax(ax, 26, 17, '图16 机器学习数据流水线')

    # 主链路（从左到右 5 个节点）下移到 y=5.5，为顶部标签策略让出空间
    nodes = [
        (0.5, '1. 数据采集\nExperimentService\n→ samples / readings\n+ quality_score'),
        (5.5, '2. 自动回填\nSeriesBackfillTask\n→ 对齐序列\n(Redis 缓存)'),
        (10.7, '3. 自动标签\nLabelGenerator\n→ sample_ml_labels'),
        (15.8, '4. 数据集构建\nDatasetBuilder\n→ (X, y) + split'),
        (20.7, '5. 训练 / 推理\nTrainingManager\nModelService\n→ ml_models'),
    ]
    node_y, node_h = 7.5, 3.2
    for x, t in nodes:
        rect(ax, x, node_y, 4.5, node_h, t, fontsize=8.5, double=True)

    # 箭头
    for i in range(4):
        x1 = nodes[i][0] + 4.5
        x2 = nodes[i + 1][0]
        arrow(ax, (x1, node_y + node_h / 2), (x2, node_y + node_h / 2))

    # 顶部：8 种标签策略（上移至 y=14.5，与节点顶部 y=10.7 隔空出 3.8 单位）
    label(ax, 13, 16.0, '可选自动标签策略 (LabelGenerator 8 种)',
          fontsize=9.5)
    strats = [
        'liquid_identity\n(分类)',
        'primary_liquid\n(分类)',
        'mixture_formula\n(分类)',
        'concentration\n(分类)',
        'total_volume\n(回归)',
        'gas_pump_speed\n(回归)',
        'params_group\n(对比学习)',
        'env_temperature\n(回归)',
    ]
    cw, ch = 3.0, 1.1
    strat_y = 14.2
    for i, s in enumerate(strats):
        x = 0.5 + i * (cw + 0.15)
        rect(ax, x, strat_y, cw, ch, s, fontsize=7.5, dashed=True)
    # 8 策略框向下汇入 LabelGenerator 节点顶部（节点3 位于 x=10.7..15.2）
    # 让 8 条线在 LabelGenerator 顶部均匀散开，避免汇聚于一点
    label_gen_top_xs = np.linspace(10.7 + 0.5, 10.7 + 4.0, len(strats))
    for i in range(len(strats)):
        x = 0.5 + i * (cw + 0.15) + cw / 2
        arrow(ax, (x, strat_y), (label_gen_top_xs[i], node_y + node_h),
              dashed=True)

    # 底部：质量过滤
    rect(ax, 4.0, 3.5, 8.5, 2.0,
         '质量过滤（可选）\n'
         'WHERE quality_score >= 70\n'
         '（来自 DataQualityMonitor.finalize_sample）',
         fontsize=8.5, dashed=True)
    arrow(ax, (8.25, 5.5), (16.5, node_y), dashed=True)

    # 右下：推理回路
    rect(ax, 14.0, 3.5, 11.5, 2.0,
         '在线推理回路\n'
         'ModelService.LoadModel / Predict  ←  实时对齐序列  ←  实验执行',
         fontsize=8.5, dashed=True)
    arrow(ax, (22.9, 5.5), (22.9, node_y), dashed=True)

    # 底注
    label(ax, 13, 1.5,
          '所有环节均以 sample_id 为主键串联，端到端可追溯、可复现',
          fontsize=9)

    save(fig, 'fig16_ml_pipeline.png')


# ============================================================
# 入口
# ============================================================
def main():
    print(f'输出目录: {OUTPUT_DIR}')
    generators = [
        ('图3  系统五层架构总体框图',      fig3_system_architecture),
        ('图4  液体进样与气路控制时序图',  fig4_phase_timeline),
        ('图9  四级分层执行架构',          fig9_layered_executor),
        ('图10 GCODE_AXIS 并行进样时序图', fig10_gcode_axis_timing),
        ('图11 称重闭环控制框图',          fig11_load_cell_feedback),
        ('图12 归一化时间轴对齐算法',      fig12_aligned_series),
        ('图13 数据质量监控数据结构',      fig13_quality_monitor),
        ('图15 软件微服务架构',            fig15_microservices),
        ('图16 机器学习数据流水线',        fig16_ml_pipeline),
    ]
    for title, fn in generators:
        print(f'生成 {title} ...')
        fn()
    print('全部完成。')


if __name__ == '__main__':
    main()
