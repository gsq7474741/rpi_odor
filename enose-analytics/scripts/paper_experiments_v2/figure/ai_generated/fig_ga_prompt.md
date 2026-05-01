# Graphical Abstract — Prompt

**目标产物路径**：`ai_generated/fig_ga_v1.png`
**尺寸**：1536 × 1024（横向 3:2）
**调用参考图**：`ref/nature_mi.png`（主，强制风格统一）+ `ref/pom1.png`（学习色彩与图层结构）
**用途**：投稿 cover image / TOC entry，30 秒讲清全文

---

## 中文设计意图

横向叙事三段：
1. **左：Inputs** — 5 杯不同茶汤的简笔图标 → 自动化电子鼻平台简化剖面
2. **中：CARL** — 8 通道传感器信号 → 编码器 → 128 维嵌入向量
3. **右：Outputs** — 茶叶香气图谱（5 个色簇 + 拼配轨迹）+ 两个应用图标（配方一致性 ✓、香气空白 ?）

不出现具体网络细节、不出现公式。读者一眼看懂"输入是什么、做了什么、输出是什么"。

---

## English Prompt（直接贴入 generate_image）

```text
Create a horizontal scientific graphical abstract for a Food Control journal paper on tea blend
analysis using an electronic nose with contrastive learning. Layout is a single horizontal banner
divided into THREE visually-connected stages by light arrows, NO panel labels A/B/C.

LEFT THIRD — "Tea Inputs and E-nose Platform":
  - Five small tea-cup icons in a vertical column, each filled with a distinct color:
    amber-orange (#E89B3C, oolong), deep wine-red (#A33B2A, black tea),
    tea-green (#6FB58A, jasmine), deep-blue (#3F6FA8, pu-erh),
    purple-pink (#C57BA1, dark-roast oolong). Each cup has a 1-character label T1-T5 below.
  - To the right of the cups, a clean cross-section illustration of an automated e-nose:
    a small rectangular sensing chamber with eight tiny sensor dots inside, an air pump symbol,
    and a curved tube delivering vapour from a tea-vial into the chamber.
  - All elements drawn as flat vector with thin (1.5 pt) dark-grey outlines, no 3D, no shadows.
  - A single thin arrow exits this section to the right.

MIDDLE THIRD — "CARL Contrastive Encoder":
  - Eight thin wavy time-series lines stacked vertically (representing 8 sensor channels),
    color-faded from teal (#7FB7B0) to dark cyan, on a soft cream background tile (#F4F1ED)
    with 8 px rounded corners.
  - Arrow labelled "encode" pointing into a stylised encoder block: a horizontal trapezoid
    in pink (#E5A1A8) with the text "CARL Encoder" in clean sans-serif.
  - Output of the encoder is a small horizontal vector of 8 colored cells (alternating teal
    and pink), labelled below as "z ∈ ℝ¹²⁸".
  - Below the vector, a tiny inset shows two small dots (anchor and positive) being pulled
    together by a solid green arrow, and an anchor and negative being pushed apart by a
    dashed red arrow. Compact, no text other than "pull / push".
  - A single thin arrow exits this section to the right.

RIGHT THIRD — "Tea Aroma Map and Applications":
  - A circular "aroma map": a 2D scatter plot inside a soft circular boundary, showing 5
    well-separated clusters in the same five tea colors above. Smooth curved lines connect
    cluster pairs to suggest blend trajectories, with small grey dots along each line.
  - Below the aroma map, two small application icons stacked or side-by-side:
    (1) a green checkmark inside a circle labelled "Recipe equivalence";
    (2) a question-mark inside a circle labelled "Aroma gap".
  - All elements flat, vector, minimal.

GLOBAL STYLE:
  - Pure white background.
  - Three light cream rounded rectangles (#F4F1ED, 8 px corners, very subtle border #E0DBD3)
    softly group each of the three stages.
  - Connector arrows between stages: thin dark-grey (#2D2D2D), 1.5 pt, with simple triangle heads.
  - All typography in clean sans-serif (Helvetica style), bold for emphasis only on
    "CARL Encoder" and stage headings.
  - NO em dashes, NO decorative gradients, NO drop shadows, NO 3D effects, NO photographic textures.
  - Color palette restricted to: tea palette (#E89B3C, #A33B2A, #6FB58A, #3F6FA8, #C57BA1) +
    schematic palette (#7FB7B0 teal, #E5A1A8 pink, #F4F1ED cream, #2D2D2D dark) +
    method palette (#E07B3C ours-orange).

REFERENCE IMAGE INSTRUCTION:
  - Match the OVERALL composition and color sensibility of the attached Nature Machine Intelligence
    figure: light pastel grouping boxes, two-color semantic encoding, clean sans-serif text,
    arrows with small triangle heads, all elements aligned on an invisible grid.
  - DO NOT copy the molecular structures or vectors from the reference; ONLY borrow the layout
    style and color discipline.

OUTPUT: a single 1536x1024 PNG, journal-publication quality, suitable for a Food Control TOC entry.
```

---

## 调用代码

```python
from generate_image import generate_image

generate_image(
    prompt=open("ai_generated/fig_ga_prompt.md").read(),
    output_path="ai_generated/fig_ga_v1.png",
    ref_images=["ref/nature_mi.png", "ref/pom1.png"],
    size="1536x1024",
    quality="high",
)
```

---

## 后期处理

1. AI 输出的 PNG 在 Inkscape 中描摹为 SVG
2. 把 5 杯茶颜色精确替换为 §1.1 配色（API 输出可能有色差）
3. 把"CARL Encoder"等文字重输为 Helvetica 矢量文字
4. 导出 PDF 到 `paper_figure/fig_ga.pdf`
