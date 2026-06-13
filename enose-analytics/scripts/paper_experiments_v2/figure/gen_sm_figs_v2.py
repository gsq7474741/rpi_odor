"""生成 v2 论文 Supplementary Material 图表。

读取已缓存的 v2 实验结果, 生成 SM 所需的全部子图:
  - fig_sm_s2a_raw_curves_v2.pdf        (Figure S2a: 五种纯茶原始响应曲线)
  - fig_sm_s2c_zscore_hist_v2.pdf       (Figure S2c: z-score 直方图 + 3σ阈值)
  - fig_sm_s3_all_ratio_curves_v2.pdf   (Figure S3: 10 组 ratio curves, 2×5)
  - fig_sm_s4_nldi_per_channel_v2.pdf   (Figure S4: 10×8 per-channel NLDI 热力图)
  - fig_sm_s7a_confusion_v2.pdf         (Figure S7a: 3 个混淆矩阵)
  - fig_sm_s7b_cv_boxplot_v2.pdf        (Figure S7b: CV 逐折准确率箱线图)
  - fig_sm_s8a_pred_scatter_v2.pdf      (Figure S8a: 按组合着色的预测散点)
  - fig_sm_s8b_residual_v2.pdf          (Figure S8b: 残差图)
  - fig_sm_s9_tsne_umap_v2.pdf          (Figure S9a-d: t-SNE/UMAP)
  - fig_sm_s9e_3d_pca_v2.pdf           (Figure S9e: CARL 嵌入 3D PCA)
  - fig_sm_s9f_blend_traj_v2.pdf        (Figure S9f: 混合轨迹图)

  同时生成/更新补充表格数据:
  - table_s4_per_channel_nldi.json      (表S4 逐通道 NLDI)
  - table_s7a_per_class_metrics.json    (表S7a 逐类 Prec/Rec/F1)
  - table_s8a_per_combo_regression.json (表S8a 逐组合回归)

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_sm_figs_v2
"""

from __future__ import annotations

import json
import warnings
import pickle
import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import seaborn as sns

from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from ._style import (
    AXIS_GREY, TEA_COLORS, TEA_MARKERS_MAP,
    CURVE_TEAL, CURVE_BAND, PRED_GREY, FOREST_TEAL,
    HIST_TEAL, THRESHOLD_WINE, CHANNEL_COLORS, COMBO_PALETTE,
    soft_teal_cmap,
    init_nature_style, panel_label, save_figure,
    load_dataset, load_embeddings, load_json,
    V2_TABLES_DIR, V2_FIGURES_DIR, MANUSCRIPT_FIGS_DIR,
)
from ..config import (
    SEED, N_SENSORS, CACHE_DIR,
    FIG_WIDTH_SINGLE, FIG_WIDTH_1_5, FIG_WIDTH_DOUBLE,
    TEA_ORDER, TEA_NAME_EN,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
)
from ..data import PaperDataset
from ..nldi import compute_pure_baselines, compute_nldi_for_combo

np.random.seed(SEED)
warnings.filterwarnings("ignore")


def _load_v1_raw_dataset() -> PaperDataset:
    """加载 v1 原始电阻数据集（未归一化），用于 z-score 异常值检测和原始曲线绘图。"""
    v1_path = CACHE_DIR / "paper_dataset_v1_raw.pkl"
    assert v1_path.exists(), (
        f"v1 原始数据集不存在: {v1_path}\n"
        f"请从 scripts/cache/paper/ 复制 paper_dataset_runs99_*_cut80s.pkl")
    with open(v1_path, "rb") as f:
        return pickle.load(f)


# ═══════════════════════════════════════════════════════════════
# Figure S3: All 10 ratio curves (2×5)
# ═══════════════════════════════════════════════════════════════

