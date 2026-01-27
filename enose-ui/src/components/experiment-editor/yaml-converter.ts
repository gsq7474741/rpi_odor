import YAML from 'js-yaml';
import { ExperimentNode, ExperimentEdge, NodeType, HANDLE_TYPES } from './types';

interface YamlStep {
  name: string;
  phase_marker?: {
    phase_name: string;
    is_start: boolean;
  };
  inject?: {
    components?: { liquid_id: string; ratio: number }[];
    target_volume_ml?: number;
    target_weight_g?: number;
    tolerance?: number;
    flow_rate_ml_min?: number;
  };
  drain?: {
    gas_pump_pwm?: number;
    timeout_s?: number;
  };
  acquire?: {
    gas_pump_pwm?: number;
    duration_s?: number;
    heater_cycles?: number;
    stability?: { window_s: number; threshold_percent: number };
    max_duration_s?: number;
  };
  wait?: {
    duration_s?: number;
    heater_cycles?: number;
    stability?: { window_s: number; threshold_percent: number };
    timeout_s?: number;
  };
  set_state?: {
    state: string;
  };
  set_gas_pump?: {
    pwm_percent: number;
  };
  loop?: {
    count: number;
    steps?: YamlStep[];
  };
  [key: string]: unknown;
}

interface YamlLiquid {
  id: string;
  name: string;
  pump_index: number;
  type: string;
}

interface EditorLayout {
  nodes: {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>; // 保存节点的完整数据
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }[];
}

interface YamlProgram {
  id: string;
  name: string;
  description: string;
  version: string;
  hardware: {
    bottle_capacity_ml: number;
    max_fill_ml: number;
    liquids: YamlLiquid[];
  };
  steps: YamlStep[];
  _editor_layout?: EditorLayout;
}

export function graphToYaml(
  nodes: ExperimentNode[],
  edges: ExperimentEdge[],
  programMeta: {
    programId: string;
    programName: string;
    programDescription: string;
    programVersion: string;
    bottleCapacityMl: number;
    maxFillMl: number;
  }
): string {
  // 找到开始节点
  const startNode = nodes.find((n) => n.type === NodeType.START);
  if (!startNode) {
    throw new Error('缺少开始节点');
  }

  // 找到结束节点
  const endNode = nodes.find((n) => n.type === NodeType.END);
  if (!endNode) {
    throw new Error('缺少结束节点');
  }

  // 构建邻接表（flow 连接）
  const flowEdges = edges.filter(
    (e) => e.sourceHandle === HANDLE_TYPES.FLOW || !e.sourceHandle
  );
  const adjacency = new Map<string, string>();
  for (const edge of flowEdges) {
    adjacency.set(edge.source, edge.target);
  }

  // 构建液体连接（liquid 连接）
  const liquidEdges = edges.filter((e) => e.sourceHandle === HANDLE_TYPES.LIQUID);
  const liquidConnections = new Map<string, string[]>();
  for (const edge of liquidEdges) {
    const existing = liquidConnections.get(edge.target) || [];
    existing.push(edge.source);
    liquidConnections.set(edge.target, existing);
  }

  // 收集液体源节点信息
  const liquidSources = nodes.filter((n) => n.type === NodeType.LIQUID_SOURCE);
  const liquids: YamlLiquid[] = liquidSources.map((n) => {
    const data = n.data as Record<string, unknown>;
    return {
      id: String(data.liquidId || `liquid_${n.id}`),
      name: String(data.liquidName || '未命名'),
      pump_index: Number(data.pumpIndex || 0),
      type: 'LIQUID_SAMPLE',
    };
  });

  // 拓扑排序获取步骤顺序
  const steps: YamlStep[] = [];
  let currentId: string | undefined = startNode.id;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.find((n) => n.id === currentId);
    if (!node) break;

    // 跳过开始和结束节点
    if (node.type !== NodeType.START && node.type !== NodeType.END) {
      const step = nodeToStep(node, liquidConnections, nodes, edges);
      if (step) {
        steps.push(step);
      }
    }

    currentId = adjacency.get(currentId);
  }

  // 构建编辑器布局信息（包含完整节点数据）
  const editorLayout: EditorLayout = {
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type as string,
      position: n.position,
      data: n.data as Record<string, unknown>,
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
      targetHandle: e.targetHandle || undefined,
    })),
  };

  // 构建 YAML 程序
  const program: YamlProgram = {
    id: programMeta.programId,
    name: programMeta.programName,
    description: programMeta.programDescription,
    version: programMeta.programVersion,
    hardware: {
      bottle_capacity_ml: programMeta.bottleCapacityMl,
      max_fill_ml: programMeta.maxFillMl,
      liquids: liquids.length > 0 ? liquids : [
        { id: 'default', name: '默认液体', pump_index: 2, type: 'LIQUID_SAMPLE' }
      ],
    },
    steps,
    _editor_layout: editorLayout,
  };

  return YAML.dump(program, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
}

