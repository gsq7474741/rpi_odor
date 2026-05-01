"""共享可视化工具 — Nature / Science 风格出版级图表。

所有图表统一样式, 自动保存到 FIGURES_DIR。
风格参照: Nature (7-8pt Helvetica, 89/183mm 宽), Science (类似)。
"""

from __future__ import annotations

import numpy as np
import matplotlib
matplotlib.use("Agg")  # 无头模式
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.transforms as mtransforms
import seaborn as sns
from pathlib import Path

from .config import (
    FIGURES_DIR, FIGURE_DPI, FIGURE_FORMAT, FONT_SIZE, FONT_FAMILY, SCALE,
    FIG_WIDTH_SINGLE, FIG_WIDTH_1_5, FIG_WIDTH_DOUBLE,
    TEA_COLORS, TEA_MARKERS, TEA_IDS, TEA_NAME_EN, TEA_ORDER,
    N_SENSORS, ensure_dirs,
)


# ═══════════════════════════════════════════════════════════════
# 数据预处理
# ═══════════════════════════════════════════════════════════════

def sphereize(X: np.ndarray) -> np.ndarray:
    """球面化: 减去质心 + L2 归一化到单位球面。"""
    centroid = X.mean(axis=0)
    X_shifted = X - centroid
    norms = np.linalg.norm(X_shifted, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return X_shifted / norms


# ═══════════════════════════════════════════════════════════════
# 全局样式初始化 (Nature / Science)
# ═══════════════════════════════════════════════════════════════

def init_style():
    """Nature / Science 出版级 matplotlib 样式。

    - Sans-serif 字体 (Helvetica / Arial)
    - 7-8 pt 字号
    - 无网格, 薄边框
    - 紧凑间距
    """
    plt.rcParams.update({
        # 字体
        "font.size": FONT_SIZE,
        "font.family": FONT_FAMILY,
        "mathtext.default": "regular",
        # 轴
        "axes.labelsize": FONT_SIZE,
        "axes.titlesize": FONT_SIZE,
        "axes.titleweight": "bold",
        "axes.linewidth": 0.5,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": False,
        "axes.labelpad": 2,
        "axes.titlepad": 4,
        # 刻度
        "xtick.labelsize": FONT_SIZE - 1,
        "ytick.labelsize": FONT_SIZE - 1,
        "xtick.major.width": 0.5,
        "ytick.major.width": 0.5,
        "xtick.major.size": 2.5,
        "ytick.major.size": 2.5,
        "xtick.major.pad": 1.5,
        "ytick.major.pad": 1.5,
        "xtick.direction": "out",
        "ytick.direction": "out",
        # 图例
        "legend.fontsize": FONT_SIZE - 1,
        "legend.frameon": False,
        "legend.handlelength": 1.2,
        "legend.handletextpad": 0.4,
        "legend.columnspacing": 0.8,
        "legend.labelspacing": 0.3,
        # 线条
        "lines.linewidth": 0.8,
        "lines.markersize": 3,
        # 保存
        "figure.dpi": FIGURE_DPI,
        "savefig.dpi": FIGURE_DPI,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.02,
        "figure.constrained_layout.use": False,
    })
    # 使用更现代的 seaborn 调色板
    sns.set_palette("colorblind")


def panel_label(ax, label: str, x: float = -0.12, y: float = 1.08):
    """在子图左上角添加粗体面板标签 (A, B, C ...)。

    Nature 风格: 大写粗体, 与子图框架对齐。
    """
    ax.text(
        x, y, label,
        transform=ax.transAxes,
        fontsize=FONT_SIZE + 2,
        fontweight="bold",
        va="top", ha="left",
    )


def save_fig(fig: plt.Figure, name: str, subdir: str = ""):
    """保存图表到 FIGURES_DIR, 同时生成 pdf 和 png。"""
    ensure_dirs()
    out_dir = FIGURES_DIR / subdir if subdir else FIGURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    for fmt in ["pdf", "svg", "png"]:
        path = out_dir / f"{name}.{fmt}"
        fig.savefig(path, format=fmt, dpi=FIGURE_DPI, bbox_inches="tight")

    plt.close(fig)
    print(f"    图表已保存: {name}.pdf/svg/png")


# ═══════════════════════════════════════════════════════════════
# 通用绘图函数
# ═══════════════════════════════════════════════════════════════

def get_tea_color(tea_id: str) -> str:
    """获取茶类颜色"""
    return TEA_COLORS.get(tea_id, "#999999")


def get_tea_marker(tea_id: str) -> str:
    """获取茶类标记"""
    return TEA_MARKERS.get(tea_id, "o")


def scatter_tea_on_ax(
    ax, pc1: np.ndarray, pc2: np.ndarray, labels: np.ndarray,
    var_explained: tuple[float, float] | None = None,
    show_legend: bool = True,
    marker_size: float = 12,
):
    """在给定 ax 上绘制茶类 PCA 散点图 (用于多面板组合)。"""
    unique_labels = sorted(set(labels))
    for label in unique_labels:
        mask = labels == label
        raw_name = TEA_ORDER[int(label[1]) - 1] if label.startswith("T") and label[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, label)
        ax.scatter(
            pc1[mask], pc2[mask],
            c=get_tea_color(label),
            marker=get_tea_marker(label),
            s=marker_size, alpha=0.7, edgecolors="white", linewidth=0.3,
            label=f"{label} {en_name}",
        )
    if var_explained:
        ax.set_xlabel(f"PC1 ({var_explained[0]:.1f}%)")
        ax.set_ylabel(f"PC2 ({var_explained[1]:.1f}%)")
    if show_legend:
        ax.legend(markerscale=1.2, handletextpad=0.2)


def plot_pca_scatter(
    pc1: np.ndarray,
    pc2: np.ndarray,
    labels: np.ndarray,
    var_explained: tuple[float, float],
    title: str = "",
    figsize: tuple[float, float] = (FIG_WIDTH_SINGLE, FIG_WIDTH_SINGLE * 0.8),
) -> plt.Figure:
    """PCA 2D 散点图, 按茶类着色。"""
    init_style()
    fig, ax = plt.subplots(figsize=figsize)
    scatter_tea_on_ax(ax, pc1, pc2, labels, var_explained)
    if title:
        ax.set_title(title)
    fig.tight_layout()
    return fig


def radar_tea_on_ax(
    ax, means: dict[str, np.ndarray],
    channel_labels: list[str] | None = None,
    show_legend: bool = True,
):
    """在给定 polar ax 上绘制雷达图 (用于多面板组合)。"""
    if channel_labels is None:
        channel_labels = [f"CH{i}" for i in range(N_SENSORS)]
    n_ch = len(channel_labels)
    angles = np.linspace(0, 2 * np.pi, n_ch, endpoint=False).tolist()
    angles += angles[:1]

    all_vals = np.concatenate([v for v in means.values()])
    v_min, v_max = all_vals.min(), all_vals.max()
    margin = (v_max - v_min) * 0.15
    r_min = max(0, v_min - margin)
    r_max = v_max + margin
    r_min = np.floor(r_min / 0.02) * 0.02
    r_max = np.ceil(r_max / 0.02) * 0.02

    for tea_id, vals in sorted(means.items()):
        raw_name = TEA_ORDER[int(tea_id[1]) - 1] if tea_id.startswith("T") and tea_id[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, tea_id)
        v = list(vals) + [vals[0]]
        ax.plot(angles, v, color=get_tea_color(tea_id), linewidth=0.9,
                label=f"{tea_id} {en_name}")
        ax.fill(angles, v, color=get_tea_color(tea_id), alpha=0.08)

    ax.set_ylim(r_min, r_max)
    yticks = np.linspace(r_min, r_max, 4)
    ax.set_yticks(yticks)
    ax.set_yticklabels([f"{y:.2f}" for y in yticks], size=FONT_SIZE - 1)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(channel_labels, size=FONT_SIZE - 1)
    if show_legend:
        ax.legend(loc="upper right", bbox_to_anchor=(1.35, 1.1))


def plot_radar(
    means: dict[str, np.ndarray],
    channel_labels: list[str] | None = None,
    title: str = "",
    figsize: tuple[float, float] = (FIG_WIDTH_SINGLE, FIG_WIDTH_SINGLE),
) -> plt.Figure:
    """雷达图 — 每种茶的 8 通道均值响应。"""
    init_style()
    fig, ax = plt.subplots(figsize=figsize, subplot_kw=dict(polar=True))
    radar_tea_on_ax(ax, means, channel_labels)
    if title:
        ax.set_title(title, pad=12)
    fig.tight_layout()
    return fig


def confusion_matrix_on_ax(
    ax, cm: np.ndarray, class_names: list[str], title: str = "",
):
    """在给定 ax 上绘制混淆矩阵。"""
    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Blues",
        xticklabels=class_names, yticklabels=class_names,
        ax=ax, cbar=False,
        annot_kws={"size": FONT_SIZE - 1},
        linewidths=0.5, linecolor="white",
    )
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    if title:
        ax.set_title(title)