def gen_s3_all_ratio_curves(ds: PaperDataset):
    """2×5 面板: 全部 10 组 ratio curves, 按 NLDI 降序排列。"""
    print("  Figure S3: All ratio curves...")
    init_nature_style()

    baselines = compute_pure_baselines(ds)
    nldi_json = load_json("exp_nldi_v2.json")
    table1 = nldi_json["table1"]
    combo_order = [row["combo"] for row in table1 if row["combo"] != "Overall"]

    fig, axes = plt.subplots(2, 5, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.55),
                             sharex=True, sharey=False)
    axes_flat = axes.flatten()

    for idx, combo_id in enumerate(combo_order):
        ax = axes_flat[idx]
        parts = combo_id.split("-")
        tea_a_id, tea_b_id = parts[0], parts[1]
        res = compute_nldi_for_combo(ds, baselines, combo_id, tea_a_id, tea_b_id)

        if "measured_by_ratio" in res and res["measured_by_ratio"]:
            ratios_sorted = sorted(res["measured_by_ratio"].keys())
            measured = np.array([res["measured_by_ratio"][r] for r in ratios_sorted])
            predicted = np.array([res["predicted_by_ratio"][r] for r in ratios_sorted])
            ratio_steps = np.array(ratios_sorted)
            nldi_val = res.get("nldi_mean", 0)
            mean_meas = measured.mean(axis=1)
            mean_pred = predicted.mean(axis=1)
            std_meas = measured.std(axis=1)
            ax.fill_between(ratio_steps, mean_meas - std_meas,
                            mean_meas + std_meas, color=CURVE_BAND, alpha=0.13)
            ax.plot(ratio_steps, mean_pred, "--", color=PRED_GREY, linewidth=0.4)
            ax.plot(ratio_steps, mean_meas, "-", color=CURVE_TEAL, linewidth=0.5)
            ax.set_title(f"{combo_id}  {nldi_val:.3f}", fontsize=5.5, pad=2)
            ax.set_xlim(-0.02, 1.02)
            if idx == 0:
                ax.legend(["Linear", "Measured"], loc="lower left",
                          fontsize=4.5, handlelength=0.8)
        else:
            ax.set_title(combo_id)
            ax.text(0.5, 0.5, "No data", transform=ax.transAxes, ha="center")

    fig.supxlabel("Blend ratio (fraction of Tea A)", fontsize=6.5, y=-0.02)
    fig.supylabel("Mean normalised sensor response", fontsize=6.5, x=0.01)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s3_all_ratio_curves_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S4: Per-channel NLDI heatmap (10 combos × 8 channels)
# ═══════════════════════════════════════════════════════════════

def gen_s4_nldi_per_channel(ds: PaperDataset):
    """10×8 per-channel NLDI 热力图。"""
    print("  Figure S4: Per-channel NLDI...")
    init_nature_style()

    baselines = compute_pure_baselines(ds)
    nldi_json = load_json("exp_nldi_v2.json")
    table1 = nldi_json["table1"]
    combo_order = [row["combo"] for row in table1 if row["combo"] != "Overall"]

    n_combos = len(combo_order)
    per_ch_matrix = np.zeros((n_combos, N_SENSORS))

    for i, combo_id in enumerate(combo_order):
        parts = combo_id.split("-")
        tea_a_id, tea_b_id = parts[0], parts[1]
        res = compute_nldi_for_combo(ds, baselines, combo_id, tea_a_id, tea_b_id)
        if "nldi_per_channel" in res:
            per_ch_matrix[i] = res["nldi_per_channel"]
        else:
            per_ch_matrix[i] = res.get("nldi_mean", 0)

    fig, ax = plt.subplots(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_SINGLE * 1.1))

    sns.heatmap(
        per_ch_matrix, annot=True, fmt=".2f",
        cmap=soft_teal_cmap(),
        xticklabels=[f"CH{c}" for c in range(N_SENSORS)],
        yticklabels=combo_order,
        ax=ax, linewidths=0.5, linecolor="white",
        annot_kws={"size": 6.5, "color": AXIS_GREY},
        cbar_kws={"shrink": 0.6, "aspect": 10},
        vmin=0,
    )
    ax.set_xlabel("Sensor channel", fontsize=6.5)
    ax.set_ylabel("Binary combination", fontsize=6.5)
    ax.tick_params(labelsize=6, length=0)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s4_nldi_per_channel_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S8a: Predicted vs actual scatter (colour by combo)
# ═══════════════════════════════════════════════════════════════

def _load_reg_predictions() -> dict | None:
    """加载回归实验的 per-sample 预测。"""
    npz_path = V2_TABLES_DIR / "reg_predictions_v2.npz"
    if not npz_path.exists():
        print(f"    ⚠ {npz_path} 不存在, 跳过 (需先运行 run_all --exp reg)")
        return None
    data = np.load(npz_path, allow_pickle=True)
    return {
        "y_ratio": data["y_ratio"],
        "y_combo": data["y_combo"],
        "y_pred_svr": data["y_pred_svr"],
    }


