/**
 * 实时编译器模块
 * 
 * 功能：
 * 1. 将 DAG 节点图实时编译为步骤序列
 * 2. 验证图结构和连接合法性
 * 3. 估算执行时间和资源使用
 * 4. 生成错误和警告信息
 */

import { ExperimentNode, ExperimentEdge, NodeType, HANDLE_TYPES, NODE_META } from './types';

// 编译后的步骤
export interface CompiledStep {
  id: string;
  nodeId: string;
  name: string;
  type: NodeType;
  action: string;
  params: Record<string, unknown>;
  estimatedDurationS: number;
  liquidChangeMl: number; // 正数=注入，负数=排出
}

// 编译诊断信息
export interface CompilerDiagnostic {
  level: 'error' | 'warning' | 'info';
  nodeId?: string;
  message: string;
  code: string;
}

// 编译结果
export interface CompilationResult {
  success: boolean;
  steps: CompiledStep[];
  diagnostics: CompilerDiagnostic[];
  
  // 估算数据
  totalDurationS: number;
  peakLiquidLevelMl: number;
  totalInjectMl: number;
  totalDrainMl: number;
  loopExpansionCount: number;
  
  // 执行路径
  executionPath: string[]; // nodeId 序列
  
  // 时间戳
  compiledAt: number;
}

// 编译器配置
export interface CompilerConfig {
  bottleCapacityMl: number;
  maxFillMl: number;
  expandLoops: boolean; // 是否展开循环
  maxLoopExpansion: number; // 最大循环展开数
}

const DEFAULT_CONFIG: CompilerConfig = {
  bottleCapacityMl: 150,
  maxFillMl: 100,
  expandLoops: true,  // 默认展开循环，显示真实编译产物
  maxLoopExpansion: 100,
};

/**
 * 实时编译 DAG 图
 */
