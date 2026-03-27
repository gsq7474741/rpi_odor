"""实验5: 茶叶香气地图 (§3.6)

构建可视化的二维香气空间, 对比手工特征 vs CARL 嵌入。

输出:
  - Fig.7a: 手工特征 UMAP 2D 香气地图
  - Fig.7b: CARL 嵌入 UMAP 2D 香气地图
  - 量化指标: 轮廓系数, Davies-Bouldin 指数, 轨迹平滑度
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd

from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import silhouette_score, davies_bouldin_score

from .config import (
    SEED, N_SENSORS, FONT_SIZE, SCALE,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN,
    BINARY_COMBO_LABELS,
    TABLES_DIR, FIGURES_DIR, ensure_dirs,
)
from .data import PaperDataset
from .viz import init_style, save_fig, get_tea_color, get_tea_marker

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ═══════════════════════════════════════════════════════════════
# 量化指标
# ═══════════════════════════════════════════════════════════════

def _compute_cluster_metrics(X_2d: np.ndarray, labels: np.ndarray) -> dict:
    """计算聚类质量指标"""
    le = LabelEncoder()
    y = le.fit_transform(labels)

    n_classes = len(set(y))
    if n_classes < 2:
        return {"silhouette": float("nan"), "davies_bouldin": float("nan")}

    sil = silhouette_score(X_2d, y)
    dbi = davies_bouldin_score(X_2d, y)

    return {
        "silhouette": round(sil, 4),
        "davies_bouldin": round(dbi, 4),
    }


def _compute_trajectory_smoothness(
    X_2d: np.ndarray,
    combo_ids: np.ndarray,
    ratios: np.ndarray,
    mix_mask: np.ndarray,
) -> dict:
    """计算混合样轨迹的平滑度 (path monotonicity)。

    对每个组合, 按比例排序的 UMAP 点连线的单调性。
    """
    smoothness = {}

    for cid in sorted(set(combo_ids[mix_mask])):
        if not cid:
            continue
        mask = mix_mask & (combo_ids == cid)
        if mask.sum() < 3:
            continue

        r = ratios[mask]
        pts = X_2d[mask]

        # 按比例排序
        order = np.argsort(r)
        pts_sorted = pts[order]

        # 计算路径长度 vs 端点距离
        path_len = np.sum(np.linalg.norm(np.diff(pts_sorted, axis=0), axis=1))
        endpoint_dist = np.linalg.norm(pts_sorted[-1] - pts_sorted[0])

        # 单调性: endpoint_dist / path_len (越接近 1 越平滑)
        mono = endpoint_dist / path_len if path_len > 0 else 0.0
        smoothness[cid] = round(mono, 4)

    return smoothness


# ═══════════════════════════════════════════════════════════════
# 绘图
# ═══════════════════════════════════════════════════════════════

def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    """#RRGGBB → (r, g, b) in [0, 1]"""
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))


def _blend_colors(c1: str, c2: str, ratio: float) -> tuple[float, float, float, float]:
    """按比例插值两种颜色。ratio=1 → c1, ratio=0 → c2"""
    r1 = _hex_to_rgb(c1)
    r2 = _hex_to_rgb(c2)
    return tuple(ratio * a + (1 - ratio) * b for a, b in zip(r1, r2)) + (0.7,)


