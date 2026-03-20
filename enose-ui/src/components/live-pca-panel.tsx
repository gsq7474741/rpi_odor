"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScatterChart } from "lucide-react";
import ReactECharts from "echarts-for-react";
import { projectData } from "@/lib/projections";

interface SampleInfo {
  id: number;
  sampleIdx: number;
  phaseName: string;
}

interface PcaPoint {
  x: number;
  y: number;
  sampleId: number;
  sampleIdx: number;
  phase: string;
}

const PHASE_COLORS: Record<string, string> = {
  baseline: "#3cb44b",
  inject: "#e6194b",
  wash: "#4363d8",
  purge: "#f58231",
  measure: "#911eb4",
  sample: "#e6194b",
  recovery: "#46f0f0",
};

function getPhaseColor(phase: string): string {
  const lower = phase.toLowerCase();
  for (const [key, color] of Object.entries(PHASE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  const hash = phase.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const fallback = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4"];
  return fallback[hash % fallback.length];
}

interface LivePcaPanelProps {
  runId: number | null;
  active: boolean;
  experimentStatus: string;
}

export function LivePcaPanel({ runId, active, experimentStatus }: LivePcaPanelProps) {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [pcaPoints, setPcaPoints] = useState<PcaPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explainedVar, setExplainedVar] = useState<number[]>([]);
  const lastComputedSampleIdsRef = useRef<string>("");
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for completed samples in current run
  const fetchSamples = useCallback(async () => {
    if (!runId || !active) return;
    try {
      const res = await fetch(`/api/samples?runId=${runId}&limit=200&sortField=sampleId&sortOrder=asc`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.samples) {
        setSamples(data.samples.map((s: any) => ({
          id: s.id,
          sampleIdx: s.sampleIdx,
          phaseName: s.phaseName || "unknown",
        })));
      }
    } catch {
      // silent fail - will retry
    }
  }, [runId, active]);

  // Clear when experiment resets (loaded/idle = no active run data yet)
  const prevRunIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (experimentStatus === "loaded" || experimentStatus === "idle") {
      setSamples([]);
      setPcaPoints([]);
      setExplainedVar([]);
      lastComputedSampleIdsRef.current = "";
    }
    // Also clear if runId changes
    if (runId !== prevRunIdRef.current) {
      prevRunIdRef.current = runId;
      if (runId !== null) {
        setSamples([]);
        setPcaPoints([]);
        setExplainedVar([]);
        lastComputedSampleIdsRef.current = "";
      }
    }
  }, [experimentStatus, runId]);

  // Poll every 5 seconds
  useEffect(() => {
    if (!active || !runId) {
      setSamples([]);
      setPcaPoints([]);
      lastComputedSampleIdsRef.current = "";
      return;
    }

    fetchSamples();
    pollTimerRef.current = setInterval(fetchSamples, 5000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [active, runId, fetchSamples]);

  // Compute PCA when samples change
  useEffect(() => {
    if (samples.length < 2) {
      setPcaPoints([]);
      return;
    }

    const sampleIdsKey = samples.map(s => s.id).join(",");
    if (sampleIdsKey === lastComputedSampleIdsRef.current) return;

    const computePCA = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch aligned series for all samples
        const seriesPromises = samples.map(async (sample) => {
          const res = await fetch("/api/analytics/sample-aligned-series", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sampleId: sample.id,
              nSamples: 50,
              method: "linear",
              action: "get",
            }),
          });
          const data = await res.json();
          return { sample, alignedSeries: data.frames as number[] | null, success: data.success };
        });

        const results = await Promise.all(seriesPromises);
        const valid = results.filter(r => r.success && r.alignedSeries && r.alignedSeries.length > 0);

        if (valid.length < 2) {
          setError("样本对齐序列不足");
          setLoading(false);
          return;
        }

        // Project using PCA
        const dataMatrix = valid.map(r => r.alignedSeries!);
        const result = await projectData(dataMatrix, {
          type: "PCA",
          nComponents: 2,
        });

        if (result.points.length !== valid.length) {
          setError("降维结果不匹配");
          setLoading(false);
          return;
        }

        const points: PcaPoint[] = result.points.map((coords, i) => ({
          x: coords[0],
          y: coords[1],
          sampleId: valid[i].sample.id,
          sampleIdx: valid[i].sample.sampleIdx,
          phase: valid[i].sample.phaseName,
        }));

        setPcaPoints(points);
        setExplainedVar(result.explained_variance || []);
        lastComputedSampleIdsRef.current = sampleIdsKey;
      } catch (e: any) {
        setError(e.message || "PCA 计算失败");
      } finally {
        setLoading(false);
      }
    };

    computePCA();
  }, [samples]);

  // Build echarts option
  const chartOption = useMemo(() => {
    if (pcaPoints.length === 0) return null;

    // Group by phase
    const phaseGroups = new Map<string, PcaPoint[]>();
    for (const p of pcaPoints) {
      const group = phaseGroups.get(p.phase) || [];
      group.push(p);
      phaseGroups.set(p.phase, group);
    }

    const series = Array.from(phaseGroups.entries()).map(([phase, points]) => ({
      name: phase,
      type: "scatter" as const,
      data: points.map(p => ({
        value: [p.x, p.y],
        name: `S${p.sampleIdx}`,
        sampleId: p.sampleId,
      })),
      symbolSize: 10,
      itemStyle: { color: getPhaseColor(phase) },
      emphasis: { itemStyle: { borderWidth: 2, borderColor: "#333" } },
    }));

    return {
      animation: false,
      tooltip: {
        trigger: "item" as const,
        formatter: (params: any) => {
          const d = params.data;
          return `${params.seriesName}<br/>${d.name} (id:${d.sampleId})<br/>PC1: ${d.value[0].toFixed(2)}<br/>PC2: ${d.value[1].toFixed(2)}`;
        },
      },
      legend: {
        data: Array.from(phaseGroups.keys()),
        top: 5,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 10 },
      },
      toolbox: {
        right: 10,
        top: 0,
        itemSize: 12,
        feature: {
          dataZoom: { title: { zoom: "框选缩放", back: "还原" } },
          restore: { title: "重置" },
        },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: "inside", yAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: true },
      ],
      grid: { left: 40, right: 15, top: 30, bottom: 30 },
      xAxis: {
        type: "value" as const,
        name: explainedVar[0] ? `PC1 (${(explainedVar[0] * 100).toFixed(0)}%)` : "PC1",
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.3 } },
      },
      yAxis: {
        type: "value" as const,
        name: explainedVar[1] ? `PC2 (${(explainedVar[1] * 100).toFixed(0)}%)` : "PC2",
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.3 } },
      },
      series,
    };
  }, [pcaPoints, explainedVar]);

  // Empty state
  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <ScatterChart className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">运行实验后显示实时PCA</p>
        </div>
      </div>
    );
  }

  if (samples.length < 2 && !loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <ScatterChart className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">需要至少2个完成的样本</p>
          <p className="text-[10px] mt-1">当前: {samples.length} 个样本</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 状态栏 */}
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <Badge variant="outline" className="text-[10px] h-5">
            {pcaPoints.length} 样本
          </Badge>
        </div>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
      {/* 散点图 */}
      {chartOption && (
        <div className="flex-1 min-h-0">
          <ReactECharts
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            notMerge={true}
            lazyUpdate={true}
          />
        </div>
      )}
    </div>
  );
}
