"""特征工程模块 — 向量化实现, 从对齐序列构建多种特征表示。

输入: X_raw (N, T, 32) — 8 传感器 × 4 通道
输出: dict[str, tuple[np.ndarray, str]]  — {名称: (X_2d, 描述)}
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d

from .config import GOOD_SENSORS


# ═══════════════════════════════════════════════════════════════
# 基础变换 (全向量化)
# ═══════════════════════════════════════════════════════════════

def baseline_normalize(X: np.ndarray) -> np.ndarray:
    """基线归一化: X / mean(前10%), (N,T,S) → (N,T,S)"""
    T = X.shape[1]
    bl = max(1, T // 10)
    baseline = X[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    return X / baseline


def extract_stats(X: np.ndarray) -> np.ndarray:
    """统计特征, (N,T,S) → (N, S*12), 全向量化"""
    N, T, S = X.shape
    feats = []
    feats.append(X.mean(axis=1))                           # mean
    feats.append(X.std(axis=1))                            # std
    feats.append(X.min(axis=1))                            # min
    feats.append(X.max(axis=1))                            # max
    feats.append(X.max(axis=1) - X.min(axis=1))           # range
    feats.append(np.percentile(X, 25, axis=1))            # q25
    feats.append(np.percentile(X, 75, axis=1))            # q75
    feats.append(np.median(X, axis=1))                     # median
    feats.append(np.argmax(X, axis=1).astype(float) / T)  # argmax/T
    feats.append(np.argmin(X, axis=1).astype(float) / T)  # argmin/T
    feats.append(X[:, -1, :] - X[:, 0, :])                # last-first
    feats.append(np.mean(np.abs(np.diff(X, axis=1)), axis=1))  # mean_abs_diff
    # 每个 (N, S), 交错拼接为 (N, S*12)
    result = np.empty((N, S * 12), dtype=np.float64)
    for i, f in enumerate(feats):
        result[:, i::12] = f
    return result


def extract_segment_stats(X: np.ndarray, n_seg: int = 5) -> np.ndarray:
    """分段统计: (N,T,S) → (N, n_seg*S*2), 向量化"""
    N, T, S = X.shape
    seg_len = T // n_seg
    parts = []
    for seg in range(n_seg):
        start = seg * seg_len
        end = start + seg_len if seg < n_seg - 1 else T
        chunk = X[:, start:end, :]  # (N, seg_len, S)
        parts.append(chunk.mean(axis=1))  # (N, S)
        parts.append(chunk.std(axis=1))   # (N, S)
    return np.hstack(parts)  # (N, n_seg*S*2)


# ═══════════════════════════════════════════════════════════════
# 特征 Pipeline
# ═══════════════════════════════════════════════════════════════

def make_features(X_raw: np.ndarray) -> dict[str, tuple[np.ndarray, str]]:
    """从 (N, T, 32) 构建精简特征集。

    Returns: {name: (X_2d, description)}
    """
    N, T, _ = X_raw.shape
    n_s = len(GOOD_SENSORS)
    X_val = X_raw[:, :, GOOD_SENSORS]  # (N, T, n_s)

    X_norm = baseline_normalize(X_val)
    X_log = np.log1p(np.abs(X_val))
    X_log_norm = baseline_normalize(X_log)
    X_smooth_norm = baseline_normalize(
        uniform_filter1d(X_val, size=5, axis=1)
    )

    features: dict[str, tuple[np.ndarray, str]] = {}

    # 展平时序
    features["norm"]     = (X_norm.reshape(N, -1),     f"基线归一化 ({T}x{n_s})")
    features["log_norm"] = (X_log_norm.reshape(N, -1), f"log基线归一化 ({T}x{n_s})")

    # 统计
    features["stats"]          = (extract_stats(X_val),      f"统计 ({n_s}x12)")
    features["norm_stats"]     = (extract_stats(X_norm),     f"归一化统计 ({n_s}x12)")
    features["log_norm_stats"] = (extract_stats(X_log_norm), f"log归一化统计 ({n_s}x12)")

    # 分段
    features["seg_norm"] = (
        extract_segment_stats(X_norm, 5),
        f"分段归一化 (5seg x{n_s}x2)",
    )

    return features
