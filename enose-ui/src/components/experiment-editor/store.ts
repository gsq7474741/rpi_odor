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
import { compile, CompilationResult } from './compiler';
import { fetchCompilerData } from './data-fetcher';

interface HistoryState {
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
  programMeta?: {
    programId: string;
    programName: string;
    programDescription: string;
    programVersion: string;
  };
}

export interface TabSnapshot {
  id: string;
  filename: string | null;
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
  programId: string;
  programName: string;
  programDescription: string;
  programVersion: string;
  bottleCapacityMl: number;
  maxFillMl: number;
  isDirty: boolean;
  history: HistoryState[];
  historyIndex: number;
  savedHistoryIndex: number;
  compilationResult: CompilationResult | null;
}

let tabIdCounter = 0;
const generateTabId = () => `tab_${++tabIdCounter}`;

interface EditorState {
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
  selectedNodeId: string | null;
  
  // 撤销/重做历史
  history: HistoryState[];
  historyIndex: number;
  savedHistoryIndex: number; // 上次保存时的 historyIndex
  isRecordingHistory: boolean; // 防止重复记录历史的标志
  
  // 程序元数据
  programId: string;
  programName: string;
  programDescription: string;
  programVersion: string;
  
  // 硬件配置
  bottleCapacityMl: number;
  maxFillMl: number;
  
  // 实时编译结果
  compilationResult: CompilationResult | null;
  isCompiling: boolean;
  autoCompile: boolean; // 是否自动编译
  
  // 未保存更改跟踪
  isDirty: boolean;
  
  // 当前文件名
  currentFilename: string | null;
  
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
  resetHistory: () => void;
  markSaved: () => void;
  
  // 实时编译
  recompile: () => void;
  setAutoCompile: (enabled: boolean) => void;
  
  // 未保存更改
  setDirty: (dirty: boolean) => void;
  setCurrentFilename: (filename: string | null) => void;
  
  // 多标签页
  tabs: TabSnapshot[];
  activeTabId: string;
  createTab: (filename?: string | null) => string; // returns tab id
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => boolean; // returns false if it's the last tab
  updateActiveTabSnapshot: () => void;
  getTabById: (tabId: string) => TabSnapshot | undefined;
  
  // 获取默认节点数据
  getDefaultNodeData: (type: NodeType) => Record<string, unknown>;
}

let nodeIdCounter = 0;
const generateNodeId = () => `node_${++nodeIdCounter}`;

// 同步 nodeIdCounter 到当前节点的最大 ID
function syncNodeIdCounter(nodes: ExperimentNode[]) {
  let maxId = 0;
  for (const n of nodes) {
    const match = n.id.match(/node_(\d+)/);
    if (match) maxId = Math.max(maxId, parseInt(match[1]));
  }
  nodeIdCounter = Math.max(nodeIdCounter, maxId);
}

// updateNodeData 防抖相关
let updateNodeDataTimer: ReturnType<typeof setTimeout> | null = null;
let pendingHistorySave = false;
// 节点拖拽状态标志，防止拖拽过程中重复记录历史
let isDraggingNodes = false;

