import { Node, Edge } from '@xyflow/react';

// 节点类型枚举
export enum NodeType {
  // 流程控制
  START = 'start',
  END = 'end',
  LOOP = 'loop',
  PHASE_MARKER = 'phaseMarker',
  
  // 液体操作
  INJECT = 'inject',
  DRAIN = 'drain',
  WASH = 'wash',
  LIQUID_SOURCE = 'liquidSource',
  
  // 参数扫描
  PARAM_SWEEP = 'paramSweep',
  
  // 传感器
  ACQUIRE = 'acquire',
  
  // 等待
  WAIT_TIME = 'waitTime',
  WAIT_CYCLES = 'waitCycles',
  WAIT_STABILITY = 'waitStability',
  
  // 状态控制
  SET_STATE = 'setState',
  SET_GAS_PUMP = 'setGasPump',
  
  // 硬件配置
  HARDWARE_CONFIG = 'hardwareConfig',
}

// 节点分类
export const NODE_CATEGORIES = {
  flow: {
    label: '流程控制',
    color: '#3b82f6',
    nodes: [NodeType.START, NodeType.END, NodeType.LOOP, NodeType.PHASE_MARKER],
  },
  liquid: {
    label: '液体操作',
    color: '#22c55e',
    nodes: [NodeType.INJECT, NodeType.DRAIN, NodeType.WASH, NodeType.LIQUID_SOURCE],
  },
  sweep: {
    label: '参数扫描',
    color: '#ec4899',
    nodes: [NodeType.PARAM_SWEEP],
  },
  sensor: {
    label: '数据采集',
    color: '#a855f7',
    nodes: [NodeType.ACQUIRE],
  },
  wait: {
    label: '等待',
    color: '#eab308',
    nodes: [NodeType.WAIT_TIME, NodeType.WAIT_CYCLES, NodeType.WAIT_STABILITY],
  },
  state: {
    label: '高级控制',
    color: '#f97316',
    nodes: [NodeType.SET_STATE, NodeType.SET_GAS_PUMP],
  },
  hardware: {
    label: '硬件配置',
    color: '#6b7280',
    nodes: [NodeType.HARDWARE_CONFIG],
  },
};

