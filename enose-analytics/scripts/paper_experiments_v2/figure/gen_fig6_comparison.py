"""生成 Fig 6 — CARL 与四种建模范式的量化比较 (4-panel A–D).

Panel A: 分类 accuracy 横向 bar (5 paradigm, CARL 高亮)
Panel B: 回归 R² 横向 bar (CARL 高亮)
Panel C: 消融 Δacc (0 = full CARL)
Panel D: 消融 ΔR²

美术风格与 Fig 4 / fig1_hero_v3 一致:
  极细线 0.3-0.4pt · regular weight · 青色高亮 · 大量留白

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_fig6_comparison
"""

from __future__ import annotations

import re
import warnings
import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

from ._style import (
    AXIS_GREY, CAT_COLORS, ABL_TEAL, ABL_LIGHT,
    init_nature_style, panel_label, save_figure,
    V2_TABLES_DIR,
)
from ..config import FIG_WIDTH_DOUBLE

warnings.filterwarnings("ignore")

# ══════════════════════════════════════════════════════
# 数据加载 & 解析
# ══════════════════════════════════════════════════════

def _parse_mean_sd(s: str) -> tuple[float, float]:
    """'97.5±2.9' → (97.5, 2.9); '—' → (nan, nan)."""
    if s == "—" or pd.isna(s):
        return (np.nan, np.nan)
    m = re.match(r"([\d.]+)±([\d.]+)", str(s))
    if m:
        return float(m.group(1)), float(m.group(2))
    try:
        return float(s), 0.0
    except ValueError:
        return (np.nan, np.nan)


def _load_table2() -> pd.DataFrame:
    df = pd.read_csv(V2_TABLES_DIR / "table2_classification_v2.csv")
    means, sds = [], []
    for v in df["acc"]:
        m, s = _parse_mean_sd(str(v))
        means.append(m)
        sds.append(s)
    df["acc_val"] = means
    df["acc_sd"] = sds
    return df


def _load_table3() -> pd.DataFrame:
    df = pd.read_csv(V2_TABLES_DIR / "table3_regression_v2.csv")
    r2_best = []
    for _, row in df.iterrows():
        svr = row["SVR_r2"] if str(row["SVR_r2"]) != "—" else np.nan
        dml = row["DeepMLP_r2"] if str(row["DeepMLP_r2"]) != "—" else np.nan
        try:
            svr = float(svr)
        except (ValueError, TypeError):
            svr = np.nan
        try:
            dml = float(dml)
        except (ValueError, TypeError):
            dml = np.nan
        r2_best.append(np.nanmax([svr, dml]) if not (np.isnan(svr) and np.isnan(dml)) else np.nan)
    df["r2_best"] = r2_best
    return df


def _load_table4() -> pd.DataFrame:
    return pd.read_csv(V2_TABLES_DIR / "table4_ablation_v2.csv")


# ══════════════════════════════════════════════════════
# 样式
# ══════════════════════════════════════════════════════

def _panel_label(ax, label: str, x: float = -0.10, y: float = 1.08):
    panel_label(ax, label, x=x, y=y)


# ══════════════════════════════════════════════════════
# Panel A — Classification accuracy
# ══════════════════════════════════════════════════════

def _draw_panel_a(ax, df: pd.DataFrame):
    """Horizontal bar: classification accuracy per method."""
    df = df.dropna(subset=["acc_val"]).reset_index(drop=True)
    n = len(df)
    y = np.arange(n)
    colors = [CAT_COLORS.get(row["category"], "#CCCCCC") for _, row in df.iterrows()]

    ax.barh(y, df["acc_val"], height=0.65, color=colors, edgecolor="none")
    ax.errorbar(df["acc_val"], y, xerr=df["acc_sd"],
                fmt="none", ecolor="#888888", elinewidth=0.4, capsize=1.5, capthick=0.3)

    ax.set_yticks(y)
    ax.set_yticklabels(df["representation"], fontsize=5.5)
    ax.set_xlabel("Accuracy (%)", fontsize=6.5)
    ax.set_xlim(65, 102)
    ax.invert_yaxis()

    # 数值标注 (仅 CARL 行)
    for i, row in df.iterrows():
        if row["category"] == "CARL (ours)":
            ax.text(row["acc_val"] + 0.5, i, f'{row["acc_val"]:.1f}',
                    va="center", fontsize=5, color=ABL_TEAL, fontweight="bold")

    _panel_label(ax, "A")


# ══════════════════════════════════════════════════════
# Panel B — Regression R²
# ══════════════════════════════════════════════════════

def _draw_panel_b(ax, df: pd.DataFrame):
    """Horizontal bar: best R² per method."""
    df = df.dropna(subset=["r2_best"]).reset_index(drop=True)
    n = len(df)
    y = np.arange(n)
    colors = [CAT_COLORS.get(row["category"], "#CCCCCC") for _, row in df.iterrows()]

    ax.barh(y, df["r2_best"], height=0.65, color=colors, edgecolor="none")

    ax.set_yticks(y)
    ax.set_yticklabels(df["representation"], fontsize=5.5)
    ax.set_xlabel("R²", fontsize=6.5)
    ax.set_xlim(-0.2, 0.85)
    ax.axvline(0, color="#CCCCCC", linewidth=0.3)
    ax.invert_yaxis()

    for i, row in df.iterrows():
        if row["category"] == "CARL (ours)":
            val = row["r2_best"]
            ax.text(val + 0.01, i, f'{val:.3f}',
                    va="center", fontsize=5, color=ABL_TEAL, fontweight="bold")

    _panel_label(ax, "B")


