# Reusable Pictograms — Prompts

可复用的小图标，在 GA / Fig 1 / Fig 2 / Fig 5 / Fig 6 中作为视觉元素嵌入。
统一 1024 × 1024 输出，**白底**、**无文字**、**单色或双色**，方便 SVG 化后多场景复用。

---

## P1 — 茶杯图标 × 5（每种茶一张）

**目标产物路径**：`ai_generated/pictogram_teacup_T1.png` … `_T5.png`

```text
Create a single flat vector pictogram of a small Chinese tea cup viewed from the side at a
slight 3/4 angle, filled with tea liquid in the EXACT colour {COLOR_HEX}. The cup body is
white porcelain with a single thin dark-grey outline (#2D2D2D, 1.5 pt). The rim shows a
thin ellipse of liquid in the same colour as the fill.

NO handle, NO saucer, NO steam, NO decorative pattern. Cup occupies central 60 % of the
1024×1024 canvas, on a pure white background. NO shadow, NO gradient, NO 3D effect, NO
text, NO labels.

Style: minimalist scientific pictogram suitable for an academic paper graphical abstract.
Match the aesthetic of the attached Nature Machine Intelligence reference figure (clean
flat icons with thin dark outlines).

OUTPUT: 1024x1024 PNG, transparent background preferred, otherwise pure white.
```

调用 5 次，分别替换 `{COLOR_HEX}`：
- T1: `#E89B3C`
- T2: `#A33B2A`
- T3: `#6FB58A`
- T4: `#3F6FA8`
- T5: `#C57BA1`

---

## P2 — 8 通道传感器阵列图标

**目标产物路径**：`ai_generated/pictogram_sensor_array.png`

```text
Create a single flat vector pictogram showing an 8-channel metal-oxide semiconductor
sensor array. Top-down view: 8 small circular sensor elements arranged in 2 rows × 4
columns inside a thin rectangular dark-grey outlined chamber. Each sensor element is a
small filled circle in teal (#7FB7B0), with a faint concentric ring suggesting a heated
membrane.

Above the chamber, a small thin tube enters from the left labelled with a tiny arrow
indicating gas inflow. To the right, another tube exits indicating gas outflow.

Pure white background, NO 3D, NO shadows, NO gradients (except the very subtle ring on
each sensor). NO text, NO numerical labels. Style: clean scientific pictogram in the
visual idiom of the attached Nature Machine Intelligence reference.

OUTPUT: 1024x1024 PNG.
```

---

## P3 — 蠕动泵图标

**目标产物路径**：`ai_generated/pictogram_peristaltic_pump.png`

```text
Create a single minimalist flat vector pictogram of a peristaltic pump. Side view of a
circular rotor head with three small rollers compressing a curved transparent tube wrapped
around the rotor. The rotor body is filled with light cream (#F4F1ED), the tube outlined
in dark grey (#2D2D2D, 1.5 pt). A small motor box on the left.

Pure white background. NO shadows, NO 3D, NO gradients. NO text, NO labels.
Suitable as a tiny icon (will be displayed at 64-128 px width in the actual figure).

OUTPUT: 1024x1024 PNG.
```

---

## P4 — Recipe Equivalence Check 图标

**目标产物路径**：`ai_generated/pictogram_recipe_check.png`

```text
Create a single flat vector pictogram: two small overlapping tea cups (one filled with
amber-orange tea, the other with deep wine-red tea), side by side, with a thin equals-sign
"≈" between them. Below the equals sign, a small green checkmark (✓) inside a thin circle
outline.

Pure white background, NO 3D, NO shadows. Style: minimalist scientific pictogram, dark-grey
outlines (#2D2D2D, 1.5 pt). Matches the icon style of the attached Nature Machine
Intelligence reference figure.

OUTPUT: 1024x1024 PNG.
```

---

## P5 — Aroma Gap 图标

**目标产物路径**：`ai_generated/pictogram_aroma_gap.png`

```text
Create a single flat vector pictogram: a 2D scatter plot inside a thin circular boundary
showing four colored cluster blobs (amber-orange, wine-red, tea-green, deep-blue) and one
empty dashed-circle region in the centre with a question mark "?" inside.

Pure white background. NO 3D, NO shadows. Outlines in dark grey (#2D2D2D, 1.5 pt).
Style consistent with the attached Nature Machine Intelligence reference figure.

OUTPUT: 1024x1024 PNG.
```

---

## P6 — Augmentation Wave Pair Icon (3 variants for Fig. 2 Panel B)

**目标产物路径**：`ai_generated/pictogram_aug_timewarp.png`,
`pictogram_aug_cutout.png`, `pictogram_aug_noise.png`

```text
Create three separate flat vector pictograms, each showing a pair of small horizontal
sinusoidal time-series curves in teal (#7FB7B0), with a small wavy arrow between them
indicating transformation.

Variant 1 (timewarp): left curve is a smooth sine; right curve is the same sine but
non-uniformly stretched horizontally (compressed in middle, stretched at the edges).

Variant 2 (cutout): left curve is a smooth sine; right curve has a small grey rectangular
gap covering ~10 % of the middle.

Variant 3 (noise): left curve is smooth; right curve has low-amplitude jitter overlaid.

Each curve drawn at small scale within a 1024x1024 canvas, on pure white background.
Outlines and arrows in dark grey (#2D2D2D, 1.5 pt). NO axis ticks, NO text, NO numerical
labels. Style: minimalist scientific pictogram.

OUTPUT: three 1024x1024 PNGs, one per variant.
```

---

## 批量调用代码

```python
from generate_image import generate_image
from pathlib import Path

PROMPTS = {
    "pictogram_teacup_T1": "...colour #E89B3C...",
    "pictogram_teacup_T2": "...colour #A33B2A...",
    # ...
    "pictogram_sensor_array": open("ai_generated/pictograms_prompt.md").read(),
    # 实际使用时切分到独立 prompt 文件
}

for name, prompt in PROMPTS.items():
    generate_image(
        prompt=prompt,
        output_path=f"ai_generated/{name}.png",
        ref_images=["ref/nature_mi.png"],
        size="1024x1024",
        quality="high",
    )
```

---

## 使用矩阵

| Pictogram | GA | Fig 1 | Fig 2 | Fig 5 | Fig 6 |
|-----------|----|-------|-------|-------|-------|
| Teacup ×5 | ✓ | ✓ (Panel D 茶样品行) | ✓ (Panel C simplex 顶点) |   |   |
| Sensor array | ✓ | ✓ (Panel B 简化版) |   |   |   |
| Peristaltic pump | ✓ |   |   |   |   |
| Recipe check | ✓ |   |   |   |   |
| Aroma gap | ✓ |   |   |   |   |
| Aug wave pair |   |   | ✓ (Panel B) |   |   |

矢量化后存于 `paper_figure/pictograms/*.svg`，所有图复用同一 SVG。