function nodeToStep(
  node: ExperimentNode,
  liquidConnections: Map<string, string[]>,
  allNodes: ExperimentNode[],
  allEdges: ExperimentEdge[] = []
): YamlStep | null {
  const data = node.data as Record<string, unknown>;
  const name = String(data.name || getDefaultName(node.type as NodeType));

  switch (node.type) {
    case NodeType.PHASE_MARKER:
      return {
        name,
        phase_marker: {
          phase_name: String(data.phaseName || 'SAMPLE'),
          is_start: Boolean(data.isStart),
        },
      };

    case NodeType.INJECT: {
      // 获取连接的液体源
      const connectedLiquidIds = liquidConnections.get(node.id) || [];
      const components = connectedLiquidIds.map((liquidNodeId) => {
        const liquidNode = allNodes.find((n) => n.id === liquidNodeId);
        if (!liquidNode) return null;
        const liquidData = liquidNode.data as Record<string, unknown>;
        return {
          liquid_id: String(liquidData.liquidId || `liquid_${liquidNodeId}`),
          ratio: Number(liquidData.ratio || 1),
        };
      }).filter(Boolean);

      // 如果没有连接液体，使用默认配置
      if (components.length === 0) {
        components.push({ liquid_id: 'default', ratio: 1 });
      }

      const inject: Record<string, unknown> = {
        components,
        tolerance: Number(data.tolerance || 0.5),
        flow_rate_ml_min: Number(data.flowRateMlMin || 5),
      };

      if (data.targetType === 'weight') {
        inject.target_weight_g = Number(data.targetWeightG || 0);
      } else {
        inject.target_volume_ml = Number(data.targetVolumeMl || 15);
      }

      return { name, inject };
    }

    case NodeType.DRAIN:
      return {
        name,
        drain: {
          gas_pump_pwm: Number(data.gasPumpPwm || 80),
          timeout_s: Number(data.timeoutS || 60),
        },
      };

    case NodeType.ACQUIRE: {
      const acquire: Record<string, unknown> = {
        gas_pump_pwm: Number(data.gasPumpPwm || 50),
        max_duration_s: Number(data.maxDurationS || 300),
      };

      if (data.terminationType === 'duration') {
        acquire.duration_s = Number(data.durationS || 60);
      } else if (data.terminationType === 'cycles') {
        acquire.heater_cycles = Number(data.heaterCycles || 10);
      }

      return { name, acquire };
    }

    case NodeType.WAIT_TIME:
      return {
        name,
        wait: {
          duration_s: Number(data.durationS || 60),
          timeout_s: Number(data.timeoutS || 120),
        },
      };

    case NodeType.WAIT_CYCLES:
      return {
        name,
        wait: {
          heater_cycles: Number(data.heaterCycles || 5),
          timeout_s: Number(data.timeoutS || 300),
        },
      };

    case NodeType.WAIT_STABILITY:
      return {
        name,
        wait: {
          stability: {
            window_s: Number(data.windowS || 30),
            threshold_percent: Number(data.thresholdPercent || 5),
          },
          timeout_s: Number(data.timeoutS || 300),
        },
      };

    case NodeType.SET_STATE:
      return {
        name,
        set_state: {
          state: String(data.state || 'STATE_INITIAL'),
        },
      };

    case NodeType.SET_GAS_PUMP:
      return {
        name,
        set_gas_pump: {
          pwm_percent: Number(data.pwmPercent || 0),
        },
      };

    case NodeType.LOOP: {
      // 收集循环体节点
      const loopBodySteps: YamlStep[] = [];
      
      // 找到循环体输出边 (从 Loop 节点的 loopBody handle 出发)
      const loopBodyOutEdge = allEdges.find(
        e => e.source === node.id && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
      );
      
      if (loopBodyOutEdge) {
        // 从循环体第一个节点开始，沿着 flow 边遍历直到回到 Loop 节点
        let currentId: string | undefined = loopBodyOutEdge.target;
        const visitedInLoop = new Set<string>();
        
        // 构建循环体内的 flow 邻接表
        const flowEdgesInBody = allEdges.filter(
          e => e.sourceHandle === HANDLE_TYPES.FLOW || !e.sourceHandle
        );
        const bodyAdjacency = new Map<string, string>();
        for (const edge of flowEdgesInBody) {
          bodyAdjacency.set(edge.source, edge.target);
        }
        
        while (currentId && !visitedInLoop.has(currentId)) {
          visitedInLoop.add(currentId);
          const bodyNode = allNodes.find(n => n.id === currentId);
          if (!bodyNode) break;
          
          // 检查是否是循环体返回边的源节点（即循环体最后一个节点）
          const isLoopBodyReturn = allEdges.some(
            e => e.source === currentId && 
                 e.target === node.id && 
                 e.targetHandle === HANDLE_TYPES.LOOP_BODY
          );
          
          // 转换节点为步骤
          const bodyStep = nodeToStep(bodyNode, liquidConnections, allNodes, allEdges);
          if (bodyStep) {
            loopBodySteps.push(bodyStep);
          }
          
          // 如果是循环体最后一个节点，停止遍历
          if (isLoopBodyReturn) break;
          
          // 继续沿着 flow 边遍历
          currentId = bodyAdjacency.get(currentId);
        }
      }
      
      return {
        name,
        loop: {
          count: Number(data.count || 1),
          steps: loopBodySteps,
        },
      };
    }

    default:
      return null;
  }
}

