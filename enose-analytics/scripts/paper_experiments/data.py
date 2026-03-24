"""数据加载门面 — 复用 truncation_study 的 DB/缓存/对齐管线。

对外提供高层 API:
  load_all()       → 加载全部样本原始数据 (带缓存)
  build_dataset()  → 截断对齐 + 拆分纯/混合 + 标签生成
  PaperDataset     → 实验共享的数据容器
"""

from __future__ import annotations

import sys
import pickle
import numpy as np
from dataclasses import dataclass, field
from pathlib import Path

# 确保 truncation_study 包可导入
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from truncation_study.data import SampleRaw, load_raw_data, build_truncated
from truncation_study.features import make_features

from .config import (
    ALL_RUNS, PURE_RUNS, MIX_RUNS,
    DEFAULT_CUTOFF_S, N_ALIGN_STEPS, GOOD_SENSORS,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN,
    tea_label, tea_short, combo_label,
    CACHE_DIR, SEED, ensure_dirs,
)
from .drift import run_drift_analysis


# ═══════════════════════════════════════════════════════════════
# 数据容器
# ═══════════════════════════════════════════════════════════════

@dataclass
class PaperDataset:
    """论文实验共享的数据容器 — 一次构建, 多处复用。

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
# 标签生成辅助
# ═══════════════════════════════════════════════════════════════

def _make_labels(samples: list[SampleRaw], valid_indices: list[int]):
    """从样本元数据生成论文标签。

    Returns:
        tea_labels, tea_ids, combo_ids, ratios, pure_mask, mix_mask
    """
    tea_labels = []
    tea_ids = []
    combo_ids = []
    ratios = []
    pure_mask = []
    mix_mask = []

    for idx in valid_indices:
        s = samples[idx]
        if s.is_pure:
            tl = tea_label(s.names[0])
            tid = TEA_IDS.get(s.names[0], "T?")
            tea_labels.append(tl)
            tea_ids.append(tid)
            combo_ids.append("")
            ratios.append(1.0)
            pure_mask.append(True)
            mix_mask.append(False)
        else:
            # 二元混合: 按 TEA_ORDER 排序
            sorted_names = sorted(s.names, key=lambda n: TEA_ORDER.index(n) if n in TEA_ORDER else 99)
            cid = combo_label(s.names)
            tea_labels.append(cid)
            tea_ids.append(cid)
            combo_ids.append(cid)
            # 第一种茶 (TEA_ORDER 中靠前的) 的比例
            first_name = sorted_names[0]
            first_idx = s.names.index(first_name)
            ratios.append(s.ratios[first_idx])
            pure_mask.append(False)
            mix_mask.append(True)

    return (
        tea_labels, tea_ids, combo_ids, ratios,
        np.array(pure_mask), np.array(mix_mask),
    )


# ═══════════════════════════════════════════════════════════════
# 离群值过滤
# ═══════════════════════════════════════════════════════════════

def _filter_outliers(
    X_aligned: np.ndarray,
    valid_indices: list[int],
    samples: list[SampleRaw],
    sigma: float = 3.0,
) -> tuple[np.ndarray, list[int]]:
    """基于 value 通道 z-score 范数剔除离群样本。

    对每个样本的 8 通道时间序列展平后计算全局 z-score,
    范数超过 mean + sigma*std 的样本被视为离群值并剔除。

    Args:
        X_aligned: (N, T, 32)
        valid_indices: 每行对应 samples 的索引
        samples: 原始样本列表
        sigma: 离群值阈值 (标准差倍数)

    Returns:
        X_filtered, filtered_indices
    """
    from sklearn.preprocessing import StandardScaler

    X_value = X_aligned[:, :, GOOD_SENSORS]  # (N, T, 8)
    N = X_value.shape[0]
    X_flat = X_value.reshape(N, -1)

    X_scaled = StandardScaler().fit_transform(X_flat)
    sample_norms = np.linalg.norm(X_scaled, axis=1)

    threshold = np.mean(sample_norms) + sigma * np.std(sample_norms)
    keep_mask = sample_norms <= threshold
    n_removed = N - keep_mask.sum()

    if n_removed > 0:
        print(f"  离群值过滤 ({sigma}σ): 剔除 {n_removed}/{N} 样本 "
              f"(阈值={threshold:.1f})")
        removed_indices = np.where(~keep_mask)[0]
        for i in removed_indices:
            rid = samples[valid_indices[i]].run_id
            s = samples[valid_indices[i]]
            tea = TEA_IDS.get(s.names[0], s.names[0]) if s.is_pure else combo_label(s.names)
            print(f"    剔除: run={rid}, {tea}, norm={sample_norms[i]:.1f}")
    else:
        print(f"  离群值过滤 ({sigma}σ): 无离群值")

    X_filtered = X_aligned[keep_mask]
    filtered_indices = [valid_indices[i] for i in range(N) if keep_mask[i]]
    return X_filtered, filtered_indices


# ═══════════════════════════════════════════════════════════════
# 主 API
# ═══════════════════════════════════════════════════════════════

def build_dataset(
    cutoff_s: float = DEFAULT_CUTOFF_S,
    run_ids: list[int] | None = None,
    force_reload: bool = False,
) -> PaperDataset:
    """端到端构建论文数据集。

    1. 从 DB/缓存 加载原始数据
    2. 截断 + PCHIP 对齐
    3. 提取手工特征
    4. 生成标签

    Args:
        cutoff_s: 截断秒数
        run_ids: 要加载的 run (默认 ALL_RUNS)
        force_reload: 强制从 DB 重新加载

    Returns:
        PaperDataset
    """
    ensure_dirs()
    if run_ids is None:
        run_ids = ALL_RUNS

    # ── 尝试加载完整的缓存 dataset ──
    cache_key = f"paper_dataset_runs{'_'.join(map(str, sorted(run_ids)))}_cut{cutoff_s:.0f}s.pkl"
    cache_path = CACHE_DIR / cache_key

    if not force_reload and cache_path.exists():
        print(f"  从缓存加载 PaperDataset: {cache_path.name}")
        with open(cache_path, "rb") as f:
            return pickle.load(f)

    # ── 1. 加载原始数据 ──
    print(f"  加载原始数据 (runs={run_ids})...")
    samples = load_raw_data(run_ids, force_reload=force_reload)
    print(f"  样本总数: {len(samples)}")

    # ── 2. 截断 + 对齐 ──
    print(f"  截断 {cutoff_s}s + PCHIP 对齐...")
    X_aligned, valid_indices = build_truncated(
        samples, cutoff_s, n_steps=N_ALIGN_STEPS, n_workers=4
    )
    print(f"  对齐成功: {len(valid_indices)}/{len(samples)} 样本, shape={X_aligned.shape}")

    # ── 2.5. 离群值过滤 ──
    X_aligned, valid_indices = _filter_outliers(
        X_aligned, valid_indices, samples, sigma=3.0,
    )

    # ── 3. 生成标签 (漂移校正可视化需要) ──
    print(f"  生成标签...")
    tea_labels, tea_ids, combo_ids, ratios, pure_mask, mix_mask = \
        _make_labels(samples, valid_indices)

    # ── 3.5. 漂移校正 ──
    X_value_raw = X_aligned[:, :, GOOD_SENSORS]  # (N, T, 8)
    sample_run_ids_tmp = [samples[i].run_id for i in valid_indices]
    X_value_corrected, drift_method, drift_metrics = run_drift_analysis(
        X_value_raw, sample_run_ids_tmp, tea_ids,
        method="run_median_align",
    )
    # 将校正后的 value 通道写回 X_aligned
    X_aligned[:, :, GOOD_SENSORS] = X_value_corrected
    print(f"  漂移校正完成: 方法={drift_method}")

    # ── 4. 提取手工特征 (基于校正后数据) ──
    print(f"  提取手工特征...")
    features = make_features(X_aligned)
    for name, (X, desc) in features.items():
        print(f"    {name}: {X.shape} — {desc}")

    # ── 5. 提取 value 通道 ──
    X_value = X_aligned[:, :, GOOD_SENSORS]  # (N, T, 8) — 已校正

    # run_ids
    sample_run_ids = [samples[i].run_id for i in valid_indices]

    dataset = PaperDataset(
        samples=samples,
        X_aligned=X_aligned,
        valid_indices=valid_indices,
        pure_mask=pure_mask,
        mix_mask=mix_mask,
        tea_labels=tea_labels,
        tea_ids=tea_ids,
        combo_ids=combo_ids,
        ratios=ratios,
        run_ids=sample_run_ids,
        features=features,
        X_value=X_value,
    )

    # ── 打印摘要 ──
    print(f"\n  === PaperDataset 摘要 ===")
    print(f"  总样本: {dataset.n_total} (纯: {dataset.n_pure}, 混合: {dataset.n_mix})")
    for tid in ["T1", "T2", "T3", "T4", "T5"]:
        n = sum(1 for t in tea_ids if t == tid)
        raw = TEA_ORDER[int(tid[1]) - 1] if tid[1].isdigit() else "?"
        print(f"    {tid} {tea_short(raw)}: {n}")
    combos = sorted(set(c for c in combo_ids if c))
    for c in combos:
        n = sum(1 for x in combo_ids if x == c)
        print(f"    {c}: {n}")

    # ── 缓存 ──
    print(f"  缓存 PaperDataset → {cache_path.name}")
    with open(cache_path, "wb") as f:
        pickle.dump(dataset, f, protocol=5)

    return dataset
