"""批量生成论文图集 (panel-level AI 生成 + Pillow 拼图为 composite).

设计哲学 (参考 pom1.png 的 grammar):
    - "示意图最少字、数据图最完整字"
    - 每个 panel 独立成立, 几乎不放架构标签 (kernel size, channel count 等都进 caption)
    - 真实数据图 (PCA/heatmap/photo) 由 Pillow 直接读取手稿现有 PNG
    - 示意图通过 OpenAI image API 生成
    - 最后用 Pillow 把 schematic 与 real-data 拼成完整 figure

使用方法:
    # 列出所有 panel 与 composite
    python batch_generate.py --list

    # 只生成 panel (AI 调用)
    python batch_generate.py --panels fig2_encoder fig2_aug fig2_loss

    # 只拼装 composite (本地 Pillow, 速度极快)
    python batch_generate.py --composites fig2

    # 生成全部 panel (并行) 然后拼装全部 composite
    python batch_generate.py --all

    # 手稿主示意图 (不含 13 个 reusable pictograms)
    python batch_generate.py --main

依赖:
    - Pillow (PIL) 用于 composite 拼装
    - generate_image.py 提供 generate_image() 函数
    - ref/ 子目录: pom1.png / pom2.png / nature_mi.png (设计语法参考)
    - 手稿图: g:\\Downloads\\机器嗅觉研究\\idea\\tea_mix\\manuscript\\ 下的真实数据/CFD/照片
"""

from __future__ import annotations

import argparse
import concurrent.futures
import shutil
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

from generate_image import generate_image

# ══════════════════════════════════════════════════════
# 路径配置
# ══════════════════════════════════════════════════════

ROOT = Path(__file__).resolve().parent
REF_DIR = ROOT / "ref"
OUT_DIR = ROOT / "ai_generated"
HISTORY_DIR = OUT_DIR / "history"
COMPOSITE_DIR = ROOT / "composite"
COMPOSITE_HISTORY_DIR = COMPOSITE_DIR / "history"
OUT_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
COMPOSITE_DIR.mkdir(parents=True, exist_ok=True)
COMPOSITE_HISTORY_DIR.mkdir(parents=True, exist_ok=True)

# 设计语法参考图 (告诉 AI "用这种 grammar")
REF_NATURE_MI = str(REF_DIR / "nature_mi.png")
REF_POM1 = str(REF_DIR / "pom1.png")
REF_POM2 = str(REF_DIR / "pom2.png")

# 手稿真实图 (Pillow 直接读取, 不进 AI prompt)
MANUSCRIPT_ROOT = Path(r"g:\Downloads\机器嗅觉研究\idea\tea_mix\manuscript")
MS_PLATFORM = MANUSCRIPT_ROOT / "elsarticle" / "figures" / "fig0a_platform_photo.png"
MS_CHAMBER_3D = MANUSCRIPT_ROOT / "elsarticle" / "figures" / "fig0b_chamber_3d.png"
MS_CHAMBER_CFD = MANUSCRIPT_ROOT / "elsarticle" / "figures" / "fig0c_chamber_cfd.png"
MS_AROMA_MAP = MANUSCRIPT_ROOT / "figures_v2" / "fig_aroma_map_v2.png"

# Fig 1 Hero 参考图 (仅借鉴风格, 不硬粘贴)
REF_HAND_DRAW = str(OUT_DIR / "fig1_hero_v2.png")  # 用上一版生成图替代手绘草图
REF_GA_HARDWARE = str(OUT_DIR / "panel_ga_hardware_v1.png")
REF_GA_OUTCOMES = str(OUT_DIR / "panel_ga_outcomes_v1.png")

# Fig 4 合图参考 (A-E 子图作为内容参考, pom2/pom3 作为风格参考)
REF_POM3 = str(REF_DIR / "pom3.png")
RESULTS_V2 = Path(r"d:\WindSurfProjects\rpi_odor\enose-analytics\scripts\paper_experiments_v2\results\v2\figures")

# ── 辅助: 横向拼接多张图为一张, 减少 API 参考图数量 ──
REF_STITCH_DIR = OUT_DIR / "_ref_stitch"
REF_STITCH_DIR.mkdir(parents=True, exist_ok=True)


def stitch_h(paths: list[str], out_name: str, max_h: int = 800) -> str:
    """横向拼接多张图, 统一高度 max_h, 保存到 _ref_stitch/ 并返回路径字符串."""
    out_path = REF_STITCH_DIR / out_name
    if out_path.exists():
        return str(out_path)
    imgs = [Image.open(p) for p in paths]
    # 等比缩放到统一高度
    resized = []
    for im in imgs:
        ratio = max_h / im.height
        resized.append(im.resize((int(im.width * ratio), max_h), Image.LANCZOS))
    total_w = sum(im.width for im in resized)
    canvas = Image.new("RGB", (total_w, max_h), (255, 255, 255))
    x = 0
    for im in resized:
        canvas.paste(im, (x, 0))
        x += im.width
    canvas.save(out_path, "PNG")
    for im in imgs:
        im.close()
    for im in resized:
        im.close()
    return str(out_path)


# 预拼接: 7 张 → 4 张
REF_FIG4_AB = stitch_h(
    [str(RESULTS_V2 / "fig_pca_pure_v2.png"),
     str(RESULTS_V2 / "fig_radar_pure_v2.png")],
    "ref_fig4_ab.png",
)
REF_FIG4_C = str(RESULTS_V2 / "fig_sm_s3_all_ratio_curves_v2.png")  # 保持原图
REF_FIG4_DE = stitch_h(
    [str(RESULTS_V2 / "fig_nldi_heatmap_v2.png"),
     str(RESULTS_V2 / "fig_nldi_forest_v2.png")],
    "ref_fig4_de.png",
)
REF_FIG4_STYLE = stitch_h(
    [str(REF_DIR / "pom2.png"), str(REF_DIR / "pom3.png")],
    "ref_fig4_style_pom23.png",
)

# 字体 (用于 composite 上的 panel 标签 A/B/C/D)
FONT_PATH = Path("C:/Windows/Fonts/arialbd.ttf")  # Windows Arial Bold

# ══════════════════════════════════════════════════════
# 调色板
# ══════════════════════════════════════════════════════

TEA_COLORS = {
    "T1": ("#E89B3C", "amber-orange (oolong)"),
    "T2": ("#A33B2A", "deep wine-red (black tea)"),
    "T3": ("#6FB58A", "tea-green (jasmine)"),
    "T4": ("#3F6FA8", "deep-blue (XQG pu-erh)"),
    "T5": ("#C57BA1", "purple-pink (dark roast oolong)"),
}

# ══════════════════════════════════════════════════════
# 共用风格锚点
# ══════════════════════════════════════════════════════

STYLE_ANCHOR_MINIMAL = """

GLOBAL STYLE (mandatory):
- Pure white background.
- All elements: flat vector, thin (1.5 pt) dark-grey outlines (#2D2D2D).
- NO 3D effects, NO drop shadows, NO photographic textures, NO clipart.
- NO unnecessary text labels — the visual structure should communicate without words.
- Connector arrows: thin dark-grey, simple triangle heads.
- Color palette restricted to:
  tea palette (#E89B3C amber, #A33B2A wine, #6FB58A green, #3F6FA8 blue, #C57BA1 pink)
  + schematic palette (#7FB7B0 teal=data, #E5A1A8 pink=model, #F4F1ED cream=neutral, #2D2D2D dark)

REFERENCE GRAMMAR:
- Match the visual idiom of the reference image (pom1 / pom2 / nature_mi):
  pastel grouping, two-color semantic encoding, minimal-text scientific schematic.
- DO NOT copy any specific content from the reference (no molecules, no chemical formulas,
  no GNN graphs, no aspirin/penicillin structures). ONLY adopt the design grammar.
"""

STYLE_ANCHOR_PICTOGRAM = """

GLOBAL STYLE CONSTRAINTS:
- Pure white background.
- Flat vector illustration; no 3D, no shadows, no gradients (unless explicitly stated).
- Thin dark-grey outlines (#2D2D2D, 1.5 pt).
- Clean sans-serif typography (Helvetica style); bold only for emphasis.
- No emojis, no decorative clipart, no photographic textures.
- Match the visual idiom of the attached reference figure (clean flat icons with thin dark outlines).
- Color palette restricted to:
  tea palette (#E89B3C, #A33B2A, #6FB58A, #3F6FA8, #C57BA1)
  + schematic palette (#7FB7B0 teal, #E5A1A8 pink, #F4F1ED cream, #2D2D2D dark).
"""

