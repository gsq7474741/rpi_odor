"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scale, Target, Settings, RefreshCw, Check, X, Loader2, Plus, Trash2, Play, Square, BarChart3, Save } from "lucide-react";
import ReactECharts from "echarts-for-react";

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

// 删除后端 tare 调用，改用纯前端去皮

// 进样/排废 API
async function setSystemState(targetState: string) {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_state: targetState }),
  });
  if (!res.ok) throw new Error(`Failed to set state: ${targetState}`);
  return res.json();
}

async function startInjection(params: { pump0Volume: number; pump1Volume: number; pump2Volume: number; pump3Volume: number; pump4Volume: number; pump5Volume: number; pump6Volume: number; pump7Volume: number; speed?: number; accel?: number }) {
  const res = await fetch("/api/injection/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to start injection");
  return res.json();
}

type CalibrationStep = "idle" | "zero_point" | "reference_weight" | "verify" | "complete";
type AutoTestStep = "idle" | "draining" | "waiting_empty" | "recording_empty" | "injecting" | "waiting_stable" | "recording_full" | "complete";

interface LoadCellReading {
  weightGrams: number;
  rawPercent: number;
  isCalibrated: boolean;
  isStable: boolean;
  trend: number;
}

interface LoadCellConfig {
  overflowThreshold: number;
  drainCompleteMargin: number;
  stableThreshold: number;
  pumpMmToMl?: number;  // 从后端读取的泵校准系数
  pumpMmOffset?: number;
  weightScale?: number;
  weightOffset?: number;
}

interface TarePoint {
  id: number;
  weight: number;
  timestamp: Date;
  label: string;
}

interface InjectionParams {
  pump0Volume: number;
  pump1Volume: number;
  pump2Volume: number;
  pump3Volume: number;
  pump4Volume: number;
  pump5Volume: number;
  pump6Volume: number;
  pump7Volume: number;
}

interface ParamSet {
  id: number;
  name: string;
  params: InjectionParams;
  speed: number; // 每组可单独配置速度
  cycles: number;
}

interface AutoTestConfig {
  paramSets: ParamSet[];
  speed: number;
  accel: number;
  emptyTolerance: number; // 空瓶容差 (g)
  drainStabilityWindow: number; // 排废稳定时间窗口 (秒)
}

interface AutoTestResult {
  paramSetId: number;
  paramSetName: string;
  cycle: number;
  totalVolume: number; // 泵设定总量 (mm)
  pump0Volume: number;
  pump1Volume: number;
  pump2Volume: number;
  pump3Volume: number;
  pump4Volume: number;
  pump5Volume: number;
  pump6Volume: number;
  pump7Volume: number;
  speed: number;
  emptyWeight: number;
  fullWeight: number;
  injectedWeight: number;
  timestamp: Date;
  // 步骤时长 (ms)
  drainDuration: number;
  waitEmptyDuration: number;
  injectDuration: number;
  waitStableDuration: number;
  totalDuration: number;
}

// ============================================================
// 高级测试接口定义
// ============================================================

// 管路死区检测结果
interface DeadZoneResult {
  cycle: number;
  pumpId: number; // 2-5
  deadZoneVolume: number; // 死区体积 (mm)
  firstDropWeight: number; // 首滴重量 (g)
  timestamp: Date;
}

// 分辨率检测结果
interface ResolutionResult {
  cycle: number;
  testMode: 'single' | 'multi'; // 单电机/多电机
  pumpId?: number; // 单电机模式下的泵ID
  volumeStep: number; // 测试的进样量步长 (mm)
  baseWeight: number; // 基准重量
  injectedWeight: number; // 实际进样重量
  detected: boolean; // 是否检测到重量变化
  timestamp: Date;
}

// 基线漂移记录
interface BaselineDriftRecord {
  cycle: number;
  emptyWeight: number;
  driftFromFirst: number; // 相对第一次的漂移
  driftFromPrev: number; // 相对上一次的漂移
  timestamp: Date;
}

// 线性度检测结果
interface LinearityResult {
  setVolume: number; // 设定进样量 (mm)
  actualWeight: number; // 实际重量变化 (g)
  cycle: number;
  pumpId?: number; // 单电机模式下的泵ID
  timestamp: Date;
}

// 称重标定结果
interface WeightCalibrationResult {
  index: number; // 序号
  setVolumeMm: number; // 设定进样量 (mm)
  setVolumeMl: number; // 计算的ml值
  measuredWeight: number; // 称重变化值 (g)
  realWeight: number | null; // 用户输入的真实值 (g)
  timestamp: Date;
}

// 高级测试类型
type AdvancedTestType = 'deadzone' | 'resolution' | 'baseline' | 'linearity' | 'weight_calibration' | null;

