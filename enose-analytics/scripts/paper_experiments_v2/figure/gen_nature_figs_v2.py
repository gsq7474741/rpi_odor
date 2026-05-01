"""生成 v2 论文主文合并图 — Nature / Science 风格多面板。

读取已缓存的 v2 实验结果 (JSON/CSV/npy/pkl), 不重新运行实验。
生成论文所需的所有主文合并图:
  - fig_pure_tea_v2.pdf        (Fig.4: PCA + Radar, 双面板 A/B)
  - fig_ratio_curves_v2.pdf    (Fig.5: 4组 ratio curves, 2×2)
  - fig_nldi_heatmap_v2.pdf    (Fig.6: NLDI heatmap, 单面板)
  - fig_aroma_map_v2.pdf       (Fig.7: 双 aroma map, A/B)
  - fig_carl_training_v2.pdf   (SM: 训练曲线 + NLDI-embedding, A/B)
  - fig_prediction_v2.pdf      (SM: scatter + R² 对比, A/B)

生成后自动复制到稿件 figures_v2/ 目录。

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_nature_figs_v2
"""

from __future__ import annotations

import json
import pickle
import shutil
import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import matplotlib.ticker as mticker
import seaborn as sns

from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from pathlib import Path

from ..config import (
    SEED, N_SENSORS, FONT_SIZE, FONT_FAMILY,
    FIG_WIDTH_SINGLE, FIG_WIDTH_1_5, FIG_WIDTH_DOUBLE,
    FIGURE_DPI, CACHE_DIR,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
    EXCLUDED_TEAS,
)
from ..viz import (
    init_style, save_fig, panel_label,
    get_tea_color, get_tea_marker,
    scatter_tea_on_ax, radar_tea_on_ax, confusion_matrix_on_ax,
    ratio_curves_on_ax,
)
from ..data import PaperDataset
from ..nldi import compute_pure_baselines, compute_nldi_for_combo

np.random.seed(SEED)

# ═══════════════════════════════════════════════════════════════
# 路径
# ═══════════════════════════════════════════════════════════════

V2_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results" / "v2"
V2_TABLES_DIR = V2_RESULTS_DIR / "tables"
V2_FIGURES_DIR = V2_RESULTS_DIR / "figures"

# 稿件图目录 (脚本生成图复制到此处)
MANUSCRIPT_DIR = Path(r"g:\Downloads\机器嗅觉研究\idea\tea_mix\manuscript")
MANUSCRIPT_FIGS_DIR = MANUSCRIPT_DIR / "figures_v2"


# ═══════════════════════════════════════════════════════════════
# 数据加载
# ═══════════════════════════════════════════════════════════════

def _load_dataset() -> PaperDataset:
    """从 pickle 缓存加载数据集。"""
    pkl_files = list(CACHE_DIR.glob("paper_dataset_*.pkl"))
    assert pkl_files, f"No cached dataset found in {CACHE_DIR}"
    with open(pkl_files[0], "rb") as f:
        return pickle.load(f)


def _load_embeddings() -> np.ndarray:
    """加载 v2 CARL embeddings。"""
    excl_suffix = f"_excl_{'_'.join(sorted(EXCLUDED_TEAS))}" if EXCLUDED_TEAS else ""
    path = CACHE_DIR / f"carl_embeddings_v2{excl_suffix}.npy"
    if not path.exists():
        path = CACHE_DIR / "carl_embeddings_v2.npy"
    assert path.exists(), f"CARL embeddings not found: {path}"
    return np.load(path)


def _load_json(name: str) -> dict:
    path = V2_TABLES_DIR / name
    with open(path, encoding="latin-1") as f:
        return json.load(f)


def _save_v2(fig, name: str):
    """保存到 v2 figures 目录并复制到稿件 figures_v2 目录。"""
    V2_FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    MANUSCRIPT_FIGS_DIR.mkdir(parents=True, exist_ok=True)
    for fmt in ["pdf", "png"]:
        src = V2_FIGURES_DIR / f"{name}.{fmt}"
        fig.savefig(src, dpi=FIGURE_DPI, bbox_inches="tight")
        dst = MANUSCRIPT_FIGS_DIR / f"{name}.{fmt}"
        shutil.copy2(src, dst)
    plt.close(fig)
    print(f"    → {name} (copied to manuscript)")


