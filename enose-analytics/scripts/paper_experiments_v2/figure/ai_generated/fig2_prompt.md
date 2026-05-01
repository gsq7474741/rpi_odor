# Fig. 2 — CARL Framework — Prompt

**目标产物路径**：`ai_generated/fig2_v1.png`
**尺寸**：1536 × 1024
**调用参考图**：`ref/nature_mi.png`（主）+ `ref/pom1.png`（学习"分子→GNN→嵌入"的流程图风格）
**插入位置**：`@results_section_v2.md:99`，§2.6 开头
**主题**：CARL 方法核心可视化（编码器 + 增强 + 损失函数几何）

---

## 中文设计意图

3-panel composite，水平排布或上下分行：

- **Panel A — Encoder Pipeline**（最大，占 50% 面积）
  输入 8 通道时序信号 → 3 个 Conv1D 块 → SE Attention → GAP → Projection → 输出 z ∈ ℝ¹²⁸
  风格类似 `ref/pom1.png` 的 panel C（GNN 训练）

- **Panel B — Domain-Specific Augmentation**（右上，25%）
  左右两列对比："Original signal" vs "Augmented"，覆盖三种增强：time warp / temporal cutout / Gaussian noise
  每种用一对小波形示意

- **Panel C — Soft-SupCon Loss Geometry**（右下，25%）
  二维 composition simplex（三角形）上画 anchor + 同成分 positive（实线拉近）+ 异成分 negative（虚线推远）

---

## English Prompt

