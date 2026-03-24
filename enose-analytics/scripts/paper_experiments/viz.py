"""共享可视化工具 — 出版级 matplotlib/seaborn 图表。

所有图表统一样式, 自动保存到 FIGURES_DIR。
"""

from __future__ import annotations

import numpy as np
import matplotlib
matplotlib.use("Agg")  # 无头模式
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
from pathlib import Path

from .config import (
    FIGURES_DIR, FIGURE_DPI, FIGURE_FORMAT, FONT_SIZE, FONT_FAMILY,
    TEA_COLORS, TEA_MARKERS, TEA_IDS, TEA_NAME_EN, TEA_ORDER,
    N_SENSORS, ensure_dirs,
)


# ═══════════════════════════════════════════════════════════════
# 数据预处理
# ═══════════════════════════════════════════════════════════════

def sphereize(X: np.ndarray) -> np.ndarray:
    """球面化: 减去质心 + L2 归一化到单位球面。

    TensorBoard Embedding Projector 的 'Spherize data' 功能,
    将所有点映射到单位超球面上, 降维后呈现更均匀的分布。
    """
    centroid = X.mean(axis=0)
    X_shifted = X - centroid
    norms = np.linalg.norm(X_shifted, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return X_shifted / norms


# ═══════════════════════════════════════════════════════════════
# 全局样式初始化
# ═══════════════════════════════════════════════════════════════

def init_style():
    """设置出版级 matplotlib 样式"""
    plt.rcParams.update({
        "font.size": FONT_SIZE,
        "font.family": FONT_FAMILY,
        "axes.labelsize": FONT_SIZE,
        "axes.titlesize": FONT_SIZE + 1,
        "xtick.labelsize": FONT_SIZE - 1,
        "ytick.labelsize": FONT_SIZE - 1,
        "legend.fontsize": FONT_SIZE - 1,
        "figure.dpi": FIGURE_DPI,
        "savefig.dpi": FIGURE_DPI,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.05,
        "axes.grid": True,
        "grid.alpha": 0.3,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })
    sns.set_palette("colorblind")


def save_fig(fig: plt.Figure, name: str, subdir: str = ""):
    """保存图表到 FIGURES_DIR, 同时生成 pdf 和 png。"""
    ensure_dirs()
    out_dir = FIGURES_DIR / subdir if subdir else FIGURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    for fmt in ["pdf", "png"]:
        path = out_dir / f"{name}.{fmt}"
        fig.savefig(path, format=fmt, dpi=FIGURE_DPI, bbox_inches="tight")

    plt.close(fig)
    print(f"    图表已保存: {name}.pdf/png")


# ═══════════════════════════════════════════════════════════════
# 通用绘图函数
# ═══════════════════════════════════════════════════════════════

def get_tea_color(tea_id: str) -> str:
    """获取茶类颜色"""
    return TEA_COLORS.get(tea_id, "#999999")


def get_tea_marker(tea_id: str) -> str:
    """获取茶类标记"""
    return TEA_MARKERS.get(tea_id, "o")


def plot_pca_scatter(
    pc1: np.ndarray,
    pc2: np.ndarray,
    labels: np.ndarray,
    var_explained: tuple[float, float],
    title: str = "",
    figsize: tuple[float, float] = (5, 4),
) -> plt.Figure:
    """PCA 2D 散点图, 按茶类着色。

    Args:
        pc1, pc2: 主成分坐标
        labels: 茶类 ID 数组 (e.g. 'T1', 'T2', ...)
        var_explained: (PC1方差%, PC2方差%)
    """
    init_style()
    fig, ax = plt.subplots(figsize=figsize)

    unique_labels = sorted(set(labels))
    for label in unique_labels:
        mask = labels == label
        raw_name = TEA_ORDER[int(label[1]) - 1] if label.startswith("T") and label[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, label)
        ax.scatter(
            pc1[mask], pc2[mask],
            c=get_tea_color(label),
            marker=get_tea_marker(label),
            s=30, alpha=0.7, edgecolors="white", linewidth=0.3,
            label=f"{label} {en_name}",
        )

    ax.set_xlabel(f"PC1 ({var_explained[0]:.1f}%)")
    ax.set_ylabel(f"PC2 ({var_explained[1]:.1f}%)")
    if title:
        ax.set_title(title)
    ax.legend(framealpha=0.8, loc="best")
    fig.tight_layout()
    return fig


def plot_radar(
    means: dict[str, np.ndarray],
    channel_labels: list[str] | None = None,
    title: str = "",
    figsize: tuple[float, float] = (5, 5),
) -> plt.Figure:
    """雷达图 — 每种茶的 8 通道均值响应。

    Args:
        means: {tea_id: (8,) 均值数组}
        channel_labels: 通道名称 (默认 CH0-CH7)
    """
    init_style()
    if channel_labels is None:
        channel_labels = [f"CH{i}" for i in range(N_SENSORS)]

    n_ch = len(channel_labels)
    angles = np.linspace(0, 2 * np.pi, n_ch, endpoint=False).tolist()
    angles += angles[:1]  # 闭合

    fig, ax = plt.subplots(figsize=figsize, subplot_kw=dict(polar=True))

    # 计算数据范围, 缩放径轴以放大差异
    all_vals = np.concatenate([v for v in means.values()])
    v_min, v_max = all_vals.min(), all_vals.max()
    margin = (v_max - v_min) * 0.15
    r_min = max(0, v_min - margin)
    r_max = v_max + margin
    # 取整到 0.02 精度
    r_min = np.floor(r_min / 0.02) * 0.02
    r_max = np.ceil(r_max / 0.02) * 0.02

    for tea_id, vals in sorted(means.items()):
        raw_name = TEA_ORDER[int(tea_id[1]) - 1] if tea_id.startswith("T") and tea_id[1].isdigit() else ""
        en_name = TEA_NAME_EN.get(raw_name, tea_id)
        v = list(vals) + [vals[0]]  # 闭合
        ax.plot(angles, v, color=get_tea_color(tea_id), linewidth=1.5,
                label=f"{tea_id} {en_name}")
        ax.fill(angles, v, color=get_tea_color(tea_id), alpha=0.1)

    ax.set_ylim(r_min, r_max)
    n_ticks = 5
    yticks = np.linspace(r_min, r_max, n_ticks + 1)
    ax.set_yticks(yticks)
    ax.set_yticklabels([f"{y:.2f}" for y in yticks], size=FONT_SIZE - 2)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(channel_labels, size=FONT_SIZE - 1)
    if title:
        ax.set_title(title, pad=15)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.1), framealpha=0.8)
    fig.tight_layout()
    return fig


