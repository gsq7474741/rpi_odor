"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scale, Target, Settings, RefreshCw, Check, X, Loader2 } from "lucide-react";

// API 调用函数 (通过 Next.js API 路由)
async function getLoadCellReading() {
  const res = await fetch("/api/load-cell/reading");
  if (!res.ok) throw new Error("Failed to get reading");
  return res.json();
}

async function startLoadCellCalibration() {
  const res = await fetch("/api/load-cell/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  if (!res.ok) throw new Error("Failed to start calibration");
  return res.json();
}

async function setZeroPoint() {
  const res = await fetch("/api/load-cell/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "zero" }),
  });
  if (!res.ok) throw new Error("Failed to set zero point");
  return res.json();
}

async function setReferenceWeight(weightGrams: number) {
  const res = await fetch("/api/load-cell/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reference", weightGrams }),
  });
  if (!res.ok) throw new Error("Failed to set reference weight");
  return res.json();
}

async function saveCalibration() {
  const res = await fetch("/api/load-cell/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save" }),
  });
  if (!res.ok) throw new Error("Failed to save calibration");
  return res.json();
}

async function cancelCalibration() {
  await fetch("/api/load-cell/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
}

async function getLoadCellConfig() {
  const res = await fetch("/api/load-cell/config");
  if (!res.ok) throw new Error("Failed to get config");
  return res.json();
}

async function saveLoadCellConfig(config: any) {
  const res = await fetch("/api/load-cell/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", config }),
  });
  if (!res.ok) throw new Error("Failed to save config");
  return res.json();
}

async function setEmptyBottleBaseline() {
  const res = await fetch("/api/load-cell/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setEmptyBottle" }),
  });
  if (!res.ok) throw new Error("Failed to set empty bottle baseline");
  return res.json();
}

async function tareLoadCell() {
  const res = await fetch("/api/load-cell/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "tare" }),
  });
  if (!res.ok) throw new Error("Failed to tare");
  return res.json();
}

type CalibrationStep = "idle" | "zero_point" | "reference_weight" | "verify" | "complete";

interface LoadCellReading {
  weightGrams: number;
  rawPercent: number;
  isCalibrated: boolean;
  isStable: boolean;
  trend: number;
}

interface LoadCellConfig {
  emptyBottleWeight: number;
  overflowThreshold: number;
  drainCompleteMargin: number;
  stableThreshold: number;
}