# ═══════════════════════════════════════════════════════════════
# Fig.4: Pure-tea characterization (PCA + Radar)
# ═══════════════════════════════════════════════════════════════

def gen_fig_pure_tea(ds: PaperDataset):
    """双面板: A) PCA scatter  B) Radar chart。共享图例。"""
    print("  Fig.4: Pure-tea (PCA + Radar)...")
    init_style()

    pure_mask = ds.pure_mask
    tea_ids_arr = np.array(ds.tea_ids)
    feat_name = "norm_stats" if "norm_stats" in ds.features else list(ds.features.keys())[0]
    X_all = ds.features[feat_name][0]
    X_pure = X_all[pure_mask]
    tea_ids_pure = tea_ids_arr[pure_mask]

    # PCA
    X_scaled = StandardScaler().fit_transform(X_pure)
    pca = PCA(n_components=2, random_state=SEED)
    pc = pca.fit_transform(X_scaled)
    var_exp = (pca.explained_variance_ratio_[0] * 100, pca.explained_variance_ratio_[1] * 100)

    # Radar 数据
    baselines = compute_pure_baselines(ds)
    radar_means = baselines

    fig = plt.figure(figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.38))
    gs = gridspec.GridSpec(1, 2, width_ratios=[1, 1], wspace=0.35)

    ax_pca = fig.add_subplot(gs[0])
    scatter_tea_on_ax(ax_pca, pc[:, 0], pc[:, 1], tea_ids_pure,
                      var_explained=var_exp, show_legend=False, marker_size=10)
    panel_label(ax_pca, "A")

    ax_radar = fig.add_subplot(gs[1], polar=True)
    radar_tea_on_ax(ax_radar, radar_means, show_legend=False)
    panel_label(ax_radar, "B", x=-0.05, y=1.12)

    handles, labels = ax_pca.get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=5,
               bbox_to_anchor=(0.5, -0.06), frameon=False,
               markerscale=1.5, handletextpad=0.3, columnspacing=0.8)

    _save_v2(fig, "fig_pure_tea_v2")


# ═══════════════════════════════════════════════════════════════
# Fig.5: Response-ratio curves (2×2 grid)
# ═══════════════════════════════════════════════════════════════

def gen_fig_ratio_curves(ds: PaperDataset):
    """2×2 面板: T1-T2, T1-T4, T1-T3, T1-T5。"""
    print("  Fig.5: Ratio curves (2×2)...")
    init_style()

    baselines = compute_pure_baselines(ds)

    combos_to_show = [
        ("T1", "T2", "T1-T2"),
        ("T1", "T4", "T1-T4"),
        ("T1", "T3", "T1-T3"),
        ("T1", "T5", "T1-T5"),
    ]

    fig, axes = plt.subplots(2, 2, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.55),
                             sharex=True, sharey=False)
    axes_flat = axes.flatten()

    for idx, (tea_a_id, tea_b_id, title) in enumerate(combos_to_show):
        ax = axes_flat[idx]
        combo_id = f"{tea_a_id}-{tea_b_id}"
        res = compute_nldi_for_combo(ds, baselines, combo_id, tea_a_id, tea_b_id)

        if "measured_by_ratio" in res and res["measured_by_ratio"]:
            ratios_sorted = sorted(res["measured_by_ratio"].keys())
            measured = np.array([res["measured_by_ratio"][r] for r in ratios_sorted])
            predicted = np.array([res["predicted_by_ratio"][r] for r in ratios_sorted])
            ratio_steps = np.array(ratios_sorted)
            nldi_val = res.get("nldi_mean", 0)
            ratio_curves_on_ax(ax, measured, predicted, ratio_steps,
                             f"{title} (NLDI={nldi_val:.2f})",
                             show_legend=(idx == 0))
        else:
            ax.set_title(title)
            ax.text(0.5, 0.5, "No data", transform=ax.transAxes, ha="center", va="center")

        panel_label(ax, chr(65 + idx))

    fig.supxlabel("Blend ratio (tea A fraction)", fontsize=FONT_SIZE, y=-0.02)
    fig.supylabel("Sensor response (8-ch mean)", fontsize=FONT_SIZE, x=-0.02)
    fig.tight_layout()
    _save_v2(fig, "fig_ratio_curves_v2")


