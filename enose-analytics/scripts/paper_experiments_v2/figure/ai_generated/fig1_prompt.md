# Fig. 1 — Platform and Experimental Design — Prompt

**目标产物路径**：`ai_generated/fig1_v1.png`
**尺寸**：1536 × 1024（横向 3:2）
**调用参考图**：`ref/nature_mi.png` + `ref/pom1.png`
**插入位置**：`@results_section_v2.md:49`，§2.2 末
**主题**：硬件平台 + 两阶段实验设计 一图概览

---

## 中文设计意图

合并原有 Fig 1 (3 子图) + Fig 2 (workflow) 为单一 4-panel composite。

- **Panel A**（占左半，约 50% 面积）：自动化电子鼻平台**实拍照**——这部分**不能让 AI 生成**，留作位图占位即可。AI 仅生成"占位框 + 标签 A"，后期手动替换。
- **Panel B**（右上）：腔体 3D CAD 渲染——同样保留实拍/CAD 渲染源文件（`fig0b_chamber_3d.png`），AI 仅生成占位。
- **Panel C**（右中）：CFD 流场——保留 `fig0c_chamber_cfd.png` 占位。
- **Panel D**（横贯底部）：两阶段实验流程**纯 schematic**，**这一部分由 AI 生成**。

> 实施策略：先让 AI 单独生成 **Panel D 的 workflow schematic**（详见下方提示词），后期在 Inkscape 中用 A/B/C 占位框 + AI 生成的 D 拼成完整 Fig 1。

---

## English Prompt（生成 Panel D — 实验流程图）

```text
Create a clean horizontal scientific workflow diagram for a tea-blending electronic-nose
experimental design. The diagram is a SINGLE WIDE PANEL (no sub-panels), showing two
parallel experimental phases that converge into a combined dataset.

LAYOUT: horizontal flow from left to right, two parallel rows in the middle.

LEFT-MOST: a soft cream rounded rectangle (#F4F1ED, 8 px corners) labelled "Tea Samples"
in bold sans-serif, containing five small tea-cup icons in a single horizontal row, each
filled with one of the tea colors:
  T1 amber-orange (#E89B3C), T2 wine-red (#A33B2A), T3 tea-green (#6FB58A),
  T4 deep-blue (#3F6FA8), T5 purple-pink (#C57BA1).
Each cup has a small T1-T5 label below.

CENTER-TOP — Phase 1 row, in a teal-tinted (#7FB7B0 at 25 % opacity) rounded box:
  - Header text "Phase 1 — Pure-tea fingerprints" in bold.
  - Three labelled mini-icons in a row:
    (1) "5 teas × ~64 replicates"
    (2) a small randomised-shuffle icon labelled "randomised order"
    (3) "n = 320 measurements" in bold
  - A right-pointing thin arrow exits this row toward the merge point on the right.

CENTER-BOTTOM — Phase 2 row, in a pink-tinted (#E5A1A8 at 25 % opacity) rounded box:
  - Header text "Phase 2 — Binary blends" in bold.
  - Three labelled mini-icons in a row:
    (1) "C(5,2) = 10 pairs" with a small pair-of-cups icon
    (2) "9 ratio steps: 0.1, 0.2, …, 0.9" with a tiny gradient bar
    (3) "n = 370 measurements" in bold
  - A right-pointing thin arrow exits this row toward the merge point on the right.

RIGHT-MOST: a dark-cream rounded rectangle (#F4F1ED with darker border) labelled
"Combined Dataset", containing the bold text "n = 690 total" and below it
"Stratified 5-fold CV". The two arrows from Phase 1 and Phase 2 visibly merge here.

OPTIONAL TOP-RIGHT MINI-BOX: a small box labelled "Quality Control" in a neutral-grey tint,
listing very small icons: "daily anchor (T2)", "blank (DI water)", "load-cell injection log",
"drift correction".

GLOBAL STYLE:
  - Pure white background.
  - All boxes use 8 px rounded corners with a thin border (#E0DBD3 1 px).
  - Two semantic colours only for the two phase tints: teal (#7FB7B0) for data-input phases,
    pink (#E5A1A8) for the binary-blend phase. Neutral cream (#F4F1ED) for tea samples and
    dataset boxes.
  - Connector arrows: 1.5 pt dark-grey (#2D2D2D) with simple triangle heads.
  - All typography in clean sans-serif (Helvetica style); bold ONLY for box headers and
    sample-count totals; everything else regular weight.
  - NO panel labels, NO ABC letters (this is one panel, will be inserted as Panel D later).
  - NO em dashes (use "—" minimally only inside header phrases).
  - NO 3D, NO shadows, NO gradients, NO clipart.
  - Strict grid alignment: all horizontal arrows on a shared baseline; all icons aligned to
    a vertical baseline within each row.

REFERENCE IMAGE INSTRUCTION:
  - Closely match the workflow-box style of the attached Nature Machine Intelligence figure:
    soft pastel rounded rectangles grouping flow stages, thin clean arrows, bold sans-serif
    headers, and a strong sense of left-to-right narrative.
  - DO NOT copy molecular structures, text-content, or images from the reference;
    ONLY adopt the visual grammar.

OUTPUT: a single 1536x768 PNG, banner-style, suitable for use as Panel D of a Food Control
methods figure.
```

---

## 调用代码

```python
from generate_image import generate_image

# 仅生成 Panel D (workflow schematic)
generate_image(
    prompt=open("ai_generated/fig1_prompt.md").read(),
    output_path="ai_generated/fig1_panelD_v1.png",
    ref_images=["ref/nature_mi.png"],
    size="1536x1024",
    quality="high",
)
```

---

## 后期合成（Inkscape）

```
fig1.svg
├─ Panel A (50%, 左半)  ← elsarticle/figures/fig0a_platform_photo.png
├─ Panel B (25%, 右上)  ← elsarticle/figures/fig0b_chamber_3d.png
├─ Panel C (25%, 右中)  ← elsarticle/figures/fig0c_chamber_cfd.png
└─ Panel D (100%, 底部) ← ai_generated/fig1_panelD_v1.png（AI 生成）
```

每个 panel 左上角加 **粗体 A/B/C/D**，统一字体 Helvetica 14 pt Bold。
