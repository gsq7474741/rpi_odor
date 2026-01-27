import { create } from 'zustand';
import {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
} from '@xyflow/react';
import { NodeType, ExperimentNode, ExperimentEdge, isConnectionValid, HANDLE_TYPES } from './types';

interface HistoryState {
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
}

interface EditorState {
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
  selectedNodeId: string | null;
  
  // 撤销/重做历史
  history: HistoryState[];
  historyIndex: number;
  lastHistorySaveTime: number; // 上次保存历史的时间戳
  
  // 程序元数据
  programId: string;
  programName: string;
  programDescription: string;
  programVersion: string;
  
  // 硬件配置
  bottleCapacityMl: number;
  maxFillMl: number;
  
  // Actions
  onNodesChange: OnNodesChange<ExperimentNode>;
  onEdgesChange: OnEdgesChange<ExperimentEdge>;
  onConnect: OnConnect;
  
  setSelectedNodeId: (id: string | null) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<Record<string, unknown>>) => void;
  deleteNode: (nodeId: string) => void;
  
  setProgramMeta: (meta: {
    programId?: string;
    programName?: string;
    programDescription?: string;
    programVersion?: string;
  }) => void;
  
  setHardwareConfig: (config: {
    bottleCapacityMl?: number;
    maxFillMl?: number;
  }) => void;
  
  // 导入/导出
  loadGraph: (nodes: ExperimentNode[], edges: ExperimentEdge[]) => void;
  clearGraph: () => void;
  
  // 撤销/重做
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  saveToHistory: () => void;
  
  // 获取默认节点数据
  getDefaultNodeData: (type: NodeType) => Record<string, unknown>;
}

let nodeIdCounter = 0;
const generateNodeId = () => `node_${++nodeIdCounter}`;

const getDefaultNodeData = (type: NodeType): Record<string, unknown> => {
  switch (type) {
    case NodeType.START:
      return {
        programId: 'new_experiment',
        programName: '新实验',
        description: '',
        version: '1.0.0',
      };
    case NodeType.END:
      return {};
    case NodeType.LOOP:
      return { count: 3 };
    case NodeType.PHASE_MARKER:
      return { phaseName: 'SAMPLE', isStart: true };
    case NodeType.INJECT:
      return {
        name: '进样',
        targetType: 'volume',
        targetVolumeMl: 15,
        tolerance: 0.5,
        flowRateMlMin: 5,
        stableTimeoutS: 60,
      };
    case NodeType.DRAIN:
      return {
        name: '排废',
        gasPumpPwm: 80,
        emptyToleranceG: 10,
        stabilityWindowS: 2,
        timeoutS: 60,
      };
    case NodeType.LIQUID_SOURCE:
      return {
        liquidId: '',
        liquidName: '未选择',
        ratio: 1.0,
      };
    case NodeType.WASH:
      return {
        name: '清洗',
        washLiquidId: 'distilled_water',
        washVolumeMl: 20,
        repeatCount: 2,
        gasPumpPwm: 50,
        drainAfter: true,
      };
    case NodeType.PARAM_SWEEP:
      return {
        name: '参数扫描',
        paramType: 'volume',
        startValue: 10,
        endValue: 30,
        stepValue: 5,
        seqMode: 'linear',
        ratioSweepPoints: [], // 比例扫描点列表
        linkedLiquidIds: [],  // 关联的液体源
      };
    case NodeType.ACQUIRE:
      return {
        name: '数据采集',
        gasPumpPwm: 50,
        terminationType: 'cycles',
        heaterCycles: 10,
        maxDurationS: 300,
      };
    case NodeType.WAIT_TIME:
      return {
        name: '等待',
        durationS: 60,
        timeoutS: 120,
      };
    case NodeType.WAIT_CYCLES:
      return {
        name: '等待周期',
        heaterCycles: 5,
        timeoutS: 300,
      };
    case NodeType.WAIT_STABILITY:
      return {
        name: '等待稳定',
        windowS: 30,
        thresholdPercent: 5,
        timeoutS: 300,
      };
    case NodeType.SET_STATE:
      return {
        name: '设置状态',
        state: 'STATE_SAMPLE',
      };
    case NodeType.SET_GAS_PUMP:
      return {
        name: '设置气泵',
        pwmPercent: 50,
      };
    case NodeType.HARDWARE_CONFIG:
      return {
        bottleCapacityMl: 150,
        maxFillMl: 100,
      };
    default:
      return {};
  }
};

