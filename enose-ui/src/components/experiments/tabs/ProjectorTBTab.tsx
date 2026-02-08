"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import { useExperiments } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Loader2,
  Box,
  Square,
  RotateCcw,
  Play,
  Pause,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ScatterPlot, ScatterPlotVisualizerSprites } from "@/lib/tb-projector";
import { projectData, simpleKMeans, type ProjectionType, type ProjectionOptions } from "@/lib/projections";

type VisType = "PCA" | "TSNE" | "UMAP";

const CLUSTER_COLORS = [
  [0.95, 0.26, 0.21], // red
  [0.13, 0.59, 0.95], // blue
  [0.30, 0.69, 0.31], // green
  [1.00, 0.76, 0.03], // yellow
  [0.61, 0.15, 0.69], // purple
  [1.00, 0.60, 0.00], // orange
  [0.00, 0.74, 0.83], // cyan
  [0.91, 0.12, 0.39], // pink
  [0.55, 0.76, 0.29], // lime
  [0.40, 0.23, 0.72], // deep purple
];

export function ProjectorTBTab() {
  const { selectedSampleIds, samples, frameConfig } = useExperiments();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const bgColor = useMemo(() => isDark ? 0x0a0a0b : 0xffffff, [isDark]);
  const bgCss = isDark ? "rgb(10, 10, 11)" : "rgb(255, 255, 255)";

  const [loading, setLoading] = useState(false);
  const [visType, setVisType] = useState<VisType>("PCA");
  const [perplexity, setPerplexity] = useState(30);
  const [is3D, setIs3D] = useState(true);
  const [nClusters, setNClusters] = useState(5);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [isRotating, setIsRotating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scatterPlotRef = useRef<ScatterPlot | null>(null);
  const visualizerRef = useRef<ScatterPlotVisualizerSprites | null>(null);
  const framesDataRef = useRef<{ cacheKey: string; sampleIds: number[]; data: number[][] } | null>(null);
  const projectedDataRef = useRef<{ positions: Float32Array; clusters: number[] } | null>(null);

  // Initialize ScatterPlot when container is ready
  useEffect(() => {
    if (!containerRef.current) return;

    // Cleanup existing
    if (scatterPlotRef.current) {
      scatterPlotRef.current.dispose();
      scatterPlotRef.current = null;
    }

    const container = containerRef.current;
    
    // Clear any existing canvas elements (handles React Strict Mode double-mount)
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    
    // Cancellation flag for async init
    let cancelled = false;
    
    // Wait for container to have dimensions
    const initScatterPlot = () => {
      if (cancelled) return;
      
      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        requestAnimationFrame(initScatterPlot);
        return;
      }

      const scatterPlot = new ScatterPlot(container, {
        onHover: (pointIndex) => {
          // Handle hover
        },
        onClick: (pointIndices) => {
          // Handle click
        },
        backgroundColor: bgColor,
      });

      const visualizer = new ScatterPlotVisualizerSprites();
      scatterPlot.addVisualizer(visualizer);
      scatterPlot.setDimensions(is3D ? 3 : 2);
      scatterPlot.resize();

      scatterPlotRef.current = scatterPlot;
      visualizerRef.current = visualizer;

      // If we have data, render it
      if (projectedDataRef.current) {
        updateScatterPlot(projectedDataRef.current.positions, projectedDataRef.current.clusters);
      }
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
  }, [is3D]);

  // Handle rotation toggle
  useEffect(() => {
    if (scatterPlotRef.current) {
      if (isRotating && is3D) {
        scatterPlotRef.current.startOrbitAnimation();
      } else {
        scatterPlotRef.current.stopOrbitAnimation();
      }
    }
  }, [isRotating, is3D]);

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

  // frameConfig 变化时，清除旧帧缓存和投影结果，并自动重新计算
  const prevFrameConfigRef = useRef(frameConfig);
  const frameConfigChangedRef = useRef(false);
  useEffect(() => {
    if (
      prevFrameConfigRef.current.method !== frameConfig.method ||
      prevFrameConfigRef.current.nSamples !== frameConfig.nSamples
    ) {
      prevFrameConfigRef.current = frameConfig;
      framesDataRef.current = null;
      projectedDataRef.current = null;
      frameConfigChangedRef.current = true;
    }
  }, [frameConfig]);

  // frameConfig 变化后自动重新计算
  useEffect(() => {
    if (frameConfigChangedRef.current && selectedSampleIds.size >= 3) {
      frameConfigChangedRef.current = false;
      computeProjection();
    }
  }, [frameConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中样本变化时自动计算
  const prevSelectedRef = useRef(selectedSampleIds);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedSampleIds && selectedSampleIds.size >= 3) {
      prevSelectedRef.current = selectedSampleIds;
      computeProjection();
    }
  }, [selectedSampleIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch sample frames data
  const fetchFramesData = useCallback(async () => {
    const sampleIdsList = Array.from(selectedSampleIds);
    if (sampleIdsList.length === 0) return null;

    // Check cache（包含 frameConfig 参数）
    const cacheKey = `${sampleIdsList.join(",")}_${frameConfig.method}_${frameConfig.nSamples}`;
    if (framesDataRef.current && 
        framesDataRef.current.cacheKey === cacheKey) {
      return framesDataRef.current;
    }

    setProgressMessage("获取样本帧数据...");

    const framesPromises = sampleIdsList.map(async (sampleId) => {
      const response = await fetch("/api/analytics/sample-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId,
          nSamples: frameConfig.nSamples,
          method: frameConfig.method,
          action: "get",
        }),
      });
      const data = await response.json();
      return { sampleId, frames: data.frames as number[] | null, success: data.success };
    });

    const framesResults = await Promise.all(framesPromises);
    const validFrames = framesResults.filter(r => r.success && r.frames && r.frames.length > 0);

    if (validFrames.length === 0) {
      return null;
    }

    const result = {
      cacheKey,
      sampleIds: validFrames.map(r => r.sampleId),
      data: validFrames.map(r => r.frames!),
    };
    framesDataRef.current = result;
    return result;
  }, [selectedSampleIds, frameConfig]);

  // Update scatter plot with new data
  const updateScatterPlot = useCallback((positions: Float32Array, clusters: number[]) => {
    if (!scatterPlotRef.current) return;

    scatterPlotRef.current.setPointPositions(positions);

    // Set colors based on clusters
    const numPoints = positions.length / 3;
    const colors = new Float32Array(numPoints * 3);
    const scaleFactors = new Float32Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
      const clusterIdx = clusters[i] % CLUSTER_COLORS.length;
      const color = CLUSTER_COLORS[clusterIdx];
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
      scaleFactors[i] = 1.0;
    }

    scatterPlotRef.current.setPointColors(colors);
    scatterPlotRef.current.setPointScaleFactors(scaleFactors);
    scatterPlotRef.current.render();
  }, []);

  // Compute projection
  const computeProjection = useCallback(async () => {
    const framesData = await fetchFramesData();
    if (!framesData) {
      toast.error("没有可用的帧数据，请先生成数据帧");
      return;
    }

    setLoading(true);
    setProgressMessage(`运行 ${visType} 降维...`);

    try {
      const nComponents = is3D ? 3 : 2;

      const options: ProjectionOptions = {
        type: visType,
        nComponents,
        perplexity,
      };

      const result = await projectData(framesData.data, options);

      // Normalize to fit in unit cube
      const projectedPoints = result.points;
      const flatPositions = new Float32Array(projectedPoints.length * 3);

      // Find bounds
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const point of projectedPoints) {
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
        if (point.length > 2) {
          minZ = Math.min(minZ, point[2]);
          maxZ = Math.max(maxZ, point[2]);
        }
      }

      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const rangeZ = is3D ? (maxZ - minZ || 1) : 1;
      const maxRange = Math.max(rangeX, rangeY, rangeZ);

      // Normalize to [-1, 1] range
      for (let i = 0; i < projectedPoints.length; i++) {
        const point = projectedPoints[i];
        flatPositions[i * 3] = ((point[0] - minX) / maxRange) * 2 - 1;
        flatPositions[i * 3 + 1] = ((point[1] - minY) / maxRange) * 2 - 1;
        flatPositions[i * 3 + 2] = is3D && point.length > 2 
          ? ((point[2] - minZ) / maxRange) * 2 - 1 
          : 0;
      }

      // Compute clusters
      const clusterResult = simpleKMeans(projectedPoints, nClusters);

      // Store for later use
      projectedDataRef.current = {
        positions: flatPositions,
        clusters: clusterResult.labels,
      };

      // Update scatter plot
      updateScatterPlot(flatPositions, clusterResult.labels);

      setProgressMessage("");
      toast.success(`${visType} 降维完成: ${projectedPoints.length} 样本`);
    } catch (error) {
      console.error("Projection failed:", error);
      toast.error("降维计算失败");
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  }, [fetchFramesData, visType, is3D, perplexity, nClusters, updateScatterPlot]);

  // Reset camera
  const resetCamera = useCallback(() => {
    if (scatterPlotRef.current) {
      scatterPlotRef.current.resetZoom();
    }
  }, []);

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Controls */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">TensorBoard 风格降维可视化</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap items-center gap-4">
            {/* Projection Type */}
            <div className="flex items-center gap-2">
              <Label className="text-xs">算法</Label>
              <Select value={visType} onValueChange={(v) => setVisType(v as VisType)}>
                <SelectTrigger className="w-24 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PCA">PCA</SelectItem>
                  <SelectItem value="TSNE">t-SNE</SelectItem>
                  <SelectItem value="UMAP">UMAP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Perplexity for t-SNE */}
            {visType === "TSNE" && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">困惑度</Label>
                <Slider
                  value={[perplexity]}
                  onValueChange={([v]) => setPerplexity(v)}
                  min={5}
                  max={50}
                  step={5}
                  className="w-24"
                />
                <Badge variant="outline" className="text-xs">{perplexity}</Badge>
              </div>
            )}

            {/* Clusters */}
            <div className="flex items-center gap-2">
              <Label className="text-xs">聚类数</Label>
              <Slider
                value={[nClusters]}
                onValueChange={([v]) => setNClusters(v)}
                min={2}
                max={10}
                step={1}
                className="w-20"
              />
              <Badge variant="outline" className="text-xs">{nClusters}</Badge>
            </div>

            {/* 2D/3D Toggle */}
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={is3D ? "default" : "outline"}
                      size="sm"
                      onClick={() => setIs3D(!is3D)}
                      className="h-8 w-8 p-0"
                    >
                      {is3D ? <Box className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{is3D ? "切换到2D" : "切换到3D"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Rotation Toggle (3D only) */}
            {is3D && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">旋转</Label>
                <Switch
                  checked={isRotating}
                  onCheckedChange={setIsRotating}
                />
              </div>
            )}

            {/* Reset Camera */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetCamera}
                    className="h-8 w-8 p-0"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>重置视图</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Compute Button */}
            <Button
              onClick={computeProjection}
              disabled={loading || selectedSampleIds.size === 0}
              size="sm"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  计算中...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  计算
                </>
              )}
            </Button>

            {/* Sample Count */}
            <Badge variant="secondary" className="text-xs">
              {selectedSampleIds.size} 样本
            </Badge>

            {/* Progress */}
            {progressMessage && (
              <span className="text-xs text-muted-foreground">{progressMessage}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scatter Plot Container */}
      <Card className="flex-1 min-h-0">
        <CardContent className="p-0 h-full">
          <div 
            ref={containerRef} 
            className="w-full h-full min-h-[400px]"
            style={{ background: bgCss }}
          />
          {selectedSampleIds.size === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
              <p className="text-muted-foreground">请先选择样本，然后点击"计算"按钮</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
