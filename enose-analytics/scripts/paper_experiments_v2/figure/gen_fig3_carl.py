"""生成 Fig 3 — CARL 框架示意图 (3-panel A–C, matplotlib 版).

Panel A: 编码器架构流程图 (全宽)
Panel B: 6 种数据增强示意 (2×3 卡片)
Panel C: 成分感知对比 simplex

美术风格与 Fig 4 / Fig 5 / fig1_hero_v3 一致。

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure.gen_fig3_carl
"""

from __future__ import annotations

import warnings
import numpy as np

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.gridspec as gridspec
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.collections import PatchCollection
from matplotlib.path import Path as MplPath

from ._style import (
    AXIS_GREY, TEAL_DEEP, TEAL_MID, TEAL_LIGHT, TEAL_PALE, TEAL_BG,
    PINK_ACCENT, PINK_LIGHT, TEA_COLORS,
    init_nature_style, panel_label, save_figure,
    V2_FIGURES_DIR, MANUSCRIPT_FIGS_DIR,
)
from ..config import FIG_WIDTH_DOUBLE

warnings.filterwarnings("ignore")

# ══════════════════════════════════════════════════════
# 样式
# ══════════════════════════════════════════════════════

def _init_style():
    init_nature_style({
        "axes.spines.left": False,
        "axes.spines.bottom": False,
        "xtick.major.width": 0,
        "ytick.major.width": 0,
        "savefig.pad_inches": 0.05,
    })


def _panel_label(ax, label: str, x: float = -0.05, y: float = 1.06):
    panel_label(ax, label, x=x, y=y)


# ══════════════════════════════════════════════════════
# 辅助: Panel A 绘图元素
# ══════════════════════════════════════════════════════

# 操作层配色 (淡色系, 与 teal 主题协调)
_OP_COLORS = {
    "Conv1D": "#B5DDD6",   # teal-ish
    "BN":     "#D9EDED",   # very light teal-grey
    "ReLU":   "#E8D5C4",   # warm sand
    "Pool":   "#C8D8E8",   # cool blue-grey
    "SE":     TEAL_PALE,
    "GAP":    "#D4EDEA",
    "FC":     "#C5DDD8",
    "L2":     TEAL_DEEP,
}


def _draw_arrow(ax, x1, y1, x2, y2, color=AXIS_GREY):
    """Draw a thin arrow between two points."""
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="->,head_width=0.06,head_length=0.03",
                                color=color, linewidth=0.4))


def _draw_rounded_poly_arrow(ax, points, color=AXIS_GREY, linewidth=0.5,
                             linestyle="-", radius=0.012, zorder=4):
    pts = np.asarray(points, dtype=float)
    verts = [tuple(pts[0])]
    codes = [MplPath.MOVETO]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        v1 = p1 - p0
        v2 = p2 - p1
        l1 = np.linalg.norm(v1)
        l2 = np.linalg.norm(v2)
        if l1 == 0 or l2 == 0:
            continue
        r = min(radius, l1 * 0.45, l2 * 0.45)
        p_before = p1 - v1 / l1 * r
        p_after = p1 + v2 / l2 * r
        verts.append(tuple(p_before))
        codes.append(MplPath.LINETO)
        verts.append(tuple(p1))
        codes.append(MplPath.CURVE3)
        verts.append(tuple(p_after))
        codes.append(MplPath.CURVE3)
    verts.append(tuple(pts[-1]))
    codes.append(MplPath.LINETO)
    ax.add_patch(mpatches.PathPatch(
        MplPath(verts, codes), fill=False, edgecolor=color,
        linewidth=linewidth, linestyle=linestyle,
        capstyle="round", joinstyle="round", zorder=zorder))
    tail = pts[-2]
    head = pts[-1]
    v = head - tail
    l = np.linalg.norm(v)
    if l > 0:
        start = head - v / l * min(0.018, l * 0.45)
        ax.add_patch(FancyArrowPatch(
            tuple(start), tuple(head),
            arrowstyle="->,head_width=0.04,head_length=0.025",
            color=color, linewidth=linewidth, linestyle=linestyle,
            mutation_scale=1, zorder=zorder + 1))


def _draw_feat_stack(ax, cx, cy, n_layers, fw, fh,
                     color=TEAL_MID, dx=0.003, dy=0.003):
    """Draw 3D-like stacked feature map planes.

    Draws *n_layers* rectangles with (dx, dy) offset each
    to simulate depth. Front layer is at (cx, cy).
    """
    for i in range(n_layers - 1, -1, -1):
        x = cx + i * dx
        y = cy + i * dy
        alpha = 0.25 + 0.55 * (i / max(n_layers - 1, 1))
        rect = mpatches.FancyBboxPatch(
            (x - fw / 2, y - fh / 2), fw, fh,
            boxstyle="round,pad=0.002",
            facecolor=color, edgecolor=TEAL_DEEP,
            linewidth=0.3, alpha=alpha, zorder=3 + i)
        ax.add_patch(rect)


