# Claude Code 项目配置

本文文件定义了项目特定的规则、技能和工作流，供 Claude Code 使用。

---

## 规则 (Rules)

### 记忆使用规则

1. 当你遇到了执行问题时，例如proto生成、数据库迁移，交叉编译等，先查看记忆，使用已经记住的脚本和正确的使用方法
2. 当你经过反复尝试解决一个命令行执行问题时，记忆解决方法，以便以后使用，可以更新或新增记忆

### 远程运行环境

远程运行机器为树莓派5，访问方式为 `ssh user@rpi5.local` ，密码为 `123456` ，所有编译和运行都在此机器上进行。

---

## 技能 (Skills)

### 1. 交叉编译部署 (crossbuild)

用于将 enose-control C++ 后端交叉编译并部署到树莓派。

**使用场景**：修改以下文件后需要部署
- `enose-control/src/**/*.cpp`
- `enose-control/src/**/*.hpp`
- `enose-control/proto/**/*.proto`

**执行步骤**：
```powershell
.\scripts\deploy_crossbuild_enose_control.ps1
```

工作目录：`d:\WindSurfProjects\rpi_odor`

脚本会自动：
- 交叉编译 C++ 代码
- 通过 SSH 上传到树莓派
- 重启 enose-control 服务
- 复制生成的 TypeScript 类型到前端

**远程环境**：
- 主机：`rpi5.local`
- 用户：`user`
- 密码：`123456`
- 服务：`enose-control.service`

**验证部署**：
```bash
ssh user@rpi5.local "sudo systemctl status enose-control"
ssh user@rpi5.local "sudo journalctl -u enose-control -f"
```

---

### 2. 数据库脚本 (db-script)

编写一次性 Python 脚本查询或修改远程 PostgreSQL/TimescaleDB 数据库。

**连接配置**：
```python
import psycopg2
import psycopg2.extras

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
```

**规范**：
1. 文件位置：`scripts/` 目录，命名格式 `check_<描述>.py` 或 `fix_<描述>.py`
2. 依赖：仅使用 `psycopg2`
3. 游标类型：始终使用 `RealDictCursor`
4. 数据修复必须支持 `--dry-run` 参数

**主要数据表**：

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `runs` | 实验运行 | id, status, program_hash, created_at |
| `samples` | 样本记录 | id, run_id, sample_idx, phase_name, liquid_ids, liquid_names, liquid_ratios, liquid_is_solvent, pump_indices, total_volume_ml, params_hash, params_json |
| `sensor_readings_v2` | 传感器读数 | time_ms, sensor_idx, value, temperature, humidity, heater_step, run_id, sample_id |
| `liquids` | 液体定义 | id, name, type, metadata |
| `pump_assignments` | 泵绑定 | pump_index, liquid_id, initial_volume_ml, consumed_volume_ml |
| `consumables` | 耗材 | id, type, name, runtime_hours, max_runtime_hours |
| `sample_ml_labels` | ML标签 | sample_id, config_id, label_str, label_num, label_index |
| `ml_label_configs` | 标签策略 | id, name, label_type, is_active |
| `sample_phase_transitions` | Phase转换 | sample_id, phase_name, start_time_ms, end_time_ms, phase_order |
| `normalized_frames` | 归一化帧 | sample_id, sensor_idx, norm_time, value |

---

### 3. gRPC 服务开发 (grpc-service)

创建新的 gRPC 服务（Proto + C++ 实现 + 前端 API）。

**文件结构**：
```
enose-control/
├── proto/
│   └── enose_[service].proto      # Proto 定义
└── src/
    ├── grpc/
    │   ├── [service]_impl.hpp     # 服务实现头文件
    │   └── [service]_impl.cpp     # 服务实现
    └── main.cpp                   # 注册服务

enose-ui/
└── src/
    ├── generated/                 # 自动生成的类型
    ├── lib/
    │   └── grpc-client.ts        # gRPC 客户端方法
    └── app/api/
        └── [endpoint]/route.ts   # Next.js API 路由
```

**开发步骤**：
1. 定义 Proto（`enose-control/proto/[service].proto`）
2. 实现 C++ 服务（`src/grpc/[service]_impl.{hpp,cpp}`）
3. 注册服务（在 `main.cpp` 中）
4. 前端客户端（在 `grpc-client.ts` 添加方法）
5. API 路由（`app/api/[endpoint]/route.ts`）
6. 部署（使用 crossbuild 技能）

---

### 4. 图片编辑 (image-edit)

通用图片编辑技能。裁剪、添加白边/padding、缩放、调色、格式转换、拼接等。