def gen_s8a_pred_scatter(ds: PaperDataset, carl_embeddings: np.ndarray):
    """按组合着色的预测散点图 — 从实验 npz 读取 nested CV 预测。"""
    print("  Figure S8a: Prediction scatter (by combo)...")
    init_nature_style()

    from sklearn.metrics import r2_score, mean_absolute_error

    reg_data = _load_reg_predictions()
    if reg_data is None:
        return
    y_ratio = reg_data["y_ratio"]
    y_combo = reg_data["y_combo"]
    y_pred = reg_data["y_pred_svr"]

    fig, ax = plt.subplots(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_1_5))

    unique_combos = sorted(set(y_combo))
    for ci, combo_id in enumerate(unique_combos):
        mask = y_combo == combo_id
        ax.scatter(y_ratio[mask], y_pred[mask], s=10, alpha=0.6,
                  color=COMBO_PALETTE[ci % len(COMBO_PALETTE)],
                  label=combo_id, edgecolors="white", linewidth=0.2)

    ax.plot([0, 1], [0, 1], "--", color=PRED_GREY, linewidth=0.4)
    ax.set_xlabel("True ratio", fontsize=6.5)
    ax.set_ylabel("Predicted ratio", fontsize=6.5)
    r2 = r2_score(y_ratio, y_pred)
    mae = mean_absolute_error(y_ratio, y_pred)
    ax.set_title(f"CARL-Proj + SVR: $R^2$={r2:.3f}, MAE={mae:.3f}", fontsize=6.5)
    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.set_aspect("equal")
    ax.legend(fontsize=4.5, ncol=2, loc="lower right", framealpha=0.8)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s8a_pred_scatter_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S8b: Residual plot
# ═══════════════════════════════════════════════════════════════

def gen_s8b_residual(ds: PaperDataset, carl_embeddings: np.ndarray):
    """残差 (predicted - actual) vs actual ratio 散点图 — 从 npz 读取。"""
    print("  Figure S8b: Residual plot...")
    init_nature_style()

    reg_data = _load_reg_predictions()
    if reg_data is None:
        return
    y_ratio = reg_data["y_ratio"]
    y_combo = reg_data["y_combo"]
    y_pred = reg_data["y_pred_svr"]

    residual = y_pred - y_ratio

    fig, ax = plt.subplots(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_SINGLE))

    unique_combos = sorted(set(y_combo))
    for ci, combo_id in enumerate(unique_combos):
        mask = y_combo == combo_id
        ax.scatter(y_ratio[mask], residual[mask], s=10, alpha=0.6,
                  color=COMBO_PALETTE[ci % len(COMBO_PALETTE)],
                  label=combo_id, edgecolors="white", linewidth=0.2)

    ax.axhline(y=0, color=PRED_GREY, linestyle="--", linewidth=0.4)
    ax.set_xlabel("True ratio", fontsize=6.5)
    ax.set_ylabel("Residual (predicted − actual)", fontsize=6.5)
    ax.set_title("CARL-Proj + SVR residuals", fontsize=6.5)
    ax.set_xlim(-0.05, 1.05)
    ax.legend(fontsize=4.5, ncol=2, loc="upper right", framealpha=0.8)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s8b_residual_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S9a-d: t-SNE / UMAP of CARL and HC
# ═══════════════════════════════════════════════════════════════

