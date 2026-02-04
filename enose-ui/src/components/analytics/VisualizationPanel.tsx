"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Download, Play, Pause, Cpu, Sparkles, AlertTriangle, Loader2, Database } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import * as echarts from "echarts";
import { ScatterGLPanel } from "./ScatterGLPanel";

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

const CLUSTER_COLORS = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
];

type RenderEngine = "echarts" | "scattergl";

interface NormalizedFramesMeta {
  method: string;
  nSamples: number;
  originalPointCounts: number[];
  timeRangeMs: number;
  phaseName: string;
}

interface NormalizedFramesStatus {
  exists: boolean;
  totalFrames: number;
  meta: NormalizedFramesMeta[];
}

interface VisualizationPanelProps {
  experimentId?: string | null;
  labelId?: string | null;
  sampleIds?: number[];
  paramsHashes?: string[];
}

export function VisualizationPanel({ experimentId, labelId, sampleIds, paramsHashes }: VisualizationPanelProps = {}) {
  const [visType, setVisType] = useState<string>("PCA");
  const [nComponents, setNComponents] = useState<number>(2);
  const [perplexity, setPerplexity] = useState<number>(30);
  const [nClusters, setNClusters] = useState<number>(5);
  const [maxPoints, setMaxPoints] = useState<number>(500);
  const [result, setResult] = useState<VisualizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [renderEngine, setRenderEngine] = useState<RenderEngine>("scattergl");
  const [framesStatus, setFramesStatus] = useState<NormalizedFramesStatus | null>(null);
  const [checkingFrames, setCheckingFrames] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const checkNormalizedFrames = useCallback(async () => {
    if (!experimentId) {
      setFramesStatus(null);
      return;
    }

    setCheckingFrames(true);
    try {
      const response = await fetch(
        `/api/analytics/normalized-frames?runId=${experimentId}`
      );
      if (response.ok) {
        const data = await response.json();
        setFramesStatus(data);
      }
    } catch (error) {
      console.error("Failed to check normalized frames:", error);
    } finally {
      setCheckingFrames(false);
    }
  }, [experimentId]);

  const generateFrames = async () => {
    if (!experimentId) return;

    setGeneratingFrames(true);
    try {
      const response = await fetch("/api/analytics/normalized-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: parseInt(experimentId),
          nSamples: 100,
          methods: ["linear", "pchip"],
        }),
      });
      if (response.ok) {
        await checkNormalizedFrames();
      }
    } catch (error) {
      console.error("Failed to generate normalized frames:", error);
    } finally {
      setGeneratingFrames(false);
    }
  };

  const fetchVisualization = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: visType,
        nComponents: nComponents.toString(),
        perplexity: perplexity.toString(),
        nClusters: nClusters.toString(),
        maxPoints: maxPoints.toString(),
      });

      if (experimentId) {
        params.set("experimentId", experimentId);
      }
      if (labelId) {
        params.set("labelId", labelId);
      }
      if (sampleIds && sampleIds.length > 0) {
        params.set("sampleIds", sampleIds.join(","));
      }
      if (paramsHashes && paramsHashes.length > 0) {
        params.set("paramsHashes", paramsHashes.join(","));
      }

      const response = await fetch(`/api/analytics/visualization?${params}`);
      if (response.ok) {
        const data = await response.json();
        setResult(data);
      }
    } catch (error) {
      console.error("Failed to fetch visualization:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkNormalizedFrames();
  }, [checkNormalizedFrames]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchVisualization, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, visType, nComponents, perplexity, nClusters, maxPoints]);

  // 初始化 ECharts - DOM 始终存在，组件挂载时初始化
  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current = echarts.init(chartRef.current);

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  // 更新图表
  const updateChart = useCallback(() => {
    if (!chartInstance.current || !result) return;

    const clusters: Record<number, Array<[number, number, string, string]>> = {};
    result.points.forEach((point) => {
      const cluster = point.cluster >= 0 ? point.cluster : 0;
      if (!clusters[cluster]) {
        clusters[cluster] = [];
      }
      clusters[cluster].push([
        point.coords[0] || 0,
        point.coords[1] || 0,
        point.id,
        point.label || "",
      ]);
    });

    const series = Object.entries(clusters).map(([cluster, points]) => ({
      name: `Cluster ${cluster}`,
      type: "scatter" as const,
      data: points,
      symbolSize: 8,
      itemStyle: {
        color: CLUSTER_COLORS[parseInt(cluster) % CLUSTER_COLORS.length],
      },
    }));

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const p = params as { data: [number, number, string, string] };
          const [x, y, id, label] = p.data;
          return `<strong>${id}</strong><br/>` +
            (label ? `标签: ${label}<br/>` : "") +
            `(${x.toFixed(3)}, ${y.toFixed(3)})`;
        },
      },
      legend: {
        top: 10,
        right: 10,
      },
      grid: {
        left: 60,
        right: 40,
        top: 60,
        bottom: 60,
      },
      xAxis: {
        type: "value",
        name: visType.includes("PCA") ? "PC1" : "Dim 1",
        nameLocation: "middle",
        nameGap: 30,
        splitLine: { lineStyle: { type: "dashed" } },
      },
      yAxis: {
        type: "value",
        name: visType.includes("PCA") ? "PC2" : "Dim 2",
        nameLocation: "middle",
        nameGap: 40,
        splitLine: { lineStyle: { type: "dashed" } },
      },
      series,
      toolbox: {
        feature: {
          dataZoom: {},
          restore: {},
          saveAsImage: {},
        },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        { type: "inside", yAxisIndex: 0 },
      ],
    };

    chartInstance.current.setOption(option, true);
  }, [result, visType]);

  // 数据变化时更新图表
  useEffect(() => {
    updateChart();
  }, [updateChart]);

  return (
    <div className="grid grid-cols-4 gap-6">
      {/* 配置面板 */}
      <Card className="col-span-1">
        <CardHeader>
          <CardTitle>可视化配置</CardTitle>
          <CardDescription>调整降维和聚类参数</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>可视化类型</Label>
            <Select value={visType} onValueChange={setVisType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PCA">PCA</SelectItem>
                <SelectItem value="TSNE">t-SNE</SelectItem>
                <SelectItem value="CLUSTERING">K-Means 聚类</SelectItem>
                <SelectItem value="PCA_CLUSTERING">PCA + 聚类</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visType === "TSNE" && (
            <div className="space-y-2">
              <Label>Perplexity: {perplexity}</Label>
              <Slider
                value={[perplexity]}
                onValueChange={([v]) => setPerplexity(v)}
                min={5}
                max={50}
                step={5}
              />
            </div>
          )}

          {(visType === "CLUSTERING" || visType === "PCA_CLUSTERING") && (
            <div className="space-y-2">
              <Label>聚类数: {nClusters}</Label>
              <Slider
                value={[nClusters]}
                onValueChange={([v]) => setNClusters(v)}
                min={2}
                max={10}
                step={1}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>最大样本数: {maxPoints}</Label>
            <Slider
              value={[maxPoints]}
              onValueChange={([v]) => setMaxPoints(v)}
              min={100}
              max={2000}
              step={100}
            />
          </div>

          <div className="space-y-2">
            <Label>渲染引擎</Label>
            <div className="flex gap-2">
              <Button
                variant={renderEngine === "scattergl" ? "default" : "outline"}
                size="sm"
                onClick={() => setRenderEngine("scattergl")}
                className="flex-1"
              >
                <Sparkles className="h-4 w-4 mr-1" />
                WebGL
              </Button>
              <Button
                variant={renderEngine === "echarts" ? "default" : "outline"}
                size="sm"
                onClick={() => setRenderEngine("echarts")}
                className="flex-1"
              >
                <Cpu className="h-4 w-4 mr-1" />
                ECharts
              </Button>
            </div>
          </div>

          {experimentId && framesStatus && !framesStatus.exists && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>未生成归一化帧</AlertTitle>
              <AlertDescription>
                需要先生成归一化帧才能进行可视化计算
              </AlertDescription>
            </Alert>
          )}

          {experimentId && framesStatus && framesStatus.exists && (
            <Alert className="mb-4">
              <Database className="h-4 w-4" />
              <AlertTitle>归一化帧就绪</AlertTitle>
              <AlertDescription>
                共 {framesStatus.totalFrames} 帧，
                {framesStatus.meta.length > 0 && 
                  `${framesStatus.meta.map(m => m.phaseName).filter((v, i, a) => a.indexOf(v) === i).join(", ")} 阶段`
                }
              </AlertDescription>
            </Alert>
          )}

          {experimentId && (!framesStatus?.exists) && (
            <Button
              onClick={generateFrames}
              disabled={generatingFrames || checkingFrames}
              variant="secondary"
              className="w-full mb-4"
            >
              {generatingFrames ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              生成归一化帧
            </Button>
          )}

          <div className="flex gap-2">
            <Button
              onClick={fetchVisualization}
              disabled={loading || (experimentId ? !framesStatus?.exists : false)}
              className="flex-1"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
              />
              计算
            </Button>
            <Button
              variant={autoRefresh ? "destructive" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </div>

          {result && (
            <div className="pt-4 border-t space-y-2 text-sm text-muted-foreground">
              <p>样本数: {result.totalSamples}</p>
              {result.nClusters > 0 && <p>聚类数: {result.nClusters}</p>}
              {result.explainedVarianceRatio.length > 0 && (
                <p>
                  解释方差:{" "}
                  {result.explainedVarianceRatio
                    .slice(0, 2)
                    .map((v) => `${(v * 100).toFixed(1)}%`)
                    .join(" / ")}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 图表面板 */}
      <Card className="col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>散点图</CardTitle>
            <CardDescription>
              {visType === "PCA" && "主成分分析降维结果"}
              {visType === "TSNE" && "t-SNE 降维结果"}
              {visType === "CLUSTERING" && "K-Means 聚类结果"}
              {visType === "PCA_CLUSTERING" && "PCA 降维 + K-Means 聚类"}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            导出
          </Button>
        </CardHeader>
        <CardContent>
          <div className="h-[500px] relative">
            {renderEngine === "scattergl" ? (
              <ScatterGLPanel
                points={
                  result?.points.map((p) => ({
                    id: p.id,
                    x: p.coords[0] || 0,
                    y: p.coords[1] || 0,
                    z: p.coords[2],
                    cluster: p.cluster >= 0 ? p.cluster : 0,
                    label: p.label,
                  })) || []
                }
                centers={
                  result?.centers.map((c) => ({
                    x: c.coords[0] || 0,
                    y: c.coords[1] || 0,
                    z: c.coords[2],
                    cluster: c.cluster,
                  })) || []
                }
                title={`${visType} 可视化`}
              />
            ) : (
              <>
                <div ref={chartRef} className="w-full h-full" />
                {!result && (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background">
                    点击"计算"按钮生成可视化
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
