"use client";

import yaml from "js-yaml";
import { cn } from "@/lib/utils";
import {
  Droplets,
  Wind,
  Timer,
  Activity,
  Trash2,
  Settings,
  Repeat,
  Flag,
  ChevronDown,
  ChevronRight,
  Beaker,
  Sparkles,
  Flame,
  Thermometer,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface StepAction {
  type: "inject" | "drain" | "wait" | "acquire" | "set_state" | "set_gas_pump" | "phase_marker" | "loop" | "wash" | "preheat" | "configure_heater";
  details?: Record<string, unknown>;
  steps?: ExperimentStep[];
  count?: number;
}

export interface ExperimentStep {
  name: string;
  action: StepAction;
}

// 编译估算数据（来自 YAML 的 _compile_estimate）
export interface CompileEstimate {
  total_duration_s: number;
  peak_liquid_level_ml: number;
  peak_liquid_level_ml_with_wash: number;
  total_inject_ml: number;
  total_drain_ml: number;
  total_wash_volume_ml: number;
  liquid_consumption: Array<{
    liquid_id: string;
    liquid_name: string;
    pump_index: number;
    required_ml: number;
  }>;
  pump_estimates: Array<{
    pump_index: number;
    volume_ml: number;
    runtime_s: number;
  }>;
}

export interface ExperimentProgram {
  id: string;
  name: string;
  description?: string;
  version?: string;
  hardware?: {
    bottle_capacity_ml?: number;
    max_fill_ml?: number;
    liquids?: Array<{
      id: string;
      name: string;
      pump_index: number;
      type: string;
    }>;
  };
  steps: ExperimentStep[];
  compileEstimate?: CompileEstimate;
}

const actionConfig: Record<string, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  inject: { icon: Droplets, color: "text-blue-600", bgColor: "bg-blue-100", label: "进样" },
  drain: { icon: Trash2, color: "text-orange-600", bgColor: "bg-orange-100", label: "排废" },
  wait: { icon: Timer, color: "text-gray-600", bgColor: "bg-gray-100", label: "等待" },
  acquire: { icon: Activity, color: "text-green-600", bgColor: "bg-green-100", label: "采集" },
  set_state: { icon: Settings, color: "text-purple-600", bgColor: "bg-purple-100", label: "状态" },
  set_gas_pump: { icon: Wind, color: "text-cyan-600", bgColor: "bg-cyan-100", label: "气泵" },
  phase_marker: { icon: Flag, color: "text-pink-600", bgColor: "bg-pink-100", label: "标记" },
  loop: { icon: Repeat, color: "text-amber-600", bgColor: "bg-amber-100", label: "循环" },
  wash: { icon: Sparkles, color: "text-emerald-600", bgColor: "bg-emerald-100", label: "清洗" },
  preheat: { icon: Flame, color: "text-red-600", bgColor: "bg-red-100", label: "预热" },
  configure_heater: { icon: Thermometer, color: "text-violet-600", bgColor: "bg-violet-100", label: "加热器" },
};

interface StepNodeProps {
  step: ExperimentStep;
  index: number;
  currentStep?: number;
  stepElapsedSeconds?: number;
  depth?: number;
  isLast?: boolean;
}