def plot_confusion_matrix(
    cm: np.ndarray,
    class_names: list[str],
    title: str = "",
    figsize: tuple[float, float] = (FIG_WIDTH_SINGLE * 0.7, FIG_WIDTH_SINGLE * 0.65),
) -> plt.Figure:
    """混淆矩阵热力图"""
    init_style()
    fig, ax = plt.subplots(figsize=figsize)
    confusion_matrix_on_ax(ax, cm, class_names, title)
    fig.tight_layout()
    return fig


def plot_heatmap(
    data: np.ndarray,
    row_labels: list[str],
    col_labels: list[str],
    title: str = "",
    cmap: str = "YlOrRd",
    center: float | None = None,
    fmt: str = ".2f",
    figsize: tuple[float, float] | None = None,
    ax: plt.Axes | None = None,
) -> plt.Figure | None:
    """通用热力图。可传入 ax 用于多面板组合。"""
    init_style()
    own_fig = ax is None
    if own_fig:
        if figsize is None:
            figsize = (max(3.5, len(col_labels) * 0.42), max(2.5, len(row_labels) * 0.32))
        fig, ax = plt.subplots(figsize=figsize)

    sns.heatmap(
        data, annot=True, fmt=fmt, cmap=cmap, center=center,
        xticklabels=col_labels, yticklabels=row_labels,
        ax=ax, linewidths=0.3, linecolor="white",
        annot_kws={"size": FONT_SIZE - 1.5},
        cbar_kws={"shrink": 0.6, "aspect": 15},
    )
    if title:
        ax.set_title(title)
    if own_fig:
        fig.tight_layout()
        return fig
    return None


