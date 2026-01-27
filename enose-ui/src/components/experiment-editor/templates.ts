import { ExperimentNode, ExperimentEdge, NodeType, HANDLE_TYPES } from './types';

export interface Template {
  id: string;
  name: string;
  description: string;
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
  programMeta: {
    programId: string;
    programName: string;
    programDescription: string;
    programVersion: string;
    bottleCapacityMl: number;
    maxFillMl: number;
  };
}

export const templates: Template[] = [
  {
    id: 'simple_sample',
    name: '简单采样',
    description: '基础的样品采集流程：进样 → 采集 → 排废',
    programMeta: {
      programId: 'simple_sample',
      programName: '简单采样',
      programDescription: '基础的样品采集流程',
      programVersion: '1.0.0',
      bottleCapacityMl: 150,
      maxFillMl: 100,
    },
    nodes: [
      {
        id: 'start',
        type: NodeType.START,
        position: { x: 250, y: 50 },
        data: { programId: 'simple_sample', programName: '简单采样', description: '', version: '1.0.0' },
      },
      {
        id: 'liquid_1',
        type: NodeType.LIQUID_SOURCE,
        position: { x: 50, y: 200 },
        data: { liquidId: 'sample', liquidName: '样品', ratio: 1 },
      },
      {
        id: 'inject_1',
        type: NodeType.INJECT,
        position: { x: 250, y: 150 },
        data: { name: '进样', targetType: 'volume', targetVolumeMl: 15, tolerance: 0.5, flowRateMlMin: 5 },
      },
      {
        id: 'wait_1',
        type: NodeType.WAIT_TIME,
        position: { x: 250, y: 250 },
        data: { name: '平衡等待', durationS: 60, timeoutS: 120 },
      },
      {
        id: 'acquire_1',
        type: NodeType.ACQUIRE,
        position: { x: 250, y: 350 },
        data: { name: '数据采集', gasPumpPwm: 50, terminationType: 'cycles', heaterCycles: 10, maxDurationS: 300 },
      },
      {
        id: 'drain_1',
        type: NodeType.DRAIN,
        position: { x: 250, y: 450 },
        data: { name: '排废', gasPumpPwm: 80, timeoutS: 60 },
      },
      {
        id: 'end',
        type: NodeType.END,
        position: { x: 250, y: 550 },
        data: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'inject_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e2', source: 'liquid_1', target: 'inject_1', sourceHandle: HANDLE_TYPES.LIQUID, targetHandle: HANDLE_TYPES.LIQUID, type: 'smoothstep', animated: true, style: { stroke: '#22c55e', strokeDasharray: '5,5' } },
      { id: 'e3', source: 'inject_1', target: 'wait_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e4', source: 'wait_1', target: 'acquire_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e5', source: 'acquire_1', target: 'drain_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e6', source: 'drain_1', target: 'end', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
    ],
  },
  {
    id: 'standard_detection',
    name: '标准检测流程',
    description: '带阶段标记的完整检测流程',
    programMeta: {
      programId: 'standard_detection',
      programName: '标准检测流程',
      programDescription: '带阶段标记的完整检测流程',
      programVersion: '1.0.0',
      bottleCapacityMl: 150,
      maxFillMl: 100,
    },
    nodes: [
      {
        id: 'start',
        type: NodeType.START,
        position: { x: 250, y: 50 },
        data: { programId: 'standard_detection', programName: '标准检测流程', description: '', version: '1.0.0' },
      },
      {
        id: 'liquid_1',
        type: NodeType.LIQUID_SOURCE,
        position: { x: 50, y: 200 },
        data: { liquidId: 'sample', liquidName: '样品', ratio: 1 },
      },
      {
        id: 'phase_dose_start',
        type: NodeType.PHASE_MARKER,
        position: { x: 250, y: 150 },
        data: { name: '标记进样开始', phaseName: 'DOSE', isStart: true },
      },
      {
        id: 'inject_1',
        type: NodeType.INJECT,
        position: { x: 250, y: 230 },
        data: { name: '进样', targetType: 'volume', targetVolumeMl: 15, tolerance: 0.5, flowRateMlMin: 5 },
      },
      {
        id: 'phase_dose_end',
        type: NodeType.PHASE_MARKER,
        position: { x: 250, y: 310 },
        data: { name: '标记进样结束', phaseName: 'DOSE', isStart: false },
      },
      {
        id: 'set_state_1',
        type: NodeType.SET_STATE,
        position: { x: 250, y: 390 },
        data: { name: '切换到采样状态', state: 'STATE_SAMPLE' },
      },
      {
        id: 'gas_pump_1',
        type: NodeType.SET_GAS_PUMP,
        position: { x: 250, y: 470 },
        data: { name: '设置气泵低速', pwmPercent: 30 },
      },
      {
        id: 'wait_1',
        type: NodeType.WAIT_TIME,
        position: { x: 250, y: 550 },
        data: { name: '平衡等待', durationS: 60, timeoutS: 120 },
      },
      {
        id: 'acquire_1',
        type: NodeType.ACQUIRE,
        position: { x: 250, y: 630 },
        data: { name: '数据采集', gasPumpPwm: 50, terminationType: 'cycles', heaterCycles: 10, maxDurationS: 300 },
      },
      {
        id: 'drain_1',
        type: NodeType.DRAIN,
        position: { x: 250, y: 710 },
        data: { name: '排废', gasPumpPwm: 80, timeoutS: 60 },
      },
      {
        id: 'set_state_2',
        type: NodeType.SET_STATE,
        position: { x: 250, y: 790 },
        data: { name: '恢复初始状态', state: 'STATE_INITIAL' },
      },
      {
        id: 'end',
        type: NodeType.END,
        position: { x: 250, y: 870 },
        data: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'phase_dose_start', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e2', source: 'phase_dose_start', target: 'inject_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e_liq', source: 'liquid_1', target: 'inject_1', sourceHandle: HANDLE_TYPES.LIQUID, targetHandle: HANDLE_TYPES.LIQUID, type: 'smoothstep', animated: true, style: { stroke: '#22c55e', strokeDasharray: '5,5' } },
      { id: 'e3', source: 'inject_1', target: 'phase_dose_end', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e4', source: 'phase_dose_end', target: 'set_state_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e5', source: 'set_state_1', target: 'gas_pump_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e6', source: 'gas_pump_1', target: 'wait_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e7', source: 'wait_1', target: 'acquire_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e8', source: 'acquire_1', target: 'drain_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e9', source: 'drain_1', target: 'set_state_2', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e10', source: 'set_state_2', target: 'end', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
    ],
  },
  {
    id: 'with_wash',
    name: '带清洗流程',
    description: '带清洗步骤的完整流程',
    programMeta: {
      programId: 'with_wash',
      programName: '带清洗流程',
      programDescription: '包含清洗步骤的实验流程',
      programVersion: '1.0.0',
      bottleCapacityMl: 150,
      maxFillMl: 100,
    },
    nodes: [
      {
        id: 'start',
        type: NodeType.START,
        position: { x: 250, y: 50 },
        data: { programId: 'with_wash', programName: '带清洗流程', description: '', version: '1.0.0' },
      },
      {
        id: 'liquid_sample',
        type: NodeType.LIQUID_SOURCE,
        position: { x: 50, y: 200 },
        data: { liquidId: 'sample', liquidName: '样品', ratio: 1 },
      },
      {
        id: 'liquid_wash',
        type: NodeType.LIQUID_SOURCE,
        position: { x: 50, y: 500 },
        data: { liquidId: 'distilled_water', liquidName: '蒸馏水', ratio: 1 },
      },
      {
        id: 'inject_1',
        type: NodeType.INJECT,
        position: { x: 250, y: 150 },
        data: { name: '进样', targetType: 'volume', targetVolumeMl: 15, tolerance: 0.5, flowRateMlMin: 5 },
      },
      {
        id: 'wait_1',
        type: NodeType.WAIT_TIME,
        position: { x: 250, y: 250 },
        data: { name: '平衡等待', durationS: 60, timeoutS: 120 },
      },
      {
        id: 'acquire_1',
        type: NodeType.ACQUIRE,
        position: { x: 250, y: 350 },
        data: { name: '数据采集', gasPumpPwm: 50, terminationType: 'cycles', heaterCycles: 10, maxDurationS: 300 },
      },
      {
        id: 'drain_1',
        type: NodeType.DRAIN,
        position: { x: 250, y: 450 },
        data: { name: '排废', gasPumpPwm: 80, timeoutS: 60 },
      },
      {
        id: 'wash_1',
        type: NodeType.WASH,
        position: { x: 250, y: 550 },
        data: { name: '清洗', washLiquidId: 'distilled_water', washVolumeMl: 20, repeatCount: 2, gasPumpPwm: 50, drainAfter: true },
      },
      {
        id: 'end',
        type: NodeType.END,
        position: { x: 250, y: 650 },
        data: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'inject_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e_liq1', source: 'liquid_sample', target: 'inject_1', sourceHandle: HANDLE_TYPES.LIQUID, targetHandle: HANDLE_TYPES.LIQUID, type: 'smoothstep', animated: true, style: { stroke: '#22c55e', strokeDasharray: '5,5' } },
      { id: 'e2', source: 'inject_1', target: 'wait_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e3', source: 'wait_1', target: 'acquire_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e4', source: 'acquire_1', target: 'drain_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e5', source: 'drain_1', target: 'wash_1', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
      { id: 'e_liq2', source: 'liquid_wash', target: 'wash_1', sourceHandle: HANDLE_TYPES.LIQUID, targetHandle: HANDLE_TYPES.LIQUID, type: 'smoothstep', animated: true, style: { stroke: '#22c55e', strokeDasharray: '5,5' } },
      { id: 'e6', source: 'wash_1', target: 'end', sourceHandle: HANDLE_TYPES.FLOW, targetHandle: HANDLE_TYPES.FLOW, type: 'smoothstep' },
    ],
  },
  {
    id: 'empty',
    name: '空白模板',
    description: '从头开始创建实验',
    programMeta: {
      programId: 'new_experiment',
      programName: '新实验',
      programDescription: '',
      programVersion: '1.0.0',
      bottleCapacityMl: 150,
      maxFillMl: 100,
    },
    nodes: [
      {
        id: 'start',
        type: NodeType.START,
        position: { x: 250, y: 50 },
        data: { programId: 'new_experiment', programName: '新实验', description: '', version: '1.0.0' },
      },
      {
        id: 'end',
        type: NodeType.END,
        position: { x: 250, y: 400 },
        data: {},
      },
    ],
    edges: [],
  },
];
