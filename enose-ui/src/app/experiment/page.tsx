"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Pause, RotateCcw, Upload, CheckCircle, AlertCircle, Clock, X, Wifi, WifiOff } from "lucide-react";
import { ExperimentFlow, ExperimentProgram, parseYamlProgram } from "@/components/experiment-flow";

// API 调用函数
async function experimentApi(action: string, body?: object) {
  const res = await fetch(`/api/experiment?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getExperimentStatus() {
  const res = await fetch("/api/experiment");
  return res.json();
}

// 后端状态映射到前端状态
function mapBackendState(state: string): ExperimentStatus {
  const stateMap: Record<string, ExperimentStatus> = {
    EXP_IDLE: "idle",
    EXP_LOADED: "loaded",
    EXP_RUNNING: "running",
    EXP_PAUSED: "paused",
    EXP_COMPLETED: "completed",
    EXP_ERROR: "error",
  };
  return stateMap[state] || "idle";
}

type ExperimentStatus = "idle" | "loaded" | "running" | "paused" | "completed" | "error";

interface ExperimentState {
  status: ExperimentStatus;
  programName: string | null;
  currentStep: number;
  totalSteps: number;
  elapsedTime: number;
  message: string;
}

const statusConfig: Record<ExperimentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  idle: { label: "空闲", variant: "secondary" },
  loaded: { label: "已加载", variant: "outline" },
  running: { label: "运行中", variant: "default" },
  paused: { label: "已暂停", variant: "outline" },
  completed: { label: "已完成", variant: "secondary" },
  error: { label: "错误", variant: "destructive" },
};

// 原始程序数据 (用于 YAML 序列化)
const rawProgramData: Record<string, any> = {
  apple_juice_standard: {
    id: "apple_juice_standard",
    name: "苹果汁标准采气实验",
    description: "使用标准流程采集苹果汁气味特征",
    version: "1.0.0",
    hardware: {
      bottle_capacity_ml: 150,
      max_fill_ml: 100,
      liquids: [
        { id: "apple_juice", name: "苹果汁", pump_index: 2, type: "LIQUID_SAMPLE" },
        { id: "distilled_water", name: "蒸馏水", pump_index: 3, type: "LIQUID_SAMPLE" },
        { id: "rinse", name: "清洗液", pump_index: 0, type: "LIQUID_RINSE" },
      ],
    },
    steps: [
      { name: "标记进样开始", phase_marker: { phase_name: "DOSE", is_start: true } },
      { name: "进样", inject: { target_volume_ml: 15.0, tolerance: 0.5, flow_rate_ml_min: 5.0 } },
      { name: "标记进样结束", phase_marker: { phase_name: "DOSE", is_start: false } },
      { name: "切换到采样状态", set_state: { state: "STATE_SAMPLE" } },
      { name: "设置气泵低速", set_gas_pump: { pwm_percent: 30 } },
      { name: "平衡等待", wait: { duration_s: 60, timeout_s: 120 } },
      { name: "数据采集", acquire: { gas_pump_pwm: 50, heater_cycles: 10, max_duration_s: 300 } },
      { name: "排废", drain: { gas_pump_pwm: 80, timeout_s: 60 } },
      { name: "恢复初始状态", set_state: { state: "STATE_INITIAL" } },
    ],
  },
  wine_analysis: {
    id: "wine_analysis",
    name: "葡萄酒香气分析",
    description: "葡萄酒香气成分分析流程",
    version: "1.0.0",
    steps: [
      { name: "进样", inject: { target_volume_ml: 10.0 } },
      { name: "平衡等待", wait: { duration_s: 120 } },
      { name: "数据采集", acquire: { heater_cycles: 15, max_duration_s: 600 } },
      { name: "排废", drain: { timeout_s: 60 } },
    ],
  },
  quick_test: {
    id: "quick_test",
    name: "快速测试",
    description: "简单的系统功能验证",
    version: "1.0.0",
    steps: [
      { name: "切换状态", set_state: { state: "STATE_SAMPLE" } },
      { name: "等待", wait: { duration_s: 5 } },
      { name: "恢复", set_state: { state: "STATE_INITIAL" } },
    ],
  },
};

const samplePrograms: Record<string, ExperimentProgram> = {
  apple_juice_standard: parseYamlProgram(rawProgramData.apple_juice_standard),
  wine_analysis: parseYamlProgram(rawProgramData.wine_analysis),
  quick_test: parseYamlProgram(rawProgramData.quick_test),
};

export default function ExperimentPage() {
  const [experiment, setExperiment] = useState<ExperimentState>({
    status: "idle",
    programName: null,
    currentStep: 0,
    totalSteps: 0,
    elapsedTime: 0,
    message: "等待加载实验程序",
  });

  const [loadedProgram, setLoadedProgram] = useState<ExperimentProgram | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const programs = [
    { id: "apple_juice_standard", name: "苹果汁标准检测", description: "标准苹果汁样品检测流程" },
    { id: "wine_analysis", name: "葡萄酒分析", description: "葡萄酒香气成分分析" },
    { id: "quick_test", name: "快速测试", description: "简单的系统功能验证" },
  ];

  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  // 轮询后端状态
  const pollStatus = useCallback(async () => {
    try {
      const status = await getExperimentStatus();
      if (status.error && !status.connected) {
        setConnected(false);
        return;
      }
      setConnected(true);
      
      const backendState = mapBackendState(status.state);
      setExperiment(prev => ({
        ...prev,
        status: backendState,
        currentStep: status.currentStepIndex || 0,
        totalSteps: status.totalSteps || prev.totalSteps,
        elapsedTime: status.elapsedSeconds || 0,
        message: status.currentStepName || prev.message,
      }));
    } catch {
      setConnected(false);
    }
  }, []);

  // 轮询定时器
  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 1000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  // 将程序数据转换为 YAML 字符串
  const programToYaml = (programId: string): string => {
    const data = rawProgramData[programId];
    if (!data) return "";
    
    // 简单的 YAML 序列化
    const lines: string[] = [];
    lines.push(`id: ${data.id}`);
    lines.push(`name: ${data.name}`);
    lines.push(`description: ${data.description || ""}`);
    lines.push(`version: ${data.version}`);
    
    if (data.hardware) {
      lines.push("hardware:");
      lines.push(`  bottle_capacity_ml: ${data.hardware.bottle_capacity_ml}`);
      lines.push(`  max_fill_ml: ${data.hardware.max_fill_ml}`);
      if (data.hardware.liquids) {
        lines.push("  liquids:");
        for (const liq of data.hardware.liquids) {
          lines.push(`    - id: ${liq.id}`);
          lines.push(`      name: ${liq.name}`);
          lines.push(`      pump_index: ${liq.pump_index}`);
          lines.push(`      type: ${liq.type}`);
        }
      }
    }
    
    const formatStep = (step: any, indent: string): void => {
      lines.push(`${indent}- name: ${step.name}`);
      if (step.inject) {
        lines.push(`${indent}  inject:`);
        if (step.inject.target_volume_ml) lines.push(`${indent}    target_volume_ml: ${step.inject.target_volume_ml}`);
        if (step.inject.tolerance) lines.push(`${indent}    tolerance: ${step.inject.tolerance}`);
        if (step.inject.flow_rate_ml_min) lines.push(`${indent}    flow_rate_ml_min: ${step.inject.flow_rate_ml_min}`);
      } else if (step.wait) {
        lines.push(`${indent}  wait:`);
        if (step.wait.duration_s) lines.push(`${indent}    duration_s: ${step.wait.duration_s}`);
        if (step.wait.timeout_s) lines.push(`${indent}    timeout_s: ${step.wait.timeout_s}`);
      } else if (step.drain) {
        lines.push(`${indent}  drain:`);
        if (step.drain.gas_pump_pwm) lines.push(`${indent}    gas_pump_pwm: ${step.drain.gas_pump_pwm}`);
        if (step.drain.timeout_s) lines.push(`${indent}    timeout_s: ${step.drain.timeout_s}`);
      } else if (step.acquire) {
        lines.push(`${indent}  acquire:`);
        if (step.acquire.gas_pump_pwm) lines.push(`${indent}    gas_pump_pwm: ${step.acquire.gas_pump_pwm}`);
        if (step.acquire.heater_cycles) lines.push(`${indent}    heater_cycles: ${step.acquire.heater_cycles}`);
        if (step.acquire.max_duration_s) lines.push(`${indent}    max_duration_s: ${step.acquire.max_duration_s}`);
      } else if (step.set_state) {
        lines.push(`${indent}  set_state:`);
        lines.push(`${indent}    state: ${step.set_state.state}`);
      } else if (step.set_gas_pump) {
        lines.push(`${indent}  set_gas_pump:`);
        lines.push(`${indent}    pwm_percent: ${step.set_gas_pump.pwm_percent}`);
      } else if (step.phase_marker) {
        lines.push(`${indent}  phase_marker:`);
        lines.push(`${indent}    phase_name: ${step.phase_marker.phase_name}`);
        lines.push(`${indent}    is_start: ${step.phase_marker.is_start}`);
      } else if (step.loop) {
        lines.push(`${indent}  loop:`);
        lines.push(`${indent}    count: ${step.loop.count}`);
        lines.push(`${indent}    steps:`);
        for (const subStep of step.loop.steps) {
          formatStep(subStep, indent + "      ");
        }
      }
    };
    
    lines.push("steps:");
    for (const step of data.steps) {
      formatStep(step, "  ");
    }
    
    return lines.join("\n");
  };

  const handleLoadProgram = async () => {
    if (!selectedProgram) return;
    const program = programs.find(p => p.id === selectedProgram);
    const programData = samplePrograms[selectedProgram];
    if (!program || !programData) return;

    addLog(`加载程序: ${program.name}`);
    setLoadedProgram(programData);

    try {
      const yamlContent = programToYaml(selectedProgram);
      const result = await experimentApi("load", { yaml_content: yamlContent });
      
      if (result.error) {
        addLog(`后端加载失败: ${result.error}`);
      } else {
        addLog("后端加载成功");
      }
    } catch (e: any) {
      addLog(`后端通信失败: ${e.message}`);
    }

    setExperiment({
      status: "loaded",
      programName: program.name,
      currentStep: 0,
      totalSteps: programData.steps.length,
      elapsedTime: 0,
      message: `已加载: ${program.name}`,
    });
  };

  const handleStart = async () => {
    addLog("启动实验");
    try {
      const result = await experimentApi("start");
      if (result.error) {
        addLog(`启动失败: ${result.error}`);
        return;
      }
      addLog("实验已启动");
      setExperiment(prev => ({
        ...prev,
        status: "running",
        message: "实验正在运行...",
      }));
    } catch (e: any) {
      addLog(`启动失败: ${e.message}`);
    }
  };

  const handlePause = async () => {
    addLog("暂停实验");
    try {
      await experimentApi("pause");
      setExperiment(prev => ({
        ...prev,
        status: "paused",
        message: "实验已暂停",
      }));
    } catch (e: any) {
      addLog(`暂停失败: ${e.message}`);
    }
  };

  const handleResume = async () => {
    addLog("恢复实验");
    try {
      await experimentApi("resume");
      setExperiment(prev => ({
        ...prev,
        status: "running",
        message: "实验继续运行...",
      }));
    } catch (e: any) {
      addLog(`恢复失败: ${e.message}`);
    }
  };

  const handleStop = async () => {
    addLog("停止实验");
    try {
      await experimentApi("stop");
    } catch (e: any) {
      addLog(`停止失败: ${e.message}`);
    }
    setExperiment(prev => ({
      ...prev,
      status: "idle",
      programName: null,
      currentStep: 0,
      totalSteps: 0,
      message: "实验已停止",
    }));
    setSelectedProgram(null);
    setLoadedProgram(null);
  };

  const handleUnload = async () => {
    addLog("卸载程序");
    try {
      await experimentApi("stop");
    } catch {
      // ignore
    }
    setExperiment({
      status: "idle",
      programName: null,
      currentStep: 0,
      totalSteps: 0,
      elapsedTime: 0,
      message: "程序已卸载",
    });
    setSelectedProgram(null);
    setLoadedProgram(null);
  };

  const canStart = experiment.status === "loaded";
  const canPause = experiment.status === "running";
  const canResume = experiment.status === "paused";
  const canStop = experiment.status === "running" || experiment.status === "paused" || experiment.status === "loaded";

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">实验管理</h1>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 左侧：程序选择和控制 */}
        <div className="space-y-6">
          {/* 实验程序选择 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">实验程序</CardTitle>
              <CardDescription>选择要执行的实验程序</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {programs.map((program) => (
                <div
                  key={program.id}
                  onClick={() => experiment.status === "idle" && setSelectedProgram(program.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedProgram === program.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  } ${experiment.status !== "idle" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="font-medium">{program.name}</div>
                  <div className="text-sm text-muted-foreground">{program.description}</div>
                </div>
              ))}
              {experiment.status === "idle" ? (
                <Button
                  onClick={handleLoadProgram}
                  disabled={!selectedProgram}
                  className="w-full mt-4"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  加载程序
                </Button>
              ) : (
                <Button
                  onClick={handleUnload}
                  variant="outline"
                  className="w-full mt-4"
                  disabled={experiment.status === "running"}
                >
                  <X className="mr-2 h-4 w-4" />
                  卸载程序
                </Button>
              )}
            </CardContent>
          </Card>

          {/* 实验状态和控制 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  状态
                  <Badge variant={statusConfig[experiment.status].variant}>
                    {statusConfig[experiment.status].label}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {experiment.programName ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">步骤</span>
                      <span className="font-medium">{experiment.currentStep} / {experiment.totalSteps}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">时间</span>
                      <span className="font-medium">{Math.floor(experiment.elapsedTime / 60)}:{String(experiment.elapsedTime % 60).padStart(2, '0')}</span>
                    </div>
                    {experiment.totalSteps > 0 && (
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${(experiment.currentStep / experiment.totalSteps) * 100}%` }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{experiment.message}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">控制</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handleStart}
                  disabled={!canStart}
                  className="w-full"
                  variant="default"
                >
                  <Play className="mr-2 h-4 w-4" />
                  开始
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={canPause ? handlePause : handleResume}
                    disabled={!canPause && !canResume}
                    variant="outline"
                    size="sm"
                  >
                    {canResume ? <><RotateCcw className="mr-1 h-4 w-4" />继续</> : <><Pause className="mr-1 h-4 w-4" />暂停</>}
                  </Button>
                  <Button
                    onClick={handleStop}
                    disabled={!canStop}
                    variant="destructive"
                    size="sm"
                  >
                    <Square className="mr-1 h-4 w-4" />
                    停止
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 实验日志 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                实验日志
                <div className="flex items-center gap-1 text-xs font-normal">
                  {connected ? (
                    <><Wifi className="h-3 w-3 text-green-500" /><span className="text-green-600">已连接</span></>
                  ) : (
                    <><WifiOff className="h-3 w-3 text-red-500" /><span className="text-red-600">未连接</span></>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48 bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-auto flex flex-col-reverse">
                <div className="space-y-1">
                  {logs.length === 0 ? (
                    <div className="text-muted-foreground">等待操作...</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className={
                        log.includes("失败") || log.includes("错误") ? "text-red-600" :
                        log.includes("成功") || log.includes("启动") ? "text-green-600" :
                        log.includes("加载") ? "text-blue-600" :
                        "text-muted-foreground"
                      }>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：流程图 */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-lg">程序流程</CardTitle>
            <CardDescription>
              {loadedProgram ? "已加载程序的执行流程" : "加载程序后显示流程图"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadedProgram ? (
              <ExperimentFlow
                program={loadedProgram}
                currentStep={experiment.status === "running" ? experiment.currentStep : undefined}
              />
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                <div className="text-center">
                  <Upload className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>请先选择并加载实验程序</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
