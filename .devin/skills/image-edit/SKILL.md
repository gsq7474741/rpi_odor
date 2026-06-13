---
name: image-edit
description: 通用图片编辑 skill。裁剪、添加白边/padding、缩放、调色、格式转换、拼接等。当需要从截图/PPT 中提取局部区域、调整图片尺寸以适配展示框、或批量处理图片时使用。
---

# Image Edit Skill

通过 PowerShell 调用 Python (Pillow / PIL) 进行图片编辑。所有操作均为单行 `python -c "..."` 命令。

> **前置条件**: Python 环境中已安装 Pillow (`pip install Pillow`)

---

## 1. 获取图片信息

```powershell
python -c "from PIL import Image; img = Image.open(r'<PATH>'); print(f'Size: {img.size}, Mode: {img.mode}, Format: {img.format}')"
```

---

## 2. 裁剪 (Crop)

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>')
# (left, upper, right, lower) 像素坐标，原点在左上角
cropped = img.crop((<L>, <U>, <R>, <B>))
cropped.save(r'<OUTPUT>')
print(f'Cropped to {cropped.size}')
"
```

**确定坐标方法**:
1. 用 `read_file` 查看图片，观察区域位置
2. 获取尺寸后按比例估算，如 1280x720 裁右半 → `(640, 0, 1280, 720)`

---

## 3. 添加白边 / Padding（适配展示框）

将图片放在指定尺寸的画布中央，四周填充指定颜色：

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>')
TARGET_W, TARGET_H = <WIDTH>, <HEIGHT>
BG_COLOR = (255, 255, 255)  # 白色背景，可改为 (0,0,0) 黑色等
canvas = Image.new('RGB', (TARGET_W, TARGET_H), BG_COLOR)
# 等比缩放图片以适配画布
ratio = min(TARGET_W / img.width, TARGET_H / img.height)
new_size = (int(img.width * ratio), int(img.height * ratio))
resized = img.resize(new_size, Image.LANCZOS)
# 居中粘贴
x = (TARGET_W - new_size[0]) // 2
y = (TARGET_H - new_size[1]) // 2
canvas.paste(resized, (x, y))
canvas.save(r'<OUTPUT>')
print(f'Padded to {TARGET_W}x{TARGET_H}, image scaled to {new_size}')
"
```

**仅添加等宽白边（不缩放）**:

```powershell
python -c "
from PIL import ImageOps, Image
img = Image.open(r'<INPUT>')
BORDER = <PX>  # 四周边距像素
padded = ImageOps.expand(img, border=BORDER, fill=(255,255,255))
padded.save(r'<OUTPUT>')
print(f'Added {BORDER}px border → {padded.size}')
"
```

**非等宽边距**:

```powershell
python -c "
from PIL import ImageOps, Image
img = Image.open(r'<INPUT>')
# (left, top, right, bottom)
padded = ImageOps.expand(img, border=(<L>, <T>, <R>, <B>), fill=(255,255,255))
padded.save(r'<OUTPUT>')
print(f'Padded → {padded.size}')
"
```

---

## 4. 缩放 (Resize)

**精确尺寸**:

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>')
resized = img.resize((<W>, <H>), Image.LANCZOS)
resized.save(r'<OUTPUT>')
print(f'Resized to {resized.size}')
"
```

**等比缩放（按比例）**:

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>')
SCALE = <FACTOR>  # 如 0.5 缩小一半，2.0 放大一倍
new_size = (int(img.width * SCALE), int(img.height * SCALE))
resized = img.resize(new_size, Image.LANCZOS)
resized.save(r'<OUTPUT>')
print(f'Scaled {SCALE}x → {resized.size}')
"
```

**等比缩放（限制最大宽/高）**:

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>')
MAX_W, MAX_H = <MAX_WIDTH>, <MAX_HEIGHT>
img.thumbnail((MAX_W, MAX_H), Image.LANCZOS)
img.save(r'<OUTPUT>')
print(f'Thumbnail → {img.size}')
"
```

---

## 5. 调色 (Color Adjustment)

**亮度 / 对比度 / 饱和度 / 锐度**:

```powershell
python -c "
from PIL import Image, ImageEnhance
img = Image.open(r'<INPUT>')
img = ImageEnhance.Brightness(img).enhance(<FACTOR>)   # 1.0=原始, >1 更亮
img = ImageEnhance.Contrast(img).enhance(<FACTOR>)     # 1.0=原始, >1 更高对比
img = ImageEnhance.Color(img).enhance(<FACTOR>)        # 1.0=原始, 0=灰度
img = ImageEnhance.Sharpness(img).enhance(<FACTOR>)    # 1.0=原始, >1 更锐
img.save(r'<OUTPUT>')
print('Color adjusted')
"
```

**转灰度**:

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>').convert('L')
img.save(r'<OUTPUT>')
"
```

