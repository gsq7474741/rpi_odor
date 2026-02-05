"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Eye,
  Box,
  Square,
  Palette,
  Network,
  Cpu,
  Server,
  Play,
  Pause,
  RotateCcw,
  Circle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScatterGLPanel } from "@/components/analytics/ScatterGLPanel";
import { Switch } from "@/components/ui/switch";
import { projectData, simpleKMeans, createTSNERunner, sphereizeData, type ProjectionType, type TSNERunner } from "@/lib/projections";
import { toast } from "sonner";

interface VisPoint {
  id: string;
  coords: number[];
  cluster: number;
  label?: string;
  ts?: string;
}

interface VisualizationResult {
  type: string;
  points: VisPoint[];
  centers: VisPoint[];
  explainedVarianceRatio: number[];
  totalSamples: number;
  nClusters: number;
}

type VisType = "PCA" | "TSNE" | "UMAP";
type ColorBy = "cluster" | "label" | "experiment" | "phase";
type ComputeMode = "frontend" | "backend";

const MAX_FRONTEND_SAMPLES = 5000;

export function ProjectorTab() {
  const { filters, selectedSampleIds, samples } = useExperiments();

  const [loading, setLoading] = useState(false);
  const [visType, setVisType] = useState<VisType>("PCA");
  const [perplexity, setPerplexity] = useState(30);
  const [maxPoints, setMaxPoints] = useState(500);
  const [visResult, setVisResult] = useState<VisualizationResult | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [colorBy, setColorBy] = useState<ColorBy>("cluster");
  const [nClusters, setNClusters] = useState(5);
  const [computeMode, setComputeMode] = useState<ComputeMode>("frontend");
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [sphereize, setSphereize] = useState(false);
  
  // Iterative t-SNE state
  const [tsneRunner, setTsneRunner] = useState<TSNERunner | null>(null);
  const [tsneIteration, setTsneIteration] = useState(0);
  const [tsneRunning, setTsneRunning] = useState(false);
  
  // Cache for sample frames data (to avoid re-fetching)
  const framesDataRef = useRef<{ sampleIds: number[]; data: number[][] } | null>(null);

  // 获取选中的样本对应的运行 ID 列表
  const selectedRunIds = useMemo(() => {
    const targetIds = Array.from(selectedSampleIds);
    if (targetIds.length === 0) return [];
    const runIdSet = new Set<number>();
    samples
      .filter((s) => targetIds.includes(s.id))
      .forEach((s) => runIdSet.add(s.runId));
    return Array.from(runIdSet);
  }, [selectedSampleIds, samples]);

  // 自动选择计算模式
  useEffect(() => {
    const sampleCount = selectedSampleIds.size;
    if (sampleCount > 0 && sampleCount <= MAX_FRONTEND_SAMPLES) {
      setComputeMode("frontend");
    } else {
      setComputeMode("backend");
    }
  }, [selectedSampleIds.size]);

  // 获取样本帧数据
  const fetchFramesData = useCallback(async () => {
    const sampleIdsList = Array.from(selectedSampleIds);
    if (sampleIdsList.length === 0) return null;

    // Check cache
    if (framesDataRef.current && 
        JSON.stringify(framesDataRef.current.sampleIds) === JSON.stringify(sampleIdsList)) {
      return framesDataRef.current;
    }

    setProgressMessage("获取样本帧数据...");

    const framesPromises = sampleIdsList.map(async (sampleId) => {
      const response = await fetch("/api/analytics/sample-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId,
          nSamples: 100,
          method: "linear",
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
      sampleIds: validFrames.map(r => r.sampleId),
      data: validFrames.map(r => r.frames!),
    };
    framesDataRef.current = result;
    return result;
  }, [selectedSampleIds]);

  // 构建可视化结果
  const buildVisResult = useCallback((
    projectedPoints: number[][],
    sampleIds: number[],
    type: string,
    explainedVariance?: number[]
  ) => {
    const clusters = simpleKMeans(projectedPoints, nClusters);

    const points: VisPoint[] = projectedPoints.map((coords: number[], idx: number) => {
      const sampleId = sampleIds[idx];
      const sample = samples.find(s => s.id === sampleId);
      return {
        id: sampleId.toString(),
        coords,
        cluster: clusters.labels[idx],
        label: (sample as { labelName?: string })?.labelName || undefined,
      };
    });

    const centers: VisPoint[] = clusters.centroids.map((coords: number[], idx: number) => ({
      id: `center-${idx}`,
      coords,
      cluster: idx,
    }));

    return {
      type,
      points,
      centers,
      explainedVarianceRatio: explainedVariance || [],
      totalSamples: points.length,
      nClusters,
    };
  }, [samples, nClusters]);

  // 启动迭代式 t-SNE
  const startIterativeTSNE = useCallback(async () => {
    const framesData = await fetchFramesData();
    if (!framesData) {
      toast.error("没有可用的帧数据，请先生成数据帧");
      return;
    }

    // Stop existing runner
    if (tsneRunner) {
      tsneRunner.stop();
    }

    setProgressMessage("初始化 t-SNE...");
    setLoading(true);

    const runner = createTSNERunner(framesData.data, {
      nComponents: is3D ? 3 : 2,
      perplexity,
      sphereize,
      onStep: (iteration, points) => {
        setTsneIteration(iteration);
        // Update visualization every 5 iterations for performance
        if (iteration % 5 === 0 || iteration < 10) {
          setVisResult(buildVisResult(points, framesData.sampleIds, "TSNE"));
        }
      },
    });

    setTsneRunner(runner);
    setLoading(false);
    setProgressMessage("");
    
    // Start running
    runner.start();
    setTsneRunning(true);
  }, [fetchFramesData, tsneRunner, is3D, perplexity, sphereize, buildVisResult]);

  // t-SNE 控制
  const toggleTSNE = useCallback(() => {
    if (!tsneRunner) return;
    if (tsneRunning) {
      tsneRunner.pause();
      setTsneRunning(false);
    } else {
      tsneRunner.start();
      setTsneRunning(true);
    }
  }, [tsneRunner, tsneRunning]);

  const resetTSNE = useCallback(() => {
    if (tsneRunner) {
      tsneRunner.stop();
      setTsneRunner(null);
    }
    setTsneIteration(0);
    setTsneRunning(false);
  }, [tsneRunner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tsneRunner) {
        tsneRunner.stop();
      }
    };
  }, [tsneRunner]);

  // 前端计算降维 (非迭代式)
  const computeFrontend = useCallback(async () => {
    // For t-SNE, use iterative mode
    if (visType === "TSNE") {
      await startIterativeTSNE();
      return;
    }

    const framesData = await fetchFramesData();
    if (!framesData) {
      toast.error("没有可用的帧数据，请先生成数据帧");
      return;
    }

    setLoading(true);
    setProgressMessage(`运行 ${visType} 降维 (${framesData.data.length} 样本)...`);

    try {
      const result = await projectData(framesData.data, {
        type: visType as ProjectionType,
        nComponents: is3D ? 3 : 2,
        perplexity,
        nNeighbors: 15,
        minDist: 0.1,
        nIterations: 500,
        sphereize,
        onProgress: (progress, message) => {
          setProgressMessage(`${message} (${progress.toFixed(0)}%)`);
        },
      });

      setVisResult(buildVisResult(result.points, framesData.sampleIds, visType, result.explained_variance));
      setProgressMessage("");
      toast.success(`前端降维完成: ${framesData.sampleIds.length} 样本`);
    } catch (error) {
      console.error("Frontend projection failed:", error);
      toast.error("前端降维失败，切换到后端计算");
      setComputeMode("backend");
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  }, [visType, fetchFramesData, startIterativeTSNE, is3D, perplexity, sphereize, buildVisResult]);

  // 后端计算降维
  const computeBackend = useCallback(async () => {
    if (selectedSampleIds.size === 0 && selectedRunIds.length === 0) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      
      const sampleIdsList = Array.from(selectedSampleIds);
      if (sampleIdsList.length > 0) {
        params.set("sampleIds", sampleIdsList.join(","));
      }
      
      params.set("experimentIds", selectedRunIds.join(","));
      params.set("type", visType === "PCA" ? "PCA_CLUSTERING" : visType);
      params.set("maxPoints", maxPoints.toString());
      params.set("nComponents", is3D ? "3" : "2");
      params.set("nClusters", nClusters.toString());
      if (filters.phaseNames.length > 0) {
        params.set("phaseNames", filters.phaseNames.join(","));
      }
      if (visType === "TSNE") {
        params.set("perplexity", perplexity.toString());
      }

      const response = await fetch(`/api/analytics/visualization?${params}`);
      const data = await response.json();

      if (data.points) {
        setVisResult(data);
      }
    } catch (error) {
      console.error("Failed to fetch visualization:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedSampleIds, selectedRunIds, filters.phaseNames, visType, maxPoints, perplexity, is3D, nClusters]);

  // 加载可视化数据
  const fetchVisualization = useCallback(async () => {
    if (computeMode === "frontend" && selectedSampleIds.size > 0) {
      await computeFrontend();
    } else {
      await computeBackend();
    }
  }, [computeMode, selectedSampleIds.size, computeFrontend, computeBackend]);

  // 选中样本变化时自动加载数据
  useEffect(() => {
    if (selectedRunIds.length > 0) {
      fetchVisualization();
    }
  }, [selectedRunIds, selectedSampleIds, filters.phaseNames]); // eslint-disable-line react-hooks/exhaustive-deps

  // 参数变化时自动重新加载（使用 ref 避免竞态）
  const prevIs3DRef = useRef(is3D);
  useEffect(() => {
    // 如果是 3D 切换，延迟执行避免与 ScatterGL 重建竞态
    if (prevIs3DRef.current !== is3D) {
      prevIs3DRef.current = is3D;
      if (selectedRunIds.length > 0) {
        fetchVisualization();
      }
      return;
    }
    
    if (selectedRunIds.length > 0 && visResult) {
      fetchVisualization();
    }
  }, [is3D, nClusters, visType, maxPoints, perplexity]); // eslint-disable-line react-hooks/exhaustive-deps

  // 转换数据格式为 ScatterGLPanel 组件 - 使用 useMemo 避免不必要的重建
  const scatterPoints = useMemo(() => 
    visResult?.points.map((p) => ({
      id: p.id,
      x: p.coords[0] || 0,
      y: p.coords[1] || 0,
      z: is3D ? (p.coords[2] ?? 0) : undefined,
      cluster: p.cluster,
      label: p.label,
    })) || []
  , [visResult?.points, is3D]);

  const scatterCenters = useMemo(() =>
    visResult?.centers.map((c) => ({
      x: c.coords[0] || 0,
      y: c.coords[1] || 0,
      z: is3D ? (c.coords[2] ?? 0) : undefined,
      cluster: c.cluster,
    })) || []
  , [visResult?.centers, is3D]);

  if (selectedRunIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Eye className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">选择运行查看降维可视化</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          在左侧列表中选择一个运行，或启用对比模式选择多个项目进行对比。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* 控制栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          {/* 可视化类型 */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">类型:</Label>
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

          {/* t-SNE 困惑度 */}
          {visType === "TSNE" && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">困惑度:</Label>
              <div className="w-24">
                <Slider
                  value={[perplexity]}
                  min={5}
                  max={50}
                  step={5}
                  onValueChange={([v]) => setPerplexity(v)}
                />
              </div>
              <span className="text-sm text-muted-foreground w-8">{perplexity}</span>
            </div>
          )}

          {/* t-SNE 迭代控制 */}
          {visType === "TSNE" && computeMode === "frontend" && tsneRunner && (
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleTSNE}
                      className="h-8 w-8 p-0"
                    >
                      {tsneRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{tsneRunning ? "暂停 t-SNE" : "继续 t-SNE"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetTSNE}
                      className="h-8 w-8 p-0"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>重置 t-SNE</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Badge variant="secondary" className="ml-1">
                迭代: {tsneIteration}
              </Badge>
            </div>
          )}

          {/* 球形化数据 */}
          {computeMode === "frontend" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
                    <Circle className={`h-4 w-4 ${sphereize ? 'text-green-500' : 'text-muted-foreground'}`} />
                    <Switch checked={sphereize} onCheckedChange={setSphereize} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>球形化数据 (Sphereize)</p>
                  <p className="text-xs text-muted-foreground">将数据中心化并归一化到单位球面</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* 最大样本数 */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">最大样本数:</Label>
            <Select value={maxPoints.toString()} onValueChange={(v) => setMaxPoints(parseInt(v))}>
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="1000">1000</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 聚类数量 */}
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <Select value={nClusters.toString()} onValueChange={(v) => setNClusters(parseInt(v))}>
              <SelectTrigger className="w-16 h-8" title="K-Means 聚类数量">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5, 6, 7, 8, 10, 12, 15].map((n) => (
                  <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 染色方式 */}
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorBy)}>
              <SelectTrigger className="w-24 h-8" title="点染色方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cluster">聚类</SelectItem>
                <SelectItem value="label">标签</SelectItem>
                <SelectItem value="experiment">实验</SelectItem>
                <SelectItem value="phase">阶段</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 2D/3D 维度切换 */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
                  <Square className="h-4 w-4 text-muted-foreground" />
                  <Switch checked={is3D} onCheckedChange={setIs3D} />
                  <Box className="h-4 w-4 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>切换 2D/3D 降维模式</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Badge variant="secondary">
            {selectedRunIds.length === 1 
              ? `Run #${selectedRunIds[0]}` 
              : `${selectedRunIds.length} 个运行`}
          </Badge>
          {/* 计算模式切换 */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
                  <Cpu className={`h-4 w-4 ${computeMode === 'frontend' ? 'text-green-500' : 'text-muted-foreground'}`} />
                  <Switch 
                    checked={computeMode === "backend"} 
                    onCheckedChange={(v) => setComputeMode(v ? "backend" : "frontend")}
                    disabled={selectedSampleIds.size > MAX_FRONTEND_SAMPLES}
                  />
                  <Server className={`h-4 w-4 ${computeMode === 'backend' ? 'text-blue-500' : 'text-muted-foreground'}`} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{computeMode === "frontend" ? "前端计算 (快速)" : "后端计算 (大数据集)"}</p>
                {selectedSampleIds.size > MAX_FRONTEND_SAMPLES && (
                  <p className="text-xs text-muted-foreground">样本数超过 {MAX_FRONTEND_SAMPLES}，仅支持后端计算</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {visResult && (
            <Badge variant="outline">
              {visResult.totalSamples} 样本, {visResult.nClusters} 聚类
            </Badge>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchVisualization}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>重新计算并加载可视化</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* 方差解释率 (PCA) */}
      {visType === "PCA" && visResult?.explainedVarianceRatio && visResult.explainedVarianceRatio.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">方差解释率:</span>
          {visResult.explainedVarianceRatio.slice(0, is3D ? 3 : 2).map((ratio, idx) => (
            <Badge key={idx} variant="secondary">
              PC{idx + 1}: {(ratio * 100).toFixed(1)}%
            </Badge>
          ))}
          <Badge variant="outline">
            总计: {(visResult.explainedVarianceRatio.slice(0, is3D ? 3 : 2).reduce((a, b) => a + b, 0) * 100).toFixed(1)}%
          </Badge>
        </div>
      )}

      {/* ScatterGL 图表区域 */}
      <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-muted/20">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            {progressMessage && (
              <p className="text-sm text-muted-foreground">{progressMessage}</p>
            )}
          </div>
        ) : !visResult || scatterPoints.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Eye className="h-12 w-12 mb-4 opacity-50" />
            <p>点击刷新按钮加载可视化数据</p>
          </div>
        ) : (
          <ScatterGLPanel
            points={scatterPoints}
            centers={scatterCenters}
            title={`${visType} ${is3D ? "3D" : "2D"} 可视化`}
            is3D={is3D}
            colorBy={colorBy}
          />
        )}
      </div>
    </div>
  );
}