def gen_s9_tsne_umap(ds: PaperDataset, carl_embeddings: np.ndarray):
    """四面板: (a) t-SNE CARL, (b) UMAP CARL, (c) t-SNE HC, (d) UMAP HC。"""
    print("  Figure S9a-d: t-SNE / UMAP...")
    init_nature_style()

    from sklearn.manifold import TSNE

    pure_mask = ds.pure_mask
    tea_ids_arr = np.array(ds.tea_ids)

    feat_name = "norm_stats" if "norm_stats" in ds.features else list(ds.features.keys())[0]
    X_hc = StandardScaler().fit_transform(ds.features[feat_name][0])

    # t-SNE
    tsne_carl = TSNE(n_components=2, perplexity=30, random_state=SEED).fit_transform(carl_embeddings)
    tsne_hc = TSNE(n_components=2, perplexity=30, random_state=SEED).fit_transform(X_hc)

    # UMAP (optional — fallback to PCA if not installed)
    try:
        from umap import UMAP
        umap_carl = UMAP(n_neighbors=15, random_state=SEED).fit_transform(carl_embeddings)
        umap_hc = UMAP(n_neighbors=15, random_state=SEED).fit_transform(X_hc)
    except ImportError:
        print("    ⚠ UMAP not installed, using PCA fallback for panels (b)/(d)")
        pca = PCA(n_components=2, random_state=SEED)
        umap_carl = pca.fit_transform(carl_embeddings)
        umap_hc = pca.fit_transform(X_hc)

    fig, axes = plt.subplots(2, 2, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.8))
    titles = ["t-SNE (CARL)", "UMAP (CARL)", "t-SNE (HC)", "UMAP (HC)"]
    data_list = [tsne_carl, umap_carl, tsne_hc, umap_hc]

    for ax_idx, (ax, emb, title) in enumerate(zip(axes.flatten(), data_list, titles)):
        mix_mask = ~pure_mask
        if mix_mask.any():
            ax.scatter(emb[mix_mask, 0], emb[mix_mask, 1],
                      c="#CCCCCC", s=3, alpha=0.2, zorder=1, rasterized=True)
        for tid in sorted(set(tea_ids_arr[pure_mask])):
            mask = pure_mask & (tea_ids_arr == tid)
            raw_name = TEA_ORDER[int(tid[1]) - 1] if tid.startswith("T") and tid[1].isdigit() else ""
            en_name = TEA_NAME_EN.get(raw_name, tid)
            ax.scatter(emb[mask, 0], emb[mask, 1],
                      c=TEA_COLORS.get(tid, "#999999"), marker=TEA_MARKERS_MAP.get(tid, "o"),
                      s=15, alpha=0.8, edgecolors="white", linewidth=0.3,
                      label=f"{tid} {en_name}", zorder=3)
        ax.set_title(title)
        panel_label(ax, chr(97 + ax_idx))

    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=5,
               bbox_to_anchor=(0.5, -0.04), frameon=False,
               markerscale=1.3, handletextpad=0.3, columnspacing=0.8)

    fig.tight_layout()
    save_figure(fig, "fig_sm_s9_tsne_umap_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S9f: Blend trajectories on CARL PCA
# ═══════════════════════════════════════════════════════════════

def gen_s9f_blend_trajectories(ds: PaperDataset, carl_embeddings: np.ndarray):
    """全部 10 条混合轨迹叠加在 CARL PCA 上, 线宽正比于 NLDI。"""
    print("  Figure S9f: Blend trajectories...")
    init_nature_style()

    pca = PCA(n_components=2, random_state=SEED)
    pc = pca.fit_transform(carl_embeddings)

    pure_mask = ds.pure_mask
    tea_ids_arr = np.array(ds.tea_ids)
    combo_ids_arr = np.array(ds.combo_ids)
    ratios_arr = np.array(ds.ratios)

    baselines = compute_pure_baselines(ds)
    nldi_json = load_json("exp_nldi_v2.json")
    nldi_lookup = {row["combo"]: row["nldi_mean"] for row in nldi_json["table1"]}

    fig, ax = plt.subplots(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_1_5))

    # 纯茶点
    for tid in sorted(set(tea_ids_arr[pure_mask])):
        mask = pure_mask & (tea_ids_arr == tid)
        raw_name = TEA_ORDER[int(tid[1]) - 1] if tid.startswith("T") and tid[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, tid)
        ax.scatter(pc[mask, 0], pc[mask, 1],
                  c=TEA_COLORS.get(tid, "#999999"), marker=TEA_MARKERS_MAP.get(tid, "o"),
                  s=25, alpha=0.8, edgecolors="white", linewidth=0.3,
                  label=f"{tid} {en_name}", zorder=3)

    # 混合轨迹
    tea_labels_5 = ["T1", "T2", "T3", "T4", "T5"]
    for i in range(5):
        for j in range(i + 1, 5):
            tid_a, tid_b = tea_labels_5[i], tea_labels_5[j]
            cid = f"{tid_a}-{tid_b}"
            nldi_val = nldi_lookup.get(cid, 0.3)
            linewidth = 0.5 + nldi_val * 5

            mask_a = pure_mask & (tea_ids_arr == tid_a)
            mask_b = pure_mask & (tea_ids_arr == tid_b)
            centroid_a = pc[mask_a].mean(axis=0)
            centroid_b = pc[mask_b].mean(axis=0)

            # 线性插值 (虚线)
            ax.plot([centroid_a[0], centroid_b[0]], [centroid_a[1], centroid_b[1]],
                   "--", color="#CCCCCC", linewidth=0.5, zorder=1)

            # 实际混合点的轨迹
            mix_mask = ds.mix_mask & (combo_ids_arr == cid)
            if mix_mask.sum() > 0:
                mix_ratios = ratios_arr[mix_mask]
                mix_pc = pc[mix_mask]
                order = np.argsort(mix_ratios)
                # 完整轨迹: centroid_a → mix points → centroid_b
                traj_x = np.concatenate([[centroid_a[0]], mix_pc[order, 0], [centroid_b[0]]])
                traj_y = np.concatenate([[centroid_a[1]], mix_pc[order, 1], [centroid_b[1]]])
                ax.plot(traj_x, traj_y, "-", linewidth=linewidth, alpha=0.6,
                       color="#888888", zorder=2)

    var = pca.explained_variance_ratio_ * 100
    ax.set_xlabel(f"PC1 ({var[0]:.1f}%)", fontsize=6.5)
    ax.set_ylabel(f"PC2 ({var[1]:.1f}%)", fontsize=6.5)
    ax.set_title("Blend trajectories (line width ∘ NLDI)", fontsize=6.5)
    ax.legend(fontsize=5, loc="best", framealpha=0.8)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s9f_blend_traj_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S2a: Raw response curves for 5 pure teas