def _draw_op_box(ax, cx, cy, w, h, label, color, fontsize=4.2,
                 text_color=AXIS_GREY, rotation=90):
    """Draw a small colored operation label box (like Conv1D, BN, ReLU)."""
    rect = mpatches.FancyBboxPatch(
        (cx - w / 2, cy - h / 2), w, h,
        boxstyle="round,pad=0.002",
        facecolor=color, edgecolor=AXIS_GREY,
        linewidth=0.3, zorder=5)
    ax.add_patch(rect)
    ax.text(cx, cy, label, ha="center", va="center",
            fontsize=fontsize, color=text_color,
            rotation=rotation, rotation_mode="anchor", zorder=6)


def _draw_op_group(ax, cx, cy, ops, box_w=0.014, box_h=0.07, gap=0.002):
    """Draw a horizontal group of operation label boxes.

    *ops* is a list of (label, color_key) tuples.
    Returns total group width.
    """
    n = len(ops)
    total_w = n * box_w + (n - 1) * gap
    x_start = cx - total_w / 2 + box_w / 2
    for i, (label, ckey) in enumerate(ops):
        x = x_start + i * (box_w + gap)
        _draw_op_box(ax, x, cy, box_w, box_h, label,
                     color=_OP_COLORS.get(ckey, TEAL_PALE))
    return total_w


# ══════════════════════════════════════════════════════
# Panel A — 编码器架构 (3D 特征图 + 操作标签)
# ══════════════════════════════════════════════════════

