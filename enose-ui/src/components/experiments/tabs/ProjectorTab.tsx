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
  ScatterChart,
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
  Dices,
  Lock,
  Unlock,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScatterPlotPanel } from "@/components/analytics/ScatterPlotPanel";
import { Switch } from "@/components/ui/switch";
import { projectData, simpleKMeans, type ProjectionType, type TSNERunner, ProjectionDataSet, type DataPoint } from "@/lib/projections";
import { toast } from "sonner";

interface VisPoint {
  id: string;
  coords: number[];
  cluster: number;
  label?: string;
  experimentId?: string;
  phase?: string;
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
  const { filters, selectedSampleIds, samples, frameConfig } = useExperiments();

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
  
  // Seed control for reproducible projections
  const [seed, setSeed] = useState<number>(() => Date.now());
  const [seedLocked, setSeedLocked] = useState(false);
  
  // ProjectionDataSet for caching projections
  const [dataSet, setDataSet] = useState<ProjectionDataSet | null>(null);
  
  // Iterative t-SNE state
  const [tsneRunner, setTsneRunner] = useState<TSNERunner | null>(null);
  const [tsneIteration, setTsneIteration] = useState(0);
  const [tsneRunning, setTsneRunning] = useState(false);
  
  // Cache for sample frames data (to avoid re-fetching)
  const framesDataRef = useRef<{ cacheKey: string; sampleIds: number[]; data: number[][] } | null>(null);

  // Ref for buildVisResult so t-SNE onStep always uses the latest (picks up nClusters changes)
  const buildVisResultRef = useRef<typeof buildVisResult | null>(null);

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

