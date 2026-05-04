"""生成 Fig 5 — Tea Aroma Maps (handcrafted vs CARL, 双面板 A/B).

Panel A: Handcrafted PCA 散点 (pure tea + blends)
Panel B: CARL PCA 散点

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_fig5_aroma_map
"""

from __future__ import annotations

import warnings
import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from ._style import (
    TEA_COLORS, init_nature_style, panel_label, save_figure,
    load_dataset, load_embeddings,
)
from ..config import SEED, TEA_ORDER, TEA_NAME_EN, FIG_WIDTH_DOUBLE
from ..viz import get_tea_color, get_tea_marker
from ..data import PaperDataset

np.random.seed(SEED)
warnings.filterwarnings("ignore")


# ═══════════════════════════════════════════════════════════════
# Fig 5: Tea Aroma Maps
# ═══════════════════════════════════════════════════════════════

def generate_fig5(ds: PaperDataset | None = None,
                  carl_embeddings: np.ndarray | None = None):
    """生成 Fig 5: Tea Aroma Maps (handcrafted vs CARL, A/B)."""
    print("\n" + "=" * 60)
    print("  Fig 5: Tea Aroma Maps")
    print("=" * 60)

    init_nature_style()

    if ds is None:
        ds = load_dataset()
    if carl_embeddings is None:
        carl_embeddings = load_embeddings()

    pure_mask = ds.pure_mask
    tea_ids_arr = np.array(ds.tea_ids)

    # Handcrafted PCA
    feat_name = "norm_stats" if "norm_stats" in ds.features else list(ds.features.keys())[0]
    X_hc = StandardScaler().fit_transform(ds.features[feat_name][0])
    pca_hc = PCA(n_components=2, random_state=SEED)
    pc_hc = pca_hc.fit_transform(X_hc)
    var_hc = (pca_hc.explained_variance_ratio_[0] * 100,
              pca_hc.explained_variance_ratio_[1] * 100)

    # CARL PCA
    pca_carl = PCA(n_components=2, random_state=SEED)
    pc_carl = pca_carl.fit_transform(carl_embeddings)
    var_carl = (pca_carl.explained_variance_ratio_[0] * 100,
                pca_carl.explained_variance_ratio_[1] * 100)

    fig, axes = plt.subplots(1, 2, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.38))

    for ax_idx, (ax, pc, var, title) in enumerate(zip(
        axes,
        [pc_hc, pc_carl],
        [var_hc, var_carl],
        [f"Hand-crafted ({var_hc[0]:.0f}%+{var_hc[1]:.0f}%)",
         f"CARL ({var_carl[0]:.0f}%+{var_carl[1]:.0f}%)"],
    )):
        mix_mask = ~pure_mask
        if mix_mask.any():
            ax.scatter(pc[mix_mask, 0], pc[mix_mask, 1],
                       c="#CCCCCC", s=4, alpha=0.3, zorder=1, rasterized=True)

        for tid in sorted(set(tea_ids_arr[pure_mask])):
            mask = pure_mask & (tea_ids_arr == tid)
            raw_name = TEA_ORDER[int(tid[1]) - 1] if tid.startswith("T") and tid[1].isdigit() else ""
            en_name = TEA_NAME_EN.get(raw_name, tid)
            ax.scatter(pc[mask, 0], pc[mask, 1],
                       c=get_tea_color(tid), marker=get_tea_marker(tid),
                       s=18, alpha=0.8, edgecolors="white", linewidth=0.3,
                       label=f"{tid} {en_name}", zorder=3)

        ax.set_xlabel(f"PC1 ({var[0]:.1f}%)")
        ax.set_ylabel(f"PC2 ({var[1]:.1f}%)")
        ax.set_title(title)
        panel_label(ax, chr(65 + ax_idx))

    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=5,
               bbox_to_anchor=(0.5, -0.06), frameon=False,
               markerscale=1.3, handletextpad=0.3, columnspacing=0.8)

    fig.tight_layout()
    save_figure(fig, "fig5_aroma_map_v2")


if __name__ == "__main__":
    generate_fig5()
