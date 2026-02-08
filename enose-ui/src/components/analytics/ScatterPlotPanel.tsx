"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import { ScatterPlot, ScatterPlotVisualizerSprites } from "@/lib/tb-projector";

interface VisualizationPoint {
  id: string;
  x: number;
  y: number;
  z?: number;
  cluster: number;
  label?: string;
  experimentId?: string;
  phase?: string;
  paramsHash?: string;
  liquidNames?: string[];
  liquidRatios?: number[];
  gasPumpPwm?: number;
  totalVolumeMl?: number;
  flowRateMlS?: number;
}

type ColorBy = "cluster" | "label" | "experiment" | "phase" | "paramsHash";

interface ScatterPlotPanelProps {
  points: VisualizationPoint[];
  centers?: Array<{ x: number; y: number; z?: number; cluster: number }>;
  nClusters?: number;
  title?: string;
  is3D?: boolean;
  colorBy?: ColorBy;
  onPointClick?: (point: VisualizationPoint | null) => void;
  onPointHover?: (point: VisualizationPoint | null) => void;
}

const CLUSTER_COLORS: [number, number, number][] = [
  [0.33, 0.44, 0.78], // #5470c6
  [0.57, 0.80, 0.46], // #91cc75
  [0.98, 0.78, 0.35], // #fac858
  [0.93, 0.40, 0.40], // #ee6666
  [0.45, 0.75, 0.87], // #73c0de
  [0.23, 0.64, 0.45], // #3ba272
  [0.99, 0.52, 0.32], // #fc8452
  [0.60, 0.38, 0.71], // #9a60b4
  [0.92, 0.49, 0.80], // #ea7ccc
  [0.28, 0.72, 0.82], // #48b8d0
  [1.00, 0.62, 0.50], // #ff9f7f
  [0.53, 0.81, 0.92], // #87ceeb
];

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash >>> 0; // Convert to unsigned 32-bit integer
  }
  return hash;
}

// CSS hex colors for legend display
const CLUSTER_COLORS_HEX = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666",
  "#73c0de", "#3ba272", "#fc8452", "#9a60b4",
  "#ea7ccc", "#48b8d0", "#ff9f7f", "#87ceeb",
];