export function compile(
  nodes: ExperimentNode[],
  edges: ExperimentEdge[],
  config: Partial<CompilerConfig> = {}
): CompilationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const diagnostics: CompilerDiagnostic[] = [];
  const steps: CompiledStep[] = [];
  const executionPath: string[] = [];
  
  let totalDurationS = 0;
  let currentLiquidMl = 0;
  let peakLiquidLevelMl = 0;
  let totalInjectMl = 0;
  let totalDrainMl = 0;
  let loopExpansionCount = 0;
  
  // 1. 结构验证
  const structureErrors = validateStructure(nodes, edges);
  diagnostics.push(...structureErrors);
  
  if (structureErrors.some(d => d.level === 'error')) {
    return {
      success: false,
      steps: [],
      diagnostics,
      totalDurationS: 0,
      peakLiquidLevelMl: 0,
      totalInjectMl: 0,
      totalDrainMl: 0,
      loopExpansionCount: 0,
      executionPath: [],
      compiledAt: Date.now(),
    };
  }
  
  // 2. 构建邻接表
  const flowAdjacency = buildFlowAdjacency(edges);
  const loopBodyAdjacency = buildLoopBodyAdjacency(edges);
  const liquidConnections = buildLiquidConnections(edges);
  
  // 3. 拓扑遍历生成步骤
  const startNode = nodes.find(n => n.type === NodeType.START);
  if (!startNode) {
    diagnostics.push({
      level: 'error',
      message: '缺少开始节点',
      code: 'E001',
    });
    return {
      success: false,
      steps: [],
      diagnostics,
      totalDurationS: 0,
      peakLiquidLevelMl: 0,
      totalInjectMl: 0,
      totalDrainMl: 0,
      loopExpansionCount: 0,
      executionPath: [],
      compiledAt: Date.now(),
    };
  }
  
  const visited = new Set<string>();
  let currentId: string | undefined = startNode.id;
  
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    executionPath.push(currentId);
    
    const node = nodes.find(n => n.id === currentId);
    if (!node) break;
    
    // 编译节点
    if (node.type !== NodeType.START && node.type !== NodeType.END) {
      const compiledStep = compileNode(node, nodes, liquidConnections, cfg, diagnostics);
      
      if (compiledStep) {
        // 处理循环节点
        if (node.type === NodeType.LOOP) {
          const loopCount = (node.data as Record<string, unknown>).count as number || 1;
          const loopBodySteps = compileLoopBody(
            node.id,
            nodes,
            loopBodyAdjacency,
            flowAdjacency,
            liquidConnections,
            cfg,
            diagnostics
          );
          
          if (cfg.expandLoops && loopCount <= cfg.maxLoopExpansion) {
            // 展开循环
            for (let i = 0; i < loopCount; i++) {
              for (const bodyStep of loopBodySteps) {
                const expandedStep = {
                  ...bodyStep,
                  id: `${bodyStep.id}_iter${i}`,
                  name: `${bodyStep.name} (迭代 ${i + 1})`,
                };
                steps.push(expandedStep);
                totalDurationS += expandedStep.estimatedDurationS;
                
                // 更新液位
                currentLiquidMl += expandedStep.liquidChangeMl;
                peakLiquidLevelMl = Math.max(peakLiquidLevelMl, currentLiquidMl);
                if (expandedStep.liquidChangeMl > 0) {
                  totalInjectMl += expandedStep.liquidChangeMl;
                } else {
                  totalDrainMl += Math.abs(expandedStep.liquidChangeMl);
                }
              }
              loopExpansionCount++;
            }
          } else {
            // 不展开，只计算一次迭代的估算
            compiledStep.estimatedDurationS = loopBodySteps.reduce(
              (sum, s) => sum + s.estimatedDurationS, 0
            ) * loopCount;
            compiledStep.params = {
              ...compiledStep.params,
              loopSteps: loopBodySteps,
              iterations: loopCount,
            };
            steps.push(compiledStep);
            totalDurationS += compiledStep.estimatedDurationS;
            
            // 估算液位变化（假设每次迭代相同）
            const bodyLiquidChange = loopBodySteps.reduce((sum, s) => sum + s.liquidChangeMl, 0);
            for (let i = 0; i < loopCount; i++) {
              currentLiquidMl += bodyLiquidChange;
              peakLiquidLevelMl = Math.max(peakLiquidLevelMl, currentLiquidMl);
            }
          }
        } else {
          steps.push(compiledStep);
          totalDurationS += compiledStep.estimatedDurationS;
          
          // 更新液位
          currentLiquidMl += compiledStep.liquidChangeMl;
          peakLiquidLevelMl = Math.max(peakLiquidLevelMl, currentLiquidMl);
          if (compiledStep.liquidChangeMl > 0) {
            totalInjectMl += compiledStep.liquidChangeMl;
          } else {
            totalDrainMl += Math.abs(compiledStep.liquidChangeMl);
          }
        }
        
        // 检查液位溢出
        if (currentLiquidMl > cfg.maxFillMl) {
          diagnostics.push({
            level: 'warning',
            nodeId: node.id,
            message: `液位可能超过最大填充量 (${currentLiquidMl.toFixed(1)}ml > ${cfg.maxFillMl}ml)`,
            code: 'W001',
          });
        }
        
        if (currentLiquidMl < 0) {
          diagnostics.push({
            level: 'info',
            nodeId: node.id,
            message: '排废量可能超过当前液位',
            code: 'I001',
          });
          currentLiquidMl = 0;
        }
      }
    }
    
    currentId = flowAdjacency.get(currentId);
  }
  
  // 4. 检查是否到达结束节点
  const endNode = nodes.find(n => n.type === NodeType.END);
  if (endNode && !visited.has(endNode.id)) {
    diagnostics.push({
      level: 'warning',
      message: '执行路径未到达结束节点',
      code: 'W002',
    });
  }
  
  // 5. 检查孤立节点
  const connectedNodes = new Set<string>();
  edges.forEach(e => {
    connectedNodes.add(e.source);
    connectedNodes.add(e.target);
  });
  
  nodes.forEach(node => {
    if (!connectedNodes.has(node.id) && node.type !== NodeType.LIQUID_SOURCE && node.type !== NodeType.HARDWARE_CONFIG) {
      diagnostics.push({
        level: 'warning',
        nodeId: node.id,
        message: `节点 "${(node.data as Record<string, unknown>).name || NODE_META[node.type as NodeType]?.label}" 未连接到流程`,
        code: 'W003',
      });
    }
  });
  
  return {
    success: !diagnostics.some(d => d.level === 'error'),
    steps,
    diagnostics,
    totalDurationS,
    peakLiquidLevelMl,
    totalInjectMl,
    totalDrainMl,
    loopExpansionCount,
    executionPath,
    compiledAt: Date.now(),
  };
}

/**
 * 验证图结构
 */