# ═══════════════════════════════════════════════════════════════
# Fig.6: NLDI heatmap
# ═══════════════════════════════════════════════════════════════

def gen_fig_nldi_heatmap(ds: PaperDataset):
    """单面板 NLDI heatmap。"""
    print("  Fig.6: NLDI heatmap...")
    init_style()

    baselines = compute_pure_baselines(ds)
    tea_labels = ["T1", "T2", "T3", "T4", "T5"]
    n = len(tea_labels)
    nldi_matrix = np.zeros((n, n))

    for i in range(n):
        for j in range(i + 1, n):
            combo_id = f"{tea_labels[i]}-{tea_labels[j]}"
            res = compute_nldi_for_combo(ds, baselines, combo_id,
                                        tea_labels[i], tea_labels[j])
            val = res.get("nldi_mean", 0)
            if np.isnan(val):
                val = 0
            nldi_matrix[i, j] = val
            nldi_matrix[j, i] = val

    fig, ax = plt.subplots(figsize=(FIG_WIDTH_SINGLE * 0.95, FIG_WIDTH_SINGLE * 0.85))

    mask = np.tril(np.ones_like(nldi_matrix, dtype=bool), k=-1)

    sns.heatmap(
        nldi_matrix, annot=True, fmt=".2f",
        cmap="YlOrRd", mask=mask,
        xticklabels=tea_labels, yticklabels=tea_labels,
        ax=ax, linewidths=0.5, linecolor="white",
        annot_kws={"size": FONT_SIZE},
        cbar_kws={"shrink": 0.7, "aspect": 15, "label": "NLDI"},
        square=True, vmin=0,
    )
    ax.set_title("Non-linear deviation index")
    fig.tight_layout()
    _save_v2(fig, "fig_nldi_heatmap_v2")


# ═══════════════════════════════════════════════════════════════
# Fig.7: Tea Aroma Maps (handcrafted vs CARL)
# ═══════════════════════════════════════════════════════════════

def gen_fig_aroma_map(ds: PaperDataset, carl_embeddings: np.ndarray):
    """双面板: A) Handcrafted PCA  B) CARL PCA。共享图例。"""
    print("  Fig.7: Aroma maps (A/B)...")
    init_style()

    pure_mask = ds.pure_mask
    tea_ids_arr = np.array(ds.tea_ids)

    # Handcrafted PCA
    feat_name = "norm_stats" if "norm_stats" in ds.features else list(ds.features.keys())[0]
    X_hc = StandardScaler().fit_transform(ds.features[feat_name][0])
    pca_hc = PCA(n_components=2, random_state=SEED)
    pc_hc = pca_hc.fit_transform(X_hc)
    var_hc = (pca_hc.explained_variance_ratio_[0] * 100, pca_hc.explained_variance_ratio_[1] * 100)

    # CARL PCA
    pca_carl = PCA(n_components=2, random_state=SEED)
    pc_carl = pca_carl.fit_transform(carl_embeddings)
    var_carl = (pca_carl.explained_variance_ratio_[0] * 100, pca_carl.explained_variance_ratio_[1] * 100)

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
    _save_v2(fig, "fig_aroma_map_v2")


# ═══════════════════════════════════════════════════════════════
# SM: CARL training + NLDI-embedding correlation
# ═══════════════════════════════════════════════════════════════