# ═══════════════════════════════════════════════════════════════

def gen_s2a_raw_curves(ds: PaperDataset):
    """五种纯茶的原始八通道电阻时间序列 (每种 3 个代表性重复)。

    使用 v1 原始电阻数据（归一化前），与文稿 S1 描述一致。
    """
    print("  Figure S2a: Raw response curves...")
    init_nature_style()

    ds_raw = _load_v1_raw_dataset()
    tea_ids_arr = np.array(ds_raw.tea_ids)
    X = ds_raw.X_aligned  # (690, 100, 32) — v1 原始电阻值

    fig, axes = plt.subplots(1, 5, figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_SINGLE * 0.8),
                             sharey=True)
    n_reps = 3  # 每种茶展示的代表性重复数
    time_steps = np.arange(X.shape[1])

    for ax_idx, tid in enumerate(["T1", "T2", "T3", "T4", "T5"]):
        ax = axes[ax_idx]
        pure_idx = np.where(ds_raw.pure_mask & (tea_ids_arr == tid))[0]
        # 均匀采样 n_reps 个
        sel = pure_idx[np.linspace(0, len(pure_idx) - 1, n_reps, dtype=int)]
        for rep_i, si in enumerate(sel):
            for ch in range(N_SENSORS):
                alpha = 0.8 if rep_i == 0 else 0.3
                ax.plot(time_steps, X[si, :, ch], linewidth=0.5, alpha=alpha,
                       color=CHANNEL_COLORS[ch], label=f"CH{ch}" if rep_i == 0 else None)
        raw_name = TEA_ORDER[int(tid[1]) - 1] if tid.startswith("T") else tid
        en_name = TEA_NAME_EN.get(raw_name, tid)
        ax.set_title(f"{tid} ({en_name})", fontsize=6.5)
        ax.set_xlabel("Time step")
        if ax_idx == 0:
            ax.set_ylabel("Resistance (raw)")
        panel_label(ax, chr(97 + ax_idx))

    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=N_SENSORS,
               bbox_to_anchor=(0.5, -0.08), frameon=False,
               handletextpad=0.3, columnspacing=0.8, fontsize=5.5)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s2a_raw_curves_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S2c: Z-score histogram for outlier detection
# ═══════════════════════════════════════════════════════════════

def gen_s2c_zscore_histogram(ds: PaperDataset):
    """多变量 z-score 范数直方图，标注 3σ 阈值。

    使用 v1 原始电阻数据（漂移校正后、归一化前）计算全局 z-score，
    与文稿描述一致：在归一化前检测异常值。
    """
    print("  Figure S2c: Z-score histogram...")
    init_nature_style()

    ds_raw = _load_v1_raw_dataset()
    X = ds_raw.X_aligned[:, :, :N_SENSORS]  # 原始电阻值
    n_samples = X.shape[0]
    X_flat = X.reshape(n_samples, -1)

    mean = X_flat.mean(axis=0)
    std = X_flat.std(axis=0) + 1e-12
    z = (X_flat - mean) / std
    z_norms = np.linalg.norm(z, axis=1) / np.sqrt(z.shape[1])

    threshold = 3.0

    fig, ax = plt.subplots(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_SINGLE))
    ax.hist(z_norms, bins=40, color=HIST_TEAL, alpha=0.7, edgecolor="white", linewidth=0.3)
    ax.axvline(threshold, color=THRESHOLD_WINE, linestyle="--", linewidth=0.8, label="3σ threshold")
    n_outliers = (z_norms > threshold).sum()
    pct = n_outliers / n_samples * 100
    ax.text(threshold + 0.05, ax.get_ylim()[1] * 0.85,
            f"{n_outliers} outliers ({pct:.1f}%)",
            color=THRESHOLD_WINE, fontsize=6)
    ax.set_xlabel("Multivariate z-score norm", fontsize=6.5)
    ax.set_ylabel("Count", fontsize=6.5)
    ax.legend(fontsize=5.5)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s2c_zscore_hist_v2")
    print(f"    → {n_outliers} outliers detected ({pct:.1f}%)")


# ═══════════════════════════════════════════════════════════════
# Figure S7a: Confusion matrices (HC+LDA, 1D-CNN, CARL-FT)
# ═══════════════════════════════════════════════════════════════

