---
name: nextjs-page
description: 创建新的 Next.js 页面（使用 shadcn/ui 组件）
---

# Next.js 页面开发技能

用于在 enose-ui 中创建新页面。

## 技术栈

- **框架**：Next.js 15 (App Router)
- **UI 库**：shadcn/ui
- **样式**：Tailwind CSS
- **图标**：Lucide React
- **图表**：ECharts (echarts-for-react)

## 文件结构

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

## 页面模板

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { [Icons] } from "lucide-react";

export default function [PageName]Page() {
  const [data, setData] = useState<[Type]>(initialValue);
  const [loading, setLoading] = useState(false);

  // 数据获取
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/[endpoint]");
      const json = await res.json();
      setData(json);
    } catch (error) {
      console.error("Failed to fetch:", error);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">[页面标题]</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>[卡片标题]</CardTitle>
          </CardHeader>
          <CardContent>
            {/* 内容 */}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

## 常用组件

### 状态徽章

```tsx
<Badge variant={status === "ok" ? "default" : "destructive"}>
  {status}
</Badge>
```

### 进度条

```tsx
<div className="h-2 bg-secondary rounded-full overflow-hidden">
  <div 
    className="h-full bg-primary transition-all" 
    style={{ width: `${percent}%` }}
  />
</div>
```

### 加载状态

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

## 导航集成

在 `components/top-bar.tsx` 添加导航链接：

```tsx
const navItems = [
  { href: "/", label: "控制" },
  { href: "/experiment", label: "实验" },
  { href: "/[new-page]", label: "[新页面]" },  // 添加这行
];
```
