"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Pause, RotateCcw, Upload, CheckCircle, AlertCircle, Clock, X, Wifi, WifiOff, FileUp } from "lucide-react";
import { ExperimentFlow, ExperimentProgram, parseYamlString } from "@/components/experiment-flow";

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
// Proto 枚举值是数字: UNSPECIFIED=0, IDLE=1, LOADED=2, RUNNING=3, PAUSED=4, COMPLETING=5, COMPLETED=6, ERROR=7
function mapBackendState(state: number | string): ExperimentStatus {
  // 数字枚举映射
  const numericStateMap: Record<number, ExperimentStatus> = {
    1: "idle",      // EXP_IDLE
    2: "loaded",    // EXP_LOADED
    3: "running",   // EXP_RUNNING
    4: "paused",    // EXP_PAUSED
    5: "running",   // EXP_COMPLETING (显示为运行中)
    6: "completed", // EXP_COMPLETED
    7: "error",     // EXP_ERROR
    8: "running",   // EXP_ABORTING (显示为运行中)
    9: "idle",      // EXP_ABORTED (显示为空闲)
  };
  
  // 字符串枚举映射 (fallback)
  const stringStateMap: Record<string, ExperimentStatus> = {
    EXP_IDLE: "idle",
    EXP_LOADED: "loaded",
    EXP_RUNNING: "running",
    EXP_PAUSED: "paused",
    EXP_COMPLETED: "completed",
    EXP_ERROR: "error",
  };
  
  if (typeof state === 'number') {
    return numericStateMap[state] || "idle";
  }
  return stringStateMap[state] || "idle";
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

// 程序信息接口
interface ProgramInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  filename: string;
}

// 获取内置程序列表
async function fetchBuiltinPrograms(): Promise<ProgramInfo[]> {
  try {
    const res = await fetch("/api/experiment/programs");
    const data = await res.json();
    return data.programs || [];
  } catch {
    return [];
  }
}

// 获取程序 YAML 内容
async function fetchProgramYaml(filename: string): Promise<string> {
  const res = await fetch(`/programs/${filename}`);
  return res.text();
}

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
  const [programs, setPrograms] = useState<ProgramInfo[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [uploadedYaml, setUploadedYaml] = useState<string | null>(null);
  const fileInputRef = { current: null as HTMLInputElement | null };

  // 加载内置程序列表
  useEffect(() => {
    fetchBuiltinPrograms().then(setPrograms);
  }, []);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  // 轮询后端状态
  const pollStatus = useCallback(async () => {
    try {
      const status = await getExperimentStatus();
      console.log('[Experiment] Backend status:', status.state, '->', mapBackendState(status.state));
      if (status.error && !status.connected) {
        setConnected(false);
        return;
      }
      setConnected(true);
      
      const backendState = mapBackendState(status.state);
      
      setExperiment(prev => {
        // 计算总步骤数（从已加载的程序获取，或使用后端返回的值）
        const totalSteps = loadedProgram?.steps.length || prev.totalSteps;
        
        return {
          ...prev,
          status: backendState,
          currentStep: status.currentStepIndex || 0,
          totalSteps: totalSteps,
          elapsedTime: Math.round(status.elapsedS || 0),
          message: status.currentStepName || prev.message,
        };
      });
      
      // 如果实验完成，显示完成消息
      if (backendState === "completed") {
        addLog("实验已完成");
      }
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

  // 处理文件上传
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setUploadedYaml(content);
      setSelectedProgram(null);
      addLog(`已选择文件: ${file.name}`);
    };
    reader.readAsText(file);
  };

  const handleLoadProgram = async () => {
    let yamlContent: string;
    let programName: string;
    
    if (uploadedYaml) {
      yamlContent = uploadedYaml;
      programName = "上传的程序";
    } else if (selectedProgram) {
      const program = programs.find(p => p.id === selectedProgram);
      if (!program) return;
      programName = program.name;
      try {
        yamlContent = await fetchProgramYaml(program.filename);
      } catch (e: any) {
        addLog(`获取程序文件失败: ${e.message}`);
        return;
      }
    } else {
      return;
    }

    addLog(`加载程序: ${programName}`);
    
    // 解析 YAML 为前端程序对象
    const programData = parseYamlString(yamlContent);
    setLoadedProgram(programData);

    try {
      const result = await experimentApi("load", { yaml_content: yamlContent });
      
      if (result.error) {
        addLog(`后端加载失败: ${result.error}`);
      } else {
        addLog("后端加载成功");
        
        // 显示验证结果
        if (result.validation) {
          const { errors, warnings } = result.validation;
          
          // 显示错误
          if (errors && errors.length > 0) {
            for (const err of errors) {
              addLog(`❌ 错误 [${err.path}]: ${err.message}`);
            }
          }
          
          // 显示警告
          if (warnings && warnings.length > 0) {
            for (const warn of warnings) {
              addLog(`⚠️ 警告 [${warn.path}]: ${warn.message}`);
            }
          }
        }
      }
    } catch (e: any) {
      addLog(`后端通信失败: ${e.message}`);
    }

    setExperiment({
      status: "loaded",
      programName: programName,
      currentStep: 0,
      totalSteps: programData.steps.length,
      elapsedTime: 0,
      message: `已加载: ${programName}`,
    });
    
    // 清除上传的文件
    setUploadedYaml(null);
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
              {/* 内置程序列表 */}
              {programs.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  加载内置程序中...
                </div>
              ) : (
                programs.map((program) => (
                  <div
                    key={program.id}
                    onClick={() => {
                      if (experiment.status === "idle") {
                        setSelectedProgram(program.id);
                        setUploadedYaml(null);
                      }
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedProgram === program.id && !uploadedYaml
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    } ${experiment.status !== "idle" ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="font-medium">{program.name}</div>
                      <div className="text-xs text-muted-foreground">v{program.version}</div>
                    </div>
                    <div className="text-sm text-muted-foreground">{program.description}</div>
                  </div>
                ))
              )}
              
              {/* 上传 YAML 文件 */}
              {experiment.status === "idle" && (
                <div className={`p-3 rounded-lg border border-dashed ${uploadedYaml ? "border-primary bg-primary/5" : "border-border"}`}>
                  <input
                    type="file"
                    accept=".yaml,.yml"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="yaml-upload"
                  />
                  <label
                    htmlFor="yaml-upload"
                    className="flex items-center justify-center gap-2 cursor-pointer py-2"
                  >
                    <FileUp className="h-4 w-4" />
                    <span className="text-sm">
                      {uploadedYaml ? "已选择上传文件" : "上传 YAML 文件"}
                    </span>
                  </label>
                </div>
              )}
              
              {experiment.status === "idle" ? (
                <Button
                  onClick={handleLoadProgram}
                  disabled={!selectedProgram && !uploadedYaml}
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
