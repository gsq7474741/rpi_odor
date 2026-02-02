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
  
  // 层级信息（用于折叠显示）
  depth: number;              // 嵌套深度，0=顶层
  loopPath: LoopPathEntry[];  // 从外到内的循环/扫描路径
  isAtomic: boolean;          // 是否原子步骤（非循环/扫描节点）
}

// 循环/扫描路径条目
export interface LoopPathEntry {
  loopId: string;       // 循环/扫描节点ID
  loopName: string;     // 循环/扫描名称
  iteration: number;    // 当前迭代（从1开始）
  total: number;        // 总迭代次数
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
          const loopData = node.data as Record<string, unknown>;
          const loopCount = (loopData.count as number) || 1;
          const loopName = String(loopData.name || '循环');
          const loopBodySteps = compileLoopBody(
            node.id,
            nodes,
            loopBodyAdjacency,
            flowAdjacency,
            liquidConnections,
            cfg,
            diagnostics,
            0,
            []  // 初始空 loopPath
          );
          
          if (cfg.expandLoops && loopCount <= cfg.maxLoopExpansion) {
            // 展开循环，设置层级信息
            for (let i = 0; i < loopCount; i++) {
              const currentLoopEntry: LoopPathEntry = {
                loopId: node.id,
                loopName: loopName,
                iteration: i + 1,
                total: loopCount,
              };
              
              for (const bodyStep of loopBodySteps) {
                const expandedStep: CompiledStep = {
                  ...bodyStep,
                  id: `${bodyStep.id}_iter${i}`,
                  name: bodyStep.name,  // 保持原始名称，不添加前缀
                  params: { ...bodyStep.params },
                  loopPath: [currentLoopEntry, ...bodyStep.loopPath],
                  depth: bodyStep.depth + 1,
                };
                steps.push(expandedStep);
                
                // 只累加原子步骤时间
                if (expandedStep.isAtomic) {
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
              }
              loopExpansionCount++;
            }
          } else {
            // 不展开，只计算一次迭代的估算
            const atomicDuration = loopBodySteps
              .filter(s => s.isAtomic)
              .reduce((sum, s) => sum + s.estimatedDurationS, 0);
            compiledStep.estimatedDurationS = atomicDuration * loopCount;
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
        // 处理参数扫描节点（和循环类似，编译期展开）
        } else if (node.type === NodeType.PARAM_SWEEP) {
          const sweepData = node.data as Record<string, unknown>;
          const sweepName = String(sweepData.name || '参数扫描');
          const sweepValues = generateSweepValues(sweepData);
          const sweepBodySteps = compileLoopBody(
            node.id,
            nodes,
            loopBodyAdjacency,
            flowAdjacency,
            liquidConnections,
            cfg,
            diagnostics,
            0,
            []  // 初始空 loopPath
          );
          
          if (sweepValues.length === 0) {
            diagnostics.push({
              level: 'warning',
              nodeId: node.id,
              message: `参数扫描节点 [${sweepName}] 没有生成扫描值`,
              code: 'W006',
            });
          } else if (sweepBodySteps.length === 0) {
            diagnostics.push({
              level: 'warning',
              nodeId: node.id,
              message: `参数扫描节点 [${sweepName}] 没有连接扫描体`,
              code: 'W007',
            });
          } else if (cfg.expandLoops && sweepValues.length <= cfg.maxLoopExpansion) {
            // 展开参数扫描
            const paramType = sweepData.paramType as string || 'volume';
            
            for (let i = 0; i < sweepValues.length; i++) {
              const value = sweepValues[i];
              const currentLoopEntry: LoopPathEntry = {
                loopId: node.id,
                loopName: sweepName,
                iteration: i + 1,
                total: sweepValues.length,
              };
              
              for (const bodyStep of sweepBodySteps) {
                // 克隆步骤并应用参数值
                const expandedStep: CompiledStep = {
                  ...bodyStep,
                  id: `${bodyStep.id}_sweep${i}`,
                  name: bodyStep.name,  // 保持原始名称
                  params: { ...bodyStep.params },
                  loopPath: [currentLoopEntry, ...bodyStep.loopPath],
                  depth: bodyStep.depth + 1,
                };
                
                // 根据参数类型修改对应字段
                applySweptParameter(expandedStep, paramType, value);
                
                steps.push(expandedStep);
                
                // 只累加原子步骤时间
                if (expandedStep.isAtomic) {
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
              }
              loopExpansionCount++;
            }
          } else {
            // 不展开，显示汇总
            compiledStep.name = `${sweepName} (${sweepValues.length}次扫描)`;
            const atomicDuration = sweepBodySteps
              .filter(s => s.isAtomic)
              .reduce((sum, s) => sum + s.estimatedDurationS, 0);
            compiledStep.estimatedDurationS = atomicDuration * sweepValues.length;
            compiledStep.params = {
              ...compiledStep.params,
              sweepSteps: sweepBodySteps,
              sweepCount: sweepValues.length,
            };
            steps.push(compiledStep);
            totalDurationS += compiledStep.estimatedDurationS;
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
  
  const isLoopType = node.type === NodeType.LOOP || node.type === NodeType.PARAM_SWEEP;
  const baseStep: CompiledStep = {
    id: `step_${node.id}`,
    nodeId: node.id,
    name,
    type: node.type as NodeType,
    action: node.type as string,
    params: { ...data },
    estimatedDurationS: 0,
    liquidChangeMl: 0,
    depth: 0,
    loopPath: [],
    isAtomic: !isLoopType,
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
      // 参数扫描节点本身不产生时间，由扫描体决定
      baseStep.estimatedDurationS = 0;
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
  depth: number = 0,
  parentLoopPath: LoopPathEntry[] = []
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
      const loopData = node.data as Record<string, unknown>;
      const nestedLoopCount = (loopData.count as number) || 1;
      const nestedLoopName = String(loopData.name || '循环');
      const nestedBodySteps = compileLoopBody(
        node.id,
        allNodes,
        loopBodyAdjacency,
        flowAdjacency,
        liquidConnections,
        config,
        diagnostics,
        depth + 1,
        parentLoopPath
      );
      
      if (config.expandLoops && nestedLoopCount <= config.maxLoopExpansion) {
        // 展开嵌套循环，设置层级信息
        for (let i = 0; i < nestedLoopCount; i++) {
          const currentLoopEntry: LoopPathEntry = {
            loopId: node.id,
            loopName: nestedLoopName,
            iteration: i + 1,
            total: nestedLoopCount,
          };
          
          for (const bodyStep of nestedBodySteps) {
            steps.push({
              ...bodyStep,
              id: `${bodyStep.id}_nest${depth}_iter${i}`,
              name: bodyStep.name,
              params: { ...bodyStep.params },
              loopPath: [currentLoopEntry, ...bodyStep.loopPath],
              depth: bodyStep.depth + 1,
            });
          }
        }
      } else {
        // 不展开，创建一个汇总步骤
        const nestedStep = compileNode(node, allNodes, liquidConnections, config, diagnostics);
        if (nestedStep) {
          const atomicDuration = nestedBodySteps
            .filter(s => s.isAtomic)
            .reduce((sum, s) => sum + s.estimatedDurationS, 0);
          nestedStep.estimatedDurationS = atomicDuration * nestedLoopCount;
          nestedStep.params = {
            ...nestedStep.params,
            loopSteps: nestedBodySteps,
            iterations: nestedLoopCount,
          };
          nestedStep.depth = depth;
          nestedStep.loopPath = parentLoopPath;
          steps.push(nestedStep);
        }
      }
    // 处理嵌套参数扫描
    } else if (node.type === NodeType.PARAM_SWEEP) {
      const sweepData = node.data as Record<string, unknown>;
      const sweepName = String(sweepData.name || '参数扫描');
      const sweepValues = generateSweepValues(sweepData);
      const nestedBodySteps = compileLoopBody(
        node.id,
        allNodes,
        loopBodyAdjacency,
        flowAdjacency,
        liquidConnections,
        config,
        diagnostics,
        depth + 1,
        parentLoopPath
      );
      
      if (config.expandLoops && sweepValues.length <= config.maxLoopExpansion && nestedBodySteps.length > 0) {
        // 展开嵌套参数扫描
        const paramType = sweepData.paramType as string || 'volume';
        
        for (let i = 0; i < sweepValues.length; i++) {
          const value = sweepValues[i];
          const currentLoopEntry: LoopPathEntry = {
            loopId: node.id,
            loopName: sweepName,
            iteration: i + 1,
            total: sweepValues.length,
          };
          
          for (const bodyStep of nestedBodySteps) {
            const expandedStep: CompiledStep = {
              ...bodyStep,
              id: `${bodyStep.id}_nest${depth}_sweep${i}`,
              name: bodyStep.name,
              params: { ...bodyStep.params },
              loopPath: [currentLoopEntry, ...bodyStep.loopPath],
              depth: bodyStep.depth + 1,
            };
            
            applySweptParameter(expandedStep, paramType, value);
            steps.push(expandedStep);
          }
        }
      } else {
        // 不展开，创建一个汇总步骤
        const nestedStep = compileNode(node, allNodes, liquidConnections, config, diagnostics);
        if (nestedStep) {
          nestedStep.name = `${sweepName} (${sweepValues.length}次扫描)`;
          const atomicDuration = nestedBodySteps
            .filter(s => s.isAtomic)
            .reduce((sum, s) => sum + s.estimatedDurationS, 0);
          nestedStep.estimatedDurationS = atomicDuration * sweepValues.length;
          nestedStep.depth = depth;
          nestedStep.loopPath = parentLoopPath;
          steps.push(nestedStep);
        }
      }
    } else {
      const step = compileNode(node, allNodes, liquidConnections, config, diagnostics);
      if (step) {
        step.depth = depth;
        step.loopPath = parentLoopPath;
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

/**
 * 生成参数扫描序列值
 */
function generateSweepValues(data: Record<string, unknown>): number[] {
  const paramType = data.paramType as string;
  
  // 比例扫描使用自定义点列表
  if (paramType === 'ratio') {
    const ratioPoints = data.ratioSweepPoints as Array<{ ratios: Record<string, number> }>;
    return ratioPoints?.map((_, i) => i) || [];
  }
  
  // 其他类型使用数值序列
  const start = Number(data.startValue ?? 1);
  const end = Number(data.endValue ?? 10);
  const step = Number(data.stepValue ?? 1);
  const seqMode = (data.seqMode as string) || 'linear';
  
  if (step <= 0 || start > end) {
    return [start];
  }
  
  const values: number[] = [];
  const count = Math.floor((end - start) / step) + 1;
  
  switch (seqMode) {
    case 'log': {
      // 对数序列
      const logStart = Math.log10(Math.max(start, 0.001));
      const logEnd = Math.log10(Math.max(end, 0.001));
      const logStep = (logEnd - logStart) / Math.max(count - 1, 1);
      for (let i = 0; i < count; i++) {
        values.push(Math.pow(10, logStart + logStep * i));
      }
      break;
    }
    case 'exp': {
      // 指数序列
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(count - 1, 1);
        values.push(start + (end - start) * (Math.exp(t * 2) - 1) / (Math.exp(2) - 1));
      }
      break;
    }
    case 'quadratic': {
      // 二次序列
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(count - 1, 1);
        values.push(start + (end - start) * t * t);
      }
      break;
    }
    case 'sqrt': {
      // 平方根序列
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(count - 1, 1);
        values.push(start + (end - start) * Math.sqrt(t));
      }
      break;
    }
    default: {
      // 线性序列
      for (let v = start; v <= end; v += step) {
        values.push(v);
      }
      break;
    }
  }
  
  return values.length > 0 ? values : [start];
}

/**
 * 应用扫描参数值到步骤
 */
function applySweptParameter(
  step: CompiledStep,
  paramType: string,
  value: number
): void {
  switch (paramType) {
    case 'volume':
      if (step.type === NodeType.INJECT) {
        step.params.targetVolumeMl = value;
        step.liquidChangeMl = value;
        step.name = `${step.name} (${value}ml)`;
      }
      break;
    case 'gasPumpPwm':
      if ([NodeType.ACQUIRE, NodeType.DRAIN, NodeType.PREHEAT, NodeType.WASH].includes(step.type)) {
        step.params.gasPumpPwm = value;
        step.name = `${step.name} (PWM${value}%)`;
      }
      break;
    case 'duration':
      if (step.type === NodeType.ACQUIRE || step.type === NodeType.PREHEAT) {
        step.params.durationS = value;
        step.estimatedDurationS = value;
        step.name = `${step.name} (${value}s)`;
      }
      break;
    case 'cycles':
      if (step.type === NodeType.ACQUIRE) {
        step.params.heaterCycles = value;
        step.estimatedDurationS = value * 20; // 假设每周期 20s
        step.name = `${step.name} (${value}周期)`;
      }
      break;
    case 'ratio':
      // 比例扫描在 yaml-converter 中特殊处理
      break;
  }
}