function getDefaultName(nodeType: NodeType): string {
  const names: Record<NodeType, string> = {
    [NodeType.START]: '开始',
    [NodeType.END]: '结束',
    [NodeType.LOOP]: '循环',
    [NodeType.PHASE_MARKER]: '阶段标记',
    [NodeType.INJECT]: '进样',
    [NodeType.DRAIN]: '排废',
    [NodeType.WASH]: '清洗',
    [NodeType.LIQUID_SOURCE]: '液体源',
    [NodeType.PARAM_SWEEP]: '参数扫描',
    [NodeType.ACQUIRE]: '数据采集',
    [NodeType.WAIT_TIME]: '等待',
    [NodeType.WAIT_CYCLES]: '等待周期',
    [NodeType.WAIT_STABILITY]: '等待稳定',
    [NodeType.SET_STATE]: '设置状态',
    [NodeType.SET_GAS_PUMP]: '设置气泵',
    [NodeType.HARDWARE_CONFIG]: '硬件配置',
  };
  return names[nodeType] || '未知步骤';
}

// YAML → Graph 转换（用于加载现有程序）
export function yamlToGraph(yamlContent: string): {
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
} {
  const program = YAML.load(yamlContent) as YamlProgram;
  
  // 如果有编辑器布局信息，直接使用
  if (program._editor_layout) {
    return yamlToGraphWithLayout(program);
  }
  
  // 否则使用传统方式生成布局
  const nodes: ExperimentNode[] = [];
  const edges: ExperimentEdge[] = [];
  let nodeIdCounter = 0;
  const generateId = () => `node_${++nodeIdCounter}`;
  
  // 程序元数据
  const programMeta = {
    programId: program.id || 'imported_program',
    programName: program.name || '导入的程序',
    programDescription: program.description || '',
    programVersion: program.version || '1.0.0',
    bottleCapacityMl: program.hardware?.bottle_capacity_ml || 150,
    maxFillMl: program.hardware?.max_fill_ml || 100,
  };

  // 创建开始节点
  const startId = generateId();
  nodes.push({
    id: startId,
    type: NodeType.START,
    position: { x: 250, y: 50 },
    data: {
      programId: programMeta.programId,
      programName: programMeta.programName,
      description: programMeta.programDescription,
      version: programMeta.programVersion,
    },
  });

  // 创建液体源节点
  const liquidNodeMap = new Map<string, string>();
  if (program.hardware?.liquids) {
    program.hardware.liquids.forEach((liquid, index) => {
      const liquidId = generateId();
      liquidNodeMap.set(liquid.id, liquidId);
      nodes.push({
        id: liquidId,
        type: NodeType.LIQUID_SOURCE,
        position: { x: 50, y: 150 + index * 100 },
        data: {
          liquidId: liquid.id,
          liquidName: liquid.name,
          pumpIndex: liquid.pump_index,
          ratio: 1,
        },
      });
    });
  }

  // 转换步骤
  let prevNodeId = startId;
  let yPos = 150;
  
  for (const step of program.steps || []) {
    const nodeId = generateId();
    const { type, data } = stepToNodeData(step);
    
    nodes.push({
      id: nodeId,
      type,
      position: { x: 250, y: yPos },
      data,
    });

    // 创建 flow 边
    edges.push({
      id: `edge_${prevNodeId}_${nodeId}`,
      source: prevNodeId,
      target: nodeId,
      sourceHandle: HANDLE_TYPES.FLOW,
      targetHandle: HANDLE_TYPES.FLOW,
      type: 'smoothstep',
    });

    // 如果是进样节点，连接液体源
    if (type === NodeType.INJECT && step.inject?.components) {
      for (const comp of step.inject.components) {
        const liquidNodeId = liquidNodeMap.get(comp.liquid_id);
        if (liquidNodeId) {
          edges.push({
            id: `edge_liquid_${liquidNodeId}_${nodeId}`,
            source: liquidNodeId,
            target: nodeId,
            sourceHandle: HANDLE_TYPES.LIQUID,
            targetHandle: HANDLE_TYPES.LIQUID,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#22c55e', strokeDasharray: '5,5' },
          });
        }
      }
    }

    prevNodeId = nodeId;
    yPos += 100;
  }

  // 创建结束节点
  const endId = generateId();
  nodes.push({
    id: endId,
    type: NodeType.END,
    position: { x: 250, y: yPos },
    data: {},
  });

  edges.push({
    id: `edge_${prevNodeId}_${endId}`,
    source: prevNodeId,
    target: endId,
    sourceHandle: HANDLE_TYPES.FLOW,
    targetHandle: HANDLE_TYPES.FLOW,
    type: 'smoothstep',
  });

  return { nodes, edges, programMeta };
}