def _plot_aroma_map(
    X_2d: np.ndarray,
    tea_ids: np.ndarray,
    pure_mask: np.ndarray,
    mix_mask: np.ndarray,
    combo_ids: np.ndarray | None = None,
    ratios: np.ndarray | None = None,
    title: str = "",
    figsize: tuple[float, float] = (7, 6),
) -> plt.Figure:
    """绘制香气地图 (含混合物轨迹和渐变色)"""
    init_style()
    fig, ax = plt.subplots(figsize=figsize)

    # 纯样: 大标记 + 标签, 计算质心
    unique_teas = sorted(set(tea_ids[pure_mask]))
    centroids = {}
    for tid in unique_teas:
        mask = pure_mask & (tea_ids == tid)
        raw_name = TEA_ORDER[int(tid[1]) - 1] if tid.startswith("T") and len(tid) == 2 and tid[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, tid) if raw_name else tid
        ax.scatter(
            X_2d[mask, 0], X_2d[mask, 1],
            c=get_tea_color(tid), marker=get_tea_marker(tid),
            s=70 * SCALE, alpha=0.8, edgecolors="white", linewidth=0.5 * SCALE,
            label=f"{tid} {en_name}",
            zorder=4,
        )
        centroids[tid] = X_2d[mask].mean(axis=0)

    # 混合样: 渐变色 + 轨迹线
    if mix_mask.any() and combo_ids is not None and ratios is not None:
        drawn_combos = set()
        for cid in sorted(set(combo_ids[mix_mask])):
            if not cid:
                continue
            parts = cid.split('-')
            if len(parts) != 2:
                continue
            tid_a, tid_b = parts
            if tid_a not in centroids or tid_b not in centroids:
                continue

            c_mask = mix_mask & (combo_ids == cid)
            r_vals = ratios[c_mask]
            pts = X_2d[c_mask]

            # 按比例排序
            order = np.argsort(r_vals)
            pts_sorted = pts[order]
            r_sorted = r_vals[order]

            # 渐变色散点
            colors = [_blend_colors(get_tea_color(tid_a), get_tea_color(tid_b), r)
                      for r in r_sorted]
            ax.scatter(
                pts_sorted[:, 0], pts_sorted[:, 1],
                c=colors, marker="o", s=28, edgecolors="none",
                zorder=2,
            )

            drawn_combos.add(cid)

        # 剩余未处理的混合样 (如果有)
        remaining = mix_mask & ~np.isin(combo_ids, list(drawn_combos))
        if remaining.any():
            ax.scatter(
                X_2d[remaining, 0], X_2d[remaining, 1],
                c="#AAAAAA", marker=".", s=8, alpha=0.3, zorder=1,
            )

        # 添加 Blends 图例项
        ax.scatter([], [], c="#888888", marker="o", s=28 * SCALE, label="Blends (gradient)")
    elif mix_mask.any():
        ax.scatter(
            X_2d[mix_mask, 0], X_2d[mix_mask, 1],
            c="#AAAAAA", marker=".", s=8, alpha=0.3,
            label="Blends", zorder=1,
        )

    fs = FONT_SIZE + 2  # 并排多图需要更大字号
    ax.set_xlabel("Dim 1", fontsize=fs)
    ax.set_ylabel("Dim 2", fontsize=fs)
    ax.set_title(title, fontsize=fs)
    ax.tick_params(labelsize=fs - 2)
    ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=fs - 2)
    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════════
# 主运行
# ═══════════════════════════════════════════════════════════════