**前置条件**：Python 环境中已安装 Pillow (`pip install Pillow`)

**常用操作**：

获取图片信息：
```powershell
python -c "from PIL import Image; img = Image.open(r'<PATH>'); print(f'Size: {img.size}, Mode: {img.mode}')"
```

裁剪：
```powershell
python -c "from PIL import Image; img = Image.open(r'<INPUT>'); cropped = img.crop((<L>, <U>, <R>, <B>)); cropped.save(r'<OUTPUT>')"
```

添加白边/适配展示框：
```powershell
python -c "from PIL import Image; img = Image.open(r'<INPUT>'); TW, TH = <W>, <H>; BG = (255, 255, 255); canvas = Image.new('RGB', (TW, TH), BG); r = min(TW/img.width, TH/img.height); ns = (int(img.width*r), int(img.height*r)); resized = img.resize(ns, Image.LANCZOS); canvas.paste(resized, ((TW-ns[0])//2, (TH-ns[1])//2)); canvas.save(r'<OUTPUT>')"
```

缩放：
```powershell
python -c "from PIL import Image; img = Image.open(r'<INPUT>'); resized = img.resize((<W>, <H>), Image.LANCZOS); resized.save(r'<OUTPUT>')"
```

图片拼接（水平）：
```powershell
python -c "from PIL import Image; imgs = [Image.open(p) for p in [r'<IMG1>', r'<IMG2>']]; max_h = max(i.height for i in imgs); total_w = sum(i.width for i in imgs); canvas = Image.new('RGB', (total_w, max_h), (255,255,255)); x = 0; [canvas.paste(i, (x, (max_h - i.height)//2)) or (x := x + i.width) for i in imgs]; canvas.save(r'<OUTPUT>')"
```

---

### 5. Next.js 页面开发 (nextjs-page)

创建新的 Next.js 页面（使用 shadcn/ui 组件）。

**技术栈**：
- 框架：Next.js 15 (App Router)
- UI 库：shadcn/ui
- 样式：Tailwind CSS
- 图标：Lucide React
- 图表：ECharts (echarts-for-react)

**文件结构**：
```
enose-ui/src/
├── app/
│   └── [page-name]/
│       └── page.tsx           # 页面组件
├── components/
│   ├── ui/                    # shadcn/ui 基础组件
│   └── [feature]-panel.tsx    # 功能面板组件
├── hooks/
│   └── use-[feature].ts       # 自定义 Hook
└── lib/
    └── api.ts                 # API 调用函数
```

**常用组件**：

状态徽章：
```tsx
<Badge variant={status === "ok" ? "default" : "destructive"}>{status}</Badge>
```

进度条：
```tsx
<div className="h-2 bg-secondary rounded-full overflow-hidden">
  <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
</div>
```

加载状态：
```tsx
{loading ? (
  <div className="flex items-center gap-2">
    <Loader2 className="h-4 w-4 animate-spin" />
    加载中...
  </div>
) : (
  <div>内容</div>
)}
```

---

## 工作流 (Workflows)

### 1. PDF 论文插图 → Slidev 幻灯片

从 PDF 论文中提取关键插图，处理后集成到 Slidev 幻灯片，Playwright 截图闭环验证。

**前置条件**：
- Python 已安装 `pymupdf` 和 `Pillow`（`pip install pymupdf Pillow`）
- Slidev 项目已存在且 dev server 正在运行
- 图片输出目录：`ppt/public/images/{主题}/`
- 临时缓存目录：`ppt/temp_pdf/`（不删除，可复用）