function validateStructure(
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  
  // 检查开始节点
  const startNodes = nodes.filter(n => n.type === NodeType.START);
  if (startNodes.length === 0) {
    diagnostics.push({
      level: 'error',
      message: '缺少开始节点',
      code: 'E001',
    });
  } else if (startNodes.length > 1) {
    diagnostics.push({
      level: 'error',
      message: '存在多个开始节点',
      code: 'E002',
    });
  }
  
  // 检查结束节点
  const endNodes = nodes.filter(n => n.type === NodeType.END);
  if (endNodes.length === 0) {
    diagnostics.push({
      level: 'error',
      message: '缺少结束节点',
      code: 'E003',
    });
  } else if (endNodes.length > 1) {
    diagnostics.push({
      level: 'error',
      message: '存在多个结束节点',
      code: 'E004',
    });
  }
  
  // 检查进样节点的液体连接
  const injectNodes = nodes.filter(n => n.type === NodeType.INJECT);
  const liquidEdges = edges.filter(e => e.sourceHandle === HANDLE_TYPES.LIQUID);
  
  injectNodes.forEach(node => {
    const hasLiquid = liquidEdges.some(e => e.target === node.id);
    if (!hasLiquid) {
      diagnostics.push({
        level: 'warning',
        nodeId: node.id,
        message: `进样节点 "${(node.data as Record<string, unknown>).name || '进样'}" 未连接液体源`,
        code: 'W004',
      });
    }
  });
  
  // 检查液体源是否为空
  const liquidSources = nodes.filter(n => n.type === NodeType.LIQUID_SOURCE);
  liquidSources.forEach(liquidNode => {
    const data = liquidNode.data as Record<string, unknown>;
    const liquidId = data.liquidId;
    // liquidId 可能是字符串或数字，需要统一处理
    const liquidIdStr = liquidId != null ? String(liquidId).trim() : '';
    if (!liquidIdStr) {
      diagnostics.push({
        level: 'error',
        nodeId: liquidNode.id,
        message: `液体源 "${data.liquidName || '未命名'}" 未绑定液体`,
        code: 'E006',
      });
    }
  });
  
  // 检查液体源比例总和
  injectNodes.forEach(injectNode => {
    const connectedLiquids = liquidEdges
      .filter(e => e.target === injectNode.id)
      .map(e => nodes.find(n => n.id === e.source))
      .filter(Boolean) as ExperimentNode[];
    
    if (connectedLiquids.length > 1) {
      const totalRatio = connectedLiquids.reduce((sum, n) => {
        return sum + ((n.data as Record<string, unknown>).ratio as number || 0);
      }, 0);
      
      if (Math.abs(totalRatio - 1.0) > 0.01) {
        diagnostics.push({
          level: 'warning',
          nodeId: injectNode.id,
          message: `液体比例总和 ${(totalRatio * 100).toFixed(0)}% ≠ 100%`,
          code: 'W005',
        });
      }
    }
  });
  
  // 检查环路（排除循环体的 loopBody 连接）
  const cycleError = detectCycle(nodes, edges);
  if (cycleError) {
    diagnostics.push(cycleError);
  }
  
  return diagnostics;
}

/**
 * 检测图中是否存在环路（排除 loopBody 类型的边）
 * 使用 DFS 进行环路检测
 */
function detectCycle(
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): CompilerDiagnostic | null {
  // 只检查 flow 类型的边（排除 loopBody 和 liquid 连接）
  const flowEdges = edges.filter(e => 
    !e.sourceHandle || 
    e.sourceHandle === HANDLE_TYPES.FLOW
  );
  
  // 构建邻接表
  const adjacency = new Map<string, string[]>();
  nodes.forEach(n => adjacency.set(n.id, []));
  flowEdges.forEach(e => {
    const neighbors = adjacency.get(e.source);
    if (neighbors) {
      neighbors.push(e.target);
    }
  });
  
  // DFS 状态：0=未访问, 1=正在访问, 2=已完成
  const state = new Map<string, number>();
  nodes.forEach(n => state.set(n.id, 0));
  
  // 记录发现环路的节点
  let cycleNodeId: string | null = null;
  
  function dfs(nodeId: string, path: string[]): boolean {
    const currentState = state.get(nodeId);
    
    if (currentState === 1) {
      // 发现环路
      cycleNodeId = nodeId;
      return true;
    }
    
    if (currentState === 2) {
      // 已完成访问，无环
      return false;
    }
    
    state.set(nodeId, 1); // 标记为正在访问
    
    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor, [...path, nodeId])) {
        return true;
      }
    }
    
    state.set(nodeId, 2); // 标记为已完成
    return false;
  }
  
  // 从所有节点开始 DFS
  for (const node of nodes) {
    if (state.get(node.id) === 0) {
      if (dfs(node.id, [])) {
        const cycleNode = nodes.find(n => n.id === cycleNodeId);
        const nodeName = cycleNode ? 
          ((cycleNode.data as Record<string, unknown>).name as string) || NODE_META[cycleNode.type as NodeType]?.label || '未知节点' 
          : '未知节点';
        return {
          level: 'error',
          nodeId: cycleNodeId || undefined,
          message: `检测到环路：节点 "${nodeName}" 形成了循环依赖。请使用循环节点的循环体连接（黄色端点）来实现循环逻辑。`,
          code: 'E010',
        };
      }
    }
  }
  
  return null;
}