export function LoadCellPanel() {
  // 实时读数
  const [reading, setReading] = useState<LoadCellReading | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // 硬件标定状态
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>("idle");
  const [calibrationMessage, setCalibrationMessage] = useState("");
  const [referenceWeight, setReferenceWeightValue] = useState("100");
  const [isCalibrating, setIsCalibrating] = useState(false);

  // 业务配置
  const [config, setConfig] = useState<LoadCellConfig>({
    emptyBottleWeight: 0,
    overflowThreshold: 500,
    drainCompleteMargin: 5,
    stableThreshold: 2,
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await getLoadCellConfig();
      setConfig({
        emptyBottleWeight: cfg.emptyBottleWeight,
        overflowThreshold: cfg.overflowThreshold,
        drainCompleteMargin: cfg.drainCompleteMargin,
        stableThreshold: cfg.stableThreshold,
      });
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  };

  // 轮询读数
  const pollReading = useCallback(async () => {
    try {
      const r = await getLoadCellReading();
      setReading({
        weightGrams: r.weightGrams,
        rawPercent: r.rawPercent,
        isCalibrated: r.isCalibrated,
        isStable: r.isStable,
        trend: r.trend,
      });
    } catch (error) {
      console.error("Failed to get reading:", error);
    }
  }, []);

  useEffect(() => {
    if (isPolling) {
      const interval = setInterval(pollReading, 500);
      return () => clearInterval(interval);
    }
  }, [isPolling, pollReading]);

  // ============================================================
  // 硬件标定流程
  // ============================================================

  const handleStartCalibration = async () => {
    setIsCalibrating(true);
    try {
      const status = await startLoadCellCalibration();
      setCalibrationStep("zero_point");
      setCalibrationMessage(status.message || "请移除悬臂上的所有物体，然后点击「设置零点」");
      setIsPolling(true);
    } catch (error) {
      setCalibrationMessage(`启动标定失败: ${error}`);
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleSetZeroPoint = async () => {
    setIsCalibrating(true);
    try {
      const status = await setZeroPoint();
      setCalibrationStep("reference_weight");
      setCalibrationMessage(status.message || "零点已设置。请放置已知重量的物体，输入重量后点击「确认标定」");
    } catch (error) {
      setCalibrationMessage(`设置零点失败: ${error}`);
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleSetReferenceWeight = async () => {
    const weight = parseFloat(referenceWeight);
    if (isNaN(weight) || weight <= 0) {
      setCalibrationMessage("请输入有效的重量值（大于0）");
      return;
    }

    setIsCalibrating(true);
    try {
      const status = await setReferenceWeight(weight);
      setCalibrationStep("verify");
      setCalibrationMessage(status.message || "标定完成，请验证读数。点击「保存」确认或「重新标定」");
    } catch (error) {
      setCalibrationMessage(`设置参考重量失败: ${error}`);
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleSaveCalibration = async () => {
    setIsCalibrating(true);
    try {
      const result = await saveCalibration();
      setCalibrationStep("complete");
      setCalibrationMessage(result.message || "标定已保存！");
      setTimeout(() => {
        setCalibrationStep("idle");
        setCalibrationMessage("");
      }, 3000);
    } catch (error) {
      setCalibrationMessage(`保存标定失败: ${error}`);
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleCancelCalibration = async () => {
    try {
      await cancelCalibration();
    } catch (error) {
      console.error("Cancel error:", error);
    }
    setCalibrationStep("idle");
    setCalibrationMessage("");
    setIsPolling(false);
  };

  // ============================================================
  // 业务配置
  // ============================================================

  const handleSetEmptyBottle = async () => {
    try {
      const reading = await setEmptyBottleBaseline();
      setConfig((prev) => ({ ...prev, emptyBottleWeight: reading.weightGrams }));
      alert(`空瓶基准已设置为 ${reading.weightGrams.toFixed(1)}g`);
    } catch (error) {
      alert(`设置失败: ${error}`);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      await saveLoadCellConfig(config as any);
      alert("配置已保存");
    } catch (error) {
      alert(`保存失败: ${error}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleTare = async () => {
    try {
      await tareLoadCell();
      pollReading();
    } catch (error) {
      alert(`去皮失败: ${error}`);
    }
  };

  // ============================================================
  // 渲染
  // ============================================================

  const getTrendIcon = (trend: number) => {
    if (trend === 1) return "↑";
    if (trend === 2) return "↓";
    return "—";
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          称重传感器
        </CardTitle>
        <CardDescription>HX711 称重传感器标定与监测</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="monitor" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="monitor">实时监测</TabsTrigger>
            <TabsTrigger value="calibration">硬件标定</TabsTrigger>
            <TabsTrigger value="config">业务配置</TabsTrigger>
          </TabsList>

          {/* 实时监测 */}
          <TabsContent value="monitor" className="space-y-4">
            <div className="flex items-center justify-between">
              <Button
                variant={isPolling ? "destructive" : "default"}
                onClick={() => setIsPolling(!isPolling)}
              >
                {isPolling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    停止
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    开始监测
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleTare}>
                <Target className="mr-2 h-4 w-4" />
                去皮
              </Button>
            </div>

            {reading && (
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">当前重量</div>
                  <div className="text-3xl font-bold">
                    {reading.isCalibrated ? `${reading.weightGrams.toFixed(1)}g` : "---"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    原始值: {reading.rawPercent.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">状态:</span>
                    <Badge variant={reading.isCalibrated ? "default" : "destructive"}>
                      {reading.isCalibrated ? "已标定" : "未标定"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">稳定:</span>
                    <Badge variant={reading.isStable ? "default" : "secondary"}>
                      {reading.isStable ? "稳定" : "变化中"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">趋势:</span>
                    <span className="text-lg">{getTrendIcon(reading.trend)}</span>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 硬件标定 */}
          <TabsContent value="calibration" className="space-y-4">
            {calibrationMessage && (
              <div className="rounded-lg border bg-muted p-3 text-sm">
                {calibrationMessage}
              </div>
            )}

            {calibrationStep === "idle" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  硬件标定用于校准传感器的零点和增益。标定结果会保存到 Klipper 配置文件中。
                </p>
                <Button onClick={handleStartCalibration} disabled={isCalibrating}>
                  {isCalibrating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  开始标定
                </Button>
              </div>
            )}

            {calibrationStep === "zero_point" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium mb-2">步骤 1: 设置零点</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    请确保悬臂上没有任何物体，然后点击下方按钮。
                  </p>
                  {reading && (
                    <div className="text-sm mb-2">
                      当前原始值: <strong>{reading.rawPercent.toFixed(2)}%</strong>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSetZeroPoint} disabled={isCalibrating}>
                    {isCalibrating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Check className="mr-2 h-4 w-4" />
                    设置零点
                  </Button>
                  <Button variant="outline" onClick={handleCancelCalibration}>
                    <X className="mr-2 h-4 w-4" />
                    取消
                  </Button>
                </div>
              </div>
            )}

            {calibrationStep === "reference_weight" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium mb-2">步骤 2: 设置参考重量</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    请放置一个已知重量的物体到悬臂上，输入其精确重量（克）。
                  </p>
                  {reading && (
                    <div className="text-sm mb-2">
                      当前原始值: <strong>{reading.rawPercent.toFixed(2)}%</strong>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="refWeight">参考重量 (g):</Label>
                  <Input
                    id="refWeight"
                    type="number"
                    value={referenceWeight}
                    onChange={(e) => setReferenceWeightValue(e.target.value)}
                    className="w-32"
                    step="0.1"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSetReferenceWeight} disabled={isCalibrating}>
                    {isCalibrating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Check className="mr-2 h-4 w-4" />
                    确认标定
                  </Button>
                  <Button variant="outline" onClick={handleCancelCalibration}>
                    <X className="mr-2 h-4 w-4" />
                    取消
                  </Button>
                </div>
              </div>
            )}

            {calibrationStep === "verify" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium mb-2">步骤 3: 验证标定</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    请检查读数是否与参考重量一致。如果正确，点击保存；否则重新标定。
                  </p>
                  {reading && (
                    <div className="text-lg">
                      当前读数: <strong>{reading.weightGrams.toFixed(1)}g</strong>
                      <span className="text-sm text-muted-foreground ml-2">
                        (期望: {referenceWeight}g)
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveCalibration} disabled={isCalibrating}>
                    {isCalibrating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Check className="mr-2 h-4 w-4" />
                    保存标定
                  </Button>
                  <Button variant="outline" onClick={handleStartCalibration}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    重新标定
                  </Button>
                  <Button variant="ghost" onClick={handleCancelCalibration}>
                    <X className="mr-2 h-4 w-4" />
                    取消
                  </Button>
                </div>
              </div>
            )}

            {calibrationStep === "complete" && (
              <div className="rounded-lg bg-green-50 border-green-200 border p-4">
                <div className="flex items-center gap-2 text-green-700">
                  <Check className="h-5 w-5" />
                  <span className="font-medium">标定完成！</span>
                </div>
              </div>
            )}
          </TabsContent>

          {/* 业务配置 */}
          <TabsContent value="config" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              业务配置用于设置空瓶基准、溢出阈值等运行时参数。
            </p>

            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  空瓶基准
                </h4>
                <div className="flex items-center gap-4">
                  <div>
                    当前值: <strong>{config.emptyBottleWeight.toFixed(1)}g</strong>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleSetEmptyBottle}>
                    设置为当前重量
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  阈值设置
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="overflow">溢出阈值 (g)</Label>
                    <Input
                      id="overflow"
                      type="number"
                      value={config.overflowThreshold}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          overflowThreshold: parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="drain">排空余量 (g)</Label>
                    <Input
                      id="drain"
                      type="number"
                      value={config.drainCompleteMargin}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          drainCompleteMargin: parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="stable">稳定阈值 (g)</Label>
                    <Input
                      id="stable"
                      type="number"
                      value={config.stableThreshold}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          stableThreshold: parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              <Button onClick={handleSaveConfig} disabled={isSavingConfig}>
                {isSavingConfig && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存配置
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