def _draw_panel_a(ax):
    """Encoder architecture — 2-row layout with SE detail branch."""
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.19, 0.19)
    ax.set_aspect("equal")
    ax.axis("off")

    # ── Row geometry ──
    y1 = 0.08    # top row: conv backbone
    y2 = -0.095  # bottom row: SE detail + projection
    fh = 0.10    # feature map height
    fh2 = 0.08   # smaller feature maps for bottom row
    dim_off = 0.072  # dimension label offset below center
    dim_label_y = y1 - dim_off

    # ──────────────────────────────────────────────────
    # TOP ROW: Input → Conv×3 → feature maps
    # ──────────────────────────────────────────────────

    # Input heatmap tile
    from matplotlib.colors import LinearSegmentedColormap
    np.random.seed(42)
    t_arr = np.linspace(0, 2 * np.pi, 30)
    data = np.zeros((8, 30))
    for ch in range(8):
        phase = ch * 0.3
        amp = 0.5 + 0.5 * np.sin(ch * 0.8)
        data[ch] = 0.85 + amp * 0.15 * np.sin(t_arr + phase)
    cmap = LinearSegmentedColormap.from_list(
        "tile", [TEAL_PALE, TEAL_MID, TEAL_DEEP])
    extent = [0.01, 0.055, y1 - 0.04, y1 + 0.04]
    ax.imshow(data, aspect="auto", extent=extent,
              cmap=cmap, interpolation="bilinear",
              vmin=data.min(), vmax=data.max(), zorder=4)
    ax.text(0.033, dim_label_y + 0.013, "Input",
            ha="center", va="center", fontsize=4.0, color=AXIS_GREY)
    ax.text(0.033, dim_label_y, "8 × T",
            ha="center", va="center", fontsize=4.0, color=AXIS_GREY)

    _draw_arrow(ax, 0.06, y1, 0.078, y1)

    # Conv Block 1: Conv1D(k=7) → BN → ReLU → MaxPool
    _draw_op_group(ax, 0.112, y1,
                   [("Conv1D", "Conv1D"), ("BN", "BN"),
                    ("ReLU", "ReLU"), ("Pool", "Pool")],
                   box_h=0.065)
    ax.text(0.112, y1 + 0.05, "k=7", ha="center", va="bottom",
            fontsize=3.6, color=AXIS_GREY, style="italic")

    _draw_arrow(ax, 0.148, y1, 0.168, y1)

    # Feature maps: 32 × T/2
    _draw_feat_stack(ax, 0.185, y1, 5, fw=0.020, fh=fh,
                     color=TEAL_LIGHT)
    # label centered under the stack (accounting for depth offset)
    ax.text(0.185 + 5 * 0.003 / 2, dim_label_y, "32×T/2",
            ha="center", va="center", fontsize=4.0, color=AXIS_GREY)

    _draw_arrow(ax, 0.208, y1, 0.225, y1)

    # Conv Block 2: Conv1D(k=5) → BN → ReLU → MaxPool
    _draw_op_group(ax, 0.26, y1,
                   [("Conv1D", "Conv1D"), ("BN", "BN"),
                    ("ReLU", "ReLU"), ("Pool", "Pool")],
                   box_h=0.065)
    ax.text(0.26, y1 + 0.05, "k=5", ha="center", va="bottom",
            fontsize=3.6, color=AXIS_GREY, style="italic")

    _draw_arrow(ax, 0.296, y1, 0.316, y1)

    # Feature maps: 64 × T/4
    _draw_feat_stack(ax, 0.335, y1, 7, fw=0.020, fh=fh,
                     color=TEAL_MID)
    ax.text(0.335 + 7 * 0.003 / 2, dim_label_y, "64×T/4",
            ha="center", va="center", fontsize=4.0, color=AXIS_GREY)

    _draw_arrow(ax, 0.362, y1, 0.378, y1)

    # Conv Block 3: Conv1D(k=3) → BN → ReLU
    _draw_op_group(ax, 0.408, y1,
                   [("Conv1D", "Conv1D"), ("BN", "BN"),
                    ("ReLU", "ReLU")],
                   box_h=0.065)
    ax.text(0.408, y1 + 0.05, "k=3", ha="center", va="bottom",
            fontsize=3.6, color=AXIS_GREY, style="italic")

    _draw_arrow(ax, 0.435, y1, 0.455, y1)

    # Feature maps: 128 × T/4 (before SE)
    feat_x = 0.48
    n_feat = 9
    _draw_feat_stack(ax, feat_x, y1, n_feat, fw=0.022, fh=fh,
                     color=TEAL_DEEP)
    # label right-aligned after the stack to avoid overlap
    stack_right = feat_x + (n_feat - 1) * 0.003 + 0.022 / 2
    ax.text(stack_right + 0.008, dim_label_y, "128×T/4",
            ha="left", va="center", fontsize=4.0, color=AXIS_GREY)

    # ── "Feature Extraction Backbone" bracket ──
    brace_y = y1 + 0.086
    brace_left = 0.01
    brace_right = stack_right + 0.005
    # horizontal line with small vertical ticks
    ax.plot([brace_left, brace_right], [brace_y, brace_y],
            color=AXIS_GREY, linewidth=0.4, clip_on=False)
    tick_h = 0.006
    ax.plot([brace_left, brace_left],
            [brace_y - tick_h, brace_y], color=AXIS_GREY, lw=0.4)
    ax.plot([brace_right, brace_right],
            [brace_y - tick_h, brace_y], color=AXIS_GREY, lw=0.4)
    ax.text((brace_left + brace_right) / 2, brace_y + 0.004,
            "Feature Extraction Backbone",
            ha="center", va="bottom", fontsize=5.1, color=AXIS_GREY,
            style="italic")

    # ── Upper-right: 128-d embedding vector visualization ──
    emb_cx = 0.790
    emb_cy = y1 + 0.03
    emb_w = 0.22
    emb_h = 0.038
    # Generate a plausible-looking embedding (seeded)
    rng = np.random.RandomState(7)
    emb_data = np.zeros(128)
    for _pk in [15, 42, 78, 105]:
        emb_data += rng.uniform(0.3, 1.0) * np.exp(
            -0.5 * ((np.arange(128) - _pk) / 6) ** 2)
    emb_data += rng.randn(128) * 0.08
    emb_data /= np.linalg.norm(emb_data)  # L2 normalize
    emb_extent = [emb_cx - emb_w / 2, emb_cx + emb_w / 2,
                  emb_cy - emb_h / 2, emb_cy + emb_h / 2]
    ax.imshow(emb_data.reshape(1, -1), aspect="auto", extent=emb_extent,
              cmap=LinearSegmentedColormap.from_list(
                  "emb", ["white", TEAL_LIGHT, TEAL_MID, TEAL_DEEP]),
              interpolation="bilinear", zorder=4)
    # thin border
    ax.add_patch(mpatches.Rectangle(
        (emb_extent[0], emb_extent[2]),
        emb_w, emb_h, fill=False,
        edgecolor=TEAL_DEEP, linewidth=0.4, zorder=5))
    ax.text(emb_cx, emb_cy - emb_h / 2 - 0.006,
            "output embedding (128-d, L₂-normalized)",
            ha="center", va="top", fontsize=3.8,
            color=AXIS_GREY, style="italic")

    # ──────────────────────────────────────────────────
    # VERTICAL CONNECTOR: top row → SE detail (bottom row)
    # ──────────────────────────────────────────────────

    conn_x = feat_x + 0.012

    # ──────────────────────────────────────────────────
    # BOTTOM ROW: SE internal detail + GAP + Projector
    # ──────────────────────────────────────────────────

    # ── SE Block expanded detail (dashed box) ──
    se_left = 0.005
    se_right = 0.56
    se_top = y2 + 0.055
    se_bot = y2 - 0.058
    se_dashed = mpatches.FancyBboxPatch(
        (se_left, se_bot), se_right - se_left, se_top - se_bot,
        boxstyle="round,pad=0.006",
        facecolor="#F8FDFC", edgecolor=TEAL_MID,
        linewidth=0.5, linestyle=(0, (4, 2)), zorder=2)
    ax.add_patch(se_dashed)
    ax.text((se_left + se_right) / 2, se_top + 0.004, "SE Block (r=4)",
            fontsize=4.0, color=TEAL_DEEP, va="center", ha="center",
            style="italic", zorder=3,
            bbox=dict(facecolor="#F8FDFC", edgecolor="none", pad=0.15))

    # ── Input feature stack at the left of the SE block ──
    se_in_x = 0.025
    se_in_layers = 5
    se_in_dx = 0.002
    se_in_fw = 0.014
    _draw_feat_stack(ax, se_in_x, y2, se_in_layers,
                     fw=se_in_fw, fh=fh2, color=TEAL_DEEP,
                     dx=se_in_dx, dy=0.002)
    se_in_right = se_in_x + (se_in_layers - 1) * se_in_dx + se_in_fw / 2

    _draw_rounded_poly_arrow(
        ax,
        [(conn_x, y1 - fh / 2 - 0.005),
         (conn_x, se_top + 0.022),
         (se_in_x + 0.008, se_top + 0.022),
         (se_in_x + 0.008, y2 + fh2 / 2 + 0.003)],
        color=AXIS_GREY, linewidth=0.5, radius=0.010, zorder=4)

    # Arrow from input stack → GAP squeeze
    _draw_arrow(ax, se_in_right + 0.005, y2, 0.100 - 0.019, y2)

    # Squeeze: GAP_sq
    sq_x = 0.100
    gap_sq = plt.Circle((sq_x, y2), 0.018,
                         facecolor="white", edgecolor=TEAL_DEEP,
                         linewidth=0.4, zorder=5)
    ax.add_patch(gap_sq)
    ax.text(sq_x, y2, "GAP", ha="center", va="center",
            fontsize=4.1, color=AXIS_GREY, zorder=6)
    ax.text(sq_x, y2 - 0.03, "squeeze", ha="center", va="top",
            fontsize=3.3, color=TEAL_DEEP, style="italic")

    _draw_arrow(ax, sq_x + 0.019, y2, 0.140, y2)

    # FC (128→32)
    fc1_x = 0.155
    _draw_op_box(ax, fc1_x, y2, 0.021, 0.052, "FC", _OP_COLORS["FC"],
                 fontsize=4.2)
    ax.text(fc1_x, y2 - 0.040, "128→32", ha="center", va="top",
            fontsize=3.3, color=AXIS_GREY)

    _draw_arrow(ax, fc1_x + 0.012, y2, 0.185, y2)

    # ReLU
    relu_x = 0.198
    _draw_op_box(ax, relu_x, y2, 0.021, 0.052, "ReLU", _OP_COLORS["ReLU"],
                 fontsize=4.2)

    _draw_arrow(ax, relu_x + 0.012, y2, 0.230, y2)

    # FC (32→128)
    fc2_x = 0.245
    _draw_op_box(ax, fc2_x, y2, 0.021, 0.052, "FC", _OP_COLORS["FC"],
                 fontsize=4.2)
    ax.text(fc2_x, y2 - 0.040, "32→128", ha="center", va="top",
            fontsize=3.3, color=AXIS_GREY)

    _draw_arrow(ax, fc2_x + 0.012, y2, 0.277, y2)

    # Sigmoid
    sig_x = 0.293
    sig_c = plt.Circle((sig_x, y2), 0.016,
                        facecolor="#F5E0E3", edgecolor=AXIS_GREY,
                        linewidth=0.3, zorder=5)
    ax.add_patch(sig_c)
    ax.text(sig_x, y2, "σ", ha="center", va="center",
            fontsize=5.6, color=AXIS_GREY, zorder=6)

    _draw_arrow(ax, sig_x + 0.017, y2, 0.335, y2)

    # Channel weights vector
    cw_x = 0.343
    cw_bar = mpatches.FancyBboxPatch(
        (cw_x, y2 - 0.029), 0.012, 0.058,
        boxstyle="round,pad=0.002",
        facecolor=TEAL_MID, edgecolor=TEAL_DEEP,
        linewidth=0.3, alpha=0.6, zorder=4)
    ax.add_patch(cw_bar)

    _draw_arrow(ax, cw_x + 0.014, y2, 0.375, y2)

    # ⊗ Multiply
    mul_x = 0.390
    mul_c = plt.Circle((mul_x, y2), 0.016,
                        facecolor="white", edgecolor=AXIS_GREY,
                        linewidth=0.4, zorder=5)
    ax.add_patch(mul_c)
    ax.text(mul_x, y2, "⊗", ha="center", va="center",
            fontsize=6.2, color=AXIS_GREY, zorder=6)
    ax.text(mul_x, y2 - 0.03, "scale", ha="center", va="top",
            fontsize=3.3, color=AXIS_GREY, style="italic")

    _draw_rounded_poly_arrow(
        ax,
        [(se_in_x + 0.008, y2 + fh2 / 2 + 0.002),
         (se_in_x + 0.008, y2 + 0.043),
         (mul_x, y2 + 0.043),
         (mul_x, y2 + 0.017)],
        color=TEAL_DEEP, linewidth=0.6, linestyle=(0, (3, 2)),
        radius=0.010, zorder=4)

    _draw_arrow(ax, mul_x + 0.019, y2, 0.470, y2)

    # Reweighted feature maps: 128 × T/4
    re_feat_x = 0.487
    re_feat_layers = 8
    re_feat_dy = 0.0025
    re_feat_y = y2 - (re_feat_layers - 1) * re_feat_dy / 2
    _draw_feat_stack(ax, re_feat_x, re_feat_y, re_feat_layers,
                     fw=0.017, fh=fh2,
                     color=TEAL_DEEP, dx=0.0025, dy=re_feat_dy)

    # ── End of SE dashed box, continue rightward ──

    _draw_arrow(ax, re_feat_x + re_feat_layers * 0.0025 + 0.012,
                y2, 0.622, y2)

    # ── GAP (global) ──
    gap_x = 0.648
    gap_c = plt.Circle((gap_x, y2), 0.020,
                        facecolor="white", edgecolor=TEAL_DEEP,
                        linewidth=0.5, zorder=5)
    ax.add_patch(gap_c)
    ax.text(gap_x, y2, "GAP", ha="center", va="center",
            fontsize=4.3, color=AXIS_GREY, zorder=6)

    _draw_arrow(ax, gap_x + 0.023, y2, 0.695, y2)

    # ── 128-d vector ──
    vec_x = 0.705
    vec_bar = mpatches.FancyBboxPatch(
        (vec_x, y2 - 0.032), 0.013, 0.064,
        boxstyle="round,pad=0.002",
        facecolor=TEAL_MID, edgecolor=TEAL_DEEP,
        linewidth=0.3, alpha=0.7, zorder=4)
    ax.add_patch(vec_bar)
    ax.text(vec_x + 0.0065, y2 - 0.052, "128", ha="center", va="top",
            fontsize=3.7, color=AXIS_GREY)

    _draw_arrow(ax, vec_x + 0.018, y2, 0.748, y2)

    # ── Projector: FC → ReLU → FC ──
    proj_x = 0.780
    _draw_op_group(ax, proj_x, y2,
                   [("FC", "FC"), ("ReLU", "ReLU"), ("FC", "FC")],
                   box_w=0.016, box_h=0.054, gap=0.003)

    # Projector label with bracket
    proj_half = (3 * 0.016 + 2 * 0.003) / 2
    br_l = proj_x - proj_half - 0.002
    br_r = proj_x + proj_half + 0.002
    br_y = y2 + 0.04
    ax.plot([br_l, br_l, br_r, br_r],
            [br_y - 0.004, br_y, br_y, br_y - 0.004],
            color=AXIS_GREY, linewidth=0.35, clip_on=False)
    ax.text(proj_x, br_y + 0.003, "Projector",
            ha="center", va="bottom", fontsize=4.3, color=AXIS_GREY)

    _draw_arrow(ax, proj_x + proj_half + 0.005, y2,
                proj_x + proj_half + 0.022, y2)

    # ── 128-d vector after proj ──
    vec2_x = proj_x + proj_half + 0.028
    vec2_bar = mpatches.FancyBboxPatch(
        (vec2_x, y2 - 0.027), 0.013, 0.054,
        boxstyle="round,pad=0.002",
        facecolor=TEAL_DEEP, edgecolor="white",
        linewidth=0.3, alpha=0.7, zorder=4)
    ax.add_patch(vec2_bar)

    _draw_arrow(ax, vec2_x + 0.017, y2, vec2_x + 0.038, y2)

    # ── L2 norm ──
    l2_x = vec2_x + 0.050
    l2_c = plt.Circle((l2_x, y2), 0.016,
                       facecolor=TEAL_DEEP, edgecolor="white",
                       linewidth=0.4, zorder=5)
    ax.add_patch(l2_c)
    ax.text(l2_x, y2, "ℓ₂", ha="center", va="center",
            fontsize=4.5, color="white", zorder=6)

    _draw_arrow(ax, l2_x + 0.019, y2, l2_x + 0.047, y2)

    # ── Output embedding ──
    out_x = l2_x + 0.052
    out_w = 0.013
    out_h = 0.054
    out_bar = mpatches.FancyBboxPatch(
        (out_x, y2 - out_h / 2), out_w, out_h,
        boxstyle="round,pad=0.002",
        facecolor=TEAL_DEEP, edgecolor="white",
        linewidth=0.3, alpha=0.85, zorder=4)
    ax.add_patch(out_bar)
    ax.text(out_x + out_w / 2, y2 - 0.050, "128-d\nembed", ha="center", va="top",
            fontsize=4.0, color=AXIS_GREY)

    # ── Magnifying connection from 128-d embed to upper-right heatmap ──
    ax.plot([out_x, emb_cx - emb_w / 2 + 0.002],
            [y2 + out_h / 2 + 0.002, emb_cy - emb_h / 2 - 0.002],
            color=TEAL_MID, linewidth=0.5, linestyle=(0, (3, 2)), zorder=3, alpha=0.7)
    ax.plot([out_x + out_w, emb_cx + emb_w / 2 - 0.002],
            [y2 + out_h / 2 + 0.002, emb_cy - emb_h / 2 - 0.002],
            color=TEAL_MID, linewidth=0.5, linestyle=(0, (3, 2)), zorder=3, alpha=0.7)

    # ── "Projection Head" module label ──
    ph_left = gap_x - 0.022
    ph_right = out_x + 0.015
    ph_y = y2 + 0.072
    ax.plot([ph_left, ph_left, ph_right, ph_right],
            [ph_y - 0.004, ph_y, ph_y, ph_y - 0.004],
            color=AXIS_GREY, linewidth=0.35, clip_on=False)
    ax.text((ph_left + ph_right) / 2, ph_y + 0.004,
            "Projection Head", ha="center", va="bottom",
            fontsize=4.3, color=AXIS_GREY, style="italic")

    _panel_label(ax, "A", x=-0.02, y=1.08)


