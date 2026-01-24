"use client";

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
} from "lucide-react";
import { useState } from "react";

export interface StepAction {
  type: "inject" | "drain" | "wait" | "acquire" | "set_state" | "set_gas_pump" | "phase_marker" | "loop";
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
};

interface StepNodeProps {
  step: ExperimentStep;
  index: number;
  currentStep?: number;
  depth?: number;
  isLast?: boolean;
}

function StepNode({ step, index, currentStep, depth = 0, isLast = false }: StepNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const config = actionConfig[step.action.type] || actionConfig.wait;
  const Icon = config.icon;
  const isActive = currentStep === index;
  const isCompleted = currentStep !== undefined && index < currentStep;

  if (step.action.type === "loop" && step.action.steps) {
    return (
      <div className="relative">
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
    <div className="relative">
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
          <div className="font-medium text-sm truncate">{step.name}</div>
          <div className="text-xs text-muted-foreground">
            {getStepDescription(step.action)}
          </div>
        </div>
        {isActive && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-primary font-medium">运行中</span>
          </div>
        )}
        {isCompleted && (
          <div className="text-xs text-green-600 font-medium">已完成</div>
        )}
      </div>
    </div>
  );
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
    default:
      return "";
  }
}

interface ExperimentFlowProps {
  program: ExperimentProgram;
  currentStep?: number;
  className?: string;
}

export function ExperimentFlow({ program, currentStep, className }: ExperimentFlowProps) {
  // 解析阶段
  const phases = extractPhases(program.steps);

  return (
    <div className={cn("space-y-4", className)}>
      {/* 程序信息 */}
      <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
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
      <div className="flex flex-wrap gap-2">
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

      {/* 步骤流程 */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
        {program.steps.map((step, index) => (
          <StepNode
            key={index}
            step={step}
            index={index}
            currentStep={currentStep}
            isLast={index === program.steps.length - 1}
          />
        ))}
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t">
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">{countSteps(program.steps)}</div>
          <div className="text-xs text-muted-foreground">总步骤数</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{phases.length}</div>
          <div className="text-xs text-muted-foreground">阶段数</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-600">{countLoops(program.steps)}</div>
          <div className="text-xs text-muted-foreground">循环次数</div>
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

// 从YAML解析的原始数据转换为组件需要的格式
export function parseYamlProgram(yaml: Record<string, unknown>): ExperimentProgram {
  return {
    id: yaml.id as string || "unknown",
    name: yaml.name as string || "未命名程序",
    description: yaml.description as string,
    version: yaml.version as string,
    hardware: yaml.hardware as ExperimentProgram["hardware"],
    steps: parseSteps(yaml.steps as Array<Record<string, unknown>> || []),
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
    }
    
    return { name, action: { type: "wait" } };
  });
}
