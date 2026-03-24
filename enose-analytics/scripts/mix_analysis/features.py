"""特征工程模块 — 从对齐序列构建多种特征表示。

输入: X_raw (N, T, 32) — 8 传感器 × 4 通道
输出: dict[str, FeatureSet] — 多种特征表示
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass
from scipy.ndimage import uniform_filter1d

from .config import ExperimentConfig


@dataclass
class FeatureSet:
    """单种特征表示"""
    X: np.ndarray          # (N, D) 特征矩阵
    name: str              # 特征名称
    desc: str              # 人类可读描述
    n_sensors: int         # 使用的传感器数量
    n_timesteps: int       # 原始时间步数


# ═══════════════════════════════════════════════════════════════
# 基础变换
# ═══════════════════════════════════════════════════════════════

def baseline_normalize(X: np.ndarray, baseline_ratio: float = 0.1) -> np.ndarray:
    """基线归一化: 除以前 baseline_ratio 时间步的均值。
    X: (N, T, S) → (N, T, S)
    """
    T = X.shape[1]
    bl = max(1, int(T * baseline_ratio))
    baseline = X[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    return X / baseline


def log_transform(X: np.ndarray) -> np.ndarray:
    """log(1 + |x|) 变换"""
    return np.log1p(np.abs(X))


def smooth(X: np.ndarray, window: int = 5) -> np.ndarray:
    """沿时间轴的移动平均平滑"""
    return uniform_filter1d(X, size=window, axis=1)


def first_diff(X: np.ndarray) -> np.ndarray:
    """一阶差分 (N, T, S) → (N, T-1, S)"""
    return np.diff(X, axis=1)


# ═══════════════════════════════════════════════════════════════
# 统计特征
# ═══════════════════════════════════════════════════════════════

def extract_stats(X: np.ndarray) -> np.ndarray:
    """从 (N, T, S) 提取统计特征 → (N, S*12)

    每个传感器 12 个统计量:
      mean, std, min, max, range, q25, q75, median,
      argmax/T, argmin/T, last-first, mean_abs_diff
    """
    N, T, S = X.shape
    stats = np.empty((N, S * 12))
    for i in range(N):
        for j in range(S):
            ch = X[i, :, j]
            offset = j * 12
            stats[i, offset:offset + 12] = [
                ch.mean(), ch.std(), ch.min(), ch.max(),
                ch.max() - ch.min(),
                np.percentile(ch, 25), np.percentile(ch, 75), np.median(ch),
                np.argmax(ch) / T, np.argmin(ch) / T,
                ch[-1] - ch[0],
                np.mean(np.abs(np.diff(ch))),
            ]
    return stats


def extract_segment_stats(
    X: np.ndarray, n_segments: int = 5
) -> np.ndarray:
    """分段统计: 将时间轴分为 n_segments 段，每段提取 mean+std。
    (N, T, S) → (N, n_segments * S * 2)
    """
    N, T, S = X.shape
    seg_len = T // n_segments
    features = np.empty((N, n_segments * S * 2))

    for i in range(N):
        idx = 0
        for seg in range(n_segments):
            start = seg * seg_len
            end = start + seg_len if seg < n_segments - 1 else T
            for j in range(S):
                ch_seg = X[i, start:end, j]
                features[i, idx] = ch_seg.mean()
                features[i, idx + 1] = ch_seg.std()
                idx += 2
    return features


# ═══════════════════════════════════════════════════════════════
# 特征工程 Pipeline
# ═══════════════════════════════════════════════════════════════

def make_features(
    X_raw: np.ndarray,
    exp: ExperimentConfig,
) -> dict[str, FeatureSet]:
    """从原始 (N, T, 32) 对齐序列构建全部特征表示。

    传感器选择策略:
    - "8ch": 全部 8 个传感器 (active_sensors)
    - 特征名带 _8ch 或不带后缀: 使用 active_sensors
    """
    N, T, C = X_raw.shape
    sensors = exp.sensor.active_sensors
    n_s = len(sensors)
    bl_ratio = exp.alignment.baseline_ratio

    # 提取 value 通道 (前 8 列) 中的活跃传感器
    X_val = X_raw[:, :, sensors]  # (N, T, n_s)

    # 基础变换
    X_norm = baseline_normalize(X_val, bl_ratio)
    X_log = log_transform(X_val)
    X_log_norm = baseline_normalize(X_log, bl_ratio)
    X_smooth = smooth(X_val)
    X_smooth_norm = baseline_normalize(X_smooth, bl_ratio)

    features: dict[str, FeatureSet] = {}

    def _add(name: str, X_3d: np.ndarray, desc: str):
        features[name] = FeatureSet(
            X=X_3d.reshape(N, -1), name=name, desc=desc,
            n_sensors=n_s, n_timesteps=T,
        )

    # ── 展平时序特征 ──
    _add("value", X_val, f"原始 value ({T}×{n_s}={T*n_s})")
    _add("norm", X_norm, f"基线归一化 ({T}×{n_s}={T*n_s})")
    _add("log", X_log, f"log(1+|x|) ({T}×{n_s}={T*n_s})")
    _add("log_norm", X_log_norm, f"log 基线归一化 ({T}×{n_s}={T*n_s})")
    _add("smooth_norm", X_smooth_norm, f"平滑+归一化 ({T}×{n_s}={T*n_s})")

    # 一阶差分
    X_diff = first_diff(X_val)
    features["diff"] = FeatureSet(
        X=X_diff.reshape(N, -1), name="diff",
        desc=f"一阶差分 ({T-1}×{n_s}={(T-1)*n_s})",
        n_sensors=n_s, n_timesteps=T - 1,
    )

    # ── 统计特征 ──
    stats = extract_stats(X_val)
    features["stats"] = FeatureSet(
        X=stats, name="stats", desc=f"统计 ({n_s}×12={n_s*12})",
        n_sensors=n_s, n_timesteps=T,
    )
    norm_stats = extract_stats(X_norm)
    features["norm_stats"] = FeatureSet(
        X=norm_stats, name="norm_stats", desc=f"归一化统计 ({n_s}×12={n_s*12})",
        n_sensors=n_s, n_timesteps=T,
    )
    log_norm_stats = extract_stats(X_log_norm)
    features["log_norm_stats"] = FeatureSet(
        X=log_norm_stats, name="log_norm_stats",
        desc=f"log归一化统计 ({n_s}×12={n_s*12})",
        n_sensors=n_s, n_timesteps=T,
    )

    # ── 分段统计 ──
    n_seg = 5
    seg_norm = extract_segment_stats(X_norm, n_seg)
    features["seg_norm"] = FeatureSet(
        X=seg_norm, name="seg_norm",
        desc=f"分段归一化 ({n_seg}seg×{n_s}×2={n_seg*n_s*2})",
        n_sensors=n_s, n_timesteps=T,
    )
    seg_smooth = extract_segment_stats(X_smooth_norm, n_seg)
    features["seg_smooth_norm"] = FeatureSet(
        X=seg_smooth, name="seg_smooth_norm",
        desc=f"分段平滑归一化 ({n_seg}seg×{n_s}×2={n_seg*n_s*2})",
        n_sensors=n_s, n_timesteps=T,
    )

    return features