def run(ds: PaperDataset, carl_embeddings: np.ndarray | None = None) -> dict:
    """运行实验5: 茶叶香气地图。"""
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  实验5: 茶叶香气地图")
    print("=" * 70)

    results = {}

    from sklearn.decomposition import PCA

    tea_ids_arr = np.array(ds.tea_ids)
    combo_ids_arr = np.array(ds.combo_ids)
    ratios_arr = np.array(ds.ratios)

    def _project_pca(X_high: np.ndarray, label: str):
        """对高维数据做 PCA 降维到 2D。"""
        pca = PCA(n_components=2, random_state=SEED)
        X_pca = pca.fit_transform(X_high)
        var1, var2 = pca.explained_variance_ratio_[:2] * 100
        print(f"    PCA: var={var1:.1f}%+{var2:.1f}%")
        return X_pca, var1, var2

    # ── 1. 手工特征 ──
    print(f"  手工特征降维 (PCA)...")
    feat_name = "norm_stats"
    X_feat = ds.features[feat_name][0]

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_feat)

    hc_pca, hc_v1, hc_v2 = _project_pca(X_scaled, "handcrafted")

    fig_hc = _plot_aroma_map(
        hc_pca, tea_ids_arr, ds.pure_mask, ds.mix_mask,
        combo_ids_arr, ratios_arr,
        title=f"Handcrafted — PCA ({hc_v1:.0f}%+{hc_v2:.0f}%)",
    )
    fig_hc.axes[0].set_xlabel(f"PC1 ({hc_v1:.1f}%)")
    fig_hc.axes[0].set_ylabel(f"PC2 ({hc_v2:.1f}%)")
    save_fig(fig_hc, "fig7a_aroma_map_handcrafted", subdir="exp5")

    # 聚类质量 (用 PCA 投影计算)
    metrics_hc = _compute_cluster_metrics(hc_pca[ds.pure_mask], tea_ids_arr[ds.pure_mask])
    results["handcrafted_metrics"] = metrics_hc
    print(f"    Silhouette(PCA): {metrics_hc['silhouette']:.4f}")
    print(f"    Davies-Bouldin(PCA): {metrics_hc['davies_bouldin']:.4f}")

    smoothness_hc = _compute_trajectory_smoothness(hc_pca, combo_ids_arr, ratios_arr, ds.mix_mask)
    results["handcrafted_smoothness"] = smoothness_hc
    if smoothness_hc:
        avg_smooth = np.mean(list(smoothness_hc.values()))
        print(f"    轨迹平滑度 (均值): {avg_smooth:.4f}")

    # ── 2. CARL 嵌入 ──
    if carl_embeddings is not None:
        print(f"  CARL 嵌入降维 (PCA)...")
        carl_pca, carl_v1, carl_v2 = _project_pca(carl_embeddings, "CARL")

        fig_carl = _plot_aroma_map(
            carl_pca, tea_ids_arr, ds.pure_mask, ds.mix_mask,
            combo_ids_arr, ratios_arr,
            title=f"CARL — PCA ({carl_v1:.0f}%+{carl_v2:.0f}%)",
        )
        fig_carl.axes[0].set_xlabel(f"PC1 ({carl_v1:.1f}%)")
        fig_carl.axes[0].set_ylabel(f"PC2 ({carl_v2:.1f}%)")
        save_fig(fig_carl, "fig7b_aroma_map_carl", subdir="exp5")

        metrics_carl = _compute_cluster_metrics(carl_pca[ds.pure_mask], tea_ids_arr[ds.pure_mask])
        results["carl_metrics"] = metrics_carl
        print(f"    Silhouette(PCA): {metrics_carl['silhouette']:.4f}")
        print(f"    Davies-Bouldin(PCA): {metrics_carl['davies_bouldin']:.4f}")

        smoothness_carl = _compute_trajectory_smoothness(carl_pca, combo_ids_arr, ratios_arr, ds.mix_mask)
        results["carl_smoothness"] = smoothness_carl
        if smoothness_carl:
            avg_smooth = np.mean(list(smoothness_carl.values()))
            print(f"    轨迹平滑度 (均值): {avg_smooth:.4f}")

        # ── 对比表格 ──
        comparison = pd.DataFrame([
            {
                "Method": "Handcrafted",
                "Silhouette": metrics_hc["silhouette"],
                "Davies-Bouldin": metrics_hc["davies_bouldin"],
                "Avg Smoothness": round(np.mean(list(smoothness_hc.values())), 4) if smoothness_hc else float("nan"),
            },
            {
                "Method": "CARL",
                "Silhouette": metrics_carl["silhouette"],
                "Davies-Bouldin": metrics_carl["davies_bouldin"],
                "Avg Smoothness": round(np.mean(list(smoothness_carl.values())), 4) if smoothness_carl else float("nan"),
            },
        ])
        csv_path = TABLES_DIR / "table6_aroma_map_comparison.csv"
        comparison.to_csv(csv_path, index=False)
        print(f"  对比表 → {csv_path.name}")
        results["comparison"] = comparison.to_dict(orient="records")
    else:
        print(f"  CARL 嵌入不可用, 仅生成手工特征地图")

    # ── 保存结果 ──
    def _convert(obj):
        if isinstance(obj, (np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, (np.int32, np.int64)):
            return int(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj

    json_path = TABLES_DIR / "exp5_aroma_map_results.json"
    with open(json_path, "w") as f:
        json.dump(json.loads(json.dumps(results, default=_convert)), f, indent=2, ensure_ascii=False)
    print(f"  JSON → {json_path.name}")

    # 摘要
    print(f"\n  === 实验5 结果摘要 ===")
    print(f"  手工: Sil={metrics_hc['silhouette']:.4f}, DBI={metrics_hc['davies_bouldin']:.4f}")
    if carl_embeddings is not None:
        print(f"  CARL: Sil={metrics_carl['silhouette']:.4f}, DBI={metrics_carl['davies_bouldin']:.4f}")
    print(f"  输出: fig7a_aroma_map_handcrafted, fig7b_aroma_map_carl")

    return results