// 初始节点
const initialNodes: ExperimentNode[] = [
  {
    id: 'start',
    type: NodeType.START,
    position: { x: 250, y: 50 },
    data: getDefaultNodeData(NodeType.START),
  },
  {
    id: 'end',
    type: NodeType.END,
    position: { x: 250, y: 400 },
    data: getDefaultNodeData(NodeType.END),
  },
];

const initialEdges: ExperimentEdge[] = [];

const MAX_HISTORY = 50;

export const useEditorStore = create<EditorState>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId: null,
  
  history: [{ nodes: initialNodes, edges: initialEdges }],
  historyIndex: 0,
  lastHistorySaveTime: 0,
  
  programId: 'new_experiment',
  programName: '新实验',
  programDescription: '',
  programVersion: '1.0.0',
  
  bottleCapacityMl: 150,
  maxFillMl: 100,
  
  saveToHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    }
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },
  
  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = history[newIndex];
      set({
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        edges: JSON.parse(JSON.stringify(state.edges)),
        historyIndex: newIndex,
      });
    }
  },
  
  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const state = history[newIndex];
      set({
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        edges: JSON.parse(JSON.stringify(state.edges)),
        historyIndex: newIndex,
      });
    }
  },
  
  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,
  
  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  
  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },
  
  onConnect: (connection: Connection) => {
    const { nodes, edges } = get();
    
    // 查找源节点和目标节点
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    
    if (!sourceNode || !targetNode) return;
    
    const sourceType = sourceNode.type as NodeType;
    const targetType = targetNode.type as NodeType;
    const handleType = connection.sourceHandle || HANDLE_TYPES.FLOW;
    
    // 验证连接是否允许
    const validation = isConnectionValid(
      sourceType,
      targetType,
      handleType,
      edges,
      connection.source!,
      connection.target!,
      connection.sourceHandle || '',
      connection.targetHandle || ''
    );
    
    if (!validation.valid) {
      console.warn('连接被拒绝:', validation.reason);
      // 可以在这里显示 toast 提示
      return;
    }
    
    get().saveToHistory();
    set({
      edges: addEdge(
        {
          ...connection,
          type: 'smoothstep',
          animated: connection.sourceHandle === 'liquid',
          style: connection.sourceHandle === 'liquid' 
            ? { stroke: '#22c55e', strokeDasharray: '5,5' }
            : { stroke: '#64748b' },
        },
        edges
      ),
    });
  },
  
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  
  addNode: (type, position) => {
    get().saveToHistory();
    const newNode: ExperimentNode = {
      id: generateNodeId(),
      type,
      position,
      data: getDefaultNodeData(type),
    };
    set({ nodes: [...get().nodes, newNode] });
  },
  
  updateNodeData: (nodeId, data) => {
    // 使用防抖：500ms 内的连续编辑只保存一次历史
    const now = Date.now();
    const lastSave = get().lastHistorySaveTime;
    if (now - lastSave > 500) {
      get().saveToHistory();
      set({ lastHistorySaveTime: now });
    }
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      ),
    });
  },
  
  deleteNode: (nodeId) => {
    get().saveToHistory();
    set({
      nodes: get().nodes.filter((node) => node.id !== nodeId),
      edges: get().edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },
  
  setProgramMeta: (meta) => {
    set({
      programId: meta.programId ?? get().programId,
      programName: meta.programName ?? get().programName,
      programDescription: meta.programDescription ?? get().programDescription,
      programVersion: meta.programVersion ?? get().programVersion,
    });
  },
  
  setHardwareConfig: (config) => {
    set({
      bottleCapacityMl: config.bottleCapacityMl ?? get().bottleCapacityMl,
      maxFillMl: config.maxFillMl ?? get().maxFillMl,
    });
  },
  
  loadGraph: (nodes, edges) => {
    get().saveToHistory();
    nodeIdCounter = Math.max(
      ...nodes.map((n) => {
        const match = n.id.match(/node_(\d+)/);
        return match ? parseInt(match[1]) : 0;
      }),
      nodeIdCounter
    );
    set({ nodes, edges });
  },
  
  clearGraph: () => {
    get().saveToHistory();
    nodeIdCounter = 0;
    set({
      nodes: initialNodes,
      edges: initialEdges,
      selectedNodeId: null,
    });
  },
  
  getDefaultNodeData,
}));