# ══════════════════════════════════════════════════════
# Panel B — 数据增强卡片
# ══════════════════════════════════════════════════════

def _make_enose_signal():
    """Generate a realistic e-nose response waveform.

    Typical MOS gas sensor response:
      baseline → rapid adsorption rise → plateau → gas off → slow desorption decay
    """
    N = 160
    t = np.linspace(0, 1, N)

    # Phase boundaries (fraction of total time)
    t_on = 0.15     # gas on
    t_peak = 0.35   # peak / plateau start
    t_off = 0.55    # gas off
    t_end = 1.0

    y = np.zeros(N)
    baseline = 0.20
    peak = 0.85

    for i, ti in enumerate(t):
        if ti < t_on:
            # baseline
            y[i] = baseline
        elif ti < t_peak:
            # rapid rise (1 - exp(-k*t)) shape
            frac = (ti - t_on) / (t_peak - t_on)
            y[i] = baseline + (peak - baseline) * (1 - np.exp(-4.0 * frac))
        elif ti < t_off:
            # plateau with slight drift up
            frac = (ti - t_peak) / (t_off - t_peak)
            y[i] = peak + 0.03 * frac
        else:
            # exponential decay back toward baseline
            frac = (ti - t_off) / (t_end - t_off)
            plateau_end = peak + 0.03
            y[i] = baseline + (plateau_end - baseline) * np.exp(-3.0 * frac)

    return t, y