export function ScatterPlotPanel({
  points,
  centers = [],
  nClusters,
  title = "嵌入可视化",
  is3D = false,
  colorBy = "cluster",
  onPointClick,
  onPointHover,
}: ScatterPlotPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const bgColor = useMemo(() => isDark ? 0x0a0a0b : 0xffffff, [isDark]);
  const bgCss = isDark ? "rgb(10, 10, 11)" : "rgb(255, 255, 255)";

  // Compute actual cluster count from points if not provided
  const actualClusterCount = nClusters ?? (points.length > 0 
    ? Math.max(...points.map(p => p.cluster)) + 1 
    : 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const scatterPlotRef = useRef<ScatterPlot | null>(null);
  const visualizerRef = useRef<ScatterPlotVisualizerSprites | null>(null);
  const [isRotating, setIsRotating] = useState(is3D);
  const [hoveredPoint, setHoveredPoint] = useState<VisualizationPoint | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<VisualizationPoint[]>([]);
  const [scatterReady, setScatterReady] = useState(0);
  const pointsRef = useRef<VisualizationPoint[]>([]);

  // Store points in ref for callbacks
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  // Initialize ScatterPlot
  useEffect(() => {
    if (!containerRef.current) return;

    // Cleanup existing
    if (scatterPlotRef.current) {
      scatterPlotRef.current.dispose();
      scatterPlotRef.current = null;
    }

    const container = containerRef.current;

    // Clear any existing canvas elements
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    let cancelled = false;

    const initScatterPlot = () => {
      if (cancelled) return;

      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        requestAnimationFrame(initScatterPlot);
        return;
      }

      const scatterPlot = new ScatterPlot(container, {
        onHover: (pointIndex) => {
          const point = pointIndex !== null ? pointsRef.current[pointIndex] : null;
          setHoveredPoint(point);
          onPointHover?.(point);
        },
        onClick: (pointIndices) => {
          if (pointIndices.length > 0) {
            onPointClick?.(pointsRef.current[pointIndices[0]]);
          }
        },
        backgroundColor: bgColor,
      });

      const visualizer = new ScatterPlotVisualizerSprites();
      scatterPlot.addVisualizer(visualizer);
      scatterPlot.setDimensions(is3D ? 3 : 2);
      scatterPlot.resize();

      scatterPlotRef.current = scatterPlot;
      visualizerRef.current = visualizer;
      
      // Trigger a re-render so the points update effect can run
      // after ScatterPlot is ready
      setScatterReady(prev => prev + 1);
    };

    requestAnimationFrame(initScatterPlot);

    return () => {
      cancelled = true;
      if (scatterPlotRef.current) {
        scatterPlotRef.current.dispose();
        scatterPlotRef.current = null;
      }
    };
  }, []);

  // Handle theme change - update background color dynamically
  useEffect(() => {
    if (scatterPlotRef.current) {
      scatterPlotRef.current.setBackgroundColor(bgColor);
    }
  }, [bgColor]);

  // Handle dimension change
  useEffect(() => {
    if (scatterPlotRef.current) {
      scatterPlotRef.current.setDimensions(is3D ? 3 : 2);
      scatterPlotRef.current.resize();
      scatterPlotRef.current.render();
    }
    // Auto-enable rotation in 3D mode
    setIsRotating(is3D);
  }, [is3D]);

  // Handle rotation toggle (include scatterReady to apply after init)
  useEffect(() => {
    if (scatterPlotRef.current) {
      if (isRotating && is3D) {
        scatterPlotRef.current.startOrbitAnimation();
      } else {
        scatterPlotRef.current.stopOrbitAnimation();
      }
    }
  }, [isRotating, is3D, scatterReady]);

  // Update points when data changes
  useEffect(() => {
    if (!scatterPlotRef.current || points.length === 0) return;

    // Normalize points to [-1, 1] range
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      if (p.z !== undefined) {
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = is3D ? (maxZ - minZ || 1) : 1;
    const maxRange = Math.max(rangeX, rangeY, rangeZ);

    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    const scaleFactors = new Float32Array(points.length);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      positions[i * 3] = ((p.x - minX) / maxRange) * 2 - 1;
      positions[i * 3 + 1] = ((p.y - minY) / maxRange) * 2 - 1;
      positions[i * 3 + 2] = is3D && p.z !== undefined
        ? ((p.z - minZ) / maxRange) * 2 - 1
        : 0;

      // Determine color based on colorBy
      let colorIndex = 0;
      switch (colorBy) {
        case "cluster":
          colorIndex = p.cluster ?? 0;
          break;
        case "label":
          colorIndex = p.label ? hashString(p.label) : 0;
          break;
        case "experiment":
          colorIndex = p.experimentId ? hashString(p.experimentId) : 0;
          break;
        case "phase":
          colorIndex = p.phase ? hashString(p.phase) : 0;
          break;
        case "paramsHash":
          colorIndex = p.paramsHash ? hashString(p.paramsHash) : 0;
          break;
      }
      const color = CLUSTER_COLORS[Math.abs(colorIndex) % CLUSTER_COLORS.length];
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];

      scaleFactors[i] = 1.0;
    }

    scatterPlotRef.current.setPointPositions(positions);
    scatterPlotRef.current.setPointColors(colors);
    scatterPlotRef.current.setPointScaleFactors(scaleFactors);
    scatterPlotRef.current.render();
  }, [points, is3D, colorBy, scatterReady]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (scatterPlotRef.current) {
        scatterPlotRef.current.resize();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleReset = useCallback(() => {
    scatterPlotRef.current?.resetZoom();
  }, []);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-4">
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
            <Button variant="ghost" size="icon" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 min-h-[400px]">
        <div className="relative w-full h-full min-h-[400px] overflow-hidden">
          <div 
            ref={containerRef} 
            className="absolute inset-0"
            style={{ background: bgCss }}
          />

          {points.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background">
              点击"计算"按钮生成可视化
            </div>
          )}

          {/* 悬停信息 */}
          {hoveredPoint && (
            <div className="absolute top-2 left-2 bg-background/90 border rounded-lg px-3 py-2 text-xs shadow-lg z-10 pointer-events-none max-w-xs">
              <div className="font-medium">样本 #{hoveredPoint.id}</div>
              {hoveredPoint.liquidNames && hoveredPoint.liquidNames.length > 0 && (
                <div className="text-muted-foreground">
                  液体: {hoveredPoint.liquidNames.map((name, i) => {
                    const ratio = hoveredPoint.liquidRatios?.[i];
                    return ratio !== undefined ? `${name}(${ratio.toFixed(0)}%)` : name;
                  }).join(", ")}
                </div>
              )}
              <div className="text-muted-foreground">
                聚类: {hoveredPoint.cluster}
                {hoveredPoint.experimentId && ` | 实验: ${hoveredPoint.experimentId}`}
                {hoveredPoint.phase && ` | 阶段: ${hoveredPoint.phase}`}
              </div>
              {(hoveredPoint.totalVolumeMl !== undefined || hoveredPoint.flowRateMlS !== undefined || hoveredPoint.gasPumpPwm !== undefined) && (
                <div className="text-muted-foreground">
                  {hoveredPoint.totalVolumeMl !== undefined && `进样: ${hoveredPoint.totalVolumeMl}ml`}
                  {hoveredPoint.flowRateMlS !== undefined && ` | 流速: ${hoveredPoint.flowRateMlS}ml/s`}
                  {hoveredPoint.gasPumpPwm !== undefined && ` | 气泵: ${hoveredPoint.gasPumpPwm}`}
                </div>
              )}
              {hoveredPoint.paramsHash && (
                <div className="text-muted-foreground font-mono">
                  哈希: {hoveredPoint.paramsHash.slice(0, 8)}
                </div>
              )}
              <div className="text-muted-foreground">
                坐标: ({hoveredPoint.x.toFixed(2)}, {hoveredPoint.y.toFixed(2)}
                {hoveredPoint.z !== undefined && `, ${hoveredPoint.z.toFixed(2)}`})
              </div>
            </div>
          )}

          {/* 选中统计 */}
          {selectedPoints.length > 0 && (
            <div className="absolute bottom-2 left-2 bg-background/90 border rounded-lg px-3 py-2 text-xs shadow-lg z-10">
              已选中 {selectedPoints.length} 个点
            </div>
          )}

          {/* 聚类图例 */}
          {actualClusterCount > 0 && colorBy === "cluster" && (
            <div className="absolute top-2 right-2 bg-background/90 border rounded-lg px-3 py-2 text-xs shadow-lg z-10">
              <div className="font-medium mb-1">聚类</div>
              {Array.from({ length: actualClusterCount }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: CLUSTER_COLORS_HEX[i % CLUSTER_COLORS_HEX.length] }}
                  />
                  <span>簇 {i}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
