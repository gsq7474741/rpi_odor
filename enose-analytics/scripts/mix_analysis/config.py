"""全局配置 — 数据库、传感器、Run、缓存路径等。

修改此文件即可切换分析目标，其他模块全部自动适配。
"""

from __future__ import annotations

import yaml
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SensorConfig:
    """传感器配置"""
    n_sensors: int = 8
    n_channels: int = 4  # value, temperature, humidity, pressure
    channel_names: tuple[str, ...] = ("value", "temperature", "humidity", "pressure")
    # 可用传感器索引 (Run 105+ 所有 8 个传感器均为常温配置，全部可用)
    active_sensors: list[int] = field(default_factory=lambda: list(range(8)))
    # 历史兼容: 排除 sensor 3/7 的配置 (旧 run 使用)
    legacy_good_sensors: list[int] = field(default_factory=lambda: [0, 1, 2, 4, 5, 6])


@dataclass
class AlignmentConfig:
    """对齐序列配置"""
    n_samples: int = 100       # PCHIP 对齐后的时间步数
    method: str = "pchip"      # 插值方法: "pchip" | "linear"
    baseline_ratio: float = 0.1  # 基线归一化: 前 10% 时间步


@dataclass
class ExperimentConfig:
    """实验配置 — 描述一次分析的目标"""
    run_id: int = 105
    name: str = "tea-mix-run105"
    description: str = "东方树叶 5 种茶二元混合实验"

    # 液体简称映射
    short_names: dict[str, str] = field(default_factory=lambda: {
        "东方树叶-乌龙茶": "乌龙",
        "东方树叶-红茶": "红茶",
        "东方树叶-茉莉花茶": "茉莉",
        "东方树叶-青柑普洱": "普洱",
        "东方树叶-黑乌龙": "黑乌龙",
    })

    sensor: SensorConfig = field(default_factory=SensorConfig)
    alignment: AlignmentConfig = field(default_factory=AlignmentConfig)

    def short(self, name: str) -> str:
        """液体名称简写"""
        return self.short_names.get(name, name)


def load_db_dsn() -> str:
    """从 analytics.yaml 加载数据库连接字符串"""
    cfg_path = Path(__file__).parent.parent.parent / "config" / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


def get_cache_dir(exp: ExperimentConfig) -> Path:
    """获取实验缓存目录，自动创建"""
    cache_dir = Path(__file__).parent.parent / "cache" / exp.name
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


# ── 默认配置实例 ──
DEFAULT_CONFIG = ExperimentConfig()
