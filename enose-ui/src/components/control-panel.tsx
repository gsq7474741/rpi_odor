"use client";

import { useState, useEffect, useCallback } from "react";
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
};

export function ControlPanel() {
  const [status, setStatus] = useState<SystemStatus>(initialStatus);
  const [grpcConnected, setGrpcConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 获取状态
  const refreshStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchStatus();
      setStatus(data);
      setGrpcConnected(true);
    } catch (err: any) {
      setError(err.message);
      setGrpcConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化和轮询
  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 2000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

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

  const handleStateChange = async (targetState: "INITIAL" | "DRAIN" | "CLEAN") => {
    try {
      await apiSetSystemState(targetState);
      setStatus((prev) => ({
        ...prev,
        current_state: targetState,
      }));
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
