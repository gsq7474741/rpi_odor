# Fig. 3 – Fig. 6 — Data-Driven Figures (matplotlib only)

> **不使用 AI 生成。** 这四张图必须由 matplotlib + 真实数据生成，以保证统计严谨与可复现。
> 本文件仅约束**生成时的视觉规范**，让数据图与 GA / Fig 1 / Fig 2 视觉统一。

---

## 通用 matplotlib 规范

在 `paper_experiments/` 下建立 `style.py`，所有数据图入口处统一引用：

```python
# style.py
import matplotlib as mpl
from matplotlib import font_manager

# 字体
mpl.rcParams["font.family"] = "Helvetica"
mpl.rcParams["font.size"] = 9
mpl.rcParams["axes.titlesize"] = 11
mpl.rcParams["axes.titleweight"] = "regular"
mpl.rcParams["axes.labelsize"] = 9
mpl.rcParams["xtick.labelsize"] = 8
mpl.rcParams["ytick.labelsize"] = 8
mpl.rcParams["legend.fontsize"] = 8

# 边框 / 网格
mpl.rcParams["axes.spines.top"] = False
mpl.rcParams["axes.spines.right"] = False
mpl.rcParams["axes.grid"] = False
mpl.rcParams["axes.linewidth"] = 0.8

# 图整体
mpl.rcParams["figure.dpi"] = 150
mpl.rcParams["savefig.dpi"] = 600
mpl.rcParams["savefig.bbox"] = "tight"
mpl.rcParams["pdf.fonttype"] = 42        # 嵌入字体（投稿要求）
mpl.rcParams["ps.fonttype"] = 42

# 全文锁定调色板
TEA_PALETTE = {
    "T1": "#E89B3C",  # Oolong
    "T2": "#A33B2A",  # Black
    "T3": "#6FB58A",  # Jasmine
    "T4": "#3F6FA8",  # XQG Pu-erh
    "T5": "#C57BA1",  # Dark Roast
}
TEA_MARKERS = {"T1": "o", "T2": "s", "T3": "^", "T4": "D", "T5": "v"}

METHOD_PALETTE = {
    "ours": "#E07B3C",
    "baseline": "#7A7A7A",
    "highlight_baseline": "#1F1F1F",
}

CMAP_NLDI = "YlOrRd"
```

---

## Panel 标签函数

```python
def add_panel_label(ax, label, x=-0.10, y=1.05, fontsize=14):
    ax.text(x, y, label, transform=ax.transAxes,
            fontsize=fontsize, fontweight="bold",
            color="#1F1F1F", va="bottom", ha="left")
```

每个 panel 左上角调用：`add_panel_label(ax, "A")`。

---

## Fig. 3 — Pure-tea Sensor Response Characterisation

**位置**：§3.1 末
**布局**：1×2，A=PCA scatter，B=radar
**关键修复**：
  - PC1 异常值用 `xlim` 截断（保留全数据但裁剪轴）；或加 `inset_axes` 显示主簇
  - 雷达图中心数值（0.80/0.87/0.95/1.02）改为外置图例
  - 5 茶颜色严格使用 `TEA_PALETTE`，marker 严格使用 `TEA_MARKERS`
  - 茶名称直接标注在散点 cluster 中心（替换底部 legend）

---

## Fig. 4 — Tea Aroma Map

**位置**：§3.2 末
**布局**：1×2，A=Hand-crafted，B=CARL
**关键修复**：
  - **B 中加 KDE 等高线**：用 `seaborn.kdeplot(level=2)` 围出每个茶簇的密度边界
  - **B 中加 10 条 blend 中位轨迹**：从茶 A 中心到茶 B 中心，用渐变色细线
  - 灰点（拼配样本）透明度调到 0.25
  - A 与 B 共享 figure 高度，宽度比 1:1
  - 子标题 "Hand-crafted (PC1 + PC2: 59% + 9%)" / "CARL (25% + 24%)"

```python
import seaborn as sns
for tea, color in TEA_PALETTE.items():
    sns.kdeplot(x=df[df.tea==tea].pc1, y=df[df.tea==tea].pc2,
                color=color, levels=[0.5], linewidths=1.5, ax=axB)

# blend 轨迹
for (a, b), traj in median_trajectories.items():
    axB.plot(traj.pc1, traj.pc2, color=blend_color(a, b),
             linewidth=1.0, alpha=0.7)
```

---

## Fig. 5 — Non-linear Aroma Additivity

**位置**：§3.3 末（替代原 Fig 5 + Fig 6）
**布局**：2×2 grid
  - A = T3-T5 ratio curve（NLDI = 0.37，high）
  - B = T1-T4 ratio curve（NLDI = 0.28，medium）
  - C = T2-T4 ratio curve（NLDI = 0.10，low）
  - D = NLDI heatmap（占右侧整列或独立放在 D 位置）
**关键修复**：
  - A/B/C 共享 y 轴范围（0.75–0.95）
  - 每个 panel 右上角加**彩色 NLDI badge**：
    `ax.text(0.95, 0.92, f"NLDI = {v:.2f}", bbox=dict(facecolor=cmap(v), ...))`
  - 测量曲线（蓝实线）+ 线性预测（灰虚线）+ ±1 SD 阴影（浅蓝半透明）
  - D 中非零格加显著性符号 `***`（p < 0.001）
  - D 对角线格用斜线填充而非纯白：`ax.add_patch(matplotlib.patches.Rectangle(..., hatch="//"))`

---

## Fig. 6 — Downstream Task Performance

**位置**：§3.5 末
**布局**：1×3
  - A = 5×5 茶叶分类混淆矩阵（最佳 CARL 配置）
  - B = 拼配比例 true vs predicted scatter（按茶对配色）
  - C = 精简方法对比柱图（仅 3 柱：CARL-Proj+SVR / 最强 HC / 最强通用对比）
**关键修复**：
  - A：用 `Blues` 单色渐变，标签为 T1–T5；对角线值加粗
  - B：x=true ratio, y=predicted；按茶对配色（10 种），右上角注 `R²=0.686`，`MAE=0.062`；对角虚线为 perfect prediction
  - C：水平柱状图，CARL 用 `METHOD_PALETTE["ours"]`，其它两个用 `baseline` 与 `highlight_baseline`；柱子上写数值（如 0.686）
  - **完整 17 方法 ranking 移到 SI**

---

## 输出路径与命名

```
paper_figure/
├── fig3_pure_tea.pdf
├── fig3_pure_tea.png   (300 DPI 预览)
├── fig4_aroma_map.pdf
├── fig4_aroma_map.png
├── fig5_nldi_evidence.pdf
├── fig5_nldi_evidence.png
├── fig6_downstream.pdf
└── fig6_downstream.png
```

---

## 可用 AI 生成的子元素

虽然主图本体不用 AI，但 Fig 5 的"NLDI badge"、Fig 6 的"分类 / 回归 / 比较"图标，可由 AI 生成小型 pictogram 后嵌入。详见 `pictograms_prompt.md`。
