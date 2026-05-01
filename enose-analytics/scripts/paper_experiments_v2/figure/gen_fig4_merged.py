"""生成 Fig 4 合图 — 纯茶表征 + 非线性叠加 (5-panel A–E).

Panel A: PCA scatter (pure tea)
Panel B: Radar chart (8-ch mean normalised responses)
Panel C: 2×5 response–ratio curves (all 10 binary combos)
Panel D: 5×5 NLDI 三角热力图
Panel E: NLDI forest plot (bootstrap 95% CI)

色板与 fig1_hero_v3.png 保持一致 (AI 色板):
  T1=#E89B3C  T2=#A33B2A  T3=#6FB58A  T4=#3F6FA8  T5=#C57BA1

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_fig4_merged
"""

from __future__ import annotations

import json
import pickle
import warnings
import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import seaborn as sns

from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from pathlib import Path

from ..config import (
    SEED, N_SENSORS, FONT_SIZE, FONT_FAMILY,
    FIG_WIDTH_DOUBLE, FIGURE_DPI,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN, TEA_MARKERS,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
    CACHE_DIR,
)
from ..data import PaperDataset
from ..nldi import compute_pure_baselines, compute_nldi_for_combo

np.random.seed(SEED)
warnings.filterwarnings("ignore")

# ══════════════════════════════════════════════════════
# 与 fig1_hero_v3 一致的 AI 色板
# ══════════════════════════════════════════════════════

FIG4_TEA_COLORS: dict[str, str] = {
    "T1": "#E89B3C",  # amber-orange (Oolong)
    "T2": "#A33B2A",  # wine-red (Black)
    "T3": "#6FB58A",  # tea-green (Jasmine)
    "T4": "#3F6FA8",  # deep-blue (XQG Pu-erh)
    "T5": "#C57BA1",  # purple-pink (Dark)
}

FIG4_TEA_MARKERS: dict[str, str] = {
    "T1": "o",
    "T2": "s",
    "T3": "^",
    "T4": "D",
    "T5": "v",
}

# 辅助色 — 与 hero 图一致的低饱和调性
SCHEMATIC_TEAL = "#7FB7B0"
SCHEMATIC_DARK = "#2D2D2D"
CURVE_TEAL = "#5A9E95"       # hero 图 CARL Encoder 青色
CURVE_BAND = "#7FB7B0"       # 置信带 (浅青)
PRED_GREY = "#B0B0B0"        # 线性预测虚线
FOREST_TEAL = "#4D9085"      # forest plot 点 (深青)
AXIS_GREY = "#2D2D2D"        # 坐标轴颜色

# ══════════════════════════════════════════════════════
# 路径
# ══════════════════════════════════════════════════════

V2_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results" / "v2"
V2_TABLES_DIR = V2_RESULTS_DIR / "tables"
V2_FIGURES_DIR = V2_RESULTS_DIR / "figures"
MANUSCRIPT_DIR = Path(r"g:\Downloads\机器嗅觉研究\idea\tea_mix\manuscript")
MANUSCRIPT_FIGS_DIR = MANUSCRIPT_DIR / "figures_v2"


# ══════════════════════════════════════════════════════
# 数据
# ══════════════════════════════════════════════════════

def _load_dataset() -> PaperDataset:
    pkl_files = list(CACHE_DIR.glob("paper_dataset_*.pkl"))
    assert pkl_files, f"No cached dataset found in {CACHE_DIR}"
    with open(pkl_files[0], "rb") as f:
        return pickle.load(f)


def _load_nldi_table() -> pd.DataFrame:
    p = V2_TABLES_DIR / "table1_nldi_v2.csv"
    return pd.read_csv(p)


def _load_nldi_json() -> dict:
    p = V2_TABLES_DIR / "exp_nldi_v2.json"
    with open(p, encoding="latin-1") as f:
        return json.load(f)


# ══════════════════════════════════════════════════════
# 样式初始化 (Nature / pom2-pom3 风格)
# ══════════════════════════════════════════════════════

