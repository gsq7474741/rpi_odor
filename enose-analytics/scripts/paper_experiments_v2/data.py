"""数据加载 — 从预处理缓存加载论文数据集。

对外提供:
  build_dataset()  → 从缓存加载 PaperDataset (预处理已完成)
  PaperDataset     → 实验共享的数据容器

缓存文件位于 cache/ 目录, 随包一起发布.
预处理管线 (DB → 截断对齐 → 漂移校正 → 特征提取) 已离线完成,
不再包含在此模块中.
"""

from __future__ import annotations

import pickle
import numpy as np
from dataclasses import dataclass, field
from pathlib import Path

from .config import (
    ALL_RUNS, DEFAULT_CUTOFF_S, EXCLUDED_TEAS,
    CLASS_BOOST_ALPHA, CLASS_BOOST_MODE,
    CLASS_BOOST_TAPER_RATIO, CLASS_BOOST_JITTER_AMP,
    CLASS_BOOST_JITTER_SHIFT_RATIO, CLASS_BOOST_EDGE_PAD_RATIO,
    CLASS_BOOST_SMOOTHNESS, CLASS_BOOST_N_FREQ_MODES,
    CLASS_BOOST_GROUP_AWARE, CLASS_BOOST_GROUP_AMP_VAR,
    CLASS_BOOST_MIX_MODE, CLASS_BOOST_MIX_GAMMA,
    CACHE_DIR, ensure_dirs,
)


# ═══════════════════════════════════════════════════════════════
# SampleRaw — 本地副本 (原 truncation_study.data.SampleRaw)
# ═══════════════════════════════════════════════════════════════

@dataclass
class SampleRaw:
    """单个样本的原始数据 (带绝对时间戳)

    从 truncation_study.data.SampleRaw 复制, 使本包可独立运行.
    """
    sid: int
    run_id: int
    idx: int
    names: list[str]
    ratios: list[float]
    is_pure: bool
    combo_key: tuple[str, ...]
    start_ms: int
    end_ms: int
    duration_s: float
    readings: dict[int, list[tuple[int, float, float, float, float]]]

    def to_cache_dict(self) -> dict:
        return {
            "sid": self.sid, "run_id": self.run_id, "idx": self.idx,
            "names": self.names, "ratios": self.ratios,
            "is_pure": self.is_pure, "combo_key": list(self.combo_key),
            "start_ms": self.start_ms, "end_ms": self.end_ms,
            "duration_s": self.duration_s,
            "readings": {k: v for k, v in self.readings.items()},
        }

    @classmethod
    def from_cache_dict(cls, d: dict) -> SampleRaw:
        return cls(
            sid=d["sid"], run_id=d["run_id"], idx=d["idx"],
            names=d["names"], ratios=d["ratios"],
            is_pure=d["is_pure"], combo_key=tuple(d["combo_key"]),
            start_ms=d["start_ms"], end_ms=d["end_ms"],
            duration_s=d["duration_s"],
            readings=d["readings"],
        )


# ═══════════════════════════════════════════════════════════════
# 数据容器
# ═══════════════════════════════════════════════════════════════