// 节点元数据
export const NODE_META: Record<NodeType, {
  label: string;
  description: string;
  icon: string;
  hasFlowIn: boolean;
  hasFlowOut: boolean;
  hasLiquidIn?: boolean;
  hasLiquidOut?: boolean;
  hasHardwareIn?: boolean;
  hasHardwareOut?: boolean;
  hasLoopBodyOut?: boolean;  // 循环体输出端口 (连接到循环体第一个节点)
  hasLoopBodyIn?: boolean;   // 循环体输入端口 (循环体最后一个节点连回来)
}> = {
  [NodeType.START]: {
    label: '开始',
    description: '实验程序入口',
    icon: 'Play',
    hasFlowIn: false,
    hasFlowOut: true,
    hasHardwareIn: true,
  },
  [NodeType.END]: {
    label: '结束',
    description: '实验程序结束',
    icon: 'Square',
    hasFlowIn: true,
    hasFlowOut: false,
  },
  [NodeType.LOOP]: {
    label: '循环',
    description: '重复执行步骤（连接循环体）',
    icon: 'Repeat',
    hasFlowIn: true,
    hasFlowOut: true,
    hasLoopBodyOut: true,  // 循环体输出 (连接到循环体第一个节点)
    hasLoopBodyIn: true,   // 循环体输入 (循环体最后一个节点连回来)
  },
  [NodeType.PHASE_MARKER]: {
    label: '阶段标记',
    description: '标记数据采集阶段',
    icon: 'Flag',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.INJECT]: {
    label: '进样',
    description: '注入液体到洗气瓶（自动切换进样状态）',
    icon: 'Droplets',
    hasFlowIn: true,
    hasFlowOut: true,
    hasLiquidIn: true,
  },
  [NodeType.DRAIN]: {
    label: '排废',
    description: '排空洗气瓶（自动切换排废状态）',
    icon: 'Trash2',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.LIQUID_SOURCE]: {
    label: '液体源',
    description: '选择液体和比例',
    icon: 'Beaker',
    hasFlowIn: false,
    hasFlowOut: false,
    hasLiquidOut: true,
  },
  [NodeType.WASH]: {
    label: '清洗',
    description: '用清洗液清洗系统（自动切换清洗状态）',
    icon: 'Sparkles',
    hasFlowIn: true,
    hasFlowOut: true,
    hasLiquidIn: true,
  },
  [NodeType.PARAM_SWEEP]: {
    label: '参数扫描',
    description: '扫描参数范围',
    icon: 'GitBranch',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.ACQUIRE]: {
    label: '数据采集',
    description: '采集传感器数据（自动切换采样状态）',
    icon: 'Activity',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.WAIT_TIME]: {
    label: '等待时间',
    description: '暂停执行固定时间 (sleep)',
    icon: 'Clock',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.WAIT_CYCLES]: {
    label: '等待周期',
    description: '等待指定数量的加热器周期完成（建议在数据采集节点配置）',
    icon: 'Timer',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.WAIT_STABILITY]: {
    label: '等待稳定',
    description: '等待传感器读数稳定在阈值内（建议在数据采集节点配置）',
    icon: 'TrendingDown',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.SET_STATE]: {
    label: '设置状态',
    description: '手动切换系统状态（高级：一般无需使用）',
    icon: 'Settings',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.SET_GAS_PUMP]: {
    label: '设置气泵',
    description: '手动调整气泵PWM（高级：一般无需使用）',
    icon: 'Wind',
    hasFlowIn: true,
    hasFlowOut: true,
  },
  [NodeType.HARDWARE_CONFIG]: {
    label: '硬件配置',
    description: '配置瓶子和液体',
    icon: 'Cpu',
    hasFlowIn: false,
    hasFlowOut: false,
    hasHardwareOut: true,
  },
};

// 系统状态枚举
export const SYSTEM_STATES = [
  { value: 'STATE_INITIAL', label: '初始状态' },
  { value: 'STATE_DRAIN', label: '排废状态' },
  { value: 'STATE_CLEAN', label: '清洗状态' },
  { value: 'STATE_SAMPLE', label: '采样状态' },
  { value: 'STATE_INJECT', label: '进样状态' },
];

// 实验阶段枚举（用于数据标记）
export const EXPERIMENT_PHASES = [
  { value: 'BASELINE', label: '基线 (Baseline)', description: '采集基线数据' },
  { value: 'DOSE', label: '进样 (Dose)', description: '样品注入阶段' },
  { value: 'EQUILIBRATION', label: '平衡 (Equilibration)', description: '等待气体平衡' },
  { value: 'SAMPLE', label: '采样 (Sample)', description: '传感器数据采集' },
  { value: 'PURGE', label: '吹扫 (Purge)', description: '清洗吹扫阶段' },
  { value: 'RECOVERY', label: '恢复 (Recovery)', description: '传感器恢复阶段' },
  { value: 'RINSE', label: '清洗 (Rinse)', description: '系统清洗阶段' },
];

// 节点数据类型
export interface StartNodeData {
  programId: string;
  programName: string;
  description: string;
  version: string;
}

export interface EndNodeData {}

export interface LoopNodeData {
  count: number;
}

export interface PhaseMarkerNodeData {
  phaseName: string;
  isStart: boolean;
}

export interface InjectNodeData {
  name: string;
  targetType: 'volume' | 'weight';
  targetVolumeMl?: number;
  targetWeightG?: number;
  tolerance: number;
  flowRateMlMin: number;
  stableTimeoutS: number;
}

export interface DrainNodeData {
  name: string;
  gasPumpPwm: number;
  emptyToleranceG: number;
  stabilityWindowS: number;
  timeoutS: number;
}