def _init_style():
    """fig1_hero_v3 对标极简风格: 极细线、regular weight、大量留白."""
    plt.rcParams.update({
        "font.size": 7,
        "font.family": FONT_FAMILY,
        "mathtext.default": "regular",
        # 轴
        "axes.labelsize": 7,
        "axes.titlesize": 7,
        "axes.titleweight": "normal",      # hero 图无 bold 标题
        "axes.linewidth": 0.4,              # 极细轴线
        "axes.edgecolor": AXIS_GREY,
        "axes.labelcolor": AXIS_GREY,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": False,
        "axes.labelpad": 2,
        "axes.titlepad": 3,
        # 刻度
        "xtick.labelsize": 6,
        "ytick.labelsize": 6,
        "xtick.color": AXIS_GREY,
        "ytick.color": AXIS_GREY,
        "xtick.major.width": 0.3,
        "ytick.major.width": 0.3,
        "xtick.major.size": 2.0,
        "ytick.major.size": 2.0,
        "xtick.major.pad": 1.5,
        "ytick.major.pad": 1.5,
        "xtick.direction": "out",
        "ytick.direction": "out",
        # 图例
        "legend.fontsize": 5.5,
        "legend.frameon": False,
        "legend.handlelength": 1.0,
        "legend.handletextpad": 0.3,
        "legend.columnspacing": 0.6,
        "legend.labelspacing": 0.2,
        # 线条
        "lines.linewidth": 0.6,
        "lines.markersize": 2,
        # 文字
        "text.color": AXIS_GREY,
        # 保存
        "figure.dpi": FIGURE_DPI,
        "savefig.dpi": FIGURE_DPI,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.03,
        "figure.constrained_layout.use": False,
    })


def _panel_label(ax, label: str, x: float = -0.10, y: float = 1.08):
    """Large bold panel label (A–E), matching pom2 style."""
    ax.text(
        x, y, label,
        transform=ax.transAxes,
        fontsize=11,
        fontweight="bold",
        color=AXIS_GREY,
        va="top", ha="left",
    )


# ══════════════════════════════════════════════════════
# Panel A — PCA scatter
# ══════════════════════════════════════════════════════

def _draw_panel_a(ax, ds: PaperDataset):
    """PCA scatter of pure-tea samples — minimal style."""
    pure_idx = np.where(ds.pure_mask)[0]
    tea_ids_pure = np.array(ds.tea_ids)[pure_idx]

    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    X_pure = ds.X_value[pure_idx]
    baseline = X_pure[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm = X_pure / baseline
    half = T // 2
    X_feat = X_norm[:, half:, :].mean(axis=1)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_feat)
    pca = PCA(n_components=2, random_state=SEED)
    X_pca = pca.fit_transform(X_scaled)
    var1 = pca.explained_variance_ratio_[0] * 100
    var2 = pca.explained_variance_ratio_[1] * 100

    for tid in sorted(set(tea_ids_pure)):
        mask = tea_ids_pure == tid
        raw_name = TEA_ORDER[int(tid[1]) - 1]
        en = TEA_NAME_EN.get(raw_name, tid)
        ax.scatter(
            X_pca[mask, 0], X_pca[mask, 1],
            c=FIG4_TEA_COLORS[tid],
            marker=FIG4_TEA_MARKERS[tid],
            s=10, alpha=0.7, edgecolors="none",
            label=f"{tid} {en}",
        )

    ax.set_xlabel(f"PC1 ({var1:.1f}%)", fontsize=6.5)
    ax.set_ylabel(f"PC2 ({var2:.1f}%)", fontsize=6.5)
    ax.legend(markerscale=1.0, handletextpad=0.2, loc="upper left",
              fontsize=5.5, borderpad=0.3)
    _panel_label(ax, "A")


# ══════════════════════════════════════════════════════
# Panel B — Radar chart
# ══════════════════════════════════════════════════════