def gen_fig_carl_training(ds: PaperDataset):
    """双面板: A) 训练曲线  B) NLDI vs embedding deviation。"""
    print("  SM: CARL training (A/B)...")
    init_style()

    fig, axes = plt.subplots(1, 2, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.3))

    # A: Training curve — 尝试从 aroma map JSON 或 cache 获取
    ax = axes[0]
    try:
        aroma_json = _load_json("exp_aroma_map_v2.json")
        if "training_history" in aroma_json:
            history = aroma_json["training_history"]
            epochs = history["epoch"]
            ax.plot(epochs, history["train_loss"], "o-", markersize=2, label="Train", color="#0072B2")
            ax.plot(epochs, history["test_loss"], "s--", markersize=2, label="Test", color="#D55E00")
        else:
            ax.text(0.5, 0.5, "Training history\nnot cached", transform=ax.transAxes,
                   ha="center", va="center", fontsize=FONT_SIZE)
    except Exception:
        ax.text(0.5, 0.5, "Training history\nnot available", transform=ax.transAxes,
               ha="center", va="center", fontsize=FONT_SIZE)
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Soft SupCon Loss")
    ax.legend()
    panel_label(ax, "A")

    # B: NLDI vs embedding deviation
    ax = axes[1]
    try:
        carl_emb = _load_embeddings()
        baselines = compute_pure_baselines(ds)
        from scipy.stats import pearsonr

        combo_nldi_vals = []
        combo_emb_devs = []
        tea_labels_5 = ["T1", "T2", "T3", "T4", "T5"]
        for i in range(5):
            for j in range(i + 1, 5):
                tid_a, tid_b = tea_labels_5[i], tea_labels_5[j]
                cid = f"{tid_a}-{tid_b}"
                res = compute_nldi_for_combo(ds, baselines, cid, tid_a, tid_b)
                nldi_val = res.get("nldi_mean", np.nan)
                if np.isnan(nldi_val):
                    continue

                tea_ids_arr = np.array(ds.tea_ids)
                mask_a = ds.pure_mask & (tea_ids_arr == tid_a)
                mask_b = ds.pure_mask & (tea_ids_arr == tid_b)
                emb_a = carl_emb[mask_a].mean(axis=0)
                emb_b = carl_emb[mask_b].mean(axis=0)

                mix_mask = ds.mix_mask & np.array([c == cid for c in ds.combo_ids])
                if mix_mask.sum() == 0:
                    continue
                mix_ratios = np.array(ds.ratios)[mix_mask]
                emb_mix = carl_emb[mix_mask]

                devs = []
                for emb_m, r in zip(emb_mix, mix_ratios):
                    emb_pred = r * emb_a + (1 - r) * emb_b
                    devs.append(np.linalg.norm(emb_m - emb_pred))
                combo_emb_devs.append(np.mean(devs))
                combo_nldi_vals.append(nldi_val)

        combo_nldi = np.array(combo_nldi_vals)
        combo_emb_dev = np.array(combo_emb_devs)
        r_val, p_val = pearsonr(combo_nldi, combo_emb_dev)

        ax.scatter(combo_nldi, combo_emb_dev, s=25, c="#0072B2",
                  edgecolors="white", linewidth=0.3)
        if len(combo_nldi) > 2:
            z = np.polyfit(combo_nldi, combo_emb_dev, 1)
            x_fit = np.linspace(combo_nldi.min(), combo_nldi.max(), 50)
            ax.plot(x_fit, np.polyval(z, x_fit), "--", color="#999", linewidth=0.6)
        ax.set_xlabel("NLDI")
        ax.set_ylabel("Embedding deviation")
        ax.set_title(f"r = {r_val:.3f}, p = {p_val:.3f}", fontsize=FONT_SIZE - 1, fontstyle="italic")
    except Exception as e:
        ax.text(0.5, 0.5, f"Error: {e}", transform=ax.transAxes, ha="center", fontsize=6)
    panel_label(ax, "B")

    fig.tight_layout()
    _save_v2(fig, "fig_carl_training_v2")


# ═══════════════════════════════════════════════════════════════
# SM: Prediction results (scatter + R² comparison)
# ═══════════════════════════════════════════════════════════════

