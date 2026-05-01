"""传感器漂移校正模块 — 消除批次间基线漂移。

问题: 不同 run (不同天/不同实验) 的传感器基线差异远大于茶类间差异,
      导致 PCA/UMAP 按 run 聚类而非按茶类聚类。

校正方法 (按优先级):
  1. run_zscore — 逐 run、逐通道 Z-Score 标准化
  2. run_median_align — 逐 run 对齐到全局中位数基线
  3. component_correction (CC) — PCA 去除批次主成分

可视化输出:
  - 校正前 PCA/UMAP (按 run 着色)
  - 校正后 PCA/UMAP (按 run 着色)
  - 校正后 PCA/UMAP (按茶类着色)
"""

from __future__ import annotations

import numpy as np
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from .config import (
    SEED, FONT_SIZE, FIGURES_DIR, TABLES_DIR, ensure_dirs,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN, TEA_COLORS, TEA_MARKERS,
)
from .viz import init_style, save_fig


# ═══════════════════════════════════════════════════════════════
# 1. Run-level Z-Score
# ═══════════════════════════════════════════════════════════════

def run_zscore(
    X: np.ndarray,
    run_ids: np.ndarray,
) -> np.ndarray:
    """逐 run、逐通道 Z-Score 标准化。

    对每个 run 内的每个传感器通道, 减去该 run 的均值, 除以标准差。
    这消除了 run 间的基线偏移和增益差异。

    Args:
        X: (N, T, C) 时间序列数据
        run_ids: (N,) 每个样本的 run ID

    Returns:
        X_corrected: (N, T, C) 校正后的数据
    """
    X_out = np.empty_like(X, dtype=np.float64)
    unique_runs = np.unique(run_ids)

    for rid in unique_runs:
        mask = run_ids == rid
        X_run = X[mask]  # (n_run, T, C)
        n_run = X_run.shape[0]

        # 逐通道: 在该 run 内所有样本所有时间步上计算 mean/std
        for c in range(X.shape[2]):
            vals = X_run[:, :, c].ravel()  # (n_run * T,)
            mu = vals.mean()
            sigma = vals.std()
            sigma = max(sigma, 1e-10)  # 防零
            X_out[mask, :, c] = (X_run[:, :, c] - mu) / sigma

    return X_out


# ═══════════════════════════════════════════════════════════════
# 2. Run Median Alignment
# ═══════════════════════════════════════════════════════════════