export interface LiquidSourceNodeData {
  liquidId: string;
  liquidName: string;
  ratio: number;
}

export interface WashNodeData {
  name: string;
  washLiquidId: string;
  washVolumeMl: number;
  repeatCount: number;
  gasPumpPwm: number;
  drainAfter: boolean;
}

// 单个扫描点的液体比例配置
export interface RatioSweepPoint {
  ratios: Record<string, number>; // liquidId -> ratio (总和=100)
}

// 参数扫描节点数据
export interface ParamSweepNodeData {
  name: string;
  paramType: 'ratio' | 'volume' | 'gasPumpPwm' | 'duration' | 'cycles';
  
  // 通用参数扫描（非比例类型）
  startValue?: number;
  endValue?: number;
  stepValue?: number;
  seqMode?: 'linear' | 'log' | 'exp' | 'quadratic' | 'sqrt';
  generatedSequence?: number[];
  
  // 比例扫描专用：多液体比例扫描点列表
  ratioSweepPoints?: RatioSweepPoint[];
  // 关联的液体源ID列表（从连接的进样节点自动获取）
  linkedLiquidIds?: string[];
}

export interface AcquireNodeData {
  name: string;
  gasPumpPwm: number;
  terminationType: 'duration' | 'cycles' | 'stability';
  durationS?: number;
  heaterCycles?: number;
  maxDurationS: number;
}

export interface WaitTimeNodeData {
  name: string;
  durationS: number;
  timeoutS: number;
}

export interface WaitCyclesNodeData {
  name: string;
  heaterCycles: number;
  timeoutS: number;
}

export interface WaitStabilityNodeData {
  name: string;
  windowS: number;
  thresholdPercent: number;
  timeoutS: number;
}

export interface SetStateNodeData {
  name: string;
  state: string;
}

export interface SetGasPumpNodeData {
  name: string;
  pwmPercent: number;
}

export interface HardwareConfigNodeData {
  bottleCapacityMl: number;
  maxFillMl: number;
}

// 联合类型
export type ExperimentNodeData =
  | StartNodeData
  | EndNodeData
  | LoopNodeData
  | PhaseMarkerNodeData
  | InjectNodeData
  | DrainNodeData
  | WashNodeData
  | LiquidSourceNodeData
  | AcquireNodeData
  | WaitTimeNodeData
  | WaitCyclesNodeData
  | WaitStabilityNodeData
  | SetStateNodeData
  | SetGasPumpNodeData
  | HardwareConfigNodeData
  | ParamSweepNodeData;

// 扩展 React Flow 节点类型
export type ExperimentNode = Node<Record<string, unknown>, NodeType>;
export type ExperimentEdge = Edge;

// 连接句柄类型
export const HANDLE_TYPES = {
  FLOW: 'flow',
  LIQUID: 'liquid',
  HARDWARE: 'hardware',
  LOOP_BODY: 'loopBody',  // 循环体连接
} as const;

// 连接规则定义
export interface ConnectionRule {
  // 该节点类型可以作为源连接到哪些目标节点类型
  flowTargets?: NodeType[];
  // 该节点类型可以作为液体源连接到哪些目标节点类型
  liquidTargets?: NodeType[];
  // 该节点类型可以接收来自哪些源节点类型的流程连接
  flowSources?: NodeType[];
  // 该节点类型可以接收来自哪些源节点类型的液体连接
  liquidSources?: NodeType[];
  // 该节点类型可以连接到哪些目标节点类型的硬件连接
  hardwareTargets?: NodeType[];
  // 循环体可以连接到哪些目标节点类型 (Loop 节点专用)
  loopBodyTargets?: NodeType[];
  // 可以作为循环体源连接回 Loop 节点的节点类型
  loopBodySources?: NodeType[];
  // 最大流程输入连接数
  maxFlowIn?: number;
  // 最大流程输出连接数
  maxFlowOut?: number;
  // 最大液体输入连接数
  maxLiquidIn?: number;
  // 最大液体输出连接数
  maxLiquidOut?: number;
  // 最大硬件输出连接数
  maxHardwareOut?: number;
  // 最大循环体输出连接数
  maxLoopBodyOut?: number;
  // 最大循环体输入连接数
  maxLoopBodyIn?: number;
}