/**
 * 构建 flow 邻接表
 */
function buildFlowAdjacency(edges: ExperimentEdge[]): Map<string, string> {
  const adjacency = new Map<string, string>();
  edges
    .filter(e => !e.sourceHandle || e.sourceHandle === HANDLE_TYPES.FLOW)
    .forEach(e => adjacency.set(e.source, e.target));
  return adjacency;
}

/**
 * 构建循环体邻接表
 */
function buildLoopBodyAdjacency(edges: ExperimentEdge[]): Map<string, { out?: string; in?: string }> {
  const adjacency = new Map<string, { out?: string; in?: string }>();
  
  edges
    .filter(e => e.sourceHandle === HANDLE_TYPES.LOOP_BODY)
    .forEach(e => {
      const existing = adjacency.get(e.source) || {};
      existing.out = e.target;
      adjacency.set(e.source, existing);
    });
  
  edges
    .filter(e => e.targetHandle === HANDLE_TYPES.LOOP_BODY)
    .forEach(e => {
      const existing = adjacency.get(e.target) || {};
      existing.in = e.source;
      adjacency.set(e.target, existing);
    });
  
  return adjacency;
}

/**
 * 构建液体连接映射
 */
function buildLiquidConnections(edges: ExperimentEdge[]): Map<string, string[]> {
  const connections = new Map<string, string[]>();
  
  edges
    .filter(e => e.sourceHandle === HANDLE_TYPES.LIQUID)
    .forEach(e => {
      const existing = connections.get(e.target) || [];
      existing.push(e.source);
      connections.set(e.target, existing);
    });
  
  return connections;
}

/**
 * 编译单个节点
 */
function compileNode(
  node: ExperimentNode,
  allNodes: ExperimentNode[],
  liquidConnections: Map<string, string[]>,
  config: CompilerConfig,
  diagnostics: CompilerDiagnostic[]
): CompiledStep | null {
  const data = node.data as Record<string, unknown>;
  const name = (data.name as string) || NODE_META[node.type as NodeType]?.label || '未知步骤';
  
  const baseStep: CompiledStep = {
    id: `step_${node.id}`,
    nodeId: node.id,
    name,
    type: node.type as NodeType,
    action: node.type as string,
    params: { ...data },
    estimatedDurationS: 0,
    liquidChangeMl: 0,
  };
  
  switch (node.type) {
    case NodeType.INJECT: {
      const targetVolume = (data.targetVolumeMl as number) || 15;
      const flowRate = (data.flowRateMlMin as number) || 5;
      const stableTimeout = (data.stableTimeoutS as number) || 60;
      
      // 获取连接的液体
      const liquidNodeIds = liquidConnections.get(node.id) || [];
      const liquids = liquidNodeIds
        .map(id => allNodes.find(n => n.id === id))
        .filter(Boolean)
        .map(n => {
          const d = n!.data as Record<string, unknown>;
          return {
            liquidId: d.liquidId as string,
            liquidName: d.liquidName as string,
            ratio: d.ratio as number || 1,
          };
        });
      
      baseStep.params.components = liquids;
      baseStep.estimatedDurationS = (targetVolume / flowRate) * 60 + stableTimeout;
      baseStep.liquidChangeMl = targetVolume;
      break;
    }
    
    case NodeType.DRAIN: {
      const timeout = (data.timeoutS as number) || 60;
      baseStep.estimatedDurationS = timeout;
      baseStep.liquidChangeMl = -config.maxFillMl; // 假设排空
      break;
    }
    
    case NodeType.WASH: {
      const washVolume = (data.washVolumeMl as number) || 20;
      const repeatCount = (data.repeatCount as number) || 2;
      const drainAfter = (data.drainAfter as boolean) ?? true;
      
      // 每次清洗：注入 + 排出
      baseStep.estimatedDurationS = repeatCount * (washVolume / 5 * 60 + 30); // 假设 5ml/min 流速 + 30s 排放
      baseStep.liquidChangeMl = drainAfter ? 0 : washVolume; // 如果排放则液位不变
      break;
    }
    
    case NodeType.ACQUIRE: {
      const maxDuration = (data.maxDurationS as number) || 300;
      const terminationType = data.terminationType as string;
      
      if (terminationType === 'duration') {
        baseStep.estimatedDurationS = (data.durationS as number) || 60;
      } else if (terminationType === 'cycles') {
        const cycles = (data.heaterCycles as number) || 10;
        baseStep.estimatedDurationS = cycles * 20; // 假设每周期 20s
      } else {
        baseStep.estimatedDurationS = maxDuration;
      }
      break;
    }
    
    case NodeType.WAIT_TIME: {
      baseStep.estimatedDurationS = (data.durationS as number) || 60;
      break;
    }
    
    case NodeType.WAIT_CYCLES: {
      const cycles = (data.heaterCycles as number) || 5;
      baseStep.estimatedDurationS = cycles * 20; // 假设每周期 20s
      break;
    }
    
    case NodeType.WAIT_STABILITY: {
      baseStep.estimatedDurationS = (data.timeoutS as number) || 300;
      break;
    }
    
    case NodeType.PHASE_MARKER:
    case NodeType.SET_STATE:
    case NodeType.SET_GAS_PUMP: {
      baseStep.estimatedDurationS = 0; // 即时操作
      break;
    }
    
    case NodeType.LOOP: {
      // 循环节点本身不产生时间，由循环体决定
      baseStep.estimatedDurationS = 0;
      break;
    }
    
    case NodeType.PARAM_SWEEP: {
      // 参数扫描需要特殊处理
      diagnostics.push({
        level: 'info',
        nodeId: node.id,
        message: '参数扫描节点将在运行时展开',
        code: 'I002',
      });
      break;
    }
    
    default:
      return null;
  }
  
  return baseStep;
}

