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
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";

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

interface ExperimentFlowProps {
  program: ExperimentProgram;
  currentStep?: number;
  stepElapsedSeconds?: number;
  className?: string;
}

export function ExperimentFlow({ program, currentStep, stepElapsedSeconds, className }: ExperimentFlowProps) {
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

// 从YAML字符串解析为程序对象
export function parseYamlString(yamlStr: string): ExperimentProgram {
  const parsed = yaml.load(yamlStr) as Record<string, unknown>;
  return parseYamlProgram(parsed);
}

// 从YAML解析的原始数据转换为组件需要的格式
export function parseYamlProgram(data: Record<string, unknown>): ExperimentProgram {
  return {
    id: data.id as string || "unknown",
    name: data.name as string || "未命名程序",
    description: data.description as string,
    version: data.version as string,
    hardware: data.hardware as ExperimentProgram["hardware"],
    steps: parseSteps(data.steps as Array<Record<string, unknown>> || []),
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