def gen_s7a_confusion(ds: PaperDataset, carl_embeddings: np.ndarray):
    """三面板混淆矩阵: (a) HC+LDA, (b) CARL frozen SVM, (c) CARL fine-tuning.
    
    从实验保存的 cls_predictions_v2.npz 读取 per-sample 预测,
    保证与 Table 2 完全一致 (nested CV, 无数据泄漏)。
    """
    print("  Figure S7a: Confusion matrices...")
    init_nature_style()

    from sklearn.metrics import confusion_matrix, accuracy_score, classification_report

    npz_path = V2_TABLES_DIR / "cls_predictions_v2.npz"
    if not npz_path.exists():
        print(f"    ⚠ {npz_path} 不存在, 跳过 (需先运行 run_all --exp cls)")
        return

    data = np.load(npz_path, allow_pickle=True)
    y_true = data["y_true"]           # int-encoded
    labels = data["labels"]           # ['T1','T2','T3','T4','T5']
    y_pred_lda = data["y_pred_hc_lda"]
    y_pred_svm = data["y_pred_carl_svm"]
    y_pred_ft = data["y_pred_carl_ft"]

    # 转回 str 标签
    y_str = labels[y_true]
    y_lda_str = labels[y_pred_lda]
    y_svm_str = labels[y_pred_svm]
    y_ft_str = labels[y_pred_ft]

    labels_5 = list(labels)

    cm_lda = confusion_matrix(y_str, y_lda_str, labels=labels_5)
    acc_lda = accuracy_score(y_str, y_lda_str) * 100

    cm_svm = confusion_matrix(y_str, y_svm_str, labels=labels_5)
    acc_svm = accuracy_score(y_str, y_svm_str) * 100

    cm_ft = confusion_matrix(y_str, y_ft_str, labels=labels_5)
    acc_ft = accuracy_score(y_str, y_ft_str) * 100

    # 绘图
    fig, axes = plt.subplots(1, 3, figsize=(FIG_WIDTH_DOUBLE * 1.3, FIG_WIDTH_SINGLE * 1.1))
    cms = [cm_lda, cm_svm, cm_ft]
    titles = [f"(a) HC + LDA ({acc_lda:.1f}%)",
              f"(b) CARL + SVM-RBF ({acc_svm:.1f}%)",
              f"(c) CARL fine-tuning ({acc_ft:.1f}%)"]

    for ax, cm, title in zip(axes, cms, titles):
        sns.heatmap(cm, annot=True, fmt="d", cmap=soft_teal_cmap(),
                   xticklabels=labels_5, yticklabels=labels_5,
                   ax=ax, linewidths=0.5, linecolor="white",
                   annot_kws={"size": 6.5, "color": AXIS_GREY},
                   cbar=False)
        ax.set_xlabel("Predicted", fontsize=6.5)
        ax.set_ylabel("True", fontsize=6.5)
        ax.set_title(title, fontsize=6.5)
        ax.tick_params(labelsize=6, length=0)

    fig.tight_layout()
    save_figure(fig, "fig_sm_s7a_confusion_v2")

    # 同时导出逐类指标 JSON — 基于 CARL fine-tuning (task-best)
    report = classification_report(y_str, y_ft_str, output_dict=True, target_names=labels_5)
    s7a_data = {}
    for t in labels_5:
        s7a_data[t] = {
            "precision": round(report[t]["precision"] * 100, 1),
            "recall": round(report[t]["recall"] * 100, 1),
            "f1": round(report[t]["f1-score"] * 100, 1),
            "support": int(report[t]["support"]),
        }
    s7a_data["macro_avg"] = {
        "precision": round(report["macro avg"]["precision"] * 100, 1),
        "recall": round(report["macro avg"]["recall"] * 100, 1),
        "f1": round(report["macro avg"]["f1-score"] * 100, 1),
        "support": int(report["macro avg"]["support"]),
    }
    out_path = V2_TABLES_DIR / "table_s7a_per_class_metrics.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(s7a_data, f, indent=2, ensure_ascii=False)
    print(f"    → table_s7a_per_class_metrics.json")


# ═══════════════════════════════════════════════════════════════
# Figure S7b: CV fold-wise accuracy boxplot
# ═══════════════════════════════════════════════════════════════