/**
 * 编译循环体（支持嵌套循环）
 */
function compileLoopBody(
  loopNodeId: string,
  allNodes: ExperimentNode[],
  loopBodyAdjacency: Map<string, { out?: string; in?: string }>,
  flowAdjacency: Map<string, string>,
  liquidConnections: Map<string, string[]>,
  config: CompilerConfig,
  diagnostics: CompilerDiagnostic[],
  depth: number = 0
): CompiledStep[] {
  const steps: CompiledStep[] = [];
  const loopInfo = loopBodyAdjacency.get(loopNodeId);
  
  if (!loopInfo?.out) {
    return steps;
  }
  
  // 防止无限递归
  if (depth > 10) {
    diagnostics.push({
      level: 'error',
      nodeId: loopNodeId,
      message: '循环嵌套深度超过限制 (最大10层)',
      code: 'E005',
    });
    return steps;
  }
  
  const visited = new Set<string>();
  let currentId: string | undefined = loopInfo.out;
  
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    
    const node = allNodes.find(n => n.id === currentId);
    if (!node) break;
    
    // 处理嵌套循环
    if (node.type === NodeType.LOOP) {
      const nestedLoopCount = (node.data as Record<string, unknown>).count as number || 1;
      const nestedBodySteps = compileLoopBody(
        node.id,
        allNodes,
        loopBodyAdjacency,
        flowAdjacency,
        liquidConnections,
        config,
        diagnostics,
        depth + 1
      );
      
      if (config.expandLoops && nestedLoopCount <= config.maxLoopExpansion) {
        // 展开嵌套循环
        for (let i = 0; i < nestedLoopCount; i++) {
          for (const bodyStep of nestedBodySteps) {
            steps.push({
              ...bodyStep,
              id: `${bodyStep.id}_nest${depth}_iter${i}`,
              name: `${bodyStep.name} (嵌套${depth + 1}-迭代${i + 1})`,
            });
          }
        }
      } else {
        // 不展开，创建一个汇总步骤
        const nestedStep = compileNode(node, allNodes, liquidConnections, config, diagnostics);
        if (nestedStep) {
          nestedStep.estimatedDurationS = nestedBodySteps.reduce(
            (sum, s) => sum + s.estimatedDurationS, 0
          ) * nestedLoopCount;
          nestedStep.params = {
            ...nestedStep.params,
            loopSteps: nestedBodySteps,
            iterations: nestedLoopCount,
          };
          steps.push(nestedStep);
        }
      }
    } else {
      const step = compileNode(node, allNodes, liquidConnections, config, diagnostics);
      if (step) {
        steps.push(step);
      }
    }
    
    // 检查是否是循环体返回点
    if (currentId === loopInfo.in) {
      break;
    }
    
    currentId = flowAdjacency.get(currentId);
  }
  
  return steps;
}

/**
 * 格式化时间
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) {
    return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

/**
 * 获取诊断级别图标
 */
export function getDiagnosticIcon(level: CompilerDiagnostic['level']): string {
  switch (level) {
    case 'error': return '❌';
    case 'warning': return '⚠️';
    case 'info': return 'ℹ️';
  }
}