# ══════════════════════════════════════════════════════
# Panel 定义
# ══════════════════════════════════════════════════════

@dataclass
class PanelJob:
    """一个 AI-generated panel (要调用 OpenAI image API)."""

    name: str
    description: str
    prompt: str
    output_filename: str
    ref_images: list[str] = field(default_factory=list)
    size: str = "1024x1024"
    quality: str = "high"

    @property
    def output_path(self) -> Path:
        return OUT_DIR / self.output_filename


# ══════════════════════════════════════════════════════
# 主示意图 prompts (新版本 — 极简视觉, 几乎无字)
# ══════════════════════════════════════════════════════

# ── GA Panel 1: 硬件流 (portrait) ────────────────────
GA_HARDWARE_PROMPT = """\
Create a vertical scientific schematic showing the flow of tea aroma from brewing vessels
through an automated electronic-nose platform. The diagram is a single vertical strip
showing 4 stages connected by thin downward arrows. PURELY VISUAL — text is restricted to
ONLY the labels 'T1' through 'T5' under the tea cups. NO 'Phase 1', NO 'pump', NO 'sensor
array', NO 'gas inlet', NO equipment labels.

STAGE 1 (top): Five small Chinese tea cups arranged in a single horizontal row, each
filled with one of the tea palette colors (T1 amber #E89B3C, T2 wine-red #A33B2A,
T3 tea-green #6FB58A, T4 deep-blue #3F6FA8, T5 purple-pink #C57BA1). Tiny T1-T5 labels
below each cup. White porcelain body with thin dark-grey outline. From the cups, five
thin tubes converge into a single tube descending into stage 2.

STAGE 2: A peristaltic pump rendered as a circular rotor with three small rollers
positioned at 12, 4, and 8 o'clock, compressing a curved transparent silicone tube
wrapped around the rotor. The rotor body is filled with light cream (#F4F1ED). The
output tube exits downward toward stage 3.

STAGE 3: A laboratory gas-washing bottle rendered as a round-bottomed glass flask with
a stopper on top. Inside, a small amount of teal-tinted liquid (#7FB7B0 at 60 % opacity)
with three small white circles representing rising air bubbles. A thin tube enters from
the top-left (carrier gas inlet), bubbles through the liquid, and exits from the side
heading toward stage 4.

STAGE 4 (bottom): A horizontal cross-section of a rectangular sensing chamber with a
gently rounded internal ceiling (suggesting CFD-optimized geometry). Inside the chamber,
8 small filled circles (in teal #7FB7B0) arranged in 2 rows × 4 columns. A small inlet
tube on the left, outlet on the right. NO sensor labels, NO 'BME688', NO numbering.

LAYOUT: All four stages are vertically stacked and centered, occupying about 80 % of a
1024×1536 portrait canvas. Pure white margin around. Simple thin downward arrows
(1.5 pt dark grey, triangle heads) connect stages.
""" + STYLE_ANCHOR_MINIMAL

# ── GA Panel 2: CARL 流 (portrait) ───────────────────
GA_CARL_PROMPT = """\
Create a vertical scientific schematic showing how the CARL framework processes
8-channel sensor signals into a compact aroma embedding. PURELY VISUAL — text is
restricted to ONE word 'CARL' placed below the central encoder shape. NO architecture
labels, NO 'Conv1D', NO 'SE Attention', NO 'k=7', NO channel counts, NO 'z ∈ R^128'.

TOP THIRD: 8 thin horizontal wavy time-series lines stacked vertically, alternating
teal (#7FB7B0) and dark cyan (#3E7E78). The waves are smooth and quasi-periodic. NO
axis ticks, NO Ch1-Ch8 numbering. Width spans most of the canvas.

A thin downward arrow (1.5 pt dark grey, triangle head) connects to the middle third.

MIDDLE THIRD: A single smooth horizontal capsule shape (rounded ends) with a left-to-
right gradient transitioning from teal (#7FB7B0) on the left to pink (#E5A1A8) on the
right, suggesting transformation. Above the capsule, a subtle row of 8 small vertical
bars of varying heights (some tall, some short, the shorter ones with reduced opacity),
suggesting per-channel re-weighting. ONE word in clean bold sans-serif placed centered
below the capsule: 'CARL'.

A thin downward arrow connects to the bottom third.

BOTTOM THIRD: A horizontal compact vector of 12 small color cells arranged in a single
row, alternating teal (#7FB7B0) and pink (#E5A1A8). Below the vector, a small inset
zoom showing two scenarios:
  (a) two filled dots — one teal, one a same-tone teal-green — connected by a SOLID
      green double-headed arrow (visually pulling them close);
  (b) the same teal anchor dot vs a pink-coral dot — connected by a DASHED red
      double-headed arrow (visually pushing them apart).
NO labels on the dots, NO 'pull/push' words, NO 'anchor/positive/negative' annotations.

LAYOUT: All three sections vertically stacked, centered, occupying about 80 % of a
1024×1536 portrait canvas. Pure white margins.
""" + STYLE_ANCHOR_MINIMAL

# ── GA Panel 3: 应用 outcomes (wide banner) ──────────
GA_OUTCOMES_PROMPT = """\
Create a wide horizontal banner showing three small scientific application icons used
in tea blend quality control, arranged horizontally with thin vertical dividers between
them. PURELY VISUAL — text is restricted to ONE tiny header word 'Applications' centered
above the row of icons (in regular sans-serif). NO labels under or beside any icon.

ICON 1 (left third): Two small overlapping Chinese tea cups side by side, the left cup
filled amber-orange (#E89B3C), the right cup filled wine-red (#A33B2A). Between the cups,
a horizontal '≈' equals-sign (approximately equal). Below the cups, a small green
checkmark inside a thin circle outline.

ICON 2 (middle third): A circular boundary (thin dark-grey outline) containing four
colored cluster blobs at 12, 3, 6, 9 o'clock positions: amber-orange (#E89B3C),
tea-green (#6FB58A), wine-red (#A33B2A), and deep-blue (#3F6FA8). In the center, an
empty dashed-circle region with a question mark '?' inside.

ICON 3 (right third): A small Cartesian XY axis (thin dark-grey lines, no tick marks).
On the axes, a teal solid curve (#7FB7B0) that arcs upward then plateaus then declines
slightly (clearly non-linear). Overlaid on the same axes, a grey dashed straight line
going diagonally from the bottom-left to the top-right corner (the linear baseline). A
small soft shaded region between the two lines suggests their gap.

LAYOUT: The three icons evenly spaced across a 1536×512 horizontal banner. Two thin
vertical divider lines (light grey, 1 px) separate the three icons. Pure white background.
""" + STYLE_ANCHOR_MINIMAL

# ── Fig 1 Panel D: 实验设计 (data composition + numbers) ──
FIG1_WORKFLOW_PROMPT = """\
Create a clean horizontal scientific workflow diagram for a tea-blending experimental
design. Two parallel data-collection phases converge into a combined dataset. This is
a DATA-COMPOSITION panel (similar in role to pom1 panel B): numbers are essential and
should appear, but visual elements still dominate.

LAYOUT (left to right, on a 1536×768 horizontal canvas):

LEFT — 'Tea Samples' soft cream rounded rectangle (#F4F1ED, 8 px corners, thin border
#E0DBD3) containing five small tea cups arranged horizontally in palette colors
(T1 #E89B3C, T2 #A33B2A, T3 #6FB58A, T4 #3F6FA8, T5 #C57BA1) with tiny T1-T5 labels
below each cup. Bold sans-serif header text 'Tea Samples' inside the box top.

CENTER-TOP — Phase 1 row, in a teal-tinted (#7FB7B0 at 25 % opacity) rounded box:
  - Bold header 'Phase 1' in sans-serif.
  - Three small inline mini-icons:
    (1) a 5-cup row icon with the small annotation '× 64'
    (2) a randomized-shuffle icon (curved arrows wrapping around)
    (3) bold large text 'n = 320' in dark grey.
  - A right-pointing thin arrow exits the right edge of this row toward the merge.

CENTER-BOTTOM — Phase 2 row, in a pink-tinted (#E5A1A8 at 25 % opacity) rounded box:
  - Bold header 'Phase 2' in sans-serif.
  - Three small inline mini-icons:
    (1) a pair-of-cups icon with annotation '10 pairs'
    (2) a horizontal gradient bar split into 9 segments (suggesting 9 ratio steps)
    (3) bold large text 'n = 370' in dark grey.
  - A right-pointing thin arrow exits the right edge of this row toward the merge.

RIGHT — 'Combined Dataset' cream rounded rectangle. Inside: bold large text 'n = 690'
on the first line, then in smaller regular sans-serif on a second line:
'multi-session • randomised order'. The two arrows from Phase 1 and Phase 2 visibly
merge into the left edge of this box.

NO 'Quality Control' sub-box (omit). NO 'load-cell' or 'drift correction' icons. NO
panel letter labels. The only words inside this panel are: 'Tea Samples', 'Phase 1',
'Phase 2', 'Combined Dataset', the n-values, ratio annotations '× 64' / '10 pairs',
and the bottom subtitle.

GLOBAL STYLE:
- All boxes 8 px rounded corners, thin (1 px) borders.
- Two semantic colours: teal for Phase 1, pink for Phase 2, cream for neutral.
- Connector arrows: 1.5 pt dark-grey, simple triangle heads.
- Sans-serif typography (Helvetica style); BOLD only for box headers and n-values.
- NO 3D, NO shadows, NO clipart.

REFERENCE GRAMMAR: match the data-composition grammar of pom1 panel B (5000-molecule
training set composition viz with example molecules). DO NOT copy molecular structures.
"""

