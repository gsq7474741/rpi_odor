# AI Generated Figure Prompts — README

本目录存放论文图集的 **AI 生成提示词** 与 **生成产物**。

---

## 文件结构

```
ai_generated/
├── README.md                          ← 本文件
├── 00_design_system.md                ← 总体视觉规范（必读）
├── fig_ga_prompt.md                   ← Graphical Abstract 提示词
├── fig1_prompt.md                     ← Fig 1（仅 Panel D workflow）
├── fig2_prompt.md                     ← Fig 2（CARL 框架，3-panel）
├── fig3to6_data_figures.md            ← Fig 3–6 matplotlib 规范（不用 AI）
├── pictograms_prompt.md               ← 6 类可复用 pictogram 提示词
└── *.png                              ← 生成产物（运行后产生）
```

---

## 风格快速对照（速查）

| 项 | 规范 |
|----|------|
| 字体 | Helvetica / Arial sans-serif，禁止 Times / Comic Sans |
| 茶 5 色 | #E89B3C / #A33B2A / #6FB58A / #3F6FA8 / #C57BA1 |
| schematic 双色 | 青绿 #7FB7B0（数据） + 浅粉 #E5A1A8（模型） |
| 方法对比 | 暖橙 #E07B3C（ours） + 中性灰 #7A7A7A（baseline） |
| 边框 | 1.5 pt 深灰 #2D2D2D，圆角 8 px |
| 背景 | 纯白 + 浅米色分组盒 #F4F1ED |
| 禁用 | 阴影 / 渐变 / 3D / 衬线字体 / 装饰图案 |

---

## 生成流程

### 1. 单张图生成

```bash
cd d:\WindSurfProjects\rpi_odor\enose-analytics\scripts\paper_experiments\figure

# 例：生成 Graphical Abstract
python generate_image.py "$(cat ai_generated/fig_ga_prompt.md)" \
  -o ai_generated/fig_ga_v1.png \
  -r ref/nature_mi.png \
  -r ref/pom1.png \
  --size 1536x1024 \
  --quality high
```

### 2. 批量生成所有 schematic（推荐写一个 batch.py）

```python
# batch.py
from generate_image import generate_image

JOBS = [
    {
        "name": "fig_ga",
        "prompt_file": "ai_generated/fig_ga_prompt.md",
        "output": "ai_generated/fig_ga_v1.png",
        "refs": ["ref/nature_mi.png", "ref/pom1.png"],
        "size": "1536x1024",
    },
    {
        "name": "fig1_panelD",
        "prompt_file": "ai_generated/fig1_prompt.md",
        "output": "ai_generated/fig1_panelD_v1.png",
        "refs": ["ref/nature_mi.png"],
        "size": "1536x1024",
    },
    {
        "name": "fig2",
        "prompt_file": "ai_generated/fig2_prompt.md",
        "output": "ai_generated/fig2_v1.png",
        "refs": ["ref/nature_mi.png", "ref/pom1.png"],
        "size": "1536x1024",
    },
]

for job in JOBS:
    print(f"=== Generating {job['name']} ===")
    prompt = open(job["prompt_file"], encoding="utf-8").read()
    generate_image(
        prompt=prompt,
        output_path=job["output"],
        ref_images=job["refs"],
        size=job["size"],
        quality="high",
    )
    print(f"Saved: {job['output']}\n")
```

运行：`python batch.py`

---

## 后期处理（每张图都要做）

1. **Inkscape 矢量化**：File → Import PNG → Path → Trace Bitmap → 导出 SVG
2. **手动修正文字**：AI 生成的标签经常拼错或字体不一致，全部用 Helvetica 矢量文字替换
3. **手动修正颜色**：用 Inkscape Filter → Color → 把茶色精确替换为 §1.1 配色
4. **替换公式**：Fig 2 的数学公式必须用 LaTeX → SVG，不能用 AI 输出
5. **添加 panel 标签**：A/B/C/D 用 14 pt 黑体粗体，左上角对齐

最终交付物：`paper_figure/<fig_id>.pdf` + `paper_figure/<fig_id>.svg`。

---

## 投稿前检查清单

- [ ] 所有 figure 用同一字体 (Helvetica)
- [ ] 5 茶颜色全文一致（用脚本扫描 SVG 验证 hex）
- [ ] PDF 嵌入字体 (`pdf.fonttype = 42`)
- [ ] 分辨率 ≥ 600 DPI
- [ ] 公式由 LaTeX 渲染，非 AI 生成
- [ ] 无 em-dash / no clipart / no shadow
- [ ] Panel 标签 A/B/C 位置统一
