/**
 * 节点字段组件的共享类型定义
 */

import { ExperimentNode, ExperimentEdge } from '../../types';
import { LiquidItem, PumpAssignment, HeaterProfile } from '../../data-fetcher';

// 字段组件的通用 Props
export interface NodeFieldsProps {
  data: Record<string, unknown>;
  handleChange: (key: string, value: unknown) => void;
}

// 需要外部数据的字段组件 Props
export interface NodeFieldsWithExternalDataProps extends NodeFieldsProps {
  liquids: LiquidItem[];
  pumpAssignments: PumpAssignment[];
  loadingLiquids: boolean;
  onRefreshLiquids: () => void;
}

// 需要节点图上下文的字段组件 Props
export interface NodeFieldsWithContextProps extends NodeFieldsProps {
  nodeId: string;
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
}

// 加热器配置字段组件 Props
export interface HeaterFieldsProps extends NodeFieldsProps {
  profiles: HeaterProfile[];
  loading: boolean;
  onRefreshProfiles: () => void;
  onOpenDialog: () => void;
}

// 序列生成模式
export type SeqGenType = 'linear' | 'log' | 'exp' | 'quadratic' | 'sqrt';

export const SEQ_GEN_LABELS: Record<SeqGenType, string> = {
  linear: '线性等差',
  log: '对数（小值密集）',
  exp: '指数（大值密集）',
  quadratic: '二次曲线',
  sqrt: '平方根',
};

// 参数类型配置
export const PARAM_TYPE_CONFIG: Record<string, { 
  unit: string; 
  min: number; 
  max: number; 
  step: number; 
  defaultStart: number; 
  defaultEnd: number; 
  defaultStep: number 
}> = {
  ratio: { unit: '%', min: 0, max: 100, step: 5, defaultStart: 10, defaultEnd: 90, defaultStep: 10 },
  volume: { unit: 'ml', min: 1, max: 100, step: 1, defaultStart: 5, defaultEnd: 30, defaultStep: 5 },
  gasPumpPwm: { unit: '%', min: 0, max: 100, step: 5, defaultStart: 20, defaultEnd: 80, defaultStep: 10 },
  duration: { unit: 's', min: 10, max: 600, step: 10, defaultStart: 60, defaultEnd: 300, defaultStep: 60 },
  cycles: { unit: '周期', min: 1, max: 50, step: 1, defaultStart: 5, defaultEnd: 20, defaultStep: 5 },
};

// 生成序列的函数
export function generateSequence(type: SeqGenType, min: number, max: number, steps: number): number[] {
  if (steps < 2) return [min, max];
  const result: number[] = [];
  
  switch (type) {
    case 'linear':
      for (let i = 0; i < steps; i++) {
        result.push(Math.round(min + (max - min) * i / (steps - 1)));
      }
      break;
    case 'log':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const logVal = Math.log(1 + t * (Math.E - 1));
        result.push(Math.round(min + (max - min) * logVal));
      }
      break;
    case 'exp':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const expVal = (Math.exp(t) - 1) / (Math.E - 1);
        result.push(Math.round(min + (max - min) * expVal));
      }
      break;
    case 'quadratic':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        result.push(Math.round(min + (max - min) * t * t));
      }
      break;
    case 'sqrt':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        result.push(Math.round(min + (max - min) * Math.sqrt(t)));
      }
      break;
  }
  
  return [...new Set(result)].sort((a, b) => a - b);
}

// 提取基础预设名称（去除 __N 后缀）
export function getBaseProfileName(name: string): string {
  return name.replace(/__\d+$/, '');
}
