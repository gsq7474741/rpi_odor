"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Pause, RotateCcw, Upload, CheckCircle, AlertCircle, Clock, X, Wifi, WifiOff, FileUp, Edit, MoreHorizontal, Eye, FolderOpen, Loader2, Activity, Zap, ScatterChart } from "lucide-react";

import Link from "next/link";
import { ExperimentFlow, ExperimentProgram, parseYamlString, PumpStatusInfo } from "@/components/experiment-flow";
import { SensorMonitor } from "@/components/sensor-monitor";
import { useSensorStatusStream } from "@/hooks/use-sensor-stream";
import { QualityMonitorInline, QualityBadge, DataQualitySnapshot } from "@/components/quality-monitor";
import { LivePcaPanel } from "@/components/live-pca-panel";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";

// API 调用函数
async function experimentApi(action: string, body?: object) {
  const res = await fetch(`/api/run?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getExperimentStatus() {
  const res = await fetch("/api/run");
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

type ExperimentStatus = "idle" | "loaded" | "running" | "pausing" | "paused" | "completed" | "error";

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

// 格式化预估时长为紧凑字符串
function formatEstimateDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

const statusConfig: Record<ExperimentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  idle: { label: "空闲", variant: "secondary" },
  loaded: { label: "已加载", variant: "outline" },
  running: { label: "运行中", variant: "default" },
  pausing: { label: "暂停中...", variant: "outline" },
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
    const res = await fetch("/api/run/programs");
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

export default function RunPage() {
  const [experiment, setExperiment] = useState<ExperimentState>({
    status: "idle",
    programName: null,
    currentStep: 0,
    totalSteps: 0,
    elapsedTime: 0,
    message: "等待加载实验程序",
  });

  const [loadedProgram, setLoadedProgram] = useState<ExperimentProgram | null>(null);
  const [previewProgram, setPreviewProgram] = useState<ExperimentProgram | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [programs, setPrograms] = useState<ProgramInfo[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [uploadedYaml, setUploadedYaml] = useState<string | null>(null);
  const [quality, setQuality] = useState<DataQualitySnapshot | undefined>(undefined);
  const [runId, setRunId] = useState<number | null>(null);
  const [pumpStatus, setPumpStatus] = useState<PumpStatusInfo[]>([]);
  const fileInputRef = { current: null as HTMLInputElement | null };
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logScrollCooldownRef = useRef<number>(0);  // 手动上翻冷却截止时间戳

  // 传感器状态监听（用于日志面板报错）
  const { status: sensorStatus, connected: sensorSseConnected } = useSensorStatusStream();
  const prevSensorConnectedRef = useRef<boolean | null>(null);
  const prevSensorRunningRef = useRef<boolean | null>(null);
  
  // 动态计时器状态
  const [displayTime, setDisplayTime] = useState(0);
  const [stepDisplayTime, setStepDisplayTime] = useState(0);
  const lastSyncTimeRef = useRef<number>(0);  // 上次同步的后端时间
  const lastSyncLocalRef = useRef<number>(Date.now());  // 上次同步的本地时间戳
  const lastStepSyncTimeRef = useRef<number>(0);  // 上次同步的后端步骤时间
  
  // 已完成步骤的实际耗时记录 (0-indexed stepIndex -> 秒数)
  const [stepActualDurations, setStepActualDurations] = useState<Record<number, number>>({});
  const prevStepIndexRef = useRef<number>(-1);  // 上一次轮询到的后端 stepIndex (0-indexed)

  // 动态计时器 - 每 100ms 更新一次（同时维护实验总时间和步骤时间）
  useEffect(() => {
    if (experiment.status !== "running" && experiment.status !== "pausing") {
      // 非运行状态直接显示后端返回的时间
      setDisplayTime(experiment.elapsedTime);
      setStepDisplayTime(0);
      return;
    }
    
    // 运行中时，基于后端时间 + 本地增量
    const interval = setInterval(() => {
      const localElapsed = (Date.now() - lastSyncLocalRef.current) / 1000;
      setDisplayTime(lastSyncTimeRef.current + localElapsed);
      setStepDisplayTime(lastStepSyncTimeRef.current + localElapsed);
    }, 100);
    
    return () => clearInterval(interval);
  }, [experiment.status, experiment.elapsedTime]);

  // 加载内置程序列表
  useEffect(() => {
    fetchBuiltinPrograms().then(setPrograms);
  }, []);

  // 查询泵绑定和余量（样品泵 + 清洗泵）
  const fetchPumpStatus = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapAssignment = (a: any, isWash: boolean): PumpStatusInfo => ({
        pumpIndex: a.pumpIndex ?? a.pump_index ?? 0,
        liquidId: a.liquidId ?? a.liquid_id,
        liquidName: a.liquid?.name ?? a.liquidName ?? "",
        initialVolumeMl: a.initialVolumeMl ?? a.initial_volume_ml ?? 0,
        consumedVolumeMl: a.consumedVolumeMl ?? a.consumed_volume_ml ?? 0,
        remainingVolumeMl: a.remainingVolumeMl ?? a.remaining_volume_ml ?? 0,
        isLowVolume: a.isLowVolume ?? a.is_low_volume ?? false,
        isWashPump: isWash,
      });

      const [pumpsRes, washRes] = await Promise.all([
        fetch("/api/consumables?type=pumps"),
        fetch("/api/consumables?type=wash-pumps"),
      ]);

      const all: PumpStatusInfo[] = [];
      if (pumpsRes.ok) {
        const data = await pumpsRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        all.push(...(data.assignments || []).map((a: any) => mapAssignment(a, false)));
      }
      if (washRes.ok) {
        const data = await washRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        all.push(...(data.assignments || []).map((a: any) => mapAssignment(a, true)));
      }
      setPumpStatus(all);
    } catch {
      // 查询失败时不阻塞页面
    }
  }, []);

  // 页面加载时查询一次泵余量；程序加载/预览变化时也刷新
  useEffect(() => {
    fetchPumpStatus();
  }, [fetchPumpStatus]);

  useEffect(() => {
    if (loadedProgram?.compileEstimate || previewProgram?.compileEstimate) {
      fetchPumpStatus();
    }
  }, [loadedProgram, previewProgram, fetchPumpStatus]);

  // 实验运行期间每 5s 刷新泵余量（让已消耗量实时更新）
  useEffect(() => {
    if (experiment.status !== "running" && experiment.status !== "pausing") return;
    const interval = setInterval(fetchPumpStatus, 5000);
    return () => clearInterval(interval);
  }, [experiment.status, fetchPumpStatus]);

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
        
        // 处理 "pausing" 中间状态：后端还是 running 时保持 pausing，后端变为 paused 时才切换
        let resolvedStatus: ExperimentStatus = backendState;
        if (prev.status === "pausing" && backendState === "running") {
          resolvedStatus = "pausing";  // 保持等待状态，避免抖动
        }

        return {
          ...prev,
          status: resolvedStatus,
          programName: programName,
          currentStep: currentStep,
          totalSteps: totalSteps,
          elapsedTime: elapsedTime,
          message: status.currentStepName || prev.message,
        };
      });
      
      // 追踪步骤切换，记录已完成步骤的实际耗时
      const curIdx = status.currentStepIndex ?? 0;  // 0-indexed
      if (backendState === "running" || backendState === "paused") {
        if (prevStepIndexRef.current >= 0 && curIdx > prevStepIndexRef.current) {
          // 步骤前进了，记录上一步的实际耗时
          // lastStepSyncTimeRef 保存的是上一轮同步时的 stepElapsedS（即上一步最后时刻的耗时）
          const prevDuration = lastStepSyncTimeRef.current;
          const prevIdx = prevStepIndexRef.current;
          if (prevDuration > 0) {
            setStepActualDurations(prev => ({ ...prev, [prevIdx]: Math.round(prevDuration) }));
          }
        }
        prevStepIndexRef.current = curIdx;
      } else if (backendState === "completed") {
        // 实验完成，记录最后一步的耗时
        if (prevStepIndexRef.current >= 0 && lastStepSyncTimeRef.current > 0) {
          const lastIdx = prevStepIndexRef.current;
          const lastDuration = lastStepSyncTimeRef.current;
          setStepActualDurations(prev => ({ ...prev, [lastIdx]: Math.round(lastDuration) }));
        }
      } else if (backendState === "idle") {
        // 实验重置，清空记录
        if (prevStepIndexRef.current >= 0) {
          setStepActualDurations({});
          prevStepIndexRef.current = -1;
        }
      }
      
      // 同步计时器基准时间（实验总时间 + 步骤时间）
      lastSyncTimeRef.current = status.elapsedS || 0;
      lastStepSyncTimeRef.current = status.stepElapsedS || 0;
      lastSyncLocalRef.current = Date.now();
      
      // 更新 runId
      if (status.runId && status.runId > 0) {
        setRunId(status.runId);
      } else if (backendState === "idle") {
        setRunId(null);
      }
      
      // 更新质量数据
      if (status.quality) {
        setQuality(status.quality);
      } else if (backendState === "idle" || backendState === "completed") {
        setQuality(undefined);
      }
      
      // 从后端恢复日志（页面刷新时）
      if (status.logs && status.logs.length > 0) {
        setLogs(prevLogs => {
          // 如果本地日志为空或比后端少很多，使用后端日志
          if (prevLogs.length === 0 || (prevLogs.length < status.logs.length / 2)) {
            return status.logs;
          }
          // 否则追加后端中有但本地没有的新日志
          const lastLocalLog = prevLogs[prevLogs.length - 1];
          const lastLocalIdx = status.logs.findIndex((log: string) => log === lastLocalLog);
          if (lastLocalIdx >= 0 && lastLocalIdx < status.logs.length - 1) {
            // 追加新日志
            return [...prevLogs, ...status.logs.slice(lastLocalIdx + 1)].slice(-100);
          }
          return prevLogs;
        });
      }
      
      // 从后端恢复加载的程序（页面刷新时）
      // 优先使用 programFilename（后端返回的源文件名）精确匹配
      const programFilename = status.programFilename;
      const programIdentifier = status.programId || status.programName;
      if (!loadedProgram && (programFilename || programIdentifier) && backendState !== "idle") {
        let matchedProgram: typeof programs[0] | undefined;
        
        // 1. 优先用后端返回的 programFilename 精确匹配文件名
        if (programFilename) {
          matchedProgram = programs.find(p => p.filename === programFilename);
        }
        
        // 2. 其次用 programId 匹配文件名（去掉 .yaml 扩展名）
        if (!matchedProgram && programIdentifier) {
          matchedProgram = programs.find(p => {
            const filenameWithoutExt = p.filename.replace(/\.ya?ml$/i, '');
            return p.filename === programIdentifier || 
                   filenameWithoutExt === programIdentifier;
          });
        }
        
        // 3. 最后兑底用 name 匹配
        if (!matchedProgram && programIdentifier) {
          matchedProgram = programs.find(p => p.name === programIdentifier);
        }
        if (matchedProgram) {
          fetchProgramYaml(matchedProgram.filename).then(yaml => {
            const prog = parseYamlString(yaml);
            if (prog) {
              setLoadedProgram(prog);
            }
          }).catch(() => {});
        }
      }
      
      // 后端返回的实验错误输出到日志
      if (status.error && backendState === "error" && lastStatusRef.current !== "error") {
        addLog(`❌ 实验错误: ${status.error}`);
      }
      
      // 只在状态从非完成变为完成时添加日志（避免重复）
      if (backendState === "completed" && lastStatusRef.current !== "completed") {
        addLog("实验已完成");
      }
      lastStatusRef.current = backendState;
    } catch {
      setConnected(false);
    }
  }, [addLog, loadedProgram, programs]);

  // 轮询定时器
  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 1000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  // 传感器掉线/恢复 → 日志面板报错
  useEffect(() => {
    if (!sensorStatus) return;
    const wasConnected = prevSensorConnectedRef.current;
    const wasRunning = prevSensorRunningRef.current;
    prevSensorConnectedRef.current = sensorStatus.connected;
    prevSensorRunningRef.current = sensorStatus.running;

    // 跳过初始化（首次收到状态时不报）
    if (wasConnected === null) return;

    if (wasConnected && !sensorStatus.connected) {
      addLog("❌ 传感器已断开连接");
    } else if (!wasConnected && sensorStatus.connected) {
      addLog("✅ 传感器已重新连接");
    }

    if (wasRunning && !sensorStatus.running && sensorStatus.connected) {
      addLog("⚠️ 传感器采集已停止");
    } else if (!wasRunning && sensorStatus.running && wasRunning !== null) {
      addLog("✅ 传感器采集已启动");
    }
  }, [sensorStatus, addLog]);

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
    
    await doLoadProgram(yamlContent, programName, filename);
  };

  const handleLoadProgram = async () => {
    let yamlContent: string;
    let programName: string;
    let filename: string | undefined;
    
    if (uploadedYaml) {
      yamlContent = uploadedYaml;
      programName = "上传的程序";
    } else if (selectedProgram) {
      // selectedProgram 现在是 filename
      const program = programs.find(p => p.filename === selectedProgram);
      if (!program) return;
      programName = program.name;
      filename = selectedProgram;
      try {
        yamlContent = await fetchProgramYaml(selectedProgram);
      } catch (e: any) {
        addLog(`获取程序文件失败: ${e.message}`);
        return;
      }
    } else {
      return;
    }
    
    await doLoadProgram(yamlContent, programName, filename);
  };

  const doLoadProgram = async (yamlContent: string, programName: string, filename?: string) => {

    addLog(`加载程序: ${programName}`);
    
    // 解析 YAML 为前端程序对象
    const programData = parseYamlString(yamlContent);
    setLoadedProgram(programData);
    setPreviewProgram(null);

    try {
      const result = await experimentApi("load", { yaml_content: yamlContent, filename: filename || "" });
      
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
      setPreviewProgram(null);
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
    addLog("暂停实验 - 将在当前步骤完成后暂停");
    setExperiment(prev => ({
      ...prev,
      status: "pausing",
      message: "等待当前步骤完成后暂停...",
    }));
    try {
      await experimentApi("pause");
    } catch (e: any) {
      addLog(`暂停失败: ${e.message}`);
      // 失败时恢复为 running
      setExperiment(prev => ({
        ...prev,
        status: "running",
        message: "实验正在运行...",
      }));
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
    setPreviewProgram(null);
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
    setPreviewProgram(null);
    addLog("程序已卸载");
  };

  const canStart = experiment.status === "loaded";
  const canPause = experiment.status === "running";
  const isPausing = experiment.status === "pausing";
  const canResume = experiment.status === "paused";
  const canStop = experiment.status === "running" || experiment.status === "pausing" || experiment.status === "paused" || experiment.status === "loaded";

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

  // 程序行点击处理 - 单击即预览
  const handleProgramRowClick = useCallback(async (program: ProgramInfo) => {
    if (experiment.status === "idle") {
      setSelectedProgram(program.filename);
      setUploadedYaml(null);
      try {
        const yaml = await fetchProgramYaml(program.filename);
        const prog = parseYamlString(yaml);
        if (prog) {
          setPreviewProgram(prog);
        }
      } catch {
        // 预览失败静默处理
      }
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
          <Link href={`/workflow?file=${program.filename}`}>
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
              setPreviewProgram(prog);
              setSelectedProgram(program.filename);
            }
          }}
        >
          <Eye className="mr-2 h-4 w-4" />
          预览流程
        </ContextMenuItem>
      </>
    );
  }, [experiment.status, loadedProgram, programs]);

  // 运行态判断
  const isRunning = experiment.status === "running" || experiment.status === "pausing" || experiment.status === "paused";
  const isActive = isRunning || experiment.status === "loaded" || experiment.status === "completed";

  // 日志组件（共用）
  // 日志自动滚动：logs 变化时滚到底部，手动上翻时 5 秒冷却
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    if (Date.now() < logScrollCooldownRef.current) return; // 冷却期内不自动滚动
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleLogScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    // 距离底部超过 30px 认为是手动上翻
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 30) {
      logScrollCooldownRef.current = Date.now() + 5000;
    }
  }, []);

  const logPanel = (
    <div className="flex flex-col min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm px-3 py-1.5" style={{ flex: 1 }}>
      <p className="text-xs font-medium text-muted-foreground mb-1 flex-shrink-0">实验日志</p>
      <div
        ref={logContainerRef}
        onScroll={handleLogScroll}
        className="flex-1 min-h-0 bg-muted/30 rounded-md p-2 font-mono text-[11px] leading-relaxed overflow-auto"
      >
        <div className="space-y-px">
          {logs.length === 0 ? (
            <div className="text-muted-foreground/60">等待操作...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={
                log.includes("失败") || log.includes("错误") || log.includes("❌") ? "text-red-600" :
                log.includes("成功") || log.includes("启动") || log.includes("✅") ? "text-green-600" :
                log.includes("加载") || log.includes("阶段") ? "text-blue-600" :
                log.includes("⚠️") ? "text-yellow-600" :
                "text-muted-foreground"
              }>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-3 sm:p-4 lg:p-6 gap-3">
      {/* ═══════════════ 顶部控制栏 ═══════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">实验执行</h1>
          <Badge variant={statusConfig[experiment.status].variant}>
            {statusConfig[experiment.status].label}
          </Badge>
          {experiment.programName && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {experiment.currentStep}/{experiment.totalSteps} · {formatElapsedTime(displayTime)}
            </span>
          )}
          <QualityBadge quality={quality} />
        </div>
        <div className="flex items-center gap-1.5">
          {/* 连接状态 */}
          <div className="flex items-center gap-1 text-xs mr-2">
            {connected ? (
              <><Wifi className="h-3.5 w-3.5 text-green-500" /><span className="text-green-600 hidden sm:inline">已连接</span></>
            ) : (
              <><WifiOff className="h-3.5 w-3.5 text-red-500" /><span className="text-red-600 hidden sm:inline">未连接</span></>
            )}
          </div>
          <Button onClick={handleStart} disabled={!canStart} size="sm">
            <Play className="h-3.5 w-3.5 mr-1" />开始
          </Button>
          <Button onClick={canPause ? handlePause : handleResume} disabled={!canPause && !canResume && !isPausing} variant="outline" size="sm">
            {isPausing ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />暂停中</>
              : canResume ? <><RotateCcw className="h-3.5 w-3.5 mr-1" />继续</>
              : <><Pause className="h-3.5 w-3.5 mr-1" />暂停</>}
          </Button>
          <Button onClick={handleStop} disabled={!canStop} variant="destructive" size="sm">
            <Square className="h-3.5 w-3.5 mr-1" />停止
          </Button>
        </div>
      </div>

      {/* ═══════════════ 进度条 ═══════════════ */}
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden flex-shrink-0">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: experiment.totalSteps > 0 ? `${(experiment.currentStep / experiment.totalSteps) * 100}%` : '0%' }}
        />
      </div>

      {/* ═══════════════ 主内容区域 — 运行时3列，空闲2列 ═══════════════ */}
      {isActive ? (
        /* ━━━━━ 运行态: 流程 | 传感器 | 质量 ━━━━━ */
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.5fr)_minmax(0,1fr)] gap-3 flex-1 min-h-0">
          
          {/* 左列: 程序流程 + 日志 */}
          <div className="flex flex-col min-h-0 gap-3">
            <Card className="flex flex-col min-h-0" style={{ flex: 2 }}>
              <CardHeader className="flex-shrink-0 py-2.5 px-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    {loadedProgram?.name || "程序流程"}
                  </CardTitle>
                  {(experiment.status === "loaded" || experiment.status === "completed") && (
                    <Button onClick={handleUnloadProgram} variant="outline" size="sm">
                      <X className="h-3.5 w-3.5 mr-1" />卸载
                    </Button>
                  )}
                </div>
                {loadedProgram && (
                  <CardDescription className="text-[11px]">
                    {experiment.currentStep}/{loadedProgram.steps.length} 步
                    {loadedProgram.compileEstimate && (
                      <> · 预计 {formatEstimateDuration(loadedProgram.compileEstimate.total_duration_s)}</>
                    )}
                    {experiment.status === "completed" && " · 已完成"}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
                {loadedProgram ? (
                  <ExperimentFlow
                    program={loadedProgram}
                    currentStep={
                      experiment.status === "completed"
                        ? (loadedProgram.steps.length + 1)
                        : ["running", "pausing", "paused"].includes(experiment.status)
                          ? experiment.currentStep
                          : undefined
                    }
                    stepElapsedSeconds={experiment.status === "running" ? stepDisplayTime : undefined}
                    pumpStatus={pumpStatus}
                    completedStepDurations={stepActualDurations}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <p className="text-xs">未加载程序</p>
                  </div>
                )}
              </CardContent>
            </Card>
            {logPanel}
          </div>

          {/* 中列: 实时PCA + 传感器监控 */}
          <div className="flex flex-col min-h-0 gap-3">
            {/* 实时 PCA 降维面板 */}
            <Card className="flex flex-col min-h-0" style={{ flex: "0 0 45%" }}>
              <CardHeader className="flex-shrink-0 py-2 px-4">
                <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                  <ScatterChart className="h-3.5 w-3.5" />实时 PCA
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 px-4 pb-2 pt-0">
                <LivePcaPanel runId={runId} active={isActive} experimentStatus={experiment.status} />
              </CardContent>
            </Card>
            {/* 传感器监控 */}
            <Card className="flex flex-col flex-1 min-h-0">
              <CardHeader className="flex-shrink-0 py-2.5 px-4">
                <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />传感器监控
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
                <SensorMonitor
                  active={true}
                  defaultOpen={true}
                  experimentRunning={isRunning}
                  inline={true}
                  runId={runId}
                />
              </CardContent>
            </Card>
          </div>

          {/* 右列: 数据质量 */}
          <div className="flex flex-col min-h-0">
            <Card className="flex flex-col h-full">
              <CardHeader className="flex-shrink-0 py-2.5 px-3">
                <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />数据质量
                  {quality && quality.activeAlertCount > 0 && (
                    <Badge variant="destructive" className="text-[10px] h-4 min-w-4 px-1">
                      {quality.activeAlertCount}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                {quality && quality.overallLevel > 0 ? (
                  <QualityMonitorInline quality={quality} />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center text-muted-foreground py-8">
                      <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">等待数据...</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        /* ━━━━━ 空闲态: 程序列表 | 流程预览 ━━━━━ */
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 flex-1 min-h-0">
          
          {/* 左列: 程序列表 + 日志 */}
          <div className="flex flex-col min-h-0 gap-3">
            <Card className="flex flex-col flex-1 min-h-0">
              <CardHeader className="flex-shrink-0 py-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">实验程序</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <input type="file" accept=".yaml,.yml" onChange={handleFileUpload} className="hidden" id="yaml-upload" />
                    <label htmlFor="yaml-upload">
                      <Button variant="outline" size="sm" asChild>
                        <span><FileUp className="mr-1 h-3.5 w-3.5" />上传</span>
                      </Button>
                    </label>
                    <Button onClick={handleLoadProgram} disabled={!selectedProgram && !uploadedYaml} size="sm">
                      <Upload className="mr-1 h-3.5 w-3.5" />加载
                    </Button>
                  </div>
                </div>
                {uploadedYaml && (
                  <Badge variant="secondary" className="mt-1.5 w-fit text-xs">
                    <FileUp className="mr-1 h-3 w-3" />已选择上传文件
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-hidden px-4 pb-3">
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
            {logPanel}
          </div>

          {/* 右列: 程序流程预览 */}
          <div className="flex flex-col min-h-0">
            <Card className="flex flex-col h-full">
              <CardHeader className="flex-shrink-0 py-3 px-4">
                <CardTitle className="text-sm">
                  {(previewProgram || loadedProgram)?.name || "程序流程"}
                </CardTitle>
                {(previewProgram || loadedProgram) && (
                  <CardDescription className="text-xs">
                    {(previewProgram || loadedProgram)!.steps.length} 个步骤
                    {(previewProgram || loadedProgram)!.compileEstimate && (
                      <> · 预计 {formatEstimateDuration((previewProgram || loadedProgram)!.compileEstimate!.total_duration_s)}
                        {(previewProgram || loadedProgram)!.compileEstimate!.total_inject_ml > 0 && (
                          <> · 进样 {(previewProgram || loadedProgram)!.compileEstimate!.total_inject_ml.toFixed(0)} ml</>
                        )}
                      </>
                    )}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
                {(previewProgram || loadedProgram) ? (
                  <ExperimentFlow
                    program={(previewProgram || loadedProgram)!}
                    currentStep={undefined}
                    pumpStatus={pumpStatus}
                  />
                ) : (
                  <div className="h-full min-h-48 flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                    <div className="text-center">
                      <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">点击左侧程序即可预览</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