def _draw_aug_card(ax, title, orig_t, orig_y, aug_t, aug_y,
                   highlight_region=None, highlight_color=None):
    """Draw a single augmentation card: original (grey, top) → augmented (teal, bottom)."""
    ax.set_xlim(orig_t[0], orig_t[-1])
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(True)
        spine.set_linewidth(0.3)
        spine.set_color("#DDDDDD")

    ax.set_facecolor(TEAL_BG)

    # vertical extent: stack original on top, augmented on bottom
    gap = 0.10
    y_max = max(orig_y.max(), aug_y.max())

    orig_shifted = orig_y + y_max + gap
    aug_shifted = aug_y

    full_max = orig_shifted.max() + 0.08
    full_min = aug_shifted.min() - 0.08
    ax.set_ylim(full_min, full_max)

    # separator line
    mid_y = (orig_shifted.min() + aug_shifted.max()) / 2
    ax.axhline(mid_y, color="#DDDDDD", linewidth=0.3, linestyle=":")

    # original signal (grey, upper)
    ax.plot(orig_t, orig_shifted, color="#BBBBBB", linewidth=0.5, alpha=0.7)

    # augmented signal (teal, lower)
    ax.plot(aug_t, aug_shifted, color=TEAL_DEEP, linewidth=0.6)

    # highlight region if specified
    if highlight_region is not None:
        hl_start, hl_end = highlight_region
        color = highlight_color or PINK_LIGHT
        ax.axvspan(hl_start, hl_end, ymin=0, ymax=0.48,
                   alpha=0.25, color=color, zorder=0)

    # down-arrow between the two
    arr_x = orig_t[len(orig_t) // 2]
    ax.annotate("", xy=(arr_x, mid_y - 0.03),
                xytext=(arr_x, mid_y + 0.03),
                arrowprops=dict(arrowstyle="->", color=AXIS_GREY,
                                linewidth=0.4))

    ax.set_title(title, fontsize=5.5, pad=2, color=AXIS_GREY)


def _draw_panel_b(axes):
    """6 augmentation cards in 2×3 grid with realistic e-nose waveform."""
    t, y = _make_enose_signal()

    # 1. Time Shift (±15%)
    shift = int(0.15 * len(t))
    aug_y1 = np.roll(y, shift)
    # pad the rolled-in region with edge value
    aug_y1[:shift] = y[0]
    _draw_aug_card(axes[0], "Time Shift (±15%)", t, y, t, aug_y1)

    # 2. Time Warp (compress first half → rise happens earlier)
    anchor = len(t) * 3 // 5
    t_warp = np.copy(t)
    t_warp[:anchor] = t[:anchor] * 0.55  # compress first 60% → squish baseline+rise
    t_warp[anchor:] = t_warp[anchor - 1] + (t[anchor:] - t[anchor - 1])
    t_warp = t_warp / t_warp[-1] * t[-1]
    aug_y2 = np.interp(t, t_warp, y)
    _draw_aug_card(axes[1], "Time Warp", t, y, t, aug_y2)

    # 3. Gaussian Noise (σ ≤ 0.05)
    np.random.seed(7)
    aug_y3 = y + np.random.randn(len(y)) * 0.04
    _draw_aug_card(axes[2], "Gaussian Noise", t, y, t, aug_y3)

    # 4. Amplitude Scaling (×0.75–1.25 per channel)
    aug_y4 = y * 0.55
    _draw_aug_card(axes[3], "Amp. Scaling", t, y, t, aug_y4)

    # 5. Channel Dropout (whole channel → 0)
    dropped = np.zeros_like(y)
    _draw_aug_card(axes[4], "Channel Dropout", t, y, t, dropped,
                   highlight_region=(t[0], t[-1]),
                   highlight_color=PINK_LIGHT)

    # 6. Temporal Cutout (10–20% → 0)
    aug_y6 = np.copy(y)
    cut_start = int(len(t) * 0.30)
    cut_end = int(len(t) * 0.48)
    aug_y6[cut_start:cut_end] = 0.0
    _draw_aug_card(axes[5], "Temporal Cutout", t, y, t, aug_y6,
                   highlight_region=(t[cut_start], t[cut_end]),
                   highlight_color=PINK_LIGHT)

    _panel_label(axes[0], "B", x=-0.20, y=1.20)


# ══════════════════════════════════════════════════════
# Panel C — 成分感知对比 simplex
# ══════════════════════════════════════════════════════

def _draw_panel_c(ax):
    """Composition-aware contrastive learning in embedding space.

    展示 5 种纯茶簇 + 二元混合样位于两亲本之间 → attract / repel 箭头。
    准确反映本文：二元混合 + 纯样和混合样都参与对比学习。
    """
    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.set_aspect("equal")
    ax.axis("off")


    # ── 5 种纯茶在 embedding 空间的概念位置 ──
    # 散开到四角+底部中央, 留出中间区域给混合样
    pure_pos = {
        "T1": np.array([0.10, 0.90]),
        "T2": np.array([0.90, 0.90]),
        "T3": np.array([0.05, 0.22]),
        "T4": np.array([0.95, 0.22]),
        "T5": np.array([0.50, 0.05]),
    }
    # 标签偏移 (避让混合样区域)
    label_off = {
        "T1": (-0.06, 0.00),
        "T2": (0.06, 0.00),
        "T3": (-0.06, -0.01),
        "T4": (0.06, -0.01),
        "T5": (0.00, -0.06),
    }

    np.random.seed(42)

    # 画纯茶小簇 (3 个散点 + 中心点 + 标签)
    for tid, center in pure_pos.items():
        color = TEA_COLORS[tid]
        offsets = np.random.randn(3, 2) * 0.022
        for off in offsets:
            ax.plot(*(center + off), "o", color=color, markersize=2.5,
                    alpha=0.35, zorder=3)
        ax.plot(*center, "o", color=color, markersize=6, zorder=5,
                markeredgecolor="white", markeredgewidth=0.4)
        lx, ly = label_off[tid]
        ha = "right" if lx < 0 else ("left" if lx > 0 else "center")
        va = "center" if ly == 0 else ("top" if ly < 0 else "bottom")
        ax.text(center[0] + lx, center[1] + ly, tid,
                ha=ha, va=va, fontsize=6,
                color=color, fontweight="bold")

    # ── 多组二元混合样 (菱形), 分布在中间区域 ──
    # 用灰色小菱形做背景混合样, 关键示例用大菱形
    bg_blends = [
        # T1-T3 系列
        (0.35 * pure_pos["T1"] + 0.65 * pure_pos["T3"] + np.array([0.02, 0.01])),
        (0.60 * pure_pos["T1"] + 0.40 * pure_pos["T3"] + np.array([-0.01, 0.03])),
        # T2-T4 系列
        (0.45 * pure_pos["T2"] + 0.55 * pure_pos["T4"] + np.array([0.01, -0.01])),
        (0.70 * pure_pos["T2"] + 0.30 * pure_pos["T4"] + np.array([-0.02, 0.02])),
        # T1-T5 系列
        (0.40 * pure_pos["T1"] + 0.60 * pure_pos["T5"] + np.array([0.03, 0.02])),
        # T3-T5 系列
        (0.55 * pure_pos["T3"] + 0.45 * pure_pos["T5"] + np.array([0.00, 0.03])),
        # T4-T5 系列
        (0.50 * pure_pos["T4"] + 0.50 * pure_pos["T5"] + np.array([-0.01, 0.02])),
        # T2-T5 系列
        (0.35 * pure_pos["T2"] + 0.65 * pure_pos["T5"] + np.array([0.02, 0.01])),
    ]
    for bp in bg_blends:
        ax.plot(*bp, "D", color="#BBBBBB", markersize=3.5, zorder=3, alpha=0.45)

    # ── 关键混合样对: T1-T2 (成分相似 → attract) ──
    c_t1, c_t2 = pure_pos["T1"], pure_pos["T2"]
    blend_a = 0.60 * c_t1 + 0.40 * c_t2 + np.array([-0.06, -0.05])
    blend_b = 0.50 * c_t1 + 0.50 * c_t2 + np.array([0.06, -0.05])

    # ── 关键混合样: T3-T4 (与 T1-T2 混合成分远 → repel) ──
    c_t3, c_t4 = pure_pos["T3"], pure_pos["T4"]
    blend_c = 0.50 * c_t3 + 0.50 * c_t4 + np.array([0.00, 0.06])

    # 按成分比例混色
    def _mix_color(ratios_dict):
        """Mix TEA_COLORS by composition ratios in RGB space."""
        r, g, b = 0.0, 0.0, 0.0
        total = sum(ratios_dict.values())
        for tid, ratio in ratios_dict.items():
            hex_c = TEA_COLORS[tid].lstrip("#")
            w = ratio / total
            r += w * int(hex_c[0:2], 16) / 255.0
            g += w * int(hex_c[2:4], 16) / 255.0
            b += w * int(hex_c[4:6], 16) / 255.0
        return (r, g, b)

    comp_a = {"T1": 60, "T2": 40}
    comp_b = {"T1": 50, "T2": 50}
    comp_c = {"T3": 50, "T4": 50}

    # 画关键混合样 (大菱形, 颜色由成分混合)
    ax.plot(*blend_a, "D", color=_mix_color(comp_a), markersize=6, zorder=6,
            markeredgecolor="white", markeredgewidth=0.4)
    ax.plot(*blend_b, "D", color=_mix_color(comp_b), markersize=6, zorder=6,
            markeredgecolor="white", markeredgewidth=0.4)
    ax.plot(*blend_c, "D", color=_mix_color(comp_c), markersize=6, zorder=6,
            markeredgecolor="white", markeredgewidth=0.4)

    # 比例条
    def _ratio_bar(pos, ratios_dict, bar_w=0.07):
        bar_y = pos[1] - 0.065
        bar_x = pos[0] - bar_w / 2
        x_cur = bar_x
        total = sum(ratios_dict.values())
        for tid, r in ratios_dict.items():
            seg_w = bar_w * r / total
            rect = mpatches.Rectangle(
                (x_cur, bar_y), seg_w, 0.012,
                facecolor=TEA_COLORS[tid], edgecolor="none", alpha=0.8)
            ax.add_patch(rect)
            x_cur += seg_w

    _ratio_bar(blend_a, comp_a)
    _ratio_bar(blend_b, comp_b)
    _ratio_bar(blend_c, comp_c)

    # ── Pull arrow (solid, black) ──
    ax.annotate("", xy=blend_b, xytext=blend_a,
                arrowprops=dict(arrowstyle="<->",
                                color=AXIS_GREY, linewidth=1.0,
                                connectionstyle="arc3,rad=-0.15"))
    mid_ab = (blend_a + blend_b) / 2
    ax.text(mid_ab[0], mid_ab[1] + 0.05,
            "pull", fontsize=5.5, color=AXIS_GREY, style="italic",
            ha="center")

    # ── Push arrow (dashed, black) ──
    ax.annotate("", xy=blend_c, xytext=blend_b,
                arrowprops=dict(arrowstyle="<->",
                                color=AXIS_GREY, linewidth=0.7,
                                linestyle="dashed",
                                connectionstyle="arc3,rad=0.15"))
    mid_bc = (blend_b + blend_c) / 2
    ax.text(mid_bc[0] + 0.025, mid_bc[1] + 0.03,
            "push", fontsize=5.5, color=AXIS_GREY, style="italic",
            ha="left")

    # ── 标题 ──
    ax.text(0.50, 1.01, "Embedding space", ha="center", va="bottom",
            fontsize=6, color=AXIS_GREY)

    _panel_label(ax, "C", x=-0.08, y=1.10)


# ══════════════════════════════════════════════════════
# 主函数
# ══════════════════════════════════════════════════════

def generate_fig3():
    print("\n" + "=" * 60)
    print("  Fig 3: CARL framework")
    print("=" * 60)

    _init_style()

    fig = plt.figure(figsize=(FIG_WIDTH_DOUBLE, FIG_WIDTH_DOUBLE * 0.68))

    # 布局: A 全宽 (top), B + C (bottom)
    gs = gridspec.GridSpec(2, 2, figure=fig,
                           height_ratios=[0.95, 1.0],
                           width_ratios=[1.2, 0.8],
                           hspace=0.25, wspace=0.35)

    # Panel A — 全宽
    ax_a = fig.add_subplot(gs[0, :])
    _draw_panel_a(ax_a)

    # Panel B — 2×3 augmentation cards
    gs_b = gs[1, 0].subgridspec(2, 3, hspace=0.35, wspace=0.15)
    axes_b = [fig.add_subplot(gs_b[i, j]) for i in range(2) for j in range(3)]
    _draw_panel_b(axes_b)

    # Panel C — simplex
    ax_c = fig.add_subplot(gs[1, 1])
    _draw_panel_c(ax_c)

    save_figure(fig, "fig3_carl_v2")


if __name__ == "__main__":
    generate_fig3()