function stepToNodeData(step: YamlStep): { type: NodeType; data: Record<string, unknown> } {
  if (step.phase_marker) {
    return {
      type: NodeType.PHASE_MARKER,
      data: {
        name: step.name,
        phaseName: step.phase_marker.phase_name,
        isStart: step.phase_marker.is_start,
      },
    };
  }

  if (step.inject) {
    return {
      type: NodeType.INJECT,
      data: {
        name: step.name,
        targetType: step.inject.target_weight_g ? 'weight' : 'volume',
        targetVolumeMl: step.inject.target_volume_ml,
        targetWeightG: step.inject.target_weight_g,
        tolerance: step.inject.tolerance,
        flowRateMlMin: step.inject.flow_rate_ml_min,
      },
    };
  }

  if (step.drain) {
    return {
      type: NodeType.DRAIN,
      data: {
        name: step.name,
        gasPumpPwm: step.drain.gas_pump_pwm,
        timeoutS: step.drain.timeout_s,
      },
    };
  }

  if (step.acquire) {
    let terminationType = 'cycles';
    if (step.acquire.duration_s) terminationType = 'duration';
    if (step.acquire.stability) terminationType = 'stability';
    
    return {
      type: NodeType.ACQUIRE,
      data: {
        name: step.name,
        gasPumpPwm: step.acquire.gas_pump_pwm,
        terminationType,
        durationS: step.acquire.duration_s,
        heaterCycles: step.acquire.heater_cycles,
        maxDurationS: step.acquire.max_duration_s,
      },
    };
  }

  if (step.wait) {
    if (step.wait.heater_cycles) {
      return {
        type: NodeType.WAIT_CYCLES,
        data: {
          name: step.name,
          heaterCycles: step.wait.heater_cycles,
          timeoutS: step.wait.timeout_s,
        },
      };
    }
    if (step.wait.stability) {
      return {
        type: NodeType.WAIT_STABILITY,
        data: {
          name: step.name,
          windowS: step.wait.stability.window_s,
          thresholdPercent: step.wait.stability.threshold_percent,
          timeoutS: step.wait.timeout_s,
        },
      };
    }
    return {
      type: NodeType.WAIT_TIME,
      data: {
        name: step.name,
        durationS: step.wait.duration_s,
        timeoutS: step.wait.timeout_s,
      },
    };
  }

  if (step.set_state) {
    return {
      type: NodeType.SET_STATE,
      data: {
        name: step.name,
        state: step.set_state.state,
      },
    };
  }

  if (step.set_gas_pump) {
    return {
      type: NodeType.SET_GAS_PUMP,
      data: {
        name: step.name,
        pwmPercent: step.set_gas_pump.pwm_percent,
      },
    };
  }

  if (step.loop) {
    return {
      type: NodeType.LOOP,
      data: {
        name: step.name,
        count: step.loop.count,
      },
    };
  }

  // 默认返回等待节点
  return {
    type: NodeType.WAIT_TIME,
    data: { name: step.name, durationS: 60, timeoutS: 120 },
  };
}