def run_median_align(
    X: np.ndarray,
    run_ids: np.ndarray,
    ref_run: int | None = None,
) -> np.ndarray:
    """逐 run 对齐到参考 run 的基线中位数。

    使用乘法校正: X_corrected = X * (ref_baseline / run_baseline)
    其中 baseline = 前 10% 时间步的中位数。

    Args:
        X: (N, T, C)
        run_ids: (N,)
        ref_run: 参考 run ID, None 则使用全局中位数

    Returns:
        X_corrected: (N, T, C)
    """
    T = X.shape[1]
    bl = max(1, T // 10)
    unique_runs = np.unique(run_ids)

    # 计算各 run 的基线中位数 (C,)
    run_baselines = {}
    for rid in unique_runs:
        mask = run_ids == rid
        bl_values = X[mask, :bl, :]  # (n_run, bl, C)
        run_baselines[rid] = np.median(bl_values, axis=(0, 1))  # (C,)

    # 参考基线
    if ref_run is not None:
        ref_bl = run_baselines[ref_run]
    else:
        # 全局中位数
        all_bl = np.stack(list(run_baselines.values()))  # (n_runs, C)
        ref_bl = np.median(all_bl, axis=0)  # (C,)

    # 乘法校正
    X_out = np.empty_like(X, dtype=np.float64)
    for rid in unique_runs:
        mask = run_ids == rid
        ratio = ref_bl / np.maximum(run_baselines[rid], 1e-10)  # (C,)
        X_out[mask] = X[mask] * ratio[np.newaxis, np.newaxis, :]

    return X_out


# ═══════════════════════════════════════════════════════════════
# 3. Component Correction (CC)
# ═══════════════════════════════════════════════════════════════

def component_correction(
    X: np.ndarray,
    run_ids: np.ndarray,
    n_components: int = 1,
) -> np.ndarray:
    """PCA-based Component Correction.

    1. 计算每个 run 的质心
    2. 对 run 质心做 PCA, 找到前 n_components 个批次主方向
    3. 将所有数据投影到这些方向的正交补空间

    Args:
        X: (N, T, C) 时间序列
        run_ids: (N,)
        n_components: 要移除的批次主成分数

    Returns:
        X_corrected: (N, T, C)
    """
    from sklearn.decomposition import PCA

    N, T, C = X.shape
    X_flat = X.reshape(N, T * C)  # (N, T*C)

    # 计算 run 质心
    unique_runs = np.unique(run_ids)
    centroids = []
    for rid in unique_runs:
        mask = run_ids == rid
        centroids.append(X_flat[mask].mean(axis=0))
    centroids = np.stack(centroids)  # (n_runs, T*C)

    # PCA on centroids
    pca = PCA(n_components=min(n_components, len(unique_runs) - 1))
    pca.fit(centroids)

    # 投影到批次主方向的正交补
    batch_directions = pca.components_  # (n_comp, T*C)
    X_centered = X_flat - X_flat.mean(axis=0, keepdims=True)

    for direction in batch_directions:
        direction = direction / np.linalg.norm(direction)
        proj = (X_centered @ direction).reshape(-1, 1) * direction.reshape(1, -1)
        X_centered = X_centered - proj

    X_corrected = X_centered + X_flat.mean(axis=0, keepdims=True)
    return X_corrected.reshape(N, T, C)


# ═══════════════════════════════════════════════════════════════
# 校正管线
# ═══════════════════════════════════════════════════════════════

CORRECTION_METHODS = {
    "run_zscore": run_zscore,
    "run_median_align": run_median_align,
    "component_correction": component_correction,
}

def apply_drift_correction(
    X: np.ndarray,
    run_ids: np.ndarray,
    method: str = "run_zscore",
    **kwargs,
) -> np.ndarray:
    """应用漂移校正。

    Args:
        X: (N, T, C) 原始数据
        run_ids: (N,) run ID 数组
        method: 校正方法名
        **kwargs: 传给校正函数的参数

    Returns:
        X_corrected: (N, T, C)
    """
    if method not in CORRECTION_METHODS:
        raise ValueError(f"未知校正方法: {method}, 可选: {list(CORRECTION_METHODS.keys())}")

    run_ids = np.asarray(run_ids)
    fn = CORRECTION_METHODS[method]
    return fn(X, run_ids, **kwargs)


# ═══════════════════════════════════════════════════════════════
# 可视化: 对齐前后对比
# ═══════════════════════════════════════════════════════════════

# run 着色用的 colormap
_RUN_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
    "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
    "#bcbd22", "#17becf",
]