# ── Fig 1 Hero: 端到端单张 AI 生成 (wide landscape) ────
FIG1_HERO_PROMPT = """\
Create a SINGLE COHESIVE wide scientific illustration showing the complete overview of
a tea-blend aroma analysis framework. This must be ONE unified drawing — NOT a collage
of separate panels stitched together. Three conceptual columns flow naturally from left
to right, connected by smooth arrows and flow lines. No hard vertical divider lines.

Reference images are provided for STYLE INSPIRATION ONLY — do not copy or paste them;
re-draw all elements from scratch in a unified visual language.

The first reference image is a hand-drawn layout sketch. Follow its spatial arrangement
closely (three columns, vertical flows within each column), but render everything in
clean flat vector style, not hand-drawn.

=== LEFT COLUMN — "Tea Blend Aroma E-nose System" ===
Small section title at the top in clean regular sans-serif.

A vertical flow from top to bottom (ORDER IS CRITICAL — follow exactly):
1. FIVE small Chinese tea cups in a horizontal row, each filled with a distinct color
   (T1 amber-orange #E89B3C, T2 wine-red #A33B2A, T3 tea-green #6FB58A, T4 deep-blue
   #3F6FA8, T5 purple-pink #C57BA1). White porcelain bodies, thin dark-grey outlines.
   Tiny T1-T5 labels below each cup.
2. From each cup, a thin tube descends; all five tubes converge into a single tube at
   a Y-shaped junction.
3. PUMP FIRST (directly below the junction): a peristaltic pump icon (circular rotor
   with 3 small rollers, cream fill #F4F1ED). Tiny "Pump" label. A small "Air" label
   on the left side indicating ambient air intake.
4. THEN GAS-WASHING BOTTLE (below the pump): a round-bottomed flask with stopper,
   teal-tinted liquid #7FB7B0 at 60% opacity, 2-3 tiny rising air bubbles. The outlet
   label must read "VOC" (volatile organic compounds).
   CRITICAL: The pump is ABOVE the bottle. Do NOT swap their positions.
   CRITICAL: Do NOT write "Vac". The correct label is "VOC".
5. At the bottom: a rectangular sensor-chamber cross-section with 8 small teal
   (#7FB7B0) filled circles in a 2×4 arrangement. Tiny label "Sensor Chamber" below.

STYLE INSPIRATION: borrow the minimal line-art cup and vertical-flow style from the
second reference image (hardware panel), but integrate into the unified illustration.

=== MIDDLE COLUMN — "CARL Framework" ===
Small section title at the top in clean regular sans-serif.

A vertical flow continuing from the left column's sensor chamber (a thin arrow leads
from the sensor chamber rightward and downward into this column):

1. SENSOR INPUT (compact): A small "×8" annotation next to 8 barcode color strips
   drawn in a 2.5D ISOMETRIC stacked perspective — imagine 8 thin rectangular cards
   stacked on top of each other with a slight vertical offset and a subtle depth shadow,
   so you can see the edge of each card behind the one in front. Each card has
   horizontal segments of varying teal/cyan shades. The whole stack should be COMPACT
   and occupy roughly the same area as ONE card — the 2.5D perspective conveys "8
   channels" without taking 8× the vertical space.
   CRITICAL: Do NOT lay them out flat one below another. Stack them in perspective.
   Do NOT draw wavy sinusoidal time-series lines. Barcode / heatmap style ONLY.

2. DATA AUGMENTATION: Below the sensor input, a small rounded-rectangle box labeled
   "Augmentation" with 3-4 tiny pictogram icons inside showing augmentation operations:
   a small sine wave with a scissors cutting it (cropping), a small bar with a noise
   squiggle (jittering), a small bar being flipped horizontally (time-reversal), and a
   small faded bar (masking). These icons should be very small and arranged in a 2×2
   grid inside the box. A downward arrow leads from the sensor input into this box.

3. CARL ENCODER: A downward arrow from Augmentation leads into a larger rounded-
   rectangle box labeled "CARL Encoder" in clean bold sans-serif at the top.
   INSIDE the encoder box, show a simplified architecture flow from top to bottom:
   - A stack of 3-4 thin horizontal layer bars (representing Conv1D layers), each
     slightly narrower than the one above (funnel shape), colored in a gradient from
     light teal to darker teal.
   - Below the layer bars, a small diamond or star shape in pink (#E5A1A8) representing
     the attention mechanism.
   - At the bottom of the box, a single small circle or short bar representing the
     final compact embedding vector.
   No text labels inside the encoder — the visual structure communicates the architecture.

4. CONTRASTIVE LEARNING: Below the encoder box, an embedding space visualization with
   2-3 small tea-cup icons and contrastive arrows:
   - Two similar-color cups connected by a SOLID green double-headed arrow (pull).
   - One different-color cup connected by a DASHED red double-headed arrow (push).
   No text labels on arrows; color and dash style convey meaning.

=== RIGHT COLUMN — "Applications" ===
Small section title at the top in clean regular sans-serif.

Three vertically stacked application scenarios, each with a small Roman numeral AND
a short text description line below the visual:

I. TEA IDENTITY (classification):
   Two small tea cups side by side with a "≈" symbol between them.
   Below the cups: a small green checkmark inside a thin circle.
   Below the checkmark: a small text line reading "Tea Identity" in regular
   weight sans-serif. This represents classifying which tea variety a sample is.

II. BLEND-RATIO PREDICTION:
   Two or three small tea cups on the left (different colors, representing a blend),
   a thin right-pointing arrow, and a small pie-chart or ratio bar showing proportions
   with a small "?" near it on the right.
   Below: a small text line reading "Ratio Prediction" in regular weight sans-serif.
   This represents predicting the mixing ratio of a blend.

III. AROMA MAP:
   A rectangular frame (with a tiny title "Aroma Map" at its top edge) containing a
   conceptual PCA scatter plot: FIVE colored dot-clusters (using the five tea palette
   colors), well-separated from each other. Next to each cluster, a tiny tea-cup icon
   in the matching color serves as a legend. Between 1-2 pairs of clusters, faint
   curved trajectory lines suggest blend-interpolation paths. This is a CONCEPTUAL
   illustration inspired by the scatter-plot layout of the fourth reference image —
   do NOT reproduce actual data coordinates.

STYLE INSPIRATION for right column: borrow the cup-comparison icons and colored
cluster-dot motifs from the third reference image (outcomes panel), but re-draw in the
unified style.

=== GLOBAL LAYOUT ===
Wide horizontal canvas (landscape ratio). The three columns occupy roughly equal widths.
Natural thin-arrow flow lines connect left → middle → right. Column titles sit at the
top of each column. Pure white background. Generous white margins around the whole
illustration.
""" + STYLE_ANCHOR_MINIMAL

