"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RotateCcw, Box, Square } from "lucide-react";
import type { ScatterGL as ScatterGLType, Dataset as DatasetType, Point2D, Point3D } from "scatter-gl";

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

interface ScatterGLPanelProps {
  points: VisualizationPoint[];
  centers?: Array<{ x: number; y: number; z?: number; cluster: number }>;
  title?: string;
  onPointClick?: (point: VisualizationPoint | null) => void;
  onPointHover?: (point: VisualizationPoint | null) => void;
  onSelectionChange?: (points: VisualizationPoint[]) => void;
}

const CLUSTER_COLORS = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666",
  "#73c0de", "#3ba272", "#fc8452", "#9a60b4",
  "#ea7ccc", "#48b8d0", "#ff9f7f", "#87ceeb",
];

interface ScatterGLModule {
  ScatterGL: typeof ScatterGLType;
  Dataset: typeof DatasetType;
}

export function ScatterGLPanel({
  points,
  centers = [],
  title = "嵌入可视化",
  onPointClick,
  onPointHover,
  onSelectionChange,
}: ScatterGLPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scatterRef = useRef<ScatterGLType | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [isRotating, setIsRotating] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<VisualizationPoint | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<VisualizationPoint[]>([]);
  const [scatterModule, setScatterModule] = useState<ScatterGLModule | null>(null);

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

  // 初始化 ScatterGL
  useEffect(() => {
    if (!containerRef.current || !scatterModule || points.length === 0) return;

    const { ScatterGL, Dataset } = scatterModule;
    const container = containerRef.current;

    // 清理旧实例 - 彻底清理 DOM
    scatterRef.current = null;
    // 清空容器内的所有子元素
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // 准备数据 - 使用正确的元组类型
    const has3D = points.some((p) => p.z !== undefined);
    const coords: Array<Point2D | Point3D> = points.map((p) =>
      has3D && is3D
        ? [p.x, p.y, p.z ?? 0] as Point3D
        : [p.x, p.y] as Point2D
    );

    // 创建数据集
    const dataset = new Dataset(coords);

    // 创建渲染器
    const scatter = new ScatterGL(containerRef.current, {
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
      rotateOnStart: is3D && isRotating,
      styles: {
        point: {
          scaleDefault: 1.2,
          scaleSelected: 2.0,
          scaleHover: 1.6,
        },
        fog: { enabled: is3D },
      },
    });

    // 设置点颜色
    scatter.setPointColorer((i: number) => {
      const cluster = points[i]?.cluster ?? 0;
      return CLUSTER_COLORS[cluster % CLUSTER_COLORS.length];
    });

    // 渲染
    scatter.render(dataset);
    scatterRef.current = scatter;

    return () => {
      scatterRef.current = null;
      // 清空容器
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, [scatterModule, points, is3D, isRotating, onPointClick, onPointHover, onSelectionChange]);

  // 窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      scatterRef.current?.resize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleReset = useCallback(() => {
    scatterRef.current?.resetZoom();
  }, []);

  const has3DData = points.some((p) => p.z !== undefined);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-4">
            {/* 3D 切换 */}
            {has3DData && (
              <div className="flex items-center gap-2">
                <Square className="h-4 w-4 text-muted-foreground" />
                <Switch
                  checked={is3D}
                  onCheckedChange={setIs3D}
                  id="3d-mode"
                />
                <Box className="h-4 w-4 text-muted-foreground" />
              </div>
            )}

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