  // 构建可视化结果
  const buildVisResult = useCallback((
    projectedPoints: number[][],
    sampleIds: number[],
    type: string,
    explainedVariance?: number[]
  ) => {
    const clusters = simpleKMeans(projectedPoints, nClusters, 100, seed);

    const points: VisPoint[] = projectedPoints.map((coords: number[], idx: number) => {
      const sampleId = sampleIds[idx];
      const sample = samples.find(s => s.id === sampleId);
      return {
        id: sampleId.toString(),
        coords,
        cluster: clusters.labels[idx],
        label: (sample as { labelName?: string })?.labelName || undefined,
        experimentId: sample?.runId?.toString(),
        phase: sample?.phaseName || undefined,
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
  }, [samples, nClusters, seed]);

  // Keep buildVisResult ref up to date
  useEffect(() => {
    buildVisResultRef.current = buildVisResult;
  }, [buildVisResult]);

  // Track sphereize state for cache invalidation
  const sphereizeRef = useRef(sphereize);
  
  // 创建或获取 DataSet
  const getOrCreateDataSet = useCallback(async (): Promise<ProjectionDataSet | null> => {
    const framesData = await fetchFramesData();
    if (!framesData) {
      toast.error("没有可用的帧数据，请先生成数据帧");
      return null;
    }

    // Check if we need to create a new DataSet
    // Include sphereize in cache key - if it changed, we need a new DataSet
    const sphereizeChanged = sphereizeRef.current !== sphereize;
    const needsNewDataSet = !dataSet || 
      dataSet.getPointCount() !== framesData.sampleIds.length ||
      dataSet.getSeed() !== seed ||
      sphereizeChanged;

    if (needsNewDataSet) {
      // Update ref to track current sphereize state
      sphereizeRef.current = sphereize;
      
      const points: DataPoint[] = framesData.data.map((vec, i) => ({
        id: framesData.sampleIds[i],
        vector: vec.map(v => (isNaN(v) || !isFinite(v)) ? 0 : v), // Sanitize NaN/Infinity
        metadata: {},
        projections: {},
      }));

      const newDataSet = new ProjectionDataSet(points, { seed });
      
      // Apply sphereize if requested
      if (sphereize) {
        newDataSet.normalize();
      }
      
      setDataSet(newDataSet);
      return newDataSet;
    }

    return dataSet;
  }, [fetchFramesData, dataSet, seed, sphereize]);

  // 启动迭代式 t-SNE
  const startIterativeTSNE = useCallback(async () => {
    const ds = await getOrCreateDataSet();
    if (!ds) return;

    const framesData = framesDataRef.current;
    if (!framesData) return;

    // Minimum sample count check
    if (framesData.data.length < 3) {
      toast.warning(`至少需要 3 个有效样本进行降维，当前仅 ${framesData.data.length} 个`);
      return;
    }

    // Stop existing runner
    if (tsneRunner) {
      tsneRunner.stop();
    }

    setProgressMessage("初始化 t-SNE...");
    setLoading(true);

    const runner = ds.createTSNERunner({
      nComponents: is3D ? 3 : 2,
      perplexity,
      learningRate: 10,
      onStep: (iteration: number, points: number[][]) => {
        setTsneIteration(iteration);
        // Update visualization every 5 iterations for performance
        if (iteration % 5 === 0 || iteration < 10) {
          const build = buildVisResultRef.current;
          if (build) {
            setVisResult(build(points, framesData.sampleIds, "TSNE"));
          }
        }
      },
    });

    setTsneRunner(runner);
    setLoading(false);
    setProgressMessage("");
    
    // Start running
    runner.start();
    setTsneRunning(true);
  }, [getOrCreateDataSet, tsneRunner, is3D, perplexity, buildVisResult]);

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

  // frameConfig 变化时，清除旧数据集并自动重新计算
  const prevFrameConfigRef = useRef(frameConfig);
  const frameConfigChangedRef = useRef(false);
  useEffect(() => {
    if (
      prevFrameConfigRef.current.method !== frameConfig.method ||
      prevFrameConfigRef.current.nSamples !== frameConfig.nSamples
    ) {
      prevFrameConfigRef.current = frameConfig;
      // 清除缓存和数据集
      framesDataRef.current = null;
      setDataSet(null);
      setVisResult(null);
      // 停止正在运行的 t-SNE
      if (tsneRunner) {
        tsneRunner.stop();
        setTsneRunner(null);
        setTsneRunning(false);
        setTsneIteration(0);
      }
      // 标记需要重新计算
      frameConfigChangedRef.current = true;
    }
  }, [frameConfig, tsneRunner]);

  // frameConfig 变化后、状态更新提交后自动重新计算
  useEffect(() => {
    if (frameConfigChangedRef.current && selectedSampleIds.size >= 3) {
      frameConfigChangedRef.current = false;
      fetchVisualization();
    }
  }, [frameConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // 重新生成种子
  const regenerateSeed = useCallback(() => {
    if (!seedLocked) {
      const newSeed = Date.now();
      setSeed(newSeed);
      // Clear dataSet to force re-creation with new seed
      setDataSet(null);
      toast.info(`已更新随机种子: ${newSeed}`);
    }
  }, [seedLocked]);

  // 前端计算降维 (非迭代式)
  const computeFrontend = useCallback(async () => {
    // For t-SNE, use iterative mode
    if (visType === "TSNE") {
      await startIterativeTSNE();
      return;
    }

    const ds = await getOrCreateDataSet();
    if (!ds) return;

    const framesData = framesDataRef.current;
    if (!framesData) return;

    // Minimum sample count check
    if (framesData.data.length < 3) {
      toast.warning(`至少需要 3 个有效样本进行降维，当前仅 ${framesData.data.length} 个`);
      return;
    }

    setLoading(true);
    setProgressMessage(`运行 ${visType} 降维 (${framesData.data.length} 样本)...`);

    try {
      const nComponents = is3D ? 3 : 2;
      
      if (visType === "PCA") {
        setProgressMessage("计算 PCA...");
        ds.projectPCA(nComponents);
        const projectedPoints = ds.getProjection("PCA", nComponents);
        const explainedVariance = ds.getExplainedVariance();
        setVisResult(buildVisResult(projectedPoints, framesData.sampleIds, visType, explainedVariance));
      } else if (visType === "UMAP") {
        // Yield to event loop so loading spinner renders before blocking UMAP computation
        await new Promise(resolve => setTimeout(resolve, 10));
        await ds.projectUMAP(nComponents, 15, 0.1, (progress, message) => {
          setProgressMessage(`${message} (${progress.toFixed(0)}%)`);
        });
        const projectedPoints = ds.getProjection("UMAP", nComponents);
        setVisResult(buildVisResult(projectedPoints, framesData.sampleIds, visType));
      }

      setProgressMessage("");
      toast.success(`前端降维完成: ${framesData.sampleIds.length} 样本 (种子: ${seed})`);
    } catch (error) {
      console.error("Frontend projection failed:", error);
      toast.error(`前端降维失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
      setProgressMessage("");
    }
  }, [visType, getOrCreateDataSet, startIterativeTSNE, is3D, buildVisResult, seed]);

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

  // 切换 visType 时自动停止 t-SNE
  const prevVisTypeRef = useRef(visType);
  useEffect(() => {
    if (prevVisTypeRef.current !== visType) {
      // Stop t-SNE if switching away from TSNE
      if (prevVisTypeRef.current === "TSNE" && tsneRunner) {
        tsneRunner.stop();
        setTsneRunner(null);
        setTsneIteration(0);
        setTsneRunning(false);
      }
      prevVisTypeRef.current = visType;
    }
  }, [visType]); // eslint-disable-line react-hooks/exhaustive-deps

  // 参数变化时自动重新加载（使用 ref 避免竞态）
  const prevIs3DRef = useRef(is3D);
  const prevNClustersRef = useRef(nClusters);
  useEffect(() => {
    const is3DChanged = prevIs3DRef.current !== is3D;
    const nClustersChanged = prevNClustersRef.current !== nClusters;
    prevIs3DRef.current = is3D;
    prevNClustersRef.current = nClusters;

    // nClusters-only change while t-SNE is running: re-cluster in place, don't restart
    if (nClustersChanged && !is3DChanged && tsneRunning && visResult) {
      const newResult = buildVisResult(
        visResult.points.map(p => p.coords),
        visResult.points.map(p => parseInt(p.id)),
        visResult.type
      );
      setVisResult(newResult);
      return;
    }

    if (is3DChanged) {
      if (selectedRunIds.length > 0) {
        fetchVisualization();
      }
      return;
    }
    
    if (selectedRunIds.length > 0 && visResult) {
      fetchVisualization();
    }
  }, [is3D, nClusters, visType, maxPoints, perplexity, sphereize, computeMode, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  // 转换数据格式为 ScatterGLPanel 组件 - 使用 useMemo 避免不必要的重建
  const scatterPoints = useMemo(() => 
    visResult?.points.map((p) => ({
      id: p.id,
      x: p.coords[0] || 0,
      y: p.coords[1] || 0,
      z: is3D ? (p.coords[2] ?? 0) : undefined,
      cluster: p.cluster,
      label: p.label,
      experimentId: p.experimentId,
      phase: p.phase,
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

  if (selectedSampleIds.size < 3) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <ScatterChart className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">选择更多样本</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          在左侧列表中选择至少 3 个样本进行降维可视化。
          <br />
          当前已选择 {selectedSampleIds.size} 个样本。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* 工具栏 */}
      <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-2">
        {/* 第一行：投影方法 + 显示选项 + 操作 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 投影方法组 */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Select value={visType} onValueChange={(v) => setVisType(v as VisType)}>
                    <SelectTrigger size="sm" className="w-[88px] text-xs border-0 bg-background shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PCA">PCA</SelectItem>
                      <SelectItem value="TSNE">t-SNE</SelectItem>
                      <SelectItem value="UMAP">UMAP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent><p>降维算法</p></TooltipContent>
            </Tooltip>

            {visType === "TSNE" && (
              <>
                <div className="w-px h-5 bg-border" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">PP</span>
                      <div className="w-16">
                        <Slider
                          value={[perplexity]}
                          min={5}
                          max={50}
                          step={5}
                          onValueChange={([v]) => setPerplexity(v)}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-5">{perplexity}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent><p>t-SNE 困惑度 (Perplexity)</p><p className="text-xs text-muted-foreground">控制局部结构保留程度</p></TooltipContent>
                </Tooltip>
              </>
            )}

            {visType === "TSNE" && computeMode === "frontend" && (
              <>
                <div className="w-px h-5 bg-border" />
                {tsneRunner ? (
                  <div className="flex items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={toggleTSNE} className="h-7 w-7">
                          {tsneRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>{tsneRunning ? "暂停迭代" : "继续迭代"}</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={resetTSNE} className="h-7 w-7">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>重置 t-SNE</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[11px] text-muted-foreground tabular-nums ml-0.5 cursor-default">
                          {tsneIteration}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent><p>当前迭代次数</p></TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" onClick={startIterativeTSNE} className="h-7 px-2 gap-1 text-xs">
                        <Play className="h-3.5 w-3.5" />
                        开始
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>启动 t-SNE 迭代</p></TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </div>

          {/* 维度 + 显示组 */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIs3D(!is3D)}
                  className={`h-8 min-w-[32px] px-2 rounded text-xs font-medium transition-colors ${
                    is3D 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'bg-background text-foreground shadow-sm'
                  }`}
                >
                  {is3D ? '3D' : '2D'}
                </button>
              </TooltipTrigger>
              <TooltipContent><p>切换 2D/3D 投影</p></TooltipContent>
            </Tooltip>

            <div className="w-px h-5 bg-border" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  <Palette className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorBy)}>
                    <SelectTrigger size="sm" className="w-[68px] text-xs border-0 bg-background shadow-sm">
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
              </TooltipTrigger>
              <TooltipContent><p>点染色依据</p></TooltipContent>
            </Tooltip>

            {colorBy === "cluster" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <Network className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <Select value={nClusters.toString()} onValueChange={(v) => setNClusters(parseInt(v))}>
                      <SelectTrigger size="sm" className="w-[50px] text-xs border-0 bg-background shadow-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[2, 3, 4, 5, 6, 7, 8, 10, 12, 15].map((n) => (
                          <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent><p>K-Means 聚类数</p></TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* 计算设置组 */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (selectedSampleIds.size <= MAX_FRONTEND_SAMPLES) {
                      setComputeMode(computeMode === "frontend" ? "backend" : "frontend");
                    }
                  }}
                  className={`h-8 px-2 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                    computeMode === 'frontend'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'bg-blue-500/10 text-blue-600 shadow-sm'
                  }`}
                >
                  {computeMode === "frontend" ? <Cpu className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
                  {computeMode === "frontend" ? "本地" : "远程"}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{computeMode === "frontend" ? "浏览器本地计算 (快速)" : "服务器远程计算 (大数据集)"}</p>
                {selectedSampleIds.size > MAX_FRONTEND_SAMPLES && (
                  <p className="text-xs text-muted-foreground">样本数超过 {MAX_FRONTEND_SAMPLES}，仅支持远程</p>
                )}
              </TooltipContent>
            </Tooltip>

            {computeMode === "frontend" && (
              <>
                <div className="w-px h-5 bg-border" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setSphereize(!sphereize)}
                      className={`h-8 w-8 rounded flex items-center justify-center transition-colors ${
                        sphereize ? 'bg-green-500/10 text-green-600' : 'bg-background text-muted-foreground shadow-sm'
                      }`}
                    >
                      <Circle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>球形化数据</p>
                    <p className="text-xs text-muted-foreground">归一化到单位球面，消除量纲差异</p>
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-5 bg-border" />

                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={regenerateSeed}
                        disabled={seedLocked}
                        className="h-8 w-8 rounded flex items-center justify-center transition-colors bg-background text-muted-foreground shadow-sm hover:bg-accent disabled:opacity-50"
                      >
                        <Dices className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent><p>生成新的随机种子</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSeedLocked(!seedLocked)}
                        className={`h-8 w-8 rounded flex items-center justify-center transition-colors ${
                          seedLocked ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground shadow-sm'
                        }`}
                      >
                        {seedLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent><p>{seedLocked ? "种子已锁定，结果可复现" : "点击锁定种子以固定结果"}</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[10px] font-mono text-muted-foreground tabular-nums cursor-default">
                        {seed.toString().slice(-6)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent><p>随机种子: {seed}</p></TooltipContent>
                  </Tooltip>
                </div>
              </>
            )}

            <div className="w-px h-5 bg-border" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Select value={maxPoints.toString()} onValueChange={(v) => setMaxPoints(parseInt(v))}>
                    <SelectTrigger size="sm" className="w-[60px] text-xs border-0 bg-background shadow-sm">
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
              </TooltipTrigger>
              <TooltipContent><p>最大样本数限制</p></TooltipContent>
            </Tooltip>
          </div>

          {/* 操作 + 状态 */}
          <div className="flex items-center gap-2 ml-auto">
            {visResult && (
              <span className="text-[11px] text-muted-foreground">
                {visResult.totalSamples} 样本 · {visResult.nClusters} 聚类
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  onClick={fetchVisualization}
                  disabled={loading}
                  className="h-7 px-3 text-xs gap-1.5"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  计算
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>执行降维计算</p></TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 第二行：状态信息 */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground min-h-[20px]">
          <span>{selectedRunIds.length} 个运行</span>
          <span>·</span>
          <span>{selectedSampleIds.size} 样本已选</span>
          {progressMessage && (
            <>
              <span>·</span>
              <span className="text-primary">{progressMessage}</span>
            </>
          )}
          {visType === "PCA" && visResult?.explainedVarianceRatio && visResult.explainedVarianceRatio.length > 0 && (
            <>
              <span>·</span>
              <span className="text-foreground font-medium">
                方差解释率:
                {visResult.explainedVarianceRatio.slice(0, is3D ? 3 : 2).map((ratio, idx) => (
                  <span key={idx} className="ml-1.5">
                    <span className="text-muted-foreground">PC{idx + 1}</span>
                    {' '}{(ratio * 100).toFixed(1)}%
                  </span>
                ))}
                <span className="ml-1.5 text-muted-foreground">
                  (总计 {(visResult.explainedVarianceRatio.slice(0, is3D ? 3 : 2).reduce((a, b) => a + b, 0) * 100).toFixed(1)}%)
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      </TooltipProvider>

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
          <ScatterPlotPanel
            points={scatterPoints}
            centers={scatterCenters}
            nClusters={nClusters}
            title={`${visType} ${is3D ? "3D" : "2D"} 可视化`}
            is3D={is3D}
            colorBy={colorBy}
          />
        )}
      </div>
    </div>
  );
}