def gen_s7b_cv_boxplot(ds: PaperDataset, carl_embeddings: np.ndarray):
    """五折 CV 准确率柱状图 + 误差线: 从已保存的 table2 CSV 读取, 不重新实验。"""
    print("  Figure S7b: CV accuracy bar chart...")
    init_nature_style()

    import csv
    csv_path = V2_TABLES_DIR / "table2_classification_v2.csv"
    if not csv_path.exists():
        print(f"    ⚠ {csv_path} 不存在, 跳过")
        return

    # 读取已保存的结果
    rows = {}
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows[row["representation"].strip()] = row

    # 选取 6 种代表性方法 (覆盖 Table 2 各范式)
    methods = [
        ("HC + LDA",                  "HC+LDA"),
        ("HC + SVM-RBF",              "HC+SVM"),
        ("1D-CNN",                    "1D-CNN"),
        ("Autoencoder + SVM-RBF",     "AE+SVM"),
        ("CARL + SVM-RBF (frozen)",   "CARL\n(frozen)"),
        ("CARL (fine-tuning)",        "CARL\n(fine-tune)"),
    ]

    means, stds, labels = [], [], []
    for key, label in methods:
        if key not in rows:
            print(f"    ⚠ '{key}' 未在 CSV 中找到, 跳过")
            continue
        acc_str = rows[key]["acc"]  # e.g. "94.1±1.2"
        parts = acc_str.replace("±", "±").split("±")  # 兼容全角/半角
        m = float(parts[0])
        s = float(parts[1]) if len(parts) > 1 else 0.0
        means.append(m)
        stds.append(s)
        labels.append(label)
        print(f"    {label:16s}: {m:.1f} ± {s:.1f}%")

    n = len(means)
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_SINGLE))
    x = np.arange(n)
    bar_colors = ["#8CBEB2", "#5B9279", "#7A98BF",
                  "#B8A9C9", TEA_COLORS["T1"], TEA_COLORS["T2"]][:n]
    edge_colors = ["#5A8F82", "#3D6B55", "#556B8A",
                   "#8A7BA0", "#C07A28", "#7A2A1C"][:n]

    bars = ax.bar(x, means, width=0.6, color=bar_colors, edgecolor=edge_colors,
                  linewidth=0.6, alpha=0.8, zorder=3)
    ax.errorbar(x, means, yerr=stds, fmt="none", ecolor=AXIS_GREY,
                elinewidth=0.6, capsize=2.5, capthick=0.5, zorder=4)

    # 数值标注
    for i, (m, s) in enumerate(zip(means, stds)):
        ax.text(i, m + s + 0.8, f"{m:.1f}", ha="center", va="bottom",
                fontsize=5, color=AXIS_GREY)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=5)
    ax.set_ylabel("Accuracy (%)", fontsize=6.5)
    ax.set_ylim(60, 105)
    ax.axhline(y=100, color=PRED_GREY, linewidth=0.3, linestyle="--", zorder=1)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s7b_cv_boxplot_v2")


# ═══════════════════════════════════════════════════════════════
# Figure S9e: 3D PCA of CARL embeddings
# ═══════════════════════════════════════════════════════════════

def gen_s9e_3d_pca(ds: PaperDataset, carl_embeddings: np.ndarray):
    """CARL 嵌入的 PC1–PC2–PC3 三维投影。"""
    print("  Figure S9e: 3D PCA...")
    init_nature_style()

    pca = PCA(n_components=3, random_state=SEED)
    pc = pca.fit_transform(carl_embeddings)

    pure_mask = ds.pure_mask
    tea_ids_arr = np.array(ds.tea_ids)

    fig = plt.figure(figsize=(FIG_WIDTH_1_5, FIG_WIDTH_1_5))
    ax = fig.add_subplot(111, projection="3d")

    # 拼配样本（灰色背景）
    mix_mask = ~pure_mask
    if mix_mask.any():
        ax.scatter(pc[mix_mask, 0], pc[mix_mask, 1], pc[mix_mask, 2],
                  c="#CCCCCC", s=2, alpha=0.15, rasterized=True)

    # 纯茶样本
    for tid in sorted(set(tea_ids_arr[pure_mask])):
        mask = pure_mask & (tea_ids_arr == tid)
        raw_name = TEA_ORDER[int(tid[1]) - 1] if tid.startswith("T") and tid[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, tid)
        ax.scatter(pc[mask, 0], pc[mask, 1], pc[mask, 2],
                  c=TEA_COLORS.get(tid, "#999999"), marker=TEA_MARKERS_MAP.get(tid, "o"),
                  s=18, alpha=0.85, edgecolors="white", linewidth=0.2,
                  label=f"{tid} {en_name}")

    var = pca.explained_variance_ratio_ * 100
    ax.set_xlabel(f"PC1 ({var[0]:.1f}%)", fontsize=6)
    ax.set_ylabel(f"PC2 ({var[1]:.1f}%)", fontsize=6)
    ax.set_zlabel(f"PC3 ({var[2]:.1f}%)", fontsize=6)
    ax.legend(fontsize=5, loc="upper left", framealpha=0.8)
    ax.view_init(elev=25, azim=135)
    fig.tight_layout()
    save_figure(fig, "fig_sm_s9e_3d_pca_v2")