# ══════════════════════════════════════════════════════
# Panel C — Ablation Δacc
# ══════════════════════════════════════════════════════

def _draw_panel_c(ax, df: pd.DataFrame):
    """ConvNeXt roadmap style: absolute acc bars with CARL (full) as reference."""
    # 排除 CARL-GAP 行 (已在回归主表中讨论, 不属于组件消融)
    df = df[~df["variant"].str.contains("GAP", case=False)].reset_index(drop=True)
    full_row = df[df["variant"] == "CARL (full)"].iloc[0]
    base_acc = float(full_row["cls_ft"])

    # 只保留有 cls_ft 数据的行
    valid = df[df["cls_ft"].apply(
        lambda x: str(x) != "—" and not pd.isna(x))].reset_index(drop=True)
    valid["acc"] = valid["cls_ft"].astype(float)

    labels = list(valid["variant"])
    values = list(valid["acc"])
    n = len(labels)
    y = np.arange(n)

    colors = [ABL_TEAL if lab == "CARL (full)" else ABL_LIGHT for lab in labels]

    ax.barh(y, values, height=0.6, color=colors, edgecolor="none")
    # baseline 参考线
    ax.axvline(base_acc, color=ABL_TEAL, linewidth=0.5, linestyle="--", alpha=0.5)

    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=5.5)
    ax.set_xlabel("Accuracy (%)", fontsize=6.5)
    ax.set_xlim(93, 99.5)
    ax.invert_yaxis()

    # 数值标注在 bar 内部末端
    for i, v in enumerate(values):
        is_full = labels[i] == "CARL (full)"
        ax.text(v - 0.15, i, f'{v:.1f}',
                va="center", ha="right", fontsize=5.5,
                color="white" if is_full else AXIS_GREY,
                fontweight="bold" if is_full else "normal")

    _panel_label(ax, "C")


# ══════════════════════════════════════════════════════
# Panel D — Ablation ΔR²
# ══════════════════════════════════════════════════════

def _draw_panel_d(ax, df: pd.DataFrame):
    """ConvNeXt roadmap style: absolute R² bars with CARL (full) as reference."""
    # 排除 CARL-GAP 行 (已在回归主表中讨论, 不属于组件消融)
    df = df[~df["variant"].str.contains("GAP", case=False)].reset_index(drop=True)
    full_row = df[df["variant"] == "CARL (full)"].iloc[0]
    base_r2 = float(full_row["reg_r2"])

    valid = df[df["reg_r2"].apply(
        lambda x: str(x) != "—" and not pd.isna(x))].reset_index(drop=True)
    valid["r2"] = valid["reg_r2"].astype(float)

    labels = list(valid["variant"])
    values = list(valid["r2"])
    n = len(labels)
    y = np.arange(n)

    colors = [ABL_TEAL if lab == "CARL (full)" else ABL_LIGHT for lab in labels]

    ax.barh(y, values, height=0.6, color=colors, edgecolor="none")
    ax.axvline(base_r2, color=ABL_TEAL, linewidth=0.5, linestyle="--", alpha=0.5)

    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=5.5)
    ax.set_xlabel("R²", fontsize=6.5)
    ax.set_xlim(0.40, 0.75)
    ax.invert_yaxis()

    for i, v in enumerate(values):
        is_full = labels[i] == "CARL (full)"
        ax.text(v - 0.005, i, f'{v:.3f}',
                va="center", ha="right", fontsize=5.5,
                color="white" if is_full else AXIS_GREY,
                fontweight="bold" if is_full else "normal")

    _panel_label(ax, "D")


# ══════════════════════════════════════════════════════
# 主函数
# ══════════════════════════════════════════════════════

def generate_fig6():
    print("\n" + "=" * 60)
    print("  Fig 6: CARL vs. baselines — quantitative comparison")
    print("=" * 60)

    init_nature_style()

    t2 = _load_table2()
    t3 = _load_table3()
    t4 = _load_table4()

    fig = plt.figure(figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.75))
    gs = gridspec.GridSpec(2, 2, figure=fig,
                           height_ratios=[1, 0.55],
                           hspace=0.35, wspace=0.50)

    ax_a = fig.add_subplot(gs[0, 0])
    _draw_panel_a(ax_a, t2)

    ax_b = fig.add_subplot(gs[0, 1])
    _draw_panel_b(ax_b, t3)

    ax_c = fig.add_subplot(gs[1, 0])
    _draw_panel_c(ax_c, t4)

    ax_d = fig.add_subplot(gs[1, 1])
    _draw_panel_d(ax_d, t4)

    save_figure(fig, "fig6_comparison_v2")


if __name__ == "__main__":
    generate_fig6()
