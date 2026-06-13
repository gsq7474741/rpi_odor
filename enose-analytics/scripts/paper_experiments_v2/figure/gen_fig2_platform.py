"""生成 Fig 2 — 自动化电子鼻平台与实验设计。

Panel A: 平台实拍照片 (嵌入外部图片)
Panel B: 传感腔 3D CAD 模型 (嵌入)
Panel C: 传感腔 CFD 流场仿真 (嵌入)
Panel D: 两阶段实验设计流程 (matplotlib 绘制)

布局 (L-shape):
┌── A ──┬── B ──┐
│       ├── C ──┤
│       ├── D ──┤
└───────┴───────┘

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_fig2_platform
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
from PIL import Image

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

from ._style import (
    AXIS_GREY, TEA_COLORS,
    TEAL_DEEP, TEAL_MID, TEAL_LIGHT, TEAL_PALE, TEAL_BG,
    PINK_ACCENT, PINK_LIGHT,
    init_nature_style, panel_label, save_figure,
    MANUSCRIPT_DIR,
)
from ..config import FIG_WIDTH_DOUBLE

warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════════════
# 素材路径
# ═══════════════════════════════════════════════════════════════

MS_FIGURES = MANUSCRIPT_DIR / "elsarticle" / "figures"
IMG_PLATFORM = MS_FIGURES / "enose_system.jpg"
IMG_CHAMBER_3D = MS_FIGURES / "fig0b_chamber_3d.png"
IMG_CHAMBER_CFD = MS_FIGURES / "fig0c_chamber_cfd.png"


# ═══════════════════════════════════════════════════════════════
# 工具
# ═══════════════════════════════════════════════════════════════

def _embed_image(ax: plt.Axes, img_path: Path):
    """将外部图片填充到 Axes, 关闭坐标轴。"""
    img = Image.open(img_path)
    ax.imshow(np.asarray(img))
    ax.set_axis_off()


def _rounded_box(ax, x, y, w, h, fc, ec, lw=0.4, radius=0.02):
    """在数据坐标系画一个圆角矩形。"""
    box = FancyBboxPatch(
        (x, y), w, h,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        facecolor=fc, edgecolor=ec, linewidth=lw,
        transform=ax.transData, zorder=2,
    )
    ax.add_patch(box)
    return box


def _arrow(ax, x0, y0, x1, y1, **kwargs):
    """数据坐标系箭头。"""
    defaults = dict(
        arrowstyle="->,head_width=4,head_length=3",
        color=AXIS_GREY, linewidth=0.8,
        mutation_scale=1,
        connectionstyle="arc3,rad=0",
        zorder=3,
    )
    defaults.update(kwargs)
    arr = FancyArrowPatch((x0, y0), (x1, y1), **defaults)
    ax.add_patch(arr)


# ═══════════════════════════════════════════════════════════════
# Panel D: 两阶段实验设计 (纯 matplotlib)
# ═══════════════════════════════════════════════════════════════

def _draw_panel_d(ax: plt.Axes):
    """绘制两阶段实验设计流程图。

    布局: [Tea Samples] → [Phase 1] → [Combined Dataset]
                        → [Phase 2] →
    """
    ax.set_xlim(-0.3, 10.5)
    ax.set_ylim(-0.5, 4.5)
    ax.set_axis_off()

    tea_ids = ["T1", "T2", "T3", "T4", "T5"]
    tea_colors = [TEA_COLORS[t] for t in tea_ids]

    # ── 左: Tea Samples 框 ──
    ts_x, ts_y, ts_w, ts_h = 0.0, 0.3, 1.8, 3.6
    _rounded_box(ax, ts_x, ts_y, ts_w, ts_h, "#F9F7F4", "#E0DBD3", radius=0.1)
    ax.text(ts_x + ts_w / 2, ts_y + ts_h - 0.45, "Tea Samples", ha="center", va="center",
            fontsize=4.5, fontweight="bold", color=AXIS_GREY)

    for i, (tid, c) in enumerate(zip(tea_ids, tea_colors)):
        cy = ts_y + ts_h - 1.0 - i * 0.55
        ax.plot(ts_x + 0.65, cy, "o", color=c, markersize=5,
                markeredgecolor="white", markeredgewidth=0.3, zorder=5)
        ax.text(ts_x + 0.95, cy, tid, ha="left", va="center",
                fontsize=4, color=AXIS_GREY)

    # ── 中上: Phase 1 框 ──
    p1_x, p1_y, p1_w, p1_h = 2.5, 2.4, 3.5, 1.7
    _rounded_box(ax, p1_x, p1_y, p1_w, p1_h, TEAL_BG, TEAL_LIGHT, radius=0.08)

    ax.text(p1_x + p1_w / 2, p1_y + p1_h - 0.15, "Phase 1",
            fontsize=5, fontweight="bold", color=TEAL_DEEP, ha="center", va="top")
    # 图标行: 5 色圆 + "× 64"
    for i, c in enumerate(tea_colors):
        ax.plot(p1_x + 0.75 + i * 0.35, p1_y + p1_h * 0.5, "o", color=c,
                markersize=3.5, markeredgecolor="white", markeredgewidth=0.2, zorder=5)
    ax.text(p1_x + 2.4, p1_y + p1_h * 0.5, "× 64",
            fontsize=4, color=AXIS_GREY, va="center")
    # n 值行
    ax.text(p1_x + p1_w / 2, p1_y + 0.25, "n = 320",
            fontsize=5.5, fontweight="bold", color=TEAL_DEEP, ha="center", va="center")

    # ── 中下: Phase 2 框 ──
    # 4 行: 标题 | 两圆 + "10 pairs" | 渐变条 + "9 steps" | n值
    p2_x, p2_y, p2_w, p2_h = 2.5, 0.0, 3.5, 2.0
    _rounded_box(ax, p2_x, p2_y, p2_w, p2_h, "#FDF5F5", PINK_LIGHT, radius=0.08)

    ax.text(p2_x + p2_w / 2, p2_y + p2_h - 0.15, "Phase 2",
            fontsize=5, fontweight="bold", color="#A05060", ha="center", va="top")

    # 行2: 两圆 + "10 pairs"
    row2_y = p2_y + p2_h * 0.62
    ax.plot(p2_x + 1.4, row2_y, "o", color=tea_colors[0],
            markersize=3.5, markeredgecolor="white", markeredgewidth=0.2, zorder=5)
    ax.plot(p2_x + 1.7, row2_y, "o", color=tea_colors[1],
            markersize=3.5, markeredgecolor="white", markeredgewidth=0.2, zorder=5)
    ax.text(p2_x + 2.0, row2_y, "10 pairs",
            fontsize=3.5, color=AXIS_GREY, va="center")

    # 行3: 9-step 渐变条
    row3_y = p2_y + p2_h * 0.38
    bar_total_w = p2_w * 0.55
    bar_x0 = p2_x + (p2_w - bar_total_w) / 2
    bar_w = bar_total_w / 9
    for j in range(9):
        frac = j / 8.0
        r = int(232 * (1 - frac) + 163 * frac)
        g = int(155 * (1 - frac) + 59 * frac)
        b = int(60 * (1 - frac) + 42 * frac)
        _rounded_box(ax, bar_x0 + j * bar_w, row3_y - 0.14, bar_w - 0.03, 0.28,
                      f"#{r:02X}{g:02X}{b:02X}", "none", radius=0.02)
    ax.text(p2_x + p2_w / 2, row3_y - 0.3, "9 ratio steps",
            fontsize=3, color="#666666", ha="center")

    # 行4: n 值
    ax.text(p2_x + p2_w / 2, p2_y + 0.2, "n = 370",
            fontsize=5.5, fontweight="bold", color="#A05060", ha="center", va="center")

    # ── 右: Combined Dataset 框 ──
    cd_x, cd_y, cd_w, cd_h = 6.9, 0.7, 3.2, 2.8
    _rounded_box(ax, cd_x, cd_y, cd_w, cd_h, "#F9F7F4", "#E0DBD3", radius=0.1)
    ax.text(cd_x + cd_w / 2, cd_y + cd_h - 0.45, "Combined Dataset",
            fontsize=5, fontweight="bold", color=AXIS_GREY, ha="center", va="top")
    ax.text(cd_x + cd_w / 2, cd_y + cd_h / 2, "n = 690",
            fontsize=9, fontweight="bold", color=AXIS_GREY, ha="center", va="center")
    ax.text(cd_x + cd_w / 2, cd_y + 0.6,
            "multi-session\nrandomised order",
            fontsize=4, color="#666666", ha="center", va="center", linespacing=1.4)

    # ── 连接箭头 ──
    _arrow(ax, ts_x + ts_w + 0.08, 3.0, p1_x - 0.08, p1_y + p1_h / 2)
    _arrow(ax, ts_x + ts_w + 0.08, 1.0, p2_x - 0.08, p2_y + p2_h / 2)
    _arrow(ax, p1_x + p1_w + 0.08, p1_y + p1_h / 2, cd_x - 0.08, cd_y + cd_h * 0.7)
    _arrow(ax, p2_x + p2_w + 0.08, p2_y + p2_h / 2, cd_x - 0.08, cd_y + cd_h * 0.3)


# ═══════════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════════

def generate_fig2():
    """生成 Fig 2: 平台照片 (A/B/C) + 实验设计流程 (D)。"""
    print("\n" + "=" * 60)
    print("  Fig 2: Platform & Experimental Design")
    print("=" * 60)

    init_nature_style({
        "axes.spines.left": False,
        "axes.spines.bottom": False,
    })

    # ── 布局: L-shape ──
    # A 占左列全高, B/C/D 占右列各 1/3
    fig = plt.figure(figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.58))
    gs = gridspec.GridSpec(
        3, 2, figure=fig,
        width_ratios=[1, 1],
        height_ratios=[1, 1, 1.3],
        hspace=0.08, wspace=0.06,
    )

    # Panel A — 平台照片 (左列, 跨 3 行)
    ax_a = fig.add_subplot(gs[:, 0])
    _embed_image(ax_a, IMG_PLATFORM)
    ax_a.text(-0.02, 1.02, "A", transform=ax_a.transAxes,
              fontsize=11, fontweight="bold", color=AXIS_GREY,
              va="top", ha="left",
              bbox=dict(facecolor="white", edgecolor="none", alpha=0.8, pad=1.5))

    # Panel B — CAD 模型 (右上)
    ax_b = fig.add_subplot(gs[0, 1])
    _embed_image(ax_b, IMG_CHAMBER_3D)
    panel_label(ax_b, "B", x=-0.06, y=1.05)

    # Panel C — CFD 仿真 (右中)
    ax_c = fig.add_subplot(gs[1, 1])
    _embed_image(ax_c, IMG_CHAMBER_CFD)
    panel_label(ax_c, "C", x=-0.06, y=1.05)

    # Panel D — 实验设计流程 (右下)
    ax_d = fig.add_subplot(gs[2, 1])
    _draw_panel_d(ax_d)
    panel_label(ax_d, "D", x=-0.06, y=1.05)

    save_figure(fig, "fig2_platform_v2")


if __name__ == "__main__":
    generate_fig2()