**步骤**：
1. **批量 PDF 转图片**
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
       pages = min(4, len(doc))
       for i in range(pages):
           pix = doc[i].get_pixmap(dpi=200)
           pix.save(os.path.join(out_dir, f'{safe}_p{i+1}.png'))
       doc.close()
   ```

2. **逐篇阅读，识别核心 Figure**（使用 Read 工具查看导出图片）

3. **裁剪 + 暗色背景适配**
   ```python
   from PIL import Image
   TW, TH = 1600, 900
   BG = (20, 20, 20)
   def process(inp, out, crop_box=None, fill=0.92):
       img = Image.open(inp).convert('RGB')
       if crop_box: img = img.crop(crop_box)
       ratio = min(TW / img.width, TH / img.height) * fill
       ns = (int(img.width * ratio), int(img.height * ratio))
       resized = img.resize(ns, Image.LANCZOS)
       canvas = Image.new('RGB', (TW, TH), BG)
       canvas.paste(resized, ((TW - ns[0]) // 2, (TH - ns[1]) // 2))
       canvas.save(out)
   ```

4. **编写 Slide 内容**（每篇论文一页）
   ```html
   <div class="flex items-center justify-center h-full px-4">
     <div class="text-center">
       <div class="text-sm font-bold mb-2">{论文标题} · {会议/期刊} · {年份}</div>
       <img src="/images/{主题}/fig-{名称}.png" class="img-frame max-h-[65vh] object-contain" />
       <div class="text-xs dim mt-3 max-w-3xl mx-auto"><strong>Insight：</strong>{启发和意义}</div>
     </div>
   </div>
   ```

5. **Playwright 截图验证**：对每个 slide 页截图检查效果

6. **闭环修正**：根据验证结果迭代调整

---

### 2. 方案记忆管理

创建开发方案记忆并在开发过程中迭代更新进度。

**创建方案记忆**：
- Title: "[功能名称]开发方案"
- Tags: ["development_plan", "feature_plan", "[功能标签]"]
- Content 包含：功能模块、数据库表设计（带 checkbox）、后端模块结构、前端页面结构、实现顺序和进度表

**开发过程中更新记忆**：
- 找到对应记忆的 ID
- 将已完成的 checkbox 从 [ ] 改为 [x]
- 更新进度表状态：⏳ 待开始 → 🔄 进行中 → ✅ 已完成

**方案完成后**：
- 状态改为 "已完成"
- 所有 checkbox 标记为 [x]
- 添加完成日期

---

### 3. 通用 Slidev PPT 制作

素材收集 → 截图/图片处理 → 编写 slides.md → Playwright 验证 → 闭环修正。

**步骤**：
1. 确定内容大纲（标题、章节、每页核心内容、设计风格）

2. 收集素材：
   - 截取应用截图（Playwright）
   - 处理已有图片（image-edit skill）
   - 生成图片（AI 生图）

3. 初始化 Slidev 项目（如尚未创建）：`npm init slidev@latest`

4. 编写 slides.md（使用 HTML + Tailwind CSS 精细布局）

**常用 slide 模板**：

全幅截图页：
```markdown
<div class="flex flex-col h-full px-4">
<div class="flex items-center gap-4 mt-4 mb-3">
  <div class="section-line"></div>
  <h1 class="!text-2xl !mb-0">{标题}</h1>
  <div class="dim text-sm">{描述}</div>
</div>
<img src="/images/{name}.png" class="img-frame w-full flex-1 object-cover object-top" />
</div>
```

左文右图页：
```markdown
<div class="flex h-full gap-8 px-8 items-center">
<div class="flex-1">
  <h1>{标题}</h1>
  <p class="dim">{描述}</p>
</div>
<div class="flex-1">
  <img src="/images/{name}.png" class="img-frame" />
</div>
</div>
```

5. 启动 Slidev 预览：`npx slidev --port 3031 --open false`

6. Playwright 逐页截图验证

7. 闭环修正

---

### 4. 演示文稿截图更新

自主探索前端应用，截取截图，更新 Slidev 演示文稿，Playwright 验证闭环。

**前置条件**：
- 前端应用运行在 `http://127.0.0.1:3000/`
- Slidev 项目在 `g:\Downloads\260209组会\ppt\`
- 截图保存到 `ppt/public/images/`

**步骤**：
1. **探索前端页面**：使用 Playwright 获取页面快照，了解结构
2. **截取页面截图**：保存为 `ui-{页面名}.png`
3. **更新 slides.md**：添加或更新 UI 截图页面
4. **启动 Slidev 验证**：`npx slidev --port 3031 --open false`
5. **Playwright 逐页截图验证**：保存到 `ppt/verify/slide-{页码}-{名称}.png`
6. **闭环修正**：根据验证结果调整

**UI 页面 slide 模板**：
```markdown
<div class="flex flex-col h-full px-4">
<div class="flex items-center gap-4 mt-4 mb-3">
  <div class="section-line"></div>
  <h1 class="!text-2xl !mb-0">UI · {页面标题}</h1>
  <div class="dim text-sm">{功能描述}</div>
</div>
<img src="/images/ui-{name}.png" class="img-frame w-full flex-1 object-cover object-top" />
</div>
```

---

## 常用 CSS class 参考

```css
.section-line   — 标题前的红色装饰线
.dim            — 淡灰色辅助文字
.glass          — 毛玻璃卡片效果
.img-frame      — 图片圆角 + 阴影边框
.gradient-num   — 渐变大数字
```

以上 class 需在 slides.md 的 `<style>` 块中定义，根据项目实际情况调整。
