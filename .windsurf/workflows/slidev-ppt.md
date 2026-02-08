---
description: 通用 Slidev PPT 制作工作流：素材收集 → 截图/图片处理 → 编写 slides.md → Playwright 验证 → 闭环修正
---

# Slidev PPT 制作工作流

通用流程：确定内容 → 收集素材（截图/图片） → 编写 slides.md → 启动预览 → 逐页验证 → 修正闭环。

## 1. 确定内容大纲

与用户确认 PPT 结构：

- 标题/封面信息
- 各章节主题和顺序
- 每页的核心内容（文字 vs 图片 vs 混排）
- 设计风格偏好（暗色/亮色、极简/丰富）

## 2. 收集素材

根据需要，通过以下方式收集图片素材：

### 2a. 截取应用截图（如需展示 UI）

```
使用 Playwright (mcp-playwright):
1. browser_navigate 到目标页面
2. browser_snapshot 了解页面结构
3. 交互操作（切换 tab、加载数据、展开面板等）使页面呈现最佳状态
4. browser_take_screenshot 保存到 ppt/public/images/
5. 重复以上步骤，覆盖所有需要展示的页面/状态
```

### 2b. 处理已有图片（如需裁剪/调整）

```
使用 image-edit skill:
- 裁剪: 从大图中提取关键区域
- 白边/Padding: 适配展示框尺寸
- 缩放: 调整图片大小
- 拼接: 多张图片组合为一张
- 格式转换: PNG/JPEG 互转
```

### 2c. 生成图片（如需 AI 生图）

```
使用 image-gen MCP:
- generate_image 生成插图
- 保存到 ppt/public/images/
```

## 3. 初始化 Slidev 项目（如尚未创建）

// turbo
```powershell
npm init slidev@latest
```

确保项目结构包含：
- `slides.md` — 主文件
- `public/images/` — 图片目录
- `package.json` — 依赖

## 4. 编写 slides.md

### 设计规范

- 每页用 `---` 分隔
- 优先使用 HTML + Tailwind CSS 进行精细布局
- 图片使用 `<img>` 标签配合 class 控制尺寸
- 文字精简，每页聚焦一个主题

### 常用 slide 模板

**全幅截图页**：
```markdown
---

<div class="flex flex-col h-full px-4">

<div class="flex items-center gap-4 mt-4 mb-3">
  <div class="section-line"></div>
  <h1 class="!text-2xl !mb-0">{标题}</h1>
  <div class="dim text-sm">{描述关键词}</div>
</div>

<img src="/images/{name}.png" class="img-frame w-full flex-1 object-cover object-top" />

</div>
```

**左文右图页**：
```markdown
---

<div class="flex h-full gap-8 px-8 items-center">

<div class="flex-1">
  <h1>{标题}</h1>
  <p class="dim">{描述文字}</p>
</div>

<div class="flex-1">
  <img src="/images/{name}.png" class="img-frame" />
</div>

</div>
```

**数据/卡片网格页**：
```markdown
---

<div class="flex flex-col justify-center h-full px-8">

<h1>{标题}</h1>

<div class="flex justify-center gap-4 mt-6">
  <div class="glass text-center px-6 py-4">
    <div class="text-3xl font-bold">{数值}</div>
    <div class="dim text-sm">{标签}</div>
  </div>
  <!-- 重复卡片 -->
</div>

</div>
```

## 5. 启动 Slidev 预览

// turbo
```powershell
npx slidev --port 3031 --open false
```

非阻塞运行，等待服务启动完成。

## 6. Playwright 逐页截图验证

```
1. 创建验证目录: mkdir ppt/verify
2. 对每一页（或重点页）：
   a. browser_navigate 到 http://localhost:3031/{页码}
   b. browser_take_screenshot 保存到 verify/slide-{页码}.png
   c. 检查：标题正确、图片完整、布局无溢出、风格一致
3. 汇总问题清单
```

## 7. 闭环修正

根据验证结果迭代修改：

- **图片问题** → 回到步骤 2 重新截图/处理
- **布局问题** → 回到步骤 4 调整 HTML/CSS
- **内容问题** → 直接 edit slides.md 修改文字
- **新增页面** → 在 slides.md 对应位置插入新 slide

修改后无需重启 Slidev（HMR 自动刷新），直接重新截图验证。

## 常用 CSS class 参考

```css
.section-line  — 标题前的红色装饰线
.dim           — 淡灰色辅助文字
.glass         — 毛玻璃卡片效果
.img-frame     — 图片圆角 + 阴影边框
.gradient-num  — 渐变大数字
```

> 以上 class 需在 slides.md 的 `<style>` 块中定义，根据项目实际情况调整。
