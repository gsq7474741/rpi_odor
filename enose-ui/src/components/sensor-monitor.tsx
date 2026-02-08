"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Activity, Thermometer, Zap, ChevronDown, ChevronRight } from "lucide-react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useSensorStatusStream, useSensorReadingsStream } from "@/hooks/use-sensor-stream";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const SENSOR_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

interface DataPoint { time: number; value: number; }
interface MultiDataPoint { time: number; resistance: number; temperature?: number; humidity?: number; pressure?: number; }

function downsample(data: DataPoint[], threshold: number): DataPoint[] {
  if (data.length <= threshold) return data;
  const step = Math.ceil(data.length / threshold);
  return data.filter((_, i) => i % step === 0);
}

interface SensorMonitorProps {
  active?: boolean;
  defaultOpen?: boolean;
  experimentRunning?: boolean;
  inline?: boolean;
  runId?: number | null;
}

export function SensorMonitor({ active = true, defaultOpen = true, experimentRunning = false, inline = false, runId }: SensorMonitorProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [sensorData, setSensorData] = useState<MultiDataPoint[][]>(Array.from({ length: 8 }, () => []));
  const [visibleSensors, setVisibleSensors] = useState<boolean[]>(Array(8).fill(true));
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [dataCount, setDataCount] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // 图表交互防抖动
  const ZOOM_COOLDOWN_MS = 5000;
  const chartInteractionRef = useRef<Record<string, number>>({
    resistance: 0,
    temperature: 0,
    humidity: 0,
    pressure: 0,
  });

  const handleChartZoom = useCallback((chartKey: string) => {
    chartInteractionRef.current[chartKey] = Date.now();
  }, []);

  const isChartLocked = useCallback((chartKey: string) => {
    return Date.now() - chartInteractionRef.current[chartKey] < ZOOM_COOLDOWN_MS;
  }, []);

  // SSE 数据流
  const { status: sensorStatus, connected: sseConnected } = useSensorStatusStream();
  // 始终启用读数流（实验执行时传感器由 C++ 后端控制，状态可能未同步）
  const { readings: streamReadings, connected: readingsConnected } = useSensorReadingsStream(active);
  const lastProcessedIndexRef = useRef<number>(0);
  const prevExperimentRunningRef = useRef<boolean>(false);

  const historyLoadedRef = useRef<boolean>(false);

  // 实验开始时清空数据
  useEffect(() => {
    const wasRunning = prevExperimentRunningRef.current;
    prevExperimentRunningRef.current = experimentRunning;
    
    // 从非运行 → 运行：清空数据
    if (experimentRunning && !wasRunning) {
      setSensorData(Array.from({ length: 8 }, () => []));
      setDataCount(0);
      startTimeRef.current = null;
      lastProcessedIndexRef.current = 0;
      historyLoadedRef.current = false;
    }
  }, [experimentRunning]);

  // 页面刷新时从数据库加载历史传感器数据
  useEffect(() => {
    if (!experimentRunning || !runId || historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    const loadHistory = async () => {
      try {
        const res = await fetch(
          `/api/analytics/data?action=sensor-data&experimentId=${runId}&limit=5000&downsample=1`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success || !data.rows || data.rows.length === 0) return;

        // 用第一行的时间戳作为起始时间
        const firstTs = new Date(data.rows[0].ts).getTime();
        if (startTimeRef.current === null) startTimeRef.current = firstTs;
        const baseTime = startTimeRef.current;

        const newData: MultiDataPoint[][] = Array.from({ length: 8 }, () => []);
        for (const row of data.rows) {
          const ts = new Date(row.ts).getTime();
          const time = (ts - baseTime) / 1000;
          const mox: number[] = row.moxReadings || [];
          for (let i = 0; i < Math.min(mox.length, 8); i++) {
            newData[i].push({
              time,
              resistance: mox[i],
              temperature: row.temperature ?? 0,
              humidity: row.humidity ?? 0,
              pressure: 0,
            });
          }
        }

        setSensorData(newData);
        setDataCount(data.rows.length * 8);
      } catch {
        // silent fail - real-time stream will still work
      }
    };

    loadHistory();
  }, [experimentRunning, runId]);

  // 处理新读数
  useEffect(() => {
    if (streamReadings.length === 0) return;

    const startIdx = lastProcessedIndexRef.current;
    const newReadings = streamReadings.slice(startIdx);
    if (newReadings.length === 0) return;

    lastProcessedIndexRef.current = streamReadings.length;

    // 保留 1.5 倍窗口时间的数据
    const maxKeepSeconds = windowSeconds * 1.5;

    setSensorData(prev => {
      const n = [...prev];
      newReadings.forEach(r => {
        if (r.sensorIndex < 0 || r.sensorIndex >= 8) return;
        if (startTimeRef.current === null) startTimeRef.current = r.timestamp;
        const time = (r.timestamp - startTimeRef.current!) / 1000;
        const cutoff = time - maxKeepSeconds;
        const existing = n[r.sensorIndex] || [];
        // 丢弃超出 1.5x 窗口的旧数据
        const trimmed = existing.filter(p => p.time >= cutoff);
        n[r.sensorIndex] = [...trimmed, {
          time,
          resistance: r.gasResistance,
          temperature: r.temperature,
          humidity: r.humidity,
          pressure: r.pressure
        }];
      });
      return n;
    });
    setDataCount(c => c + newReadings.length);
  }, [streamReadings, windowSeconds]);

  const makeChartOption = useCallback((field: 'resistance' | 'temperature' | 'humidity' | 'pressure', yName: string, formatter?: (v: number) => string, compact = false): EChartsOption => {
    const maxTime = Math.max(...sensorData.flatMap(d => d.map(p => p.time)), windowSeconds);
    const minTime = Math.max(0, maxTime - windowSeconds);
    const series = sensorData.map((data, idx) => {
      if (!visibleSensors[idx]) return null;
      const wd = data.filter(p => p.time >= minTime && p[field] !== undefined);
      const sd = downsample(wd.map(p => ({ time: p.time, value: p[field]! })), 500);
      return { name: `S${idx}`, type: 'line' as const, showSymbol: false, lineStyle: { width: 1.5 }, color: SENSOR_COLORS[idx], data: sd.map(p => [p.time, p.value]), animation: false };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
    return {
      animation: false, tooltip: { trigger: 'axis', confine: true },
      legend: compact ? { show: false } : { data: Array.from({ length: 8 }, (_, i) => `S${i}`).filter((_, i) => visibleSensors[i]), top: 5, itemWidth: 15, itemHeight: 10, textStyle: { fontSize: 11 } },
      grid: compact ? { left: 45, right: 15, top: 10, bottom: 25 } : { left: 55, right: 15, top: 35, bottom: 25 },
      xAxis: { type: 'value', name: compact ? '' : '时间 (s)', min: minTime, max: maxTime, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 9 } },
      yAxis: { type: 'value', name: compact ? '' : yName, axisLabel: { formatter, fontSize: 9 }, nameTextStyle: { fontSize: 10 } },
      series, dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }]
    };
  }, [sensorData, visibleSensors, windowSeconds]);

  const resistanceOption = useMemo(() => makeChartOption('resistance', '气体电阻 (Ω)', (v: number) => v.toExponential(1)), [makeChartOption]);
  const temperatureOption = useMemo(() => makeChartOption('temperature', '°C', undefined, true), [makeChartOption]);
  const humidityOption = useMemo(() => makeChartOption('humidity', '%RH', undefined, true), [makeChartOption]);
  const pressureOption = useMemo(() => makeChartOption('pressure', 'hPa', undefined, true), [makeChartOption]);

  const sensorContent = (
          <div className={inline ? "space-y-3" : "pt-0 space-y-3"}>
            {/* 传感器选择 + 窗口 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="flex items-center gap-0.5">
                    <Checkbox
                      id={`sm-s${i}`}
                      checked={visibleSensors[i]}
                      onCheckedChange={() => setVisibleSensors(p => { const n=[...p]; n[i]=!n[i]; return n; })}
                      className="w-3.5 h-3.5"
                    />
                    <label htmlFor={`sm-s${i}`} className="text-xs font-medium cursor-pointer" style={{ color: SENSOR_COLORS[i] }}>
                      S{i}
                    </label>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-[10px] text-muted-foreground">窗口:</Label>
                <Input type="number" className="h-6 w-14 text-center text-xs" value={windowSeconds} onChange={e => setWindowSeconds(Number(e.target.value))} />
                <span className="text-[10px] text-muted-foreground">秒</span>
              </div>
            </div>

            {/* 主图表 - 气体电阻 */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-medium">气体电阻</span>
                {isChartLocked('resistance') && <span className="text-[10px]">🔒</span>}
              </div>
              {active && <ReactECharts
                option={resistanceOption}
                style={{ height: 200 }}
                notMerge={!isChartLocked('resistance')}
                lazyUpdate={true}
                onEvents={{ datazoom: () => handleChartZoom('resistance') }}
              />}
            </div>

            {/* 环境三图 */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <Thermometer className="w-3 h-3" />
                  <span className="text-[10px] font-medium">温度</span>
                  {isChartLocked('temperature') && <span className="text-[10px]">🔒</span>}
                </div>
                {active && <ReactECharts
                  option={temperatureOption}
                  style={{ height: 100 }}
                  notMerge={!isChartLocked('temperature')}
                  lazyUpdate={true}
                  onEvents={{ datazoom: () => handleChartZoom('temperature') }}
                />}
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <Activity className="w-3 h-3" />
                  <span className="text-[10px] font-medium">湿度</span>
                  {isChartLocked('humidity') && <span className="text-[10px]">🔒</span>}
                </div>
                {active && <ReactECharts
                  option={humidityOption}
                  style={{ height: 100 }}
                  notMerge={!isChartLocked('humidity')}
                  lazyUpdate={true}
                  onEvents={{ datazoom: () => handleChartZoom('humidity') }}
                />}
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <Activity className="w-3 h-3" />
                  <span className="text-[10px] font-medium">气压</span>
                  {isChartLocked('pressure') && <span className="text-[10px]">🔒</span>}
                </div>
                {active && <ReactECharts
                  option={pressureOption}
                  style={{ height: 100 }}
                  notMerge={!isChartLocked('pressure')}
                  lazyUpdate={true}
                  onEvents={{ datazoom: () => handleChartZoom('pressure') }}
                />}
              </div>
            </div>

            {/* 底部信息 */}
            <div className="text-[10px] text-muted-foreground border-t pt-1.5">
              传感器: {sensorStatus?.sensorCount ?? 0} | 固件: {sensorStatus?.firmwareVersion || '-'} | 端口: {sensorStatus?.port || '-'}
            </div>
          </div>
  );

  if (inline) {
    return (
      <div className="flex flex-col h-full overflow-y-auto">
        {/* 状态栏 */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 font-normal">
            <Badge variant={sensorStatus?.connected ? "outline" : "destructive"} className="gap-1 text-[10px] h-5">
              {sensorStatus?.connected ? "已连接" : "未连接"}
            </Badge>
            <Badge variant={experimentRunning && readingsConnected ? "default" : "secondary"} className="gap-1 text-[10px] h-5">
              {experimentRunning && readingsConnected ? "● 采集中" : "○ 停止"}
            </Badge>
            <span className="text-[10px] text-muted-foreground ml-1">{dataCount} 点</span>
          </div>
        </div>
        {sensorContent}
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <Activity className="w-4 h-4" />
                传感器监控
              </div>
              <div className="flex items-center gap-1.5 font-normal">
                <Badge variant={sensorStatus?.connected ? "outline" : "destructive"} className="gap-1 text-[10px] h-5">
                  {sensorStatus?.connected ? "已连接" : "未连接"}
                </Badge>
                <Badge variant={experimentRunning && readingsConnected ? "default" : "secondary"} className="gap-1 text-[10px] h-5">
                  {experimentRunning && readingsConnected ? "● 采集中" : "○ 停止"}
                </Badge>
                <span className="text-[10px] text-muted-foreground ml-1">{dataCount} 点</span>
              </div>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {sensorContent}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
