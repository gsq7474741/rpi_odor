---
description: 自主探索前端应用，截取截图，更新 Slidev 演示文稿，Playwright 验证闭环
---

# Slidev 演示文稿截图更新工作流

自动化流程：浏览前端 → 截图 → 更新 slides.md → Playwright 验证 → 反馈修正。

## 前置条件

- 前端应用运行在 `http://127.0.0.1:3000/`
- Slidev 项目在 `g:\Downloads\260209组会\ppt\`
- 截图保存到 `ppt/public/images/`

## 1. 探索前端页面

使用 Playwright (mcp-playwright) 导航前端应用，获取页面快照了解结构：

```
1. browser_navigate 到目标 URL
2. browser_snapshot 获取页面结构（比截图更有利于理解页面内容）
3. 根据快照中的导航链接，逐个访问所有页面和子 tab
4. 对需要交互才能展示内容的页面（如加载数据、切换 tab），先操作再截图
```

## 2. 截取页面截图

// turbo
```
对每个页面使用 browser_take_screenshot：
- filename: 保存到 ppt/public/images/ui-{页面名}.png
- type: png
- 命名规范: ui-system.png, ui-sensor.png, ui-workflow.png 等
- 确保页面内容已完全加载后再截图
- 对于需要数据的页面（如数据中心），先选择/加载数据再截图
```

## 3. 更新 slides.md

读取当前 slides.md，找到 UI 截图区域，使用 edit 工具添加或更新页面：

```markdown
每个 UI 页面的 slide 模板：

---

<div class="flex flex-col h-full px-4">

<div class="flex items-center gap-4 mt-4 mb-3">
  <div class="section-line"></div>
  <h1 class="!text-2xl !mb-0">UI · {页面标题}</h1>
  <div class="dim text-sm">{功能描述关键词，用 · 分隔}</div>
</div>

<img src="/images/ui-{name}.png" class="img-frame w-full flex-1 object-cover object-top" />

</div>
```

## 4. 启动 Slidev 验证

// turbo
```powershell
npx slidev --port 3031 --open false
```

在 `g:\Downloads\260209组会\ppt` 目录下运行，非阻塞模式。

## 5. Playwright 逐页截图验证

```
1. 确保 verify 目录存在: mkdir ppt/verify
2. 导航到 http://localhost:3031/{页码}
3. browser_take_screenshot 保存到 ppt/verify/slide-{页码}-{名称}.png
4. 检查截图：
   - 标题和描述是否正确显示
   - 截图是否完整填充（无空白、无溢出）
   - 暗色背景 + 白色截图框的对比是否美观
5. 如发现问题，回到步骤 3 修改 slides.md 后重新验证
```

## 6. 闭环修正

如果验证发现问题：
- **截图内容不佳**：回到步骤 1-2，重新操作前端并截图
- **slide 布局问题**：回到步骤 3，调整 HTML/CSS
- **描述文字不准确**：直接 edit slides.md 修改 dim 描述文字

## 注意事项

- 截图前确认页面已完全加载（等待关键元素出现）
- 需要交互的页面：先 click/navigate 到正确状态再截图
- 数据页面：选择有代表性的数据集展示
- 验证时重点检查新增/修改的页面，已验证过的可跳过