def ratio_curves_on_ax(
    ax, measured: np.ndarray, predicted: np.ndarray,
    ratio_steps: np.ndarray, combo_label: str,
    show_legend: bool = False,
):
    """在给定 ax 上绘制 8-ch 均值的响应-比例曲线 (用于 2×2 多面板)。

    显示 8 通道均值而不是各通道子图, 以适配 Nature 风格紧凑布局。
    """
    mean_meas = measured.mean(axis=1)   # (n_ratios,)
    mean_pred = predicted.mean(axis=1)
    std_meas = measured.std(axis=1)

    ax.fill_between(ratio_steps, mean_meas - std_meas, mean_meas + std_meas,
                    color="#0072B2", alpha=0.15)
    ax.plot(ratio_steps, mean_pred, "--", color="#555555", linewidth=0.7, label="Linear pred.")
    ax.plot(ratio_steps, mean_meas, "o-", color="#0072B2", markersize=2.5,
            linewidth=0.8, label="Measured")
    ax.set_title(combo_label, fontsize=FONT_SIZE, fontweight="bold")
    ax.set_xlim(-0.02, 1.02)
    if show_legend:
        ax.legend(loc="best")


def plot_response_ratio_curves(
    measured: np.ndarray,
    predicted: np.ndarray,
    ratio_steps: np.ndarray,
    combo_label: str,
    channel_labels: list[str] | None = None,
    figsize: tuple[float, float] = (FIG_WIDTH_SINGLE, FIG_WIDTH_SINGLE * 0.7),
) -> plt.Figure:
    """响应-比例曲线 (8-ch 均值 + 标准差带)。"""
    init_style()
    fig, ax = plt.subplots(figsize=figsize)
    ratio_curves_on_ax(ax, measured, predicted, ratio_steps, combo_label, show_legend=True)
    ax.set_xlabel("Blend ratio (tea A fraction)")
    ax.set_ylabel("Sensor response (8-ch mean)")
    fig.tight_layout()
    return fig