def plot_drift_diagnosis(
    X_before: np.ndarray,
    X_after: np.ndarray,
    run_ids: np.ndarray,
    tea_ids: list[str],
    method_name: str = "run_zscore",
    subdir: str = "drift",
) -> dict:
    """绘制漂移校正前后对比图。

    生成 4 张图:
      (a) 校正前 PCA (按 run 着色) — 展示批次效应
      (b) 校正后 PCA (按 run 着色) — 批次效应消除
      (c) 校正后 PCA (按茶类着色) — 展示茶类区分度
      (d) 校正前后基线对比 (箱线图)

    Returns:
        metrics: 校正质量指标
    """
    ensure_dirs()
    init_style()

    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import silhouette_score

    N, T, C = X_before.shape
    run_ids_arr = np.asarray(run_ids)
    tea_ids_arr = np.array(tea_ids)
    unique_runs = sorted(set(run_ids_arr))
    run_color_map = {r: _RUN_COLORS[i % len(_RUN_COLORS)] for i, r in enumerate(unique_runs)}

    # 展平 + StandardScaler 再 PCA (避免被绝对值量级主导)
    X_before_flat = StandardScaler().fit_transform(X_before.reshape(N, -1))
    X_after_flat = StandardScaler().fit_transform(X_after.reshape(N, -1))

    # PCA
    pca_before = PCA(n_components=2, random_state=SEED).fit_transform(X_before_flat)
    pca_after = PCA(n_components=2, random_state=SEED).fit_transform(X_after_flat)

    fig, axes = plt.subplots(2, 2, figsize=(12, 10))

    # ── (a) 校正前 by run ──
    ax = axes[0, 0]
    for rid in unique_runs:
        mask = run_ids_arr == rid
        ax.scatter(pca_before[mask, 0], pca_before[mask, 1],
                   c=run_color_map[rid], s=20, alpha=0.6, label=f"Run {rid}")
    ax.set_title("(a) Before correction (by run)")
    ax.set_xlabel("PC1")
    ax.set_ylabel("PC2")
    ax.legend(fontsize=FONT_SIZE - 4, ncol=2)

    # ── (b) 校正后 by run ──
    ax = axes[0, 1]
    for rid in unique_runs:
        mask = run_ids_arr == rid
        ax.scatter(pca_after[mask, 0], pca_after[mask, 1],
                   c=run_color_map[rid], s=20, alpha=0.6, label=f"Run {rid}")
    ax.set_title("(b) After correction (by run)")
    ax.set_xlabel("PC1")
    ax.set_ylabel("PC2")
    ax.legend(fontsize=FONT_SIZE - 4, ncol=2)

    # ── (c) 校正后 by tea ──
    ax = axes[1, 0]
    unique_teas = sorted(set(tea_ids_arr))
    for tid in unique_teas:
        if tid.startswith("T") and len(tid) == 2 and tid[1].isdigit():
            mask = tea_ids_arr == tid
            color = TEA_COLORS.get(tid, "#999999")
            marker = TEA_MARKERS.get(tid, "o")
            raw_name = TEA_ORDER[int(tid[1]) - 1]
            en_name = TEA_NAME_EN.get(raw_name, tid)
            ax.scatter(pca_after[mask, 0], pca_after[mask, 1],
                       c=color, marker=marker, s=32, alpha=0.7,
                       label=f"{tid} {en_name}", edgecolors="white", linewidth=0.5)
    # 混合样用小灰点
    mix_mask_arr = np.array(["-" in t for t in tea_ids_arr])
    if mix_mask_arr.any():
        ax.scatter(pca_after[mix_mask_arr, 0], pca_after[mix_mask_arr, 1],
                   c="#BBBBBB", s=5, alpha=0.3, label="Blends")
    ax.set_title("(c) After correction (by tea type)")
    ax.set_xlabel("PC1")
    ax.set_ylabel("PC2")
    ax.legend(fontsize=FONT_SIZE - 4, ncol=2)

    # ── (d) 基线对比箱线图 (归一化到全局中位数) ──
    ax = axes[1, 1]
    bl = max(1, T // 10)
    # 全局中位数基线作为参考
    global_median = np.median(X_before[:, :bl, :].mean(axis=1), axis=0)  # (C,)
    global_median = np.maximum(global_median, 1e-10)
    baselines_before = []
    baselines_after = []
    run_labels = []
    for rid in unique_runs:
        mask = run_ids_arr == rid
        bl_b = X_before[mask, :bl, :].mean(axis=1)  # (n, C)
        bl_a = X_after[mask, :bl, :].mean(axis=1)   # (n, C)
        # 归一化: 除以全局中位数, 然后取各通道均值
        bl_b = (bl_b / global_median).mean(axis=1)  # (n,)
        bl_a = (bl_a / global_median).mean(axis=1)   # (n,)
        baselines_before.append(bl_b)
        baselines_after.append(bl_a)
        run_labels.append(f"R{rid}")

    positions = np.arange(len(unique_runs))
    width = 0.35
    bp1 = ax.boxplot(baselines_before, positions=positions - width/2, widths=width,
                      patch_artist=True, boxprops=dict(facecolor="#FFB3B3", alpha=0.7))
    bp2 = ax.boxplot(baselines_after, positions=positions + width/2, widths=width,
                      patch_artist=True, boxprops=dict(facecolor="#B3D9FF", alpha=0.7))
    ax.set_xticks(positions)
    ax.set_xticklabels(run_labels, fontsize=FONT_SIZE - 4)
    ax.set_title("(d) Baseline distribution before/after")
    ax.set_ylabel("Mean baseline")
    ax.legend([bp1["boxes"][0], bp2["boxes"][0]], ["Before", "After"], fontsize=FONT_SIZE - 2)

    fig.suptitle(f"Drift Correction: {method_name}", fontsize=FONT_SIZE + 2)
    fig.tight_layout()
    save_fig(fig, f"drift_correction_{method_name}", subdir=subdir)

    # ── 量化指标 ──
    metrics = {}

    # Silhouette by run (越低越好 — 说明 run 不再是聚类因素)
    from sklearn.preprocessing import LabelEncoder
    le_run = LabelEncoder()
    run_enc = le_run.fit_transform(run_ids_arr)
    if len(set(run_enc)) >= 2:
        sil_run_before = silhouette_score(pca_before, run_enc)
        sil_run_after = silhouette_score(pca_after, run_enc)
        metrics["sil_by_run_before"] = round(sil_run_before, 4)
        metrics["sil_by_run_after"] = round(sil_run_after, 4)

    # Silhouette by tea (仅纯样, 越高越好)
    pure_mask = np.array([not ("-" in t) for t in tea_ids_arr])
    if pure_mask.sum() > 10:
        le_tea = LabelEncoder()
        tea_enc = le_tea.fit_transform(tea_ids_arr[pure_mask])
        if len(set(tea_enc)) >= 2:
            sil_tea_before = silhouette_score(pca_before[pure_mask], tea_enc)
            sil_tea_after = silhouette_score(pca_after[pure_mask], tea_enc)
            metrics["sil_by_tea_before"] = round(sil_tea_before, 4)
            metrics["sil_by_tea_after"] = round(sil_tea_after, 4)

    print(f"  漂移校正指标 ({method_name}):")
    for k, v in metrics.items():
        print(f"    {k}: {v}")

    return metrics


def run_drift_analysis(
    X_value: np.ndarray,
    run_ids: list[int],
    tea_ids: list[str],
    method: str = "run_zscore",
) -> tuple[np.ndarray, str, dict]:
    """运行漂移校正分析: 应用指定方法, 生成诊断图。

    默认使用 run_zscore (每 run 通道级 Z-Score), 这是消除批次
    基线漂移最有效的方法。同时生成其他方法的对比图供参考。

    Returns:
        X_corrected: 校正后的数据
        method: 使用的方法名
        all_metrics: 各方法的指标
    """
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  传感器漂移校正")
    print("=" * 70)

    run_ids_arr = np.asarray(run_ids)
    all_metrics = {}
    best_X = None

    for method_name in ["run_zscore", "run_median_align", "component_correction"]:
        print(f"\n  方法: {method_name}")
        try:
            X_corrected = apply_drift_correction(X_value, run_ids_arr, method=method_name)
            metrics = plot_drift_diagnosis(
                X_value, X_corrected, run_ids_arr, tea_ids,
                method_name=method_name, subdir="drift",
            )
            all_metrics[method_name] = metrics

            if method_name == method:
                best_X = X_corrected

        except Exception as e:
            print(f"    失败: {e}")
            import traceback
            traceback.print_exc()

    print(f"\n  === 使用方法: {method} ===")

    # 保存分析结果
    import json
    json_path = TABLES_DIR / "drift_correction_metrics.json"
    with open(json_path, "w") as f:
        json.dump(all_metrics, f, indent=2, ensure_ascii=False)
    print(f"  指标 → {json_path.name}")

    return best_X, method, all_metrics