def gen_fig_prediction(ds: PaperDataset, carl_embeddings: np.ndarray):
    """双面板: A) predicted vs actual scatter  B) R² 柱状图。"""
    print("  SM: Prediction (A/B)...")
    init_style()

    reg_json = _load_json("exp_regression_v2.json")
    reg_csv = pd.read_csv(V2_TABLES_DIR / "table3_regression_v2.csv", encoding="latin-1")

    fig, axes = plt.subplots(1, 2, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.35),
                             gridspec_kw={"width_ratios": [1, 1.2]})

    # A: Scatter — 重新运行最佳模型获取散点数据
    ax = axes[0]
    try:
        from sklearn.svm import SVR
        from sklearn.preprocessing import LabelEncoder, OneHotEncoder
        from sklearn.pipeline import Pipeline
        from sklearn.model_selection import StratifiedKFold, cross_val_predict
        from .config import N_CV_FOLDS

        feat_name = "norm_stats" if "norm_stats" in ds.features else list(ds.features.keys())[0]
        y_ratio = np.array(ds.ratios)[ds.mix_mask]
        y_combo = np.array(ds.combo_ids)[ds.mix_mask]

        X_emb = carl_embeddings[ds.mix_mask]
        le = LabelEncoder()
        combo_enc = le.fit_transform(y_combo)
        ohe = OneHotEncoder(sparse_output=False)
        combo_oh = ohe.fit_transform(combo_enc.reshape(-1, 1))
        X_cond = np.hstack([X_emb, combo_oh])

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X_cond)

        pipe = Pipeline([
            ("svr", SVR(kernel="rbf", C=10.0, gamma="scale")),
        ])

        skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
        y_pred = cross_val_predict(pipe, X_scaled, y_ratio, cv=skf.split(X_scaled, y_combo))

        from sklearn.metrics import r2_score, mean_absolute_error
        r2 = r2_score(y_ratio, y_pred)
        mae = mean_absolute_error(y_ratio, y_pred)

        ax.scatter(y_ratio, y_pred, s=8, alpha=0.5, c="#0072B2",
                  edgecolors="none", rasterized=True)
        ax.set_title(f"CARL-Proj + SVR\n$R^2$={r2:.3f}, MAE={mae:.3f}",
                    fontsize=FONT_SIZE - 1)
    except Exception as e:
        print(f"    ⚠ Prediction scatter error: {e}")
        ax.set_title("CARL-Proj + SVR", fontsize=FONT_SIZE - 1)

    ax.plot([0, 1], [0, 1], "k--", alpha=0.4, linewidth=0.5)
    ax.set_xlabel("True ratio")
    ax.set_ylabel("Predicted ratio")
    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.set_aspect("equal")
    panel_label(ax, "A")

    # B: R² comparison bar (from v2 regression results)
    ax = axes[1]
    bar_data = []
    for row in reg_json["table3"]:
        rep = row["representation"]
        svr_r2 = row.get("SVR_r2")
        mlp_r2 = row.get("DeepMLP_r2")
        if isinstance(svr_r2, (int, float)):
            bar_data.append({"model": f"{rep}+SVR", "r2": svr_r2})
        if isinstance(mlp_r2, (int, float)):
            bar_data.append({"model": f"{rep}+DeepMLP", "r2": mlp_r2})

    bar_df = pd.DataFrame(bar_data).sort_values("r2", ascending=True)

    def _tier_color(m):
        if "CARL" in m:
            return "#e74c3c"
        elif "CNN" in m or "LSTM" in m:
            return "#3498db"
        elif "SoftSupCon" in m:
            return "#9b59b6"
        return "#7f8c8d"

    colors = [_tier_color(m) for m in bar_df["model"]]
    y_pos = range(len(bar_df))
    bars = ax.barh(list(y_pos), bar_df["r2"].values, color=colors, height=0.65,
                   edgecolor="white", linewidth=0.3)

    for bar, val in zip(bars, bar_df["r2"]):
        x_pos = max(bar.get_width() + 0.02, 0.02)
        ax.text(x_pos, bar.get_y() + bar.get_height() / 2,
                f"{val:.3f}", va="center", ha="left", fontsize=FONT_SIZE - 2,
                fontweight="bold" if val > 0.5 else "normal")

    ax.set_yticks(list(y_pos))
    ax.set_yticklabels(bar_df["model"].values, fontsize=FONT_SIZE - 1.5)
    ax.set_xlabel("$R^2$")
    ax.axvline(x=0, color="black", linewidth=0.4)
    panel_label(ax, "B")

    fig.tight_layout()
    _save_v2(fig, "fig_prediction_v2")


# ═══════════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════════

def main():
    V2_FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    MANUSCRIPT_FIGS_DIR.mkdir(parents=True, exist_ok=True)
    init_style()

    print("=" * 60)
    print("  v2 Nature / Science 风格图表生成器")
    print(f"  输出: {V2_FIGURES_DIR}")
    print(f"  复制: {MANUSCRIPT_FIGS_DIR}")
    print("=" * 60)

    ds = _load_dataset()
    carl_embeddings = _load_embeddings()

    gen_fig_pure_tea(ds)
    gen_fig_ratio_curves(ds)
    gen_fig_nldi_heatmap(ds)
    gen_fig_aroma_map(ds, carl_embeddings)
    gen_fig_carl_training(ds)
    gen_fig_prediction(ds, carl_embeddings)

    print(f"\n  全部完成! 已复制到 {MANUSCRIPT_FIGS_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
