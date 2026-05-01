# 论文图集统一设计规范 (Master Design System)

本文件定义全文 7 张图（1 GA + 6 main figures）共用的视觉规范。所有 AI 生成的提示词、所有 matplotlib 生成的代码都必须遵守此文件。

---

## 一、配色系统 (Color Palette)

### 1.1 茶叶 5 色 (Semantic — 跨全图锁定)

| 茶 | 名称 | Hex | RGB | 用途 |
|----|------|-----|-----|------|
| T1 | Oolong | `#E89B3C` | (232, 155, 60) | 琥珀橙（半氧化乌龙） |
| T2 | Black | `#A33B2A` | (163, 59, 42) | 深酒红（全氧化红茶） |
| T3 | Jasmine | `#6FB58A` | (111, 181, 138) | 茶绿（茉莉花茶） |
| T4 | XQG Pu-erh | `#3F6FA8` | (63, 111, 168) | 深蓝（小青柑普洱） |
| T5 | Dark Roast | `#C57BA1` | (197, 123, 161) | 紫粉（重焙乌龙） |

**约束**：以上 5 色必须在所有数据图、所有 schematic 中一致使用。一个 hex 一种茶，永不互换。

### 1.2 方法对比双色 (Method Comparison)

| 类型 | Hex | 用途 |
|------|-----|------|
| Ours (CARL) | `#E07B3C` | 暖橙——突出我们的方法 |
| Baseline | `#7A7A7A` | 中性灰——所有对照方法 |
| Highlighted baseline | `#1F1F1F` | 黑——最强 baseline |

### 1.3 Schematic 双色 (用于流程图、概念图)

| 类型 | Hex | 用途 |
|------|-----|------|
| Data / Input branch | `#7FB7B0` | 青绿（信号、传感器、数据） |
| Model / Output branch | `#E5A1A8` | 浅粉（模型、嵌入、输出） |
| Neutral box | `#F4F1ED` | 米白（中性背景） |
| Accent dark | `#2D2D2D` | 接近黑（文字、边框） |

> 该方案直接借鉴 `ref/nature_mi.png` (MoleculeSTM) 的色彩语义。

### 1.4 NLDI / 热图渐变

- **顺序色**：`YlOrRd` (matplotlib) — 黄 `#FFFFCC` → 红 `#800026`
- 无意义的零值用浅米白 `#F4F1ED` 而非纯白

---

## 二、字体规范

| 元素 | 字体 | 字号 (相对) | 加粗 |
|------|------|------------|------|
| Panel 标签 (A/B/C) | Helvetica / Arial Bold | 14 pt 等效 | **Bold** |
| 图内主标题 | Helvetica / Arial | 11 pt | Regular |
| 坐标轴标签 | Helvetica / Arial | 9 pt | Regular |
| 数据数值标注 | Helvetica / Arial | 8 pt | Regular |
| Legend | Helvetica / Arial | 8 pt | Regular |

**禁止**：衬线字体 (Times)、艺术字体 (Comic Sans)、斜体（除变量名 *p*, *R*² 外）。

---

## 三、几何与排版

### 3.1 Panel 标签
- 位置：每个 panel **左上角**，字号显著大于正文
- 格式：**粗体大写字母**（A/B/C/D）后接细黑点或不接标点
- 颜色：`#1F1F1F`（深灰，比纯黑柔和）

### 3.2 边框与背景
- 主图整体：**纯白背景**
- Panel 分组：用 `#F4F1ED` 浅米色圆角矩形作浅淡背景（参考 `ref/nature_mi.png`）
- 圆角半径：约 8 px
- 边框：极淡 `#E0DBD3`，1 px

### 3.3 箭头与连接线
- 默认 1.5 pt 实线
- 箭头使用三角形实心箭头，宽度约 8 px
- 拉近/同类：实线
- 推远/对比：虚线

### 3.4 阴影
- **全文禁止使用阴影、渐变、3D 效果**

---

## 四、参考图使用约定

| 参考图路径 | 学习内容 |
|------------|---------|
| `ref/nature_mi.png` | **主参考**：分组浅色背景 + 双色语义编码 + 简洁箭头流程 |
| `ref/pom1.png` | 多 panel 组合方式、就地标注、PCA 可视化、inset 用法 |
| `ref/pom2.png` | 大 panel 配小 panel 的层级感、柱状图配色 |

**调用建议**：所有 schematic 类提示词都附 `ref/nature_mi.png` 作主参考；视情况附 `ref/pom1.png` 强化数据可视化部分。

---

## 五、提示词通用尾段（Style Anchor）

每个 prompt 末尾都应附带以下"风格锚点"，确保跨图一致：

```
STYLE: flat vector scientific illustration, publication quality for Food Control / Nature Machine Intelligence,
clean sans-serif typography (Helvetica style), white background, no shadows, no 3D effects, no gradients,
2 pt line weight, 8 px corner radius for grouping boxes, panel labels (A, B, C) in bold uppercase top-left,
colors restricted to: tea palette (#E89B3C, #A33B2A, #6FB58A, #3F6FA8, #C57BA1) +
schematic palette (#7FB7B0 teal, #E5A1A8 pink, #F4F1ED cream, #2D2D2D dark) +
method palette (#E07B3C ours-orange, #7A7A7A baseline-grey, #1F1F1F highlight-black).
No emojis, no decorative elements, no clipart. Layout must be precise and grid-aligned.
```

---

## 六、生成与保存约定

### 6.1 输出路径
- AI 生成图（PNG 中间产物）：`ai_generated/<fig_id>_v<n>.png`
- 矢量化后产物：`paper_figure/<fig_id>.svg` + `<fig_id>.pdf`
- matplotlib 数据图：直接生成到 `paper_figure/<fig_id>.pdf`

### 6.2 调用模板

```python
from generate_image import generate_image

generate_image(
    prompt=open("prompt/fig1.md").read(),  # 把 prompt md 整段作为提示词
    output_path="ai_generated/fig1_v1.png",
    ref_images=["ref/nature_mi.png", "ref/pom1.png"],
    size="1024x1536",   # 竖版 GA 用 1024x1024，横版 composite 用 1536x1024
    quality="high",
)
```

### 6.3 尺寸建议

| 图 | 尺寸 (像素) | 比例 |
|----|------------|------|
| Graphical Abstract | 1536 × 1024 | 横向 3:2 |
| Fig. 1 (4 panel) | 1536 × 1024 | 横向 3:2 |
| Fig. 2 (3 panel) | 1536 × 1024 | 横向 3:2 |
| Pictogram 单元 | 1024 × 1024 | 1:1 |

---

## 七、AI 生成 vs matplotlib 分工

| 图 | 生成方式 | 原因 |
|----|---------|------|
| GA | **AI 生成 + 后期 SVG 矢量化** | 纯示意 + 美学要求高 |
| Fig 1 | **AI 生成主框架 + 实拍照/CAD 后期合成** | 工作流图适合 AI；硬件部分需保真 |
| Fig 2 | **AI 生成** | 纯 schematic |
| Fig 3 | **matplotlib** | 强数据驱动 |
| Fig 4 | **matplotlib** | 强数据驱动（KDE 等高线 + 轨迹） |
| Fig 5 | **matplotlib** | 强数据驱动 |
| Fig 6 | **matplotlib** | 强数据驱动 |
| Pictograms | **AI 生成** | 用作 Fig 1/2/GA 的图形元素 |

**AI 生成的产物务必经过 Inkscape 描摹矢量化**，避免 PNG 在期刊排版中模糊。
