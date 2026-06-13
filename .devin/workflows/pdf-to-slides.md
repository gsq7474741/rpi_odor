---
description: 从 PDF 论文中提取关键插图，处理后集成到 Slidev 幻灯片，Playwright 截图闭环验证
---

# PDF 论文插图 → Slidev 幻灯片工作流

完整流程：PDF 转图片 → 阅读选图 → 裁剪处理 → 编写 slide → Playwright 验证 → 闭环修正。

## 0. 前置条件

- Python 已安装 `pymupdf` 和 `Pillow`（如未安装执行 `pip install pymupdf Pillow`）
- Slidev 项目已存在且 dev server 正在运行
- 图片输出目录：`ppt/public/images/{主题}/`
- 临时缓存目录：`ppt/temp_pdf/`（**不删除，可复用**）

## 1. 批量 PDF 转图片

将目标目录下所有 PDF 的前 N 页转为 PNG 图片，便于后续阅读和选图。

```python
import fitz, os, glob

pdf_dir = r'{PDF目录}'
out_dir = r'{缓存目录，如 ppt/temp_pdf}'
os.makedirs(out_dir, exist_ok=True)

pdfs = glob.glob(os.path.join(pdf_dir, '*.pdf'))
for pdf_path in sorted(pdfs):
    name = os.path.splitext(os.path.basename(pdf_path))[0]
    safe = name[:30].replace(' ', '_').replace(',', '').replace('(', '').replace(')', '').replace('/', '-')
    doc = fitz.open(pdf_path)
    pages = min(4, len(doc))  # 默认导出前4页，可调整
    for i in range(pages):
        pix = doc[i].get_pixmap(dpi=200)
        pix.save(os.path.join(out_dir, f'{safe}_p{i+1}.png'))
    print(f'{safe}: {pages} pages exported ({len(doc)} total)')
    doc.close()
```

> **缓存策略**：`temp_pdf/` 目录保留不删，后续如需补充论文或重新裁剪可直接复用。

## 2. 逐篇阅读，识别核心 Figure

对每篇论文的导出图片，使用 `read_file` 工具逐页查看：

1. 先看第 1 页（标题、摘要、可能有 Figure 1）
2. 再看第 2-4 页（通常包含核心架构图/流程图）
3. 记录每篇论文的关键 Figure 所在页码和区域坐标

**记录格式示例**：
```
POM: p2, Figure 1, 区域 (0, 0, 1700, 1100) — GNN 嗅觉感知空间
MoleculeSTM: p2, Figure 1, 区域 (0, 0, 1700, 1050) — 对比预训练管线
```

## 3. 裁剪 + 暗色背景适配

使用 Python Pillow 批量裁剪关键 Figure，并添加暗色背景 padding 适配 Slidev 暗色主题。

```python
from PIL import Image
import os

out_dir = r'{图片输出目录，如 ppt/public/images/nsfc}'
tmp = r'{缓存目录}'
TW, TH = 1600, 900       # 目标画布尺寸（16:9）
BG = (20, 20, 20)         # 暗色背景色，匹配 PPT 主题

def process(inp, out, crop_box=None, fill=0.92):
    """裁剪 + 缩放 + 居中贴到暗色画布"""
    img = Image.open(os.path.join(tmp, inp)).convert('RGB')
    if crop_box:
        img = img.crop(crop_box)
    ratio = min(TW / img.width, TH / img.height) * fill
    ns = (int(img.width * ratio), int(img.height * ratio))
    resized = img.resize(ns, Image.LANCZOS)
    canvas = Image.new('RGB', (TW, TH), BG)
    canvas.paste(resized, ((TW - ns[0]) // 2, (TH - ns[1]) // 2))
    canvas.save(os.path.join(out_dir, out))
    print(f'{out}: {ns[0]}x{ns[1]}')

# 示例调用：
# process('POM_p2.png', 'fig-pom.png', (0, 0, 1700, 1100))
# process('CLIP_p2.png', 'fig-clip.png', (0, 0, 1700, 750))
```

**参数说明**：
- `crop_box`: `(left, top, right, bottom)` 像素坐标，从导出图片中裁剪子区域
- `fill`: 图片在画布中的填充比例（0.85-0.95），留白防止贴边
- 如果不需要裁剪（整页即为好图），`crop_box` 传 `None`

**处理后验证**：用 `read_file` 查看处理后的图片确认效果。

## 4. 编写 Slide 内容

每篇论文一页 slide，统一使用以下模板：

```html
---

<div class="flex items-center justify-center h-full px-4">
  <div class="text-center">
    <div class="text-sm font-bold mb-2">{论文标题} · {会议/期刊} · {年份}</div>
    <img src="/images/{主题}/fig-{名称}.png" class="img-frame max-h-[65vh] object-contain" />
    <div class="text-xs dim mt-3 max-w-3xl mx-auto"><strong>Insight：</strong>{这篇论文对我们课题的启发和意义，用加粗标出核心观点}</div>
  </div>
</div>
```

**Insight 撰写要求**：
- 先简述论文核心贡献（1 句）
- 再用 `<strong>` 标出与本课题的关联（1 句）
- 总长度控制在 2-3 行以内

## 5. Playwright 截图验证

```
对每个新增/修改的 slide 页：
1. mcp1_browser_navigate 到 http://localhost:{port}/{页码}
2. mcp1_browser_wait_for 等待 3 秒加载
3. mcp1_browser_take_screenshot 截图检查
4. 确认：图片加载完整、文字无溢出、Insight 清晰可读、暗色背景协调
```

## 6. 闭环修正

根据截图验证结果迭代：

- **图片裁剪不佳** → 回到步骤 3，调整 `crop_box` 坐标重新裁剪
- **图片太小/太大** → 调整 `fill` 参数或 slide 中的 `max-h` class
- **Insight 文字过长溢出** → 精简文字或缩小 `text-xs`
- **论文标题显示不全** → 缩短标题，只保留关键信息
- **需要补充论文** → 回到步骤 1 追加 PDF 转图片（缓存目录已保留）

修改后 Slidev HMR 自动刷新，直接重新截图验证即可。

## 快速参考

### 常用裁剪区域经验值（200dpi 导出）

| 区域 | crop_box 估算 |
|---|---|
| 整页上半部分 | `(0, 0, 1700, 1100)` |
| 整页下半部分 | `(0, 1100, 1700, 2200)` |
| 右侧 Figure | `(700, 0, 1700, 1100)` |
| 左侧 Figure | `(0, 0, 900, 1100)` |
| 页面中间窄条 | `(50, 500, 1650, 1000)` |

### 文件命名规范

- 缓存图片：`{论文简称}_p{页码}.png`（如 `POM_p2.png`）
- 最终图片：`fig-{论文简称小写}.png`（如 `fig-pom.png`）
- 输出到：`ppt/public/images/{主题}/`
