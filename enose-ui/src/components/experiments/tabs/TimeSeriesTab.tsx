"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useExperiments, PhaseTransition } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  LineChart,
  Loader2,
  Download,
  Thermometer,
  Droplets,
  Gauge,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import * as echarts from "echarts";

interface SensorDataPoint {
  timeMs: number;
  value: number;
  sensorIdx: number;
}

interface EnvDataPoint {
  timeMs: number;
  temperature: number;
  humidity: number;
  pressure: number;
}

interface SampleTimeSeriesData {
  sampleId: number;
  runId: number;
  sampleIdx: number;
  liquidNames: string[];
  phaseName: string;
  data: SensorDataPoint[];
  envData?: EnvDataPoint[];
  phaseTransitions?: PhaseTransition[];
  sampleStartTimeMs?: number;
  sampleEndTimeMs?: number;
}

type AlignMode = "absolute" | "relative" | "normalized";
type DataSource = "raw" | "frames";
type ColorMode = "bySensor" | "bySample" | "byRun";

// 固定传感器色卡（按传感器染色时使用）
const SENSOR_COLORS = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
];

// 环境数据通道颜色
const ENV_COLORS = {
  temperature: "#e74c3c",
  humidity: "#3498db",
  pressure: "#2ecc71",
};

// 样本/运行基色 (HSL 色相角度)
const SAMPLE_BASE_HUES = [210, 0, 120, 30, 270, 180, 330, 60, 195, 150, 300, 45];

// Phase markArea 色卡（半透明背景色）
const PHASE_COLORS: Record<string, string> = {
  PREHEAT: "rgba(255, 152, 0, 0.08)",
  INJECT: "rgba(33, 150, 243, 0.08)",
  ACQUIRE: "rgba(76, 175, 80, 0.08)",
  SAMPLE: "rgba(76, 175, 80, 0.08)",
  DRAIN: "rgba(158, 158, 158, 0.08)",
  WASH: "rgba(0, 188, 212, 0.08)",
  BASELINE: "rgba(121, 85, 72, 0.08)",
  PURGE: "rgba(244, 67, 54, 0.08)",
  RECOVERY: "rgba(156, 39, 176, 0.08)",
};
const DEFAULT_PHASE_COLOR = "rgba(96, 125, 139, 0.08)";

/**
 * 根据色相和传感器索引生成 HSL 颜色
 * 同一样本内传感器通过亮度渐变区分
 */
