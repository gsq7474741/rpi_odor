"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RotateCcw, Box, Square } from "lucide-react";
import type { ScatterGL as ScatterGLType, Dataset as DatasetType, Point2D, Point3D } from "scatter-gl";

// 防抖函数
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

interface VisualizationPoint {
  id: string;
  x: number;
  y: number;
  z?: number;
  cluster: number;
  label?: string;
  experimentId?: string;
  phase?: string;
}

type ColorBy = "cluster" | "label" | "experiment" | "phase";

interface ScatterGLPanelProps {
  points: VisualizationPoint[];
  centers?: Array<{ x: number; y: number; z?: number; cluster: number }>;
  title?: string;
  is3D?: boolean; // 外部控制 3D 模式
  colorBy?: ColorBy; // 染色方式
  onPointClick?: (point: VisualizationPoint | null) => void;
  onPointHover?: (point: VisualizationPoint | null) => void;
  onSelectionChange?: (points: VisualizationPoint[]) => void;
}

const CLUSTER_COLORS = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666",
  "#73c0de", "#3ba272", "#fc8452", "#9a60b4",
  "#ea7ccc", "#48b8d0", "#ff9f7f", "#87ceeb",
];

// 简单的字符串哈希函数
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

interface ScatterGLModule {
  ScatterGL: typeof ScatterGLType;
  Dataset: typeof DatasetType;
}

