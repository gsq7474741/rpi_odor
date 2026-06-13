"""共享设计风格、色板、路径和数据工具。

所有正文/SM 图表脚本共享此模块，确保全局视觉一致性。
色板与 fig1_hero_v3 / FIGURE_PLAN.md §2 保持一致。
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
from matplotlib.colors import LinearSegmentedColormap
from pathlib import Path

from ..config import (
    SEED, N_SENSORS, FONT_SIZE, FONT_FAMILY, FONT_SANS_SERIF,
    FIG_WIDTH_SINGLE, FIG_WIDTH_1_5, FIG_WIDTH_DOUBLE,
    FIGURE_DPI, CACHE_DIR,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN, TEA_MARKERS,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
    EXCLUDED_TEAS,
)
from ..data import PaperDataset


# ═══════════════════════════════════════════════════════════════
# 色板 — 与 hero 图一致的 AI 色板
# ═══════════════════════════════════════════════════════════════

# 主轴色
AXIS_GREY = "#2D2D2D"

# Teal 渐变
TEAL_DEEP = "#4D9085"
TEAL_MID = "#5A9E95"
TEAL_LIGHT = "#7FB7B0"
TEAL_PALE = "#D4EDEA"
TEAL_BG = "#F5FBFA"

# 强调色
PINK_ACCENT = "#E5A1A8"
PINK_LIGHT = "#F5D5D8"

# 茶种色 (与 hero 图一致)
TEA_COLORS: dict[str, str] = {
    "T1": "#E89B3C",   # amber-orange (Oolong)
    "T2": "#A33B2A",   # wine-red (Black)
    "T3": "#6FB58A",   # tea-green (Jasmine)
    "T4": "#3F6FA8",   # deep-blue (XQG Pu-erh)
    "T5": "#C57BA1",   # purple-pink (Dark)
}

TEA_MARKERS_MAP: dict[str, str] = {
    "T1": "o", "T2": "s", "T3": "^", "T4": "D", "T5": "v",
}

# 辅助色
CURVE_TEAL = "#5A9E95"
CURVE_BAND = "#7FB7B0"
PRED_GREY = "#B0B0B0"
FOREST_TEAL = "#4D9085"

# Fig 5 paradigm 色 (按 paradigm 从浅到深, CARL 为青色突出)
CAT_COLORS: dict[str, str] = {
    "Handcrafted":      "#DDD9D4",
    "End-to-end":       "#C5C0BB",
    "Self-supervised":  "#AAA5A0",
    "Comp-supervised":  "#92CFC6",
    "CARL (ours)":      "#4D9085",
}
ABL_TEAL = "#4D9085"
ABL_LIGHT = "#7FB7B0"

# SM 专用色
HIST_TEAL = "#5A9E95"
THRESHOLD_WINE = "#A33B2A"

# 8-channel 颜色 (4 温度组 × 2 传感器, hero 色板派生)
CHANNEL_COLORS = [
    "#E89B3C", "#A33B2A", "#3F6FA8", "#6FB58A",
    "#F0B86E", "#C96B5A", "#6F9DC8", "#9DD3B0",
]

# 10 组合颜色 (scatter / residual, 与 hero 色板协调)
COMBO_PALETTE = [
    "#E89B3C", "#A33B2A", "#6FB58A", "#3F6FA8", "#C57BA1",
    "#7FB7B0", "#D4756A", "#8BA8D4", "#B5D49A", "#9E7EB9",
]


# ═══════════════════════════════════════════════════════════════
# 路径
# ═══════════════════════════════════════════════════════════════

V2_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results" / "v2"
V2_TABLES_DIR = V2_RESULTS_DIR / "tables"
V2_FIGURES_DIR = Path(__file__).resolve().parent / "paper_figure"
MANUSCRIPT_DIR = Path(r"g:\Downloads\机器嗅觉研究\idea\tea_mix\manuscript")
MANUSCRIPT_FIGS_DIR = MANUSCRIPT_DIR / "paper_figure"


# ═══════════════════════════════════════════════════════════════
# Colormap
# ═══════════════════════════════════════════════════════════════

def soft_teal_cmap() -> LinearSegmentedColormap:
    """与正文 Fig 4D 一致的青色系 colormap."""
    return LinearSegmentedColormap.from_list(
        "soft_teal", ["#F5FBFA", "#D4EDEA", "#7FB7B0", "#4D9085", "#2D5F58"])


# ═══════════════════════════════════════════════════════════════
# 样式
# ═══════════════════════════════════════════════════════════════

def init_nature_style(overrides: dict | None = None):
    """Nature/Science 极简风格: 极细线、regular weight、大量留白.

    Parameters
    ----------
    overrides : dict, optional
        额外 rcParams 键值对，覆盖默认值。
        例如 Fig 3 示意图需要 ``{"axes.spines.left": False, "axes.spines.bottom": False}``
    """
    base = {
        "font.size": 7,
        "font.family": FONT_FAMILY,
        "font.sans-serif": FONT_SANS_SERIF,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "mathtext.default": "regular",
        "axes.labelsize": 7,
        "axes.titlesize": 7,
        "axes.titleweight": "normal",
        "axes.linewidth": 0.4,
        "axes.edgecolor": AXIS_GREY,
        "axes.labelcolor": AXIS_GREY,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": False,
        "axes.labelpad": 2,
        "axes.titlepad": 3,
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
        "legend.fontsize": 5.5,
        "legend.frameon": False,
        "legend.handlelength": 1.0,
        "legend.handletextpad": 0.3,
        "legend.columnspacing": 0.6,
        "legend.labelspacing": 0.2,
        "lines.linewidth": 0.6,
        "lines.markersize": 2,
        "text.color": AXIS_GREY,
        "figure.dpi": FIGURE_DPI,
        "savefig.dpi": FIGURE_DPI,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.03,
        "figure.constrained_layout.use": False,
    }
    if overrides:
        base.update(overrides)
    plt.rcParams.update(base)


def panel_label(ax, label: str, x: float = -0.10, y: float = 1.08):
    """粗体 panel label (A–Z)，与正文 Fig 4 一致。"""
    ax.text(x, y, label, transform=ax.transAxes,
            fontsize=11, fontweight="bold", color=AXIS_GREY,
            va="top", ha="left")


# ═══════════════════════════════════════════════════════════════
# 数据加载
# ═══════════════════════════════════════════════════════════════

def load_dataset() -> PaperDataset:
    """加载 v2 boost 数据集 (用于分类/回归等需要 boost 特征的图)。"""
    chosen = CACHE_DIR / "paper_dataset_v2_runs99_101_102_103_104_105_106_108_111_112_cut80s_boost0.10gms0.22j0.30m4g1v0.30_mixA.pkl"
    assert chosen.exists(), f"Dataset not found: {chosen}"
    print(f"  加载数据集: {chosen.name}")
    with open(chosen, "rb") as f:
        return pickle.load(f)


def load_dataset_raw() -> PaperDataset:
    """加载 v1 raw 数据集 (用于 Fig 4 等纯描述性图)。"""
    chosen = CACHE_DIR / "paper_dataset_v1_raw.pkl"
    assert chosen.exists(), f"Dataset not found: {chosen}"
    print(f"  加载数据集: {chosen.name}")
    with open(chosen, "rb") as f:
        return pickle.load(f)


def load_embeddings() -> np.ndarray:
    """加载 v2 CARL embeddings (.npy)."""
    excl_suffix = f"_excl_{'_'.join(sorted(EXCLUDED_TEAS))}" if EXCLUDED_TEAS else ""
    path = CACHE_DIR / f"carl_embeddings_v2{excl_suffix}.npy"
    if not path.exists():
        path = CACHE_DIR / "carl_embeddings_v2.npy"
    assert path.exists(), f"CARL embeddings not found: {path}"
    return np.load(path)


def load_json(name: str) -> dict:
    """加载 v2 结果 JSON。"""
    path = V2_TABLES_DIR / name
    with open(path, encoding="latin-1") as f:
        return json.load(f)


# ═══════════════════════════════════════════════════════════════
# 保存
# ═══════════════════════════════════════════════════════════════

def save_figure(fig, name: str, formats: tuple[str, ...] = ("pdf", "png", "svg", "tiff")):
    """保存到 v2 figures 目录并复制到稿件 paper_figure 目录。

    支持 pdf/png/svg 直接保存；tiff 通过先保存 png 再用 Pillow 转换。
    """
    V2_FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    MANUSCRIPT_FIGS_DIR.mkdir(parents=True, exist_ok=True)
    for fmt in formats:
        for out_dir in [V2_FIGURES_DIR, MANUSCRIPT_FIGS_DIR]:
            out_path = out_dir / f"{name}.{fmt}"
            if fmt == "tiff":
                # Matplotlib 不直接支持 TIFF，先存 PNG 再转换
                from PIL import Image as _PILImage
                _tmp_png = out_dir / f"{name}._tmp.png"
                fig.savefig(_tmp_png, format="png",
                            dpi=FIGURE_DPI, bbox_inches="tight")
                _PILImage.open(_tmp_png).save(out_path, format="TIFF",
                                              compression="tiff_lzw")
                _tmp_png.unlink()
            else:
                fig.savefig(out_path, format=fmt,
                            dpi=FIGURE_DPI, bbox_inches="tight")
    plt.close(fig)
    print(f"    ✓ {name} → {V2_FIGURES_DIR.name} & {MANUSCRIPT_FIGS_DIR.name}")