// 流程节点（可参与流程连接的节点）
const FLOW_NODES = [
  NodeType.START, NodeType.END, NodeType.LOOP, NodeType.PHASE_MARKER,
  NodeType.INJECT, NodeType.DRAIN, NodeType.WASH, NodeType.ACQUIRE,
  NodeType.WAIT_TIME, NodeType.WAIT_CYCLES, NodeType.WAIT_STABILITY,
  NodeType.SET_STATE, NodeType.SET_GAS_PUMP, NodeType.PARAM_SWEEP,
];

// 可接收液体输入的节点
const LIQUID_ACCEPTING_NODES = [NodeType.INJECT, NodeType.WASH];

// 节点连接规则
export const CONNECTION_RULES: Record<NodeType, ConnectionRule> = {
  [NodeType.START]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    maxFlowIn: 0,
    maxFlowOut: 1,
  },
  [NodeType.END]: {
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 10, // 允许多个分支汇入
    maxFlowOut: 0,
  },
  [NodeType.LOOP]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    // 循环体可以连接到除 START/END/LOOP 外的所有流程节点
    loopBodyTargets: FLOW_NODES.filter(n => n !== NodeType.START && n !== NodeType.END && n !== NodeType.LOOP),
    loopBodySources: FLOW_NODES.filter(n => n !== NodeType.START && n !== NodeType.END && n !== NodeType.LOOP),
    maxFlowIn: 1,
    maxFlowOut: 1,
    maxLoopBodyOut: 1,  // 只能有一个循环体起点
    maxLoopBodyIn: 1,   // 只能有一个循环体终点
  },
  [NodeType.PHASE_MARKER]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.INJECT]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    liquidSources: [NodeType.LIQUID_SOURCE],
    maxFlowIn: 1,
    maxFlowOut: 1,
    maxLiquidIn: 8, // 最多8个液体源
  },
  [NodeType.DRAIN]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.WASH]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    liquidSources: [NodeType.LIQUID_SOURCE],
    maxFlowIn: 1,
    maxFlowOut: 1,
    maxLiquidIn: 1, // 清洗只用一种液体
  },
  [NodeType.LIQUID_SOURCE]: {
    liquidTargets: LIQUID_ACCEPTING_NODES,
    maxFlowIn: 0,
    maxFlowOut: 0,
    maxLiquidOut: 1, // 一个液体源只能连接一个目标
  },
  [NodeType.PARAM_SWEEP]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.ACQUIRE]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.WAIT_TIME]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.WAIT_CYCLES]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.WAIT_STABILITY]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.SET_STATE]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.SET_GAS_PUMP]: {
    flowTargets: FLOW_NODES.filter(n => n !== NodeType.START),
    flowSources: FLOW_NODES.filter(n => n !== NodeType.END),
    maxFlowIn: 1,
    maxFlowOut: 1,
  },
  [NodeType.HARDWARE_CONFIG]: {
    maxFlowIn: 0,
    maxFlowOut: 0,
    hardwareTargets: [NodeType.START], // 硬件配置只能连接到开始节点
    maxHardwareOut: 1,
  },
};