```text
Create a clean three-panel scientific figure illustrating the CARL (Contrastive Aroma
Representation Learning) framework for a Food Control journal paper on tea blend analysis.

LAYOUT (three panels in a 2-row grid):
  - Panel A: large, occupies the entire top row.
  - Panel B: bottom-left half.
  - Panel C: bottom-right half.

Each panel has a bold uppercase letter (A, B, C) in its top-left corner, sized 14 pt
equivalent. Light cream rounded-rectangle backgrounds (#F4F1ED, 8 px corners, very thin
border #E0DBD3) softly group each panel.

================================================================================
PANEL A — ENCODER PIPELINE (top row, full width)
================================================================================

Title (above panel inside grouping box): "Channel-attentive temporal encoder"

Horizontal left-to-right pipeline with the following blocks, connected by simple
arrows with triangle heads:

  1. INPUT block (left-most): A small icon showing 8 horizontal wavy time-series lines
     stacked vertically, faintly tinted in teal-to-cyan gradient. Below the icon:
     bold text "8-channel sensor signal", smaller text "X ∈ ℝ⁸ˣᵀ".

  2. THREE STACKED CONV1D BLOCKS in a row, each drawn as a rounded teal box (#7FB7B0):
     Block 1: "Conv1D ×32", Block 2: "Conv1D ×64", Block 3: "Conv1D ×128"
     Each block shows a tiny down-arrow and small text "BN, ReLU, MaxPool" in much
     smaller font below.

  3. SE ATTENTION block: a slightly wider yellow-cream rounded box (#FFE9B0) with the
     bold label "SE Attention" inside. To the right of this box, a tiny inset shows a
     small bar chart of 8 channel weights (some tall, some short) with the caption
     "channel re-weighting".

  4. GAP block: a compact rounded grey box labelled "Global Avg Pool", with a small
     icon showing time-collapse (8 lines collapsing to 8 dots).

  5. PROJECTION HEAD: a horizontal trapezoid (narrowing left-to-right) in pink (#E5A1A8)
     labelled "FC → ReLU → FC" inside.

  6. OUTPUT: a horizontal vector of about 12 alternating teal/pink small cells,
     labelled "z ∈ ℝ¹²⁸" in bold.

All blocks aligned on a single horizontal baseline. Arrows are 1.5 pt dark-grey with
small triangle heads. Block labels in bold sans-serif inside each block; secondary
labels (BN/ReLU/MaxPool, tensor shapes) below blocks in lighter weight, smaller font.

================================================================================
PANEL B — DOMAIN-SPECIFIC AUGMENTATION (bottom-left)
================================================================================

Title: "Physics-grounded augmentations"

Two columns of three rows. Each row demonstrates one augmentation:

  Row 1 — Time warping
    Left cell: a single thin teal sine-like curve labelled "original".
    Right cell: the same curve but with a non-uniform horizontal stretch
                (compressed in the middle, stretched at the edges), labelled "warped".
    Between cells: a small wavy-arrow icon.

  Row 2 — Temporal cutout
    Left cell: thin teal curve.
    Right cell: same curve with a small grey rectangular gap covering ~10 % of the
                middle, labelled "cutout".

  Row 3 — Gaussian noise
    Left cell: smooth teal curve.
    Right cell: same curve with low-amplitude jitter overlaid, labelled "+ noise".

All curves drawn at small scale (compact panel). Use light grey baseline guides.
NO axis ticks, NO numeric labels — these are conceptual schematics.

================================================================================
PANEL C — SOFT-SUPCON LOSS GEOMETRY (bottom-right)
================================================================================

Title: "Composition-aware contrastive loss"

A small triangular simplex (composition space) with three vertices labelled "T_A",
"T_B", "T_C" (using small tea-cup icons coloured amber-orange, wine-red, tea-green
respectively). The simplex is drawn with thin dark-grey outline.

Inside the simplex:
  - One large solid teal dot labelled "anchor" near the centre-left.
  - One medium green dot near the anchor labelled "positive (similar composition)";
    a SOLID green double-headed arrow connects anchor and positive with a small "pull"
    text label.
  - One medium pink dot near the simplex edge labelled "negative (dissimilar)";
    a DASHED red double-headed arrow connects anchor and negative with a small "push"
    text label.

Below the simplex, a small inline equation in clean sans-serif:
  "L_softSupCon = − Σ w(α) · log[ exp(z·z⁺/τ) / Σ exp(z·z'/τ) ]"
where w(α) is highlighted in pink to indicate "soft composition weights".

================================================================================
GLOBAL STYLE
================================================================================
  - Pure white background overall, with the three cream grouping boxes inside.
  - Strict grid alignment within each panel.
  - Color palette restricted to:
    teal (#7FB7B0) — data / encoder branch
    pink (#E5A1A8) — projection / loss / output branch
    cream (#F4F1ED) — neutral grouping background
    dark grey (#2D2D2D) — text and arrow outlines
    SE-attention yellow-cream (#FFE9B0) — only for the SE block
    plus the three tea colours in Panel C only.
  - All typography clean sans-serif (Helvetica style); bold for panel labels and block
    titles only.
  - Connector arrows: thin (1.5 pt), dark-grey, simple triangle heads.
  - NO 3D effects, NO shadows, NO gradients (except the explicitly described teal-cyan
    sensor-signal gradient), NO clipart, NO photo textures.

REFERENCE IMAGE INSTRUCTION:
  - Match the overall layout grammar of the attached Nature Machine Intelligence figure:
    pastel-tinted rounded grouping rectangles, clean horizontal flow, two-color semantic
    encoding, bold sans-serif labels, simple triangle-head arrows.
  - Match the "encode → project → align" annotation style used in that reference's
    Panel A: text labels appear ABOVE the arrows between blocks.
  - DO NOT copy any molecular structure, drug name, or vector content from the reference.

OUTPUT: a single 1536x1024 PNG suitable for direct insertion as Figure 2 of a
Food Control journal paper.
```

---

## 调用代码

```python
from generate_image import generate_image

generate_image(
    prompt=open("ai_generated/fig2_prompt.md").read(),
    output_path="ai_generated/fig2_v1.png",
    ref_images=["ref/nature_mi.png", "ref/pom1.png"],
    size="1536x1024",
    quality="high",
)
```

---

## 后期处理

1. 在 Inkscape 中 trace bitmap → SVG
2. 检查每个 block 的标签是否准确（AI 可能拼错），需手动改为：
   `Conv1D, k=7, c=32, BN, ReLU, MaxPool/2` 等
3. **数学公式**用 LaTeX → MathJax/SVG 替换 AI 生成的（AI 对公式几乎一定会写错）
4. 输出 `paper_figure/fig2.pdf`

---

## 风险与备选

- AI 对**多组件 pipeline 的精确顺序**容易出错。如果 v1 不理想：
  - 备选方案 A：把 Panel A 单独生成（只画 encoder pipeline），B/C 单独生成，再拼合
  - 备选方案 B：直接在 Inkscape 中**手画** Panel A，AI 仅生成 B/C 两个小 schematic
- 数学公式部分 **几乎一定要重写**，不要依赖 AI 输出
