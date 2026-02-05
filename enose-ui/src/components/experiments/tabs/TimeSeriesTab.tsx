"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
  ZoomIn,
  ZoomOut,
  Download,
} from "lucide-react";
import * as echarts from "echarts";

interface SensorDataPoint {
  timeMs: number;
  value: number;
  sensorIdx: number;
}

interface SampleTimeSeriesData {
  sampleId: number;
  runId: number;
  sampleIdx: number;
  liquidNames: string[];
  phaseName: string;
  data: SensorDataPoint[];
}

type AlignMode = "absolute" | "relative" | "normalized";

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

export function TimeSeriesTab() {
  const {
    selectedSampleIds,
    samples,
  } = useExperiments();

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const [loading, setLoading] = useState(false);
  const [timeSeriesData, setTimeSeriesData] = useState<SampleTimeSeriesData[]>([]);
  const [selectedSensors, setSelectedSensors] = useState<number[]>([0, 1, 2, 3, 4, 5, 6, 7]);
  const [alignMode, setAlignMode] = useState<AlignMode>("relative");

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
        // 获取样本的传感器数据
        const response = await fetch(
          `/api/analytics/data?action=sensor-data&experimentId=${runId}&limit=1000`
        );
        const data = await response.json();

        if (data.success && data.rows) {
          // 从 context 的 samples 数组中找到样本信息
          const sampleInfo = samples.find((s) => s.id === sampleId);
          
          // 转换数据格式
          const sensorData: SensorDataPoint[] = [];
          for (const row of data.rows) {
            if (row.moxReadings) {
              for (let i = 0; i < row.moxReadings.length; i++) {
                sensorData.push({
                  timeMs: new Date(row.ts).getTime(),
                  value: row.moxReadings[i],
                  sensorIdx: i,
                });
              }
            }
          }

          results.push({
            sampleId,
            runId,
            sampleIdx: sampleInfo?.sampleIdx || 0,
            liquidNames: sampleInfo?.liquidNames || [],
            phaseName: sampleInfo?.phaseName || "",
            data: sensorData,
          });
        }
      }

      setTimeSeriesData(results);
    } catch (error) {
      console.error("Failed to fetch time series data:", error);
    } finally {
      setLoading(false);
    }
  }, [getSelectedSamples, samples]);

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

  // 更新图表
  useEffect(() => {
    if (!chartInstance.current || timeSeriesData.length === 0) {
      chartInstance.current?.clear();
      return;
    }

    const series: echarts.SeriesOption[] = [];
    const legendData: string[] = [];

    timeSeriesData.forEach((sampleData, sampleIdx) => {
      // 按传感器分组数据
      const sensorGroups: Record<number, { time: number; value: number }[]> = {};
      
      sampleData.data.forEach((point) => {
        if (!selectedSensors.includes(point.sensorIdx)) return;
        
        if (!sensorGroups[point.sensorIdx]) {
          sensorGroups[point.sensorIdx] = [];
        }
        sensorGroups[point.sensorIdx].push({
          time: point.timeMs,
          value: point.value,
        });
      });

      // 为每个传感器创建系列
      Object.entries(sensorGroups).forEach(([sensorIdxStr, points]) => {
        const sensorIdx = parseInt(sensorIdxStr);
        // 使用更语义化的命名：Run#ID-Sample#Idx-SensorX
        const name = `R${sampleData.runId}-S${sampleData.sampleIdx}-Sen${sensorIdx}`;
        legendData.push(name);

        // 根据对齐模式处理时间
        let processedPoints = points;
        if (alignMode === "relative" && points.length > 0) {
          const minTime = Math.min(...points.map((p) => p.time));
          processedPoints = points.map((p) => ({
            time: p.time - minTime,
            value: p.value,
          }));
        } else if (alignMode === "normalized" && points.length > 0) {
          const minTime = Math.min(...points.map((p) => p.time));
          const maxTime = Math.max(...points.map((p) => p.time));
          const range = maxTime - minTime || 1;
          processedPoints = points.map((p) => ({
            time: ((p.time - minTime) / range) * 100,
            value: p.value,
          }));
        }

        series.push({
          name,
          type: "line",
          data: processedPoints.map((p) => [p.time, p.value]),
          smooth: true,
          symbol: "none",
          lineStyle: {
            width: 1.5,
            color: SENSOR_COLORS[sensorIdx % SENSOR_COLORS.length],
            opacity: 0.8,
          },
          emphasis: {
            lineStyle: {
              width: 2,
            },
          },
        });
      });
    });

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
        },
      },
      legend: {
        data: legendData,
        type: "scroll",
        top: 0,
        textStyle: {
          fontSize: 10,
        },
      },
      grid: {
        left: 60,
        right: 20,
        top: 40,
        bottom: 40,
      },
      xAxis: {
        type: "value",
        name: alignMode === "normalized" ? "归一化时间 (%)" : alignMode === "relative" ? "时间 (ms)" : "时间戳",
        nameLocation: "middle",
        nameGap: 25,
      },
      yAxis: {
        type: "value",
        name: "传感器值",
        nameLocation: "middle",
        nameGap: 40,
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 20,
          bottom: 5,
        },
      ],
      series,
    };

    chartInstance.current.setOption(option, true);
  }, [timeSeriesData, selectedSensors, alignMode]);

  // 选中项变化时自动加载数据
  useEffect(() => {
    const selected = getSelectedSamples();
    if (selected.length > 0) {
      fetchTimeSeriesData();
    }
  }, [selectedSampleIds, samples]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (selectedSamples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <LineChart className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">选择样本查看时序图</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          在左侧列表中展开运行并选择样本，或启用对比模式选择多个样本进行叠加对比。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* 控制栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          {/* 传感器选择 */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">传感器:</Label>
            <div className="flex gap-1">
              {Array.from({ length: 8 }).map((_, idx) => (
                <Button
                  key={idx}
                  variant={selectedSensors.includes(idx) ? "default" : "outline"}
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => toggleSensor(idx)}
                  style={{
                    backgroundColor: selectedSensors.includes(idx)
                      ? SENSOR_COLORS[idx]
                      : undefined,
                    borderColor: SENSOR_COLORS[idx],
                  }}
                >
                  {idx}
                </Button>
              ))}
            </div>
          </div>

          {/* 对齐模式 */}
          <div className="flex items-center gap-2">
            <Label className="text-sm">对齐:</Label>
            <Select value={alignMode} onValueChange={(v) => setAlignMode(v as AlignMode)}>
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="absolute">绝对时间</SelectItem>
                <SelectItem value="relative">相对时间</SelectItem>
                <SelectItem value="normalized">归一化</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {selectedSamples.length} 个样本
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTimeSeriesData}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={exportChart}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="flex-1 min-h-0 relative">
        {/* ECharts 容器始终渲染，通过 visibility 控制显示 */}
        <div 
          ref={chartRef} 
          className="w-full h-full absolute inset-0"
          style={{ visibility: loading || timeSeriesData.length === 0 ? 'hidden' : 'visible' }}
        />
        {/* Loading 和空状态覆盖层 */}
        {loading && (
          <div className="h-full flex items-center justify-center absolute inset-0 bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && timeSeriesData.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground absolute inset-0 bg-background">
            <LineChart className="h-12 w-12 mb-4 opacity-50" />
            <p>点击刷新按钮加载数据</p>
          </div>
        )}
      </div>

      {/* 样本信息 */}
      {timeSeriesData.length > 0 && (
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
