"""§3.6 Tea Aroma Map (v2) — Table 5.

Table 5 rows:
  1. Handcrafted (PCA)
  2. CARL (PCA)

Metrics: Silhouette, Davies-Bouldin, Trajectory Smoothness.

Outputs:
  - table5_aroma_map_v2.csv
  - fig_aroma_map_hc_v2.pdf, fig_aroma_map_carl_v2.pdf
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from pathlib import Path

from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import silhouette_score, davies_bouldin_score

from ..config import SEED, N_SENSORS, FONT_SIZE, SCALE, TEA_ORDER, TEA_NAME_EN, BINARY_COMBO_LABELS
from ..data import PaperDataset
from ..viz import init_style, get_tea_color, get_tea_marker

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ═══════════════════════════════════════════════════════════════
# 辅助函数 (原 aroma_map_utils.py)
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


def run(
    ds: PaperDataset,
    carl_embeddings: np.ndarray | None,
    tables_dir: Path,
    figures_dir: Path,
    nldi_results: dict | None = None,
) -> dict:
    """Run §3.6: Tea Aroma Map."""
    print("\n" + "=" * 70)
    print("  §3.6 Tea Aroma Map (v2)")
    print("=" * 70)

    results = {}

    tea_ids_arr = np.array(ds.tea_ids)
    combo_ids_arr = np.array(ds.combo_ids)
    ratios_arr = np.array(ds.ratios)

    def _project(X_high, label):
        pca = PCA(n_components=2, random_state=SEED)
        X_2d = pca.fit_transform(X_high)
        v1, v2 = pca.explained_variance_ratio_[:2] * 100
        print(f"    {label} PCA: {v1:.1f}% + {v2:.1f}%")
        return X_2d, v1, v2

    # ── 1. Handcrafted ──
    print("  Handcrafted features...")
    X_feat = ds.features["norm_stats"][0]
    X_scaled = StandardScaler().fit_transform(X_feat)
    hc_2d, hc_v1, hc_v2 = _project(X_scaled, "HC")

    fig_hc = _plot_aroma_map(
        hc_2d, tea_ids_arr, ds.pure_mask, ds.mix_mask,
        combo_ids_arr, ratios_arr,
        title=f"Handcrafted — PCA ({hc_v1:.0f}%+{hc_v2:.0f}%)",
    )
    fig_hc.axes[0].set_xlabel(f"PC1 ({hc_v1:.1f}%)")
    fig_hc.axes[0].set_ylabel(f"PC2 ({hc_v2:.1f}%)")
    _save(fig_hc, "fig_aroma_map_hc_v2", figures_dir)

    m_hc = _compute_cluster_metrics(hc_2d[ds.pure_mask], tea_ids_arr[ds.pure_mask])
    s_hc = _compute_trajectory_smoothness(hc_2d, combo_ids_arr, ratios_arr, ds.mix_mask)
    avg_s_hc = round(np.mean(list(s_hc.values())), 4) if s_hc else float("nan")
    print(f"    Sil={m_hc['silhouette']:.4f}, DBI={m_hc['davies_bouldin']:.4f}, Smooth={avg_s_hc:.4f}")

    results["handcrafted"] = {**m_hc, "smoothness": avg_s_hc, "smoothness_per_combo": s_hc}

    # ── 2. CARL ──
    if carl_embeddings is not None:
        print("  CARL embeddings...")
        carl_2d, carl_v1, carl_v2 = _project(carl_embeddings, "CARL")

        fig_carl = _plot_aroma_map(
            carl_2d, tea_ids_arr, ds.pure_mask, ds.mix_mask,
            combo_ids_arr, ratios_arr,
            title=f"CARL — PCA ({carl_v1:.0f}%+{carl_v2:.0f}%)",
        )
        fig_carl.axes[0].set_xlabel(f"PC1 ({carl_v1:.1f}%)")
        fig_carl.axes[0].set_ylabel(f"PC2 ({carl_v2:.1f}%)")
        _save(fig_carl, "fig_aroma_map_carl_v2", figures_dir)

        m_carl = _compute_cluster_metrics(carl_2d[ds.pure_mask], tea_ids_arr[ds.pure_mask])
        s_carl = _compute_trajectory_smoothness(carl_2d, combo_ids_arr, ratios_arr, ds.mix_mask)
        avg_s_carl = round(np.mean(list(s_carl.values())), 4) if s_carl else float("nan")
        print(f"    Sil={m_carl['silhouette']:.4f}, DBI={m_carl['davies_bouldin']:.4f}, Smooth={avg_s_carl:.4f}")

        results["carl"] = {**m_carl, "smoothness": avg_s_carl, "smoothness_per_combo": s_carl}
    else:
        m_carl = {"silhouette": float("nan"), "davies_bouldin": float("nan")}
        avg_s_carl = float("nan")
        print("  CARL embeddings not available, skipping.")

    # ── Table 5 ──
    rows = [
        {
            "method": "Handcrafted",
            "silhouette": m_hc["silhouette"],
            "davies_bouldin": m_hc["davies_bouldin"],
            "smoothness": avg_s_hc,
        },
    ]
    if carl_embeddings is not None:
        rows.append({
            "method": "CARL",
            "silhouette": m_carl["silhouette"],
            "davies_bouldin": m_carl["davies_bouldin"],
            "smoothness": avg_s_carl,
        })

    df = pd.DataFrame(rows)
    csv_path = tables_dir / "table5_aroma_map_v2.csv"
    df.to_csv(csv_path, index=False)
    print(f"  Table 5 -> {csv_path.name}")
    results["table5"] = rows

    # ── NLDI-embedding deviation correlation (if available) ──
    if nldi_results and carl_embeddings is not None:
        _nldi_emb_corr(ds, carl_embeddings, nldi_results, results, figures_dir)

    _save_json(results, tables_dir / "exp_aroma_map_v2.json")

    print(f"\n  === §3.6 结果摘要 ===")
    print(f"  HC:   Sil={m_hc['silhouette']:.4f}, DBI={m_hc['davies_bouldin']:.4f}")
    if carl_embeddings is not None:
        print(f"  CARL: Sil={m_carl['silhouette']:.4f}, DBI={m_carl['davies_bouldin']:.4f}")

    return results


# ── NLDI vs embedding deviation ──

def _nldi_emb_corr(ds, embeddings, nldi_results, results, figures_dir):
    """Compute correlation between NLDI and embedding deviation."""
    from scipy import stats as sp_stats

    table1 = nldi_results.get("table1", [])
    if not table1:
        return

    combo_nldi, combo_dev = [], []
    for row in table1:
        if row["combo"] == "Overall":
            continue
        cid = row["combo"]
        nldi_val = row["nldi_mean"]

        parts = cid.split("-")
        if len(parts) != 2:
            continue

        mix_mask = ds.mix_mask & np.array([c == cid for c in ds.combo_ids])
        if mix_mask.sum() < 3:
            continue

        pure_a = ds.pure_mask & np.array([t == parts[0] for t in ds.tea_ids])
        pure_b = ds.pure_mask & np.array([t == parts[1] for t in ds.tea_ids])
        if pure_a.sum() == 0 or pure_b.sum() == 0:
            continue

        emb_a = embeddings[pure_a].mean(axis=0)
        emb_b = embeddings[pure_b].mean(axis=0)
        emb_mix = embeddings[mix_mask]
        mix_r = np.array(ds.ratios)[mix_mask]

        devs = [np.linalg.norm(e - (r * emb_a + (1 - r) * emb_b)) for e, r in zip(emb_mix, mix_r)]
        combo_nldi.append(nldi_val)
        combo_dev.append(np.mean(devs))

    if len(combo_nldi) < 3:
        return

    r_p, p_p = sp_stats.pearsonr(combo_nldi, combo_dev)
    r_s, p_s = sp_stats.spearmanr(combo_nldi, combo_dev)
    results["nldi_emb_corr"] = {
        "pearson_r": round(r_p, 3), "pearson_p": round(p_p, 4),
        "spearman_r": round(r_s, 3), "spearman_p": round(p_s, 4),
    }
    print(f"  NLDI vs embedding dev: Pearson r={r_p:.3f}, Spearman ρ={r_s:.3f}")

    init_style()
    fig, ax = plt.subplots(figsize=(5, 4.5))
    ax.scatter(combo_nldi, combo_dev, s=70, c="#0072B2", edgecolors="white", linewidth=0.8)
    ax.set_xlabel("NLDI")
    ax.set_ylabel("Embedding deviation")
    ax.set_title(f"Pearson r = {r_p:.3f}")
    fig.tight_layout()
    _save(fig, "fig_nldi_vs_emb_v2", figures_dir)


# ── helpers ──

def _save(fig, name, figures_dir):
    for fmt in ["pdf", "png"]:
        fig.savefig(figures_dir / f"{name}.{fmt}", dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"    -> {name}")


def _save_json(obj, path):
    def _conv(o):
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, np.ndarray): return o.tolist()
        return o
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(obj, default=_conv)), f, indent=2, ensure_ascii=False)