**反色**:

```powershell
python -c "
from PIL import ImageOps, Image
img = ImageOps.invert(Image.open(r'<INPUT>').convert('RGB'))
img.save(r'<OUTPUT>')
"
```

---

## 6. 圆角 + 阴影（适用于截图展示）

```powershell
python -c "
from PIL import Image, ImageDraw
img = Image.open(r'<INPUT>').convert('RGBA')
R = <RADIUS>  # 圆角半径，如 16
mask = Image.new('L', img.size, 0)
draw = ImageDraw.Draw(mask)
draw.rounded_rectangle([(0,0), img.size], radius=R, fill=255)
img.putalpha(mask)
img.save(r'<OUTPUT>')
print(f'Rounded corners R={R}')
"
```

---

## 7. 图片拼接

**水平拼接**:

```powershell
python -c "
from PIL import Image
imgs = [Image.open(p) for p in [r'<IMG1>', r'<IMG2>', r'<IMG3>']]
max_h = max(i.height for i in imgs)
total_w = sum(i.width for i in imgs)
canvas = Image.new('RGB', (total_w, max_h), (255,255,255))
x = 0
for i in imgs:
    canvas.paste(i, (x, (max_h - i.height) // 2))
    x += i.width
canvas.save(r'<OUTPUT>')
print(f'Joined horizontally → {canvas.size}')
"
```

**垂直拼接**:

```powershell
python -c "
from PIL import Image
imgs = [Image.open(p) for p in [r'<IMG1>', r'<IMG2>']]
max_w = max(i.width for i in imgs)
total_h = sum(i.height for i in imgs)
canvas = Image.new('RGB', (max_w, total_h), (255,255,255))
y = 0
for i in imgs:
    canvas.paste(i, ((max_w - i.width) // 2, y))
    y += i.height
canvas.save(r'<OUTPUT>')
print(f'Joined vertically → {canvas.size}')
"
```

---

## 8. 格式转换

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>')
img.save(r'<OUTPUT>', quality=<Q>)  # JPEG quality 1-95, PNG 忽略此参数
print('Converted')
"
```

**PNG → JPEG（需去除 alpha 通道）**:

```powershell
python -c "
from PIL import Image
img = Image.open(r'<INPUT>').convert('RGB')
img.save(r'<OUTPUT>', quality=90)
"
```

---

## 9. 批量操作模板

```powershell
python -c "
from PIL import Image, ImageOps
import os

ops = [
    # (输入, 输出, 操作)
    (r'a.png', r'a_out.png', 'crop', (0, 0, 500, 500)),
    (r'b.png', r'b_out.png', 'pad', (800, 600, (255,255,255))),
    (r'c.png', r'c_out.png', 'resize', (400, 300)),
]

for item in ops:
    inp, out = item[0], item[1]
    img = Image.open(inp)
    op = item[2]
    if op == 'crop':
        img = img.crop(item[3])
    elif op == 'pad':
        tw, th, bg = item[3]
        canvas = Image.new('RGB', (tw, th), bg)
        r = min(tw/img.width, th/img.height)
        ns = (int(img.width*r), int(img.height*r))
        resized = img.resize(ns, Image.LANCZOS)
        canvas.paste(resized, ((tw-ns[0])//2, (th-ns[1])//2))
        img = canvas
    elif op == 'resize':
        img = img.resize(item[3], Image.LANCZOS)
    img.save(out)
    print(f'{os.path.basename(inp)} → {os.path.basename(out)} ({img.size})')
"
```

---

## 注意事项

- 坐标系原点在图片**左上角**
- 裁剪坐标格式 `(left, upper, right, lower)`，确保 `right > left` 且 `lower > upper`
- 处理 PNG 透明通道时需先 `.convert('RGBA')` 或 `.convert('RGB')`
- 添加白边适配展示框是最常用操作：先算目标宽高比，再用 padding 方案居中放置
