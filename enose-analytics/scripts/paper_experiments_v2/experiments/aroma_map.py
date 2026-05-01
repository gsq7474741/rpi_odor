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
from ..aroma_map_utils import (
    _compute_cluster_metrics,
    _compute_trajectory_smoothness,
    _plot_aroma_map,
)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


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
