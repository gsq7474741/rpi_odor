"""可视化模块 — PCA / UMAP 分析。"""

from __future__ import annotations

import numpy as np
from collections import defaultdict

from .config import ExperimentConfig
from .data_loader import SampleMeta
from .features import baseline_normalize, log_transform
from .utils import print_header, print_subheader


def pca_analysis(
    X_raw: np.ndarray,
    meta: list[SampleMeta],
    exp: ExperimentConfig,
    feature_name: str = "log_norm",
    n_components: int = 10,
):
    """PCA 降维分析 + 混合轨迹可视化。

    Args:
        X_raw: (N, T, 32) 对齐序列
        meta: 样本元数据
        exp: 实验配置
        feature_name: 用于 PCA 的特征 ("log_norm" | "norm" | "value")
        n_components: PCA 维度
    """
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler

    sensors = exp.sensor.active_sensors
    n_s = len(sensors)
    T = X_raw.shape[1]
    bl_ratio = exp.alignment.baseline_ratio

    # 构建特征
    X_val = X_raw[:, :, sensors]
    if feature_name == "log_norm":
        X_feat = baseline_normalize(log_transform(X_val), bl_ratio)
    elif feature_name == "norm":
        X_feat = baseline_normalize(X_val, bl_ratio)
    else:
        X_feat = X_val
    X_flat = X_feat.reshape(X_raw.shape[0], -1)

    print_header(f"PCA 分析 ({feature_name}, {n_s} 传感器)")
    print(f"  特征维度: {X_flat.shape}")

    sc = StandardScaler()
    X_scaled = sc.fit_transform(X_flat)

    n_comp = min(n_components, X_flat.shape[1], X_flat.shape[0])
    pca = PCA(n_components=n_comp)
    X_pca = pca.fit_transform(X_scaled)
    evr = pca.explained_variance_ratio_
    cumsum = np.cumsum(evr)

    print(f"  前 {n_comp} PC 方差解释: {', '.join(f'{v:.1%}' for v in evr)}")
    print(f"  累计: {', '.join(f'{v:.1%}' for v in cumsum)}")

    # 纯样距离矩阵
    pure_indices: dict[str, list[int]] = defaultdict(list)
    for i, m in enumerate(meta):
        if m.is_pure:
            pure_indices[m.names[0]].append(i)

    if pure_indices:
        print(f"\n  纯样 PC 空间 (3D) 距离矩阵:")
        pure_pcs: dict[str, np.ndarray] = {}
        for liq, idxs in sorted(pure_indices.items()):
            pure_pcs[liq] = X_pca[idxs, :3].mean(axis=0)

        names = sorted(pure_pcs.keys())
        header = "           " + "  ".join(f"{exp.short(n):>8}" for n in names)
        print(f"  {header}")
        for n1 in names:
            row = f"  {exp.short(n1):>10}"
            for n2 in names:
                d = np.linalg.norm(pure_pcs[n1] - pure_pcs[n2])
                row += f"  {d:>8.4f}"
            print(row)

    # 混合轨迹
    binary_data: dict[tuple, dict[float, list[int]]] = defaultdict(lambda: defaultdict(list))
    for i, m in enumerate(meta):
        if len(m.names) == 2:
            combo = tuple(sorted(m.names))
            liq_a = combo[0]
            alpha = m.ratios[0] if m.names[0] == liq_a else m.ratios[1]
            binary_data[combo][alpha].append(i)

    print(f"\n  混合轨迹 (PC1-PC3):")
    for combo in sorted(binary_data.keys()):
        liq_a, liq_b = combo
        sa, sb = exp.short(liq_a), exp.short(liq_b)
        print_subheader(f"{sa} + {sb}")

        if liq_a in pure_indices:
            pc = X_pca[pure_indices[liq_a], :3].mean(axis=0)
            print(f"    {sa}=100%: PC1={pc[0]:>7.3f}  PC2={pc[1]:>7.3f}  "
                  f"PC3={pc[2]:>7.3f} (n={len(pure_indices[liq_a])})")

        for alpha in sorted(binary_data[combo].keys()):
            idxs = binary_data[combo][alpha]
            pc = X_pca[idxs, :3].mean(axis=0)
            print(f"    {sa}={alpha:.0%}: PC1={pc[0]:>7.3f}  PC2={pc[1]:>7.3f}  "
                  f"PC3={pc[2]:>7.3f} (n={len(idxs)})")

        if liq_b in pure_indices:
            pc = X_pca[pure_indices[liq_b], :3].mean(axis=0)
            print(f"    {sb}=100%: PC1={pc[0]:>7.3f}  PC2={pc[1]:>7.3f}  "
                  f"PC3={pc[2]:>7.3f} (n={len(pure_indices[liq_b])})")