export function ScatterGLPanel({
  points,
  centers = [],
  title = "嵌入可视化",
  is3D = false,
  colorBy = "cluster",
  onPointClick,
  onPointHover,
  onSelectionChange,
}: ScatterGLPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scatterRef = useRef<ScatterGLType | null>(null);
  const [isRotating, setIsRotating] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<VisualizationPoint | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<VisualizationPoint[]>([]);
  const [scatterModule, setScatterModule] = useState<ScatterGLModule | null>(null);
  // 容器尺寸状态 - 用于触发重建（解决 picking texture framebuffer 问题）
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const resizeVersionRef = useRef(0); // 用于追踪 resize 版本，避免竞态

  // 动态导入 scatter-gl (避免 SSR 问题)
  useEffect(() => {
    let mounted = true;
    import("scatter-gl").then((module) => {
      if (mounted) {
        setScatterModule(module as unknown as ScatterGLModule);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // 使用 ResizeObserver 监听容器尺寸变化
  // scatter-gl 的 picking texture 在 resize 时不会自动更新，需要重建实例
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = debounce(() => {
      const rect = container.getBoundingClientRect();
      // 只有尺寸有效时才更新（避免 framebuffer 尺寸为 0）
      if (rect.width >= 10 && rect.height >= 10) {
        resizeVersionRef.current += 1;
        setContainerSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    }, 150); // 150ms 防抖，等待布局稳定

    // 初始尺寸
    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 清理函数 - 释放 WebGL 资源
  const cleanupScatter = useCallback(() => {
    if (scatterRef.current) {
      try {
        (scatterRef.current as unknown as { dispose?: () => void }).dispose?.();
      } catch (e) {
        console.warn("ScatterGL dispose failed:", e);
      }
      scatterRef.current = null;
    }
    
    const container = containerRef.current;
    if (container) {
      const oldCanvas = container.querySelector("canvas");
      if (oldCanvas) {
        const gl = oldCanvas.getContext("webgl") || oldCanvas.getContext("webgl2");
        if (gl) {
          const ext = gl.getExtension("WEBGL_lose_context");
          ext?.loseContext();
        }
      }
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }
  }, []);

  // 初始化 ScatterGL - 依赖 containerSize 确保 picking texture 尺寸正确
  useEffect(() => {
    // 等待容器尺寸稳定后再初始化
    if (!containerRef.current || !scatterModule || points.length === 0 || !containerSize) return;

    const { ScatterGL, Dataset } = scatterModule;
    const container = containerRef.current;

    // 清理旧实例
    cleanupScatter();

    // 准备数据 - 使用正确的元组类型
    const coords: Array<Point2D | Point3D> = points.map((p) =>
      is3D
        ? [p.x, p.y, p.z ?? 0] as Point3D
        : [p.x, p.y] as Point2D
    );

    // 创建数据集
    const dataset = new Dataset(coords);

    // 创建渲染器 - containerSize 变化时会重建，确保 picking texture 尺寸正确
    const scatter = new ScatterGL(container, {
      onClick: (pointIndex: number | null) => {
        if (pointIndex !== null && onPointClick) {
          onPointClick(points[pointIndex]);
        }
      },
      onHover: (pointIndex: number | null) => {
        const point = pointIndex !== null ? points[pointIndex] : null;
        setHoveredPoint(point);
        onPointHover?.(point);
      },
      onSelect: (pointIndices: number[]) => {
        const selected = pointIndices.map((i) => points[i]);
        setSelectedPoints(selected);
        onSelectionChange?.(selected);
      },
      renderMode: "POINT" as unknown as undefined,
      showLabelsOnHover: true,
      selectEnabled: true,
      rotateOnStart: false,
      styles: {
        point: {
          scaleDefault: 1.2,
          scaleSelected: 2.0,
          scaleHover: 1.6,
        },
        fog: { enabled: is3D },
      },
    });

    // 设置点颜色 - 根据 colorBy 决定染色方式
    scatter.setPointColorer((i: number) => {
      const point = points[i];
      if (!point) return CLUSTER_COLORS[0];
      
      let colorIndex = 0;
      switch (colorBy) {
        case "cluster":
          colorIndex = point.cluster ?? 0;
          break;
        case "label":
          colorIndex = point.label ? hashString(point.label) : 0;
          break;
        case "experiment":
          colorIndex = point.experimentId ? hashString(point.experimentId) : 0;
          break;
        case "phase":
          colorIndex = point.phase ? hashString(point.phase) : 0;
          break;
      }
      return CLUSTER_COLORS[Math.abs(colorIndex) % CLUSTER_COLORS.length];
    });

    // 渲染
    scatter.render(dataset);
    scatterRef.current = scatter;

    // 3D 模式下启动旋转动画
    if (is3D && isRotating) {
      scatter.startOrbitAnimation();
    }

    return cleanupScatter;
    // containerSize 变化时重建实例，确保 picking texture 尺寸与容器匹配
  }, [scatterModule, points, is3D, colorBy, onPointClick, onPointHover, onSelectionChange, cleanupScatter, containerSize]);

  // 旋转状态变化时更新（不重建实例）
  useEffect(() => {
    if (scatterRef.current && is3D) {
      if (isRotating) {
        scatterRef.current.startOrbitAnimation();
      } else {
        scatterRef.current.stopOrbitAnimation();
      }
    }
  }, [isRotating, is3D]);

  // 注意：不再使用 window resize 监听器，改用 ResizeObserver 触发重建
  // 这样可以确保 picking texture 的尺寸始终正确

  const handleReset = useCallback(() => {
    scatterRef.current?.resetZoom();
  }, []);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-4">
            {/* 3D 自动旋转 */}
            {is3D && (
              <div className="flex items-center gap-2">
                <Label htmlFor="rotate" className="text-xs text-muted-foreground">
                  旋转
                </Label>
                <Switch
                  checked={isRotating}
                  onCheckedChange={setIsRotating}
                  id="rotate"
                />
              </div>
            )}

            {/* 重置视图 */}
            <Button variant="ghost" size="icon" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 relative min-h-[400px]">
        {/* 渲染容器 */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* 无数据提示 */}
        {points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background">
            点击"计算"按钮生成可视化
          </div>
        )}

        {/* 悬停信息 */}
        {hoveredPoint && (
          <div className="absolute top-2 left-2 bg-background/90 border rounded-lg px-3 py-2 text-xs shadow-lg">
            <div className="font-medium">{hoveredPoint.label || hoveredPoint.id}</div>
            <div className="text-muted-foreground">
              聚类: {hoveredPoint.cluster}
              {hoveredPoint.experimentId && ` | 实验: ${hoveredPoint.experimentId}`}
              {hoveredPoint.phase && ` | 阶段: ${hoveredPoint.phase}`}
            </div>
            <div className="text-muted-foreground">
              坐标: ({hoveredPoint.x.toFixed(2)}, {hoveredPoint.y.toFixed(2)}
              {hoveredPoint.z !== undefined && `, ${hoveredPoint.z.toFixed(2)}`})
            </div>
          </div>
        )}

        {/* 选中统计 */}
        {selectedPoints.length > 0 && (
          <div className="absolute bottom-2 left-2 bg-background/90 border rounded-lg px-3 py-2 text-xs shadow-lg">
            已选中 {selectedPoints.length} 个点
          </div>
        )}

        {/* 聚类图例 */}
        {centers.length > 0 && (
          <div className="absolute top-2 right-2 bg-background/90 border rounded-lg px-3 py-2 text-xs shadow-lg">
            <div className="font-medium mb-1">聚类</div>
            {centers.map((center, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: CLUSTER_COLORS[i % CLUSTER_COLORS.length] }}
                />
                <span>簇 {i}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
