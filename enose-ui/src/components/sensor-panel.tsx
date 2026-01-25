"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Activity, Play, Square, RefreshCw, Thermometer, Zap, Settings, Trash2 } from "lucide-react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useSensorStatusStream, useSensorReadingsStream } from "@/hooks/use-sensor-stream";

const SENSOR_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

const HEATER_PRESETS: Record<string, { temps: number[], durs: number[], desc: string } | null> = {
  "恒温高温 (320°C)": { temps: [320,320,320,320,320,320,320,320,320,320], durs: [1,1,1,1,1,1,1,1,1,1], desc: "10步恒定320°C，每步约140ms，~7Hz采样" },
  "恒温中温 (200°C)": { temps: [200,200,200,200,200,200,200,200,200,200], durs: [1,1,1,1,1,1,1,1,1,1], desc: "10步恒定200°C，每步约140ms，~7Hz采样" },
  "恒温低温 (100°C)": { temps: [100,100,100,100,100,100,100,100,100,100], durs: [1,1,1,1,1,1,1,1,1,1], desc: "10步恒定100°C，每步约140ms，~7Hz采样" },
  "变温模式A (快速)": { temps: [100,320,320,200,200,200,320,320,320,320], durs: [64,2,2,2,31,31,2,20,21,21], desc: "100°C预热 → 320°C快闪 → 200°C保持 → 320°C采集" },
  "变温模式B (标准)": { temps: [100,320,320,200,200,200,320,320,320,320], durs: [43,2,2,2,21,21,2,14,14,14], desc: "100°C预热 → 320°C快闪 → 200°C保持 → 320°C采集" },
  "变温模式C (阶梯)": { temps: [100,100,200,200,200,200,320,320,320,320], durs: [2,41,2,14,14,14,2,14,14,14], desc: "100°C → 200°C → 320°C 阶梯升温" },
  "开发套件默认": { temps: [320,100,100,100,200,200,200,320,320,320], durs: [5,2,10,30,5,5,5,5,5,5], desc: "BME688开发套件默认配置" },
  "自定义恒温": null,
};

interface SensorBoardStatus { connected: boolean; running: boolean; sensorCount: number; firmwareVersion: string; port: string; }
interface SensorReading { timestamp: number; sensorIndex: number; gasResistance: number; temperature?: number; humidity?: number; pressure?: number; }
interface DataPoint { time: number; value: number; }
interface MultiDataPoint { time: number; resistance: number; temperature?: number; humidity?: number; pressure?: number; }

function downsample(data: DataPoint[], threshold: number): DataPoint[] {
  if (data.length <= threshold) return data;
  const step = Math.ceil(data.length / threshold);
  return data.filter((_, i) => i % step === 0);
}

