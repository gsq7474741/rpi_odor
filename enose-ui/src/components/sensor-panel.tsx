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

const SENSOR_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

const HEATER_PRESETS: Record<string, { temps: number[], durs: number[], desc: string } | null> = {
  "恒温高温 (320°C)": { temps: [320,320,320,320,320,320,320,320,320,320], durs: [429,429,429,429,429,429,429,429,429,429], desc: "10步恒定320°C" },
  "恒温中温 (200°C)": { temps: [200,200,200,200,200,200,200,200,200,200], durs: [429,429,429,429,429,429,429,429,429,429], desc: "10步恒定200°C" },
  "恒温低温 (100°C)": { temps: [100,100,100,100,100,100,100,100,100,100], durs: [429,429,429,429,429,429,429,429,429,429], desc: "10步恒定100°C" },
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

  const fetchSensorStatus = useCallback(async () => {
    const st = Date.now();
    try {
      const res = await fetch('/api/sensor/status');
      const data = await res.json();
      setSensorStatus(data);
      setGrpcConnected(data.connected);
      setLastRefreshTime(Date.now() - st);
    } catch { setGrpcConnected(false); }
  }, []);

  useEffect(() => { fetchSensorStatus(); const i = setInterval(fetchSensorStatus, 2000); return () => clearInterval(i); }, [fetchSensorStatus]);

  useEffect(() => {
    if (!sensorStatus.running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/sensor/readings');
        const data = await res.json();
        const readings: SensorReading[] = data.readings || [];
        if (readings.length > 0) {
          if (startTimeRef.current === null) startTimeRef.current = readings[0].timestamp;
          readings.forEach(r => {
            if (r.sensorIndex < 0 || r.sensorIndex >= 8) return;
            const time = (r.timestamp - startTimeRef.current!) / 1000;
            setSensorData(prev => { 
              const n = [...prev]; 
              const existing = n[r.sensorIndex] || [];
              n[r.sensorIndex] = [...existing.slice(-2000), { 
                time, 
                resistance: r.gasResistance,
                temperature: r.temperature,
                humidity: r.humidity,
                pressure: r.pressure
              }]; 
              return n; 
            });
            setDataCount(c => c + 1);
          });
        }
      } catch {}
    }, 100);
    return () => clearInterval(interval);
  }, [sensorStatus.running]);

  const makeChartOption = useCallback((field: 'resistance' | 'temperature' | 'humidity' | 'pressure', yName: string, formatter?: (v: number) => string): EChartsOption => {
    const maxTime = Math.max(...sensorData.flatMap(d => d.map(p => p.time)), windowSeconds);
    const minTime = Math.max(0, maxTime - windowSeconds);
    const series = sensorData.map((data, idx) => {
      if (!visibleSensors[idx]) return null;
      const wd = data.filter(p => p.time >= minTime && p[field] !== undefined);
      const sd = downsample(wd.map(p => ({ time: p.time, value: p[field]! })), 500);
      return { name: `S${idx}`, type: 'line' as const, showSymbol: false, lineStyle: { width: 1.5 }, color: SENSOR_COLORS[idx], data: sd.map(p => [p.time, p.value]), animation: false };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
    return {
      animation: false, tooltip: { trigger: 'axis' },
      legend: { data: Array.from({ length: 8 }, (_, i) => `S${i}`).filter((_, i) => visibleSensors[i]), top: 5 },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'value', name: '时间 (s)', min: minTime, max: maxTime },
      yAxis: { type: 'value', name: yName, axisLabel: formatter ? { formatter } : undefined },
      series, dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }]
    };
  }, [sensorData, visibleSensors, windowSeconds]);

  const resistanceOption = useMemo(() => makeChartOption('resistance', '气体电阻 (Ω)', (v: number) => v.toExponential(1)), [makeChartOption]);
  const temperatureOption = useMemo(() => makeChartOption('temperature', '温度 (°C)'), [makeChartOption]);
  const humidityOption = useMemo(() => makeChartOption('humidity', '湿度 (%RH)'), [makeChartOption]);
  const pressureOption = useMemo(() => makeChartOption('pressure', '气压 (Pa)'), [makeChartOption]);

  const handleStart = async () => { await sendCommand('start'); fetchSensorStatus(); };
  const handleStop = async () => { await sendCommand('stop'); fetchSensorStatus(); };
  const handleApplyHeater = async () => {
    const preset = HEATER_PRESETS[selectedPreset];
    const temps = preset ? preset.temps : Array(10).fill(customTemp);
    const durs = preset ? preset.durs : Array(10).fill(customDur);
    await sendCommand('config', { temps, durs });
  };
  const handleClearData = () => { setSensorData(Array.from({ length: 8 }, () => [] as MultiDataPoint[])); startTimeRef.current = null; setDataCount(0); addLog('图表已清除'); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">传感器控制面板</h1>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={grpcConnected ? "outline" : "destructive"}><Activity className="w-3 h-3 mr-1" />gRPC: {grpcConnected ? "已连接" : "未连接"}</Badge>
          {lastRefreshTime !== null && <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1" />{lastRefreshTime}ms</Badge>}
          <Badge variant={sensorStatus.connected ? "outline" : "destructive"}>传感器: {sensorStatus.connected ? "已连接" : "未连接"}</Badge>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-base"><div className="flex items-center gap-2"><Activity className="w-4 h-4" />传感器控制</div><Badge variant={sensorStatus.running ? "default" : "secondary"}>{sensorStatus.running ? "采集中" : "已停止"}</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => sendCommand('sync')}><RefreshCw className="w-3 h-3 mr-1" />同步</Button>
            <Button size="sm" variant="outline" onClick={() => sendCommand('init')}><Settings className="w-3 h-3 mr-1" />初始化</Button>
            <Button size="sm" variant="outline" onClick={() => sendCommand('status')}>状态</Button>
            <Button size="sm" variant="outline" onClick={() => sendCommand('reset')}>重置</Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleStart} disabled={sensorStatus.running}><Play className="w-3 h-3 mr-1" />开始采集</Button>
            <Button size="sm" variant="destructive" onClick={handleStop} disabled={!sensorStatus.running}><Square className="w-3 h-3 mr-1" />停止采集</Button>
            <Button size="sm" variant="outline" onClick={handleClearData}><Trash2 className="w-3 h-3 mr-1" />清除数据</Button>
          </div>
          <div className="text-xs text-muted-foreground">传感器: {sensorStatus.sensorCount} | 固件: {sensorStatus.firmwareVersion || '-'} | 端口: {sensorStatus.port || '-'} | 数据点: {dataCount}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Thermometer className="w-4 h-4" />加热器配置</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label className="text-xs">预设</Label><Select value={selectedPreset} onValueChange={setSelectedPreset}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(HEATER_PRESETS).map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select></div>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleApplyHeater}>应用配置</Button>
          </div>
          {selectedPreset === "自定义恒温" && <div className="flex gap-2"><div><Label className="text-xs">温度 (°C)</Label><Input type="number" className="h-8 w-24" value={customTemp} onChange={e => setCustomTemp(Number(e.target.value))} /></div><div><Label className="text-xs">步长</Label><Input type="number" className="h-8 w-24" value={customDur} onChange={e => setCustomDur(Number(e.target.value))} /></div></div>}
          {HEATER_PRESETS[selectedPreset] && <p className="text-xs text-muted-foreground">{HEATER_PRESETS[selectedPreset]!.desc}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Zap className="w-4 h-4" />传感器选择</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex items-center gap-1"><Checkbox id={`s${i}`} checked={visibleSensors[i]} onCheckedChange={() => setVisibleSensors(p => { const n=[...p]; n[i]=!n[i]; return n; })} /><label htmlFor={`s${i}`} className="text-sm font-medium" style={{ color: SENSOR_COLORS[i] }}>S{i}</label></div>)}</div>
          <div className="mt-2 flex items-center gap-2"><Label className="text-xs">时间窗口 (秒):</Label><Input type="number" className="h-7 w-20" value={windowSeconds} onChange={e => setWindowSeconds(Number(e.target.value))} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Activity className="w-4 h-4" />气体电阻曲线</CardTitle></CardHeader>
        <CardContent><ReactECharts option={resistanceOption} style={{ height: 280 }} notMerge={true} lazyUpdate={true} /></CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Thermometer className="w-4 h-4" />温度</CardTitle></CardHeader>
          <CardContent><ReactECharts option={temperatureOption} style={{ height: 200 }} notMerge={true} lazyUpdate={true} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="w-4 h-4" />湿度</CardTitle></CardHeader>
          <CardContent><ReactECharts option={humidityOption} style={{ height: 200 }} notMerge={true} lazyUpdate={true} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="w-4 h-4" />气压</CardTitle></CardHeader>
          <CardContent><ReactECharts option={pressureOption} style={{ height: 200 }} notMerge={true} lazyUpdate={true} /></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">通信日志</CardTitle></CardHeader>
        <CardContent><div className="h-32 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded p-2 font-mono text-xs">{logs.map((log, i) => <div key={i}>{log}</div>)}</div></CardContent>
      </Card>
    </div>
  );
}