# ── Fig 4: 合并纯茶表征 + 非线性叠加 (5-panel, pom2/pom3-style) ──
FIG4_MERGED_PROMPT = """\
Create a single cohesive scientific figure with 5 panels (A–E) arranged in a 3-row
grid layout. This figure tells the story: first characterise pure teas (A, B), then
show what happens when they are blended (C), then quantify the non-linearity (D, E).

Four reference images are provided:
  Ref #1 = panels A+B stitched (PCA scatter + Radar chart) — DATA PATTERN reference.
  Ref #2 = panel C (10 response–ratio curve facets) — DATA PATTERN reference.
  Ref #3 = panels D+E stitched (NLDI heatmap + Forest plot) — DATA PATTERN reference.
  Ref #4 = pom2+pom3 stitched — VISUAL GRAMMAR / STYLE reference.
DO NOT copy-paste any reference image. RE-DRAW every element from scratch in a
unified flat-vector scientific illustration style, adopting the style of Ref #4.

=== LAYOUT (landscape, 1536×1536 canvas) ===

ROW 1 (top ~33%): Two panels side by side, equal width.
  [A] left half    [B] right half

ROW 2 (middle ~33%): One full-width panel.
  [C] full width

ROW 3 (bottom ~33%): Two panels side by side, equal width.
  [D] left half    [E] right half

Each panel has a BOLD uppercase letter label (A–E) in the top-left corner,
matching the pom2/pom3 panel-label style.

=== PANEL A — PCA Scatter Plot ===
A 2D scatter plot with TWO principal-component axes (PC1 horizontal, PC2 vertical).
Five distinct clusters of dots, each cluster using one of the tea palette colors:
  T1 amber-orange #E89B3C (circles), T2 wine-red #A33B2A (squares),
  T3 tea-green #6FB58A (triangles), T4 deep-blue #3F6FA8 (diamonds),
  T5 purple-pink #C57BA1 (inverted triangles).
Clusters should be well-separated with some overlap between T1/T2.
Each cluster has ~30–60 points. Thin axis lines, small tick marks.
A compact legend in the bottom or side area showing tea IDs and marker shapes.
Ref #1 (left half) shows the PCA data pattern to approximate (do NOT reproduce exact
coordinates).

=== PANEL B — Radar Chart ===
An octagonal radar (spider) chart with 8 radial axes labeled CH0–CH7.
Five overlapping polygons, one per tea type, using the same five tea palette colors
with slight transparency so overlapping regions are visible. The shapes should differ
noticeably — e.g. T1 has a large lobe on CH1–CH2, T4 is more compact and centered.
Thin dark-grey radial grid lines at 3–4 concentric levels.
Ref #1 (right half) shows the radar data pattern to approximate.

=== PANEL C — Response–Ratio Curves (full width) ===
A 2×5 grid of 10 small line charts (facet plot), one per binary tea combination.
Each small chart has:
  - X-axis: blend ratio 0.0 to 1.0 (fraction of Tea A).
  - Y-axis: mean normalised sensor response (~0.80–1.00).
  - A dashed grey diagonal line = linear prediction.
  - A solid blue curve with dots = measured response, with a light blue shaded band
    (±1 SD).
  - Title above each facet: "T1-T2", "T1-T3", etc., with NLDI value.
The key visual message: measured curves systematically deviate from the dashed linear
prediction — they dip below or curve above the straight line.
Ref #2 shows the data pattern and facet arrangement to approximate.

=== PANEL D — NLDI Heatmap ===
A 5×5 lower-triangular heatmap matrix. Rows and columns labeled T1–T5.
The diagonal cells are zero (lightest). Off-diagonal cells are colored on a
sequential warm palette (cream → orange → dark red), with the numeric NLDI value
printed inside each cell (e.g. 0.24, 0.37). The darkest cells should be T3-T5
(~0.37) and T1-T4 (~0.28).
Ref #3 (left half) shows the heatmap pattern to approximate.

=== PANEL E — Forest Plot ===
A horizontal forest plot (also called a dot-and-whisker plot). 10 rows, one per tea
pair, sorted by NLDI from highest at top to lowest at bottom. Each row shows:
  - A filled circle at the NLDI mean value.
  - A horizontal error bar spanning the 95% bootstrap CI.
  - The tea-pair label on the Y-axis (e.g. "T2-T5", "T1-T2", …, "T2-T4").
A vertical dashed grey line at x=0 represents the null hypothesis of linear
additivity. ALL error bars are clearly to the right of zero.
Color: use a warm orange-red (#D55E00) for the dots and bars.
Ref #3 (right half) shows the forest-plot pattern to approximate.

=== VISUAL COHERENCE ===
- All five panels share the same tea palette, font style, line weights, and
  background color (pure white).
- Thin (0.5–1 pt) dark-grey (#2D2D2D) outlines, axes, and tick marks throughout.
- Clean sans-serif font (Helvetica-like), 7–8 pt equivalent.
- No decorative elements, no 3D effects, no drop shadows.
- Panel labels A–E in bold ~10 pt, positioned consistently in top-left.
- Match the dense multi-panel arrangement and pastel-scientific aesthetic of the
  pom2/pom3 style references — panels share a unified visual language.
""" + STYLE_ANCHOR_MINIMAL

# ── Fig 2 Panel A: 编码器视觉流 (wide banner) ─────────
FIG2_ENCODER_PROMPT = """\
Create a horizontal scientific schematic showing how a deep encoder transforms
8-channel sensor signals into a compact embedding vector. PURELY VISUAL — text is
restricted to ONE small caption 'Encoder' under the central transformation shape, AND
ONE tiny caption above the input lines reading 'sensor signals' (regular weight, small
font). NO architecture details, NO 'Conv1D', NO kernel sizes, NO channel counts, NO
layer names, NO 'SE Attention', NO 'GAP', NO 'projection head', NO 'z' or dimension
annotations. The encoder must be drawn as ONE FLOWING SHAPE, not a sequence of
rectangular blocks.

LAYOUT (1536×512 horizontal banner):

LEFT (about 25 % width): 8 thin horizontal wavy time-series curves stacked vertically,
alternating teal (#7FB7B0) and dark cyan (#3E7E78). Smooth, quasi-periodic. NO axis,
NO ticks, NO Ch1-Ch8 numbering. A tiny lower-case caption 'sensor signals' above the
top curve.

CENTER (about 40 % width): A SINGLE organic flowing shape — like a smooth horizontal
capsule with slightly varying thickness — filled with a left-to-right gradient
transitioning from teal (#7FB7B0) at the left edge to pink (#E5A1A8) at the right edge.
Above this shape, a subtle row of 8 small vertical bars of varying heights (some tall,
some short with reduced opacity), suggesting per-channel re-weighting WITHOUT any 'SE'
or 'attention' label. The shape should NOT look like a stack of layer boxes; it should
look like one continuous transformation. Below the shape, ONE word in bold sans-serif
caption: 'Encoder'.

RIGHT (about 25 % width): A horizontal compact vector of 12 small color cells in a
single row, alternating teal (#7FB7B0) and pink (#E5A1A8) cells, with thin dark-grey
outlines on each cell. NO 'embedding', NO 'z', NO 'R^128' label.

ARROWS: A thin dark-grey arrow (1.5 pt, simple triangle head) from the right edge of
the input lines into the left edge of the encoder shape. Another thin arrow from the
right edge of the encoder shape into the left edge of the output vector.

REFERENCE GRAMMAR: match pom1 panel C 'GNN model training' (molecules → graph evolution
→ vector → labels): use ORGANIC VISUAL FLOW with color-coded transformation, NOT a
boxy architecture diagram. DO NOT copy molecular structures or graph-neural-network
visuals from the reference; ONLY adopt the visual fluidity.
""" + STYLE_ANCHOR_MINIMAL