export function SensorPanel() {
  const [sensorStatus, setSensorStatus] = useState<SensorBoardStatus>({ connected: false, running: false, sensorCount: 8, firmwareVersion: "", port: "" });
  const [grpcConnected, setGrpcConnected] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<number | null>(null);
  const [sensorData, setSensorData] = useState<MultiDataPoint[][]>(Array.from({ length: 8 }, () => []));
  const [visibleSensors, setVisibleSensors] = useState<boolean[]>(Array(8).fill(true));
  const [selectedPreset, setSelectedPreset] = useState("恒温高温 (320°C)");
  const [customTemp, setCustomTemp] = useState(320);
  const [customDur, setCustomDur] = useState(5);
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [logs, setLogs] = useState<string[]>([]);
  const [dataCount, setDataCount] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  
  // 图表交互防抖动: 记录每个图表最后交互时间
  const ZOOM_COOLDOWN_MS = 5000; // 5秒冷却时间
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

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [...prev.slice(-100), `[${ts}] ${msg}`]);
  }, []);

  const sendCommand = useCallback(async (cmd: string, params?: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/sensor/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd, params }) });
      const data = await res.json();
      // 显示原始响应数据 (类似 Python 版本)
      const rawData = data.data ? JSON.stringify(data.data) : '';
      addLog(`${cmd}: ${data.success ? '成功' : data.message}${rawData ? ' | ' + rawData : ''}`);
      return data;
    } catch { addLog(`${cmd}: 错误`); return { success: false }; }
  }, [addLog]);

  // 使用 SSE 获取传感器状态
  const { status: streamSensorStatus, connected: sseConnected } = useSensorStatusStream();
  
  // 同步 SSE 状态
  useEffect(() => {
    if (streamSensorStatus) {
      setSensorStatus(streamSensorStatus);
      setGrpcConnected(streamSensorStatus.connected);
    }
  }, [streamSensorStatus]);

  // 使用 SSE 获取传感器读数 (仅在运行时启用)
  const { readings: streamReadings, connected: readingsConnected } = useSensorReadingsStream(sensorStatus.running);
  const lastProcessedIndexRef = useRef<number>(0);
  
  // 处理新的读数 - 处理所有未处理的数据
  useEffect(() => {
    if (streamReadings.length === 0) return;
    
    // 处理从上次处理位置到当前末尾的所有数据
    const startIdx = lastProcessedIndexRef.current;
    const newReadings = streamReadings.slice(startIdx);
    
    if (newReadings.length === 0) return;
    
    // 更新已处理索引
    lastProcessedIndexRef.current = streamReadings.length;
    
    // 批量处理所有新读数
    setSensorData(prev => {
      const n = [...prev];
      newReadings.forEach(r => {
        if (r.sensorIndex < 0 || r.sensorIndex >= 8) return;
        if (startTimeRef.current === null) startTimeRef.current = r.timestamp;
        const time = (r.timestamp - startTimeRef.current!) / 1000;
        const existing = n[r.sensorIndex] || [];
        n[r.sensorIndex] = [...existing.slice(-2000), { 
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
  }, [streamReadings]);

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
      grid: compact ? { left: 45, right: 15, top: 10, bottom: 25 } : { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'value', name: compact ? '' : '时间 (s)', min: minTime, max: maxTime, nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', name: compact ? '' : yName, axisLabel: { formatter, fontSize: 10 }, nameTextStyle: { fontSize: 11 } },
      series, dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }]
    };
  }, [sensorData, visibleSensors, windowSeconds]);

  const resistanceOption = useMemo(() => makeChartOption('resistance', '气体电阻 (Ω)', (v: number) => v.toExponential(1)), [makeChartOption]);
  const temperatureOption = useMemo(() => makeChartOption('temperature', '°C', undefined, true), [makeChartOption]);
  const humidityOption = useMemo(() => makeChartOption('humidity', '%RH', undefined, true), [makeChartOption]);
  const pressureOption = useMemo(() => makeChartOption('pressure', 'hPa', undefined, true), [makeChartOption]);

  const handleStart = async () => { await sendCommand('start'); };
  const handleStop = async () => { await sendCommand('stop'); };
  const handleApplyHeater = async () => {
    const preset = HEATER_PRESETS[selectedPreset];
    const temps = preset ? preset.temps : Array(10).fill(customTemp);
    const durs = preset ? preset.durs : Array(10).fill(customDur);
    await sendCommand('config', { temps, durs });
  };
  const handleClearData = () => { setSensorData(Array.from({ length: 8 }, () => [] as MultiDataPoint[])); startTimeRef.current = null; setDataCount(0); addLog('图表已清除'); };

  return (
    <div className="space-y-4">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">传感器控制面板</h1>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={grpcConnected ? "outline" : "destructive"} className="gap-1">
            <Activity className="w-3 h-3" />gRPC: {grpcConnected ? "已连接" : "未连接"}
          </Badge>
          {lastRefreshTime !== null && (
            <Badge variant="outline" className="gap-1">
              <RefreshCw className="w-3 h-3" />{lastRefreshTime}ms
            </Badge>
          )}
          <Badge variant={sensorStatus.connected ? "outline" : "destructive"} className="gap-1">
            传感器: {sensorStatus.connected ? "已连接" : "未连接"}
          </Badge>
          <Badge variant={sensorStatus.running ? "default" : "secondary"} className="gap-1">
            {sensorStatus.running ? "● 采集中" : "○ 已停止"}
          </Badge>
        </div>
      </div>

      {/* 控制区域 - 两列布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左侧：传感器控制 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4" />传感器控制
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => sendCommand('sync')}>
                <RefreshCw className="w-3 h-3 mr-1" />同步
              </Button>
              <Button size="sm" variant="outline" onClick={() => sendCommand('init')}>
                <Settings className="w-3 h-3 mr-1" />初始化
              </Button>
              <Button size="sm" variant="outline" onClick={() => sendCommand('status')}>状态</Button>
              <Button size="sm" variant="outline" onClick={() => sendCommand('reset')}>重置</Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleStart} disabled={sensorStatus.running}>
                <Play className="w-3 h-3 mr-1" />开始采集
              </Button>
              <Button size="sm" variant="destructive" onClick={handleStop} disabled={!sensorStatus.running}>
                <Square className="w-3 h-3 mr-1" />停止采集
              </Button>
              <Button size="sm" variant="outline" onClick={handleClearData}>
                <Trash2 className="w-3 h-3 mr-1" />清除
              </Button>
            </div>
            <div className="text-xs text-muted-foreground pt-1 border-t">
              传感器: {sensorStatus.sensorCount} | 固件: {sensorStatus.firmwareVersion || '-'} | 端口: {sensorStatus.port || '-'} | 数据: {dataCount}
            </div>
          </CardContent>
        </Card>

        {/* 右侧：加热器配置 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Thermometer className="w-4 h-4" />加热器配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">预设模式</Label>
                <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(HEATER_PRESETS).map(n => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 h-9" onClick={handleApplyHeater}>
                应用配置
              </Button>
            </div>
            {selectedPreset === "自定义恒温" && (
              <div className="flex gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">温度 (°C)</Label>
                  <Input type="number" className="h-8 w-24 mt-1" value={customTemp} onChange={e => setCustomTemp(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">步长</Label>
                  <Input type="number" className="h-8 w-24 mt-1" value={customDur} onChange={e => setCustomDur(Number(e.target.value))} />
                </div>
              </div>
            )}
            {HEATER_PRESETS[selectedPreset] && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                {HEATER_PRESETS[selectedPreset]!.desc}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 传感器选择 - 紧凑单行 */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1">
              <Zap className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium mr-2">显示传感器:</span>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Checkbox 
                    id={`s${i}`} 
                    checked={visibleSensors[i]} 
                    onCheckedChange={() => setVisibleSensors(p => { const n=[...p]; n[i]=!n[i]; return n; })} 
                    className="w-4 h-4"
                  />
                  <label htmlFor={`s${i}`} className="text-sm font-medium cursor-pointer" style={{ color: SENSOR_COLORS[i] }}>
                    S{i}
                  </label>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">窗口:</Label>
              <Input type="number" className="h-7 w-16 text-center" value={windowSeconds} onChange={e => setWindowSeconds(Number(e.target.value))} />
              <span className="text-xs text-muted-foreground">秒</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 主图表 - 气体电阻 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4" />气体电阻曲线
            {isChartLocked('resistance') && <Badge variant="outline" className="text-xs ml-2">🔒 缩放锁定</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ReactECharts 
            option={resistanceOption} 
            style={{ height: 300 }} 
            notMerge={!isChartLocked('resistance')} 
            lazyUpdate={true}
            onEvents={{ datazoom: () => handleChartZoom('resistance') }}
          />
        </CardContent>
      </Card>

      {/* 环境数据三图 - 紧凑布局 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="overflow-hidden">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Thermometer className="w-3.5 h-3.5" />温度 (°C)
              {isChartLocked('temperature') && <span className="text-xs">🔒</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ReactECharts 
              option={temperatureOption} 
              style={{ height: 150 }} 
              notMerge={!isChartLocked('temperature')} 
              lazyUpdate={true}
              onEvents={{ datazoom: () => handleChartZoom('temperature') }}
            />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="w-3.5 h-3.5" />湿度 (%RH)
              {isChartLocked('humidity') && <span className="text-xs">🔒</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ReactECharts 
              option={humidityOption} 
              style={{ height: 150 }} 
              notMerge={!isChartLocked('humidity')} 
              lazyUpdate={true}
              onEvents={{ datazoom: () => handleChartZoom('humidity') }}
            />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="w-3.5 h-3.5" />气压 (hPa)
              {isChartLocked('pressure') && <span className="text-xs">🔒</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ReactECharts 
              option={pressureOption} 
              style={{ height: 150 }} 
              notMerge={!isChartLocked('pressure')} 
              lazyUpdate={true}
              onEvents={{ datazoom: () => handleChartZoom('pressure') }}
            />
          </CardContent>
        </Card>
      </div>

      {/* 通信日志 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">通信日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-28 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded-md p-2 font-mono text-xs">
            {logs.map((log, i) => <div key={i} className="py-0.5">{log}</div>)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
