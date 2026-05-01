# Tea-Blend Paper · Figure Plan & Workflow

> Single source of truth for the paper's figure programme.
> 修改任何 figure / panel 后**必须**同步更新此文档。
> 目标期刊：no graphical abstract section。GA composite 仅作内部资产保留。

## §0 文档地图

- [§1 设计哲学](#1-设计哲学)
- [§2 色板与风格规则（强制）](#2-色板与风格规则强制)
- [§3 论文 Figure 清单（树状结构）](#3-论文-figure-清单)
- [§4 资产类型与命名约定](#4-资产类型与命名约定)
- [§5 制作工作流](#5-制作工作流)
- [§6 命令速查](#6-命令速查)
- [§7 当前进度 / TODO](#7-当前进度--todo)
- [§8 决策日志](#8-决策日志)

---

## §1 设计哲学

三层架构：

```
panel (元素材) ──┐
                 ├─► composite (Pillow 拼装) ─► manuscript (插入手稿)
matplotlib data ─┘
```

**核心原则**：

1. 示意图最少字、数据图最完整字
2. 每个 panel 独立成立（单独打印也能识别功能）
3. AI 生成示意 / matplotlib 画数据 / Pillow 拼装（职责分离）
4. 设计语法借鉴四类参考图 (`figure/ref/`)：

   | 参考 | 角色 | 核心结构 |
   |------|------|----------|
   | **pom1** | Hero / overview | A 概念 + B 数据 + C 方法 + D/E/F 横排 PCA |
   | **nature_mi** | 纯方法学 | 2-4 panel 一致视觉, 全示意零数据 |
   | **pom3** | 深度量化 | 多组并列条形 + 累积分布 + 差异 bar |
   | **pom4** | 单一现象深挖 | A 例子示意 + B-F 一致 violin 对比 |

---

## §2 色板与风格规则（强制）

### 茶色板 TEA_COLORS

| ID | 颜色 | Hex | 茶种 |
|:--:|------|:----|------|
| T1 | amber-orange | `#E89B3C` | 乌龙茶 (oolong) |
| T2 | wine-red | `#A33B2A` | 工夫红茶 (Gongfu black) |
| T3 | tea-green | `#6FB58A` | 茉莉花茶 (jasmine) |
| T4 | deep-blue | `#3F6FA8` | 小青柑普洱 (XQG pu-erh) |
| T5 | purple-pink | `#C57BA1` | 焙火乌龙 (dark roast oolong) |

### 示意色板

| 用途 | 颜色 | Hex |
|------|------|-----|
| data | teal | `#7FB7B0` |
| model | pink | `#E5A1A8` |
| neutral | cream | `#F4F1ED` |
| stroke | dark grey | `#2D2D2D` |

### 通用风格规则（AI panel + matplotlib 共用）

| 规则 | 说明 |
|------|------|
| 背景 | 必须纯白 `#FFFFFF` |
| 描边 | 1.5 pt `#2D2D2D` 深灰 |
| 字体 | Helvetica-style sans-serif；bold 仅用于标题 / n-values / panel label |
| 禁忌 | 无 3D、无 drop shadow、无 clipart、无照片纹理、无渐变（除非含义必要） |
| 文字 | schematic 几乎无字；data plot 才有完整轴 / 图例 |
| 输出 | PNG dpi ≥ 300；矢量优先（同步导出 SVG/PDF） |

> **CRITICAL**: matplotlib data plot **必须**显式覆盖 matplotlib 默认色板与字体，否则视觉与 AI panel 不连贯。推荐 rcParams 模板见 §5.2。

### Prompt 风格锚点

源于 `batch_generate.py`：
- `STYLE_ANCHOR_MINIMAL` — schematic panel 用
- `STYLE_ANCHOR_PICTOGRAM` — 小型 pictogram 用

修改风格规则时**必须**同步修改这两个常量。

---

## §3 论文 Figure 清单

```
论文图集 (5 张主图)
├── Fig 1   Hero overview                  (end-to-end AI single image)
├── Fig 2   Hardware platform              (3-panel L-shape, 简化)
├── Fig 3   CARL methods                   (3-panel, nature_mi-style)
├── Fig 4   Pure-tea & non-linear blend    (5-panel A-E, pom2/pom3-style, MERGED)
└── Fig 5   Quantitative comparison        (4-panel 2×2, pom3-style)

补充：
├── GA (composite_ga_v1.png) — 期刊不需要，仅内部
└── Supplementary (manuscript/figures_v2/fig_sm_*) — 完全保留
```

### Fig 1 — Hero overview (end-to-end single AI image)

> **不再拼接**：整张图由 AI 一次性端到端生成（单次 `generate_image()` 调用）。
> 参考手绘草图 `ref/hand_draw/enose-1.jpg`。
> 核心叙事：**硬件系统 → CARL 框架 → 下游应用**。

**类型**：AI 端到端生成（A 类）
**输出文件**：`figure/ai_generated/fig1_hero_v<N>.png`
**尺寸**：1920×960（16:9 横幅，dpi ≥ 300）

布局 (3 列，按手绘草图)：

```text
┌──── LEFT ──────┬───── MIDDLE ──────┬───── RIGHT ─────┐
│ "Tea Blend     │ "CARL Framework"  │ "Applications"  │
│  Aroma E-nose  │                   │                 │
│  System"       │  ×8 sensor tile   │  I. cup≈cup? ✓  │
│                │    ↓              │     (识别)      │
│  5 茶杯        │  CARL Encoder     │  II. cup→cup?   │
│  → 管路汇合    │    ↓              │     (比例预测)  │
│  → 洗气瓶      │  embeddings       │  III. Aroma Map │
│  (Air→/Vac→)   │  + contrastive    │     (PCA散点    │
│  → 泵          │    pull/push      │      +茶杯标注) │
│  → 传感腔      │    with tea cups  │                 │
└────────────────┴──────────────────┴─────────────────┘
```

**参考图（仅借鉴风格/构图，不硬粘贴）**：

| 参考图 | 借鉴内容 | 文件 |
|--------|---------|------|
| `panel_ga_hardware_v1.png` | 左列：5 茶杯造型、管路汇聚方式、洗气瓶/传感腔的图标风格 | `ai_generated/` |
| `panel_ga_outcomes_v1.png` | 右列：cup≈cup 对比、彩色点簇 aroma map、亚叠加曲线的表达方式 | `ai_generated/` |
| `fig_aroma_map_v2.png` | 右列 III：PCA 散点图的 5 色分簇效果（手绘风格概念化，非照搬数据） | `manuscript/figures_v2/` |

**Prompt 设计要点**：

- prompt 中明确写 **"Draw this as a single cohesive illustration, NOT a collage of separate panels"**
- 三列之间用自然的箭头/流线连接，不要用硬隔线分割
- 左列硬件：**借鉴** `panel_ga_hardware_v1.png` 的极简 line-art 茶杯和管路风格，但整合到全图
- 中列 CARL：
  - 传感器输出用 **8 条堆叠 barcode 色条**（×8 标注），非 8 条独立波形
  - "CARL Encoder" 用圆角矩形框
  - 下方 embeddings 用茶杯 + 箭头表示 pull/push
- 右列 Applications 三层：
  - I: 两杯 ≈ 符号 → 勾（相似性判断）
  - II: 两杯 → 箭头 → ? 杯（比例预测）
  - III: Aroma Map 方框内有 **5 色点簇**，簇旁有小茶杯图标标注，**借鉴** `fig_aroma_map_v2.png` 的分簇效果但用示意风格
- prompt 末尾追加 `STYLE_ANCHOR_MINIMAL`
- prompt 中加入：**"Reference images are provided for STYLE INSPIRATION ONLY — do not copy or paste them; re-draw all elements from scratch in a unified visual language"**

**Caption (EN)**:
> **Fig. 1.** Overview of the tea-blend aroma analysis framework. *(Left)* Five tea types are blended at controlled ratios; head-space vapour is purified through a gas-washing bottle and delivered to a custom 8-sensor chamber. *(Centre)* The CARL framework: 8-channel sensor responses (shown as stacked barcode strips) are encoded into a compact aroma embedding; composition-aware contrastive learning pulls similar blends together and pushes dissimilar ones apart. *(Right)* Downstream applications: (I) blend similarity verification, (II) blend-ratio prediction, and (III) an aroma map where PCA of CARL embeddings reveals five well-separated pure-tea clusters with blend trajectories.

**Caption (CN)**:
> **图1.** 茶叶拼配香气分析框架概览。*（左）* 五种茶以受控比例拼配，顶空气体经洗气瓶净化后送入定制八传感器腔。*（中）* CARL 框架：8 通道传感器响应（以堆叠 barcode 色条呈现）经编码器映射为紧凑嵌入；成分感知对比学习拉近相似拼配、推远不相似拼配。*（右）* 下游应用：(I) 拼配相似性验证，(II) 拼配比例预测，(III) 香气图谱——CARL 嵌入 PCA 呈现五类纯茶清晰分簇及拼配轨迹。

---

### Fig 2 — Hardware platform (简化)

布局 (1920×1280, L-shape):
```
┌── A ──┬── B ──┐
│       │       │ 上 960×640
│Photo  ├───────┤
│整列   │   C   │ 下 960×640
└───────┴───────┘  A 占 960×1280
```

| Panel | 内容 | 类型 | 文件 | 状态 |
|:---:|------|:---:|------|:---:|
| A | 8通道电子鼻平台实拍 | photo 复用 | `manuscript/elsarticle/figures/fig0a_platform_photo.png` | ✅ |
| B | 传感腔 3D CAD 模型 | render 复用 | `manuscript/elsarticle/figures/fig0b_chamber_3d.png` | ✅ |
| C | 传感腔 CFD 流场仿真 | sim 复用 | `manuscript/elsarticle/figures/fig0c_chamber_cfd.png` | ✅ |

**Caption (EN)**:
> **Fig. 2.** Custom-built automated e-nose platform. **(A)** Photograph of the assembled platform (aluminium-alloy frame, 8 peristaltic pumps, gas-washing bottle, diaphragm air pump, activated-carbon filter, silicone tubing). **(B)** 3D CAD model of the CFD-optimised aluminium-alloy sensing chamber (~4.44 mL internal volume, 8 BME688 MOS sensors as 4 temperature-setpoint groups of 2). **(C)** CFD flow simulation of the sensing chamber.

**Caption (CN)**:
> **图2.** 定制自动化电子鼻平台。**(A)** 组装平台照片（铝合金框架、八台蠕动泵、气洗瓶、隔膜气泵、活性炭过滤器、硅胶管路）。**(B)** CFD 优化的铝合金传感腔 3D CAD 模型（内部容积约 4.44 mL，8 个 BME688 MOS 传感器分为四个温度设定点组）。**(C)** 传感腔 CFD 流场仿真。

> **变更**：旧 Fig 1 中的 Workflow Panel D 已移除。两阶段实验设计通过 Fig 1A 文字 + §2.3 章节描述呈现。

---

### Fig 3 — CARL methods (redesigned)

> Panel A/B 需要重新生成。传感器信号表示**必须遵守 §5.0 规范**。

布局 (1920×1280):

```text
┌─────── A ───────┐  全宽 1920×640
│ 完整编解码器    │
│ 架构            │
├─── B ───┬── C ──┤  960×640 each
│ 多种aug │simplex│
└─────────┴───────┘
```

| Panel | 内容 | 类型 | 文件 | 状态 |
|:---:|------|:---:|------|:---:|
| A | **完整编解码器架构**：8×T 热图瓦片输入 → Conv1D blocks → SE re-weighting → GAP → projection head → 128-d embedding；需包含 decoder（如有）| AI 改 prompt | `panel_fig3_encoder_v2.png` | 🔧 TODO |
| B | **多种数据增强**：≥5 种增强卡片（time warp / baseline shift / channel dropout / Gaussian noise / amplitude scaling / time masking），每张卡片用"输入 → 变换 → 输出"三列示意，输入用 8×T 热图瓦片 | AI 改 prompt | `panel_fig3_aug_v2.png` | 🔧 TODO |
| C | 3-cup composition simplex with attract/repel arrows | AI 复用 | `panel_fig2_loss_v1.png` | ✅ |

**Panel A prompt 改进重点**：
- ❌ 旧版 `fig2_v1.png` 中输入画成了 "8 条毛线"
- ✅ 输入改为 **8×T 色块热图**（channel × time → 小矩形色块网格）
- ✅ 展示**完整**的编码器架构细节（Conv1D → BN → ReLU → SE → GAP → MLP → L₂-norm）
- ✅ 如论文包含 decoder/重构分支，也要画出来

**Panel B prompt 改进重点**：
- ❌ 旧版只有 4 种增强，且输入同样是 "8 条曲线"
- ✅ 增加到 ≥5 种增强类型
- ✅ 每种增强用**对比卡片**形式：左=原始热图, 中=变换示意, 右=增强后热图
- ✅ 传感器信号统一用 8×T 热图瓦片

**Caption (EN)**:
> **Fig. 3.** The CARL framework. **(A)** Encoder architecture: 8-channel sensor responses (8×T heatmap) pass through temporal convolution blocks with Squeeze-and-Excitation channel re-weighting, global average pooling, and a two-layer projection head to produce a 128-d *L*₂-normalised aroma embedding. **(B)** Domain-specific data augmentations — time warping, baseline shift, channel dropout, Gaussian noise, amplitude scaling, and time masking — simulate the principal noise modes of the platform; each card shows the original response tile, the applied perturbation, and the augmented output. **(C)** Composition-aware contrastive geometry: in the tea-blend simplex (vertices = pure teas), embeddings of compositionally similar samples are pulled together (solid arrow); dissimilar ones are pushed apart (dashed arrow); attractive weight scales with composition similarity.

**Caption (CN)**:
> **图3.** CARL 框架。**(A)** 编码器架构：8 通道传感器响应（8×T 热图）经时序卷积块、SE 通道再加权、全局平均池化和两层投影头，生成 128 维 *L*₂ 归一化嵌入。**(B)** 领域特定数据增强 — 时间扭曲、基线漂移、通道丢弃、高斯噪声、幅度缩放、时间遮蔽 — 模拟平台主要噪声模式；每张卡片依次展示原始响应瓦片、扰动方式和增强后输出。**(C)** 成分感知对比几何：单纯形顶点为纯茶，成分相似样本被拉近（实线），相异样本被推远（虚线）；吸引权重 ∝ 成分相似度。

---

### Fig 4 — Pure-tea characterisation & non-linear blend additivity (MERGED, pom2/pom3-style)

> 合并旧 Fig 4（纯茶表征）与旧 Fig 5（非线性叠加）为一张 5-panel 图。
> 叙事逻辑：先认识纯茶 (A/B) → 看混合后发生了什么 (C) → 量化非线性程度 (D/E)。
> 视觉参考：`ref/pom2.png`（概念+量化混排）、`ref/pom3.png`（密集多面板）。

布局 (1920×1920):

```text
┌──── A ────┬──── B ────┐  纯茶表征
│ PCA       │ Radar     │
│ scatter   │ chart     │  960×640 each
├───────── C ───────────┤  全宽 ratio curves
│ 4 ratio curves        │  1920×640
├──── D ────┬──── E ────┤  非线性量化
│ NLDI      │ Forest    │
│ heatmap   │ plot      │  960×640 each
└───────────┴───────────┘
```

| Panel | 内容 | 类型 | 文件 | 状态 |
|:---:|------|:---:|------|:---:|
| A | PCA scatter of 320 pure-tea measurements (5 色分簇) | matplotlib 复用 | `manuscript/figures_v2/fig_pure_tea_v2.png` 内含 | ✅ |
| B | Radar chart of mean 8-channel normalised responses per tea | matplotlib 复用 | (同上) | ✅ |
| C | 全部 10 种二元组合 response–ratio curves | matplotlib 复用 | `results/v2/figures/fig_sm_s3_all_ratio_curves_v2.png` | ✅ |
| D | 10 茶对 NLDI 三角热图 | matplotlib 复用 | `manuscript/figures_v2/fig_nldi_heatmap_v2.png` | ✅ |
| E | 10 茶对 NLDI bootstrap 95% CI forest plot | matplotlib 复用 | `results/v2/figures/fig_nldi_forest_v2.png` | ✅ |

**Caption (EN)**:
> **Fig. 4.** Pure-tea characterisation and non-linear blend additivity. **(A)** PCA of 320 pure-tea measurements; five tea types form well-separated clusters. **(B)** Radar chart of mean 8-channel normalised responses per tea, revealing distinct sensor-response fingerprints. **(C)** Response–ratio curves for all ten binary combinations; dashed = linear additivity prediction, shaded = ±1 SD; systematic deviations from linearity are visible across all pairs. **(D)** NLDI heatmap across all ten binary tea-pair combinations. **(E)** Forest plot of NLDI bootstrap 95% CIs per pair; all CIs exclude zero, Bonferroni-corrected Wilcoxon *p* < 0.001.

**Caption (CN)**:
> **图4.** 纯茶表征与非线性拼配叠加。**(A)** 320 次纯茶测量的 PCA 投影；五种茶形成清晰分簇。**(B)** 各茶类八通道平均归一化响应雷达图，揭示不同的传感器响应指纹。**(C)** 全部十种二元组合响应-比例曲线；虚线 = 线性叠加预测，阴影 = ±1 SD；所有茶对均可见对线性的系统性偏离。**(D)** 全部十种二元组合 NLDI 热图。**(E)** 各茶对 NLDI Bootstrap 95% CI 森林图；CI 均排除零，Bonferroni 校正 Wilcoxon *p* < 0.001。

---

### Fig 5 — Quantitative comparison (pom3-style)

布局 (1920×1280, 2×2):
```
┌── A ──┬── B ──┐  960×640 each
│Class  │R² blend│
│ acc   │  bars  │
├───────┼───────┤
│Δacc   │ΔR²     │
│abl    │abl     │
└───────┴───────┘
```

| Panel | 内容 | 类型 | 数据源 | 文件 | 状态 |
|:---:|------|:---:|------|------|:---:|
| A | 5 paradigm 分类 acc 横向 bar，CARL 高亮 | matplotlib NEW | Table 2 | `panel_fig5_a_class_v1.png` | 🔧 TODO |
| B | 5 paradigm 回归 R² 横向 bar，CARL 高亮 | matplotlib NEW | Table 3 | `panel_fig5_b_reg_v1.png` | 🔧 TODO |
| C | 消融 Δacc 居中条形（0=完整 CARL） | matplotlib NEW | Table 4 | `panel_fig5_c_abl_acc_v1.png` | 🔧 TODO |
| D | 消融 ΔR² 居中条形 | matplotlib NEW | Table 4 | `panel_fig5_d_abl_r2_v1.png` | 🔧 TODO |

**Caption (EN)**:
> **Fig. 5.** Quantitative comparison of CARL against four modelling paradigms. **(A)** Pure-tea classification accuracy (5-class, *n*=320, 5-fold CV); CARL with task-adaptive fine-tuning reaches **97.5%**. **(B)** Blend-ratio prediction *R*² (*n*=370, 5-fold CV); CARL-Proj + SVR (frozen) reaches **0.686**. **(C)** Ablation Δacc relative to full CARL (negative = drop on removal). **(D)** Ablation ΔR²; the largest single effect is the regression collapse caused by extracting features from the pre-projector (GAP) position rather than the *L*₂-normalised projection output.

**Caption (CN)**:
> **图5.** CARL 与四种建模范式的量化比较。**(A)** 纯茶分类准确率（5 类，*n*=320，5 折 CV），CARL 任务自适应微调达 **97.5%**。**(B)** 拼配比例预测 *R*²（*n*=370，5 折 CV），CARL-Proj + SVR（冻结）达 **0.686**，首个超过最强手工回归器的深度学习配置。**(C)** 消融 Δacc（0 = 完整 CARL，负值 = 移除组件后下降）。**(D)** 消融 ΔR²；最大单项效应来自从投影前 GAP 位置提取特征导致的回归崩溃。

---

## §4 资产类型与命名约定

### 4.1 三种资产类型

| Type | 来源 | 输出位置 | 引用方式 |
|:---:|------|----------|----------|
| **A** | AI panel — `generate_image()` 调用 OpenAI 兼容 API | `figure/ai_generated/panel_*_v<N>.png` | `PanelSlot(source="<panel_name>")` |
| **B** | matplotlib data plot — helper 脚本 | `figure/ai_generated/panel_*_v<N>.png`（同目录） | `PanelSlot(source="<absolute_path>")` |
| **C** | 复用手稿现有图（photo / render / 已有数据图） | `manuscript/...` 原位 | `PanelSlot(source="<absolute_path>")` |

### 4.2 命名约定

- AI panel: `panel_<figure>_<role>_v<N>.png`
  - 例：`panel_fig1hero_a_problem_v1.png`、`panel_ga_carl_v1.png`
- matplotlib data panel: 同上命名规则，与 AI panel 共目录
  - 例：`panel_fig1hero_b_dataset_v1.png`
- composite: `composite_<figure>_v<N>.png`
  - 例：`composite_fig1_hero_v1.png`、`composite_fig2_hardware_v1.png`
- 历史归档：自动加时间戳后缀 `_<YYYYMMDD>_<HHMMSS>`，存到 `history/` 子目录

### 4.3 路径常量（`batch_generate.py` 顶部维护）

```python
ROOT = scripts/paper_experiments/figure/
OUT_DIR = ROOT/ai_generated/
HISTORY_DIR = ROOT/ai_generated/history/
COMPOSITE_DIR = ROOT/composite/
COMPOSITE_HISTORY_DIR = ROOT/composite/history/
MANUSCRIPT_ROOT = g:/Downloads/机器嗅觉研究/idea/tea_mix/manuscript/

# 手稿真实图（C 类）
MS_PLATFORM    = elsarticle/figures/fig0a_platform_photo.png
MS_CHAMBER_3D  = elsarticle/figures/fig0b_chamber_3d.png
MS_CHAMBER_CFD = elsarticle/figures/fig0c_chamber_cfd.png
MS_AROMA_HC    = <repo>/results/v2/figures/fig_aroma_map_hc_v2.png
MS_AROMA_CARL  = <repo>/results/v2/figures/fig_aroma_map_carl_v2.png
```

---

## §5 制作工作流

> **核心理念**：每一次图面修改的本质都是**修改 AI prompt 或 matplotlib 代码**。
> 拼装 (composite) 和同步到手稿只是外围机械操作；真正的创造性循环发生在
> **审视当前组图架构 → 判断子图缺陷 → 修改对应 prompt/code → 重新生成 → 再审视**。

### 5.0 ⭐ Prompt 迭代循环（核心）

```
┌─────────────────────────────────────────────────┐
│  1. 审视：查看当前 composite / 单张 panel       │
│  2. 诊断：对照 §3 树状结构 & caption 找差距      │
│  3. 修改 prompt / code：                         │
│     ├─ AI panel → 改 batch_generate.py 的 prompt │
│     └─ data plot → 改 matplotlib 脚本            │
│  4. 重新生成 panel                               │
│  5. 拼装 composite 验证上下文效果                 │
│  6. 不满意 → 回到 1；满意 → 同步手稿             │
└─────────────────────────────────────────────────┘
```

**Prompt 修改要点**：

- 每个 `PanelJob` 的 prompt 是 `batch_generate.py` 中的**字符串常量**，直接编辑即可
- **禁止盲改**：先描述当前图哪里不对（如"传感器信号画成了 8 条毛线"），再针对性修改 prompt 语句
- prompt 末尾的 `STYLE_ANCHOR_*` **不可删除**，保持视觉一致性
- 每次改 prompt 后建议在决策日志 (§8) 记一笔，方便回溯

**传感器信号表示规范**（跨所有 AI panel 的通用约束）：

> 8 通道传感器信号**禁止**画成"8 条独立波形曲线"。
> 推荐替代方案：
> - 8×T 色块热图瓦片（channel × time → color grid）
> - 单条代表性曲线 + "×8" 角标
> - 8 短色条（barcode 风格）
> - 2×4 传感器图标阵列
>
> 在 prompt 中明确写 `"DO NOT draw eight separate wavy lines for sensor channels"`。

### 5.1 添加 / 修改 AI panel

1. 在 `batch_generate.py` 中编写或修改 prompt 常量；**结尾必须**追加 `STYLE_ANCHOR_MINIMAL` 或 `STYLE_ANCHOR_PICTOGRAM`
2. 注册到 `PANELS[<name>] = PanelJob(...)`，指定 `output_filename`、`size`、`ref_images`
3. 运行：`python batch_generate.py --panels <name>`
4. 视觉验证 → 不满意则回到步骤 1 改 prompt，再跑

### 5.2 添加 / 修改 matplotlib data panel

1. 在 `paper_experiments/` 创建或修改 helper 脚本（参考 `gen_nature_figs_v2.py`）
2. **必须**显式覆盖 matplotlib 默认色板与字体（模板见下方）
3. 输出 PNG 到 `figure/ai_generated/panel_*_v<N>.png`
4. 视觉验证：与已有 AI panel 拼图后确认风格一致

   <details><summary>matplotlib rcParams 模板</summary>

   ```python
   import matplotlib as mpl
   TEA_COLORS = {"T1": "#E89B3C", "T2": "#A33B2A", "T3": "#6FB58A",
                 "T4": "#3F6FA8", "T5": "#C57BA1"}
   TEAL = "#7FB7B0"; PINK = "#E5A1A8"; CREAM = "#F4F1ED"; DARK = "#2D2D2D"

   def init_panel_style():
       mpl.rcParams.update({
           "font.family": "sans-serif",
           "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
           "font.size": 10,
           "axes.edgecolor": DARK, "axes.linewidth": 1.5,
           "axes.spines.top": False, "axes.spines.right": False,
           "xtick.color": DARK, "ytick.color": DARK,
           "xtick.major.width": 1.2, "ytick.major.width": 1.2,
           "savefig.facecolor": "white", "savefig.edgecolor": "white",
           "savefig.dpi": 300, "savefig.bbox": "tight",
       })
   ```
   </details>

### 5.3 拼装 composite（外围）

1. 在 `batch_generate.py` 的 `COMPOSITES` dict 中定义 `CompositeSpec`
2. `PanelSlot.source`：panel name 或绝对路径
3. 运行：`python batch_generate.py --composites <name>`
4. 输出至 `figure/composite/composite_*_v<N>.png`，自动归档到 `history/`

### 5.4 同步到手稿（外围）

1. composite PNG → `manuscript/figures_v3/`
2. 更新 `.md` 手稿中的 `![Fig. N]` 引用、图注、正文 cross-reference
3. grep 验证：`grep -E "figures_v2|composite_old" results_section*.md`

---

## §6 命令速查

```bash
# 列出所有 panel/composite
python batch_generate.py --list

# 生成单个 AI panel
python batch_generate.py --panels fig1hero_problem

# 生成多个 panel（并行）
python batch_generate.py --panels fig1hero_problem fig2_encoder fig2_loss --workers 4

# 拼装 composite
python batch_generate.py --composites fig1_hero fig2_hardware

# 主示意图全部生成 + 拼装
python batch_generate.py --main

# 全部 panel + 全部 composite
python batch_generate.py --all

# dry-run 只打印计划
python batch_generate.py --all --dry-run
```

```bash
# matplotlib data panel（需 paper_experiments 模块路径）
cd d:\WindSurfProjects\rpi_odor\enose-analytics\scripts
python -m paper_experiments.gen_fig1hero_panels
```

---

## §7 当前进度 / TODO

> 更新时间：2026-05-16 (UTC+08:00)

### ✅ 已完成

- [x] 7 个 AI panel 全部生成（GA hardware/CARL/outcomes; Fig1 workflow; Fig2 encoder/aug/loss）
- [x] 3 张 composite 拼装并归档（GA / Fig1 旧版 / Fig2 旧版）
- [x] 双语手稿首轮整合：GA + Fig1 + Fig2 + 重新编号（Fig 3-6）
- [x] 4 张参考图分析（pom1/nature_mi/pom3/pom4）→ 重组方案确定
- [x] FIGURE_PLAN.md 文档化整个工作流
- [x] **Fig 3 Panel A** — matplotlib 实现完整编码器架构图（`gen_fig3_carl.py`）
- [x] **Fig 3 Panel B** — matplotlib 实现 6 种增强卡片
- [x] **Fig 3 composite** — `fig3_carl_v2.png` 完成（A+B+C 三面板）
- [x] **Fig 4 合图** — `fig4_merged_v2.png` 5-panel 拼装完成
- [x] **Fig 5 量化对比** — `fig5_comparison_v2.png` 2×2 拼装完成
- [x] **手稿引用更新** — Fig 2–5 图源 + 图注 + 正文交叉引用全部同步

### 🚧 进行中

- [ ] **Fig 1 Hero (端到端单张 AI 生成)**
  - [ ] 编写 prompt（三列布局：硬件系统 / CARL 框架 / Applications）
  - [ ] 附加参考图（hardware_v1 + outcomes_v1 + aroma_map_v2，仅借鉴）
  - [ ] 迭代生成 `fig1_hero_v1.png` → 视觉验证 → 改 prompt 重生
- [ ] **Fig 2 Hardware (简化) 拼装**
  - [x] 三张子图全部现成
  - [ ] 在 `batch_generate.py` 添加 `fig2_hardware` composite spec

### 📋 后续待办

- [ ] **删除 GA 引用**（目标期刊无 GA section）
- [ ] **Fig 1 Hero 生成后 → 全局重新编号**（当前 Fig 1=Hardware → Fig 2，其余顺延）

---

## §8 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-27 02:00 | 7 panel + 3 composite 一稿完成 | 基于 pom1/nature_mi grammar 简化 |
| 2026-04-27 02:54 | 双语手稿同步重新编号 | 旧编号 4→7→5→6 阅读顺序乱 |
| 2026-04-27 03:00 | 重组方案确定（pom1/3/4-style） | 目标期刊无 GA → Fig 1 必须是 hero |
| 2026-04-27 03:20 | matplotlib 数据图必须遵守 AI panel 设计规则 | 否则视觉与 AI panel 不连贯 |
| 2026-04-27 03:25 | 文档化整个工作流为 FIGURE_PLAN.md | 防止偏离设计原则；后续工作单一参考源 |
| 2026-04-27 04:00 | Fig 1 从 6-panel 改为 3 列 overview | 匹配 GA composite 三列叙事；减少空洞 panel |
| 2026-04-27 04:00 | Fig 3 Panel A/B 需重新 prompt 迭代 | 旧版传感器信号画成 8 条毛线；编解码器不完整 |
| 2026-04-27 04:00 | 全局规范：传感器信号禁止画成 8 条独立波形 | 改用 8×T 热图瓦片/barcode/图标阵列 |
| 2026-04-27 04:00 | §5 工作流重写：prompt 迭代为核心循环 | 拼装/同步降级为外围操作 |
| 2026-04-27 17:20 | Fig 1 改为端到端单张 AI 生成（非 composite 拼接） | 手绘草图确认三列整体叙事；拼接会破坏视觉连贯性 |
| 2026-04-27 17:20 | Fig 1 参考图仅作风格借鉴，prompt 明确声明不硬粘贴 | 保持统一视觉语言，避免拼贴感 |
| 2026-04-27 19:38 | 合并 Fig 4+5 为单张 5-panel 图（pom2/pom3-style） | 纯茶表征→blend 非线性构成完整叙事；论文 6→5 张更紧凑 |
| 2026-04-27 19:38 | 旧 Fig 6 → 新 Fig 5（量化对比） | 因合并空出编号 |

---

End of `FIGURE_PLAN.md`. 修改本文档后请同步更新相关 prompt / spec / matplotlib script。