# ── Fig 2 Panel B: 增强 cards (square) ─────────────────
FIG2_AUG_PROMPT = """\
Create a 2×2 grid of small visual augmentation cards demonstrating how raw sensor
signals are perturbed during contrastive training. PURELY VISUAL — NO text labels of
any kind inside the cards, NO 'time warp', NO 'cutout', NO 'noise', NO 'original /
augmented' captions. NO axis ticks. NO numbers.

EACH CARD: a soft cream rounded rectangle (#F4F1ED, 8 px corners, thin border #E0DBD3)
containing TWO small thin teal (#7FB7B0) sinusoidal curves stacked vertically — the
TOP curve is the 'original' (smooth sine wave, identical in all four cards), and the
BOTTOM curve is the 'perturbed' version. Between the two curves, a small downward
arrow (1.5 pt dark grey, triangle head). The curves occupy about 70 % of the card
width, centered.

CARD 1 (top-left) — TIME WARPING:
  Bottom curve: same sine but with non-uniform horizontal stretching (the central
  oscillation period is visibly compressed, the side oscillation periods are stretched).

CARD 2 (top-right) — BASELINE SHIFT:
  Bottom curve: same sine but the entire curve is translated upward by about 15 % and
  has a gentle linear trend rising from left to right (a slow drift baseline).

CARD 3 (bottom-left) — CHANNEL DROPOUT:
  Bottom curve: same sine but with a horizontal 30 %-wide segment in the middle
  replaced by a flat dashed grey line at the baseline (suggesting that one channel
  was zeroed). The flat-line region is rendered in light grey dashes, NOT solid teal.

CARD 4 (bottom-right) — GAUSSIAN NOISE:
  Bottom curve: same sine with low-amplitude random jitter overlaid uniformly across
  the whole curve.

LAYOUT: Four cards arranged in a 2×2 grid on a 1024×1024 canvas. Equal margins between
cards (about 32 px). Pure white background outside the cards.

REFERENCE GRAMMAR: match the icon-grid grammar of nature_mi panel (b) (structure-text
retrieval icons): clean flat cards arranged in a grid. DO NOT include any molecules
or chemical formulas.
""" + STYLE_ANCHOR_MINIMAL

# ── Fig 2 Panel C: 损失函数几何 (square) ────────────
FIG2_LOSS_PROMPT = """\
Create a single visual scientific schematic showing the geometric concept of a
composition-aware contrastive loss in a 3-tea blend simplex. PURELY VISUAL — NO
equations, NO 'soft-SupCon loss' text, NO 'pull / push' words, NO 'positive / negative
/ anchor' labels, NO 'T_A / T_B / T_C' letter labels. The ONLY allowed text is a single
panel caption above the simplex (NOT inside it).

CANVAS: 1024×1024 square, pure white background.

CENTRAL ELEMENT — A medium-thickness dark-grey (#2D2D2D) triangular outline forming a
simplex (composition space). At each of the three vertices, a small Chinese tea cup
icon filled with one of the tea palette colors:
  - Top vertex: tea cup filled amber-orange (#E89B3C).
  - Bottom-left vertex: tea cup filled wine-red (#A33B2A).
  - Bottom-right vertex: tea cup filled tea-green (#6FB58A).
NO letter labels next to the cups.

INSIDE THE SIMPLEX:
  - DOT 1 (anchor): A solid teal (#7FB7B0) circle, slightly larger than other dots,
    positioned in the upper-center region of the simplex.
  - DOT 2: A solid teal (#7FB7B0) circle of standard size, positioned VERY CLOSE to
    DOT 1 (a few diameters away). They share the same color, suggesting similar
    composition.
  - DOT 3: A solid pink-coral (#E5A1A8) circle of standard size, positioned far from
    DOT 1, near the bottom-right edge of the simplex.

COMPOSITION VECTOR INDICATORS — Beside each of the three dots (DOT 1, DOT 2, DOT 3),
draw a tiny horizontal stacked color bar made of three segments (amber #E89B3C / wine
#A33B2A / green #6FB58A), with each segment width proportional to that dot's
implicit composition. The bars beside DOT 1 and DOT 2 should look NEARLY IDENTICAL.
The bar beside DOT 3 should look DRAMATICALLY DIFFERENT (e.g., almost all green). NO
numerical labels on the bars.

ARROWS:
  - A SOLID green double-headed arrow (about 2 pt thickness) connects DOT 1 and DOT 2
    (visually pulling them together). The arrow line is straight.
  - A DASHED red double-headed arrow (about 1.5 pt thickness, slightly thinner) connects
    DOT 1 and DOT 3 (visually pushing them apart). The dashed line is straight.
  - The arrow thickness difference visually conveys the weight difference (similar
    composition → high attractive weight; dissimilar → low repulsive weight). NO
    weight labels, NO Greek letters.

PANEL CAPTION (above the simplex, outside): one short phrase in regular sans-serif:
'Composition-aware contrastive'.

REFERENCE GRAMMAR: match pom2 panel B 'descriptor coordinates with two arrows for
perceptual distance and odor detectability' — geometric visual schematic with minimal
text and clean axis-arrow grammar. DO NOT copy any chemical structure or descriptor
content.
""" + STYLE_ANCHOR_MINIMAL


# ══════════════════════════════════════════════════════
# Pictogram prompts (保留, 可复用)
# ══════════════════════════════════════════════════════

def teacup_prompt(hex_color: str, label: str, tea_id: str) -> str:
    return (
        f"Create a single flat vector pictogram of a small Chinese tea cup viewed from "
        f"the side at a slight 3/4 angle, filled with tea liquid in the EXACT colour "
        f"{hex_color} ({label}). The cup body is white porcelain with a single thin "
        f"dark-grey outline (#2D2D2D, 1.5 pt). The rim shows a thin ellipse of liquid "
        f"in the same colour as the fill.\n\n"
        f"NO handle, NO saucer, NO steam, NO decorative pattern, NO text or label like "
        f"'{tea_id}' inside the image. Cup occupies central 60 % of the 1024×1024 canvas, "
        f"on a pure white background.\n\n"
        f"Style: minimalist scientific pictogram suitable for an academic paper graphical "
        f"abstract. Match the aesthetic of the attached reference figure (clean flat icons "
        f"with thin dark outlines)."
        + STYLE_ANCHOR_PICTOGRAM
    )


SENSOR_ARRAY_PROMPT = (
    "Create a single flat vector pictogram showing an 8-channel metal-oxide semiconductor "
    "sensor array. Top-down view: 8 small circular sensor elements arranged in 2 rows × 4 "
    "columns inside a thin rectangular dark-grey outlined chamber. Each sensor element is a "
    "small filled circle in teal (#7FB7B0), with a faint concentric ring suggesting a heated "
    "membrane.\n\n"
    "Above the chamber, a small thin tube enters from the left labelled with a tiny arrow "
    "indicating gas inflow. To the right, another tube exits indicating gas outflow.\n\n"
    "Pure white background, NO 3D, NO shadows, NO gradients (except the very subtle ring on "
    "each sensor). NO text, NO numerical labels."
    + STYLE_ANCHOR_PICTOGRAM
)

PERISTALTIC_PUMP_PROMPT = (
    "Create a single minimalist flat vector pictogram of a peristaltic pump. Side view of a "
    "circular rotor head with three small rollers compressing a curved transparent tube wrapped "
    "around the rotor. The rotor body is filled with light cream (#F4F1ED), the tube outlined "
    "in dark grey (#2D2D2D, 1.5 pt). A small motor box on the left.\n\n"
    "Pure white background. NO shadows, NO 3D, NO gradients. NO text, NO labels. "
    "Suitable as a tiny icon (will be displayed at 64-128 px width in the actual figure)."
    + STYLE_ANCHOR_PICTOGRAM
)

RECIPE_CHECK_PROMPT = (
    "Create a single flat vector pictogram: two small overlapping tea cups (one filled with "
    "amber-orange tea #E89B3C, the other with deep wine-red tea #A33B2A), side by side, with "
    "a thin equals-sign \"≈\" between them. Below the equals sign, a small green checkmark "
    "inside a thin circle outline.\n\n"
    "Pure white background, NO 3D, NO shadows. Style: minimalist scientific pictogram, "
    "dark-grey outlines (#2D2D2D, 1.5 pt)."
    + STYLE_ANCHOR_PICTOGRAM
)

AROMA_GAP_PROMPT = (
    "Create a single flat vector pictogram: a 2D scatter plot inside a thin circular boundary "
    "showing four colored cluster blobs (amber-orange #E89B3C, wine-red #A33B2A, tea-green "
    "#6FB58A, deep-blue #3F6FA8) and one empty dashed-circle region in the centre with a "
    "question mark \"?\" inside.\n\n"
    "Pure white background. NO 3D, NO shadows. Outlines in dark grey (#2D2D2D, 1.5 pt)."
    + STYLE_ANCHOR_PICTOGRAM
)


def aug_prompt(variant: str, description: str) -> str:
    return (
        f"Create a single flat vector pictogram showing a pair of small horizontal sinusoidal "
        f"time-series curves in teal (#7FB7B0), with a small wavy arrow between them indicating "
        f"transformation. Variant: {variant}.\n\n"
        f"{description}\n\n"
        f"Curves drawn at small scale within a 1024×1024 canvas, on pure white background. "
        f"Outlines and arrows in dark grey (#2D2D2D, 1.5 pt). NO axis ticks, NO text, NO "
        f"numerical labels (except the variant name in tiny sans-serif below the right curve)."
        + STYLE_ANCHOR_PICTOGRAM
    )


