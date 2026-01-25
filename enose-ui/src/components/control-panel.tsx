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
  setSystemState as apiSetSystemState,
  manualControl,
  runPump,
  stopAllPumps,
  type SystemStatus,
} from "@/lib/api";
import { useStatusStream } from "@/hooks/use-status-stream";

// 状态枚举常量
const STATE_NAMES: Record<number, string> = {
  0: "UNSPECIFIED", 1: "INITIAL", 2: "DRAIN", 3: "CLEAN", 4: "SAMPLE", 5: "INJECT"
};

// 初始状态
const initialStatus: SystemStatus = {
  currentState: 0,
  peripheralStatus: {
    valveWaste: 0,
    valvePinch: 0,
    valveAir: 0,
    valveOutlet: 0,
    airPumpPwm: 0,
    cleaningPump: 0,
    pump0: 1,
    pump1: 1,
    pump2: 1,
    pump3: 1,
    pump4: 1,
    pump5: 1,
    pump6: 1,
    pump7: 1,
    heaterChamber: 0,
    sensorChamberTemp: undefined,
    scaleWeight: undefined,
  },
  moonrakerConnected: false,
  sensorConnected: false,
  firmwareReady: true,
};

export function ControlPanel() {
  // 使用 SSE 获取状态
  const { status: streamStatus, connected: grpcConnected, lastUpdate: lastUpdateTime, error: streamError, refreshStatus } = useStatusStream();
  const [status, setStatus] = useState<SystemStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [timeSinceUpdate, setTimeSinceUpdate] = useState<number>(0);
  const [emergencyStopLoading, setEmergencyStopLoading] = useState(false);
  const [firmwareRestartLoading, setFirmwareRestartLoading] = useState(false);

  // 同步 SSE 状态到本地状态
  useEffect(() => {
    if (streamStatus) {
      setStatus(streamStatus);
    }
  }, [streamStatus]);

  // 同步 SSE 错误
  useEffect(() => {
    if (streamError) {
      setError(streamError);
    } else {
      setError(null);
    }
  }, [streamError]);

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
        peripheralStatus: {
          ...prev.peripheralStatus,
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
        peripheralStatus: {
          ...prev.peripheralStatus,
          [name]: value,
        },
      }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const [injectionParams, setInjectionParams] = useState({
    pump0: 0, pump1: 0, pump2: 0, pump3: 0, pump4: 0, pump5: 0, pump6: 0, pump7: 0, speed: 10, accel: 100
  });
  const [injecting, setInjecting] = useState(false);
  const [injectionUnit, setInjectionUnit] = useState<'mm' | 'g'>('mm');

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
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Power className="w-5 h-5" />
            外设控制
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={grpcConnected ? "default" : "destructive"} className="text-xs">
              gRPC {grpcConnected ? "✓" : "✗"}
            </Badge>
            <Badge variant={timeSinceUpdate < 1000 ? "outline" : "destructive"} className="text-xs font-mono">
              {timeSinceUpdate < 1000 ? `${timeSinceUpdate}ms` : `${(timeSinceUpdate / 1000).toFixed(1)}s`}
            </Badge>
            <Badge variant={status.moonrakerConnected ? "outline" : "secondary"} className="text-xs">
              Moonraker {status.moonrakerConnected ? "✓" : "✗"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 系统状态切换 */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Power className="w-4 h-4" />
              系统状态
            </h4>
            <Badge variant="outline" className="font-mono px-3">
              {STATE_NAMES[status.currentState]}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={STATE_NAMES[status.currentState] === "INITIAL" ? "default" : "outline"}
              onClick={() => handleStateChange("INITIAL")}
            >
              初始
            </Button>
            <Button
              size="sm"
              variant={STATE_NAMES[status.currentState] === "DRAIN" ? "default" : "outline"}
              onClick={() => handleStateChange("DRAIN")}
            >
              排废
            </Button>
            <Button
              size="sm"
              variant={STATE_NAMES[status.currentState] === "CLEAN" ? "default" : "outline"}
              onClick={() => handleStateChange("CLEAN")}
            >
              清洗
            </Button>
            <Button
              size="sm"
              variant={STATE_NAMES[status.currentState] === "SAMPLE" ? "default" : "outline"}
              onClick={() => handleStateChange("SAMPLE")}
            >
              采样
            </Button>
            <Button
              size="sm"
              variant={STATE_NAMES[status.currentState] === "INJECT" ? "default" : "outline"}
              onClick={() => handleStateChange("INJECT")}
            >
              进样
            </Button>
          </div>
        </div>

        {/* 进样控制 */}
        <div className="rounded-lg border p-4 space-y-3">
          <h4 className="font-medium flex items-center gap-2 text-sm">
            <Droplets className="w-4 h-4" />
            进样控制
            {STATE_NAMES[status.currentState] !== "INJECT" && (
              <span className="text-xs text-muted-foreground font-normal">（需先切换到进样状态）</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant={injectionUnit === 'mm' ? 'default' : 'outline'}
                className="h-6 px-2 text-xs"
                onClick={() => setInjectionUnit('mm')}
              >
                mm
              </Button>
              <Button
                size="sm"
                variant={injectionUnit === 'g' ? 'default' : 'outline'}
                className="h-6 px-2 text-xs"
                onClick={() => setInjectionUnit('g')}
              >
                g
              </Button>
            </div>
          </h4>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">泵0 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump0} onChange={e => setInjectionParams(p => ({...p, pump0: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵1 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump1} onChange={e => setInjectionParams(p => ({...p, pump1: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵2 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump2} onChange={e => setInjectionParams(p => ({...p, pump2: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵3 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump3} onChange={e => setInjectionParams(p => ({...p, pump3: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵4 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump4} onChange={e => setInjectionParams(p => ({...p, pump4: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵5 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump5} onChange={e => setInjectionParams(p => ({...p, pump5: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵6 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump6} onChange={e => setInjectionParams(p => ({...p, pump6: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">泵7 ({injectionUnit})</Label>
              <Input className="h-8" type="number" value={injectionParams.pump7} onChange={e => setInjectionParams(p => ({...p, pump7: Number(e.target.value)}))} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">速度 (mm/s)</Label>
              <Input className="h-8" type="number" value={injectionParams.speed} onChange={e => setInjectionParams(p => ({...p, speed: Number(e.target.value)}))} />
            </div>
            <div>
              <Label className="text-xs">加速度</Label>
              <Input className="h-8" type="number" value={injectionParams.accel} onChange={e => setInjectionParams(p => ({...p, accel: Number(e.target.value)}))} />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={async () => {
                  if (STATE_NAMES[status.currentState] !== "INJECT") {
                    setError("请先切换到进样状态");
                    return;
                  }
                  setInjecting(true);
                  try {
                    if (injectionUnit === 'mm') {
                      await fetch('/api/injection/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          pump0Volume: injectionParams.pump0,
                          pump1Volume: injectionParams.pump1,
                          pump2Volume: injectionParams.pump2,
                          pump3Volume: injectionParams.pump3,
                          pump4Volume: injectionParams.pump4,
                          pump5Volume: injectionParams.pump5,
                          pump6Volume: injectionParams.pump6,
                          pump7Volume: injectionParams.pump7,
                          speed: injectionParams.speed,
                          accel: injectionParams.accel,
                        })
                      });
                    } else {
                      await fetch('/api/injection/start-by-weight', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          pump0Weight: injectionParams.pump0,
                          pump1Weight: injectionParams.pump1,
                          pump2Weight: injectionParams.pump2,
                          pump3Weight: injectionParams.pump3,
                          pump4Weight: injectionParams.pump4,
                          pump5Weight: injectionParams.pump5,
                          pump6Weight: injectionParams.pump6,
                          pump7Weight: injectionParams.pump7,
                          speed: injectionParams.speed,
                          accel: injectionParams.accel,
                        })
                      });
                    }
                    await refreshStatus();
                  } catch (err: any) { setError(err.message); }
                  setInjecting(false);
                }}
                disabled={injecting || STATE_NAMES[status.currentState] !== "INJECT"}
              >
                开始进样
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  try {
                    await fetch('/api/injection/stop', { method: 'POST' });
                    await refreshStatus();
                  } catch (err: any) { setError(err.message); }
                }}
                disabled={STATE_NAMES[status.currentState] !== "INJECT"}
              >
                停止
              </Button>
            </div>
          </div>
        </div>

        {/* 实时设备状态 */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <h4 className="font-medium flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4" />
            实时设备状态
          </h4>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            <div className="flex items-center justify-between p-2 bg-background rounded border">
              <span>废液阀</span>
              <Badge variant={status.peripheralStatus.valveWaste === 1 ? "default" : "secondary"} className="text-xs px-1.5">
                {status.peripheralStatus.valveWaste === 1 ? "开" : "关"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-background rounded border">
              <span>夹管阀</span>
              <Badge variant={status.peripheralStatus.valvePinch === 1 ? "default" : "secondary"} className="text-xs px-1.5">
                {status.peripheralStatus.valvePinch === 1 ? "液" : "气"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-background rounded border">
              <span>三通阀</span>
              <Badge variant={status.peripheralStatus.valveAir === 1 ? "default" : "secondary"} className="text-xs px-1.5">
                {status.peripheralStatus.valveAir === 1 ? "室" : "排"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-background rounded border">
              <span>出气阀</span>
              <Badge variant={status.peripheralStatus.valveOutlet === 0 ? "default" : "secondary"} className="text-xs px-1.5">
                {status.peripheralStatus.valveOutlet === 0 ? "开" : "关"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-background rounded border">
              <span>气泵</span>
              <Badge variant={status.peripheralStatus.airPumpPwm > 0 ? "default" : "secondary"} className="text-xs px-1.5 font-mono">
                {Math.round(status.peripheralStatus.airPumpPwm * 100)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-background rounded border">
              <span>清洗泵</span>
              <Badge variant={status.peripheralStatus.cleaningPump > 0 ? "default" : "secondary"} className="text-xs px-1.5 font-mono">
                {Math.round(status.peripheralStatus.cleaningPump * 100)}%
              </Badge>
            </div>
          </div>
        </div>

        {/* 手动控制区域 - 三列布局 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 阀门控制 */}
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <CircleDot className="w-4 h-4" />
              阀门控制
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>废液阀</span>
                <Switch
                  checked={status.peripheralStatus.valveWaste === 1}
                  onCheckedChange={(v) => handleValveToggle("valve_waste", v)}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>夹管阀</span>
                <Switch
                  checked={status.peripheralStatus.valvePinch === 1}
                  onCheckedChange={(v) => handleValveToggle("valve_pinch", v)}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>三通阀</span>
                <Switch
                  checked={status.peripheralStatus.valveAir === 1}
                  onCheckedChange={(v) => handleValveToggle("valve_air", v)}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>出气阀</span>
                <Switch
                  checked={status.peripheralStatus.valveOutlet === 1}
                  onCheckedChange={(v) => handleValveToggle("valve_outlet", v)}
                />
              </div>
            </div>
          </div>

          {/* 气泵和清洗泵 */}
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Wind className="w-4 h-4" />
              气泵 / 清洗泵
            </h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>气泵 PWM</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {Math.round(status.peripheralStatus.airPumpPwm * 100)}%
                  </span>
                </div>
                <Slider
                  value={[status.peripheralStatus.airPumpPwm * 100]}
                  onValueChange={([v]) => handlePwmChange("air_pump_pwm", v / 100)}
                  max={100}
                  step={5}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>清洗泵</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {Math.round(status.peripheralStatus.cleaningPump * 100)}%
                  </span>
                </div>
                <Slider
                  value={[status.peripheralStatus.cleaningPump * 100]}
                  onValueChange={([v]) => handlePwmChange("cleaning_pump", v / 100)}
                  max={100}
                  step={5}
                />
              </div>
            </div>
          </div>

          {/* 样品泵 */}
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Droplets className="w-4 h-4" />
              样品泵
            </h4>
            <div className="space-y-2">
              {(["pump0", "pump1", "pump2", "pump3", "pump4", "pump5", "pump6", "pump7"] as const).map(
                (pump, idx) => (
                  <div key={pump} className="flex items-center justify-between text-sm">
                    <span>泵 {idx}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={status.peripheralStatus[pump] === 2 ? "default" : "secondary"}
                        className="text-xs w-16 justify-center"
                      >
                        {status.peripheralStatus[pump] === 2 ? "运行中" : "停止"}
                      </Badge>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => handleRunPump(`pump_${idx}`)}>
                        运行
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => handleStopAllPumps()}>
                        停止
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* 加热器和传感器 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Thermometer className="w-4 h-4" />
              加热器
            </h4>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>气室加热带</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {Math.round(status.peripheralStatus.heaterChamber * 100)}%
                </span>
              </div>
              <Slider
                value={[status.peripheralStatus.heaterChamber * 100]}
                onValueChange={([v]) => handlePwmChange("heater_chamber", v / 100)}
                max={100}
                step={5}
              />
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t">
              <span>当前温度</span>
              <Badge variant="outline" className="font-mono">
                {status.peripheralStatus.sensorChamberTemp?.toFixed(1) ?? "--"}°C
              </Badge>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm">
              <Gauge className="w-4 h-4" />
              传感器读数
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Thermometer className="w-3.5 h-3.5" />
                  <span>气室温度</span>
                </div>
                <Badge variant="outline" className="font-mono">
                  {status.peripheralStatus.sensorChamberTemp?.toFixed(1) ?? "--"}°C
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Scale className="w-3.5 h-3.5" />
                  <span>称重</span>
                </div>
                <Badge variant="outline" className="font-mono">
                  {status.peripheralStatus.scaleWeight?.toFixed(2) ?? "--"} g
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
