"""
串口通信客户端模块
用于与 ESP32 BME688 传感器板通信
"""

import json
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional
from queue import Queue

import serial
import serial.tools.list_ports


@dataclass
class SensorReading:
    """传感器读数"""
    tick_ms: int = 0
    sensor_idx: int = 0
    sensor_id: int = 0
    value: float = 0.0          # 主读数 (电阻/电压)
    sensor_type: str = ""       # mox_d, mox_a, pid
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    pressure: Optional[float] = None
    heater_step: int = 0        # gas_index
    adc_channel: int = 0
    
    @classmethod
    def from_json(cls, data: dict) -> "SensorReading":
        return cls(
            tick_ms=data.get("tick", 0),
            sensor_idx=data.get("s", 0),
            sensor_id=data.get("id", 0),
            value=float(data.get("v", data.get("R", 0))),  # 兼容旧格式
            sensor_type=data.get("st", "mox_d"),
            temperature=data.get("T"),
            humidity=data.get("H"),
            pressure=data.get("P"),
            heater_step=data.get("gi", 0),
            adc_channel=data.get("ch", 0),
        )


@dataclass
class DeviceStatus:
    """设备状态"""
    connected: bool = False
    running: bool = False
    sensor_count: int = 0
    firmware_version: str = ""
    port: str = ""


class SerialClient:
    """串口通信客户端"""
    
    def __init__(self):
        self.serial: Optional[serial.Serial] = None
        self.status = DeviceStatus()
        self._read_thread: Optional[threading.Thread] = None
        self._running = False
        self._cmd_id = 0
        
        # 回调函数
        self.on_data: Optional[Callable[[SensorReading], None]] = None
        self.on_status: Optional[Callable[[DeviceStatus], None]] = None
        self.on_error: Optional[Callable[[str], None]] = None
        self.on_message: Optional[Callable[[dict], None]] = None
        
        # 响应队列
        self._response_queue: Queue = Queue()
    
    @staticmethod
    def list_ports() -> list[str]:
        """列出可用串口"""
        ports = serial.tools.list_ports.comports()
        return [p.device for p in ports]
    
    def connect(self, port: str, baudrate: int = 115200) -> bool:
        """连接串口"""
        try:
            self.serial = serial.Serial(
                port=port,
                baudrate=baudrate,
                timeout=0.1
            )
            self.status.connected = True
            self.status.port = port
            
            # 启动读取线程
            self._running = True
            self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._read_thread.start()
            
            if self.on_status:
                self.on_status(self.status)
            
            return True
        except Exception as e:
            if self.on_error:
                self.on_error(f"连接失败: {e}")
            return False
    
    def disconnect(self):
        """断开连接"""
        self._running = False
        if self._read_thread:
            self._read_thread.join(timeout=1.0)
        if self.serial:
            self.serial.close()
            self.serial = None
        self.status.connected = False
        self.status.running = False
        if self.on_status:
            self.on_status(self.status)
    
    def _read_loop(self):
        """读取线程"""
        buffer = ""
        while self._running and self.serial:
            try:
                if self.serial.in_waiting:
                    data = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += data
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        if line:
                            self._process_line(line)
                else:
                    time.sleep(0.01)
            except Exception as e:
                if self.on_error:
                    self.on_error(f"读取错误: {e}")
                break
    
    def _process_line(self, line: str):
        """处理接收到的一行数据"""
        try:
            data = json.loads(line)
            msg_type = data.get("type", "")
            
            if msg_type == "data":
                reading = SensorReading.from_json(data)
                if self.on_data:
                    self.on_data(reading)
            
            elif msg_type == "ready":
                self.status.firmware_version = data.get("version", "")
                self.status.sensor_count = data.get("sensors", 0)
                if self.on_status:
                    self.on_status(self.status)
            
            elif msg_type in ("ack", "error", "status"):
                self._response_queue.put(data)
            
            if self.on_message:
                self.on_message(data)
                
        except json.JSONDecodeError:
            pass  # 忽略非JSON行
    
    def _send_command(self, cmd: str, params: Optional[dict] = None) -> Optional[dict]:
        """发送命令并等待响应"""
        if not self.serial:
            return None
        
        self._cmd_id += 1
        msg = {"cmd": cmd, "id": self._cmd_id}
        if params:
            msg["params"] = params
        
        # 清空响应队列
        while not self._response_queue.empty():
            self._response_queue.get()
        
        # 发送命令
        line = json.dumps(msg) + "\n"
        self.serial.write(line.encode('utf-8'))
        
        # 等待响应
        try:
            response = self._response_queue.get(timeout=3.0)
            return response
        except:
            return None
    
    def cmd_sync(self) -> Optional[dict]:
        """同步命令"""
        return self._send_command("sync")
    
    def cmd_init(self, config_file: str = "") -> Optional[dict]:
        """初始化传感器"""
        resp = self._send_command("init", {"config_file": config_file})
        if resp and resp.get("ok"):
            self.status.sensor_count = resp.get("sensors", 8)
        return resp
    
    def cmd_start(self, sensors: Optional[list[int]] = None) -> Optional[dict]:
        """开始采集"""
        params = {}
        if sensors:
            params["sensors"] = sensors
        resp = self._send_command("start", params if params else None)
        if resp and resp.get("ok"):
            self.status.running = True
            if self.on_status:
                self.on_status(self.status)
        return resp
    
    def cmd_stop(self) -> Optional[dict]:
        """停止采集"""
        resp = self._send_command("stop")
        if resp and resp.get("ok"):
            self.status.running = False
            if self.on_status:
                self.on_status(self.status)
        return resp
    
    def cmd_status(self) -> Optional[dict]:
        """查询状态"""
        return self._send_command("status")
    
    def cmd_reset(self) -> Optional[dict]:
        """重置设备"""
        return self._send_command("reset")
    
    def cmd_config(self, temps: list[int], durs: list[int], 
                   sensors: Optional[list[int]] = None) -> Optional[dict]:
        """配置加热器"""
        params = {"temps": temps, "durs": durs}
        if sensors:
            params["sensors"] = sensors
        return self._send_command("config", params)
