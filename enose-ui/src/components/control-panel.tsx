"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Droplets,
  Wind,
  Gauge,
  Power,
  CircleDot,
  Thermometer,
  Scale,
  Activity,
  RefreshCw,
  Loader2,
} from "lucide-react";
import {
  fetchStatus,
  setSystemState as apiSetSystemState,
  manualControl,
  runPump,
  stopAllPumps,
  type SystemStatus,
} from "@/lib/api";

// 初始状态
const initialStatus: SystemStatus = {
  current_state: "UNSPECIFIED",
  peripheral_status: {
    valve_waste: 0,
    valve_pinch: 0,
    valve_air: 0,
    valve_outlet: 0,
    air_pump_pwm: 0,
    cleaning_pump: 0,
    pump_2: "STOPPED",
    pump_3: "STOPPED",
    pump_4: "STOPPED",
    pump_5: "STOPPED",
    heater_chamber: 0,
    sensor_chamber_temp: undefined,
    scale_weight: undefined,
  },
  moonraker_connected: false,
  sensor_connected: false,
  firmware_ready: true,
};

export function ControlPanel() {
  const [status, setStatus] = useState<SystemStatus>(initialStatus);
  const [grpcConnected, setGrpcConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<number | null>(null);
  const [timeSinceUpdate, setTimeSinceUpdate] = useState<number>(0);
  const [emergencyStopLoading, setEmergencyStopLoading] = useState(false);
  const [firmwareRestartLoading, setFirmwareRestartLoading] = useState(false);

  // 获取状态
  const refreshStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchStatus();
      setStatus(data);
      setGrpcConnected(true);
      setLastUpdateTime(Date.now());
    } catch (err: any) {
      setError(err.message);
      setGrpcConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化和轮询 (500ms 实时更新)
  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 500);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // 计时器：每100ms更新距离上次收到报文的时间
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastUpdateTime) {
        setTimeSinceUpdate(Date.now() - lastUpdateTime);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [lastUpdateTime]);

  const handleValveToggle = async (name: string, value: boolean) => {
    try {
      await manualControl(name, value ? 1 : 0);
      setStatus((prev) => ({
        ...prev,
        peripheral_status: {
          ...prev.peripheral_status,
          [name]: value ? 1 : 0,
        },
      }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePwmChange = async (name: string, value: number) => {
    try {
      await manualControl(name, value);
      setStatus((prev) => ({
        ...prev,
        peripheral_status: {
          ...prev.peripheral_status,
          [name]: value,
        },
      }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const [injectionParams, setInjectionParams] = useState({
    pump2: 0, pump3: 0, pump4: 0, pump5: 0, speed: 10, accel: 100
  });
  const [injecting, setInjecting] = useState(false);

  const handleStateChange = async (targetState: "INITIAL" | "DRAIN" | "CLEAN" | "SAMPLE" | "INJECT") => {
    try {
      const result = await apiSetSystemState(targetState);
      // 立即刷新状态而不是依赖本地更新
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRunPump = async (pumpName: string) => {
    try {
      await runPump(pumpName, 50, 100, 100);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStopAllPumps = async () => {
    try {
      await stopAllPumps();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* 标题和连接状态 */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">电子鼻控制面板</h1>
        <div className="flex gap-4">
          <Badge variant={grpcConnected ? "default" : "destructive"}>
            <Activity className="w-4 h-4 mr-1" />
            gRPC: {grpcConnected ? "已连接" : "未连接"}
          </Badge>
          <Badge variant={timeSinceUpdate < 1000 ? "default" : timeSinceUpdate < 3000 ? "secondary" : "destructive"}>
            <RefreshCw className="w-4 h-4 mr-1" />
            {timeSinceUpdate < 1000 ? `${timeSinceUpdate}ms` : `${(timeSinceUpdate / 1000).toFixed(1)}s`}
          </Badge>
          <Badge
            variant={status.moonraker_connected ? "default" : "secondary"}
          >
            Moonraker: {status.moonraker_connected ? "已连接" : "未连接"}
          </Badge>
          <Badge variant={status.sensor_connected ? "default" : "secondary"}>
            传感器: {status.sensor_connected ? "已连接" : "未连接"}
          </Badge>
        </div>
      </div>

      {/* 系统状态切换 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="w-5 h-5" />
            系统状态
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Badge
              variant={
                status.current_state === "INITIAL" ? "default" : "outline"
              }
              className="text-lg px-4 py-2 w-32 text-center justify-center"
            >
              {status.current_state}
            </Badge>
            <Separator orientation="vertical" className="h-8" />
            <Button
              variant={
                status.current_state === "INITIAL" ? "default" : "outline"
              }
              onClick={() => handleStateChange("INITIAL")}
            >
              初始状态
            </Button>
            <Button
              variant={status.current_state === "DRAIN" ? "default" : "outline"}
              onClick={() => handleStateChange("DRAIN")}
            >
              排废状态
            </Button>
            <Button
              variant={status.current_state === "CLEAN" ? "default" : "outline"}
              onClick={() => handleStateChange("CLEAN")}
            >
              清洗状态
            </Button>
            <Button
              variant={status.current_state === "SAMPLE" ? "default" : "outline"}
              onClick={() => handleStateChange("SAMPLE")}
            >
              采样状态
            </Button>
            <Button
              variant={status.current_state === "INJECT" ? "default" : "outline"}
              onClick={() => handleStateChange("INJECT")}
            >
              进样状态
            </Button>
            <Separator orientation="vertical" className="h-8" />
            <Button
              variant="destructive"
              className="bg-red-600 hover:bg-red-700 font-bold"
              disabled={emergencyStopLoading}
              onClick={async () => {
                setEmergencyStopLoading(true);
                try {
                  const res = await fetch('/api/emergency-stop', { method: 'POST' });
                  const data = await res.json();
                  if (!data.success) {
                    setError(data.message);
                  }
                  await refreshStatus();
                } catch (err: any) { setError(err.message); }
                finally { setEmergencyStopLoading(false); }
              }}
            >
              {emergencyStopLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "🚨"} 急停
            </Button>
            {!status.firmware_ready && (
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50 font-bold shrink-0"
                disabled={firmwareRestartLoading}
                onClick={async () => {
                  setFirmwareRestartLoading(true);
                  try {
                    const res = await fetch('/api/firmware-restart', { method: 'POST' });
                    const data = await res.json();
                    if (!data.success) {
                      setError(data.message);
                    }
                    await refreshStatus();
                  } catch (err: any) { setError(err.message); }
                  finally { setFirmwareRestartLoading(false); }
                }}
              >
                {firmwareRestartLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔄"} 重启固件
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 进样控制 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5" />
            进样控制
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label htmlFor="pump2">蠕动泵0 (mm)</Label>
              <Input id="pump2" type="number" value={injectionParams.pump2} onChange={e => setInjectionParams(p => ({...p, pump2: Number(e.target.value)}))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pump3">蠕动泵1 (mm)</Label>
              <Input id="pump3" type="number" value={injectionParams.pump3} onChange={e => setInjectionParams(p => ({...p, pump3: Number(e.target.value)}))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pump4">蠕动泵2 (mm)</Label>
              <Input id="pump4" type="number" value={injectionParams.pump4} onChange={e => setInjectionParams(p => ({...p, pump4: Number(e.target.value)}))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pump5">蠕动泵3 (mm)</Label>
              <Input id="pump5" type="number" value={injectionParams.pump5} onChange={e => setInjectionParams(p => ({...p, pump5: Number(e.target.value)}))} />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label htmlFor="speed">速度 (mm/s)</Label>
              <Input id="speed" type="number" value={injectionParams.speed} onChange={e => setInjectionParams(p => ({...p, speed: Number(e.target.value)}))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="accel">加速度 (mm/s²)</Label>
              <Input id="accel" type="number" value={injectionParams.accel} onChange={e => setInjectionParams(p => ({...p, accel: Number(e.target.value)}))} />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              onClick={async () => {
                if (status.current_state !== "INJECT") {
                  setError("请先切换到进样状态");
                  return;
                }
                setInjecting(true);
                try {
                  await fetch('/api/injection/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      pump2Volume: injectionParams.pump2,
                      pump3Volume: injectionParams.pump3,
                      pump4Volume: injectionParams.pump4,
                      pump5Volume: injectionParams.pump5,
                      speed: injectionParams.speed,
                      accel: injectionParams.accel,
                    })
                  });
                  await refreshStatus();
                } catch (err: any) { setError(err.message); }
                setInjecting(false);
              }}
              disabled={injecting || status.current_state !== "INJECT"}
            >
              开始进样
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await fetch('/api/injection/stop', { method: 'POST' });
                  await refreshStatus();
                } catch (err: any) { setError(err.message); }
              }}
              disabled={status.current_state !== "INJECT"}
            >
              停止进样
            </Button>
            {status.current_state !== "INJECT" && (
              <span className="text-sm text-muted-foreground">← 请先点击"进样状态"按钮</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 实时设备状态面板 */}
      <Card className="bg-slate-50 dark:bg-slate-900">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4" />
            实时设备状态
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-sm">
            <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
              <span>废液阀</span>
              <Badge variant={status.peripheral_status.valve_waste === 1 ? "default" : "secondary"} className="w-10 justify-center">
                {status.peripheral_status.valve_waste === 1 ? "开" : "关"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
              <span>夹管阀</span>
              <Badge variant={status.peripheral_status.valve_pinch === 1 ? "default" : "secondary"} className="w-10 justify-center">
                {status.peripheral_status.valve_pinch === 1 ? "液" : "气"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
              <span>三通阀</span>
              <Badge variant={status.peripheral_status.valve_air === 1 ? "default" : "secondary"} className="w-10 justify-center">
                {status.peripheral_status.valve_air === 1 ? "室" : "排"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
              <span>出气阀</span>
              <Badge variant={status.peripheral_status.valve_outlet === 0 ? "default" : "secondary"} className="w-10 justify-center">
                {status.peripheral_status.valve_outlet === 0 ? "开" : "关"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
              <span>气泵</span>
              <Badge variant={status.peripheral_status.air_pump_pwm > 0 ? "default" : "secondary"} className="w-14 justify-center">
                {Math.round(status.peripheral_status.air_pump_pwm * 100)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
              <span>清洗泵</span>
              <Badge variant={status.peripheral_status.cleaning_pump > 0 ? "default" : "secondary"} className="w-14 justify-center">
                {Math.round(status.peripheral_status.cleaning_pump * 100)}%
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* 阀门控制 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleDot className="w-5 h-5" />
              阀门控制
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span>废液阀</span>
              <Switch
                checked={status.peripheral_status.valve_waste === 1}
                onCheckedChange={(v) => handleValveToggle("valve_waste", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>夹管阀 (液路/气路)</span>
              <Switch
                checked={status.peripheral_status.valve_pinch === 1}
                onCheckedChange={(v) => handleValveToggle("valve_pinch", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>三通气阀 (排气/气室)</span>
              <Switch
                checked={status.peripheral_status.valve_air === 1}
                onCheckedChange={(v) => handleValveToggle("valve_air", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>出气阀</span>
              <Switch
                checked={status.peripheral_status.valve_outlet === 1}
                onCheckedChange={(v) => handleValveToggle("valve_outlet", v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* 气泵和清洗泵 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wind className="w-5 h-5" />
              气泵 / 清洗泵
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>气泵 PWM</span>
                <span className="text-sm text-muted-foreground">
                  {Math.round(status.peripheral_status.air_pump_pwm * 100)}%
                </span>
              </div>
              <Slider
                value={[status.peripheral_status.air_pump_pwm * 100]}
                onValueChange={([v]) => handlePwmChange("air_pump_pwm", v / 100)}
                max={100}
                step={5}
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>清洗泵</span>
                <span className="text-sm text-muted-foreground">
                  {Math.round(status.peripheral_status.cleaning_pump * 100)}%
                </span>
              </div>
              <Slider
                value={[status.peripheral_status.cleaning_pump * 100]}
                onValueChange={([v]) =>
                  handlePwmChange("cleaning_pump", v / 100)
                }
                max={100}
                step={5}
              />
            </div>
          </CardContent>
        </Card>

        {/* 样品泵 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Droplets className="w-5 h-5" />
              样品泵
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(["pump_2", "pump_3", "pump_4", "pump_5"] as const).map(
              (pump, idx) => (
                <div key={pump} className="flex items-center justify-between">
                  <span>样品泵 {idx}</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        status.peripheral_status[pump] === "RUNNING"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {status.peripheral_status[pump]}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRunPump(pump)}
                    >
                      运行
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStopAllPumps()}
                    >
                      停止
                    </Button>
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* 加热器 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Thermometer className="w-5 h-5" />
              加热器
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>气室加热带</span>
                <span className="text-sm text-muted-foreground">
                  {Math.round(status.peripheral_status.heater_chamber * 100)}%
                </span>
              </div>
              <Slider
                value={[status.peripheral_status.heater_chamber * 100]}
                onValueChange={([v]) =>
                  handlePwmChange("heater_chamber", v / 100)
                }
                max={100}
                step={5}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span>当前温度</span>
              <Badge variant="outline">
                {status.peripheral_status.sensor_chamber_temp?.toFixed(1) ??
                  "--"}
                °C
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* 传感器 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5" />
              传感器读数
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Thermometer className="w-4 h-4" />
                <span>气室温度</span>
              </div>
              <Badge variant="outline">
                {status.peripheral_status.sensor_chamber_temp?.toFixed(1) ??
                  "--"}
                °C
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4" />
                <span>称重</span>
              </div>
              <Badge variant="outline">
                {status.peripheral_status.scale_weight?.toFixed(2) ?? "--"} g
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