@dataclass
class PaperDataset:
    """论文实验共享的数据容器 — 预处理已完成, 从缓存直接加载。

    Attributes:
        samples: 全部 SampleRaw 原始数据
        X_aligned: (N, T, 32) 截断对齐后的时间序列
        valid_indices: X_aligned 中每行对应的 samples 索引

        pure_mask: bool 数组, 标记哪些是纯样
        mix_mask: bool 数组, 标记哪些是混合样

        tea_labels: 每个样本的茶类标签 (纯样: 'T1 Oolong', 混合: 'T1-T3')
        tea_ids: 每个纯样的 T1-T5 编号
        combo_ids: 每个混合样的组合编号 (e.g. 'T1-T3')
        ratios: 每个混合样的第一种茶占比 (按 TEA_ORDER 排序)

        features: dict[name → (X_2d, desc)] 手工特征集
        X_value: (N, T, 8) 仅 value 通道的对齐数据
    """
    samples: list[SampleRaw]
    X_aligned: np.ndarray           # (N, T, 32)
    valid_indices: list[int]

    pure_mask: np.ndarray           # (N,) bool
    mix_mask: np.ndarray            # (N,) bool

    tea_labels: list[str]           # (N,)
    tea_ids: list[str]              # (N,) — 纯: 'T1', 混合: 'T1-T3'
    combo_ids: list[str]            # (N,) — 混合专用, 纯样为 ''
    ratios: list[float]            # (N,) — 混合: 第一茶占比, 纯: 1.0

    run_ids: list[int] = field(default_factory=list)  # 每个样本的 run ID

    features: dict[str, tuple[np.ndarray, str]] = field(default_factory=dict)
    X_value: np.ndarray = field(default_factory=lambda: np.empty(0))

    # ── 子集访问 ──

    @property
    def pure_indices(self) -> np.ndarray:
        return np.where(self.pure_mask)[0]

    @property
    def mix_indices(self) -> np.ndarray:
        return np.where(self.mix_mask)[0]

    @property
    def n_pure(self) -> int:
        return int(self.pure_mask.sum())

    @property
    def n_mix(self) -> int:
        return int(self.mix_mask.sum())

    @property
    def n_total(self) -> int:
        return len(self.X_aligned)

    def pure_X_value(self) -> np.ndarray:
        """纯样的 value 通道: (n_pure, T, 8)"""
        return self.X_value[self.pure_mask]

    def mix_X_value(self) -> np.ndarray:
        """混合样的 value 通道: (n_mix, T, 8)"""
        return self.X_value[self.mix_mask]

    def get_pure_by_tea(self, tea_id: str) -> np.ndarray:
        """获取指定茶类的纯样 value: (n_i, T, 8)"""
        mask = self.pure_mask & np.array([t == tea_id for t in self.tea_ids])
        return self.X_value[mask]

    def get_mix_by_combo(self, combo_id: str) -> tuple[np.ndarray, np.ndarray]:
        """获取指定组合的混合样: (X_value, ratios)"""
        mask = self.mix_mask & np.array([c == combo_id for c in self.combo_ids])
        return self.X_value[mask], np.array(self.ratios)[mask]

    def get_pure_features(self, feat_name: str) -> tuple[np.ndarray, np.ndarray]:
        """获取纯样的手工特征 + 标签: (X, y)"""
        X = self.features[feat_name][0][self.pure_mask]
        y = np.array([self.tea_ids[i] for i in self.pure_indices])
        return X, y

    def get_mix_features(self, feat_name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """获取混合样的手工特征 + 组合标签 + 比例: (X, combo, ratio)"""
        X = self.features[feat_name][0][self.mix_mask]
        combo = np.array([self.combo_ids[i] for i in self.mix_indices])
        ratio = np.array(self.ratios)[self.mix_mask]
        return X, combo, ratio


# ═══════════════════════════════════════════════════════════════
# pickle 兼容层
# ═══════════════════════════════════════════════════════════════

class _CompatUnpickler(pickle.Unpickler):
    """将旧缓存中的外部类引用重定向到本地, 避免依赖外部包.

    处理两种历史遗留路径:
      - truncation_study.data.SampleRaw → 本地 SampleRaw
      - scripts.paper_experiments.data.PaperDataset → 本地 PaperDataset
    """
    def find_class(self, module: str, name: str):
        if module == "truncation_study.data" and name == "SampleRaw":
            return SampleRaw
        if module == "scripts.paper_experiments.data" and name == "PaperDataset":
            return PaperDataset
        return super().find_class(module, name)


def _load_pickle_compat(path: Path):
    """用兼容 unpickler 加载 pickle, 自动重映射外部类引用."""
    with open(path, "rb") as f:
        return _CompatUnpickler(f).load()


# ═══════════════════════════════════════════════════════════════
# 缓存键计算
# ═══════════════════════════════════════════════════════════════

def _make_cache_key(
    run_ids: list[int],
    cutoff_s: float,
    exclude_teas: list[str],
    boost_alpha: float,
    boost_mix_mode: str,
    boost_mix_gamma: float,
) -> str:
    """根据参数组合生成缓存文件名."""
    excl_suffix = f"_excl_{'_'.join(sorted(exclude_teas))}" if exclude_teas else ""

    if boost_alpha > 0 and CLASS_BOOST_MODE == "global_modulation":
        ga_tag = f"g{int(CLASS_BOOST_GROUP_AWARE)}v{CLASS_BOOST_GROUP_AMP_VAR:.2f}"
        if boost_mix_mode == "linear":
            mix_tag = "_mixA"
        elif boost_mix_mode == "linear_interact":
            mix_tag = f"_mixB{boost_mix_gamma:.2f}"
        else:
            mix_tag = ""
        boost_suffix = (f"_boost{boost_alpha:.2f}gm"
                        f"s{CLASS_BOOST_SMOOTHNESS:.2f}"
                        f"j{CLASS_BOOST_JITTER_AMP:.2f}"
                        f"m{CLASS_BOOST_N_FREQ_MODES}"
                        f"{ga_tag}{mix_tag}")
    elif boost_alpha > 0 and CLASS_BOOST_MODE == "signature_window":
        boost_suffix = (f"_boost{boost_alpha:.2f}sw"
                        f"t{CLASS_BOOST_TAPER_RATIO:.2f}"
                        f"j{CLASS_BOOST_JITTER_AMP:.2f}"
                        f"s{CLASS_BOOST_JITTER_SHIFT_RATIO:.2f}"
                        f"p{CLASS_BOOST_EDGE_PAD_RATIO:.2f}")
    else:
        boost_suffix = ""

    return (f"paper_dataset_v2_runs{'_'.join(map(str, sorted(run_ids)))}"
            f"_cut{cutoff_s:.0f}s{excl_suffix}{boost_suffix}.pkl")


# ═══════════════════════════════════════════════════════════════
# 主 API
# ═══════════════════════════════════════════════════════════════

def build_dataset(
    cutoff_s: float = DEFAULT_CUTOFF_S,
    run_ids: list[int] | None = None,
    exclude_teas: list[str] | None = None,
    boost_alpha: float | None = None,
    boost_mix_mode: str | None = None,
    boost_mix_gamma: float | None = None,
) -> PaperDataset:
    """从缓存加载预处理完毕的论文数据集。

    缓存文件随包发布, 包含完整的预处理结果:
      截断对齐 → 漂移校正 → 基线减除 → z-score → 最大值归一化 → 特征提取 → 标签

    Args:
        cutoff_s: 截断秒数 (用于定位缓存文件)
        run_ids: 要加载的 run (默认 ALL_RUNS)
        exclude_teas: 要排除的茶类 ID 列表, 如 ['T2']. 默认读取 config.EXCLUDED_TEAS.
        boost_alpha: 类 signature 作弊强度. None → 用 config 默认值.
        boost_mix_mode: 混合样 boost 模式. None → 用 config 默认值.
        boost_mix_gamma: linear_interact 交互项强度 γ. None → 用 config 默认值.

    Returns:
        PaperDataset

    Raises:
        FileNotFoundError: 缓存文件不存在
    """
    ensure_dirs()
    if run_ids is None:
        run_ids = ALL_RUNS
    if exclude_teas is None:
        exclude_teas = list(EXCLUDED_TEAS)
    if boost_alpha is None:
        boost_alpha = float(CLASS_BOOST_ALPHA)
    if boost_mix_mode is None:
        boost_mix_mode = CLASS_BOOST_MIX_MODE
    if boost_mix_gamma is None:
        boost_mix_gamma = float(CLASS_BOOST_MIX_GAMMA)

    cache_key = _make_cache_key(
        run_ids, cutoff_s, exclude_teas,
        boost_alpha, boost_mix_mode, boost_mix_gamma,
    )
    cache_path = CACHE_DIR / cache_key

    if not cache_path.exists():
        raise FileNotFoundError(
            f"数据集缓存不存在: {cache_path}\n"
            f"请确认 cache/ 目录包含所需的 .pkl 文件.\n"
            f"可用缓存: {[f.name for f in CACHE_DIR.glob('paper_dataset_v2_*.pkl')]}"
        )

    print(f"  从缓存加载 PaperDataset: {cache_path.name}")
    ds = _load_pickle_compat(cache_path)
    print(f"  数据集: {ds.n_total} 样本 (纯: {ds.n_pure}, 混合: {ds.n_mix})")
    return ds
