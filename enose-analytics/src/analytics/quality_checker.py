"""质量检测模块 - 所有阈值可配置"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import numpy as np

from ..config import QualityConfig, get_settings
from ..logger import logger



class QualityFlag(Enum):
    """质量标志枚举"""

    QF_UNKNOWN = 0
    QF_BASELINE_UNSTABLE = 1
    QF_SENSOR_SATURATION = 2
    QF_EXCESS_NOISE = 3
    QF_HUMIDITY_OUT_OF_RANGE = 4
    QF_TEMP_OUT_OF_RANGE = 5
    QF_FLOW_SUSPECTED = 6
    QF_SENSOR_DRIFT = 7
    QF_SIGNAL_ANOMALY = 8


class Severity(Enum):
    """严重程度枚举"""

    UNKNOWN = 0
    INFO = 1
    WARNING = 2
    ERROR = 3
    CRITICAL = 4


@dataclass
class QualityAlert:
    """质量告警"""

    flag: QualityFlag
    severity: Severity
    message: str
    channel: int = -1  # -1 表示全局
    value: float = 0.0
    threshold: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "flag": self.flag.name,
            "severity": self.severity.name,
            "message": self.message,
            "channel": self.channel,
            "value": self.value,
            "threshold": self.threshold,
        }


@dataclass
class Metric:
    """统计指标"""

    name: str
    value: float
    unit: str = ""
    channel: int = -1

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "unit": self.unit,
            "channel": self.channel,
        }


@dataclass
class AnalysisResult:
    """分析结果"""

    alerts: list[QualityAlert] = field(default_factory=list)
    metrics: list[Metric] = field(default_factory=list)


class QualityChecker:
    """质量检测器 - 支持可配置阈值"""

    def __init__(self, config: QualityConfig | None = None):
        self.config = config or get_settings().quality
        self._baseline_buffer: list[np.ndarray] = []
        self._noise_buffer: list[np.ndarray] = []
        self._drift_buffer: list[np.ndarray] = []

    def update_config(self, config: QualityConfig) -> None:
        """更新配置"""
        self.config = config
        logger.info("Quality checker config updated")

    def check(
        self,
        mox_readings: list[float] | np.ndarray,
        temp_c: float,
        rh: float,
        pressure: float | None = None,
    ) -> AnalysisResult:
        """执行质量检测"""
        result = AnalysisResult()
        mox = np.array(mox_readings)

        # 检查传感器饱和
        self._check_saturation(mox, result)

        # 检查环境参数
        self._check_temperature(temp_c, result)
        self._check_humidity(rh, result)

        # 更新缓冲区并检查
        self._update_buffers(mox)
        self._check_baseline_stability(result)
        self._check_noise(result)
        self._check_drift(result)

        # 计算统计指标
        self._compute_metrics(mox, temp_c, rh, result)

        return result

    def _check_saturation(self, mox: np.ndarray, result: AnalysisResult) -> None:
        """检查传感器饱和"""
        for i, val in enumerate(mox):
            if val < self.config.min_resistance:
                result.alerts.append(
                    QualityAlert(
                        flag=QualityFlag.QF_SENSOR_SATURATION,
                        severity=Severity.ERROR,
                        message=f"通道 {i} 电阻值过低 ({val:.1f} < {self.config.min_resistance})",
                        channel=i,
                        value=val,
                        threshold=self.config.min_resistance,
                    )
                )
            elif val > self.config.max_resistance:
                result.alerts.append(
                    QualityAlert(
                        flag=QualityFlag.QF_SENSOR_SATURATION,
                        severity=Severity.WARNING,
                        message=f"通道 {i} 电阻值过高 ({val:.1f} > {self.config.max_resistance})",
                        channel=i,
                        value=val,
                        threshold=self.config.max_resistance,
                    )
                )

    def _check_temperature(self, temp_c: float, result: AnalysisResult) -> None:
        """检查温度"""
        if temp_c < self.config.min_temperature:
            result.alerts.append(
                QualityAlert(
                    flag=QualityFlag.QF_TEMP_OUT_OF_RANGE,
                    severity=Severity.WARNING,
                    message=f"温度过低 ({temp_c:.1f}°C < {self.config.min_temperature}°C)",
                    value=temp_c,
                    threshold=self.config.min_temperature,
                )
            )
        elif temp_c > self.config.max_temperature:
            result.alerts.append(
                QualityAlert(
                    flag=QualityFlag.QF_TEMP_OUT_OF_RANGE,
                    severity=Severity.WARNING,
                    message=f"温度过高 ({temp_c:.1f}°C > {self.config.max_temperature}°C)",
                    value=temp_c,
                    threshold=self.config.max_temperature,
                )
            )

    def _check_humidity(self, rh: float, result: AnalysisResult) -> None:
        """检查湿度"""
        if rh < self.config.min_humidity:
            result.alerts.append(
                QualityAlert(
                    flag=QualityFlag.QF_HUMIDITY_OUT_OF_RANGE,
                    severity=Severity.WARNING,
                    message=f"湿度过低 ({rh:.1f}% < {self.config.min_humidity}%)",
                    value=rh,
                    threshold=self.config.min_humidity,
                )
            )
        elif rh > self.config.max_humidity:
            result.alerts.append(
                QualityAlert(
                    flag=QualityFlag.QF_HUMIDITY_OUT_OF_RANGE,
                    severity=Severity.WARNING,
                    message=f"湿度过高 ({rh:.1f}% > {self.config.max_humidity}%)",
                    value=rh,
                    threshold=self.config.max_humidity,
                )
            )

    def _update_buffers(self, mox: np.ndarray) -> None:
        """更新检测缓冲区"""
        # 基线缓冲区
        self._baseline_buffer.append(mox.copy())
        if len(self._baseline_buffer) > self.config.baseline_window_size:
            self._baseline_buffer.pop(0)

        # 噪声缓冲区
        self._noise_buffer.append(mox.copy())
        if len(self._noise_buffer) > self.config.noise_window_size:
            self._noise_buffer.pop(0)

        # 漂移缓冲区
        self._drift_buffer.append(mox.copy())
        if len(self._drift_buffer) > self.config.drift_window_size:
            self._drift_buffer.pop(0)

    def _check_baseline_stability(self, result: AnalysisResult) -> None:
        """检查基线稳定性"""
        if len(self._baseline_buffer) < self.config.baseline_window_size // 2:
            return

        data = np.array(self._baseline_buffer)
        for i in range(data.shape[1]):
            channel_data = data[:, i]
            mean_val = np.mean(channel_data)
            if mean_val > 0:
                cv = np.std(channel_data) / mean_val
                if cv > self.config.baseline_cv_threshold:
                    result.alerts.append(
                        QualityAlert(
                            flag=QualityFlag.QF_BASELINE_UNSTABLE,
                            severity=Severity.WARNING,
                            message=f"通道 {i} 基线不稳定 (CV={cv:.3f} > {self.config.baseline_cv_threshold})",
                            channel=i,
                            value=cv,
                            threshold=self.config.baseline_cv_threshold,
                        )
                    )

    def _check_noise(self, result: AnalysisResult) -> None:
        """检查噪声"""
        if len(self._noise_buffer) < self.config.noise_window_size:
            return

        data = np.array(self._noise_buffer)
        for i in range(data.shape[1]):
            channel_data = data[:, i]
            mean_val = np.mean(channel_data)
            if mean_val > 0:
                rel_std = np.std(channel_data) / mean_val
                if rel_std > self.config.noise_std_threshold:
                    result.alerts.append(
                        QualityAlert(
                            flag=QualityFlag.QF_EXCESS_NOISE,
                            severity=Severity.WARNING,
                            message=f"通道 {i} 噪声过大 (相对标准差={rel_std:.3f})",
                            channel=i,
                            value=rel_std,
                            threshold=self.config.noise_std_threshold,
                        )
                    )

    def _check_drift(self, result: AnalysisResult) -> None:
        """检查漂移"""
        if len(self._drift_buffer) < self.config.drift_window_size // 2:
            return

        data = np.array(self._drift_buffer)
        for i in range(data.shape[1]):
            channel_data = data[:, i]
            # 计算线性拟合斜率
            x = np.arange(len(channel_data))
            slope, _ = np.polyfit(x, channel_data, 1)
            mean_val = np.mean(channel_data)
            if mean_val > 0:
                rel_drift = abs(slope * len(channel_data)) / mean_val
                if rel_drift > self.config.drift_threshold:
                    result.alerts.append(
                        QualityAlert(
                            flag=QualityFlag.QF_SENSOR_DRIFT,
                            severity=Severity.WARNING,
                            message=f"通道 {i} 检测到漂移 (相对漂移={rel_drift:.3f})",
                            channel=i,
                            value=rel_drift,
                            threshold=self.config.drift_threshold,
                        )
                    )

    def _compute_metrics(
        self,
        mox: np.ndarray,
        temp_c: float,
        rh: float,
        result: AnalysisResult,
    ) -> None:
        """计算统计指标"""
        # 全局指标
        result.metrics.append(Metric("temperature", temp_c, "°C"))
        result.metrics.append(Metric("humidity", rh, "%"))
        result.metrics.append(Metric("mean_resistance", float(np.mean(mox)), "Ω"))
        result.metrics.append(Metric("std_resistance", float(np.std(mox)), "Ω"))

        # 每通道指标
        for i, val in enumerate(mox):
            result.metrics.append(Metric(f"ch{i}_resistance", float(val), "Ω", channel=i))

    def reset(self) -> None:
        """重置缓冲区"""
        self._baseline_buffer.clear()
        self._noise_buffer.clear()
        self._drift_buffer.clear()
        logger.info("Quality checker buffers reset")