AUG_TIMEWARP_DESC = (
    "Left curve is a smooth sine. Right curve is the same sine but non-uniformly stretched "
    "horizontally (compressed in the middle, stretched at the edges). Label the right curve "
    "'time warp' in tiny font."
)
AUG_BASELINE_DESC = (
    "Left curve is a smooth sine. Right curve is the same sine but shifted upward and slightly "
    "tilted to the right (suggesting a slow drift baseline). Label the right curve "
    "'baseline shift' in tiny font."
)
AUG_DROPOUT_DESC = (
    "Left curve is a smooth sine. Right curve is the same sine with a horizontal 30 % segment "
    "in the middle replaced by a flat dashed grey line (channel zeroed). Label the right curve "
    "'channel dropout' in tiny font."
)
AUG_NOISE_DESC = (
    "Left curve is a smooth sine. Right curve has low-amplitude jitter overlaid on the same "
    "sine shape. Label the right curve '+ noise' in tiny font."
)


# ══════════════════════════════════════════════════════
# Panel 注册表
# ══════════════════════════════════════════════════════

PANELS: dict[str, PanelJob] = {
    # ── 主示意图 panels (新版本, 极简视觉) ───────
    "ga_hardware": PanelJob(
        name="ga_hardware",
        description="GA L-panel: tea cups → pump → wash bottle → 8-sensor chamber (vertical)",
        prompt=GA_HARDWARE_PROMPT,
        output_filename="panel_ga_hardware_v1.png",
        ref_images=[REF_POM1, REF_NATURE_MI],
        size="1024x1536",
    ),
    "ga_carl": PanelJob(
        name="ga_carl",
        description="GA M-panel: signals → CARL encoder capsule → embedding vector + pull/push",
        prompt=GA_CARL_PROMPT,
        output_filename="panel_ga_carl_v1.png",
        ref_images=[REF_NATURE_MI, REF_POM1],
        size="1024x1536",
    ),
    "ga_outcomes": PanelJob(
        name="ga_outcomes",
        description="GA bottom-strip: 3 application icons (recipe ≈ / aroma gap / NLDI curve)",
        prompt=GA_OUTCOMES_PROMPT,
        output_filename="panel_ga_outcomes_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1536x1024",
    ),
    "fig1_workflow": PanelJob(
        name="fig1_workflow",
        description="Fig 1 Panel D: two-phase experimental workflow (data composition)",
        prompt=FIG1_WORKFLOW_PROMPT,
        output_filename="panel_fig1_workflow_v1.png",
        ref_images=[REF_POM1],
        size="1536x1024",
    ),
    "fig1_hero": PanelJob(
        name="fig1_hero",
        description="Fig 1 Hero: end-to-end single image (hardware → CARL → applications)",
        prompt=FIG1_HERO_PROMPT,
        output_filename="fig1_hero_v3.png",
        ref_images=[REF_HAND_DRAW, REF_GA_HARDWARE, REF_GA_OUTCOMES, str(MS_AROMA_MAP)],
        size="1536x1024",
        quality="high",
    ),
    "fig4_merged": PanelJob(
        name="fig4_merged",
        description="Fig 4: pure-tea characterisation + non-linear blend (5-panel A-E, pom2/pom3-style)",
        prompt=FIG4_MERGED_PROMPT,
        output_filename="fig4_merged_v1.png",
        ref_images=[
            REF_FIG4_AB,     # ref #1: PCA + Radar stitched
            REF_FIG4_C,      # ref #2: All ratio curves
            REF_FIG4_DE,     # ref #3: Heatmap + Forest stitched
            REF_FIG4_STYLE,  # ref #4: pom2+pom3 style reference
        ],
        size="1536x1536",
        quality="high",
    ),
    "fig2_encoder": PanelJob(
        name="fig2_encoder",
        description="Fig 2 Panel A: encoder visual flow (signals → flowing capsule → vector)",
        prompt=FIG2_ENCODER_PROMPT,
        output_filename="panel_fig2_encoder_v1.png",
        ref_images=[REF_POM1, REF_NATURE_MI],
        size="1536x1024",
    ),
    "fig2_aug": PanelJob(
        name="fig2_aug",
        description="Fig 2 Panel B: 2×2 augmentation cards (warp/baseline/dropout/noise)",
        prompt=FIG2_AUG_PROMPT,
        output_filename="panel_fig2_aug_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "fig2_loss": PanelJob(
        name="fig2_loss",
        description="Fig 2 Panel C: composition simplex + soft-contrastive geometry",
        prompt=FIG2_LOSS_PROMPT,
        output_filename="panel_fig2_loss_v1.png",
        ref_images=[REF_POM2],
        size="1024x1024",
    ),
    # ── Pictograms (复用资产, 可被 composite 选用) ─
    **{
        f"teacup_{tid.lower()}": PanelJob(
            name=f"teacup_{tid.lower()}",
            description=f"Pictogram - {tid} {label} tea cup ({hex_})",
            prompt=teacup_prompt(hex_, label, tid),
            output_filename=f"pictogram_teacup_{tid}_v1.png",
            ref_images=[REF_NATURE_MI],
            size="1024x1024",
        )
        for tid, (hex_, label) in TEA_COLORS.items()
    },
    "sensor_array": PanelJob(
        name="sensor_array",
        description="Pictogram - 8-channel MOS sensor array (top-down)",
        prompt=SENSOR_ARRAY_PROMPT,
        output_filename="pictogram_sensor_array_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "pump": PanelJob(
        name="pump",
        description="Pictogram - peristaltic pump (side view)",
        prompt=PERISTALTIC_PUMP_PROMPT,
        output_filename="pictogram_peristaltic_pump_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "recipe_check": PanelJob(
        name="recipe_check",
        description="Pictogram - recipe equivalence checkmark",
        prompt=RECIPE_CHECK_PROMPT,
        output_filename="pictogram_recipe_check_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "aroma_gap": PanelJob(
        name="aroma_gap",
        description="Pictogram - aroma gap (empty cluster region with ?)",
        prompt=AROMA_GAP_PROMPT,
        output_filename="pictogram_aroma_gap_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "aug_timewarp": PanelJob(
        name="aug_timewarp",
        description="Pictogram - time-warping augmentation pair",
        prompt=aug_prompt("time warping", AUG_TIMEWARP_DESC),
        output_filename="pictogram_aug_timewarp_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "aug_baseline": PanelJob(
        name="aug_baseline",
        description="Pictogram - baseline-shift augmentation pair",
        prompt=aug_prompt("baseline shift", AUG_BASELINE_DESC),
        output_filename="pictogram_aug_baseline_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "aug_dropout": PanelJob(
        name="aug_dropout",
        description="Pictogram - channel-dropout augmentation pair",
        prompt=aug_prompt("channel dropout", AUG_DROPOUT_DESC),
        output_filename="pictogram_aug_dropout_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
    "aug_noise": PanelJob(
        name="aug_noise",
        description="Pictogram - Gaussian-noise augmentation pair",
        prompt=aug_prompt("Gaussian noise", AUG_NOISE_DESC),
        output_filename="pictogram_aug_noise_v1.png",
        ref_images=[REF_NATURE_MI],
        size="1024x1024",
    ),
}

# 主 schematic panels 子集 (主示意图 = 新版本极简视觉, 不含 pictogram)
MAIN_SCHEMATIC_PANELS = [
    "ga_hardware",
    "ga_carl",
    "ga_outcomes",
    "fig1_workflow",
    "fig1_hero",
    "fig4_merged",
    "fig2_encoder",
    "fig2_aug",
    "fig2_loss",
]

# ══════════════════════════════════════════════════════
# Composite (PIL 拼图)
# ══════════════════════════════════════════════════════

@dataclass
class PanelSlot:
    """一个 composite 上的 panel 占位符."""

    source: str                               # panel name OR absolute file path
    bbox: tuple[int, int, int, int]           # (x, y, w, h) on canvas
    label: str | None = None                  # "A" / "B" / "C" / "D" or None
    crop: str | None = None                   # "left_half" / "right_half" / "top_half" / "bottom_half"
    crop_box: tuple[float, float, float, float] | None = None  # 比例裁剪 (x0, y0, x1, y1) ∈ [0,1]
    trim: bool = True                         # 自动裁掉接近纯白的边缘 (AI panel 默认开)
    fit: str = "contain"                      # "contain" (letterbox) | "cover" (crop fill) | "stretch"
    bg_color: tuple[int, int, int, int] = (255, 255, 255, 255)  # slot 背景色 (letterbox 用)


@dataclass
class CompositeSpec:
    """完整一张 figure 的拼图配方."""

    name: str
    description: str
    output_filename: str
    canvas_size: tuple[int, int]              # (width, height)
    slots: list[PanelSlot]


COMPOSITES: dict[str, CompositeSpec] = {
    # ── Graphical Abstract ──────────────────────────
    # 布局策略 (基于实测内容尺寸):
    #   ga_hardware/ga_carl: 0.53/0.60:1 portrait → 640×740 contain
    #   aroma_map (右半上 82%): 1.54:1 landscape → 640×740 contain
    #   ga_outcomes: crop_box 跳过 'Applications' caption (源图 y 0-20%) → trim 后约 2.96:1,
    #                contain-fit 在 1920×540 (3.56:1) 槽中, 左右各 ~160 px 白边, 三个图标全部可见
    "ga": CompositeSpec(
        name="ga",
        description="Graphical Abstract: hardware | CARL | real aroma map + outcomes strip",
        output_filename="composite_ga_v1.png",
        canvas_size=(1920, 1280),
        slots=[
            PanelSlot(source="ga_hardware", bbox=(0,    0,   640,  740)),
            PanelSlot(source="ga_carl",     bbox=(640,  0,   640,  740)),
            PanelSlot(
                source=str(MS_AROMA_MAP),
                bbox=(1280, 0, 640, 740),
                crop_box=(0.5, 0.0, 1.0, 0.82),
                trim=False,
            ),
            PanelSlot(
                source="ga_outcomes",
                bbox=(0, 740, 1920, 540),
                crop_box=(0.0, 0.20, 1.0, 1.0),  # 跳过 'Applications' 标题
                fit="contain",
            ),
        ],
    ),
    # ── MS Fig 2 (legacy composite): 实拍 + CAD + CFD + workflow ──
    # → 已由 gen_fig2_platform.py 替代, 保留供参考
    "fig1": CompositeSpec(
        name="fig1",
        description="MS Fig 2: platform photo (A) + CAD (B) + CFD (C) + workflow (D)",
        output_filename="composite_fig1_v1.png",
        canvas_size=(1920, 1280),
        slots=[
            PanelSlot(source=str(MS_PLATFORM),       bbox=(0,    0,    960,  1280), label="A"),
            PanelSlot(source=str(MS_CHAMBER_3D),     bbox=(960,  0,    960,  416),  label="B"),
            PanelSlot(source=str(MS_CHAMBER_CFD),    bbox=(960,  416,  960,  416),  label="C"),
            PanelSlot(source="fig1_workflow",        bbox=(960,  832,  960,  448),  label="D"),
        ],
    ),
    # ── MS Fig 3 (legacy composite): 编码器 + 增强 + 损失 ──
    # → 已由 gen_fig3_carl.py 替代, 保留供参考
    "fig2": CompositeSpec(
        name="fig2",
        description="MS Fig 3: encoder visual flow (A) + augmentation cards (B) + loss simplex (C)",
        output_filename="composite_fig2_v1.png",
        canvas_size=(1920, 1280),
        slots=[
            PanelSlot(source="fig2_encoder",         bbox=(0,    0,    1920, 640),  label="A"),
            PanelSlot(source="fig2_aug",             bbox=(0,    640,  960,  640),  label="B"),
            PanelSlot(source="fig2_loss",            bbox=(960,  640,  960,  640),  label="C"),
        ],
    ),
}


# ══════════════════════════════════════════════════════
# 工具函数 — 历史归档 / 裁白边
# ══════════════════════════════════════════════════════

def archive_with_timestamp(canonical: Path, history_dir: Path, ts: str | None = None) -> Path:
    """把 canonical 文件复制到 history_dir, 文件名后缀加时间戳, 返回归档路径.

    例: panel_fig2_aug_v1.png -> history/panel_fig2_aug_v1_20251230_233045.png
    """
    if not canonical.exists():
        raise FileNotFoundError(f"待归档文件不存在: {canonical}")
    history_dir.mkdir(parents=True, exist_ok=True)
    if ts is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    archived = history_dir / f"{canonical.stem}_{ts}{canonical.suffix}"
    shutil.copy2(canonical, archived)
    return archived


def trim_whitespace(
    img: Image.Image,
    threshold: int = 12,
    padding: int = 16,
    bg_color: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """裁掉 img 四周接近 bg_color 的边缘, 仅保留有内容的 bbox + padding.

    - threshold: 像素与背景色的曼哈顿距离小于此值视为"白边"
    - padding: 内容边界外保留的 padding 像素
    - 返回新图; 若全白则返回原图
    """
    work = img.convert("RGB") if img.mode != "RGB" else img.copy()
    bg_img = Image.new("RGB", work.size, bg_color)
    diff = ImageChops.difference(work, bg_img)
    diff_thresh = diff.point(lambda p: 255 if p > threshold else 0)
    bbox = diff_thresh.getbbox()
    if bbox is None:
        return img
    x0, y0, x1, y1 = bbox
    w, h = img.size
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(w, x1 + padding)
    y1 = min(h, y1 + padding)
    return img.crop((x0, y0, x1, y1))


# ══════════════════════════════════════════════════════
# 任务执行 — Panel (API 调用)
# ══════════════════════════════════════════════════════

def run_panel_job(job: PanelJob) -> tuple[str, Path | Exception, float]:
    """执行单个 panel 生成任务。返回 (job_name, result_or_exception, elapsed_seconds).

    成功后会同时把生成图复制一份到 history_dir, 保留时间戳后缀; canonical
    路径(无时间戳)始终为最新版.
    """
    t0 = time.perf_counter()
    try:
        for ref in job.ref_images:
            if not Path(ref).exists():
                raise FileNotFoundError(f"参考图缺失: {ref}")

        path = generate_image(
            prompt=job.prompt,
            output_path=str(job.output_path),
            ref_images=job.ref_images,
            size=job.size,
            quality=job.quality,
        )
        try:
            archive_with_timestamp(path, HISTORY_DIR)
        except Exception:
            pass  # 归档失败不阻塞主流程
        return job.name, path, time.perf_counter() - t0
    except Exception as exc:  # noqa: BLE001
        return job.name, exc, time.perf_counter() - t0


# ══════════════════════════════════════════════════════
# 任务执行 — Composite (PIL 拼图)
# ══════════════════════════════════════════════════════

def _resolve_slot_image(slot: PanelSlot) -> Image.Image:
    """读取 slot 源图 (panel 输出 or 真实文件), 按 slot 选项裁切 + 去白边."""
    src = slot.source
    if src in PANELS:
        path = PANELS[src].output_path
        if not path.exists():
            raise FileNotFoundError(
                f"panel '{src}' 尚未生成 (期望 {path})；请先运行 --panels {src}"
            )
    else:
        path = Path(src)
        if not path.exists():
            raise FileNotFoundError(f"slot 源文件不存在: {path}")

    img = Image.open(path).convert("RGBA")

    if slot.crop_box:
        x0, y0, x1, y1 = slot.crop_box
        if not (0 <= x0 < x1 <= 1.0 and 0 <= y0 < y1 <= 1.0):
            raise ValueError(f"crop_box 必须 ∈ [0,1] 且 x0<x1, y0<y1: {slot.crop_box}")
        w, h = img.size
        img = img.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))

    if slot.crop:
        w, h = img.size
        if slot.crop == "left_half":
            img = img.crop((0, 0, w // 2, h))
        elif slot.crop == "right_half":
            img = img.crop((w // 2, 0, w, h))
        elif slot.crop == "top_half":
            img = img.crop((0, 0, w, h // 2))
        elif slot.crop == "bottom_half":
            img = img.crop((0, h // 2, w, h))
        else:
            raise ValueError(f"未知 crop 选项: {slot.crop}")

    if slot.trim:
        img = trim_whitespace(img)

    return img


def _fit_into_bbox(
    img: Image.Image,
    bbox: tuple[int, int, int, int],
    fit: str = "contain",
) -> tuple[Image.Image, tuple[int, int]]:
    """按 fit 模式把 img 缩放进 bbox.

    - "contain": 保留宽高比, 居中, 留 letterbox (默认)
    - "cover":   保留宽高比, 居中, 多出部分被裁掉, 完全填满 slot
    - "stretch": 拉伸到 slot 完全尺寸 (会变形, 不推荐)

    返回 (缩放后图, 在 bbox 内的偏移).
    """
    _, _, bw, bh = bbox
    iw, ih = img.size
    if fit == "stretch":
        return img.resize((bw, bh), Image.Resampling.LANCZOS), (0, 0)
    if fit == "cover":
        scale = max(bw / iw, bh / ih)
    else:  # contain
        scale = min(bw / iw, bh / ih)
    new_w = max(1, int(iw * scale))
    new_h = max(1, int(ih * scale))
    img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    if fit == "cover":
        # 中心裁剪
        left = (new_w - bw) // 2
        top = (new_h - bh) // 2
        img_resized = img_resized.crop((left, top, left + bw, top + bh))
        return img_resized, (0, 0)
    offset_x = (bw - new_w) // 2
    offset_y = (bh - new_h) // 2
    return img_resized, (offset_x, offset_y)


def _draw_label(canvas: Image.Image, label: str, bbox: tuple[int, int, int, int]) -> None:
    """在 bbox 左上角画一个粗体大写 panel label (A/B/C/D)."""
    x, y, _, _ = bbox
    draw = ImageDraw.Draw(canvas)

    font_size = 56
    try:
        if FONT_PATH.exists():
            font = ImageFont.truetype(str(FONT_PATH), font_size)
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    pad = 16
    label_x = x + pad
    label_y = y + pad
    bg_pad = 8
    try:
        bbox_text = draw.textbbox((label_x, label_y), label, font=font)
        bg_box = (
            bbox_text[0] - bg_pad,
            bbox_text[1] - bg_pad,
            bbox_text[2] + bg_pad,
            bbox_text[3] + bg_pad,
        )
        draw.rectangle(bg_box, fill=(255, 255, 255, 230))
    except Exception:
        pass

    draw.text((label_x, label_y), label, fill=(45, 45, 45, 255), font=font)


def assemble_composite(spec: CompositeSpec) -> Path:
    """把一组 slot 拼装为完整 composite figure, 返回 canonical 输出路径.

    成功后还会在 COMPOSITE_HISTORY_DIR 留一份带时间戳的历史副本.
    """
    canvas = Image.new("RGBA", spec.canvas_size, (255, 255, 255, 255))

    for slot in spec.slots:
        img = _resolve_slot_image(slot)
        # 在 slot 内画一层 slot 背景 (用于 letterbox 时的填充色)
        x, y, bw, bh = slot.bbox
        if slot.bg_color != (255, 255, 255, 255):
            slot_bg = Image.new("RGBA", (bw, bh), slot.bg_color)
            canvas.paste(slot_bg, (x, y), slot_bg)
        resized, (off_x, off_y) = _fit_into_bbox(img, slot.bbox, fit=slot.fit)
        canvas.paste(resized, (x + off_x, y + off_y), resized)

        if slot.label:
            _draw_label(canvas, slot.label, slot.bbox)

    out = COMPOSITE_DIR / spec.output_filename
    canvas.convert("RGB").save(out, format="PNG", optimize=True)
    try:
        archive_with_timestamp(out, COMPOSITE_HISTORY_DIR)
    except Exception:
        pass
    return out


# ══════════════════════════════════════════════════════
# 列表 + 主入口
# ══════════════════════════════════════════════════════

def list_jobs() -> None:
    print("=" * 110)
    print("PANELS  (AI-generated; 调用 OpenAI image API)")
    print("=" * 110)
    print(f"{'NAME':<18} {'SIZE':<11} {'OUTPUT':<38} DESCRIPTION")
    print("-" * 110)
    for name, job in PANELS.items():
        marker = " *" if name in MAIN_SCHEMATIC_PANELS else "  "
        print(f"{marker}{name:<16} {job.size:<11} {job.output_filename:<38} {job.description}")
    print("\n* = main schematic panel (use --main to generate just these)")

    print("\n" + "=" * 110)
    print("COMPOSITES  (PIL stitching; 不调用 API, 只读本地文件)")
    print("=" * 110)
    print(f"{'NAME':<8} {'CANVAS':<14} {'OUTPUT':<38} DESCRIPTION")
    print("-" * 110)
    for name, spec in COMPOSITES.items():
        canvas = f"{spec.canvas_size[0]}×{spec.canvas_size[1]}"
        print(f"  {name:<6} {canvas:<14} {spec.output_filename:<38} {spec.description}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="批量生成论文图集 (panel-level AI + composite PIL).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-l", "--list", action="store_true", help="列出所有 panel 与 composite")
    parser.add_argument("--panels", nargs="+", default=None, help="生成指定 panel (空格分隔)")
    parser.add_argument("--composites", nargs="+", default=None, help="拼装指定 composite")
    parser.add_argument("--all", action="store_true", help="生成所有 panel + 所有 composite")
    parser.add_argument("--main", action="store_true",
                        help="仅生成主示意图 panels (不含 13 个 pictogram), 然后拼装所有 composite")
    parser.add_argument("-w", "--workers", type=int, default=4, help="并行 worker 数 (默认 4)")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划, 不调用 API/不拼图")
    args = parser.parse_args()

    if args.list:
        list_jobs()
        return

    # ── 决定要执行的 panel 列表 ──────────────────
    if args.all:
        panels_to_run = list(PANELS.keys())
        composites_to_run = list(COMPOSITES.keys())
    elif args.main:
        panels_to_run = list(MAIN_SCHEMATIC_PANELS)
        composites_to_run = list(COMPOSITES.keys())
    else:
        panels_to_run = args.panels or []
        composites_to_run = args.composites or []

    if not panels_to_run and not composites_to_run:
        parser.error("必须指定 --all / --main / --panels / --composites 之一")

    unknown_panels = [n for n in panels_to_run if n not in PANELS]
    unknown_comp = [n for n in composites_to_run if n not in COMPOSITES]
    if unknown_panels or unknown_comp:
        if unknown_panels:
            print(f"[error] 未知 panel: {unknown_panels}")
        if unknown_comp:
            print(f"[error] 未知 composite: {unknown_comp}")
        sys.exit(1)

    print(f"[plan] panels: {len(panels_to_run)} | composites: {len(composites_to_run)}")
    for n in panels_to_run:
        print(f"  panel     {n:<18} -> {PANELS[n].output_filename}")
    for n in composites_to_run:
        print(f"  composite {n:<18} -> {COMPOSITES[n].output_filename}")

    if args.dry_run:
        print("\n[dry-run] 未执行")
        return

    # ── 第一阶段: 并行生成 panels ───────────────
    if panels_to_run:
        print(f"\n[panels] 并行生成 {len(panels_to_run)} 个 panel, workers={args.workers}\n")
        t_global = time.perf_counter()
        succ: list[tuple[str, Path, float]] = []
        fail: list[tuple[str, Exception, float]] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            future_map = {pool.submit(run_panel_job, PANELS[n]): n for n in panels_to_run}
            for fut in concurrent.futures.as_completed(future_map):
                name, result, elapsed = fut.result()
                if isinstance(result, Exception):
                    fail.append((name, result, elapsed))
                    print(f"  [FAIL ] {name:<18} ({elapsed:6.1f}s)  {type(result).__name__}: {result}")
                    tb = "".join(traceback.format_exception(type(result), result, result.__traceback__))
                    for line in tb.splitlines():
                        print(f"          {line}")
                else:
                    succ.append((name, result, elapsed))
                    print(f"  [OK   ] {name:<18} ({elapsed:6.1f}s)  -> {result}")

        elapsed = time.perf_counter() - t_global
        print(f"\n[panels] {len(succ)} 成功 / {len(fail)} 失败 / 耗时 {elapsed:.1f}s")
        if fail:
            print("[panels] 有失败任务, 后续 composite 可能受影响 (但仍会尝试)")

    # ── 第二阶段: 拼装 composites ───────────────
    if composites_to_run:
        print(f"\n[composites] 本地拼装 {len(composites_to_run)} 张 figure\n")
        for name in composites_to_run:
            spec = COMPOSITES[name]
            try:
                t0 = time.perf_counter()
                out = assemble_composite(spec)
                print(f"  [OK   ] {name:<6} ({time.perf_counter()-t0:5.2f}s)  -> {out}")
            except Exception as exc:  # noqa: BLE001
                print(f"  [FAIL ] {name:<6}  {type(exc).__name__}: {exc}")
                tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
                for line in tb.splitlines():
                    print(f"          {line}")

    print("\n[done]")


if __name__ == "__main__":
    main()