def _draw_panel_b(ax, ds: PaperDataset):
    """Radar chart — thin lines, subtle fill, hero-style."""
    pure_idx = np.where(ds.pure_mask)[0]
    tea_ids_pure = np.array(ds.tea_ids)[pure_idx]
    X_pure = ds.X_value[pure_idx]

    T = X_pure.shape[1]
    bl = max(1, T // 10)
    baseline = X_pure[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm = X_pure / baseline
    half = T // 2

    radar_means: dict[str, np.ndarray] = {}
    for tid in sorted(set(tea_ids_pure)):
        mask = tea_ids_pure == tid
        radar_means[tid] = X_norm[mask][:, half:, :].mean(axis=(0, 1))

    ch_labels = [f"CH{i}" for i in range(N_SENSORS)]
    n_ch = len(ch_labels)
    angles = np.linspace(0, 2 * np.pi, n_ch, endpoint=False).tolist()
    angles += angles[:1]

    all_vals = np.concatenate(list(radar_means.values()))
    v_min, v_max = all_vals.min(), all_vals.max()
    margin = (v_max - v_min) * 0.15
    r_min = max(0, np.floor((v_min - margin) / 0.02) * 0.02)
    r_max = np.ceil((v_max + margin) / 0.02) * 0.02

    for tid, vals in sorted(radar_means.items()):
        raw_name = TEA_ORDER[int(tid[1]) - 1]
        en = TEA_NAME_EN.get(raw_name, tid)
        v = list(vals) + [vals[0]]
        ax.plot(angles, v, color=FIG4_TEA_COLORS[tid], linewidth=0.6,
                label=f"{tid} {en}")
        ax.fill(angles, v, color=FIG4_TEA_COLORS[tid], alpha=0.05)

    ax.set_ylim(r_min, r_max)
    yticks = np.linspace(r_min, r_max, 3)
    ax.set_yticks(yticks)
    ax.set_yticklabels([f"{y:.2f}" for y in yticks], size=5.5, color="#888888")
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(ch_labels, size=6)
    ax.spines["polar"].set_linewidth(0.3)
    ax.tick_params(axis="both", width=0.3)
    ax.legend(loc="upper right", bbox_to_anchor=(1.32, 1.08),
              fontsize=5, borderpad=0.2)
    _panel_label(ax, "B", x=-0.18, y=1.12)


# ══════════════════════════════════════════════════════
# Panel C — 2×5 response–ratio curves
# ══════════════════════════════════════════════════════

def _draw_panel_c(axes_flat, ds: PaperDataset, nldi_json: dict,
                   n_rows: int = 2, n_cols: int = 5):
    """10 facet ratio curves — shared axes, edge-only labels."""
    baselines = compute_pure_baselines(ds)
    table1 = nldi_json["table1"]
    combo_order = sorted(
        [row["combo"] for row in table1 if row["combo"] != "Overall"])

    for idx, combo_id in enumerate(combo_order):
        ax = axes_flat[idx]
        row_i, col_j = divmod(idx, n_cols)
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
            ax.plot(ratio_steps, mean_pred, "--", color=PRED_GREY,
                    linewidth=0.4)
            ax.plot(ratio_steps, mean_meas, "-", color=CURVE_TEAL,
                    markersize=0, linewidth=0.5)
            ax.set_title(f"{combo_id}  {nldi_val:.3f}",
                         fontsize=5.5, pad=2)
            ax.set_xlim(-0.02, 1.02)
            if idx == 0:
                ax.legend(["Linear", "Measured"], loc="lower left",
                          fontsize=4.5, handlelength=0.8)
        else:
            ax.set_title(combo_id, fontsize=5.5)

        # 只在边缘显示坐标标签
        if col_j > 0:
            ax.set_yticklabels([])
        if row_i < n_rows - 1:
            ax.set_xticklabels([])
        ax.tick_params(labelsize=5)

    # 共用轴标签
    axes_flat[n_cols].set_ylabel("Response", fontsize=6)
    axes_flat[n_cols * (n_rows - 1) + n_cols // 2].set_xlabel(
        "Blend ratio", fontsize=6)

    _panel_label(axes_flat[0], "C", x=-0.35, y=1.30)


# ══════════════════════════════════════════════════════
# Panel D — 5×5 NLDI 三角热力图
# ══════════════════════════════════════════════════════

def _draw_panel_d(ax, nldi_json: dict):
    """5×5 triangular NLDI heatmap — soft palette, no bold."""
    tea_ids = ["T1", "T2", "T3", "T4", "T5"]
    n = len(tea_ids)
    matrix = np.zeros((n, n))

    table1 = nldi_json["table1"]
    nldi_map = {r["combo"]: r["nldi_mean"] for r in table1
                if r["combo"] != "Overall"}

    for i in range(n):
        for j in range(i + 1, n):
            key = f"{tea_ids[i]}-{tea_ids[j]}"
            val = nldi_map.get(key, 0)
            matrix[i, j] = val
            matrix[j, i] = val

    mask = np.zeros_like(matrix, dtype=bool)
    for i in range(n):
        for j in range(n):
            if j < i:
                mask[i, j] = True

    # 青色系色阶 — 与 hero 图一致
    from matplotlib.colors import LinearSegmentedColormap
    soft_cmap = LinearSegmentedColormap.from_list(
        "soft_teal", ["#F5FBFA", "#D4EDEA", "#7FB7B0", "#4D9085", "#2D5F58"])

    sns.heatmap(
        matrix, annot=True, fmt=".2f", cmap=soft_cmap,
        xticklabels=tea_ids, yticklabels=tea_ids,
        ax=ax, mask=mask,
        linewidths=0.5, linecolor="white",
        annot_kws={"size": 6.5, "color": AXIS_GREY},
        cbar_kws={"shrink": 0.6, "aspect": 10},
        vmin=0, square=True,
    )
    ax.tick_params(labelsize=6.5, length=0)
    _panel_label(ax, "D", x=-0.15, y=1.06)


# ══════════════════════════════════════════════════════
# Panel E — Forest plot
# ══════════════════════════════════════════════════════

def _draw_panel_e(ax, nldi_json: dict):
    """Forest plot — thin bars, small dots, hero-style."""
    table1 = nldi_json["table1"]
    rows = [r for r in table1 if r["combo"] != "Overall"
            and r["bootstrap_ci_lo"] is not None]

    combos = [r["combo"] for r in rows]
    means = [r["nldi_mean"] for r in rows]
    ci_lo = [r["bootstrap_ci_lo"] for r in rows]
    ci_hi = [r["bootstrap_ci_hi"] for r in rows]

    # 按 combo ID 字典序排列 (T1-T2, T1-T3, ..., T4-T5)
    order = sorted(range(len(combos)), key=lambda i: combos[i])

    for i, idx in enumerate(order):
        sig = rows[idx].get("sig", "***")
        color = FOREST_TEAL if sig != "n.s." else "#CCCCCC"
        ax.errorbar(
            means[idx], i,
            xerr=[[means[idx] - ci_lo[idx]], [ci_hi[idx] - means[idx]]],
            fmt="o", color=color, markersize=3.5, capsize=2,
            linewidth=0.8, markeredgewidth=0,
        )

    ax.set_yticks(range(len(combos)))
    ax.set_yticklabels([combos[i] for i in order], fontsize=6)
    ax.axvline(0, color="#CCCCCC", linestyle="--", linewidth=0.4)
    ax.set_xlabel("NLDI (95% Bootstrap CI)", fontsize=6.5)
    ax.invert_yaxis()
    _panel_label(ax, "E", x=-0.30, y=1.06)


# ══════════════════════════════════════════════════════
# 主函数: 5-panel 合图
# ══════════════════════════════════════════════════════

def generate_fig4():
    """生成 Fig 4 合图并保存."""
    print("\n" + "=" * 60)
    print("  Fig 4: Pure-tea characterisation + Non-linear blend")
    print("=" * 60)

    _init_style()

    ds = _load_dataset()
    nldi_json = _load_nldi_json()

    # ── 布局: 3 行 ──
    # Row 1: A (left) + B (right, polar)
    # Row 2: C (full width, 2×5 内嵌)
    # Row 3: D (left) + E (right)
    # 宽度 = 双栏, 高度留足呼吸空间
    fig = plt.figure(figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 1.55))
    gs = gridspec.GridSpec(
        3, 2,
        figure=fig,
        height_ratios=[1.0, 0.75, 1.0],
        width_ratios=[1, 1],
        hspace=0.55,
        wspace=0.40,
    )

    # Panel A — PCA scatter (row 0, col 0)
    ax_a = fig.add_subplot(gs[0, 0])
    _draw_panel_a(ax_a, ds)

    # Panel B — Radar chart (row 0, col 1, polar)
    ax_b = fig.add_subplot(gs[0, 1], polar=True)
    _draw_panel_b(ax_b, ds)

    # Panel C — 2×5 ratio curves (row 1, full width), shared axes
    gs_c = gs[1, :].subgridspec(2, 5, hspace=0.35, wspace=0.12)
    axes_c = [fig.add_subplot(gs_c[r, c]) for r in range(2) for c in range(5)]
    _draw_panel_c(axes_c, ds, nldi_json)

    # Panel D — NLDI heatmap (row 2, col 0)
    ax_d = fig.add_subplot(gs[2, 0])
    _draw_panel_d(ax_d, nldi_json)

    # Panel E — Forest plot (row 2, col 1)
    ax_e = fig.add_subplot(gs[2, 1])
    _draw_panel_e(ax_e, nldi_json)

    # ── 保存 ──
    for d in [V2_FIGURES_DIR, MANUSCRIPT_FIGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    name = "fig4_merged_v2"
    for fmt in ["pdf", "png", "svg"]:
        for out_dir in [V2_FIGURES_DIR, MANUSCRIPT_FIGS_DIR]:
            p = out_dir / f"{name}.{fmt}"
            fig.savefig(p, format=fmt, dpi=FIGURE_DPI, bbox_inches="tight")

    plt.close(fig)
    print(f"\n  ✓ 已保存: {name}.pdf/png/svg")
    print(f"    → {V2_FIGURES_DIR}")
    print(f"    → {MANUSCRIPT_FIGS_DIR}")


# ══════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    generate_fig4()