function hslColor(hue: number, sensorIdx: number, totalSensors: number = 8): string {
  const saturation = 70;
  // 亮度从 35% 到 70%，传感器越大越亮
  const lightness = 35 + (sensorIdx / Math.max(totalSensors - 1, 1)) * 35;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export function TimeSeriesTab() {
  const {
    selectedSampleIds,
    samples,
    frameConfig,
    setFrameConfig,
    refreshFrameStatuses,
  } = useExperiments();

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const [loading, setLoading] = useState(false);
  const [timeSeriesData, setTimeSeriesData] = useState<SampleTimeSeriesData[]>([]);
  const [selectedSensors, setSelectedSensors] = useState<number[]>([0, 1, 2, 3, 4, 5, 6, 7]);
  const [alignMode, setAlignMode] = useState<AlignMode>("relative");
  const [dataSource, setDataSource] = useState<DataSource>("frames");
  const [colorMode, setColorMode] = useState<ColorMode>("bySensor");
  const [showEnv, setShowEnv] = useState(false);

  // 动态收集 nSamples 选项（预设 + 已存在 + 当前使用中），用于下拉列表
  const nSamplesOptions = useMemo(() => {
    const nSet = new Set([50, 100, 200, 500]);
    nSet.add(frameConfig.nSamples);
    const selected = samples.filter((s) => selectedSampleIds.has(s.id));
    for (const s of selected) {
      if (s.frameStatus?.variants) {
        for (const v of s.frameStatus.variants) {
          nSet.add(v.nSamples);
        }
      }
    }
    return Array.from(nSet).sort((a, b) => a - b);
  }, [samples, selectedSampleIds, frameConfig.nSamples]);

  // 检查当前 frameConfig 组合在选中样本中的覆盖情况
  const frameCoverage = useMemo(() => {
    const selected = samples.filter((s) => selectedSampleIds.has(s.id));
    if (selected.length === 0) return { total: 0, covered: 0, missing: 0 };
    let covered = 0;
    for (const s of selected) {
      if (s.frameStatus?.variants?.some(
        (v) => v.method === frameConfig.method && v.nSamples === frameConfig.nSamples
      )) {
        covered++;
      }
    }
    return { total: selected.length, covered, missing: selected.length - covered };
  }, [samples, selectedSampleIds, frameConfig]);

  // 获取选中的样本 - 使用新的 samples 数组
  const getSelectedSamples = useCallback(() => {
    const targetIds = Array.from(selectedSampleIds);
    if (targetIds.length === 0) return [];
    
    return samples
      .filter((s) => targetIds.includes(s.id))
      .map((s) => ({ sampleId: s.id, runId: s.runId }));
  }, [selectedSampleIds, samples]);

  // 加载时序数据
  const fetchTimeSeriesData = useCallback(async () => {
    const selectedList = getSelectedSamples();
    if (selectedList.length === 0) {
      setTimeSeriesData([]);
      return;
    }

    setLoading(true);
    try {
      const results: SampleTimeSeriesData[] = [];

      for (const { sampleId, runId } of selectedList) {
        const sampleInfo = samples.find((s) => s.id === sampleId);
        
        if (dataSource === "frames") {
          // 使用归一化帧数据（使用全局帧配置）
          const response = await fetch(
            `/api/samples?action=frames&sampleId=${sampleId}&method=${frameConfig.method}&nSamples=${frameConfig.nSamples}`
          );
          const data = await response.json();

          if (data.success && data.frames) {
            const nSensors = data.nSensors || 8;
            const is32ch = nSensors === 32;
            const sensorData: SensorDataPoint[] = [];
            const envData: EnvDataPoint[] = [];

            // 将帧索引映射到原始 ms 时间范围
            const sAbsStart = sampleInfo?.startTimeMs || 0;
            const sAbsEnd = sampleInfo?.endTimeMs || 0;
            const totalFrames = data.frames.length;
            const maxFrameIdx = totalFrames > 1 ? totalFrames - 1 : 1;
            const sAbsRange = sAbsEnd - sAbsStart || 1;

            for (const frame of data.frames) {
              const frameIdx = frame.frameIdx || 0;
              const values = frame.values || [];
              // 映射到 ms：frameIdx 0 → sAbsStart, maxFrameIdx → sAbsEnd
              const timeMs = sAbsStart > 0
                ? sAbsStart + (frameIdx / maxFrameIdx) * sAbsRange
                : frameIdx;

              // 前 8 个值始终是传感器 value
              for (let i = 0; i < 8 && i < values.length; i++) {
                sensorData.push({
                  timeMs,
                  value: values[i],
                  sensorIdx: i,
                });
              }

              // 32 通道时，提取环境数据（8-15: temp, 16-23: humidity, 24-31: pressure）
              if (is32ch && values.length >= 32) {
                let avgTemp = 0, avgHum = 0, avgPres = 0;
                for (let i = 0; i < 8; i++) {
                  avgTemp += values[8 + i] || 0;
                  avgHum += values[16 + i] || 0;
                  avgPres += values[24 + i] || 0;
                }
                envData.push({
                  timeMs,
                  temperature: avgTemp / 8,
                  humidity: avgHum / 8,
                  pressure: avgPres / 8,
                });
              }
            }

            results.push({
              sampleId,
              runId,
              sampleIdx: sampleInfo?.sampleIdx || 0,
              liquidNames: sampleInfo?.liquidNames || [],
              phaseName: sampleInfo?.phaseName || "",
              data: sensorData,
              envData: envData.length > 0 ? envData : undefined,
              phaseTransitions: sampleInfo?.phaseTransitions || [],
              sampleStartTimeMs: sampleInfo?.startTimeMs,
              sampleEndTimeMs: sampleInfo?.endTimeMs ?? undefined,
            });
          }
        } else {
          // 使用原始数据
          const response = await fetch(
            `/api/analytics/data?action=sensor-data&experimentId=${runId}&limit=5000`
          );
          const data = await response.json();

          if (data.success && data.rows) {
            // 过滤到 sample 的时间范围内
            const sStart = sampleInfo?.startTimeMs || 0;
            const sEnd = sampleInfo?.endTimeMs || Infinity;

            const sensorData: SensorDataPoint[] = [];
            const envData: EnvDataPoint[] = [];
            for (const row of data.rows) {
              const ts = new Date(row.ts).getTime();
              // 只保留属于当前 sample 时间范围内的数据
              if (ts < sStart || ts > sEnd) continue;

              if (row.moxReadings) {
                for (let i = 0; i < row.moxReadings.length; i++) {
                  sensorData.push({
                    timeMs: ts,
                    value: row.moxReadings[i],
                    sensorIdx: i,
                  });
                }
              }
              // 收集环境数据
              if (row.temperature != null || row.humidity != null) {
                envData.push({
                  timeMs: ts,
                  temperature: row.temperature ?? 0,
                  humidity: row.humidity ?? 0,
                  pressure: row.heaterStep ?? 0,
                });
              }
            }

            results.push({
              sampleId,
              runId,
              sampleIdx: sampleInfo?.sampleIdx || 0,
              liquidNames: sampleInfo?.liquidNames || [],
              phaseName: sampleInfo?.phaseName || "",
              data: sensorData,
              envData,
              phaseTransitions: sampleInfo?.phaseTransitions || [],
              sampleStartTimeMs: sampleInfo?.startTimeMs,
              sampleEndTimeMs: sampleInfo?.endTimeMs ?? undefined,
            });
          }
        }
      }

      setTimeSeriesData(results);

      // 帧模式下获取成功后，刷新帧状态（后端可能自动生成了缺失帧）
      if (dataSource === "frames" && results.length > 0) {
        refreshFrameStatuses();
      }
    } catch (error) {
      console.error("Failed to fetch time series data:", error);
    } finally {
      setLoading(false);
    }
  }, [getSelectedSamples, samples, dataSource, frameConfig, refreshFrameStatuses]);

  // 初始化图表
  useEffect(() => {
    if (chartRef.current && !chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  // 获取系列颜色
  const getSeriesColor = useCallback(
    (sampleIndex: number, sensorIdx: number, runId: number): string => {
      switch (colorMode) {
        case "bySample": {
          const hue = SAMPLE_BASE_HUES[sampleIndex % SAMPLE_BASE_HUES.length];
          return hslColor(hue, sensorIdx);
        }
        case "byRun": {
          // 同一 run 的样本共享基色，不同 run 用不同色相
          const uniqueRuns = [...new Set(timeSeriesData.map((d) => d.runId))];
          const runIndex = uniqueRuns.indexOf(runId);
          const hue = SAMPLE_BASE_HUES[runIndex % SAMPLE_BASE_HUES.length];
          return hslColor(hue, sensorIdx);
        }
        case "bySensor":
        default:
          return SENSOR_COLORS[sensorIdx % SENSOR_COLORS.length];
      }
    },
    [colorMode, timeSeriesData]
  );

  // 对齐时间
  const alignPoints = useCallback(
    (points: { time: number; value: number }[]): { time: number; value: number }[] => {
      if (points.length === 0) return points;
      if (alignMode === "relative") {
        const minTime = Math.min(...points.map((p) => p.time));
        return points.map((p) => ({ time: p.time - minTime, value: p.value }));
      }
      if (alignMode === "normalized") {
        const minTime = Math.min(...points.map((p) => p.time));
        const maxTime = Math.max(...points.map((p) => p.time));
        const range = maxTime - minTime || 1;
        return points.map((p) => ({ time: ((p.time - minTime) / range) * 100, value: p.value }));
      }
      return points;
    },
    [alignMode]
  );

  // 更新图表
  useEffect(() => {
    if (!chartInstance.current || timeSeriesData.length === 0) {
      chartInstance.current?.clear();
      return;
    }

    const series: echarts.SeriesOption[] = [];
    const legendData: string[] = [];
    const hasEnvData = showEnv && timeSeriesData.some((d) => d.envData && d.envData.length > 0);

    timeSeriesData.forEach((sampleData, sampleIndex) => {
      // 按传感器分组数据
      const sensorGroups: Record<number, { time: number; value: number }[]> = {};
      
      sampleData.data.forEach((point) => {
        if (!selectedSensors.includes(point.sensorIdx)) return;
        if (!sensorGroups[point.sensorIdx]) sensorGroups[point.sensorIdx] = [];
        sensorGroups[point.sensorIdx].push({ time: point.timeMs, value: point.value });
      });

      // 构建 phase markArea 数据（仅在第一个传感器系列上标注）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let phaseMarkArea: any[] | undefined;
      if (sampleData.phaseTransitions && sampleData.phaseTransitions.length > 0) {
        // 数据坐标范围（x 轴实际显示的范围）
        const dataMinX = sampleData.data.length > 0
          ? Math.min(...sampleData.data.map((p) => p.timeMs))
          : 0;
        const dataMaxX = sampleData.data.length > 0
          ? Math.max(...sampleData.data.map((p) => p.timeMs))
          : 1;

        phaseMarkArea = sampleData.phaseTransitions.map((pt) => {
          let xStart: number, xEnd: number;

          if (alignMode === "relative") {
            const baseMs = dataMinX;
            xStart = pt.startTimeMs - baseMs;
            xEnd = (pt.endTimeMs || dataMaxX) - baseMs;
          } else if (alignMode === "normalized") {
            const baseMs = dataMinX;
            const range = dataMaxX - dataMinX || 1;
            xStart = ((pt.startTimeMs - baseMs) / range) * 100;
            xEnd = (((pt.endTimeMs || dataMaxX) - baseMs) / range) * 100;
          } else {
            xStart = pt.startTimeMs;
            xEnd = pt.endTimeMs || dataMaxX;
          }
          return [
            {
              name: pt.phaseName,
              xAxis: xStart,
              itemStyle: { color: PHASE_COLORS[pt.phaseName] || DEFAULT_PHASE_COLOR },
            },
            { xAxis: xEnd },
          ];
        });
      }

      // 为每个传感器创建系列
      let isFirstSeries = true;
      Object.entries(sensorGroups).forEach(([sensorIdxStr, points]) => {
        const sensorIdx = parseInt(sensorIdxStr);
        const name = `R${sampleData.runId}-S${sampleData.sampleIdx}-Sen${sensorIdx}`;
        legendData.push(name);

        const processedPoints = alignPoints(points);
        const color = getSeriesColor(sampleIndex, sensorIdx, sampleData.runId);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seriesItem: any = {
          name,
          type: "line",
          yAxisIndex: 0,
          data: processedPoints.map((p) => [p.time, p.value]),
          smooth: true,
          symbol: "none",
          color,
          itemStyle: { color },
          lineStyle: { width: 1.5, color, opacity: 0.8 },
          emphasis: { lineStyle: { width: 2.5 } },
        };

        // 仅在第一个系列上附加 markArea（避免重复渲染）
        if (isFirstSeries && phaseMarkArea && phaseMarkArea.length > 0) {
          seriesItem.markArea = {
            silent: true,
            label: {
              show: true,
              position: "insideTop",
              fontSize: 10,
              color: "#666",
            },
            data: phaseMarkArea,
          };
          isFirstSeries = false;
        }

        series.push(seriesItem);
      });

      // 环境数据系列（温度→Y1, 湿度→Y2, 气压→Y3）
      if (showEnv && sampleData.envData && sampleData.envData.length > 0) {
        const envPoints = sampleData.envData;
        const prefix = `R${sampleData.runId}-S${sampleData.sampleIdx}`;

        const envChannels: { key: keyof typeof ENV_COLORS; label: string; yAxis: number; accessor: (p: EnvDataPoint) => number }[] = [
          { key: "temperature", label: "温度", yAxis: 1, accessor: (p) => p.temperature },
          { key: "humidity", label: "湿度", yAxis: 2, accessor: (p) => p.humidity },
          { key: "pressure", label: "气压", yAxis: 3, accessor: (p) => p.pressure },
        ];

        for (const ch of envChannels) {
          const chPoints = envPoints.map((p) => ({ time: p.timeMs, value: ch.accessor(p) }));
          const processed = alignPoints(chPoints);
          const name = `${prefix}-${ch.label}`;
          legendData.push(name);

          series.push({
            name,
            type: "line",
            yAxisIndex: ch.yAxis,
            data: processed.map((p) => [p.time, p.value]),
            smooth: true,
            symbol: "none",
            color: ENV_COLORS[ch.key],
            itemStyle: { color: ENV_COLORS[ch.key] },
            lineStyle: { width: 1, color: ENV_COLORS[ch.key], type: "dashed", opacity: 0.6 },
            emphasis: { lineStyle: { width: 2 } },
          });
        }
      }
    });

    const yAxes: echarts.YAXisComponentOption[] = [
      {
        type: "value",
        name: "传感器值",
        nameLocation: "middle",
        nameGap: 45,
      },
    ];

    if (hasEnvData) {
      // Y1: 温度 (°C)，右侧第一个
      yAxes.push({
        type: "value",
        name: "温度 (°C)",
        nameLocation: "middle",
        nameGap: 35,
        position: "right",
        axisLine: { show: true, lineStyle: { color: ENV_COLORS.temperature } },
        axisLabel: { color: ENV_COLORS.temperature },
        splitLine: { show: false },
      });
      // Y2: 湿度 (%)，右侧第二个
      yAxes.push({
        type: "value",
        name: "湿度 (%)",
        nameLocation: "middle",
        nameGap: 35,
        position: "right",
        offset: 55,
        axisLine: { show: true, lineStyle: { color: ENV_COLORS.humidity } },
        axisLabel: { color: ENV_COLORS.humidity },
        splitLine: { show: false },
      });
      // Y3: 气压 (hPa)，右侧第三个
      yAxes.push({
        type: "value",
        name: "气压 (hPa)",
        nameLocation: "middle",
        nameGap: 45,
        position: "right",
        offset: 110,
        axisLine: { show: true, lineStyle: { color: ENV_COLORS.pressure } },
        axisLabel: { color: ENV_COLORS.pressure },
        splitLine: { show: false },
      });
    }

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
      },
      legend: {
        data: legendData,
        type: "scroll",
        top: 0,
        textStyle: { fontSize: 10 },
      },
      grid: {
        left: 60,
        right: hasEnvData ? 175 : 20,
        top: 40,
        bottom: 70,
      },
      xAxis: {
        type: "value",
        name: alignMode === "normalized" ? "归一化时间 (%)" : alignMode === "relative" ? "时间 (ms)" : "时间戳",
        nameLocation: "middle",
        nameGap: 25,
      },
      yAxis: yAxes,
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        { type: "slider", xAxisIndex: 0, height: 20, bottom: 35 },
      ],
      series,
    };

    chartInstance.current.setOption(option, true);
    chartInstance.current.resize();
  }, [timeSeriesData, selectedSensors, alignMode, dataSource, colorMode, showEnv, getSeriesColor, alignPoints]);

  // 选中项变化时自动加载数据
  const selectedIdsRef = useRef<string>("");
  useEffect(() => {
    const idsString = Array.from(selectedSampleIds).sort().join(",");
    if (idsString !== selectedIdsRef.current && selectedSampleIds.size > 0) {
      selectedIdsRef.current = idsString;
      fetchTimeSeriesData();
    }
  }, [selectedSampleIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // 数据源切换时自动重新获取数据
  const prevDataSourceRef = useRef<DataSource>(dataSource);
  useEffect(() => {
    if (prevDataSourceRef.current !== dataSource && selectedSampleIds.size > 0) {
      prevDataSourceRef.current = dataSource;
      fetchTimeSeriesData();
    }
  }, [dataSource, fetchTimeSeriesData]); // eslint-disable-line react-hooks/exhaustive-deps

  // 帧配置切换时（仅帧模式下）自动重新获取数据
  const prevFrameConfigRef = useRef(frameConfig);
  useEffect(() => {
    if (
      dataSource === "frames" &&
      selectedSampleIds.size > 0 &&
      (prevFrameConfigRef.current.method !== frameConfig.method ||
        prevFrameConfigRef.current.nSamples !== frameConfig.nSamples)
    ) {
      prevFrameConfigRef.current = frameConfig;
      fetchTimeSeriesData();
    }
  }, [frameConfig, dataSource, fetchTimeSeriesData]); // eslint-disable-line react-hooks/exhaustive-deps

  // 窗口大小变化时调整图表
  useEffect(() => {
    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 切换传感器选中
  const toggleSensor = (sensorIdx: number) => {
    setSelectedSensors((prev) =>
      prev.includes(sensorIdx)
        ? prev.filter((s) => s !== sensorIdx)
        : [...prev, sensorIdx]
    );
  };

  // 导出图表
  const exportChart = () => {
    if (!chartInstance.current) return;
    const url = chartInstance.current.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#fff",
    });
    const link = document.createElement("a");
    link.download = `timeseries-${Date.now()}.png`;
    link.href = url;
    link.click();
  };

  const selectedSamples = getSelectedSamples();
  const hasSelection = selectedSamples.length > 0;

  return (
    <div className="h-full flex flex-col p-4 gap-3 relative">
      {/* 无选中时的占位提示 - 绝对定位覆盖 */}
      {!hasSelection && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-8 bg-background">
          <LineChart className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">选择样本查看时序图</h3>
          <p className="text-muted-foreground text-sm max-w-md">
            在左侧列表中展开运行并选择样本，或启用对比模式选择多个样本进行叠加对比。
          </p>
        </div>
      )}
      {/* 控制栏 - 无选中时隐藏但不卸载 */}
      <div style={{ display: hasSelection ? undefined : 'none' }}>
      <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* 传感器选择组 */}
        <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1">
          <span className="text-[11px] text-muted-foreground mr-0.5">传感器</span>
          {Array.from({ length: 8 }).map((_, idx) => (
            <button
              key={idx}
              className={`h-7 w-7 rounded text-xs font-medium transition-colors ${
                selectedSensors.includes(idx)
                  ? "text-white shadow-sm"
                  : "bg-background text-foreground shadow-sm hover:bg-accent"
              }`}
              style={{
                backgroundColor: selectedSensors.includes(idx)
                  ? SENSOR_COLORS[idx]
                  : undefined,
                borderColor: selectedSensors.includes(idx)
                  ? SENSOR_COLORS[idx]
                  : undefined,
              }}
              onClick={() => toggleSensor(idx)}
            >
              {idx}
            </button>
          ))}
        </div>

        {/* 数据源 + 帧配置组 */}
        <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Select value={dataSource} onValueChange={(v) => setDataSource(v as DataSource)}>
                  <SelectTrigger size="sm" className="w-[96px] text-xs border-0 bg-background shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="frames">归一化帧</SelectItem>
                    <SelectItem value="raw">原始数据</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent><p>数据源</p></TooltipContent>
          </Tooltip>

          {dataSource === "frames" && (
            <>
              <div className="w-px h-5 bg-border" />
              <Select value={frameConfig.method} onValueChange={(v) => setFrameConfig({ method: v as "linear" | "pchip" })}>
                <SelectTrigger size="sm" className="w-[76px] text-xs border-0 bg-background shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="pchip">PCHIP</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(frameConfig.nSamples)} onValueChange={(v) => setFrameConfig({ nSamples: parseInt(v) })}>
                <SelectTrigger size="sm" className="w-[68px] text-xs border-0 bg-background shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nSamplesOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}点</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {frameCoverage.missing > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="relative flex h-5 items-center">
                      <Badge variant="destructive" className="text-[10px] h-5 px-1.5 animate-pulse">
                        {frameCoverage.missing} 缺帧
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {frameCoverage.missing}/{frameCoverage.total} 个样本没有
                      {frameConfig.method} × {frameConfig.nSamples}点 的帧数据，
                      请在数据帧管理面板中计算
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>

        {/* 显示选项组：对齐 + 染色 */}
        <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Select value={alignMode} onValueChange={(v) => setAlignMode(v as AlignMode)}>
                  <SelectTrigger size="sm" className="w-[88px] text-xs border-0 bg-background shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absolute">绝对时间</SelectItem>
                    <SelectItem value="relative">相对时间</SelectItem>
                    <SelectItem value="normalized">归一化</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent><p>时间对齐</p></TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Select value={colorMode} onValueChange={(v) => setColorMode(v as ColorMode)}>
                  <SelectTrigger size="sm" className="w-[92px] text-xs border-0 bg-background shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bySensor">按传感器</SelectItem>
                    <SelectItem value="bySample">按样本</SelectItem>
                    <SelectItem value="byRun">按运行</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent><p>染色方式</p></TooltipContent>
          </Tooltip>
        </div>

        {/* 环境数据组 */}
        <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-1 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowEnv(!showEnv)}
                className={`h-8 px-2.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  showEnv
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-background text-muted-foreground shadow-sm hover:text-foreground"
                }`}
              >
                <Thermometer className="h-3.5 w-3.5" />
                <Droplets className="h-3.5 w-3.5" />
                <Gauge className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent><p>温度 / 湿度 / 气压</p></TooltipContent>
          </Tooltip>
        </div>

        {/* 右侧：样本数 + 操作 */}
        <div className="flex items-center gap-1 ml-auto bg-muted/40 rounded-lg px-2 py-1">
          <Badge variant="secondary" className="text-xs h-6">
            {selectedSamples.length} 样本
          </Badge>
          <div className="w-px h-5 bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={fetchTimeSeriesData}
                disabled={loading}
                className="h-8 w-8 rounded flex items-center justify-center transition-colors bg-background text-muted-foreground shadow-sm hover:bg-accent disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent><p>刷新数据</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={exportChart}
                className="h-8 w-8 rounded flex items-center justify-center transition-colors bg-background text-muted-foreground shadow-sm hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent><p>导出图片</p></TooltipContent>
          </Tooltip>
        </div>
      </div>
      </TooltipProvider>
      </div>

      {/* 图表区域 - 始终在 DOM 中，确保 ECharts 实例不被销毁 */}
      <div className="flex-1 min-h-0 relative">
        <div 
          ref={chartRef} 
          className="w-full h-full absolute inset-0"
          style={{ visibility: !hasSelection || loading || timeSeriesData.length === 0 ? 'hidden' : 'visible' }}
        />
        {/* Loading 覆盖层 */}
        {hasSelection && loading && (
          <div className="h-full flex items-center justify-center absolute inset-0 bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {/* 数据为空覆盖层 */}
        {hasSelection && !loading && timeSeriesData.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground absolute inset-0 bg-background">
            <LineChart className="h-12 w-12 mb-4 opacity-50" />
            <p>点击刷新按钮加载数据</p>
          </div>
        )}
      </div>

      {/* 样本信息 */}
      {hasSelection && timeSeriesData.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {timeSeriesData.map((sample) => (
            <Badge key={sample.sampleId} variant="outline">
              Run #{sample.runId} - Sample #{sample.sampleIdx}
              {sample.liquidNames.length > 0 && ` (${sample.liquidNames.join(", ")})`}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