const getDefaultNodeData = (type: NodeType): Record<string, unknown> => {
  switch (type) {
    case NodeType.START:
      return {
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
        targetVolumeMl: 30,
        tolerance: 3,
        flowRateMlS: 5,
        stableTimeoutS: 10,
      };
    case NodeType.DRAIN:
      return {
        name: '排废',
        gasPumpPwm: 100,
        emptyToleranceG: 10,
        stabilityWindowS: 5,
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
        randomize: false,     // 随机化执行顺序
        shuffledOrder: [],    // 随机排列索引
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
    case NodeType.PREHEAT:
      return {
        name: '传感器预热',
        mode: 'duration',
        durationS: 60,
        maxDurationS: 300,
        sensorIndices: [],
        recordData: false,
        gasPumpPwm: 50,
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
  savedHistoryIndex: 0,
  isRecordingHistory: false,
  
  programId: 'new_experiment',
  programName: '新实验',
  programDescription: '',
  programVersion: '1.0.0',
  
  bottleCapacityMl: 150,
  maxFillMl: 100,
  
  // 实时编译状态
  compilationResult: null,
  isCompiling: false,
  autoCompile: true,
  
  // 未保存更改状态
  isDirty: false,
  setDirty: (dirty: boolean) => set({ isDirty: dirty }),
  
  // 当前文件名状态
  currentFilename: null,
  setCurrentFilename: (filename: string | null) => set({ currentFilename: filename }),
  
  // 多标签页状态
  tabs: [{ id: 'tab_0', filename: null, nodes: initialNodes, edges: initialEdges, programId: 'new_experiment', programName: '新实验', programDescription: '', programVersion: '1.0.0', bottleCapacityMl: 150, maxFillMl: 100, isDirty: false, history: [{ nodes: initialNodes, edges: initialEdges }], historyIndex: 0, savedHistoryIndex: 0, compilationResult: null }],
  activeTabId: 'tab_0',
  
  // 将当前编辑器状态快照到活动标签页
  updateActiveTabSnapshot: () => {
    const s = get();
    set({
      tabs: s.tabs.map(t => t.id === s.activeTabId ? {
        ...t,
        filename: s.currentFilename,
        nodes: JSON.parse(JSON.stringify(s.nodes)),
        edges: JSON.parse(JSON.stringify(s.edges)),
        programId: s.programId,
        programName: s.programName,
        programDescription: s.programDescription,
        programVersion: s.programVersion,
        bottleCapacityMl: s.bottleCapacityMl,
        maxFillMl: s.maxFillMl,
        isDirty: s.isDirty,
        history: JSON.parse(JSON.stringify(s.history)),
        historyIndex: s.historyIndex,
        savedHistoryIndex: s.savedHistoryIndex,
        compilationResult: s.compilationResult ? JSON.parse(JSON.stringify(s.compilationResult)) : null,
      } : t),
    });
  },
  
  // 创建新标签页并切换到它
  createTab: (filename = null) => {
    // 先快照当前标签
    get().updateActiveTabSnapshot();
    
    const id = generateTabId();
    const newTab: TabSnapshot = {
      id,
      filename,
      nodes: JSON.parse(JSON.stringify(initialNodes)),
      edges: [],
      programId: 'new_experiment',
      programName: '新实验',
      programDescription: '',
      programVersion: '1.0.0',
      bottleCapacityMl: 150,
      maxFillMl: 100,
      isDirty: false,
      history: [{ nodes: initialNodes, edges: [] }],
      historyIndex: 0,
      savedHistoryIndex: 0,
      compilationResult: null,
    };
    
    // 恢复新标签到编辑器
    nodeIdCounter = 0;
    syncNodeIdCounter(newTab.nodes);
    set({
      tabs: [...get().tabs, newTab],
      activeTabId: id,
      nodes: JSON.parse(JSON.stringify(newTab.nodes)),
      edges: [],
      selectedNodeId: null,
      currentFilename: null,
      programId: 'new_experiment',
      programName: '新实验',
      programDescription: '',
      programVersion: '1.0.0',
      bottleCapacityMl: 150,
      maxFillMl: 100,
      isDirty: false,
      history: [{ nodes: initialNodes, edges: [] }],
      historyIndex: 0,
      savedHistoryIndex: 0,
      compilationResult: null,
    });
    return id;
  },
  
  // 切换到指定标签页
  switchTab: (tabId) => {
    const s = get();
    if (tabId === s.activeTabId) return;
    
    // 快照当前标签
    s.updateActiveTabSnapshot();
    
    // 找到目标标签
    const target = s.tabs.find(t => t.id === tabId);
    if (!target) return;
    
    // 重置模块级共享状态，避免跨标签残留
    isDraggingNodes = false;
    if (updateNodeDataTimer) { clearTimeout(updateNodeDataTimer); updateNodeDataTimer = null; }
    pendingHistorySave = false;
    
    // 恢复目标标签到编辑器
    syncNodeIdCounter(target.nodes);
    set({
      activeTabId: tabId,
      nodes: JSON.parse(JSON.stringify(target.nodes)),
      edges: JSON.parse(JSON.stringify(target.edges)),
      selectedNodeId: null,
      currentFilename: target.filename,
      programId: target.programId,
      programName: target.programName,
      programDescription: target.programDescription,
      programVersion: target.programVersion,
      bottleCapacityMl: target.bottleCapacityMl,
      maxFillMl: target.maxFillMl,
      isDirty: target.isDirty,
      isRecordingHistory: false,
      history: JSON.parse(JSON.stringify(target.history)),
      historyIndex: target.historyIndex,
      savedHistoryIndex: target.savedHistoryIndex,
      compilationResult: target.compilationResult ? JSON.parse(JSON.stringify(target.compilationResult)) : null,
    });
  },
  
  // 关闭标签页
  closeTab: (tabId) => {
    const s = get();
    const idx = s.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return false;
    
    // 关闭最后一个标签时，重置为新的空白标签
    if (s.tabs.length <= 1) {
      const id = generateTabId();
      const newTab: TabSnapshot = {
        id,
        filename: null,
        nodes: JSON.parse(JSON.stringify(initialNodes)),
        edges: [],
        programId: 'new_experiment',
        programName: '新实验',
        programDescription: '',
        programVersion: '1.0.0',
        bottleCapacityMl: 150,
        maxFillMl: 100,
        isDirty: false,
        history: [{ nodes: initialNodes, edges: [] }],
        historyIndex: 0,
        savedHistoryIndex: 0,
        compilationResult: null,
      };
      nodeIdCounter = 0;
      syncNodeIdCounter(newTab.nodes);
      set({
        tabs: [newTab],
        activeTabId: id,
        nodes: JSON.parse(JSON.stringify(newTab.nodes)),
        edges: [],
        selectedNodeId: null,
        currentFilename: null,
        programId: 'new_experiment',
        programName: '新实验',
        programDescription: '',
        programVersion: '1.0.0',
        bottleCapacityMl: 150,
        maxFillMl: 100,
        isDirty: false,
        isRecordingHistory: false,
        history: [{ nodes: initialNodes, edges: [] }],
        historyIndex: 0,
        savedHistoryIndex: 0,
        compilationResult: null,
      });
      return true;
    }
    
    const newTabs = s.tabs.filter(t => t.id !== tabId);
    
    // 如果关闭的是当前活动标签，切换到相邻标签
    if (tabId === s.activeTabId) {
      const newActiveIdx = Math.min(idx, newTabs.length - 1);
      const target = newTabs[newActiveIdx];
      syncNodeIdCounter(target.nodes);
      // 重置模块级共享状态
      isDraggingNodes = false;
      if (updateNodeDataTimer) { clearTimeout(updateNodeDataTimer); updateNodeDataTimer = null; }
      pendingHistorySave = false;
      set({
        tabs: newTabs,
        activeTabId: target.id,
        nodes: JSON.parse(JSON.stringify(target.nodes)),
        edges: JSON.parse(JSON.stringify(target.edges)),
        selectedNodeId: null,
        currentFilename: target.filename,
        programId: target.programId,
        programName: target.programName,
        programDescription: target.programDescription,
        programVersion: target.programVersion,
        bottleCapacityMl: target.bottleCapacityMl,
        maxFillMl: target.maxFillMl,
        isDirty: target.isDirty,
        isRecordingHistory: false,
        history: JSON.parse(JSON.stringify(target.history)),
        historyIndex: target.historyIndex,
        savedHistoryIndex: target.savedHistoryIndex,
        compilationResult: target.compilationResult ? JSON.parse(JSON.stringify(target.compilationResult)) : null,
      });
    } else {
      set({ tabs: newTabs });
    }
    return true;
  },
  
  getTabById: (tabId) => get().tabs.find(t => t.id === tabId),
  
  saveToHistory: () => {
    const { isRecordingHistory, nodes, edges, history, historyIndex, savedHistoryIndex, programId, programName, programDescription, programVersion } = get();
    if (isRecordingHistory) return; // 防止重复记录
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      programMeta: { programId, programName, programDescription, programVersion },
    });
    // 如果超出限制，移除最旧的记录，同时调整 savedHistoryIndex
    let adjustedSavedIndex = savedHistoryIndex;
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
      adjustedSavedIndex = Math.max(-1, adjustedSavedIndex - 1);
    }
    set({ history: newHistory, historyIndex: newHistory.length - 1, savedHistoryIndex: adjustedSavedIndex, isDirty: true });
  },
  
  resetHistory: () => {
    const { nodes, edges, programId, programName, programDescription, programVersion } = get();
    set({
      history: [{
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
        programMeta: { programId, programName, programDescription, programVersion },
      }],
      historyIndex: 0,
      savedHistoryIndex: 0,
    });
  },
  
  markSaved: () => {
    set({ savedHistoryIndex: get().historyIndex, isDirty: false });
  },
  
  undo: () => {
    const { history, historyIndex, savedHistoryIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = history[newIndex];
      set({
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        edges: JSON.parse(JSON.stringify(state.edges)),
        historyIndex: newIndex,
        isDirty: newIndex !== savedHistoryIndex,
      });
      if (state.programMeta) {
        set({
          programId: state.programMeta.programId,
          programName: state.programMeta.programName,
          programDescription: state.programMeta.programDescription,
          programVersion: state.programMeta.programVersion,
        });
      }
      // 同步 nodeIdCounter 防止 ID 冲突
      syncNodeIdCounter(get().nodes);
    }
  },
  
  redo: () => {
    const { history, historyIndex, savedHistoryIndex } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const state = history[newIndex];
      set({
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        edges: JSON.parse(JSON.stringify(state.edges)),
        historyIndex: newIndex,
        isDirty: newIndex !== savedHistoryIndex,
      });
      if (state.programMeta) {
        set({
          programId: state.programMeta.programId,
          programName: state.programMeta.programName,
          programDescription: state.programMeta.programDescription,
          programVersion: state.programMeta.programVersion,
        });
      }
      syncNodeIdCounter(get().nodes);
    }
  },
  
  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,
  
  onNodesChange: (changes) => {
    // 只在删除节点时记录历史（添加节点由 addNode 处理）
    const removeChanges = changes.filter(c => c.type === 'remove');
    if (removeChanges.length > 0) {
      get().saveToHistory();
    }
    
    // 拖拽开始时保存历史（此时节点还在原始位置，撤销可回到拖拽前）
    const dragStartChanges = changes.filter(
      c => c.type === 'position' && c.dragging === true
    );
    if (dragStartChanges.length > 0 && !isDraggingNodes) {
      isDraggingNodes = true;
      get().saveToHistory();
    }
    
    // 拖拽结束时重置标志，标记脏状态
    const dragEndChanges = changes.filter(
      c => c.type === 'position' && c.dragging === false
    );
    if (dragEndChanges.length > 0) {
      isDraggingNodes = false;
      set({ isDirty: true });
    }
    
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  
  onEdgesChange: (changes) => {
    // 只在删除边时记录历史（添加边由 onConnect 处理）
    const removeChanges = changes.filter(c => c.type === 'remove');
    if (removeChanges.length > 0) {
      get().saveToHistory();
    }
    
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
    
    // 确定连接类型：优先检查 targetHandle（用于循环体返回连接）
    let handleType = connection.sourceHandle || HANDLE_TYPES.FLOW;
    if (connection.targetHandle === HANDLE_TYPES.LOOP_BODY) {
      handleType = HANDLE_TYPES.LOOP_BODY;
    }
    
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
    
    // 根据连接类型设置边的样式
    let edgeStyle: React.CSSProperties = { stroke: '#64748b' };
    let animated = false;
    
    if (connection.sourceHandle === HANDLE_TYPES.LIQUID) {
      edgeStyle = { stroke: '#22c55e', strokeDasharray: '5,5' };
      animated = true;
    } else if (connection.sourceHandle === HANDLE_TYPES.LOOP_BODY || 
               connection.targetHandle === HANDLE_TYPES.LOOP_BODY) {
      edgeStyle = { stroke: '#f59e0b', strokeWidth: 2 };
      animated = true;
    }
    
    set({
      edges: addEdge(
        {
          ...connection,
          type: 'smart',
          animated,
          style: edgeStyle,
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
    // 防抖保存历史：300ms 内的连续编辑合并为一次
    if (updateNodeDataTimer) clearTimeout(updateNodeDataTimer);
    if (!pendingHistorySave) {
      get().saveToHistory();
      pendingHistorySave = true;
    }
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      ),
      isDirty: true,
    });
    updateNodeDataTimer = setTimeout(() => {
      pendingHistorySave = false;
      updateNodeDataTimer = null;
    }, 300);
  },
  
  deleteNode: (nodeId) => {
    // 注意：不在此处调用 saveToHistory()，
    // 因为 React Flow 的 onNodesChange 会触发 remove 事件并记录历史。
    // 如果是从属性面板调用，需要手动记录。
    // 使用 isRecordingHistory 防止双重记录。
    get().saveToHistory();
    set({ isRecordingHistory: true });
    // 清理其他节点上引用被删除节点的 boundVariables
    const cleanedNodes = get().nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => {
        const data = node.data as Record<string, unknown>;
        const bound = data.boundVariables as Record<string, string> | undefined;
        if (!bound) return node;
        const cleaned: Record<string, string> = {};
        let changed = false;
        for (const [field, sweepId] of Object.entries(bound)) {
          if (sweepId === nodeId) {
            changed = true;
          } else {
            cleaned[field] = sweepId;
          }
        }
        if (!changed) return node;
        return {
          ...node,
          data: {
            ...data,
            boundVariables: Object.keys(cleaned).length > 0 ? cleaned : undefined,
          },
        };
      });
    set({
      nodes: cleanedNodes,
      edges: get().edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
    // 在下一个微任务中重置标志，确保 onNodesChange 的 remove 事件不会重复记录
    queueMicrotask(() => {
      useEditorStore.setState({ isRecordingHistory: false });
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
    syncNodeIdCounter(nodes);
    set({ nodes, edges });
    // 加载新图后重置历史栈（防止撤销回旧文件）
    // 由调用方负责在 loadGraph 后调用 resetHistory
  },
  
  clearGraph: () => {
    nodeIdCounter = 0;
    set({
      nodes: initialNodes,
      edges: initialEdges,
      selectedNodeId: null,
    });
  },
  
  // 实时编译（异步获取外部数据）
  recompile: async () => {
    const { nodes, edges, bottleCapacityMl, maxFillMl, activeTabId } = get();
    set({ isCompiling: true });
    
    try {
      // 使用数据获取模块获取编译所需的外部数据
      const { heaterProfiles, pumpBindings } = await fetchCompilerData();
      
      const result = compile(nodes, edges, {
        bottleCapacityMl,
        maxFillMl,
        expandLoops: true,  // 展开循环显示真实编译产物
        heaterProfiles,
        pumpBindings,
      });
      // 仅在仍是同一标签页时才写入结果，避免竞态
      if (get().activeTabId === activeTabId) {
        set({ compilationResult: result, isCompiling: false });
      }
    } catch (error) {
      console.error('编译失败:', error);
      // 即使获取外部数据失败，也尝试编译（不含外部数据）
      const result = compile(nodes, edges, {
        bottleCapacityMl,
        maxFillMl,
        expandLoops: true,
      });
      if (get().activeTabId === activeTabId) {
        set({ compilationResult: result, isCompiling: false });
      }
    }
  },
  
  setAutoCompile: (enabled) => {
    set({ autoCompile: enabled });
    if (enabled) {
      get().recompile();
    }
  },
  
  getDefaultNodeData,
}));