// 验证连接是否允许
export function isConnectionValid(
  sourceType: NodeType,
  targetType: NodeType,
  handleType: string,
  existingEdges: ExperimentEdge[],
  sourceId: string,
  targetId: string,
  sourceHandle: string,
  targetHandle: string
): { valid: boolean; reason?: string } {
  const sourceRule = CONNECTION_RULES[sourceType];
  const targetRule = CONNECTION_RULES[targetType];
  
  if (!sourceRule || !targetRule) {
    return { valid: false, reason: '未知节点类型' };
  }
  
  if (handleType === HANDLE_TYPES.FLOW) {
    // 检查源节点是否允许流程输出
    if (sourceRule.maxFlowOut === 0) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 不能作为流程源` };
    }
    
    // 检查目标节点是否允许流程输入
    if (targetRule.maxFlowIn === 0) {
      return { valid: false, reason: `${NODE_META[targetType].label} 不能接收流程输入` };
    }
    
    // 检查源节点是否允许连接到该目标类型
    if (sourceRule.flowTargets && !sourceRule.flowTargets.includes(targetType)) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 不能连接到 ${NODE_META[targetType].label}` };
    }
    
    // 检查目标节点是否允许从该源类型连接
    if (targetRule.flowSources && !targetRule.flowSources.includes(sourceType)) {
      return { valid: false, reason: `${NODE_META[targetType].label} 不能从 ${NODE_META[sourceType].label} 接收连接` };
    }
    
    // 检查现有连接数
    const sourceFlowOutCount = existingEdges.filter(
      e => e.source === sourceId && e.sourceHandle === HANDLE_TYPES.FLOW
    ).length;
    if (sourceRule.maxFlowOut && sourceFlowOutCount >= sourceRule.maxFlowOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 已达最大流程输出数 (${sourceRule.maxFlowOut})` };
    }
    
    const targetFlowInCount = existingEdges.filter(
      e => e.target === targetId && e.targetHandle === HANDLE_TYPES.FLOW
    ).length;
    if (targetRule.maxFlowIn && targetFlowInCount >= targetRule.maxFlowIn) {
      return { valid: false, reason: `${NODE_META[targetType].label} 已达最大流程输入数 (${targetRule.maxFlowIn})` };
    }
  } else if (handleType === HANDLE_TYPES.LIQUID) {
    // 检查源节点是否有液体输出
    if (!NODE_META[sourceType].hasLiquidOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 没有液体输出` };
    }
    
    // 检查目标节点是否有液体输入
    if (!NODE_META[targetType].hasLiquidIn) {
      return { valid: false, reason: `${NODE_META[targetType].label} 不接受液体输入` };
    }
    
    // 检查源节点是否允许连接到该目标类型
    if (sourceRule.liquidTargets && !sourceRule.liquidTargets.includes(targetType)) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 的液体不能连接到 ${NODE_META[targetType].label}` };
    }
    
    // 检查现有液体连接数
    const sourceLiquidOutCount = existingEdges.filter(
      e => e.source === sourceId && e.sourceHandle === HANDLE_TYPES.LIQUID
    ).length;
    if (sourceRule.maxLiquidOut && sourceLiquidOutCount >= sourceRule.maxLiquidOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 已达最大液体输出数 (${sourceRule.maxLiquidOut})` };
    }
    
    const targetLiquidInCount = existingEdges.filter(
      e => e.target === targetId && e.targetHandle === HANDLE_TYPES.LIQUID
    ).length;
    if (targetRule.maxLiquidIn && targetLiquidInCount >= targetRule.maxLiquidIn) {
      return { valid: false, reason: `${NODE_META[targetType].label} 已达最大液体输入数 (${targetRule.maxLiquidIn})` };
    }
  } else if (handleType === HANDLE_TYPES.HARDWARE) {
    // 硬件连接验证
    if (!NODE_META[sourceType].hasHardwareOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 没有硬件输出` };
    }
    
    if (!NODE_META[targetType].hasHardwareIn) {
      return { valid: false, reason: `${NODE_META[targetType].label} 不接受硬件输入` };
    }
    
    // 检查源节点是否允许连接到该目标类型
    if (sourceRule.hardwareTargets && !sourceRule.hardwareTargets.includes(targetType)) {
      return { valid: false, reason: `硬件配置只能连接到开始节点` };
    }
    
    // 检查现有硬件连接数
    const sourceHardwareOutCount = existingEdges.filter(
      e => e.source === sourceId && e.sourceHandle === HANDLE_TYPES.HARDWARE
    ).length;
    if (sourceRule.maxHardwareOut && sourceHardwareOutCount >= sourceRule.maxHardwareOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 已达最大硬件输出数` };
    }
  } else if (handleType === HANDLE_TYPES.LOOP_BODY) {
    // 循环体连接验证
    // 源必须是 LOOP 节点 (loopBody 输出)
    if (!NODE_META[sourceType].hasLoopBodyOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 没有循环体输出` };
    }
    
    // 目标必须能作为循环体的一部分
    if (sourceRule.loopBodyTargets && !sourceRule.loopBodyTargets.includes(targetType)) {
      return { valid: false, reason: `${NODE_META[targetType].label} 不能作为循环体节点` };
    }
    
    // 检查现有循环体连接数
    const sourceLoopBodyOutCount = existingEdges.filter(
      e => e.source === sourceId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
    ).length;
    if (sourceRule.maxLoopBodyOut && sourceLoopBodyOutCount >= sourceRule.maxLoopBodyOut) {
      return { valid: false, reason: `${NODE_META[sourceType].label} 已连接循环体` };
    }
    
    const targetLoopBodyInCount = existingEdges.filter(
      e => e.target === targetId && e.targetHandle === HANDLE_TYPES.LOOP_BODY
    ).length;
    if (targetRule.maxLoopBodyIn && targetLoopBodyInCount >= targetRule.maxLoopBodyIn) {
      return { valid: false, reason: `${NODE_META[targetType].label} 已被其他循环体连接` };
    }
  }
  
  return { valid: true };
}

// 获取句柄的提示信息
export function getHandleTooltip(
  nodeType: NodeType,
  handleType: 'flow' | 'liquid' | 'hardware',
  direction: 'in' | 'out'
): string {
  const meta = NODE_META[nodeType];
  const rule = CONNECTION_RULES[nodeType];
  
  if (handleType === 'flow') {
    if (direction === 'out') {
      const targets = rule?.flowTargets?.map(t => NODE_META[t].label).join('、') || '无';
      const max = rule?.maxFlowOut ?? 1;
      return `流程输出\n可连接: ${targets}\n最大连接数: ${max}`;
    } else {
      const sources = rule?.flowSources?.map(t => NODE_META[t].label).join('、') || '无';
      const max = rule?.maxFlowIn ?? 1;
      return `流程输入\n可接收: ${sources}\n最大连接数: ${max}`;
    }
  } else if (handleType === 'liquid') {
    if (direction === 'out') {
      const targets = rule?.liquidTargets?.map(t => NODE_META[t].label).join('、') || '无';
      const max = rule?.maxLiquidOut ?? 1;
      return `液体输出\n可连接: ${targets}\n最大连接数: ${max}`;
    } else {
      const sources = rule?.liquidSources?.map(t => NODE_META[t].label).join('、') || '无';
      const max = rule?.maxLiquidIn ?? 1;
      return `液体输入\n可接收: ${sources}\n最大连接数: ${max}`;
    }
  } else if (handleType === 'hardware') {
    if (direction === 'out') {
      return `硬件配置输出\n连接到: 开始节点`;
    } else {
      return `硬件配置输入\n接收: 硬件配置节点`;
    }
  }
  
  return '';
}

// DAG 静态检查结果
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// DAG 静态检查：验证程序可执行性
export function validateDAG(
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. 检查是否有开始节点
  const startNodes = nodes.filter(n => n.type === NodeType.START);
  if (startNodes.length === 0) {
    errors.push('缺少开始节点');
  } else if (startNodes.length > 1) {
    errors.push('存在多个开始节点');
  }
  
  // 2. 检查是否有结束节点
  const endNodes = nodes.filter(n => n.type === NodeType.END);
  if (endNodes.length === 0) {
    errors.push('缺少结束节点');
  }
  
  // 3. 检查开始节点是否有流程输出
  if (startNodes.length === 1) {
    const startId = startNodes[0].id;
    const hasFlowOut = edges.some(
      e => e.source === startId && e.sourceHandle === HANDLE_TYPES.FLOW
    );
    if (!hasFlowOut) {
      errors.push('开始节点没有连接到任何流程');
    }
  }
  
  // 4. 检查结束节点是否有流程输入
  for (const endNode of endNodes) {
    const hasFlowIn = edges.some(
      e => e.target === endNode.id && e.targetHandle === HANDLE_TYPES.FLOW
    );
    if (!hasFlowIn) {
      warnings.push(`结束节点 [${endNode.id}] 没有任何流程输入`);
    }
  }
  
  // 5. 检查进样节点的液体连接和比例
  const injectNodes = nodes.filter(n => n.type === NodeType.INJECT);
  for (const inject of injectNodes) {
    const liquidEdges = edges.filter(
      e => e.target === inject.id && e.targetHandle === HANDLE_TYPES.LIQUID
    );
    
    if (liquidEdges.length === 0) {
      errors.push(`进样节点 [${(inject.data as Record<string, unknown>).name || inject.id}] 未连接液体源`);
    } else {
      // 计算比例总和
      let totalRatio = 0;
      for (const edge of liquidEdges) {
        const sourceNode = nodes.find(n => n.id === edge.source);
        if (sourceNode?.type === NodeType.LIQUID_SOURCE) {
          const ratio = Number((sourceNode.data as Record<string, unknown>).ratio ?? 1);
          totalRatio += ratio * 100;
        }
      }
      
      if (Math.abs(totalRatio - 100) > 0.1) {
        errors.push(`进样节点 [${(inject.data as Record<string, unknown>).name || inject.id}] 液体比例总和为 ${totalRatio.toFixed(0)}%，应为 100%`);
      }
    }
  }
  
  // 6. 检查流程节点的孤立状态
  const flowNodeTypes = [
    NodeType.LOOP, NodeType.PHASE_MARKER, NodeType.INJECT, NodeType.DRAIN,
    NodeType.WASH, NodeType.ACQUIRE, NodeType.WAIT_TIME, NodeType.WAIT_CYCLES,
    NodeType.WAIT_STABILITY, NodeType.SET_STATE, NodeType.SET_GAS_PUMP, NodeType.PARAM_SWEEP
  ];
  
  for (const node of nodes) {
    if (!flowNodeTypes.includes(node.type as NodeType)) continue;
    
    const hasFlowIn = edges.some(
      e => e.target === node.id && e.targetHandle === HANDLE_TYPES.FLOW
    );
    const hasFlowOut = edges.some(
      e => e.source === node.id && e.sourceHandle === HANDLE_TYPES.FLOW
    );
    
    const nodeName = (node.data as Record<string, unknown>).name as string || NODE_META[node.type as NodeType]?.label || node.id;
    
    if (!hasFlowIn && !hasFlowOut) {
      warnings.push(`节点 [${nodeName}] 未连接到流程中（孤立节点）`);
    } else if (!hasFlowIn) {
      warnings.push(`节点 [${nodeName}] 没有流程输入`);
    } else if (!hasFlowOut) {
      warnings.push(`节点 [${nodeName}] 没有流程输出（死路）`);
    }
  }
  
  // 7. 检查从开始到结束的可达性（简化版：BFS）
  if (startNodes.length === 1 && endNodes.length > 0) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      
      // 沿流程边查找后继节点
      const successors = edges
        .filter(e => e.source === current && e.sourceHandle === HANDLE_TYPES.FLOW)
        .map(e => e.target);
      
      queue.push(...successors);
    }
    
    // 检查是否能到达任意结束节点
    const canReachEnd = endNodes.some(end => reachable.has(end.id));
    if (!canReachEnd) {
      errors.push('从开始节点无法到达任何结束节点');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
