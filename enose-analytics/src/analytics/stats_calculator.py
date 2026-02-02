"""在线统计计算模块"""

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class OnlineStats:
    """在线统计 (Welford 算法)"""

    count: int = 0
    mean: np.ndarray = field(default_factory=lambda: np.zeros(8))
    m2: np.ndarray = field(default_factory=lambda: np.zeros(8))  # 用于方差计算
    min_val: np.ndarray = field(default_factory=lambda: np.full(8, np.inf))
    max_val: np.ndarray = field(default_factory=lambda: np.full(8, -np.inf))

    @property
    def variance(self) -> np.ndarray:
        if self.count < 2:
            return np.zeros_like(self.mean)
        return self.m2 / (self.count - 1)

    @property
    def std(self) -> np.ndarray:
        return np.sqrt(self.variance)

    def to_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "mean": self.mean.tolist(),
            "std": self.std.tolist(),
            "min": self.min_val.tolist(),
            "max": self.max_val.tolist(),
        }


class StatsCalculator:
    """在线统计计算器"""

    def __init__(self, n_channels: int = 8):
        self.n_channels = n_channels
        self._global_stats = self._create_stats()
        self._phase_stats: dict[str, OnlineStats] = {}
        self._window_buffer: list[np.ndarray] = []
        self._window_size = 60  # 滑动窗口大小

    def _create_stats(self) -> OnlineStats:
        """创建统计对象"""
        return OnlineStats(
            mean=np.zeros(self.n_channels),
            m2=np.zeros(self.n_channels),
            min_val=np.full(self.n_channels, np.inf),
            max_val=np.full(self.n_channels, -np.inf),
        )

    def update(
        self,
        mox_readings: list[float] | np.ndarray,
        phase: str | None = None,
    ) -> dict[str, Any]:
        """更新统计"""
        mox = np.array(mox_readings)

        # 更新全局统计
        self._update_stats(self._global_stats, mox)

        # 更新阶段统计
        if phase:
            if phase not in self._phase_stats:
                self._phase_stats[phase] = self._create_stats()
            self._update_stats(self._phase_stats[phase], mox)

        # 更新滑动窗口
        self._window_buffer.append(mox)
        if len(self._window_buffer) > self._window_size:
            self._window_buffer.pop(0)

        return self.get_current_stats(phase)

    def _update_stats(self, stats: OnlineStats, mox: np.ndarray) -> None:
        """更新统计 (Welford 在线算法)"""
        stats.count += 1
        delta = mox - stats.mean
        stats.mean += delta / stats.count
        delta2 = mox - stats.mean
        stats.m2 += delta * delta2

        stats.min_val = np.minimum(stats.min_val, mox)
        stats.max_val = np.maximum(stats.max_val, mox)

    def get_current_stats(self, phase: str | None = None) -> dict[str, Any]:
        """获取当前统计"""
        result: dict[str, Any] = {
            "global": self._global_stats.to_dict(),
        }

        # 滑动窗口统计
        if self._window_buffer:
            window_data = np.array(self._window_buffer)
            result["window"] = {
                "size": len(self._window_buffer),
                "mean": np.mean(window_data, axis=0).tolist(),
                "std": np.std(window_data, axis=0).tolist(),
                "trend": self._compute_trend(window_data),
            }

        # 阶段统计
        if phase and phase in self._phase_stats:
            result["phase"] = {
                "name": phase,
                **self._phase_stats[phase].to_dict(),
            }

        return result

    def _compute_trend(self, data: np.ndarray) -> list[float]:
        """计算趋势 (线性拟合斜率)"""
        if len(data) < 2:
            return [0.0] * self.n_channels

        x = np.arange(len(data))
        trends = []
        for i in range(data.shape[1]):
            slope, _ = np.polyfit(x, data[:, i], 1)
            trends.append(float(slope))
        return trends

    def get_phase_stats(self, phase: str) -> dict[str, Any] | None:
        """获取特定阶段的统计"""
        if phase in self._phase_stats:
            return {
                "name": phase,
                **self._phase_stats[phase].to_dict(),
            }
        return None

    def get_all_phase_stats(self) -> dict[str, dict[str, Any]]:
        """获取所有阶段的统计"""
        return {
            phase: {"name": phase, **stats.to_dict()}
            for phase, stats in self._phase_stats.items()
        }

    def reset(self, phase: str | None = None) -> None:
        """重置统计"""
        if phase:
            if phase in self._phase_stats:
                del self._phase_stats[phase]
                logger.info(f"Phase stats reset: {phase}")
        else:
            self._global_stats = self._create_stats()
            self._phase_stats.clear()
            self._window_buffer.clear()
            logger.info("All stats reset")

    def set_window_size(self, size: int) -> None:
        """设置滑动窗口大小"""
        self._window_size = size
        while len(self._window_buffer) > size:
            self._window_buffer.pop(0)
