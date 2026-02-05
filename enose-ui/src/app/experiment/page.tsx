"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Pause, RotateCcw, Upload, CheckCircle, AlertCircle, Clock, X, Wifi, WifiOff, FileUp, Edit, MoreHorizontal, Eye, FolderOpen } from "lucide-react";
import Link from "next/link";
import { ExperimentFlow, ExperimentProgram, parseYamlString } from "@/components/experiment-flow";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";

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

// 格式化时间为 h:mm:ss.s 格式
function formatElapsedTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sStr = s.toFixed(1).padStart(4, '0');
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${sStr}`;
  }
  return `${m}:${sStr}`;
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
  
  // 动态计时器状态
  const [displayTime, setDisplayTime] = useState(0);
  const lastSyncTimeRef = useRef<number>(0);  // 上次同步的后端时间
  const lastSyncLocalRef = useRef<number>(Date.now());  // 上次同步的本地时间戳

  // 动态计时器 - 每 100ms 更新一次
  useEffect(() => {
    if (experiment.status !== "running") {
      // 非运行状态直接显示后端返回的时间
      setDisplayTime(experiment.elapsedTime);
      return;
    }
    
    // 运行中时，基于后端时间 + 本地增量
    const interval = setInterval(() => {
      const localElapsed = (Date.now() - lastSyncLocalRef.current) / 1000;
      setDisplayTime(lastSyncTimeRef.current + localElapsed);
    }, 100);
    
    return () => clearInterval(interval);
  }, [experiment.status, experiment.elapsedTime]);

  // 加载内置程序列表
  useEffect(() => {
    fetchBuiltinPrograms().then(setPrograms);
  }, []);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  // 追踪上一次状态，用于检测状态变化
  const lastStatusRef = useRef<ExperimentStatus>("idle");
  
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
        
        // 计算当前步骤显示值
        let currentStep = status.currentStepIndex || 0;
        if (backendState === "completed" && totalSteps > 0) {
          // 完成时显示完整步骤数
          currentStep = totalSteps;
        } else if (backendState === "running" || backendState === "paused") {
          // 运行中/暂停时，后端返回的是 0-indexed，显示时 +1 更直观
          currentStep = currentStep + 1;
        } else {
          // idle/loaded/error 状态显示 0
          currentStep = 0;
        }
        
        // 保留 programName（后端不返回，需要从前端状态保留）
        const programName = status.programId || prev.programName;
        
        // 完成状态保留最后的时间，不被后端的 0 覆盖
        const elapsedTime = backendState === "completed" 
          ? (status.elapsedS || prev.elapsedTime)  // 完成时优先用后端值，若为0则保留前端值
          : (status.elapsedS || 0);
        
        return {
          ...prev,
          status: backendState,
          programName: programName,
          currentStep: currentStep,
          totalSteps: totalSteps,
          elapsedTime: elapsedTime,
          message: status.currentStepName || prev.message,
        };
      });
      
      // 同步计时器基准时间
      lastSyncTimeRef.current = status.elapsedS || 0;
      lastSyncLocalRef.current = Date.now();
      
      // 只在状态从非完成变为完成时添加日志（避免重复）
      if (backendState === "completed" && lastStatusRef.current !== "completed") {
        addLog("实验已完成");
      }
      lastStatusRef.current = backendState;
    } catch {
      setConnected(false);
    }
  }, [addLog, loadedProgram]);

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

  // 加载程序（可以直接传入 filename）
  const loadProgramByFilename = async (filename: string) => {
    const program = programs.find(p => p.filename === filename);
    if (!program) return;
    
    const programName = program.name;
    let yamlContent: string;
    
    try {
      yamlContent = await fetchProgramYaml(filename);
    } catch (e: any) {
      addLog(`获取程序文件失败: ${e.message}`);
      return;
    }
    
    await doLoadProgram(yamlContent, programName);
  };

  const handleLoadProgram = async () => {
    let yamlContent: string;
    let programName: string;
    
    if (uploadedYaml) {
      yamlContent = uploadedYaml;
      programName = "上传的程序";
    } else if (selectedProgram) {
      // selectedProgram 现在是 filename
      const program = programs.find(p => p.filename === selectedProgram);
      if (!program) return;
      programName = program.name;
      try {
        yamlContent = await fetchProgramYaml(selectedProgram);
      } catch (e: any) {
        addLog(`获取程序文件失败: ${e.message}`);
        return;
      }
    } else {
      return;
    }
    
    await doLoadProgram(yamlContent, programName);
  };

  const doLoadProgram = async (yamlContent: string, programName: string) => {

    addLog(`加载程序: ${programName}`);
    
    // 解析 YAML 为前端程序对象
    const programData = parseYamlString(yamlContent);
    setLoadedProgram(programData);

    try {
      const result = await experimentApi("load", { yaml_content: yamlContent });
      
      // 检查后端是否真正加载成功
      const loadSuccess = result.success === true && !result.error && !result.errorMessage;
      
      if (!loadSuccess) {
        const errorMsg = result.error || result.errorMessage || "未知错误";
        addLog(`❌ 后端加载失败: ${errorMsg}`);
        
        // 显示验证错误
        if (result.validation?.errors?.length > 0) {
          for (const err of result.validation.errors) {
            addLog(`  错误 [${err.path}]: ${err.message}`);
          }
        }
        return; // 加载失败，不继续
      }
      
      addLog("✅ 后端加载成功");
      
      // 显示验证警告
      if (result.validation?.warnings?.length > 0) {
        for (const warn of result.validation.warnings) {
          addLog(`⚠️ 警告 [${warn.path}]: ${warn.message}`);
        }
      }
      
      // 只有成功时才设置实验状态
      setExperiment({
        status: "loaded",
        programName: programName,
        currentStep: 0,
        totalSteps: programData.steps.length,
        elapsedTime: 0,
        message: `已加载: ${programName}`,
      });
    } catch (e: any) {
      addLog(`❌ 后端通信失败: ${e.message}`);
      return; // 通信失败，不继续
    }
    
    // 清除上传的文件
    setUploadedYaml(null);
  };

  // 卸载程序
  const handleUnloadProgram = async () => {
    addLog("卸载程序");
    try {
      await experimentApi("unload");
      setLoadedProgram(null);
      setExperiment({
        status: "idle",
        programName: "",
        currentStep: 0,
        totalSteps: 0,
        elapsedTime: 0,
        message: "",
      });
      addLog("程序已卸载");
    } catch (e: any) {
      addLog(`卸载失败: ${e.message}`);
    }
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
      await experimentApi("unload");
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
    addLog("程序已卸载");
  };

  const canStart = experiment.status === "loaded";
  const canPause = experiment.status === "running";
  const canResume = experiment.status === "paused";
  const canStop = experiment.status === "running" || experiment.status === "paused" || experiment.status === "loaded";

  // 程序列表列定义
  const programColumns: ColumnDef<ProgramInfo>[] = useMemo(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="程序名称" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.getValue("name")}</span>
          <span className="text-xs text-muted-foreground font-mono">{row.original.filename}</span>
        </div>
      ),
    },
    {
      accessorKey: "version",
      header: ({ column }) => <DataTableColumnHeader column={column} title="版本" />,
      cell: ({ row }) => <Badge variant="outline">v{row.getValue("version")}</Badge>,
      size: 80,
    },
    {
      accessorKey: "description",
      header: "描述",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground line-clamp-1">
          {row.getValue("description") || "-"}
        </span>
      ),
    },
  ], []);

  // 程序行点击处理
  const handleProgramRowClick = useCallback((program: ProgramInfo) => {
    if (experiment.status === "idle") {
      setSelectedProgram(program.filename);
      setUploadedYaml(null);
    }
  }, [experiment.status]);

  // 程序右键菜单
  const renderProgramContextMenu = useCallback((program: ProgramInfo) => {
    // 检查此程序是否已加载
    const isThisProgramLoaded = loadedProgram?.name === program.name && experiment.status === "loaded";
    
    return (
      <>
        {isThisProgramLoaded ? (
          // 已加载的程序显示卸载选项
          <ContextMenuItem onClick={handleUnloadProgram}>
            <X className="mr-2 h-4 w-4" />
            卸载程序
          </ContextMenuItem>
        ) : (
          // 未加载的程序显示加载选项
          <ContextMenuItem
            onClick={() => loadProgramByFilename(program.filename)}
            disabled={experiment.status !== "idle"}
          >
            <Upload className="mr-2 h-4 w-4" />
            加载程序
          </ContextMenuItem>
        )}
        <ContextMenuItem asChild>
          <Link href={`/experiment-editor?file=${program.filename}`}>
            <Edit className="mr-2 h-4 w-4" />
            编辑程序
          </Link>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={async () => {
            const yaml = await fetchProgramYaml(program.filename);
            const prog = parseYamlString(yaml);
            if (prog) {
              setLoadedProgram(prog);
            }
          }}
        >
          <Eye className="mr-2 h-4 w-4" />
          预览流程
        </ContextMenuItem>
      </>
    );
  }, [experiment.status, loadedProgram, programs]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-4">
      {/* 顶部标题和控制栏 */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold">实验执行</h1>
        <div className="flex items-center gap-4">
          {/* 状态徽章 */}
          <div className="flex items-center gap-2">
            <Badge variant={statusConfig[experiment.status].variant} className="text-sm">
              {statusConfig[experiment.status].label}
            </Badge>
            {experiment.programName && (
              <span className="text-sm text-muted-foreground">
                {experiment.currentStep} / {experiment.totalSteps} · {formatElapsedTime(displayTime)}
              </span>
            )}
          </div>
          {/* 控制按钮 */}
          <div className="flex items-center gap-2">
            <Button onClick={handleStart} disabled={!canStart} size="sm">
              <Play className="mr-1 h-4 w-4" />开始
            </Button>
            <Button onClick={canPause ? handlePause : handleResume} disabled={!canPause && !canResume} variant="outline" size="sm">
              {canResume ? <><RotateCcw className="mr-1 h-4 w-4" />继续</> : <><Pause className="mr-1 h-4 w-4" />暂停</>}
            </Button>
            <Button onClick={handleStop} disabled={!canStop} variant="destructive" size="sm">
              <Square className="mr-1 h-4 w-4" />停止
            </Button>
          </div>
        </div>
      </div>

      {/* 进度条 */}
      {experiment.totalSteps > 0 && (
        <div className="h-2 bg-secondary rounded-full overflow-hidden flex-shrink-0">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(experiment.currentStep / experiment.totalSteps) * 100}%` }}
          />
        </div>
      )}

      {/* 主内容区域 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* 左侧：程序列表和日志 */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* 程序列表 */}
          <Card className="flex flex-col flex-1 min-h-0">
            <CardHeader className="flex-shrink-0 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">实验程序</CardTitle>
                  <CardDescription>选择要执行的实验程序，右键查看更多选项</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* 上传按钮 */}
                  {experiment.status === "idle" && (
                    <>
                      <input
                        type="file"
                        accept=".yaml,.yml"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="yaml-upload"
                      />
                      <label htmlFor="yaml-upload">
                        <Button variant="outline" size="sm" asChild>
                          <span><FileUp className="mr-1 h-4 w-4" />上传</span>
                        </Button>
                      </label>
                    </>
                  )}
                  {/* 加载/卸载按钮 */}
                  {experiment.status === "idle" ? (
                    <Button
                      onClick={handleLoadProgram}
                      disabled={!selectedProgram && !uploadedYaml}
                      size="sm"
                    >
                      <Upload className="mr-1 h-4 w-4" />加载
                    </Button>
                  ) : (
                    <Button
                      onClick={handleUnload}
                      variant="outline"
                      size="sm"
                      disabled={experiment.status === "running" || experiment.status === "paused"}
                    >
                      <X className="mr-1 h-4 w-4" />卸载
                    </Button>
                  )}
                </div>
              </div>
              {uploadedYaml && (
                <Badge variant="secondary" className="mt-2 w-fit">
                  <FileUp className="mr-1 h-3 w-3" />已选择上传文件
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-hidden">
              <DataTable
                columns={programColumns}
                data={programs}
                searchKey="name"
                searchPlaceholder="搜索程序名称..."
                onRowClick={handleProgramRowClick}
                selectedRow={programs.find(p => p.filename === selectedProgram) || null}
                getRowId={(row) => row.filename}
                rowContextMenu={renderProgramContextMenu}
              />
            </CardContent>
          </Card>

          {/* 实验日志 */}
          <Card className="flex-shrink-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
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
              <div className="h-32 bg-muted/50 rounded-lg p-2 font-mono text-xs overflow-auto flex flex-col-reverse">
                <div className="space-y-0.5">
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
        <Card className="flex flex-col min-h-0">
          <CardHeader className="flex-shrink-0 pb-3">
            <CardTitle className="text-lg">程序流程</CardTitle>
            <CardDescription>
              {loadedProgram ? `已加载: ${loadedProgram.name}` : "加载程序后显示流程图"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto">
            {loadedProgram ? (
              <ExperimentFlow
                program={loadedProgram}
                currentStep={experiment.status === "running" ? experiment.currentStep : undefined}
              />
            ) : (
              <div className="h-full min-h-64 flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                <div className="text-center">
                  <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
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