def plot_confusion_matrix(
    cm: np.ndarray,
    class_names: list[str],
    title: str = "",
    figsize: tuple[float, float] = (5, 4),
) -> plt.Figure:
    """混淆矩阵热力图"""
    init_style()
    fig, ax = plt.subplots(figsize=figsize)

    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Blues",
        xticklabels=class_names, yticklabels=class_names,
        ax=ax, cbar_kws={"shrink": 0.8},
    )
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    if title:
        ax.set_title(title)
    fig.tight_layout()
    return fig


def plot_heatmap(
    data: np.ndarray,
    row_labels: list[str],
    col_labels: list[str],
    title: str = "",
    cmap: str = "RdBu_r",
    center: float | None = 0,
    fmt: str = ".3f",
    figsize: tuple[float, float] | None = None,
) -> plt.Figure:
    """通用热力图"""
    init_style()
    if figsize is None:
        figsize = (max(5, len(col_labels) * 0.7), max(3, len(row_labels) * 0.5))

    fig, ax = plt.subplots(figsize=figsize)
    sns.heatmap(
        data, annot=True, fmt=fmt, cmap=cmap, center=center,
        xticklabels=col_labels, yticklabels=row_labels,
        ax=ax, linewidths=0.5,
    )
    if title:
        ax.set_title(title)
    fig.tight_layout()
    return fig


def plot_response_ratio_curves(
    measured: np.ndarray,
    predicted: np.ndarray,
    ratio_steps: np.ndarray,
    combo_label: str,
    channel_labels: list[str] | None = None,
    figsize: tuple[float, float] = (8, 5),
) -> plt.Figure:
    """响应-比例曲线: 实测 vs 线性预测, 8 通道。

    Args:
        measured: (n_ratios, 8) 实测均值
        predicted: (n_ratios, 8) 线性预测
        ratio_steps: (n_ratios,) 比例步
    """
    init_style()
    if channel_labels is None:
        channel_labels = [f"CH{i}" for i in range(N_SENSORS)]

    n_ch = measured.shape[1]
    n_cols = 4
    n_rows = (n_ch + n_cols - 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=figsize, sharex=True)
    axes = axes.flatten()

    for i in range(n_ch):
        ax = axes[i]
        ax.plot(ratio_steps, predicted[:, i], "k--", alpha=0.5, linewidth=1, label="Linear")
        ax.plot(ratio_steps, measured[:, i], "o-", color="#0072B2", markersize=3, linewidth=1.2, label="Measured")
        ax.set_title(channel_labels[i], fontsize=FONT_SIZE - 1)
        ax.set_xlim(-0.05, 1.05)
        if i == 0:
            ax.legend(fontsize=FONT_SIZE - 2)

    # 隐藏多余子图
    for i in range(n_ch, len(axes)):
        axes[i].set_visible(False)

    fig.supxlabel("Blend ratio (tea A fraction)", fontsize=FONT_SIZE)
    fig.supylabel("Sensor response", fontsize=FONT_SIZE)
    fig.suptitle(combo_label, fontsize=FONT_SIZE + 1, y=1.02)
    fig.tight_layout()
    return fig