function StepNode({ step, index, currentStep, stepElapsedSeconds = 0, depth = 0, isLast = false }: StepNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const config = actionConfig[step.action.type] || actionConfig.wait;
  const Icon = config.icon;
  // currentStep 是 1-indexed（来自UI显示），index 是 0-indexed
  // 转换为 0-indexed 进行比较：currentStep - 1 是当前正在执行的步骤索引
  const currentStepIndex = currentStep !== undefined ? currentStep - 1 : undefined;
  const isActive = currentStepIndex === index;
  const isCompleted = currentStepIndex !== undefined && index < currentStepIndex;
  
  // 获取步骤时间信息
  const timeInfo = getStepTimeInfo(step.action);
  const progressPercent = isActive && timeInfo.fixedDuration 
    ? Math.min(100, (stepElapsedSeconds / timeInfo.fixedDuration) * 100)
    : 0;

  if (step.action.type === "loop" && step.action.steps) {
    return (
      <div className="relative" data-step-index={index}>
        {/* 连接线 */}
        {!isLast && (
          <div className="absolute left-5 top-12 bottom-0 w-0.5 bg-border" style={{ marginLeft: depth * 24 }} />
        )}
        
        {/* 循环头 */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
            isActive && "ring-2 ring-primary",
            isCompleted && "opacity-60"
          )}
          style={{ marginLeft: depth * 24 }}
          onClick={() => setExpanded(!expanded)}
        >
          <div className={cn("p-2 rounded-lg", config.bgColor)}>
            <Icon className={cn("h-5 w-5", config.color)} />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{step.name}</div>
            <div className="text-xs text-muted-foreground">
              重复 {step.action.count || 1} 次
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* 循环体 */}
        {expanded && (
          <div className="mt-2 ml-6 pl-4 border-l-2 border-dashed border-amber-300" style={{ marginLeft: depth * 24 }}>
            {step.action.steps.map((subStep, subIndex) => (
              <div key={subIndex} className="mb-2">
                <StepNode
                  step={subStep}
                  index={index + subIndex + 1}
                  currentStep={currentStep}
                  depth={depth + 1}
                  isLast={subIndex === (step.action.steps?.length || 0) - 1}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 普通步骤
  return (
    <div className="relative" data-step-index={index}>
      {/* 连接线 */}
      {!isLast && depth === 0 && (
        <div className="absolute left-5 top-12 h-full w-0.5 bg-border" />
      )}
      
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border transition-all",
          isActive && "ring-2 ring-primary bg-primary/5",
          isCompleted && "opacity-60 bg-muted/50",
          !isActive && !isCompleted && "hover:bg-muted/30"
        )}
        style={{ marginLeft: depth * 24 }}
      >
        <div className={cn(
          "p-2 rounded-lg relative",
          config.bgColor,
          isCompleted && "after:absolute after:inset-0 after:bg-green-500/20 after:rounded-lg"
        )}>
          <Icon className={cn("h-5 w-5", config.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{step.name}</span>
            {(() => {
              const duration = getStepDuration(step.action);
              if (duration) {
                return (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                    <Timer className="h-3 w-3" />
                    {formatDuration(duration)}
                  </span>
                );
              }
              return null;
            })()}
          </div>
          <div className="text-xs text-muted-foreground">
            {getStepDescription(step.action)}
          </div>
        </div>
        {isActive && (
          <div className="flex items-center gap-2">
            {timeInfo.fixedDuration ? (
              // 固定时间步骤：显示进度和时间
              <div className="flex items-center gap-2 min-w-[120px]">
                <span className="text-xs text-primary font-mono whitespace-nowrap">
                  {formatDuration(Math.floor(stepElapsedSeconds))}/{formatDuration(timeInfo.fixedDuration)}
                </span>
              </div>
            ) : timeInfo.maxTimeout ? (
              // 浮动时间步骤：显示当前时间和最大超时
              <div className="flex items-center gap-1">
                <span className="text-xs text-orange-600 font-mono">
                  {formatDuration(Math.floor(stepElapsedSeconds))}
                </span>
                <span className="text-xs text-muted-foreground">/</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {formatDuration(timeInfo.maxTimeout)}
                </span>
              </div>
            ) : (
              // 无时间信息的步骤
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs text-primary font-medium">运行中</span>
              </div>
            )}
          </div>
        )}
        {isCompleted && (
          <div className="text-xs text-green-600 font-medium">已完成</div>
        )}
      </div>
      {/* 固定时间步骤的进度条 */}
      {isActive && timeInfo.fixedDuration && (
        <Progress value={progressPercent} className="h-1 mt-1" />
      )}
    </div>
  );
}

// 步骤时间信息
interface StepTimeInfo {
  fixedDuration: number | null;  // 固定时间（可精确计算进度）
  maxTimeout: number | null;     // 最大超时（时间不确定）
  displayDuration: number | null; // 显示用时间
}

// 获取步骤的时间信息
function getStepTimeInfo(action: StepAction): StepTimeInfo {
  const details = action.details || {};
  
  switch (action.type) {
    case "wait":
      // 等待是固定时间
      const waitDuration = (details as { duration_s?: number }).duration_s || null;
      return { fixedDuration: waitDuration, maxTimeout: null, displayDuration: waitDuration };
    
    case "acquire": {
      // 数据采集：检查是否有固定 duration_s
      const acquireDuration = (details as { duration_s?: number }).duration_s;
      const maxDuration = (details as { max_duration_s?: number }).max_duration_s;
      if (acquireDuration) {
        // 有 duration_s 是固定时间
        return { fixedDuration: acquireDuration, maxTimeout: null, displayDuration: acquireDuration };
      }
      // 否则是浮动时间，有最大超时
      return { fixedDuration: null, maxTimeout: maxDuration || null, displayDuration: maxDuration || null };
    }
    
    case "preheat": {
      // 预热：检查是否有固定 duration_s
      const preheatDuration = (details as { duration_s?: number }).duration_s;
      const preheatMaxDuration = (details as { max_duration_s?: number }).max_duration_s;
      if (preheatDuration) {
        return { fixedDuration: preheatDuration, maxTimeout: null, displayDuration: preheatDuration };
      }
      return { fixedDuration: null, maxTimeout: preheatMaxDuration || null, displayDuration: preheatMaxDuration || null };
    }
    
    case "inject": {
      // 进样时间 = 进样时间 + 稳定时间
      // 进样时间 = target_volume_ml / flow_rate_ml_s
      const targetVolume = (details as { target_volume_ml?: number }).target_volume_ml;
      const flowRate = (details as { flow_rate_ml_s?: number }).flow_rate_ml_s || 3; // 默认 3 ml/s
      const stableTimeout = (details as { stable_timeout_s?: number }).stable_timeout_s || 5;
      
      if (targetVolume && flowRate > 0) {
        const injectTime = Math.ceil(targetVolume / flowRate);
        const totalTime = injectTime + stableTimeout;
        // 进样是浮动时间（实际可能提前完成），显示估算总时间
        return { fixedDuration: null, maxTimeout: totalTime, displayDuration: totalTime };
      }
      // 如果没有体积信息，只显示稳定超时
      return { fixedDuration: null, maxTimeout: stableTimeout, displayDuration: stableTimeout };
    }
    
    case "drain":
      // 排废是浮动时间，有最大超时
      const drainTimeout = (details as { timeout_s?: number }).timeout_s || null;
      return { fixedDuration: null, maxTimeout: drainTimeout, displayDuration: drainTimeout };
    
    case "wash": {
      // 清洗是浮动时间，估算最大时间
      const fillTimeout = (details as { fill_timeout_s?: number }).fill_timeout_s || 30;
      const washDrainTimeout = (details as { drain_timeout_s?: number }).drain_timeout_s || 60;
      const repeatCount = (details as { repeat_count?: number }).repeat_count || 1;
      const totalTimeout = (fillTimeout + washDrainTimeout) * repeatCount;
      return { fixedDuration: null, maxTimeout: totalTimeout, displayDuration: totalTimeout };
    }
    
    default:
      return { fixedDuration: null, maxTimeout: null, displayDuration: null };
  }
}

// 获取步骤的预估耗时（秒）- 用于显示徽章
function getStepDuration(action: StepAction): number | null {
  const timeInfo = getStepTimeInfo(action);
  return timeInfo.displayDuration;
}

// 格式化耗时显示
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m${secs}s`;
}

function getStepDescription(action: StepAction): string {
  const details = action.details || {};
  
  switch (action.type) {
    case "inject":
      const volume = (details as { target_volume_ml?: number }).target_volume_ml;
      return volume ? `目标 ${volume} mL` : "进样操作";
    case "drain":
      const timeout = (details as { timeout_s?: number }).timeout_s;
      return timeout ? `超时 ${timeout}s` : "排废操作";
    case "wait":
      const duration = (details as { duration_s?: number }).duration_s;
      return duration ? `等待 ${duration}s` : "等待操作";
    case "acquire":
      const cycles = (details as { heater_cycles?: number }).heater_cycles;
      const maxDuration = (details as { max_duration_s?: number }).max_duration_s;
      if (cycles) return `${cycles} 个加热周期`;
      if (maxDuration) return `最长 ${maxDuration}s`;
      return "数据采集";
    case "set_state":
      const state = (details as { state?: string }).state;
      return state ? state.replace("STATE_", "") : "状态切换";
    case "set_gas_pump":
      const pwm = (details as { pwm_percent?: number }).pwm_percent;
      return pwm !== undefined ? `PWM ${pwm}%` : "气泵控制";
    case "phase_marker":
      const phase = (details as { phase_name?: string }).phase_name;
      const isStart = (details as { is_start?: boolean }).is_start;
      return phase ? `${phase} ${isStart ? "开始" : "结束"}` : "阶段标记";
    case "loop":
      return `循环 ${action.count || 1} 次`;
    case "wash":
      const washVolume = (details as { wash_volume_ml?: number }).wash_volume_ml;
      const washRepeatCount = (details as { repeat_count?: number }).repeat_count;
      return washVolume ? `${washVolume}ml × ${washRepeatCount || 1}次` : "清洗操作";
    case "preheat":
      const preheatDuration = (details as { duration_s?: number }).duration_s;
      const preheatCycles = (details as { cycles?: number }).cycles;
      if (preheatCycles) return `${preheatCycles} 个周期`;
      if (preheatDuration) return `${preheatDuration}s`;
      return "传感器预热";
    case "configure_heater":
      const configs = (details as { configs?: unknown[] }).configs;
      return configs ? `${configs.length} 个配置` : "配置加热器";
    default:
      return "";
  }
}

// 泵余量状态（由父组件查询后传入）
export interface PumpStatusInfo {
  pumpIndex: number;
  liquidId?: number;
  liquidName?: string;
  initialVolumeMl: number;
  consumedVolumeMl: number;
  remainingVolumeMl: number;
  isLowVolume: boolean;
  isWashPump?: boolean;
}

interface ExperimentFlowProps {
  program: ExperimentProgram;
  currentStep?: number;
  stepElapsedSeconds?: number;
  className?: string;
  pumpStatus?: PumpStatusInfo[];
}

export function ExperimentFlow({ program, currentStep, stepElapsedSeconds, className, pumpStatus }: ExperimentFlowProps) {
  // 本地计时器：当 currentStep 变化时重置
  const [localElapsed, setLocalElapsed] = useState(0);
  const stepStartTimeRef = useRef<number>(Date.now());
  const lastStepRef = useRef<number | undefined>(undefined);
  
  useEffect(() => {
    if (currentStep !== lastStepRef.current) {
      // 步骤变化，重置计时器
      stepStartTimeRef.current = Date.now();
      setLocalElapsed(0);
      lastStepRef.current = currentStep;
    }
  }, [currentStep]);
  
  // 本地计时器更新
  useEffect(() => {
    if (currentStep === undefined) return;
    
    const interval = setInterval(() => {
      const elapsed = (Date.now() - stepStartTimeRef.current) / 1000;
      setLocalElapsed(elapsed);
    }, 100);
    
    return () => clearInterval(interval);
  }, [currentStep]);
  
  // 使用外部传入的时间或本地计时
  const effectiveElapsed = stepElapsedSeconds ?? localElapsed;
  
  // 解析阶段
  const phases = extractPhases(program.steps);

  // 自动滚动到当前步骤
  const stepsContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (currentStep === undefined || !stepsContainerRef.current) return;
    const activeEl = stepsContainerRef.current.querySelector(`[data-step-index="${currentStep - 1}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentStep]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 程序信息 */}
      <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg flex-shrink-0">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Beaker className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">{program.name}</h3>
          <p className="text-sm text-muted-foreground">{program.description}</p>
        </div>
        {program.version && (
          <div className="ml-auto text-xs text-muted-foreground">
            v{program.version}
          </div>
        )}
      </div>

      {/* 阶段概览 */}
      {phases.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 flex-shrink-0">
          {phases.map((phase, index) => (
            <div
              key={index}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border",
                phase.active ? "bg-primary text-primary-foreground border-primary" :
                phase.completed ? "bg-muted text-muted-foreground border-muted" :
                "bg-background text-foreground border-border"
              )}
            >
              {phase.name}
            </div>
          ))}
        </div>
      )}

      {/* 步骤流程 - 可滚动区域 */}
      <div ref={stepsContainerRef} className="space-y-2 flex-1 min-h-0 overflow-y-auto px-1 py-1 mt-3">
        {program.steps.map((step, index) => (
          <StepNode
            key={index}
            step={step}
            index={index}
            currentStep={currentStep}
            stepElapsedSeconds={effectiveElapsed}
            isLast={index === program.steps.length - 1}
          />
        ))}
      </div>

      {/* 统计信息 - 固定底部 */}
      {program.compileEstimate ? (
        <div className="pt-3 mt-3 border-t flex-shrink-0 space-y-2">
          {/* 第一行：时长 + 步骤数 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-blue-500/10">
              <Clock className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">预计时长</div>
                <div className="text-xs font-semibold truncate">{formatDurationCompact(program.compileEstimate.total_duration_s)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-cyan-500/10">
              <Beaker className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">峰值液位</div>
                <div className="text-xs font-semibold">{program.compileEstimate.peak_liquid_level_ml.toFixed(0)} ml</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-primary/10">
              <Repeat className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">总步骤</div>
                <div className="text-xs font-semibold">{countSteps(program.steps)}</div>
              </div>
            </div>
          </div>
          {/* 第二行：进样 / 排废 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-green-500/10">
              <Droplets className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">总进样</div>
                <div className="text-xs font-semibold">{program.compileEstimate.total_inject_ml.toFixed(1)} ml</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-orange-500/10">
              <Trash2 className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">总排废</div>
                <div className="text-xs font-semibold">
                  {program.compileEstimate.total_drain_ml.toFixed(1)} ml
                  {program.compileEstimate.total_wash_volume_ml > 0 && (
                    <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
                      (含清洗{program.compileEstimate.total_wash_volume_ml.toFixed(0)})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* 液体消耗明细 */}
          {program.compileEstimate.liquid_consumption.length > 0 && (
            <LiquidConsumptionPanel
              consumption={program.compileEstimate.liquid_consumption}
              pumpStatus={pumpStatus}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 pt-3 mt-3 border-t flex-shrink-0">
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{countSteps(program.steps)}</div>
            <div className="text-[10px] text-muted-foreground">总步骤数</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-green-600">{phases.length}</div>
            <div className="text-[10px] text-muted-foreground">阶段数</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-amber-600">{countLoops(program.steps)}</div>
            <div className="text-[10px] text-muted-foreground">循环次数</div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Phase {
  name: string;
  completed: boolean;
  active: boolean;
}

function extractPhases(steps: ExperimentStep[]): Phase[] {
  const phases: Phase[] = [];
  const seen = new Set<string>();

  function extract(stepList: ExperimentStep[]) {
    for (const step of stepList) {
      if (step.action.type === "phase_marker") {
        const details = step.action.details as { phase_name?: string; is_start?: boolean } | undefined;
        const phaseName = details?.phase_name;
        if (phaseName && details?.is_start && !seen.has(phaseName)) {
          seen.add(phaseName);
          phases.push({ name: phaseName, completed: false, active: false });
        }
      } else if (step.action.type === "loop" && step.action.steps) {
        extract(step.action.steps);
      }
    }
  }

  extract(steps);
  return phases;
}

function countSteps(steps: ExperimentStep[]): number {
  let count = 0;
  for (const step of steps) {
    count++;
    if (step.action.type === "loop" && step.action.steps) {
      count += countSteps(step.action.steps) * (step.action.count || 1);
    }
  }
  return count;
}

function countLoops(steps: ExperimentStep[]): number {
  let count = 0;
  for (const step of steps) {
    if (step.action.type === "loop") {
      count += step.action.count || 1;
      if (step.action.steps) {
        count += countLoops(step.action.steps);
      }
    }
  }
  return count;
}

function formatDurationCompact(seconds: number): string {
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

// 液体消耗面板：显示需求量 vs 泵余量
function LiquidConsumptionPanel({ 
  consumption, 
  pumpStatus 
}: { 
  consumption: CompileEstimate['liquid_consumption'];
  pumpStatus?: PumpStatusInfo[];
}) {
  // 按泵索引建立查找表（样品泵）；按 liquidId 建立查找表（清洗泵）
  const samplePumpMap = new Map<number, PumpStatusInfo>();
  const washPumpByLiquidId = new Map<number, PumpStatusInfo>();
  if (pumpStatus) {
    for (const p of pumpStatus) {
      if (p.isWashPump) {
        if (p.liquidId) washPumpByLiquidId.set(p.liquidId, p);
      } else {
        samplePumpMap.set(p.pumpIndex, p);
      }
    }
  }

  // 根据 liquid_consumption 条目找到对应的泵
  function findPump(lc: CompileEstimate['liquid_consumption'][0]): PumpStatusInfo | undefined {
    if (lc.pump_index >= 0) {
      return samplePumpMap.get(lc.pump_index);
    }
    // 清洗液 pump_index=-1，按 liquid_id 匹配清洗泵
    const lid = parseInt(lc.liquid_id);
    if (!isNaN(lid)) return washPumpByLiquidId.get(lid);
    return undefined;
  }

  // 判断整体是否有不足
  const hasInsufficient = pumpStatus ? consumption.some(lc => {
    const pump = findPump(lc);
    return pump && pump.initialVolumeMl > 0 && pump.remainingVolumeMl < lc.required_ml;
  }) : false;

  // 是否所有泵都有数据
  const hasPumpData = pumpStatus && pumpStatus.length > 0;

  return (
    <div className={cn(
      "px-2 py-1.5 rounded border",
      hasInsufficient ? "border-red-500/40 bg-red-500/5" : "bg-muted/30"
    )}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-medium text-muted-foreground">液体消耗</div>
        {hasPumpData && (
          hasInsufficient ? (
            <div className="flex items-center gap-0.5 text-[10px] text-red-600 font-medium">
              <AlertTriangle className="w-3 h-3" />余量不足
            </div>
          ) : (
            <div className="flex items-center gap-0.5 text-[10px] text-green-600">
              <CheckCircle2 className="w-3 h-3" />余量充足
            </div>
          )
        )}
      </div>
      <div className="space-y-1">
        {consumption.map((lc) => {
          const pump = findPump(lc);
          const hasData = pump && pump.initialVolumeMl > 0;
          const insufficient = hasData && pump!.remainingVolumeMl < lc.required_ml;
          const ratio = hasData ? Math.min(100, (lc.required_ml / pump!.remainingVolumeMl) * 100) : 0;
          const isWash = lc.pump_index < 0;

          return (
            <div key={`${lc.liquid_id}-${lc.pump_index}`}>
              <div className="flex justify-between items-center text-[11px]">
                <span className={cn("truncate", insufficient ? "text-red-600 font-medium" : "text-muted-foreground")}>
                  {lc.liquid_name}
                  {isWash ? (
                    <span className="text-[10px] ml-0.5">(清洗)</span>
                  ) : lc.pump_index >= 0 ? (
                    <span className="text-[10px] ml-0.5">(泵{lc.pump_index})</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <span className={cn("font-medium", insufficient && "text-red-600")}>
                    {lc.required_ml.toFixed(1)}
                  </span>
                  {hasData && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={cn(
                          "text-[10px]",
                          insufficient ? "text-red-500" : "text-muted-foreground"
                        )}>
                          / {pump!.remainingVolumeMl.toFixed(0)} ml
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        <div>需要 {lc.required_ml.toFixed(1)} ml</div>
                        <div>余量 {pump!.remainingVolumeMl.toFixed(1)} / {pump!.initialVolumeMl.toFixed(0)} ml</div>
                        {insufficient && <div className="text-red-400 font-medium">不足 {(lc.required_ml - pump!.remainingVolumeMl).toFixed(1)} ml</div>}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!hasData && <span className="text-[10px] text-muted-foreground">ml</span>}
                </span>
              </div>
              {/* 余量进度条 */}
              {hasData && (
                <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      insufficient ? "bg-red-500" : ratio > 70 ? "bg-yellow-500" : "bg-green-500"
                    )}
                    style={{ width: `${Math.min(100, ratio)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 从YAML字符串解析为程序对象
export function parseYamlString(yamlStr: string): ExperimentProgram {
  const parsed = yaml.load(yamlStr) as Record<string, unknown>;
  return parseYamlProgram(parsed);
}

// 从YAML解析的原始数据转换为组件需要的格式
export function parseYamlProgram(data: Record<string, unknown>): ExperimentProgram {
  const compileEstimateRaw = data._compile_estimate as Record<string, unknown> | undefined;
  return {
    id: data.id as string || "unknown",
    name: data.name as string || "未命名程序",
    description: data.description as string,
    version: data.version as string,
    hardware: data.hardware as ExperimentProgram["hardware"],
    steps: parseSteps(data.steps as Array<Record<string, unknown>> || []),
    compileEstimate: compileEstimateRaw ? {
      total_duration_s: Number(compileEstimateRaw.total_duration_s) || 0,
      peak_liquid_level_ml: Number(compileEstimateRaw.peak_liquid_level_ml) || 0,
      peak_liquid_level_ml_with_wash: Number(compileEstimateRaw.peak_liquid_level_ml_with_wash) || 0,
      total_inject_ml: Number(compileEstimateRaw.total_inject_ml) || 0,
      total_drain_ml: Number(compileEstimateRaw.total_drain_ml) || 0,
      total_wash_volume_ml: Number(compileEstimateRaw.total_wash_volume_ml) || 0,
      liquid_consumption: (compileEstimateRaw.liquid_consumption as Array<Record<string, unknown>> || []).map(lc => ({
        liquid_id: String(lc.liquid_id),
        liquid_name: String(lc.liquid_name),
        pump_index: Number(lc.pump_index),
        required_ml: Number(lc.required_ml),
      })),
      pump_estimates: (compileEstimateRaw.pump_estimates as Array<Record<string, unknown>> || []).map(pe => ({
        pump_index: Number(pe.pump_index),
        volume_ml: Number(pe.volume_ml),
        runtime_s: Number(pe.runtime_s),
      })),
    } : undefined,
  };
}

function parseSteps(rawSteps: Array<Record<string, unknown>>): ExperimentStep[] {
  return rawSteps.map((raw) => {
    const name = raw.name as string || "未命名步骤";
    
    // 检测动作类型
    if (raw.inject) {
      return { name, action: { type: "inject", details: raw.inject as Record<string, unknown> } };
    } else if (raw.drain) {
      return { name, action: { type: "drain", details: raw.drain as Record<string, unknown> } };
    } else if (raw.wait) {
      return { name, action: { type: "wait", details: raw.wait as Record<string, unknown> } };
    } else if (raw.acquire) {
      return { name, action: { type: "acquire", details: raw.acquire as Record<string, unknown> } };
    } else if (raw.set_state) {
      return { name, action: { type: "set_state", details: raw.set_state as Record<string, unknown> } };
    } else if (raw.set_gas_pump) {
      return { name, action: { type: "set_gas_pump", details: raw.set_gas_pump as Record<string, unknown> } };
    } else if (raw.phase_marker) {
      return { name, action: { type: "phase_marker", details: raw.phase_marker as Record<string, unknown> } };
    } else if (raw.loop) {
      const loopData = raw.loop as Record<string, unknown>;
      return {
        name,
        action: {
          type: "loop",
          count: loopData.count as number || 1,
          steps: parseSteps(loopData.steps as Array<Record<string, unknown>> || []),
        },
      };
    } else if (raw.wash) {
      return { name, action: { type: "wash", details: raw.wash as Record<string, unknown> } };
    } else if (raw.preheat) {
      return { name, action: { type: "preheat", details: raw.preheat as Record<string, unknown> } };
    } else if (raw.configure_heater) {
      return { name, action: { type: "configure_heater", details: raw.configure_heater as Record<string, unknown> } };
    }
    
    return { name, action: { type: "wait" } };
  });
}