export function LoadCellPanel() {
  // 实时读数
  const [reading, setReading] = useState<LoadCellReading | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  
  // 前端去皮偏移量（电子秤功能）
  const [tareOffset, setTareOffset] = useState(0);
  
  // 多去皮点记录（进样一致性检测）
  const [tarePoints, setTarePoints] = useState<TarePoint[]>([]);
  const [nextTareId, setNextTareId] = useState(1);
  
  // 自动测试状态
  const [autoTestStep, setAutoTestStep] = useState<AutoTestStep>("idle");
  const [autoTestConfig, setAutoTestConfig] = useState<AutoTestConfig>({
    paramSets: [
      { id: 1, name: "小量", params: { pump0Volume: 150, pump1Volume: 150, pump2Volume: 150, pump3Volume: 150, pump4Volume: 150, pump5Volume: 150, pump6Volume: 150, pump7Volume: 150 }, speed: 50, cycles: 3 },
      { id: 2, name: "中量", params: { pump0Volume: 250, pump1Volume: 250, pump2Volume: 250, pump3Volume: 250, pump4Volume: 250, pump5Volume: 250, pump6Volume: 250, pump7Volume: 250 }, speed: 50, cycles: 3 },
      { id: 3, name: "大量", params: { pump0Volume: 450, pump1Volume: 450, pump2Volume: 450, pump3Volume: 450, pump4Volume: 450, pump5Volume: 450, pump6Volume: 450, pump7Volume: 450 }, speed: 50, cycles: 3 },
    ],
    speed: 10,
    accel: 100,
    emptyTolerance: 5,
    drainStabilityWindow: 5, // 排废稳定窗口默认5秒
  });
  const [autoTestResults, setAutoTestResults] = useState<AutoTestResult[]>([]);
  
  // 持久化相关状态
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);
  const [historicalRuns, setHistoricalRuns] = useState<Array<{
    runId: number;
    status: string;
    startedAt: string;
    endedAt?: string;
    totalCycles: number;
  }>>([]);
  const [viewingHistoryRunId, setViewingHistoryRunId] = useState<number | null>(null);
  const [autoTestCurrentCycle, setAutoTestCurrentCycle] = useState(0);
  const [autoTestCurrentParamSet, setAutoTestCurrentParamSet] = useState(0);
  const [autoTestTotalParamSets, setAutoTestTotalParamSets] = useState(0);  // 后端返回的总参数组数
  const [autoTestTotalCycles, setAutoTestTotalCycles] = useState(0);  // 后端返回的总循环数
  const [autoTestLog, setAutoTestLog] = useState<string[]>([]);
  const [autoTestEmptyWeight, setAutoTestEmptyWeight] = useState(0);
  const [nextParamSetId, setNextParamSetId] = useState(4);
  const autoTestAbortRef = useRef(false);
  
  // 动态空瓶值（由后端管理，前端只显示）
  const [dynamicEmptyWeight, setDynamicEmptyWeight] = useState<number | null>(null);
  
  // 日志自动滚动
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  
  // ============================================================
  // 高级测试状态
  // ============================================================
  const [advancedTestType, setAdvancedTestType] = useState<AdvancedTestType>(null);
  const [advancedTestRunning, setAdvancedTestRunning] = useState(false);
  const advancedTestAbortRef = useRef(false);
  
  // 管路死区检测
  const [deadZoneResults, setDeadZoneResults] = useState<DeadZoneResult[]>([]);
  const [deadZoneConfig, setDeadZoneConfig] = useState({
    pumpIds: [2, 3, 4, 5] as number[], // 要测试的泵
    stepVolume: 10, // 每次进样步长 (mm)
    maxVolume: 200, // 最大测试量 (mm)
    cycles: 3, // 每个泵重复次数
    speed: 50, // 进样速度
    detectionThreshold: 0.5, // 检测阈值 (g)
  });
  
  // 分辨率检测
  const [resolutionResults, setResolutionResults] = useState<ResolutionResult[]>([]);
  const [resolutionConfig, setResolutionConfig] = useState({
    testMode: 'single' as 'single' | 'multi',
    pumpId: 2, // 单电机模式下测试的泵
    baseVolume: 50, // 基准液体量 (mm) - 用于没过管子下段
    testStartVolume: 50, // 测试起始值 (mm) - 从这个值开始递减
    stepVolume: 10, // 递减步长 (mm)
    minVolume: 5, // 最小测试量 (mm)
    cycles: 5, // 每个量重复次数
    speed: 50,
    detectionThreshold: 0.3, // 检测阈值 (g)
  });
  
  // 基线漂移检测
  const [baselineDriftRecords, setBaselineDriftRecords] = useState<BaselineDriftRecord[]>([]);
  
  // 线性度检测
  const [linearityResults, setLinearityResults] = useState<LinearityResult[]>([]);
  const [linearityConfig, setLinearityConfig] = useState({
    testMode: 'single' as 'single' | 'multi',
    pumpId: 2, // 单电机模式下测试的泵
    volumeSteps: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], // 测试进样量序列 (mm)
    cycles: 3, // 每个进样量重复次数
    speed: 100,
  });
  
  // 序列生成器
  const [seqGenOpen, setSeqGenOpen] = useState(false);
  const [seqGenConfig, setSeqGenConfig] = useState({
    type: 'linear' as 'linear' | 'log' | 'exp' | 'quadratic' | 'sqrt',
    min: 50,
    max: 1000,
    steps: 10,
  });
  
  // 称重标定
  const [weightCalibResults, setWeightCalibResults] = useState<WeightCalibrationResult[]>([]);
  const [weightCalibConfig, setWeightCalibConfig] = useState({
    testMode: 'single' as 'single' | 'multi',
    pumpId: 2,
    volumeSteps: [100, 200, 300, 400, 500, 600, 700, 800], // 测试进样量序列 (mm)
    speed: 100,
    pumpMmToMl: 0.0314, // 从后端配置加载
    pumpMmOffset: -7.34, // 从后端配置加载
  });
  const [weightCalibStep, setWeightCalibStep] = useState<'idle' | 'injecting' | 'waiting_user' | 'draining'>('idle');
  const [weightCalibCurrentIndex, setWeightCalibCurrentIndex] = useState(0);
  const [weightCalibSeqGenOpen, setWeightCalibSeqGenOpen] = useState(false);
  const weightCalibContinueRef = useRef<(() => void) | null>(null);
  
  // 生成序列的函数
  const generateSequence = (type: string, min: number, max: number, steps: number): number[] => {
    if (steps < 2) return [min, max];
    const result: number[] = [];
    
    switch (type) {
      case 'linear': // 线性等差
        for (let i = 0; i < steps; i++) {
          result.push(Math.round(min + (max - min) * i / (steps - 1)));
        }
        break;
        
      case 'log': // 对数分布（小值密集）
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const logVal = Math.log(1 + t * (Math.E - 1)); // 0->1 映射到 log(1)->log(e)=1
          result.push(Math.round(min + (max - min) * logVal));
        }
        break;
        
      case 'exp': // 指数分布（大值密集）
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const expVal = (Math.exp(t) - 1) / (Math.E - 1); // 0->1 映射到指数曲线
          result.push(Math.round(min + (max - min) * expVal));
        }
        break;
        
      case 'quadratic': // 二次分布（中间稀疏两端密集）
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const quadVal = t * t; // 二次曲线，小值更密集
          result.push(Math.round(min + (max - min) * quadVal));
        }
        break;
        
      case 'sqrt': // 平方根分布（小值稀疏大值密集）
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const sqrtVal = Math.sqrt(t);
          result.push(Math.round(min + (max - min) * sqrtVal));
        }
        break;
        
      default:
        return generateSequence('linear', min, max, steps);
    }
    
    // 去重并排序
    return [...new Set(result)].sort((a, b) => a - b);
  };

  // 硬件标定状态
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>("idle");
  const [calibrationMessage, setCalibrationMessage] = useState("");
  const [referenceWeight, setReferenceWeightValue] = useState("100");
  const [isCalibrating, setIsCalibrating] = useState(false);

  // 业务配置
  const [config, setConfig] = useState<LoadCellConfig>({
    overflowThreshold: 500,
    drainCompleteMargin: 5,
    stableThreshold: 2,
    pumpMmToMl: 0,
    pumpMmOffset: 0,
    weightScale: 1,
    weightOffset: 0,
  });
  const [weightCalibSaving, setWeightCalibSaving] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // 加载配置并检查是否有正在运行的任务
  useEffect(() => {
    loadConfig();
    checkRunningTest();
  }, []);
  
  // 检查后端是否有正在运行的测试任务
  const checkRunningTest = async () => {
    try {
      const response = await fetch('/api/test');
      if (!response.ok) return;
      
      const status = await response.json();
      
      // 保存 run_id
      if (status.runId && status.runId > 0) {
        setCurrentRunId(status.runId);
      }
      
      // Proto 枚举值: TEST_STATE_UNSPECIFIED=0, TEST_IDLE=1, TEST_DRAINING=2, ...
      // TEST_COMPLETE=6, TEST_ERROR=7, TEST_STOPPING=8
      const stateValue = typeof status.state === 'number' ? status.state : 
        (status.state === 'TEST_IDLE' ? 1 : status.state === 'TEST_COMPLETE' ? 6 : 
         status.state === 'TEST_ERROR' ? 7 : status.state === 'TEST_STATE_UNSPECIFIED' ? 0 : -1);
      
      const isRunning = stateValue > 1 && stateValue < 6; // DRAINING=2, WAITING_EMPTY=3, INJECTING=4, WAITING_STABLE=5
      const isComplete = stateValue === 6;
      
      // 如果有正在运行的任务，恢复状态显示
      if (isRunning) {
        addAutoTestLog(`检测到后端有正在运行的任务 (run_id=${status.runId || 'N/A'})，正在恢复状态...`);
        setIsPolling(true);
        updateTestStatus(status);
        startTestStatusPolling();
        
        // 同时获取已有的结果
        await fetchTestResults(status.runId);
      } else if (isComplete && status.runId > 0) {
        // 如果任务已完成，获取结果
        addAutoTestLog(`检测到后端有已完成的任务 (run_id=${status.runId})，正在加载结果...`);
        await fetchTestResults(status.runId);
      }
      
      // 加载历史测试列表
      await fetchHistoricalRuns();
      
      // 如果没有当前测试但有历史记录，自动加载最后一次测试
      if (!status.runId || status.runId === 0) {
        const historyResponse = await fetch('/api/test?action=listRuns&limit=1');
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          if (historyData.runs && historyData.runs.length > 0) {
            const lastRun = historyData.runs[0];
            addAutoTestLog(`自动加载最后一次测试 #${lastRun.runId}...`);
            setCurrentRunId(lastRun.runId);
            await fetchTestResults(lastRun.runId);
          }
        }
      }
    } catch (error) {
      console.error("检查运行状态失败:", error);
    }
  };
  
  // 获取历史测试列表
  const fetchHistoricalRuns = async () => {
    try {
      const response = await fetch('/api/test?action=listRuns&limit=20');
      if (!response.ok) return;
      
      const data = await response.json();
      if (data.runs) {
        setHistoricalRuns(data.runs.map((r: any) => ({
          runId: r.runId,
          status: r.state || r.status,
          startedAt: r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000).toLocaleString('zh-CN') : '',
          endedAt: r.completedAt?.seconds ? new Date(r.completedAt.seconds * 1000).toLocaleString('zh-CN') : undefined,
          totalCycles: r.totalSteps || 0,
        })));
      }
    } catch (error) {
      console.error('获取历史测试列表失败:', error);
    }
  };

  const loadConfig = async () => {
    try {
      const cfg = await getLoadCellConfig();
      setConfig({
        overflowThreshold: cfg.overflowThreshold,
        drainCompleteMargin: cfg.drainCompleteMargin,
        stableThreshold: cfg.stableThreshold,
        pumpMmToMl: cfg.pumpMmToMl || 0,
        pumpMmOffset: cfg.pumpMmOffset || 0,
        weightScale: cfg.weightScale || 1,
        weightOffset: cfg.weightOffset || 0,
      });
      // 同步更新称重标定配置中的泵系数
      if (cfg.pumpMmToMl) {
        setWeightCalibConfig(prev => ({
          ...prev,
          pumpMmToMl: cfg.pumpMmToMl,
          pumpMmOffset: cfg.pumpMmOffset || 0,
        }));
      }
      // 同时获取后端的动态空瓶值
      await fetchDynamicEmptyWeight();
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
  
  // 日志自动滚动（类似VSCode终端行为）
  useEffect(() => {
    if (autoScrollEnabled && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [autoTestLog, autoScrollEnabled]);
  
  const handleLogScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isAtBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 10;
    setAutoScrollEnabled(isAtBottom);
  }, []);

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
      setCalibrationMessage(result.message || "标定已保存到 printer.cfg，Klipper 正在重启...");
      // Klipper 重启需要更长时间，延长提示显示
      setTimeout(() => {
        setCalibrationStep("idle");
        setCalibrationMessage("");
        setIsPolling(false);
      }, 8000);
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

  // 纯前端去皮：记住当前重量作为偏移
  const handleTare = () => {
    if (reading && reading.isCalibrated) {
      setTareOffset(reading.weightGrams);
    }
  };
  
  // 清除去皮
  const handleClearTare = () => {
    setTareOffset(0);
  };
  
  // 计算去皮后的重量
  const taredWeight = reading ? reading.weightGrams - tareOffset : 0;
  
  // ============================================================
  // 多去皮点功能（进样一致性检测）
  // ============================================================
  
  // 添加去皮点
  const handleAddTarePoint = () => {
    if (reading && reading.isCalibrated) {
      const newPoint: TarePoint = {
        id: nextTareId,
        weight: reading.weightGrams,
        timestamp: new Date(),
        label: `#${nextTareId}`,
      };
      setTarePoints(prev => [...prev, newPoint]);
      setNextTareId(prev => prev + 1);
    }
  };
  
  // 删除去皮点
  const handleRemoveTarePoint = (id: number) => {
    setTarePoints(prev => prev.filter(p => p.id !== id));
  };
  
  // 清空所有去皮点
  const handleClearAllTarePoints = () => {
    setTarePoints([]);
    setNextTareId(1);
  };
  
  // 计算统计数据
  const tarePointsStats = tarePoints.length > 0 ? {
    mean: tarePoints.reduce((sum, p) => sum + p.weight, 0) / tarePoints.length,
    min: Math.min(...tarePoints.map(p => p.weight)),
    max: Math.max(...tarePoints.map(p => p.weight)),
    range: Math.max(...tarePoints.map(p => p.weight)) - Math.min(...tarePoints.map(p => p.weight)),
  } : null;
  
  // ============================================================
  // 自动测试功能
  // ============================================================
  
  const addAutoTestLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setAutoTestLog(prev => [...prev.slice(-50), `[${ts}] ${msg}`]);
  };
  
  // 等待重量稳定并接近目标值（带稳定窗口）
  // stabilityWindowSec: 稳态后继续等待的时间窗口（秒），如果在窗口内重量变化则刷新计时器
  const waitForWeight = async (
    targetWeight: number, 
    tolerance: number, 
    timeoutMs: number = 30000,
    stabilityWindowSec: number = 0 // 0表示不使用稳定窗口
  ): Promise<number> => {
    const startTime = Date.now();
    let stableCount = 0;
    let lastWeight = 0;
    let windowStartTime: number | null = null; // 稳定窗口开始时间
    let stableWeight = 0; // 稳定窗口内的基准重量
    
    while (Date.now() - startTime < timeoutMs) {
      if (autoTestAbortRef.current) throw new Error("测试已中止");
      
      const r = await getLoadCellReading();
      const currentWeight = r.weightGrams;
      
      // 检查是否在容差范围内且稳定
      if (Math.abs(currentWeight - targetWeight) <= tolerance && r.isStable) {
        if (Math.abs(currentWeight - lastWeight) < 1) {
          stableCount++;
          if (stableCount >= 3) {
            // 首次达到稳态
            if (stabilityWindowSec <= 0) {
              // 不使用稳定窗口，直接返回
              return currentWeight;
            }
            
            // 使用稳定窗口逻辑
            if (windowStartTime === null) {
              // 开始稳定窗口计时
              windowStartTime = Date.now();
              stableWeight = currentWeight;
              addAutoTestLog(`稳态检测: 开始 ${stabilityWindowSec}s 窗口等待 (当前 ${currentWeight.toFixed(1)}g)`);
            } else {
              // 检查是否在窗口内重量变化（达到新稳态）
              if (Math.abs(currentWeight - stableWeight) >= 0.5) {
                // 重量变化，刷新窗口计时器
                windowStartTime = Date.now();
                stableWeight = currentWeight;
                addAutoTestLog(`稳态检测: 检测到新稳态 (${currentWeight.toFixed(1)}g)，刷新窗口`);
              } else if (Date.now() - windowStartTime >= stabilityWindowSec * 1000) {
                // 窗口时间已过，确认稳态
                addAutoTestLog(`稳态检测: ${stabilityWindowSec}s 窗口完成，确认稳态 (${currentWeight.toFixed(1)}g)`);
                return currentWeight;
              }
            }
          }
        } else {
          stableCount = 0;
          // 重量变化较大，重置窗口
          if (windowStartTime !== null) {
            addAutoTestLog(`稳态检测: 重量变化较大，重置窗口`);
            windowStartTime = null;
          }
        }
      } else {
        stableCount = 0;
        // 不在容差范围或不稳定，重置窗口
        if (windowStartTime !== null) {
          windowStartTime = null;
        }
      }
      lastWeight = currentWeight;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`等待重量稳定超时 (目标: ${targetWeight}g ± ${tolerance}g)`);
  };
  
  // 等待称重稳定（不关心目标值）
  const waitForStable = async (timeoutMs: number = 30000): Promise<number> => {
    const startTime = Date.now();
    let stableCount = 0;
    let lastWeight = 0;
    
    while (Date.now() - startTime < timeoutMs) {
      if (autoTestAbortRef.current) throw new Error("测试已中止");
      
      const r = await getLoadCellReading();
      const currentWeight = r.weightGrams;
      
      if (r.isStable && Math.abs(currentWeight - lastWeight) < 1) {
        stableCount++;
        if (stableCount >= 3) {
          return currentWeight;
        }
      } else {
        stableCount = 0;
      }
      lastWeight = currentWeight;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("等待称重稳定超时");
  };
  
  // 等待空瓶稳定并自动更新空瓶值（调用后端API）
  const waitForEmptyBottle = async (
    tolerance: number = autoTestConfig.emptyTolerance,
    timeoutMs: number = 60000,
    stabilityWindowSec: number = autoTestConfig.drainStabilityWindow
  ): Promise<number> => {
    addAutoTestLog(`空瓶检测: 调用后端API (容差=${tolerance}g, 超时=${timeoutMs/1000}s, 窗口=${stabilityWindowSec}s)`);
    
    const response = await fetch('/api/load-cell/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'waitForEmptyBottle',
        tolerance,
        timeoutSec: timeoutMs / 1000,
        stabilityWindowSec,
      }),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.errorMessage || '等待空瓶稳定失败');
    }
    
    // 更新前端状态
    setDynamicEmptyWeight(result.emptyWeight);
    addAutoTestLog(`空瓶检测: 完成，空瓶值=${result.emptyWeight.toFixed(1)}g`);
    return result.emptyWeight;
  };
  
  // 重置动态空瓶值（调用后端API）
  const resetDynamicEmptyWeight = async () => {
    await fetch('/api/load-cell/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resetDynamicEmptyWeight' }),
    });
    setDynamicEmptyWeight(null);
    addAutoTestLog("动态空瓶值已重置");
  };
  
  // 获取后端动态空瓶值
  const fetchDynamicEmptyWeight = async () => {
    const response = await fetch('/api/load-cell/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getDynamicEmptyWeight' }),
    });
    const result = await response.json();
    if (result.hasValue) {
      setDynamicEmptyWeight(result.emptyWeight);
    } else {
      setDynamicEmptyWeight(null);
    }
  };
  
  // 执行单次循环
  const runSingleCycle = async (paramSet: ParamSet, cycleNum: number): Promise<AutoTestResult> => {
    const { params, name, speed } = paramSet;
    const totalVolume = params.pump0Volume + params.pump1Volume + params.pump2Volume + params.pump3Volume + params.pump4Volume + params.pump5Volume + params.pump6Volume + params.pump7Volume;
    const cycleStartTime = Date.now();
    
    // 步骤1: 排废
    const drainStartTime = Date.now();
    addAutoTestLog(`[${name}] 循环 ${cycleNum}: 开始排废...`);
    setAutoTestStep("draining");
    await setSystemState("DRAIN");
    
    // 步骤2: 等待空瓶重量稳定
    const waitEmptyStartTime = Date.now();
    const drainDuration = waitEmptyStartTime - drainStartTime;
    addAutoTestLog(`[${name}] 循环 ${cycleNum}: 等待空瓶稳定... (排废耗时 ${(drainDuration/1000).toFixed(1)}s)`);
    setAutoTestStep("waiting_empty");
    const emptyWeight = await waitForEmptyBottle();
    const waitEmptyDuration = Date.now() - waitEmptyStartTime;
    
    // 排废完成后切换回初始状态停止排废
    await setSystemState("INITIAL");
    
    // 步骤3: 记录空瓶重量
    addAutoTestLog(`[${name}] 循环 ${cycleNum}: 空瓶重量 ${emptyWeight.toFixed(1)}g (等待空瓶 ${(waitEmptyDuration/1000).toFixed(1)}s)`);
    setAutoTestStep("recording_empty");
    setAutoTestEmptyWeight(emptyWeight);
    
    // 步骤4: 进样（使用参数组的速度）
    const injectStartTime = Date.now();
    addAutoTestLog(`[${name}] 循环 ${cycleNum}: 开始进样 (总量 ${totalVolume}mm, 速度 ${speed}mm/s)...`);
    setAutoTestStep("injecting");
    await setSystemState("INJECT");
    await startInjection({
      pump0Volume: params.pump0Volume,
      pump1Volume: params.pump1Volume,
      pump2Volume: params.pump2Volume,
      pump3Volume: params.pump3Volume,
      pump4Volume: params.pump4Volume,
      pump5Volume: params.pump5Volume,
      pump6Volume: params.pump6Volume,
      pump7Volume: params.pump7Volume,
      speed: speed, // 使用参数组的速度
      accel: autoTestConfig.accel,
    });
    
    // 等待进样完成（给蠕动泵运动时间）
    const estimatedTime = Math.max(
      params.pump0Volume,
      params.pump1Volume,
      params.pump2Volume,
      params.pump3Volume,
      params.pump4Volume,
      params.pump5Volume,
      params.pump6Volume,
      params.pump7Volume
    ) / speed * 1000 + 2000;
    await new Promise(resolve => setTimeout(resolve, estimatedTime));
    const injectDuration = Date.now() - injectStartTime;
    
    // 步骤5: 等待称重稳定
    const waitStableStartTime = Date.now();
    addAutoTestLog(`[${name}] 循环 ${cycleNum}: 等待进样后稳定... (进样耗时 ${(injectDuration/1000).toFixed(1)}s)`);
    setAutoTestStep("waiting_stable");
    const fullWeight = await waitForStable(30000);
    const waitStableDuration = Date.now() - waitStableStartTime;
    
    // 步骤6: 记录结果
    const injectedWeight = fullWeight - emptyWeight;
    const totalDuration = Date.now() - cycleStartTime;
    addAutoTestLog(`[${name}] 循环 ${cycleNum}: 进样后重量 ${fullWeight.toFixed(1)}g, 进样量 ${injectedWeight.toFixed(1)}g (稳定 ${(waitStableDuration/1000).toFixed(1)}s, 总计 ${(totalDuration/1000).toFixed(1)}s)`);
    setAutoTestStep("recording_full");
    
    return {
      paramSetId: paramSet.id,
      paramSetName: name,
      cycle: cycleNum,
      totalVolume,
      pump0Volume: params.pump0Volume,
      pump1Volume: params.pump1Volume,
      pump2Volume: params.pump2Volume,
      pump3Volume: params.pump3Volume,
      pump4Volume: params.pump4Volume,
      pump5Volume: params.pump5Volume,
      pump6Volume: params.pump6Volume,
      pump7Volume: params.pump7Volume,
      speed,
      emptyWeight,
      fullWeight,
      injectedWeight,
      timestamp: new Date(),
      drainDuration,
      waitEmptyDuration,
      injectDuration,
      waitStableDuration,
      totalDuration,
    };
  };
  
  // 计算总循环数
  const totalCycles = autoTestConfig.paramSets.reduce((sum, ps) => sum + ps.cycles, 0);
  
  // 开始自动测试 (调用后端API)
  const handleStartAutoTest = async () => {
    if (autoTestStep !== "idle") return;
    
    setAutoTestResults([]);
    setAutoTestLog([]);
    setAutoTestCurrentCycle(0);
    setAutoTestCurrentParamSet(0);
    setIsPolling(true);
    
    // 构建后端请求配置
    const enabledParamSets = autoTestConfig.paramSets.filter(ps => ps.cycles > 0);
    
    // 初始化总数（后端轮询会更新为实际值）
    setAutoTestTotalParamSets(enabledParamSets.length);
    setAutoTestTotalCycles(enabledParamSets.reduce((sum, ps) => sum + ps.cycles, 0));
    const config = {
      paramSets: enabledParamSets.map(ps => ({
        id: ps.id,
        name: ps.name,
        pump0Volume: ps.params.pump0Volume,
        pump1Volume: ps.params.pump1Volume,
        pump2Volume: ps.params.pump2Volume,
        pump3Volume: ps.params.pump3Volume,
        pump4Volume: ps.params.pump4Volume,
        pump5Volume: ps.params.pump5Volume,
        pump6Volume: ps.params.pump6Volume,
        pump7Volume: ps.params.pump7Volume,
        speed: ps.speed,
        cycles: ps.cycles,
      })),
      accel: autoTestConfig.accel,
      emptyTolerance: autoTestConfig.emptyTolerance,
      drainStabilityWindow: autoTestConfig.drainStabilityWindow,
    };
    
    try {
      // 调用后端启动测试
      const response = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', config }),
      });
      
      if (!response.ok) {
        throw new Error('启动测试失败');
      }
      
      addAutoTestLog(`开始自动测试 (后端控制)，${enabledParamSets.length} 组参数，共 ${totalCycles} 个循环`);
      setAutoTestStep("draining");
      
      // 开始轮询测试状态
      startTestStatusPolling();
    } catch (error) {
      addAutoTestLog(`错误: ${error}`);
      setAutoTestStep("idle");
    }
  };
  
  // 轮询测试状态
  const testPollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastLogCountRef = useRef(0);
  
  const startTestStatusPolling = () => {
    if (testPollingRef.current) {
      clearInterval(testPollingRef.current);
    }
    lastLogCountRef.current = 0;
    
    let lastResultFetchTime = 0;
    testPollingRef.current = setInterval(async () => {
      try {
        const response = await fetch('/api/test');
        if (!response.ok) return;
        
        const status = await response.json();
        
        // 更新状态 (包含 run_id)
        updateTestStatus(status);
        
        // 每2秒获取一次结果以更新图表（使用 run_id 从数据库获取）
        const now = Date.now();
        if (now - lastResultFetchTime > 2000) {
          await fetchTestResults(status.runId);
          lastResultFetchTime = now;
        }
        
        // 检查是否完成 (使用数字枚举值: IDLE=1, COMPLETE=6, ERROR=7)
        const stateVal = typeof status.state === 'number' ? status.state : -1;
        const isIdle = stateVal === 1;
        const isComplete = stateVal === 6;
        const isError = stateVal === 7;
        
        if (isIdle || isComplete || isError) {
          stopTestStatusPolling();
          
          if (isComplete) {
            setAutoTestStep("complete");
            // 获取最终结果
            await fetchTestResults(status.runId);
            // 刷新历史测试列表
            await fetchHistoricalRuns();
            setTimeout(() => setAutoTestStep("idle"), 3000);
          } else if (isError) {
            setAutoTestStep("idle");
            // 刷新历史测试列表
            await fetchHistoricalRuns();
          } else {
            setAutoTestStep("idle");
          }
        }
      } catch (error) {
        console.error('轮询测试状态失败:', error);
      }
    }, 500);
  };
  
  const stopTestStatusPolling = () => {
    if (testPollingRef.current) {
      clearInterval(testPollingRef.current);
      testPollingRef.current = null;
    }
  };
  
  const updateTestStatus = (status: any) => {
    // 更新 run_id
    if (status.runId && status.runId > 0) {
      setCurrentRunId(status.runId);
    }
    
    // 更新进度（使用后端返回的值）
    setAutoTestCurrentParamSet(status.currentParamSet || 0);
    setAutoTestCurrentCycle(status.globalCycle || 0);
    setAutoTestTotalParamSets(status.totalParamSets || 0);
    setAutoTestTotalCycles(status.globalTotalCycles || 0);
    
    // 更新动态空瓶值
    if (status.hasDynamicEmptyWeight) {
      setDynamicEmptyWeight(status.dynamicEmptyWeight);
    }
    
    // Proto 枚举值: UNSPECIFIED=0, IDLE=1, DRAINING=2, WAITING_EMPTY=3, INJECTING=4, WAITING_STABLE=5, COMPLETE=6, ERROR=7, STOPPING=8
    const numericStateMap: Record<number, AutoTestStep> = {
      2: 'draining',       // TEST_DRAINING
      3: 'waiting_empty',  // TEST_WAITING_EMPTY
      4: 'injecting',      // TEST_INJECTING
      5: 'waiting_stable', // TEST_WAITING_STABLE
      6: 'complete',       // TEST_COMPLETE
      8: 'draining',       // TEST_STOPPING
    };
    
    const stateValue = typeof status.state === 'number' ? status.state : -1;
    
    if (numericStateMap[stateValue]) {
      setAutoTestStep(numericStateMap[stateValue]);
    } else if (stateValue > 1 && stateValue < 6) {
      // 运行中状态，默认显示为 draining
      setAutoTestStep('draining');
    }
    // IDLE(1), ERROR(7), UNSPECIFIED(0) 不改变 autoTestStep
    
    // 添加新日志
    if (status.logs && status.logs.length > lastLogCountRef.current) {
      const newLogs = status.logs.slice(lastLogCountRef.current);
      newLogs.forEach((log: string) => addAutoTestLog(log));
      lastLogCountRef.current = status.logs.length;
    }
  };
  
  const fetchTestResults = async (runId?: number) => {
    try {
      // 如果指定了 runId，从数据库获取；否则从内存获取当前测试结果
      const targetRunId = runId || currentRunId;
      
      let response;
      if (targetRunId && targetRunId > 0) {
        // 从数据库获取历史结果
        response = await fetch('/api/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getRunResults', runId: targetRunId }),
        });
      } else {
        // 从内存获取当前结果
        response = await fetch('/api/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getResults' }),
        });
      }
      
      if (!response.ok) return;
      
      const data = await response.json();
      if (data.results) {
        const results: AutoTestResult[] = data.results.map((r: any) => ({
          paramSetId: r.paramSetId,
          paramSetName: r.paramSetName,
          cycle: r.cycle,
          totalVolume: r.totalVolume,
          pump2Volume: r.pump2Volume,
          pump3Volume: r.pump3Volume,
          pump4Volume: r.pump4Volume,
          pump5Volume: r.pump5Volume,
          speed: r.speed,
          emptyWeight: r.emptyWeight,
          fullWeight: r.fullWeight,
          injectedWeight: r.injectedWeight,
          timestamp: new Date(r.timestamp?.seconds ? r.timestamp.seconds * 1000 : Date.now()),
          drainDuration: r.drainDurationMs || 0,
          waitEmptyDuration: r.waitEmptyDurationMs || 0,
          injectDuration: r.injectDurationMs || 0,
          waitStableDuration: r.waitStableDurationMs || 0,
          totalDuration: r.totalDurationMs || 0,
        }));
        setAutoTestResults(results);
      }
    } catch (error) {
      console.error('获取测试结果失败:', error);
    }
  };
  
  // 查看历史测试
  const viewHistoricalRun = async (runId: number) => {
    setViewingHistoryRunId(runId);
    addAutoTestLog(`加载历史测试 #${runId}...`);
    
    // 获取测试详情（包含 config_json）
    try {
      const response = await fetch(`/api/test?action=getRun&runId=${runId}`);
      if (response.ok) {
        const runDetail = await response.json();
        
        // 解析 config_json 并更新前端配置
        if (runDetail.configJson) {
          try {
            const config = JSON.parse(runDetail.configJson);
            if (config.param_sets && Array.isArray(config.param_sets)) {
              // 更新总数显示
              setAutoTestTotalParamSets(config.param_sets.length);
              const totalCycles = config.param_sets.reduce((sum: number, ps: any) => sum + (ps.cycles || 0), 0);
              setAutoTestTotalCycles(totalCycles);
              
              // 转换为前端格式并更新配置
              const paramSets = config.param_sets.map((ps: any, idx: number) => ({
                id: ps.id || idx + 1,
                name: ps.name || `参数组${idx + 1}`,
                params: {
                  pump0Volume: ps.pump0_volume || 0,
                  pump1Volume: ps.pump1_volume || 0,
                  pump2Volume: ps.pump2_volume || 0,
                  pump3Volume: ps.pump3_volume || 0,
                  pump4Volume: ps.pump4_volume || 0,
                  pump5Volume: ps.pump5_volume || 0,
                  pump6Volume: ps.pump6_volume || 0,
                  pump7Volume: ps.pump7_volume || 0,
                },
                speed: ps.speed || 100,
                cycles: ps.cycles || 0,
              }));
              
              setAutoTestConfig(prev => ({
                ...prev,
                paramSets,
                accel: config.accel || prev.accel,
                emptyTolerance: config.empty_tolerance || prev.emptyTolerance,
                drainStabilityWindow: config.drain_stability_window || prev.drainStabilityWindow,
              }));
            }
          } catch (parseError) {
            console.error('解析 config_json 失败:', parseError);
          }
        }
        
        // 更新进度显示
        setAutoTestCurrentParamSet(runDetail.currentStep || 0);
        setAutoTestCurrentCycle(runDetail.currentStep || 0);
      }
    } catch (error) {
      console.error('获取测试详情失败:', error);
    }
    
    await fetchTestResults(runId);
  };
  
  // 返回当前测试
  const backToCurrentRun = async () => {
    setViewingHistoryRunId(null);
    if (currentRunId) {
      await fetchTestResults(currentRunId);
    } else {
      setAutoTestResults([]);
    }
  };
  
  // 停止自动测试 (调用后端API)
  const handleStopAutoTest = async () => {
    addAutoTestLog("正在停止测试...");
    
    try {
      await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    } catch (error) {
      console.error('停止测试失败:', error);
    }
    
    stopTestStatusPolling();
    setAutoTestStep("idle");
  };
  
  // 组件卸载时清理轮询
  useEffect(() => {
    return () => {
      stopTestStatusPolling();
    };
  }, []);
  
  // ============================================================
  // 高级测试函数
  // ============================================================
  
  // 管路死区检测
  const runDeadZoneTest = async () => {
    if (advancedTestRunning) return;
    advancedTestAbortRef.current = false;
    setAdvancedTestRunning(true);
    setDeadZoneResults([]);
    setIsPolling(true);
    
    // 重置动态空瓶值
    await resetDynamicEmptyWeight();
    
    addAutoTestLog("=== 开始管路死区检测 ===");
    
    try {
      for (const pumpId of deadZoneConfig.pumpIds) {
        for (let cycle = 1; cycle <= deadZoneConfig.cycles; cycle++) {
          if (advancedTestAbortRef.current) break;
          
          addAutoTestLog(`[泵${pumpId}] 循环 ${cycle}: 排废中...`);
          await setSystemState("DRAIN");
          await waitForEmptyBottle();
          await setSystemState("INITIAL");
          
          // 记录基准重量
          const baseWeight = await waitForStable(5000);
          addAutoTestLog(`[泵${pumpId}] 循环 ${cycle}: 基准重量 ${baseWeight.toFixed(2)}g`);
          
          // 逐步进样直到检测到液体
          let totalVolume = 0;
          let detected = false;
          
          await setSystemState("INJECT");
          while (totalVolume < deadZoneConfig.maxVolume && !detected && !advancedTestAbortRef.current) {
            totalVolume += deadZoneConfig.stepVolume;
            
            // 构建单泵进样参数
            const params: any = { pump0Volume: 0, pump1Volume: 0, pump2Volume: 0, pump3Volume: 0, pump4Volume: 0, pump5Volume: 0, pump6Volume: 0, pump7Volume: 0 };
            params[`pump${pumpId}Volume`] = deadZoneConfig.stepVolume;
            
            await startInjection({ ...params, speed: deadZoneConfig.speed, accel: 100 });
            await new Promise(r => setTimeout(r, deadZoneConfig.stepVolume / deadZoneConfig.speed * 1000 + 500));
            
            const currentWeight = await waitForStable(3000);
            const weightChange = currentWeight - baseWeight;
            
            if (weightChange >= deadZoneConfig.detectionThreshold) {
              detected = true;
              addAutoTestLog(`[泵${pumpId}] 循环 ${cycle}: 死区 ${totalVolume}mm, 首滴重量变化 ${weightChange.toFixed(2)}g`);
              
              setDeadZoneResults(prev => [...prev, {
                cycle,
                pumpId,
                deadZoneVolume: totalVolume,
                firstDropWeight: weightChange,
                timestamp: new Date(),
              }]);
            }
          }
          
          if (!detected) {
            addAutoTestLog(`[泵${pumpId}] 循环 ${cycle}: 未检测到液体（已达最大量 ${deadZoneConfig.maxVolume}mm）`);
          }
          
          await setSystemState("INITIAL");
        }
        if (advancedTestAbortRef.current) break;
      }
      
      addAutoTestLog("=== 管路死区检测完成 ===");
    } catch (error) {
      addAutoTestLog(`错误: ${error}`);
    } finally {
      await setSystemState("INITIAL");
      setAdvancedTestRunning(false);
    }
  };
  
  // 分辨率检测
  const runResolutionTest = async () => {
    if (advancedTestRunning) return;
    advancedTestAbortRef.current = false;
    setAdvancedTestRunning(true);
    setResolutionResults([]);
    setIsPolling(true);
    
    // 重置动态空瓶值
    await resetDynamicEmptyWeight();
    
    addAutoTestLog(`=== 开始分辨率检测 (${resolutionConfig.testMode === 'single' ? '单电机' : '多电机'}) ===`);
    
    try {
      // 首先排废并加入基准液体
      addAutoTestLog("排废并准备基准液体...");
      await setSystemState("DRAIN");
      await waitForEmptyBottle();
      await setSystemState("INITIAL");
      
      // 进样一定量作为基准（没过管子下段，避免液滴波动干扰）
      addAutoTestLog(`进样基准液体 ${resolutionConfig.baseVolume}mm (没过管子)...`);
      await setSystemState("INJECT");
      if (resolutionConfig.testMode === 'single') {
        const params: any = { pump0Volume: 0, pump1Volume: 0, pump2Volume: 0, pump3Volume: 0, pump4Volume: 0, pump5Volume: 0, pump6Volume: 0, pump7Volume: 0 };
        params[`pump${resolutionConfig.pumpId}Volume`] = resolutionConfig.baseVolume;
        await startInjection({ ...params, speed: resolutionConfig.speed, accel: 100 });
      } else {
        const vol = resolutionConfig.baseVolume / 8;
        await startInjection({ pump0Volume: vol, pump1Volume: vol, pump2Volume: vol, pump3Volume: vol, pump4Volume: vol, pump5Volume: vol, pump6Volume: vol, pump7Volume: vol, speed: resolutionConfig.speed, accel: 100 });
      }
      await new Promise(r => setTimeout(r, resolutionConfig.baseVolume / resolutionConfig.speed * 1000 + 2000));
      // 保持INJECT状态，整个测试过程不切换，避免液路不密封导致液滴下滴
      
      // 从testStartVolume开始，以stepVolume递减测试
      addAutoTestLog(`开始测试: ${resolutionConfig.testStartVolume}mm → ${resolutionConfig.minVolume}mm (步长 ${resolutionConfig.stepVolume}mm)`);
      let currentVolume = resolutionConfig.testStartVolume;
      let consecutiveFails = 0;
      
      while (currentVolume >= resolutionConfig.minVolume && consecutiveFails < 3 && !advancedTestAbortRef.current) {
        addAutoTestLog(`测试进样量: ${currentVolume}mm (${resolutionConfig.cycles}次)`);
        
        let detectedCount = 0;
        for (let cycle = 1; cycle <= resolutionConfig.cycles; cycle++) {
          if (advancedTestAbortRef.current) break;
          
          const baseWeight = await waitForStable(3000);
          
          // 进样（保持在INJECT状态，不切换，避免液路不密封导致液滴下滴）
          if (resolutionConfig.testMode === 'single') {
            const params: any = { pump0Volume: 0, pump1Volume: 0, pump2Volume: 0, pump3Volume: 0, pump4Volume: 0, pump5Volume: 0, pump6Volume: 0, pump7Volume: 0 };
            params[`pump${resolutionConfig.pumpId}Volume`] = currentVolume;
            await startInjection({ ...params, speed: resolutionConfig.speed, accel: 100 });
          } else {
            const vol = currentVolume / 8;
            await startInjection({ pump0Volume: vol, pump1Volume: vol, pump2Volume: vol, pump3Volume: vol, pump4Volume: vol, pump5Volume: vol, pump6Volume: vol, pump7Volume: vol, speed: resolutionConfig.speed, accel: 100 });
          }
          await new Promise(r => setTimeout(r, currentVolume / resolutionConfig.speed * 1000 + 1000));
          // 不切换状态，保持液路密封
          
          const newWeight = await waitForStable(3000);
          const weightChange = newWeight - baseWeight;
          const detected = weightChange >= resolutionConfig.detectionThreshold;
          
          if (detected) detectedCount++;
          
          setResolutionResults(prev => [...prev, {
            cycle,
            testMode: resolutionConfig.testMode,
            pumpId: resolutionConfig.testMode === 'single' ? resolutionConfig.pumpId : undefined,
            volumeStep: currentVolume,
            baseWeight,
            injectedWeight: weightChange,
            detected,
            timestamp: new Date(),
          }]);
          
          addAutoTestLog(`  循环 ${cycle}: ${detected ? '✓' : '✗'} 重量变化 ${weightChange.toFixed(2)}g`);
        }
        
        const successRate = detectedCount / resolutionConfig.cycles;
        addAutoTestLog(`  成功率: ${(successRate * 100).toFixed(0)}% (${detectedCount}/${resolutionConfig.cycles})`);
        
        if (successRate < 0.8) {
          consecutiveFails++;
        } else {
          consecutiveFails = 0;
        }
        
        currentVolume -= resolutionConfig.stepVolume;
      }
      
      addAutoTestLog("=== 分辨率检测完成 ===");
    } catch (error) {
      addAutoTestLog(`错误: ${error}`);
    } finally {
      await setSystemState("INITIAL");
      setAdvancedTestRunning(false);
    }
  };
  
  // 线性度检测
  const runLinearityTest = async () => {
    if (advancedTestRunning) return;
    advancedTestAbortRef.current = false;
    setAdvancedTestRunning(true);
    setLinearityResults([]);
    setIsPolling(true);
    
    // 重置动态空瓶值
    await resetDynamicEmptyWeight();
    
    const modeLabel = linearityConfig.testMode === 'single' ? `单电机(泵${linearityConfig.pumpId})` : '多电机';
    addAutoTestLog(`=== 开始线性度检测 (${modeLabel}) ===`);
    addAutoTestLog(`测试进样量序列: ${linearityConfig.volumeSteps.join(', ')}mm, 每量${linearityConfig.cycles}次`);
    
    try {
      for (const setVolume of linearityConfig.volumeSteps) {
        if (advancedTestAbortRef.current) break;
        
        addAutoTestLog(`--- 测试进样量: ${setVolume}mm ---`);
        
        for (let cycle = 1; cycle <= linearityConfig.cycles; cycle++) {
          if (advancedTestAbortRef.current) break;
          
          // 排废
          addAutoTestLog(`  循环 ${cycle}: 排废中...`);
          await setSystemState("DRAIN");
          await waitForEmptyBottle();
          await setSystemState("INITIAL");
          
          // 记录空瓶重量
          const emptyWeight = await waitForStable(3000);
          
          // 进样
          await setSystemState("INJECT");
          if (linearityConfig.testMode === 'single') {
            const params: any = { pump0Volume: 0, pump1Volume: 0, pump2Volume: 0, pump3Volume: 0, pump4Volume: 0, pump5Volume: 0, pump6Volume: 0, pump7Volume: 0 };
            params[`pump${linearityConfig.pumpId}Volume`] = setVolume;
            await startInjection({ ...params, speed: linearityConfig.speed, accel: autoTestConfig.accel });
          } else {
            // 多电机模式：8个泵平分进样量
            const volumePerPump = Math.round(setVolume / 8);
            await startInjection({
              pump0Volume: volumePerPump,
              pump1Volume: volumePerPump,
              pump2Volume: volumePerPump,
              pump3Volume: volumePerPump,
              pump4Volume: volumePerPump,
              pump5Volume: volumePerPump,
              pump6Volume: volumePerPump,
              pump7Volume: volumePerPump,
              speed: linearityConfig.speed,
              accel: autoTestConfig.accel,
            });
          }
          
          // 等待进样完成
          const injectionTime = setVolume / linearityConfig.speed * 1000 + 1000;
          await new Promise(r => setTimeout(r, injectionTime));
          await setSystemState("INITIAL");
          
          // 等待稳定并记录重量
          const fullWeight = await waitForStable(5000);
          const actualWeight = fullWeight - emptyWeight;
          
          setLinearityResults(prev => [...prev, {
            setVolume,
            actualWeight,
            cycle,
            pumpId: linearityConfig.testMode === 'single' ? linearityConfig.pumpId : undefined,
            timestamp: new Date(),
          }]);
          
          addAutoTestLog(`  循环 ${cycle}: 设定${setVolume}mm → 实际${actualWeight.toFixed(2)}g`);
        }
      }
      
      addAutoTestLog("=== 线性度检测完成 ===");
    } catch (error) {
      addAutoTestLog(`错误: ${error}`);
    } finally {
      await setSystemState("INITIAL");
      setAdvancedTestRunning(false);
    }
  };
  
  // 称重标定测试
  const runWeightCalibrationTest = async () => {
    if (advancedTestRunning) return;
    advancedTestAbortRef.current = false;
    setAdvancedTestRunning(true);
    setWeightCalibResults([]);
    setWeightCalibStep('idle');
    setWeightCalibCurrentIndex(0);
    setIsPolling(true);
    
    // 重置动态空瓶值
    await resetDynamicEmptyWeight();
    
    const modeLabel = weightCalibConfig.testMode === 'single' ? `单电机(泵${weightCalibConfig.pumpId})` : '多电机';
    addAutoTestLog(`=== 开始称重标定测试 (${modeLabel}) ===`);
    addAutoTestLog(`测试进样量序列: ${weightCalibConfig.volumeSteps.join(', ')}mm`);
    
    try {
      for (let idx = 0; idx < weightCalibConfig.volumeSteps.length; idx++) {
        if (advancedTestAbortRef.current) break;
        
        const setVolume = weightCalibConfig.volumeSteps[idx];
        setWeightCalibCurrentIndex(idx);
        
        addAutoTestLog(`--- 测试 ${idx + 1}/${weightCalibConfig.volumeSteps.length}: ${setVolume}mm ---`);
        
        // 排废
        setWeightCalibStep('draining');
        addAutoTestLog(`  排废中...`);
        await setSystemState("DRAIN");
        await waitForEmptyBottle();
        await setSystemState("INITIAL");
        
        // 记录空瓶重量
        const emptyWeight = await waitForStable(3000);
        addAutoTestLog(`  空瓶重量: ${emptyWeight.toFixed(2)}g`);
        
        // 进样
        setWeightCalibStep('injecting');
        await setSystemState("INJECT");
        if (weightCalibConfig.testMode === 'single') {
          const params: any = { pump0Volume: 0, pump1Volume: 0, pump2Volume: 0, pump3Volume: 0, pump4Volume: 0, pump5Volume: 0, pump6Volume: 0, pump7Volume: 0 };
          params[`pump${weightCalibConfig.pumpId}Volume`] = setVolume;
          await startInjection({ ...params, speed: weightCalibConfig.speed, accel: autoTestConfig.accel });
        } else {
          // 多电机模式：8个泵平分进样量
          const volumePerPump = Math.round(setVolume / 8);
          await startInjection({
            pump0Volume: volumePerPump,
            pump1Volume: volumePerPump,
            pump2Volume: volumePerPump,
            pump3Volume: volumePerPump,
            pump4Volume: volumePerPump,
            pump5Volume: volumePerPump,
            pump6Volume: volumePerPump,
            pump7Volume: volumePerPump,
            speed: weightCalibConfig.speed,
            accel: autoTestConfig.accel,
          });
        }
        
        // 等待进样完成
        const injectionTime = setVolume / weightCalibConfig.speed * 1000 + 1000;
        await new Promise(r => setTimeout(r, injectionTime));
        await setSystemState("INITIAL");
        
        // 等待稳定并记录重量
        const fullWeight = await waitForStable(5000);
        const measuredWeight = fullWeight - emptyWeight;
        
        // 计算ml值
        const mlValue = setVolume * weightCalibConfig.pumpMmToMl + weightCalibConfig.pumpMmOffset;
        
        // 记录结果
        setWeightCalibResults(prev => [...prev, {
          index: idx,
          setVolumeMm: setVolume,
          setVolumeMl: mlValue,
          measuredWeight,
          realWeight: null,
          timestamp: new Date(),
        }]);
        
        addAutoTestLog(`  称重变化: ${measuredWeight.toFixed(2)}g (计算ml: ${mlValue.toFixed(2)})`);
        
        // 等待用户接液
        setWeightCalibStep('waiting_user');
        addAutoTestLog(`  ⏸️ 请准备好接液容器，点击"继续"后将排废`);
        
        // 等待用户点击继续
        await new Promise<void>(resolve => {
          weightCalibContinueRef.current = resolve;
        });
        weightCalibContinueRef.current = null;
        
        if (advancedTestAbortRef.current) break;
        
        // 排废让用户接液测量真实重量
        addAutoTestLog(`  用户已确认，正在排废...`);
        setWeightCalibStep('draining');
        await setSystemState("DRAIN");
        await waitForEmptyBottle();
        await setSystemState("INITIAL");
        addAutoTestLog(`  排废完成，请称量接到的液体重量并填入表格`);
      }
      
      addAutoTestLog("=== 称重标定测试完成 ===");
      addAutoTestLog("请在表格中输入真实重量值，然后保存校准系数");
    } catch (error) {
      addAutoTestLog(`错误: ${error}`);
    } finally {
      setWeightCalibStep('idle');
      await setSystemState("INITIAL");
      setAdvancedTestRunning(false);
    }
  };
  
  // 用户点击继续按钮
  const handleWeightCalibContinue = () => {
    if (weightCalibContinueRef.current) {
      weightCalibContinueRef.current();
    }
  };
  
  // 更新真实重量值
  const updateWeightCalibRealWeight = (index: number, value: number | null) => {
    setWeightCalibResults(prev => prev.map(r => 
      r.index === index ? { ...r, realWeight: value } : r
    ));
  };
  
  // 停止高级测试
  const handleStopAdvancedTest = async () => {
    advancedTestAbortRef.current = true;
    addAutoTestLog("正在停止高级测试...");
    await setSystemState("INITIAL");
    setAdvancedTestRunning(false);
  };
  
  // 自动测试结果统计（按参数组分组）
  const autoTestStatsByParamSet = autoTestConfig.paramSets.map(ps => {
    const results = autoTestResults.filter(r => r.paramSetId === ps.id);
    if (results.length === 0) return null;
    const mean = results.reduce((sum, r) => sum + r.injectedWeight, 0) / results.length;
    return {
      paramSetId: ps.id,
      name: ps.name,
      totalVolume: results[0]?.totalVolume || 0,
      count: results.length,
      meanInjected: mean,
      minInjected: Math.min(...results.map(r => r.injectedWeight)),
      maxInjected: Math.max(...results.map(r => r.injectedWeight)),
      rangeInjected: Math.max(...results.map(r => r.injectedWeight)) - Math.min(...results.map(r => r.injectedWeight)),
      stdDev: Math.sqrt(results.reduce((sum, r) => sum + Math.pow(r.injectedWeight - mean, 2), 0) / results.length),
    };
  }).filter(Boolean);
  
  // 总体统计
  const autoTestStats = autoTestResults.length > 0 ? {
    meanInjected: autoTestResults.reduce((sum, r) => sum + r.injectedWeight, 0) / autoTestResults.length,
    minInjected: Math.min(...autoTestResults.map(r => r.injectedWeight)),
    maxInjected: Math.max(...autoTestResults.map(r => r.injectedWeight)),
    rangeInjected: Math.max(...autoTestResults.map(r => r.injectedWeight)) - Math.min(...autoTestResults.map(r => r.injectedWeight)),
    stdDev: Math.sqrt(
      autoTestResults.reduce((sum, r) => {
        const mean = autoTestResults.reduce((s, x) => s + x.injectedWeight, 0) / autoTestResults.length;
        return sum + Math.pow(r.injectedWeight - mean, 2);
      }, 0) / autoTestResults.length
    ),
  } : null;
  
  // 颜色配置
  const chartColors = {
    primary: '#6366f1',    // indigo
    success: '#10b981',    // emerald
    warning: '#f59e0b',    // amber
    danger: '#ef4444',     // red
    info: '#06b6d4',       // cyan
    purple: '#8b5cf6',     // violet
    pink: '#ec4899',       // pink
  };
  
  // 按参数组分组的柱状图
  const barChartOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const r = autoTestResults[params[0]?.dataIndex];
        if (!r) return '';
        return `<div style="font-size:12px">
          <div style="font-weight:bold">${r.paramSetName} #${r.cycle}</div>
          <div>速度: ${r.speed}mm/s</div>
          <div>泵0-7: ${r.pump0Volume}/${r.pump1Volume}/${r.pump2Volume}/${r.pump3Volume}/${r.pump4Volume}/${r.pump5Volume}/${r.pump6Volume}/${r.pump7Volume}mm</div>
          <div>设定总量: ${r.totalVolume}mm</div>
          <div>实际进样: <b>${r.injectedWeight.toFixed(1)}g</b></div>
          <div>空瓶→进样后: ${r.emptyWeight.toFixed(1)}g → ${r.fullWeight.toFixed(1)}g</div>
        </div>`;
      }
    },
    grid: { left: 50, right: 50, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: autoTestResults.map(r => `${r.paramSetName}\n#${r.cycle}`),
      axisLabel: { fontSize: 10, interval: 0 },
      axisTick: { alignWithLabel: true },
    },
    yAxis: [
      {
        type: 'value',
        name: '进样量 (g)',
        position: 'left',
        axisLine: { show: true, lineStyle: { color: chartColors.primary } },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      {
        type: 'value',
        name: '重量 (g)',
        position: 'right',
        axisLine: { show: true, lineStyle: { color: chartColors.success } },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '进样量',
        type: 'bar',
        data: autoTestResults.map(r => ({
          value: r.injectedWeight,
          itemStyle: {
            color: r.paramSetId === 1 ? chartColors.primary :
                   r.paramSetId === 2 ? chartColors.info :
                   r.paramSetId === 3 ? chartColors.purple : chartColors.pink,
          }
        })),
        barMaxWidth: 40,
        label: {
          show: true,
          position: 'top',
          formatter: (p: any) => `${p.value.toFixed(1)}g`,
          fontSize: 10,
          color: '#666',
        },
      },
      {
        name: '空瓶重量',
        type: 'line',
        yAxisIndex: 1,
        data: autoTestResults.map(r => r.emptyWeight),
        lineStyle: { color: chartColors.success, width: 2 },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: chartColors.success },
      },
      {
        name: '进样后重量',
        type: 'line',
        yAxisIndex: 1,
        data: autoTestResults.map(r => r.fullWeight),
        lineStyle: { color: chartColors.warning, width: 2 },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: chartColors.warning },
      },
    ],
  };
  
  // 非线性关系散点图（设定量 vs 实际进样量，点大小表示速度）
  const scatterChartOption = {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const d = params.data;
        return `<div style="font-size:12px">
          <div style="font-weight:bold">${d.name}</div>
          <div>设定量: ${d.value[0]}mm</div>
          <div>实际进样: ${d.value[1].toFixed(1)}g</div>
          <div>速度: ${d.speed}mm/s</div>
        </div>`;
      }
    },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: 'value',
      name: '设定总量 (mm)',
      nameLocation: 'middle',
      nameGap: 25,
      axisLine: { show: true },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    yAxis: {
      type: 'value',
      name: '实际进样量 (g)',
      nameLocation: 'middle',
      nameGap: 35,
      axisLine: { show: true },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: autoTestConfig.paramSets.map((ps, idx) => {
      const results = autoTestResults.filter(r => r.paramSetId === ps.id);
      const colors = [chartColors.primary, chartColors.info, chartColors.purple, chartColors.pink];
      return {
        name: ps.name,
        type: 'scatter',
        data: results.map(r => ({
          value: [r.totalVolume, r.injectedWeight],
          name: `${r.paramSetName} #${r.cycle}`,
          speed: r.speed,
          symbolSize: 8 + r.speed, // 速度越快点越大
        })),
        symbolSize: (data: any) => data.symbolSize || 12,
        itemStyle: { color: colors[idx % colors.length] },
      };
    }),
    legend: {
      data: autoTestConfig.paramSets.filter(ps => ps.cycles > 0).map(ps => ps.name),
      bottom: 5,
      left: 'center',
      itemGap: 20,
      textStyle: { fontSize: 12 },
    },
  };
  
  // 速度影响分析图（按速度分组）
  const speedGroups = autoTestResults.reduce((acc, r) => {
    const key = r.speed;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {} as Record<number, typeof autoTestResults>);
  
  const speedChartOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      name: '速度 (mm/s)',
      data: Object.keys(speedGroups).map(s => `${s}mm/s`),
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: '平均进样量 (g)',
      axisLine: { show: true },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [{
      name: '平均进样量',
      type: 'bar',
      data: Object.entries(speedGroups).map(([speed, results]) => ({
        value: results.reduce((sum, r) => sum + r.injectedWeight, 0) / results.length,
        itemStyle: { color: chartColors.info },
      })),
      barMaxWidth: 50,
      label: {
        show: true,
        position: 'top',
        formatter: (p: any) => `${p.value.toFixed(1)}g`,
        fontSize: 10,
      },
    }],
  };
  
  // 电机个体差异分析（计算各泵贡献）
  const pumpAnalysis = autoTestResults.length > 0 ? {
    pump2: { volume: autoTestResults.reduce((s, r) => s + r.pump2Volume, 0), label: '泵2' },
    pump3: { volume: autoTestResults.reduce((s, r) => s + r.pump3Volume, 0), label: '泵3' },
    pump4: { volume: autoTestResults.reduce((s, r) => s + r.pump4Volume, 0), label: '泵4' },
    pump5: { volume: autoTestResults.reduce((s, r) => s + r.pump5Volume, 0), label: '泵5' },
  } : null;
  
  const pumpChartOption = pumpAnalysis ? {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}: {c}mm ({d}%)' },
      data: [
        { value: pumpAnalysis.pump2.volume, name: '泵2', itemStyle: { color: chartColors.primary } },
        { value: pumpAnalysis.pump3.volume, name: '泵3', itemStyle: { color: chartColors.info } },
        { value: pumpAnalysis.pump4.volume, name: '泵4', itemStyle: { color: chartColors.purple } },
        { value: pumpAnalysis.pump5.volume, name: '泵5', itemStyle: { color: chartColors.pink } },
      ],
    }],
  } : null;
  
  // 按参数组统计的箱线图数据
  const boxPlotData = autoTestStatsByParamSet.map(stat => {
    if (!stat) return null;
    const results = autoTestResults.filter(r => r.paramSetId === stat.paramSetId);
    const sorted = results.map(r => r.injectedWeight).sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)] || sorted[0];
    const q3 = sorted[Math.floor(sorted.length * 0.75)] || sorted[sorted.length - 1];
    return {
      name: stat.name,
      min: stat.minInjected,
      q1,
      median: sorted[Math.floor(sorted.length / 2)],
      q3,
      max: stat.maxInjected,
      mean: stat.meanInjected,
      totalVolume: stat.totalVolume,
    };
  }).filter(Boolean);
  
  // 步骤时长图表（堆叠柱状图）
  const durationChartOption = autoTestResults.length > 0 ? {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex;
        const r = autoTestResults[idx];
        if (!r) return '';
        return `<div style="font-size:12px">
          <div style="font-weight:bold">${r.paramSetName} #${r.cycle}</div>
          <div>排废: ${(r.drainDuration/1000).toFixed(1)}s</div>
          <div>等空瓶: ${(r.waitEmptyDuration/1000).toFixed(1)}s</div>
          <div>进样: ${(r.injectDuration/1000).toFixed(1)}s</div>
          <div>等稳定: ${(r.waitStableDuration/1000).toFixed(1)}s</div>
          <div style="font-weight:bold">总计: ${(r.totalDuration/1000).toFixed(1)}s</div>
        </div>`;
      }
    },
    legend: {
      data: ['排废', '等空瓶', '进样', '等稳定'],
      bottom: 0,
    },
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: autoTestResults.map(r => `${r.paramSetName}\n#${r.cycle}`),
      axisLabel: { fontSize: 10, interval: 0 },
    },
    yAxis: {
      type: 'value',
      name: '时长 (s)',
      axisLine: { show: true },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [
      {
        name: '排废',
        type: 'bar',
        stack: 'total',
        data: autoTestResults.map(r => +(r.drainDuration/1000).toFixed(1)),
        itemStyle: { color: chartColors.warning },
      },
      {
        name: '等空瓶',
        type: 'bar',
        stack: 'total',
        data: autoTestResults.map(r => +(r.waitEmptyDuration/1000).toFixed(1)),
        itemStyle: { color: chartColors.info },
      },
      {
        name: '进样',
        type: 'bar',
        stack: 'total',
        data: autoTestResults.map(r => +(r.injectDuration/1000).toFixed(1)),
        itemStyle: { color: chartColors.primary },
      },
      {
        name: '等稳定',
        type: 'bar',
        stack: 'total',
        data: autoTestResults.map(r => +(r.waitStableDuration/1000).toFixed(1)),
        itemStyle: { color: chartColors.success },
      },
    ],
  } : null;
  
  // ============================================================
  // 高级测试图表配置
  // ============================================================
  
  // 管路死区检测图表
  const deadZoneChartOption = deadZoneResults.length > 0 ? {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex;
        const r = deadZoneResults[idx];
        if (!r) return '';
        return `<div style="font-size:12px">
          <div style="font-weight:bold">泵${r.pumpId} #${r.cycle}</div>
          <div>死区体积: ${r.deadZoneVolume}mm</div>
          <div>首滴重量: ${r.firstDropWeight.toFixed(2)}g</div>
        </div>`;
      }
    },
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: deadZoneResults.map(r => `泵${r.pumpId} #${r.cycle}`),
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: '死区体积 (mm)',
      axisLine: { show: true },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [{
      name: '死区体积',
      type: 'bar',
      data: deadZoneResults.map(r => r.deadZoneVolume),
      itemStyle: { color: chartColors.warning },
      label: { show: true, position: 'top', fontSize: 10, formatter: '{c}mm' },
    }],
  } : null;
  
  // 死区按泵统计
  const deadZoneByPump = [2, 3, 4, 5].map(pumpId => {
    const results = deadZoneResults.filter(r => r.pumpId === pumpId);
    if (results.length === 0) return null;
    const volumes = results.map(r => r.deadZoneVolume);
    return {
      pumpId,
      mean: volumes.reduce((a, b) => a + b, 0) / volumes.length,
      min: Math.min(...volumes),
      max: Math.max(...volumes),
      stdDev: Math.sqrt(volumes.reduce((sum, v) => sum + Math.pow(v - volumes.reduce((a, b) => a + b, 0) / volumes.length, 2), 0) / volumes.length),
    };
  }).filter(Boolean);
  
  // 分辨率检测图表
  const resolutionChartOption = resolutionResults.length > 0 ? {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    legend: { data: ['成功', '失败'], bottom: 0 },
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      name: '进样量 (mm)',
      data: [...new Set(resolutionResults.map(r => r.volumeStep))].sort((a, b) => b - a).map(v => `${v}mm`),
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: '检测次数',
      axisLine: { show: true },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [
      {
        name: '成功',
        type: 'bar',
        stack: 'total',
        data: [...new Set(resolutionResults.map(r => r.volumeStep))].sort((a, b) => b - a).map(vol =>
          resolutionResults.filter(r => r.volumeStep === vol && r.detected).length
        ),
        itemStyle: { color: chartColors.success },
      },
      {
        name: '失败',
        type: 'bar',
        stack: 'total',
        data: [...new Set(resolutionResults.map(r => r.volumeStep))].sort((a, b) => b - a).map(vol =>
          resolutionResults.filter(r => r.volumeStep === vol && !r.detected).length
        ),
        itemStyle: { color: chartColors.danger },
      },
    ],
  } : null;
  
  // 分辨率统计
  const resolutionStats = resolutionResults.length > 0 ? {
    volumes: [...new Set(resolutionResults.map(r => r.volumeStep))].sort((a, b) => b - a).map(vol => {
      const results = resolutionResults.filter(r => r.volumeStep === vol);
      const successCount = results.filter(r => r.detected).length;
      return {
        volume: vol,
        total: results.length,
        success: successCount,
        rate: successCount / results.length,
      };
    }),
    minReliable: (() => {
      const sorted = [...new Set(resolutionResults.map(r => r.volumeStep))].sort((a, b) => a - b);
      for (const vol of sorted) {
        const results = resolutionResults.filter(r => r.volumeStep === vol);
        if (results.filter(r => r.detected).length / results.length >= 0.8) return vol;
      }
      return null;
    })(),
  } : null;
  
  // 基线漂移图表（从自动测试结果中提取）
  const baselineDriftData = autoTestResults.map((r, idx) => ({
    cycle: idx + 1,
    emptyWeight: r.emptyWeight,
    driftFromFirst: idx === 0 ? 0 : r.emptyWeight - autoTestResults[0].emptyWeight,
    driftFromPrev: idx === 0 ? 0 : r.emptyWeight - autoTestResults[idx - 1].emptyWeight,
  }));
  
  const baselineDriftChartOption = baselineDriftData.length > 1 ? {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex;
        const d = baselineDriftData[idx];
        if (!d) return '';
        return `<div style="font-size:12px">
          <div style="font-weight:bold">循环 ${d.cycle}</div>
          <div>空瓶重量: ${d.emptyWeight.toFixed(2)}g</div>
          <div>相对首次漂移: ${d.driftFromFirst >= 0 ? '+' : ''}${d.driftFromFirst.toFixed(2)}g</div>
          <div>相对上次漂移: ${d.driftFromPrev >= 0 ? '+' : ''}${d.driftFromPrev.toFixed(2)}g</div>
        </div>`;
      }
    },
    legend: { data: ['空瓶重量', '相对首次漂移'], bottom: 0 },
    grid: { left: 50, right: 50, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      name: '循环',
      data: baselineDriftData.map(d => `#${d.cycle}`),
      axisLabel: { fontSize: 10 },
    },
    yAxis: [
      {
        type: 'value',
        name: '空瓶重量 (g)',
        position: 'left',
        axisLine: { show: true, lineStyle: { color: chartColors.primary } },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      {
        type: 'value',
        name: '漂移 (g)',
        position: 'right',
        axisLine: { show: true, lineStyle: { color: chartColors.warning } },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '空瓶重量',
        type: 'line',
        yAxisIndex: 0,
        data: baselineDriftData.map(d => d.emptyWeight),
        itemStyle: { color: chartColors.primary },
        smooth: true,
      },
      {
        name: '相对首次漂移',
        type: 'bar',
        yAxisIndex: 1,
        data: baselineDriftData.map(d => +d.driftFromFirst.toFixed(2)),
        itemStyle: {
          color: (params: any) => params.value >= 0 ? chartColors.warning : chartColors.info,
        },
      },
    ],
  } : null;
  
  // 基线漂移统计
  const baselineDriftStats = baselineDriftData.length > 1 ? {
    totalDrift: baselineDriftData[baselineDriftData.length - 1].driftFromFirst,
    maxDrift: Math.max(...baselineDriftData.map(d => Math.abs(d.driftFromFirst))),
    avgDriftPerCycle: baselineDriftData[baselineDriftData.length - 1].driftFromFirst / (baselineDriftData.length - 1),
  } : null;
  
  // ============================================================
  // 称重标定图表和回归
  // ============================================================
  
  // 过滤有真实值的结果
  const weightCalibValidResults = weightCalibResults.filter(r => r.realWeight !== null);
  
  // 线性回归计算 (称重变化值 -> 真实值)
  const weightCalibRegression = weightCalibValidResults.length >= 2 ? (() => {
    const n = weightCalibValidResults.length;
    const sumX = weightCalibValidResults.reduce((s, r) => s + r.measuredWeight, 0);
    const sumY = weightCalibValidResults.reduce((s, r) => s + (r.realWeight || 0), 0);
    const sumXY = weightCalibValidResults.reduce((s, r) => s + r.measuredWeight * (r.realWeight || 0), 0);
    const sumX2 = weightCalibValidResults.reduce((s, r) => s + r.measuredWeight * r.measuredWeight, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // R² 计算
    const yMean = sumY / n;
    const ssTotal = weightCalibValidResults.reduce((s, r) => s + Math.pow((r.realWeight || 0) - yMean, 2), 0);
    const ssResidual = weightCalibValidResults.reduce((s, r) => s + Math.pow((r.realWeight || 0) - (slope * r.measuredWeight + intercept), 2), 0);
    const r2 = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
    
    // 最大误差
    const maxError = Math.max(...weightCalibValidResults.map(r => Math.abs((r.realWeight || 0) - (slope * r.measuredWeight + intercept))));
    
    return { slope, intercept, r2, maxError };
  })() : null;
  
  // 称重标定图表配置
  const weightCalibChartOption = weightCalibResults.length > 0 ? {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.seriesType === 'scatter') {
          const r = weightCalibResults[params.dataIndex];
          return `<div style="font-size:12px">
            <div>设定量: ${r?.setVolumeMm}mm (${r?.setVolumeMl.toFixed(2)}ml)</div>
            <div>称重变化: ${params.value[0]?.toFixed(2)}g</div>
            <div>真实值: ${params.value[1] !== null ? params.value[1]?.toFixed(2) + 'g' : '未输入'}</div>
          </div>`;
        }
        return '';
      }
    },
    legend: { data: ['测量点', '拟合线'], bottom: 0 },
    grid: { left: 60, right: 30, top: 40, bottom: 50 },
    xAxis: {
      type: 'value',
      name: '称重变化值 (g)',
      nameLocation: 'middle',
      nameGap: 25,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: '真实重量 (g)',
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [
      // 测量点
      {
        name: '测量点',
        type: 'scatter',
        data: weightCalibValidResults.map(r => [r.measuredWeight, r.realWeight]),
        itemStyle: { color: chartColors.primary },
        symbolSize: 12,
      },
      // 拟合线
      ...(weightCalibRegression ? [{
        name: '拟合线',
        type: 'line',
        data: weightCalibValidResults.length > 0 ? (() => {
          const minX = Math.min(...weightCalibValidResults.map(r => r.measuredWeight));
          const maxX = Math.max(...weightCalibValidResults.map(r => r.measuredWeight));
          return [
            [minX, weightCalibRegression.slope * minX + weightCalibRegression.intercept],
            [maxX, weightCalibRegression.slope * maxX + weightCalibRegression.intercept],
          ];
        })() : [],
        itemStyle: { color: chartColors.success },
        lineStyle: { type: 'dashed', width: 2 },
        symbol: 'none',
      }] : []),
    ],
  } : null;
  
  // ============================================================
  // 线性度检测图表
  // ============================================================
  
  // 按设定量分组计算平均值
  const linearityGroupedData = linearityResults.reduce((acc, r) => {
    if (!acc[r.setVolume]) {
      acc[r.setVolume] = { setVolume: r.setVolume, weights: [], mean: 0, std: 0 };
    }
    acc[r.setVolume].weights.push(r.actualWeight);
    return acc;
  }, {} as Record<number, { setVolume: number; weights: number[]; mean: number; std: number }>);
  
  // 计算每组的平均值和标准差
  Object.values(linearityGroupedData).forEach(group => {
    group.mean = group.weights.reduce((s, w) => s + w, 0) / group.weights.length;
    group.std = Math.sqrt(group.weights.reduce((s, w) => s + Math.pow(w - group.mean, 2), 0) / group.weights.length);
  });
  
  const linearitySortedGroups = Object.values(linearityGroupedData).sort((a, b) => a.setVolume - b.setVolume);
  
  // 线性回归计算
  const linearityRegression = linearitySortedGroups.length >= 2 ? (() => {
    const n = linearitySortedGroups.length;
    const sumX = linearitySortedGroups.reduce((s, g) => s + g.setVolume, 0);
    const sumY = linearitySortedGroups.reduce((s, g) => s + g.mean, 0);
    const sumXY = linearitySortedGroups.reduce((s, g) => s + g.setVolume * g.mean, 0);
    const sumX2 = linearitySortedGroups.reduce((s, g) => s + g.setVolume * g.setVolume, 0);
    const sumY2 = linearitySortedGroups.reduce((s, g) => s + g.mean * g.mean, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // R² 计算
    const yMean = sumY / n;
    const ssTotal = linearitySortedGroups.reduce((s, g) => s + Math.pow(g.mean - yMean, 2), 0);
    const ssResidual = linearitySortedGroups.reduce((s, g) => s + Math.pow(g.mean - (slope * g.setVolume + intercept), 2), 0);
    const r2 = 1 - ssResidual / ssTotal;
    
    // 最大线性误差
    const maxError = Math.max(...linearitySortedGroups.map(g => Math.abs(g.mean - (slope * g.setVolume + intercept))));
    
    return { slope, intercept, r2, maxError };
  })() : null;
  
  const linearityChartOption = linearityResults.length > 0 ? {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.seriesType === 'scatter') {
          return `<div style="font-size:12px">
            <div>设定量: ${params.value[0]}mm</div>
            <div>实际重量: ${params.value[1].toFixed(2)}g</div>
          </div>`;
        }
        return '';
      }
    },
    legend: { data: ['测量点', '平均值', '拟合线'], bottom: 0 },
    grid: { left: 60, right: 30, top: 40, bottom: 50 },
    xAxis: {
      type: 'value',
      name: '设定进样量 (mm)',
      nameLocation: 'middle',
      nameGap: 25,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: '实际重量变化 (g)',
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [
      // 所有测量点（散点图）
      {
        name: '测量点',
        type: 'scatter',
        data: linearityResults.map(r => [r.setVolume, r.actualWeight]),
        itemStyle: { color: chartColors.info, opacity: 0.6 },
        symbolSize: 8,
      },
      // 平均值（带误差棒的折线）
      {
        name: '平均值',
        type: 'line',
        data: linearitySortedGroups.map(g => [g.setVolume, g.mean]),
        itemStyle: { color: chartColors.primary },
        lineStyle: { width: 2 },
        symbol: 'circle',
        symbolSize: 10,
      },
      // 拟合线
      ...(linearityRegression ? [{
        name: '拟合线',
        type: 'line',
        data: linearitySortedGroups.length > 0 ? [
          [linearitySortedGroups[0].setVolume, linearityRegression.slope * linearitySortedGroups[0].setVolume + linearityRegression.intercept],
          [linearitySortedGroups[linearitySortedGroups.length - 1].setVolume, linearityRegression.slope * linearitySortedGroups[linearitySortedGroups.length - 1].setVolume + linearityRegression.intercept],
        ] : [],
        itemStyle: { color: chartColors.success },
        lineStyle: { type: 'dashed', width: 2 },
        symbol: 'none',
      }] : []),
    ],
  } : null;

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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="monitor">实时监测</TabsTrigger>
            <TabsTrigger value="advanced">高级测试</TabsTrigger>
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
              <div className="space-y-4">
                {/* 电子秤主显示 */}
                <div className="rounded-lg border-2 border-primary/20 bg-gradient-to-br from-background to-muted/30 p-6">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">
                        {tareOffset !== 0 ? "去皮后重量" : "当前重量"}
                      </div>
                      <div className="text-5xl font-bold tracking-tight">
                        {reading.isCalibrated ? `${taredWeight.toFixed(1)}` : "---"}
                        <span className="text-2xl font-normal text-muted-foreground ml-1">g</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={reading.isStable ? "default" : "secondary"} className="mb-2">
                        {reading.isStable ? "稳定" : "变化中"}
                      </Badge>
                      <div className="text-2xl">{getTrendIcon(reading.trend)}</div>
                    </div>
                  </div>
                  {tareOffset !== 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed text-sm text-muted-foreground flex justify-between">
                      <span>原始: {reading.weightGrams.toFixed(1)}g</span>
                      <span>去皮值: {tareOffset.toFixed(1)}g</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleClearTare}>
                        清除去皮
                      </Button>
                    </div>
                  )}
                </div>
                
                {/* 状态信息 */}
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">状态</div>
                    <Badge variant={reading.isCalibrated ? "outline" : "destructive"} className="mt-1">
                      {reading.isCalibrated ? "已标定" : "未标定"}
                    </Badge>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">原始值</div>
                    <div className="font-mono mt-1">{reading.rawPercent.toFixed(2)}%</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">绝对重量</div>
                    <div className="font-mono mt-1">{reading.weightGrams.toFixed(1)}g</div>
                  </div>
                </div>
                
                {/* 多去皮点记录（进样一致性检测） */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      进样一致性检测
                    </h4>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleAddTarePoint}
                        disabled={!reading.isCalibrated || !reading.isStable}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        记录点
                      </Button>
                      {tarePoints.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={handleClearAllTarePoints}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          清空
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {tarePoints.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      点击「记录点」保存当前重量，用于比较多次进样的一致性
                    </p>
                  ) : (
                    <>
                      {/* 去皮点列表 */}
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {tarePoints.map((point) => {
                          const diff = reading.weightGrams - point.weight;
                          const diffColor = Math.abs(diff) < 1 ? "text-green-600" : 
                                           Math.abs(diff) < 3 ? "text-yellow-600" : "text-red-600";
                          return (
                            <div 
                              key={point.id} 
                              className="flex items-center justify-between rounded bg-muted/50 px-3 py-2 text-sm"
                            >
                              <div className="flex items-center gap-3">
                                <Badge variant="secondary" className="font-mono">
                                  {point.label}
                                </Badge>
                                <span className="font-mono font-medium">
                                  {point.weight.toFixed(1)}g
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {point.timestamp.toLocaleTimeString('zh-CN', { hour12: false })}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`font-mono font-bold ${diffColor}`}>
                                  {diff >= 0 ? '+' : ''}{diff.toFixed(1)}g
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => handleRemoveTarePoint(point.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* 统计信息 */}
                      {tarePointsStats && tarePoints.length >= 2 && (
                        <div className="grid grid-cols-4 gap-2 pt-2 border-t text-center text-xs">
                          <div>
                            <div className="text-muted-foreground">平均</div>
                            <div className="font-mono font-medium">{tarePointsStats.mean.toFixed(1)}g</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">最小</div>
                            <div className="font-mono font-medium">{tarePointsStats.min.toFixed(1)}g</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">最大</div>
                            <div className="font-mono font-medium">{tarePointsStats.max.toFixed(1)}g</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">极差</div>
                            <div className={`font-mono font-bold ${tarePointsStats.range < 2 ? 'text-green-600' : tarePointsStats.range < 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {tarePointsStats.range.toFixed(1)}g
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                {/* 自动测试模块 */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      自动进样测试
                      {currentRunId && !viewingHistoryRunId && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          当前 #{currentRunId}
                        </Badge>
                      )}
                      {viewingHistoryRunId && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          查看历史 #{viewingHistoryRunId}
                        </Badge>
                      )}
                    </h4>
                    <div className="flex gap-2">
                      {/* 测试选择下拉列表 - 新建测试或查看历史 */}
                      {autoTestStep === "idle" && (
                        <select
                          className="h-8 px-2 text-xs border rounded-md bg-background"
                          value={viewingHistoryRunId || currentRunId || "new"}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "new") {
                              // 新建测试 - 清空状态
                              setViewingHistoryRunId(null);
                              setCurrentRunId(null);
                              setAutoTestResults([]);
                              setAutoTestLog([]);
                              setAutoTestCurrentCycle(0);
                              setAutoTestCurrentParamSet(0);
                            } else {
                              // 查看历史记录
                              viewHistoricalRun(parseInt(val));
                            }
                          }}
                        >
                          <option value="new">+ 新建测试</option>
                          {historicalRuns.map(run => (
                            <option key={run.runId} value={run.runId}>
                              #{run.runId} - {run.status} ({run.totalCycles}循环) {run.startedAt}
                            </option>
                          ))}
                        </select>
                      )}
                      {autoTestStep === "idle" ? (
                        <Button 
                          variant="default" 
                          size="sm" 
                          onClick={handleStartAutoTest}
                          disabled={!reading?.isCalibrated || !!viewingHistoryRunId}
                          title={viewingHistoryRunId ? "查看历史时无法开始新测试，请先选择「新建测试」" : ""}
                        >
                          <Play className="mr-1 h-3 w-3" />
                          开始测试
                        </Button>
                      ) : (
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={handleStopAutoTest}
                        >
                          <Square className="mr-1 h-3 w-3" />
                          停止
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {/* 测试状态 */}
                  {autoTestStep !== "idle" && (
                    <div className="rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 p-3 text-sm border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">
                          参数组 {autoTestCurrentParamSet}/{autoTestTotalParamSets || autoTestConfig.paramSets.filter(ps => ps.cycles > 0).length} · 
                          循环 {autoTestCurrentCycle}/{autoTestTotalCycles || totalCycles}
                        </span>
                        <Badge variant="outline" className="bg-white dark:bg-slate-800">
                          {autoTestStep === "draining" && "排废中..."}
                          {autoTestStep === "waiting_empty" && "等待空瓶..."}
                          {autoTestStep === "recording_empty" && "记录空瓶"}
                          {autoTestStep === "injecting" && "进样中..."}
                          {autoTestStep === "waiting_stable" && "等待稳定..."}
                          {autoTestStep === "recording_full" && "记录结果"}
                          {autoTestStep === "complete" && "完成!"}
                        </Badge>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2.5 rounded-full transition-all"
                          style={{ width: `${(autoTestCurrentCycle / (autoTestTotalCycles || totalCycles || 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* 多组参数配置 */}
                  {autoTestStep === "idle" && (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">参数组配置（每组可独立配置4个泵和速度）</div>
                      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                        {autoTestConfig.paramSets.map((ps, idx) => (
                          <div key={ps.id} className="p-3 rounded-lg border bg-muted/20 space-y-2">
                            {/* 第一行：名称、速度、循环次数、删除 */}
                            <div className="flex items-center gap-2">
                              <Input
                                className="h-8 w-20 text-sm font-medium"
                                value={ps.name}
                                onChange={(e) => {
                                  const newSets = [...autoTestConfig.paramSets];
                                  newSets[idx] = { ...ps, name: e.target.value };
                                  setAutoTestConfig(prev => ({ ...prev, paramSets: newSets }));
                                }}
                                placeholder="名称"
                              />
                              <div className="flex items-center gap-1 ml-auto">
                                <Label className="text-xs text-muted-foreground">速度</Label>
                                <Input
                                  className="h-8 w-16 text-sm"
                                  type="number"
                                  value={ps.speed}
                                  onChange={(e) => {
                                    const newSets = [...autoTestConfig.paramSets];
                                    newSets[idx] = { ...ps, speed: parseFloat(e.target.value) || 10 };
                                    setAutoTestConfig(prev => ({ ...prev, paramSets: newSets }));
                                  }}
                                />
                                <span className="text-xs text-muted-foreground">mm/s</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Label className="text-xs text-muted-foreground">循环</Label>
                                <Input
                                  className="h-8 w-14 text-sm"
                                  type="number"
                                  value={ps.cycles}
                                  onChange={(e) => {
                                    const newSets = [...autoTestConfig.paramSets];
                                    newSets[idx] = { ...ps, cycles: parseInt(e.target.value) || 0 };
                                    setAutoTestConfig(prev => ({ ...prev, paramSets: newSets }));
                                  }}
                                  min={0}
                                />
                                <span className="text-xs text-muted-foreground">次</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setAutoTestConfig(prev => ({
                                    ...prev,
                                    paramSets: prev.paramSets.filter(p => p.id !== ps.id)
                                  }));
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            {/* 第二行：4个泵的进样量 */}
                            <div className="grid grid-cols-4 gap-2">
                              {(['pump0Volume', 'pump1Volume', 'pump2Volume', 'pump3Volume', 'pump4Volume', 'pump5Volume', 'pump6Volume', 'pump7Volume'] as const).map((pumpKey, pIdx) => (
                                <div key={pumpKey} className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">泵{pIdx} (mm)</Label>
                                  <Input
                                    className="h-8 text-sm font-mono"
                                    type="number"
                                    value={ps.params[pumpKey]}
                                    onChange={(e) => {
                                      const v = parseFloat(e.target.value) || 0;
                                      const newSets = [...autoTestConfig.paramSets];
                                      newSets[idx] = { ...ps, params: { ...ps.params, [pumpKey]: v } };
                                      setAutoTestConfig(prev => ({ ...prev, paramSets: newSets }));
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setAutoTestConfig(prev => ({
                            ...prev,
                            paramSets: [...prev.paramSets, {
                              id: nextParamSetId,
                              name: `组${nextParamSetId}`,
                              params: { pump0Volume: 0, pump1Volume: 0, pump2Volume: 50, pump3Volume: 50, pump4Volume: 50, pump5Volume: 50, pump6Volume: 0, pump7Volume: 0 },
                              speed: 10,
                              cycles: 3,
                            }]
                          }));
                          setNextParamSetId(prev => prev + 1);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> 添加参数组
                      </Button>
                      
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                        <div>
                          <Label className="text-xs">加速度 (mm/s²)</Label>
                          <Input
                            type="number"
                            value={autoTestConfig.accel}
                            onChange={(e) => setAutoTestConfig(prev => ({ ...prev, accel: parseFloat(e.target.value) || 100 }))}
                            className="h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">空瓶容差 (g)</Label>
                          <Input
                            type="number"
                            value={autoTestConfig.emptyTolerance}
                            onChange={(e) => setAutoTestConfig(prev => ({ ...prev, emptyTolerance: parseFloat(e.target.value) || 5 }))}
                            className="h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">排废稳定窗口 (s)</Label>
                          <Input
                            type="number"
                            value={autoTestConfig.drainStabilityWindow}
                            onChange={(e) => setAutoTestConfig(prev => ({ ...prev, drainStabilityWindow: parseFloat(e.target.value) || 5 }))}
                            className="h-8"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        空瓶基准: {dynamicEmptyWeight !== null ? `${dynamicEmptyWeight.toFixed(1)}g (自动)` : '未设置'} · 总循环: {totalCycles}次
                      </p>
                    </div>
                  )}
                  
                  {/* 测试结果图表 */}
                  {autoTestResults.length > 0 && (
                    <div className="space-y-4">
                      {/* 柱状图：各循环进样量 */}
                      <div className="rounded-lg border p-3">
                        <div className="text-xs font-medium mb-2">各循环进样量</div>
                        <ReactECharts option={barChartOption} style={{ height: 180 }} />
                      </div>
                      
                      {/* 步骤时长图表 */}
                      {durationChartOption && (
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium mb-2">各循环步骤时长分析</div>
                          <ReactECharts option={durationChartOption} style={{ height: 180 }} />
                        </div>
                      )}
                      
                      {/* 散点图：设定量 vs 实际进样量（非线性关系） */}
                      {autoTestConfig.paramSets.filter(ps => ps.cycles > 0).length > 1 && (
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium mb-2">设定量 vs 实际进样量（点大小=速度）</div>
                          <ReactECharts option={scatterChartOption} style={{ height: 200 }} />
                        </div>
                      )}
                      
                      {/* 速度影响分析 + 电机配置占比 */}
                      {Object.keys(speedGroups).length > 1 && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg border p-3">
                            <div className="text-xs font-medium mb-2">速度影响分析</div>
                            <ReactECharts option={speedChartOption} style={{ height: 150 }} />
                          </div>
                          {pumpChartOption && (
                            <div className="rounded-lg border p-3">
                              <div className="text-xs font-medium mb-2">各泵进样配置占比</div>
                              <ReactECharts option={pumpChartOption} style={{ height: 150 }} />
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* 按参数组统计 */}
                      {autoTestStatsByParamSet.length > 0 && (
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium mb-2">各参数组统计</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-1 px-2">参数组</th>
                                  <th className="text-right py-1 px-2">设定量</th>
                                  <th className="text-right py-1 px-2">平均进样</th>
                                  <th className="text-right py-1 px-2">极差</th>
                                  <th className="text-right py-1 px-2">标准差</th>
                                </tr>
                              </thead>
                              <tbody>
                                {autoTestStatsByParamSet.map(stat => stat && (
                                  <tr key={stat.paramSetId} className="border-b last:border-0">
                                    <td className="py-1 px-2 font-medium">{stat.name}</td>
                                    <td className="py-1 px-2 text-right font-mono">{stat.totalVolume}mm</td>
                                    <td className="py-1 px-2 text-right font-mono">{stat.meanInjected.toFixed(1)}g</td>
                                    <td className={`py-1 px-2 text-right font-mono ${stat.rangeInjected < 2 ? 'text-green-600' : stat.rangeInjected < 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                                      {stat.rangeInjected.toFixed(1)}g
                                    </td>
                                    <td className={`py-1 px-2 text-right font-mono ${stat.stdDev < 1 ? 'text-green-600' : stat.stdDev < 2 ? 'text-yellow-600' : 'text-red-600'}`}>
                                      {stat.stdDev.toFixed(2)}g
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      
                      {/* 总体统计 */}
                      {autoTestStats && (
                        <div className="grid grid-cols-5 gap-2 text-center text-xs border rounded-lg p-2">
                          <div>
                            <div className="text-muted-foreground">总平均</div>
                            <div className="font-mono font-medium">{autoTestStats.meanInjected.toFixed(1)}g</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">最小</div>
                            <div className="font-mono font-medium">{autoTestStats.minInjected.toFixed(1)}g</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">最大</div>
                            <div className="font-mono font-medium">{autoTestStats.maxInjected.toFixed(1)}g</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">极差</div>
                            <div className={`font-mono font-bold ${autoTestStats.rangeInjected < 2 ? 'text-green-600' : autoTestStats.rangeInjected < 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {autoTestStats.rangeInjected.toFixed(1)}g
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">标准差</div>
                            <div className={`font-mono font-bold ${autoTestStats.stdDev < 1 ? 'text-green-600' : autoTestStats.stdDev < 2 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {autoTestStats.stdDev.toFixed(2)}g
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* 测试日志 */}
                  {autoTestLog.length > 0 && (
                    <div className="relative">
                      <div 
                        ref={logContainerRef}
                        onScroll={handleLogScroll}
                        className="max-h-40 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded-lg p-2 font-mono text-xs border"
                      >
                        {autoTestLog.map((log, i) => (
                          <div key={i} className={`py-0.5 ${log.includes('===') ? 'font-bold text-primary' : ''}`}>{log}</div>
                        ))}
                      </div>
                      {!autoScrollEnabled && (
                        <button
                          onClick={() => {
                            setAutoScrollEnabled(true);
                            if (logContainerRef.current) {
                              logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                            }
                          }}
                          className="absolute bottom-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded shadow-md hover:bg-primary/90"
                        >
                          ↓ 回到底部
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* 高级测试 */}
          <TabsContent value="advanced" className="space-y-4">
            {/* 测试类型选择 */}
            <div className="grid grid-cols-5 gap-3">
              <button
                onClick={() => setAdvancedTestType(advancedTestType === 'deadzone' ? null : 'deadzone')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  advancedTestType === 'deadzone' ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium">🔧 管路死区</div>
                <div className="text-xs text-muted-foreground mt-1">检测管路气体死区</div>
              </button>
              <button
                onClick={() => setAdvancedTestType(advancedTestType === 'resolution' ? null : 'resolution')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  advancedTestType === 'resolution' ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium">📏 分辨率检测</div>
                <div className="text-xs text-muted-foreground mt-1">最小可靠进样量</div>
              </button>
              <button
                onClick={() => setAdvancedTestType(advancedTestType === 'linearity' ? null : 'linearity')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  advancedTestType === 'linearity' ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium">📈 线性度检测</div>
                <div className="text-xs text-muted-foreground mt-1">进样量与重量关系</div>
              </button>
              <button
                onClick={() => setAdvancedTestType(advancedTestType === 'weight_calibration' ? null : 'weight_calibration')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  advancedTestType === 'weight_calibration' ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium">⚖️ 称重标定</div>
                <div className="text-xs text-muted-foreground mt-1">标定测量值到真实值</div>
              </button>
              <button
                onClick={() => setAdvancedTestType(advancedTestType === 'baseline' ? null : 'baseline')}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  advancedTestType === 'baseline' ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium">📊 基线漂移</div>
                <div className="text-xs text-muted-foreground mt-1">空瓶重量漂移分析</div>
              </button>
            </div>
            
            {/* 管路死区检测 */}
            {advancedTestType === 'deadzone' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">管路死区检测</h3>
                  {advancedTestRunning ? (
                    <Button variant="destructive" size="sm" onClick={handleStopAdvancedTest}>
                      <Square className="h-4 w-4 mr-1" /> 停止
                    </Button>
                  ) : (
                    <Button size="sm" onClick={runDeadZoneTest}>
                      <Play className="h-4 w-4 mr-1" /> 开始检测
                    </Button>
                  )}
                </div>
                
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">步长 (mm)</Label>
                    <Input type="number" className="h-8" value={deadZoneConfig.stepVolume}
                      onChange={e => setDeadZoneConfig(p => ({ ...p, stepVolume: +e.target.value || 10 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">最大测试量 (mm)</Label>
                    <Input type="number" className="h-8" value={deadZoneConfig.maxVolume}
                      onChange={e => setDeadZoneConfig(p => ({ ...p, maxVolume: +e.target.value || 200 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">检测阈值 (g)</Label>
                    <Input type="number" step="0.1" className="h-8" value={deadZoneConfig.detectionThreshold}
                      onChange={e => setDeadZoneConfig(p => ({ ...p, detectionThreshold: +e.target.value || 0.5 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">每泵重复次数</Label>
                    <Input type="number" className="h-8" value={deadZoneConfig.cycles}
                      onChange={e => setDeadZoneConfig(p => ({ ...p, cycles: +e.target.value || 3 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">进样速度 (mm/s)</Label>
                    <Input type="number" className="h-8" value={deadZoneConfig.speed}
                      onChange={e => setDeadZoneConfig(p => ({ ...p, speed: +e.target.value || 50 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">测试泵</Label>
                    <div className="flex gap-1 mt-1">
                      {[2, 3, 4, 5].map(id => (
                        <button key={id}
                          onClick={() => setDeadZoneConfig(p => ({
                            ...p,
                            pumpIds: p.pumpIds.includes(id) ? p.pumpIds.filter(x => x !== id) : [...p.pumpIds, id].sort()
                          }))}
                          className={`px-2 py-1 text-xs rounded ${deadZoneConfig.pumpIds.includes(id) ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                        >{id}</button>
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* 死区检测结果图表 */}
                {deadZoneChartOption && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">死区检测结果</div>
                    <ReactECharts option={deadZoneChartOption} style={{ height: 180 }} />
                  </div>
                )}
                
                {/* 按泵统计 */}
                {deadZoneByPump.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">各泵死区统计</div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      {deadZoneByPump.map(stat => stat && (
                        <div key={stat.pumpId} className="p-2 rounded bg-muted/50 text-center">
                          <div className="font-medium">泵{stat.pumpId}</div>
                          <div className="text-lg font-bold text-primary">{stat.mean.toFixed(0)}mm</div>
                          <div className="text-muted-foreground">±{stat.stdDev.toFixed(1)}mm</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* 分辨率检测 */}
            {advancedTestType === 'resolution' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">分辨率检测</h3>
                  {advancedTestRunning ? (
                    <Button variant="destructive" size="sm" onClick={handleStopAdvancedTest}>
                      <Square className="h-4 w-4 mr-1" /> 停止
                    </Button>
                  ) : (
                    <Button size="sm" onClick={runResolutionTest}>
                      <Play className="h-4 w-4 mr-1" /> 开始检测
                    </Button>
                  )}
                </div>
                
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">测试模式</Label>
                    <div className="flex gap-1 mt-1">
                      <button onClick={() => setResolutionConfig(p => ({ ...p, testMode: 'single' }))}
                        className={`flex-1 px-2 py-1 text-xs rounded ${resolutionConfig.testMode === 'single' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                        单电机
                      </button>
                      <button onClick={() => setResolutionConfig(p => ({ ...p, testMode: 'multi' }))}
                        className={`flex-1 px-2 py-1 text-xs rounded ${resolutionConfig.testMode === 'multi' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                        多电机
                      </button>
                    </div>
                  </div>
                  {resolutionConfig.testMode === 'single' && (
                    <div>
                      <Label className="text-xs">测试泵</Label>
                      <div className="flex gap-1 mt-1">
                        {[2, 3, 4, 5].map(id => (
                          <button key={id} onClick={() => setResolutionConfig(p => ({ ...p, pumpId: id }))}
                            className={`px-2 py-1 text-xs rounded ${resolutionConfig.pumpId === id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">基准液体量 (mm)</Label>
                    <Input type="number" className="h-8" value={resolutionConfig.baseVolume}
                      onChange={e => setResolutionConfig(p => ({ ...p, baseVolume: +e.target.value || 50 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">测试起始值 (mm)</Label>
                    <Input type="number" className="h-8" value={resolutionConfig.testStartVolume}
                      onChange={e => setResolutionConfig(p => ({ ...p, testStartVolume: +e.target.value || 50 }))} />
                  </div>
                </div>
                
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">递减步长 (mm)</Label>
                    <Input type="number" className="h-8" value={resolutionConfig.stepVolume}
                      onChange={e => setResolutionConfig(p => ({ ...p, stepVolume: +e.target.value || 10 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">最小测试量 (mm)</Label>
                    <Input type="number" className="h-8" value={resolutionConfig.minVolume}
                      onChange={e => setResolutionConfig(p => ({ ...p, minVolume: +e.target.value || 5 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">每量重复次数</Label>
                    <Input type="number" className="h-8" value={resolutionConfig.cycles}
                      onChange={e => setResolutionConfig(p => ({ ...p, cycles: +e.target.value || 5 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">检测阈值 (g)</Label>
                    <Input type="number" step="0.1" className="h-8" value={resolutionConfig.detectionThreshold}
                      onChange={e => setResolutionConfig(p => ({ ...p, detectionThreshold: +e.target.value || 0.3 }))} />
                  </div>
                </div>
                
                {/* 分辨率检测结果 */}
                {resolutionChartOption && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">分辨率检测结果（成功/失败次数）</div>
                    <ReactECharts option={resolutionChartOption} style={{ height: 180 }} />
                  </div>
                )}
                
                {/* 分辨率统计 */}
                {resolutionStats && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">检测统计</div>
                    <div className="flex items-center gap-4 mb-2">
                      {resolutionStats.minReliable !== null && (
                        <div className="text-center p-2 rounded bg-green-50 dark:bg-green-900/20">
                          <div className="text-xs text-muted-foreground">最小可靠进样量</div>
                          <div className="text-xl font-bold text-green-600">{resolutionStats.minReliable}mm</div>
                        </div>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1 px-2">进样量</th>
                          <th className="text-right py-1 px-2">成功</th>
                          <th className="text-right py-1 px-2">失败</th>
                          <th className="text-right py-1 px-2">成功率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resolutionStats.volumes.map(v => (
                          <tr key={v.volume} className="border-b last:border-0">
                            <td className="py-1 px-2 font-mono">{v.volume}mm</td>
                            <td className="py-1 px-2 text-right text-green-600">{v.success}</td>
                            <td className="py-1 px-2 text-right text-red-600">{v.total - v.success}</td>
                            <td className={`py-1 px-2 text-right font-medium ${v.rate >= 0.8 ? 'text-green-600' : v.rate >= 0.5 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {(v.rate * 100).toFixed(0)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            
            {/* 线性度检测 */}
            {advancedTestType === 'linearity' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">线性度检测</h3>
                  {advancedTestRunning ? (
                    <Button variant="destructive" size="sm" onClick={handleStopAdvancedTest}>
                      <Square className="h-4 w-4 mr-1" /> 停止
                    </Button>
                  ) : (
                    <Button size="sm" onClick={runLinearityTest}>
                      <Play className="h-4 w-4 mr-1" /> 开始检测
                    </Button>
                  )}
                </div>
                
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">测试模式</Label>
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={() => setLinearityConfig(p => ({ ...p, testMode: 'single' }))}
                        className={`px-2 py-1 text-xs rounded ${linearityConfig.testMode === 'single' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                      >单电机</button>
                      <button
                        onClick={() => setLinearityConfig(p => ({ ...p, testMode: 'multi' }))}
                        className={`px-2 py-1 text-xs rounded ${linearityConfig.testMode === 'multi' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                      >多电机</button>
                    </div>
                  </div>
                  {linearityConfig.testMode === 'single' && (
                    <div>
                      <Label className="text-xs">测试泵</Label>
                      <div className="flex gap-1 mt-1">
                        {[2, 3, 4, 5].map(id => (
                          <button key={id}
                            onClick={() => setLinearityConfig(p => ({ ...p, pumpId: id }))}
                            className={`px-2 py-1 text-xs rounded ${linearityConfig.pumpId === id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                          >{id}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">每量重复次数</Label>
                    <Input type="number" className="h-8" value={linearityConfig.cycles}
                      onChange={e => setLinearityConfig(p => ({ ...p, cycles: +e.target.value || 3 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">进样速度 (mm/s)</Label>
                    <Input type="number" className="h-8" value={linearityConfig.speed}
                      onChange={e => setLinearityConfig(p => ({ ...p, speed: +e.target.value || 100 }))} />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">测试进样量序列 (mm)</Label>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-6 text-xs"
                      onClick={() => setSeqGenOpen(!seqGenOpen)}
                    >
                      {seqGenOpen ? '收起' : '🔢 生成序列'}
                    </Button>
                  </div>
                  
                  {/* 序列生成器面板 */}
                  {seqGenOpen && (
                    <div className="p-3 rounded-lg bg-muted/30 border space-y-3">
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <Label className="text-xs">最小值 (mm)</Label>
                          <Input type="number" className="h-7 text-xs" value={seqGenConfig.min}
                            onChange={e => setSeqGenConfig(p => ({ ...p, min: +e.target.value || 50 }))} />
                        </div>
                        <div>
                          <Label className="text-xs">最大值 (mm)</Label>
                          <Input type="number" className="h-7 text-xs" value={seqGenConfig.max}
                            onChange={e => setSeqGenConfig(p => ({ ...p, max: +e.target.value || 1000 }))} />
                        </div>
                        <div>
                          <Label className="text-xs">步数</Label>
                          <Input type="number" className="h-7 text-xs" value={seqGenConfig.steps}
                            onChange={e => setSeqGenConfig(p => ({ ...p, steps: +e.target.value || 10 }))} />
                        </div>
                        <div>
                          <Label className="text-xs">分布类型</Label>
                          <select 
                            className="w-full h-7 text-xs rounded border bg-background px-2"
                            value={seqGenConfig.type}
                            onChange={e => setSeqGenConfig(p => ({ ...p, type: e.target.value as typeof seqGenConfig.type }))}
                          >
                            <option value="linear">线性等差</option>
                            <option value="log">对数 (小值密集)</option>
                            <option value="sqrt">平方根 (小值密集)</option>
                            <option value="exp">指数 (大值密集)</option>
                            <option value="quadratic">二次 (大值密集)</option>
                          </select>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">
                          预览: {generateSequence(seqGenConfig.type, seqGenConfig.min, seqGenConfig.max, seqGenConfig.steps).slice(0, 5).join(', ')}
                          {generateSequence(seqGenConfig.type, seqGenConfig.min, seqGenConfig.max, seqGenConfig.steps).length > 5 && '...'}
                          ({generateSequence(seqGenConfig.type, seqGenConfig.min, seqGenConfig.max, seqGenConfig.steps).length}个)
                        </div>
                        <Button 
                          size="sm" 
                          className="h-6 text-xs"
                          onClick={() => {
                            const seq = generateSequence(seqGenConfig.type, seqGenConfig.min, seqGenConfig.max, seqGenConfig.steps);
                            setLinearityConfig(p => ({ ...p, volumeSteps: seq }));
                            setSeqGenOpen(false);
                          }}
                        >
                          应用
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  <Input 
                    className="h-8 font-mono text-xs" 
                    value={linearityConfig.volumeSteps.join(', ')}
                    onChange={e => {
                      const steps = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
                      if (steps.length > 0) setLinearityConfig(p => ({ ...p, volumeSteps: steps }));
                    }}
                  />
                </div>
                
                {/* 线性度检测结果图表 */}
                {linearityChartOption && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">线性度检测结果</div>
                    <ReactECharts option={linearityChartOption} style={{ height: 250 }} />
                  </div>
                )}
                
                {/* 线性度统计 */}
                {linearityRegression && (
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">R² (决定系数)</div>
                      <div className={`text-xl font-bold ${linearityRegression.r2 >= 0.99 ? 'text-green-600' : linearityRegression.r2 >= 0.95 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {linearityRegression.r2.toFixed(4)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">斜率 (g/mm)</div>
                      <div className="text-xl font-bold text-primary">
                        {linearityRegression.slope.toFixed(4)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">截距 (g)</div>
                      <div className="text-xl font-bold text-primary">
                        {linearityRegression.intercept.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">最大误差 (g)</div>
                      <div className={`text-xl font-bold ${linearityRegression.maxError < 1 ? 'text-green-600' : linearityRegression.maxError < 3 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {linearityRegression.maxError.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* 保存校准系数按钮 */}
                {linearityRegression && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-blue-900 dark:text-blue-100">保存泵校准系数</div>
                      <div className="text-xs text-blue-700 dark:text-blue-300">
                        斜率: {linearityRegression.slope.toFixed(4)} g/mm, 截距: {linearityRegression.intercept.toFixed(2)} g
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/load-cell/pump-calibration', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              slope: linearityRegression.slope,
                              offset: linearityRegression.intercept,
                            }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            alert('校准系数已保存到后端配置');
                          } else {
                            alert('保存失败: ' + data.message);
                          }
                        } catch (err: any) {
                          alert('保存失败: ' + err.message);
                        }
                      }}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      保存到后端
                    </Button>
                  </div>
                )}
                
                {/* 各进样量统计表 */}
                {linearitySortedGroups.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">各进样量统计</div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-1 px-2">设定量 (mm)</th>
                          <th className="py-1 px-2 text-right">平均重量 (g)</th>
                          <th className="py-1 px-2 text-right">标准差 (g)</th>
                          <th className="py-1 px-2 text-right">测量次数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linearitySortedGroups.map(g => (
                          <tr key={g.setVolume} className="border-b last:border-0">
                            <td className="py-1 px-2 font-mono">{g.setVolume}</td>
                            <td className="py-1 px-2 text-right">{g.mean.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right">{g.std.toFixed(3)}</td>
                            <td className="py-1 px-2 text-right">{g.weights.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            
            {/* 称重标定 */}
            {advancedTestType === 'weight_calibration' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">称重标定</h3>
                  <div className="flex items-center gap-2">
                    {weightCalibStep === 'waiting_user' && (
                      <Button size="sm" onClick={handleWeightCalibContinue} className="bg-green-600 hover:bg-green-700">
                        <Play className="h-4 w-4 mr-1" /> 继续（已接好液体）
                      </Button>
                    )}
                    {advancedTestRunning ? (
                      <Button variant="destructive" size="sm" onClick={handleStopAdvancedTest}>
                        <Square className="h-4 w-4 mr-1" /> 停止
                      </Button>
                    ) : (
                      <Button size="sm" onClick={runWeightCalibrationTest}>
                        <Play className="h-4 w-4 mr-1" /> 开始标定
                      </Button>
                    )}
                  </div>
                </div>
                
                {/* 当前状态提示 */}
                {advancedTestRunning && (
                  <div className={`p-3 rounded-lg border ${
                    weightCalibStep === 'waiting_user' 
                      ? 'bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700' 
                      : 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700'
                  }`}>
                    <div className="flex items-center gap-2">
                      {weightCalibStep === 'waiting_user' ? (
                        <>
                          <span className="text-2xl">⏸️</span>
                          <div>
                            <div className="font-medium text-yellow-800 dark:text-yellow-200">请用杯子接住排废口</div>
                            <div className="text-sm text-yellow-700 dark:text-yellow-300">准备好后点击上方「继续」按钮</div>
                          </div>
                        </>
                      ) : weightCalibStep === 'injecting' ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                          <div className="text-blue-800 dark:text-blue-200">正在进样... (第 {weightCalibCurrentIndex + 1}/{weightCalibConfig.volumeSteps.length} 个)</div>
                        </>
                      ) : weightCalibStep === 'draining' ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                          <div className="text-blue-800 dark:text-blue-200">正在排废...</div>
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
                
                {/* 配置区域 */}
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">测试模式</Label>
                    <div className="flex gap-1 mt-1">
                      <button onClick={() => setWeightCalibConfig(p => ({ ...p, testMode: 'single' }))}
                        className={`flex-1 px-2 py-1 text-xs rounded ${weightCalibConfig.testMode === 'single' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                        单电机
                      </button>
                      <button onClick={() => setWeightCalibConfig(p => ({ ...p, testMode: 'multi' }))}
                        className={`flex-1 px-2 py-1 text-xs rounded ${weightCalibConfig.testMode === 'multi' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                        多电机
                      </button>
                    </div>
                  </div>
                  {weightCalibConfig.testMode === 'single' && (
                    <div>
                      <Label className="text-xs">测试泵</Label>
                      <div className="flex gap-1 mt-1">
                        {[2, 3, 4, 5].map(id => (
                          <button key={id} onClick={() => setWeightCalibConfig(p => ({ ...p, pumpId: id }))}
                            className={`px-2 py-1 text-xs rounded ${weightCalibConfig.pumpId === id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">进样速度 (mm/s)</Label>
                    <Input type="number" className="h-8" value={weightCalibConfig.speed}
                      onChange={e => setWeightCalibConfig(p => ({ ...p, speed: +e.target.value || 100 }))} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">泵线性系数 (ml = slope × mm + offset)</Label>
                    <div className="h-8 px-3 py-1.5 rounded-md border bg-muted/50 text-sm font-mono flex items-center gap-3">
                      <span>slope: <strong>{config.pumpMmToMl ? config.pumpMmToMl.toFixed(4) : '未标定'}</strong></span>
                      <span>offset: <strong>{config.pumpMmOffset !== undefined ? config.pumpMmOffset.toFixed(2) : '未标定'}</strong></span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">从线性度检测获取</div>
                  </div>
                </div>
                
                {/* 序列配置 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">进样量序列 (mm)</Label>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setWeightCalibSeqGenOpen(!weightCalibSeqGenOpen)}>
                      序列生成器
                    </Button>
                  </div>
                  <Input 
                    className="h-8 font-mono text-xs"
                    value={weightCalibConfig.volumeSteps.join(', ')}
                    onChange={e => {
                      const vals = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
                      if (vals.length > 0) setWeightCalibConfig(p => ({ ...p, volumeSteps: vals }));
                    }}
                  />
                  
                  {/* 序列生成器弹出框 */}
                  {weightCalibSeqGenOpen && (
                    <div className="mt-2 p-3 rounded-lg border bg-muted/30">
                      <div className="grid grid-cols-5 gap-2 text-xs">
                        <div>
                          <Label className="text-xs">类型</Label>
                          <select className="w-full h-8 rounded border px-2 text-xs"
                            value={seqGenConfig.type}
                            onChange={e => setSeqGenConfig(p => ({ ...p, type: e.target.value as any }))}>
                            <option value="linear">线性</option>
                            <option value="log">对数</option>
                            <option value="exp">指数</option>
                            <option value="quadratic">二次</option>
                            <option value="sqrt">平方根</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs">最小值</Label>
                          <Input type="number" className="h-8" value={seqGenConfig.min}
                            onChange={e => setSeqGenConfig(p => ({ ...p, min: +e.target.value || 50 }))} />
                        </div>
                        <div>
                          <Label className="text-xs">最大值</Label>
                          <Input type="number" className="h-8" value={seqGenConfig.max}
                            onChange={e => setSeqGenConfig(p => ({ ...p, max: +e.target.value || 1000 }))} />
                        </div>
                        <div>
                          <Label className="text-xs">步数</Label>
                          <Input type="number" className="h-8" value={seqGenConfig.steps}
                            onChange={e => setSeqGenConfig(p => ({ ...p, steps: +e.target.value || 10 }))} />
                        </div>
                        <div className="flex items-end">
                          <Button size="sm" className="h-8 w-full" onClick={() => {
                            const seq = generateSequence(seqGenConfig.type, seqGenConfig.min, seqGenConfig.max, seqGenConfig.steps);
                            setWeightCalibConfig(p => ({ ...p, volumeSteps: seq }));
                            setWeightCalibSeqGenOpen(false);
                          }}>应用</Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* 图表 */}
                {weightCalibChartOption && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">称重标定拟合 (称重变化值 → 真实重量)</div>
                    <ReactECharts option={weightCalibChartOption} style={{ height: 250 }} />
                  </div>
                )}
                
                {/* 回归统计 */}
                {weightCalibRegression && (
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">R² (决定系数)</div>
                      <div className={`text-xl font-bold ${weightCalibRegression.r2 >= 0.99 ? 'text-green-600' : weightCalibRegression.r2 >= 0.95 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {weightCalibRegression.r2.toFixed(4)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">weight_scale (斜率)</div>
                      <div className="text-xl font-bold text-primary">
                        {weightCalibRegression.slope.toFixed(4)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">weight_offset (截距)</div>
                      <div className="text-xl font-bold text-primary">
                        {weightCalibRegression.intercept.toFixed(4)}g
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="text-xs text-muted-foreground">最大误差 (g)</div>
                      <div className={`text-xl font-bold ${weightCalibRegression.maxError < 1 ? 'text-green-600' : weightCalibRegression.maxError < 3 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {weightCalibRegression.maxError.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* 保存校准系数按钮 */}
                {weightCalibRegression && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-green-900 dark:text-green-100">保存称重校准系数</div>
                      <div className="text-xs text-green-700 dark:text-green-300">
                        real_weight = {weightCalibRegression.slope.toFixed(4)} × measured_weight + ({weightCalibRegression.intercept.toFixed(4)})
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      disabled={weightCalibSaving}
                      onClick={async () => {
                        setWeightCalibSaving(true);
                        try {
                          await saveLoadCellConfig({
                            ...config,
                            weightScale: weightCalibRegression.slope,
                            weightOffset: weightCalibRegression.intercept,
                          });
                          // 更新本地config
                          setConfig(prev => ({
                            ...prev,
                            weightScale: weightCalibRegression.slope,
                            weightOffset: weightCalibRegression.intercept,
                          }));
                          addAutoTestLog('✅ 称重校准系数已保存到后端');
                        } catch (err: any) {
                          addAutoTestLog(`❌ 保存失败: ${err.message}`);
                        } finally {
                          setWeightCalibSaving(false);
                        }
                      }}
                    >
                      {weightCalibSaving ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-1" />
                      )}
                      {weightCalibSaving ? '保存中...' : '保存到后端'}
                    </Button>
                  </div>
                )}
                
                {/* 数据表格 */}
                {weightCalibResults.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium mb-2">标定数据表</div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-1 px-2">#</th>
                          <th className="py-1 px-2 text-right">设定量 (mm)</th>
                          <th className="py-1 px-2 text-right">计算ml值</th>
                          <th className="py-1 px-2 text-right">称重变化 (g)</th>
                          <th className="py-1 px-2">真实重量 (g)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weightCalibResults.map(r => (
                          <tr key={r.index} className="border-b last:border-0">
                            <td className="py-1 px-2 font-mono">{r.index + 1}</td>
                            <td className="py-1 px-2 text-right font-mono">{r.setVolumeMm}</td>
                            <td className="py-1 px-2 text-right font-mono">{r.setVolumeMl.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono">{r.measuredWeight.toFixed(2)}</td>
                            <td className="py-1 px-2">
                              <Input
                                type="number"
                                step="0.1"
                                className="h-7 w-24 text-xs"
                                placeholder="输入真实值"
                                value={r.realWeight ?? ''}
                                onChange={e => {
                                  const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                  updateWeightCalibRealWeight(r.index, val);
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 text-xs text-muted-foreground">
                      提示: 输入用电子秤测量的排出液体真实重量，系统将自动拟合称重变化值到真实值的线性关系
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* 基线漂移分析 */}
            {advancedTestType === 'baseline' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">基线漂移分析</h3>
                  <p className="text-xs text-muted-foreground">数据来自自动测试结果</p>
                </div>
                
                {baselineDriftData.length < 2 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">请先在「实时监测」中运行自动测试</p>
                    <p className="text-xs">至少需要2个循环的数据</p>
                  </div>
                ) : (
                  <>
                    {/* 基线漂移图表 */}
                    {baselineDriftChartOption && (
                      <div className="rounded-lg border p-3">
                        <div className="text-xs font-medium mb-2">空瓶基线漂移趋势</div>
                        <ReactECharts option={baselineDriftChartOption} style={{ height: 200 }} />
                      </div>
                    )}
                    
                    {/* 漂移统计 */}
                    {baselineDriftStats && (
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 rounded-lg bg-muted/50">
                          <div className="text-xs text-muted-foreground">总漂移</div>
                          <div className={`text-xl font-bold ${Math.abs(baselineDriftStats.totalDrift) < 1 ? 'text-green-600' : Math.abs(baselineDriftStats.totalDrift) < 3 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {baselineDriftStats.totalDrift >= 0 ? '+' : ''}{baselineDriftStats.totalDrift.toFixed(2)}g
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <div className="text-xs text-muted-foreground">最大漂移</div>
                          <div className={`text-xl font-bold ${baselineDriftStats.maxDrift < 1 ? 'text-green-600' : baselineDriftStats.maxDrift < 3 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {baselineDriftStats.maxDrift.toFixed(2)}g
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <div className="text-xs text-muted-foreground">平均每循环漂移</div>
                          <div className={`text-xl font-bold ${Math.abs(baselineDriftStats.avgDriftPerCycle) < 0.5 ? 'text-green-600' : Math.abs(baselineDriftStats.avgDriftPerCycle) < 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {baselineDriftStats.avgDriftPerCycle >= 0 ? '+' : ''}{baselineDriftStats.avgDriftPerCycle.toFixed(3)}g
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {/* 共享日志 */}
            {autoTestLog.length > 0 && (
              <div className="relative">
                <div 
                  ref={logContainerRef}
                  onScroll={handleLogScroll}
                  className="max-h-40 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded-lg p-2 font-mono text-xs border"
                >
                  {autoTestLog.map((log, i) => (
                    <div key={i} className={`py-0.5 ${log.includes('===') ? 'font-bold text-primary' : ''}`}>{log}</div>
                  ))}
                </div>
                {!autoScrollEnabled && (
                  <button
                    onClick={() => {
                      setAutoScrollEnabled(true);
                      if (logContainerRef.current) {
                        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                      }
                    }}
                    className="absolute bottom-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded shadow-md hover:bg-primary/90"
                  >
                    ↓ 回到底部
                  </button>
                )}
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
                  空瓶基准 (动态跟踪)
                </h4>
                <div className="flex items-center gap-4">
                  <div>
                    当前值: <strong>{dynamicEmptyWeight !== null ? `${dynamicEmptyWeight.toFixed(1)}g` : '未设置'}</strong>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => resetDynamicEmptyWeight()}>
                    重置
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fetchDynamicEmptyWeight()}>
                    刷新
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  空瓶值会在每次排废等待时自动更新
                </p>
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
