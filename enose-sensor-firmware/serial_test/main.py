"""
BME688 传感器串口测试工具
实时曲线图显示 + 命令发送界面
"""

import sys
from collections import deque
from datetime import datetime

import numpy as np
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QGroupBox, QPushButton, QComboBox, QLabel, QTextEdit,
    QSplitter, QStatusBar, QSpinBox, QCheckBox, QTabWidget,
    QGridLayout, QLineEdit
)
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt6.QtGui import QFont, QColor
import pyqtgraph as pg

from serial_client import SerialClient, SensorReading, DeviceStatus


# 配置 pyqtgraph
pg.setConfigOptions(antialias=True, background='w', foreground='k')

# 传感器颜色
SENSOR_COLORS = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8',
    '#f58231', '#911eb4', '#46f0f0', '#f032e6'
]

# 预设加热器配置 (参考 heaters.yaml)
HEATER_PRESETS = {
    "恒温高温 (320°C)": {
        "temps": [320, 320, 320, 320, 320, 320, 320, 320, 320, 320],
        "durs": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        "desc": "10步恒定320°C，每步约140ms，~7Hz采样"
    },
    "恒温中温 (200°C)": {
        "temps": [200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
        "durs": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        "desc": "10步恒定200°C，每步约140ms，~7Hz采样"
    },
    "恒温低温 (100°C)": {
        "temps": [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
        "durs": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        "desc": "10步恒定100°C，每步约140ms，~7Hz采样"
    },
    "变温模式A (快速)": {
        "temps": [100, 320, 320, 200, 200, 200, 320, 320, 320, 320],
        "durs": [64, 2, 2, 2, 31, 31, 2, 20, 21, 21],
        "desc": "100°C预热 → 320°C快闪 → 200°C保持 → 320°C采集"
    },
    "变温模式B (标准)": {
        "temps": [100, 320, 320, 200, 200, 200, 320, 320, 320, 320],
        "durs": [43, 2, 2, 2, 21, 21, 2, 14, 14, 14],
        "desc": "100°C预热 → 320°C快闪 → 200°C保持 → 320°C采集"
    },
    "变温模式C (阶梯)": {
        "temps": [100, 100, 200, 200, 200, 200, 320, 320, 320, 320],
        "durs": [2, 41, 2, 14, 14, 14, 2, 14, 14, 14],
        "desc": "100°C → 200°C → 320°C 阶梯升温"
    },
    "开发套件默认": {
        "temps": [320, 100, 100, 100, 200, 200, 200, 320, 320, 320],
        "durs": [5, 2, 10, 30, 5, 5, 5, 5, 5, 5],
        "desc": "BME688开发套件默认配置"
    },
    "自定义恒温": None,  # 特殊标记，使用手动输入
}


class SignalBridge(QObject):
    """Qt 信号桥接器，用于跨线程通信"""
    data_received = pyqtSignal(object)
    status_changed = pyqtSignal(object)
    message_received = pyqtSignal(dict)
    error_occurred = pyqtSignal(str)


class RealtimePlotWidget(pg.PlotWidget):
    """实时曲线图组件 - 支持降采样和滑动窗口"""
    
    def __init__(self, title: str, y_label: str, num_sensors: int = 8, 
                 max_points: int = 2000, display_points: int = 500):
        super().__init__()
        
        self.setTitle(title)
        self.setLabel('left', y_label)
        self.setLabel('bottom', '时间', units='s')
        self.showGrid(x=True, y=True, alpha=0.3)
        self.addLegend()
        
        self.num_sensors = num_sensors
        self.max_points = max_points          # 存储的最大数据点数
        self.display_points = display_points  # 显示的最大点数 (用于降采样)
        self.window_seconds = 60.0            # 滑动窗口时间 (秒)
        self.auto_scroll = True               # 是否自动滚动
        
        # 数据存储 (使用 numpy 数组提升性能)
        self._raw_x = [[] for _ in range(num_sensors)]  # 原始时间数据
        self._raw_y = [[] for _ in range(num_sensors)]  # 原始值数据
        self.start_time = None
        
        # 曲线
        self.curves = []
        for i in range(num_sensors):
            pen = pg.mkPen(color=SENSOR_COLORS[i], width=2)
            curve = self.plot([], [], pen=pen, name=f'S{i}')
            self.curves.append(curve)
        
        # 可见性
        self.visible = [True] * num_sensors
        
        # 启用降采样
        self.setDownsampling(mode='peak')
        self.setClipToView(True)
    
    def set_window_seconds(self, seconds: float):
        """设置滑动窗口时间"""
        self.window_seconds = seconds
    
    def set_display_points(self, points: int):
        """设置显示点数 (影响降采样)"""
        self.display_points = max(100, points)
    
    def add_point(self, sensor_idx: int, value: float, timestamp_ms: int):
        """添加数据点"""
        if sensor_idx >= self.num_sensors:
            return
        
        if self.start_time is None:
            self.start_time = timestamp_ms
        
        t = (timestamp_ms - self.start_time) / 1000.0
        
        self._raw_x[sensor_idx].append(t)
        self._raw_y[sensor_idx].append(value)
        
        # 限制存储的数据量
        if len(self._raw_x[sensor_idx]) > self.max_points:
            self._raw_x[sensor_idx] = self._raw_x[sensor_idx][-self.max_points:]
            self._raw_y[sensor_idx] = self._raw_y[sensor_idx][-self.max_points:]
    
    def _downsample(self, x_data: list, y_data: list, target_points: int) -> tuple:
        """LTTB 降采样算法 (保留视觉特征)"""
        n = len(x_data)
        if n <= target_points:
            return x_data, y_data
        
        # 简化版: 均匀采样 + 保留首尾和极值
        step = max(1, n // target_points)
        indices = list(range(0, n, step))
        
        # 确保包含最后一个点
        if indices[-1] != n - 1:
            indices.append(n - 1)
        
        return [x_data[i] for i in indices], [y_data[i] for i in indices]
    
    def update_plot(self):
        """更新曲线显示 (带降采样和滑动窗口)"""
        # 计算当前时间窗口
        current_time = 0
        for i in range(self.num_sensors):
            if self._raw_x[i]:
                current_time = max(current_time, self._raw_x[i][-1])
        
        window_start = max(0, current_time - self.window_seconds) if self.auto_scroll else 0
        
        for i in range(self.num_sensors):
            if not self.visible[i] or not self._raw_x[i]:
                self.curves[i].setData([], [])
                continue
            
            x_data = self._raw_x[i]
            y_data = self._raw_y[i]
            
            # 应用滑动窗口
            if self.auto_scroll and x_data:
                # 找到窗口起始索引
                start_idx = 0
                for j, t in enumerate(x_data):
                    if t >= window_start:
                        start_idx = j
                        break
                x_data = x_data[start_idx:]
                y_data = y_data[start_idx:]
            
            # 降采样
            if len(x_data) > self.display_points:
                x_data, y_data = self._downsample(x_data, y_data, self.display_points)
            
            self.curves[i].setData(x_data, y_data)
        
        # 设置 X 轴范围
        if self.auto_scroll and current_time > 0:
            self.setXRange(window_start, current_time, padding=0.02)
    
    def set_visible(self, sensor_idx: int, visible: bool):
        """设置传感器可见性"""
        if sensor_idx < self.num_sensors:
            self.visible[sensor_idx] = visible
    
    def clear_data(self):
        """清除所有数据"""
        self.start_time = None
        for i in range(self.num_sensors):
            self._raw_x[i] = []
            self._raw_y[i] = []


class MainWindow(QMainWindow):
    """主窗口"""
    
    def __init__(self):
        super().__init__()
        
        self.setWindowTitle("BME688 传感器测试工具")
        self.setGeometry(100, 100, 1400, 900)
        
        # 串口客户端
        self.client = SerialClient()
        
        # 信号桥接
        self.signals = SignalBridge()
        self.signals.data_received.connect(self._on_data_received)
        self.signals.status_changed.connect(self._on_status_changed)
        self.signals.message_received.connect(self._on_message_received)
        self.signals.error_occurred.connect(self._on_error)
        
        # 设置回调
        self.client.on_data = lambda r: self.signals.data_received.emit(r)
        self.client.on_status = lambda s: self.signals.status_changed.emit(s)
        self.client.on_message = lambda m: self.signals.message_received.emit(m)
        self.client.on_error = lambda e: self.signals.error_occurred.emit(e)
        
        # 构建 UI
        self._setup_ui()
        
        # 更新定时器
        self.update_timer = QTimer()
        self.update_timer.timeout.connect(self._update_plots)
        self.update_timer.start(50)  # 20 FPS
        
        # 刷新串口列表
        self._refresh_ports()
    
    def _setup_ui(self):
        """设置 UI"""
        central = QWidget()
        self.setCentralWidget(central)
        
        main_layout = QHBoxLayout(central)
        
        # 左侧: 控制面板
        left_panel = self._create_control_panel()
        left_panel.setFixedWidth(320)
        
        # 右侧: 图表和日志
        right_splitter = QSplitter(Qt.Orientation.Vertical)
        
        # 图表区域
        chart_tabs = QTabWidget()
        
        # 气体电阻曲线
        self.resistance_plot = RealtimePlotWidget(
            "气体电阻", "电阻 (Ω)", num_sensors=8
        )
        chart_tabs.addTab(self.resistance_plot, "电阻/电压")
        
        # 温度曲线
        self.temp_plot = RealtimePlotWidget(
            "温度", "温度 (°C)", num_sensors=8
        )
        chart_tabs.addTab(self.temp_plot, "温度")
        
        # 湿度曲线
        self.humidity_plot = RealtimePlotWidget(
            "湿度", "湿度 (%RH)", num_sensors=8
        )
        chart_tabs.addTab(self.humidity_plot, "湿度")
        
        right_splitter.addWidget(chart_tabs)
        
        # 日志区域
        log_group = QGroupBox("通信日志")
        log_layout = QVBoxLayout(log_group)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setFont(QFont("Consolas", 9))
        self.log_text.setMaximumHeight(200)
        log_layout.addWidget(self.log_text)
        
        right_splitter.addWidget(log_group)
        right_splitter.setSizes([700, 200])
        
        main_layout.addWidget(left_panel)
        main_layout.addWidget(right_splitter, 1)
        
        # 状态栏
        self.statusBar = QStatusBar()
        self.setStatusBar(self.statusBar)
        self.statusBar.showMessage("未连接")
    
    def _create_control_panel(self) -> QWidget:
        """创建控制面板"""
        panel = QWidget()
        layout = QVBoxLayout(panel)
        
        # 连接控制
        conn_group = QGroupBox("连接")
        conn_layout = QGridLayout(conn_group)
        
        conn_layout.addWidget(QLabel("串口:"), 0, 0)
        self.port_combo = QComboBox()
        conn_layout.addWidget(self.port_combo, 0, 1)
        
        self.refresh_btn = QPushButton("刷新")
        self.refresh_btn.clicked.connect(self._refresh_ports)
        conn_layout.addWidget(self.refresh_btn, 0, 2)
        
        self.connect_btn = QPushButton("连接")
        self.connect_btn.clicked.connect(self._toggle_connection)
        conn_layout.addWidget(self.connect_btn, 1, 0, 1, 3)
        
        layout.addWidget(conn_group)
        
        # 命令控制
        cmd_group = QGroupBox("命令")
        cmd_layout = QVBoxLayout(cmd_group)
        
        # 按钮行
        btn_row1 = QHBoxLayout()
        self.sync_btn = QPushButton("同步")
        self.sync_btn.clicked.connect(self._cmd_sync)
        btn_row1.addWidget(self.sync_btn)
        
        self.init_btn = QPushButton("初始化")
        self.init_btn.clicked.connect(self._cmd_init)
        btn_row1.addWidget(self.init_btn)
        
        self.status_btn = QPushButton("状态")
        self.status_btn.clicked.connect(self._cmd_status)
        btn_row1.addWidget(self.status_btn)
        cmd_layout.addLayout(btn_row1)
        
        btn_row2 = QHBoxLayout()
        self.start_btn = QPushButton("▶ 开始采集")
        self.start_btn.clicked.connect(self._cmd_start)
        self.start_btn.setStyleSheet("background-color: #4CAF50; color: white;")
        btn_row2.addWidget(self.start_btn)
        
        self.stop_btn = QPushButton("■ 停止采集")
        self.stop_btn.clicked.connect(self._cmd_stop)
        self.stop_btn.setStyleSheet("background-color: #f44336; color: white;")
        btn_row2.addWidget(self.stop_btn)
        cmd_layout.addLayout(btn_row2)
        
        btn_row3 = QHBoxLayout()
        self.clear_btn = QPushButton("清除图表")
        self.clear_btn.clicked.connect(self._clear_plots)
        btn_row3.addWidget(self.clear_btn)
        
        self.reset_btn = QPushButton("重置设备")
        self.reset_btn.clicked.connect(self._cmd_reset)
        btn_row3.addWidget(self.reset_btn)
        cmd_layout.addLayout(btn_row3)
        
        layout.addWidget(cmd_group)
        
        # 传感器选择
        sensor_group = QGroupBox("传感器显示")
        sensor_layout = QGridLayout(sensor_group)
        
        self.sensor_checks = []
        for i in range(8):
            cb = QCheckBox(f"S{i}")
            cb.setChecked(True)
            cb.setStyleSheet(f"color: {SENSOR_COLORS[i]};")
            cb.stateChanged.connect(lambda state, idx=i: self._toggle_sensor(idx, state))
            sensor_layout.addWidget(cb, i // 4, i % 4)
            self.sensor_checks.append(cb)
        
        layout.addWidget(sensor_group)
        
        # 图表设置
        chart_group = QGroupBox("图表设置")
        chart_layout = QGridLayout(chart_group)
        
        chart_layout.addWidget(QLabel("时间窗口(秒):"), 0, 0)
        self.window_spin = QSpinBox()
        self.window_spin.setRange(10, 600)
        self.window_spin.setValue(60)
        self.window_spin.valueChanged.connect(self._on_window_changed)
        chart_layout.addWidget(self.window_spin, 0, 1)
        
        chart_layout.addWidget(QLabel("显示点数:"), 1, 0)
        self.display_points_spin = QSpinBox()
        self.display_points_spin.setRange(100, 2000)
        self.display_points_spin.setValue(500)
        self.display_points_spin.setSingleStep(100)
        self.display_points_spin.valueChanged.connect(self._on_display_points_changed)
        chart_layout.addWidget(self.display_points_spin, 1, 1)
        
        self.auto_scroll_check = QCheckBox("自动滚动")
        self.auto_scroll_check.setChecked(True)
        self.auto_scroll_check.stateChanged.connect(self._on_auto_scroll_changed)
        chart_layout.addWidget(self.auto_scroll_check, 2, 0, 1, 2)
        
        layout.addWidget(chart_group)
        
        # 加热器配置
        heater_group = QGroupBox("加热器配置")
        heater_layout = QVBoxLayout(heater_group)
        
        # 预设选择
        preset_row = QHBoxLayout()
        preset_row.addWidget(QLabel("预设:"))
        self.heater_preset_combo = QComboBox()
        self.heater_preset_combo.addItems(HEATER_PRESETS.keys())
        self.heater_preset_combo.currentTextChanged.connect(self._on_heater_preset_changed)
        preset_row.addWidget(self.heater_preset_combo, 1)
        heater_layout.addLayout(preset_row)
        
        # 预设描述
        self.heater_desc_label = QLabel("")
        self.heater_desc_label.setWordWrap(True)
        self.heater_desc_label.setStyleSheet("color: gray; font-size: 10px;")
        heater_layout.addWidget(self.heater_desc_label)
        
        # 自定义恒温设置
        custom_row = QHBoxLayout()
        custom_row.addWidget(QLabel("恒温温度:"))
        self.custom_temp_spin = QSpinBox()
        self.custom_temp_spin.setRange(100, 400)
        self.custom_temp_spin.setValue(320)
        self.custom_temp_spin.setSuffix(" °C")
        self.custom_temp_spin.setEnabled(False)
        custom_row.addWidget(self.custom_temp_spin)
        
        custom_row.addWidget(QLabel("步长:"))
        self.custom_dur_spin = QSpinBox()
        self.custom_dur_spin.setRange(1, 500)
        self.custom_dur_spin.setValue(5)
        self.custom_dur_spin.setToolTip("持续时间倍数 (×140ms)")
        self.custom_dur_spin.setEnabled(False)
        custom_row.addWidget(self.custom_dur_spin)
        heater_layout.addLayout(custom_row)
        
        # 目标传感器
        sensor_target_row = QHBoxLayout()
        sensor_target_row.addWidget(QLabel("目标:"))
        self.heater_target_combo = QComboBox()
        self.heater_target_combo.addItem("所有传感器", None)
        for i in range(8):
            self.heater_target_combo.addItem(f"传感器 {i}", i)
        sensor_target_row.addWidget(self.heater_target_combo, 1)
        heater_layout.addLayout(sensor_target_row)
        
        # 应用按钮
        self.apply_heater_btn = QPushButton("应用配置")
        self.apply_heater_btn.clicked.connect(self._apply_heater_config)
        self.apply_heater_btn.setStyleSheet("background-color: #2196F3; color: white;")
        heater_layout.addWidget(self.apply_heater_btn)
        
        layout.addWidget(heater_group)
        
        # 初始化预设描述
        self._on_heater_preset_changed(self.heater_preset_combo.currentText())
        
        # 自定义命令
        custom_group = QGroupBox("自定义命令")
        custom_layout = QVBoxLayout(custom_group)
        
        self.custom_input = QLineEdit()
        self.custom_input.setPlaceholderText('{"cmd": "sync", "id": 1}')
        custom_layout.addWidget(self.custom_input)
        
        self.send_custom_btn = QPushButton("发送")
        self.send_custom_btn.clicked.connect(self._send_custom)
        custom_layout.addWidget(self.send_custom_btn)
        
        layout.addWidget(custom_group)
        
        # 统计信息
        stats_group = QGroupBox("统计")
        stats_layout = QGridLayout(stats_group)
        
        stats_layout.addWidget(QLabel("数据点数:"), 0, 0)
        self.data_count_label = QLabel("0")
        stats_layout.addWidget(self.data_count_label, 0, 1)
        
        stats_layout.addWidget(QLabel("采样率:"), 1, 0)
        self.sample_rate_label = QLabel("0 Hz")
        stats_layout.addWidget(self.sample_rate_label, 1, 1)
        
        layout.addWidget(stats_group)
        
        layout.addStretch()
        
        return panel
    
    def _refresh_ports(self):
        """刷新串口列表"""
        self.port_combo.clear()
        ports = SerialClient.list_ports()
        self.port_combo.addItems(ports)
    
    def _toggle_connection(self):
        """切换连接状态"""
        if self.client.status.connected:
            self.client.disconnect()
            self.connect_btn.setText("连接")
            self._log("已断开连接")
        else:
            port = self.port_combo.currentText()
            if port:
                if self.client.connect(port):
                    self.connect_btn.setText("断开")
                    self._log(f"已连接到 {port}")
                else:
                    self._log(f"连接 {port} 失败")
    
    def _cmd_sync(self):
        """同步命令"""
        resp = self.client.cmd_sync()
        self._log(f"Sync: {resp}")
    
    def _cmd_init(self):
        """初始化命令"""
        resp = self.client.cmd_init()
        self._log(f"Init: {resp}")
    
    def _cmd_start(self):
        """开始采集"""
        resp = self.client.cmd_start()
        self._log(f"Start: {resp}")
    
    def _cmd_stop(self):
        """停止采集"""
        resp = self.client.cmd_stop()
        self._log(f"Stop: {resp}")
    
    def _cmd_status(self):
        """查询状态"""
        resp = self.client.cmd_status()
        self._log(f"Status: {resp}")
    
    def _cmd_reset(self):
        """重置设备"""
        resp = self.client.cmd_reset()
        self._log(f"Reset: {resp}")
    
    def _clear_plots(self):
        """清除图表"""
        self.resistance_plot.clear_data()
        self.temp_plot.clear_data()
        self.humidity_plot.clear_data()
        self._data_count = 0
        self._log("图表已清除")
    
    def _toggle_sensor(self, idx: int, state: int):
        """切换传感器显示"""
        visible = state == Qt.CheckState.Checked.value
        self.resistance_plot.set_visible(idx, visible)
        self.temp_plot.set_visible(idx, visible)
        self.humidity_plot.set_visible(idx, visible)
    
    def _on_window_changed(self, value: int):
        """时间窗口变化"""
        self.resistance_plot.set_window_seconds(float(value))
        self.temp_plot.set_window_seconds(float(value))
        self.humidity_plot.set_window_seconds(float(value))
    
    def _on_display_points_changed(self, value: int):
        """显示点数变化"""
        self.resistance_plot.set_display_points(value)
        self.temp_plot.set_display_points(value)
        self.humidity_plot.set_display_points(value)
    
    def _on_auto_scroll_changed(self, state: int):
        """自动滚动开关"""
        enabled = state == Qt.CheckState.Checked.value
        self.resistance_plot.auto_scroll = enabled
        self.temp_plot.auto_scroll = enabled
        self.humidity_plot.auto_scroll = enabled
    
    def _on_heater_preset_changed(self, preset_name: str):
        """加热器预设变化"""
        preset = HEATER_PRESETS.get(preset_name)
        if preset is None:
            # 自定义恒温模式
            self.heater_desc_label.setText("手动设置恒温温度和步长时间")
            self.custom_temp_spin.setEnabled(True)
            self.custom_dur_spin.setEnabled(True)
        else:
            self.heater_desc_label.setText(preset.get("desc", ""))
            self.custom_temp_spin.setEnabled(False)
            self.custom_dur_spin.setEnabled(False)
    
    def _apply_heater_config(self):
        """应用加热器配置"""
        preset_name = self.heater_preset_combo.currentText()
        preset = HEATER_PRESETS.get(preset_name)
        
        if preset is None:
            # 自定义恒温模式
            temp = self.custom_temp_spin.value()
            dur = self.custom_dur_spin.value()
            temps = [temp] * 10
            durs = [dur] * 10
            self._log(f"应用自定义恒温: {temp}°C, 步长={dur}")
        else:
            temps = preset["temps"]
            durs = preset["durs"]
            self._log(f"应用预设: {preset_name}")
        
        # 确定目标传感器
        target_data = self.heater_target_combo.currentData()
        if target_data is None:
            sensors = None  # 所有传感器
        else:
            sensors = [target_data]
        
        # 发送配置命令
        resp = self.client.cmd_config(temps, durs, sensors)
        self._log(f"Config: {resp}")
    
    def _send_custom(self):
        """发送自定义命令"""
        text = self.custom_input.text().strip()
        if text and self.client.serial:
            try:
                self.client.serial.write((text + "\n").encode('utf-8'))
                self._log(f"TX: {text}")
            except Exception as e:
                self._log(f"发送失败: {e}")
    
    def _on_data_received(self, reading: SensorReading):
        """处理接收到的数据"""
        # 添加到图表
        self.resistance_plot.add_point(
            reading.sensor_idx, reading.value, reading.tick_ms
        )
        
        if reading.temperature is not None:
            self.temp_plot.add_point(
                reading.sensor_idx, reading.temperature, reading.tick_ms
            )
        
        if reading.humidity is not None:
            self.humidity_plot.add_point(
                reading.sensor_idx, reading.humidity, reading.tick_ms
            )
        
        # 更新统计
        if not hasattr(self, '_data_count'):
            self._data_count = 0
            self._last_count_time = datetime.now()
        
        self._data_count += 1
    
    def _on_status_changed(self, status: DeviceStatus):
        """处理状态变化"""
        if status.connected:
            msg = f"已连接 {status.port}"
            if status.firmware_version:
                msg += f" | 固件: {status.firmware_version}"
            if status.running:
                msg += " | 采集中"
            self.statusBar.showMessage(msg)
        else:
            self.statusBar.showMessage("未连接")
    
    def _on_message_received(self, msg: dict):
        """处理接收到的消息"""
        msg_type = msg.get("type", "")
        if msg_type == "ready":
            self._log(f"设备就绪: {msg}")
    
    def _on_error(self, error: str):
        """处理错误"""
        self._log(f"错误: {error}")
    
    def _update_plots(self):
        """更新图表"""
        self.resistance_plot.update_plot()
        self.temp_plot.update_plot()
        self.humidity_plot.update_plot()
        
        # 更新统计
        if hasattr(self, '_data_count'):
            self.data_count_label.setText(str(self._data_count))
            
            now = datetime.now()
            if hasattr(self, '_last_count_time'):
                dt = (now - self._last_count_time).total_seconds()
                if dt >= 1.0:
                    rate = self._data_count / dt if hasattr(self, '_last_data_count') else 0
                    rate = (self._data_count - getattr(self, '_last_data_count', 0)) / dt
                    self.sample_rate_label.setText(f"{rate:.1f} Hz")
                    self._last_count_time = now
                    self._last_data_count = self._data_count
    
    def _log(self, msg: str):
        """添加日志"""
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        self.log_text.append(f"[{timestamp}] {msg}")
    
    def closeEvent(self, event):
        """关闭窗口"""
        self.client.disconnect()
        event.accept()


def main():
    app = QApplication(sys.argv)
    app.setStyle('Fusion')
    
    window = MainWindow()
    window.show()
    
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