// 从编辑器布局信息恢复节点图
function yamlToGraphWithLayout(program: YamlProgram): {
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
} {
  const layout = program._editor_layout!;
  
  // 程序元数据
  const programMeta = {
    programId: program.id || 'imported_program',
    programName: program.name || '导入的程序',
    programDescription: program.description || '',
    programVersion: program.version || '1.0.0',
    bottleCapacityMl: program.hardware?.bottle_capacity_ml || 150,
    maxFillMl: program.hardware?.max_fill_ml || 100,
  };

  // 从布局信息恢复节点（直接使用保存的 data）
  const nodes: ExperimentNode[] = layout.nodes.map(n => ({
    id: n.id,
    type: n.type as NodeType,
    position: n.position,
    // 优先使用布局中保存的完整数据，如果没有则回退到从程序中解析
    data: n.data || getNodeDataFromProgram(n.id, n.type as NodeType, program),
  }));

  // 从布局信息恢复边
  const edges: ExperimentEdge[] = layout.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'smoothstep',
    animated: e.sourceHandle === HANDLE_TYPES.LIQUID,
    style: e.sourceHandle === HANDLE_TYPES.LIQUID 
      ? { stroke: '#22c55e', strokeDasharray: '5,5' }
      : undefined,
  }));

  return { nodes, edges, programMeta };
}

// 根据节点ID和类型从程序中获取节点数据
function getNodeDataFromProgram(
  nodeId: string,
  nodeType: NodeType,
  program: YamlProgram
): Record<string, unknown> {
  switch (nodeType) {
    case NodeType.START:
      return {
        programId: program.id,
        programName: program.name,
        description: program.description,
        version: program.version,
      };
    case NodeType.END:
      return {};
    case NodeType.HARDWARE_CONFIG:
      return {
        bottleCapacityMl: program.hardware?.bottle_capacity_ml || 150,
        maxFillMl: program.hardware?.max_fill_ml || 100,
      };
    case NodeType.LIQUID_SOURCE: {
      // 尝试从liquid ID中提取信息
      const liquidIdMatch = nodeId.match(/liquid_(.+)/);
      if (liquidIdMatch) {
        const liquid = program.hardware?.liquids?.find(l => l.id === liquidIdMatch[1]);
        if (liquid) {
          return {
            liquidId: liquid.id,
            liquidName: liquid.name,
            ratio: 1,
          };
        }
      }
      return { liquidId: '', liquidName: '', ratio: 1 };
    }
    default:
      // 对于步骤节点，需要从steps中查找
      // 由于布局信息中没有直接映射到步骤，返回默认数据
      return { name: getDefaultName(nodeType) };
  }
}