# ═══════════════════════════════════════════════════════════════
# 表格数据生成: 表S4 逐通道 NLDI, 表S8a 逐组合回归
# ═══════════════════════════════════════════════════════════════

def gen_table_s4_per_channel_nldi(ds: PaperDataset):
    """导出表S4逐通道NLDI数据到JSON。"""
    print("  Table S4: Per-channel NLDI data...")

    baselines = compute_pure_baselines(ds)
    nldi_json = load_json("exp_nldi_v2.json")
    table1 = nldi_json["table1"]
    combo_order = [row["combo"] for row in table1 if row["combo"] != "Overall"]

    result = {}
    for combo_id in combo_order:
        parts = combo_id.split("-")
        tea_a_id, tea_b_id = parts[0], parts[1]
        res = compute_nldi_for_combo(ds, baselines, combo_id, tea_a_id, tea_b_id)
        per_ch = res.get("nldi_per_channel", [res.get("nldi_mean", 0)] * N_SENSORS)
        result[combo_id] = {
            f"Ch{i+1}": round(float(per_ch[i]), 3) for i in range(N_SENSORS)
        }
        result[combo_id]["mean"] = round(float(res.get("nldi_mean", 0)), 3)

    out_path = V2_TABLES_DIR / "table_s4_per_channel_nldi.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"    → table_s4_per_channel_nldi.json")
    return result


def gen_table_s8a_per_combo_regression(ds: PaperDataset, carl_embeddings: np.ndarray):
    """导出表S8a逐组合回归性能到JSON — 从 npz 读取 nested CV 预测。"""
    print("  Table S8a: Per-combo regression data...")

    from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

    reg_data = _load_reg_predictions()
    if reg_data is None:
        return {}
    y_ratio = reg_data["y_ratio"]
    y_combo = reg_data["y_combo"]
    y_pred = reg_data["y_pred_svr"]

    result = {}
    for combo_id in sorted(set(y_combo)):
        mask = y_combo == combo_id
        n = int(mask.sum())
        r2 = r2_score(y_ratio[mask], y_pred[mask])
        mae = mean_absolute_error(y_ratio[mask], y_pred[mask])
        rmse = np.sqrt(mean_squared_error(y_ratio[mask], y_pred[mask]))
        result[combo_id] = {
            "n": n, "r2": round(r2, 3), "mae": round(mae, 3), "rmse": round(rmse, 3)
        }

    # 总体
    r2_all = r2_score(y_ratio, y_pred)
    mae_all = mean_absolute_error(y_ratio, y_pred)
    rmse_all = np.sqrt(mean_squared_error(y_ratio, y_pred))
    result["Overall"] = {
        "n": len(y_ratio), "r2": round(r2_all, 3),
        "mae": round(mae_all, 3), "rmse": round(rmse_all, 3)
    }

    out_path = V2_TABLES_DIR / "table_s8a_per_combo_regression.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"    → table_s8a_per_combo_regression.json")
    return result


# ═══════════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════════

def main():
    V2_FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    MANUSCRIPT_FIGS_DIR.mkdir(parents=True, exist_ok=True)
    init_nature_style()

    print("=" * 60)
    print("  v2 Supplementary Material 图表生成器")
    print(f"  输出: {V2_FIGURES_DIR}")
    print(f"  复制: {MANUSCRIPT_FIGS_DIR}")
    print("=" * 60)

    ds = load_dataset()
    carl_embeddings = load_embeddings()

    # ── 新增: S2 数据预处理可视化 ──
    gen_s2a_raw_curves(ds)
    gen_s2c_zscore_histogram(ds)

    # ── 原有: S3/S4 叠加性 ──
    gen_s3_all_ratio_curves(ds)
    gen_s4_nldi_per_channel(ds)

    # ── 新增: S7 分类补充 ──
    gen_s7a_confusion(ds, carl_embeddings)
    gen_s7b_cv_boxplot(ds, carl_embeddings)

    # ── 原有: S8 回归补充 ──
    gen_s8a_pred_scatter(ds, carl_embeddings)
    gen_s8b_residual(ds, carl_embeddings)

    # ── 原有+新增: S9 香气图谱 ──
    gen_s9_tsne_umap(ds, carl_embeddings)
    gen_s9e_3d_pca(ds, carl_embeddings)
    gen_s9f_blend_trajectories(ds, carl_embeddings)

    # ── 新增: 表格数据导出 ──
    gen_table_s4_per_channel_nldi(ds)
    gen_table_s8a_per_combo_regression(ds, carl_embeddings)

    print(f"\n  SM 图表全部完成! 已复制到 {MANUSCRIPT_FIGS_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
