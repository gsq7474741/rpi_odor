import YAML from 'js-yaml';
import { ExperimentNode, ExperimentEdge, NodeType, HANDLE_TYPES, PARAM_TYPE_BINDABLE_FIELDS, DEFAULT_PHASE_MAP } from './types';
import { CompiledStep, CompilationResult } from './compiler';

// =============== 编译警告系统 ===============

export interface CompileWarning {
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  nodeId?: string;
  nodeName?: string;
}

// 验证参数扫描节点的变量绑定
function validateParamSweepBindings(
  sweepNode: ExperimentNode,
  allNodes: ExperimentNode[],
  allEdges: ExperimentEdge[]
): CompileWarning[] {
  const warnings: CompileWarning[] = [];
  const data = sweepNode.data as Record<string, unknown>;
  const sweepName = String(data.name || '参数扫描');
  const paramType = data.paramType as keyof typeof PARAM_TYPE_BINDABLE_FIELDS;
  const targetNodeId = data.targetNodeId as string | undefined;
  
  // 收集扫描体节点
  const bodyNodes = collectLoopBodyNodesFlat(sweepNode.id, allNodes, allEdges);
  
  if (bodyNodes.length === 0) {
    warnings.push({
      code: 'E001',
      level: 'error',
      message: `参数扫描节点 [${sweepName}] 没有连接扫描体`,
      nodeId: sweepNode.id,
      nodeName: sweepName,
    });
    return warnings;
  }
  
  // 获取可绑定此参数类型的节点类型
  const bindableInfo = PARAM_TYPE_BINDABLE_FIELDS[paramType];
  if (!bindableInfo) {
    warnings.push({
      code: 'E002',
      level: 'error',
      message: `参数扫描节点 [${sweepName}] 的参数类型 "${paramType}" 无效`,
      nodeId: sweepNode.id,
      nodeName: sweepName,
    });
    return warnings;
  }
  
  // 查找扫描体内可绑定的节点
  const bindableNodes = bodyNodes.filter(n => 
    bindableInfo.nodeTypes.includes(n.type as NodeType)
  );
  
  if (bindableNodes.length === 0) {
    warnings.push({
      code: 'W001',
      level: 'warning',
      message: `参数扫描节点 [${sweepName}] 的扫描体内没有可绑定 "${bindableInfo.label}" 的节点`,
      nodeId: sweepNode.id,
      nodeName: sweepName,
    });
  } else if (bindableNodes.length > 1 && !targetNodeId) {
    // 多个可绑定节点但未指定目标
    const nodeNames = bindableNodes.map(n => {
      const d = n.data as Record<string, unknown>;
      return String(d.name || n.type);
    }).join(', ');
    
    warnings.push({
      code: 'W002',
      level: 'warning',
      message: `参数扫描节点 [${sweepName}] 的扫描体内有 ${bindableNodes.length} 个可绑定节点 (${nodeNames})，将全部应用参数`,
      nodeId: sweepNode.id,
      nodeName: sweepName,
    });
  } else if (targetNodeId) {
    // 检查指定的目标节点是否在扫描体内
    const targetInBody = bindableNodes.some(n => n.id === targetNodeId);
    if (!targetInBody) {
      warnings.push({
        code: 'E003',
        level: 'error',
        message: `参数扫描节点 [${sweepName}] 指定的目标节点不在扫描体内`,
        nodeId: sweepNode.id,
        nodeName: sweepName,
      });
    }
  }
  
  return warnings;
}

// 递归收集扫描体内的所有节点（包括嵌套循环内的）
function collectLoopBodyNodesFlat(
  loopNodeId: string,
  allNodes: ExperimentNode[],
  allEdges: ExperimentEdge[]
): ExperimentNode[] {
  const result: ExperimentNode[] = [];
  const directBody = collectLoopBodyNodes(loopNodeId, allNodes, allEdges);
  
  for (const node of directBody) {
    result.push(node);
    // 递归收集嵌套循环内的节点
    if (node.type === NodeType.PARAM_SWEEP || node.type === NodeType.LOOP) {
      const nested = collectLoopBodyNodesFlat(node.id, allNodes, allEdges);
      result.push(...nested);
    }
  }
  
  return result;
}

// 验证所有参数扫描节点
export function validateAllParamSweeps(
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): CompileWarning[] {
  const warnings: CompileWarning[] = [];
  
  const sweepNodes = nodes.filter(n => n.type === NodeType.PARAM_SWEEP);
  for (const sweepNode of sweepNodes) {
    const nodeWarnings = validateParamSweepBindings(sweepNode, nodes, edges);
    warnings.push(...nodeWarnings);
  }
  
  return warnings;
}

interface YamlStep {
  name: string;
  phase_name?: string;
  phase_marker?: {
    phase_name: string;
    is_start: boolean;
  };
  inject?: {
    components?: { liquid_id: string; ratio: number; is_solvent?: boolean }[];
    target_volume_ml?: number;
    target_weight_g?: number;
    tolerance?: number;
    flow_rate_ml_s?: number;  // ml/s
    stable_timeout_s?: number;  // 稳定超时
  };
  drain?: {
    gas_pump_pwm?: number;
    empty_tolerance_g?: number;
    stability_window_s?: number;
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
  pump_index?: number;  // [DEPRECATED] 运行时从数据库查询泵绑定
  type: string;
}

/**
 * 将编译器输出的 CompiledStep 转换为 YAML 步骤
 * 这是实现编译器和 YAML 生成器统一的核心函数
 */
export function compiledStepToYamlStep(step: CompiledStep): YamlStep | null {
  // 跳过非原子步骤（循环/扫描容器节点）
  if (!step.isAtomic) {
    return null;
  }

  const params = step.params;
  
  // 获取默认 phase_name（编译器自动填充）
  const defaultPhase = DEFAULT_PHASE_MAP[step.type];
  
  // 构建带循环路径前缀的名称
  let name = step.name;
  if (step.loopPath && step.loopPath.length > 0) {
    const prefix = step.loopPath
      .map(lp => `[${lp.loopName} #${lp.iteration}/${lp.total}]`)
      .join(' ');
    name = `${prefix} ${name}`;
  }

  switch (step.type) {
    case NodeType.PHASE_MARKER:
      return {
        name,
        phase_name: String(params.phaseName || 'SAMPLE'),
        phase_marker: {
          phase_name: String(params.phaseName || 'SAMPLE'),
          is_start: Boolean(params.isStart),
        },
      };

    case NodeType.INJECT: {
      // 从编译后的 components 获取液体配置（已包含扫描后的比例）
      const components = (params.components as Array<{
        liquidId: string;
        liquidName?: string;
        ratio: number;
        isSolvent?: boolean;
      }>) || [];
      
      const yamlComponents = components
        .filter(c => (c.ratio ?? 0) > 0)
        .map(c => {
          const yc: { liquid_id: string; ratio: number; is_solvent?: boolean } = {
            liquid_id: String(c.liquidId),
            ratio: Number(c.ratio ?? 1),
          };
          if (c.isSolvent) yc.is_solvent = true;
          return yc;
        });

      // 如果没有组件，使用默认配置
      if (yamlComponents.length === 0) {
        yamlComponents.push({ liquid_id: 'default', ratio: 1 });
      }

      const inject: Record<string, unknown> = {
        components: yamlComponents,
        tolerance: Number(params.tolerance ?? 3),
        flow_rate_ml_s: Number(params.flowRateMlS ?? 5),
        stable_timeout_s: Number(params.stableTimeoutS ?? 10),
      };

      if (params.targetType === 'weight') {
        inject.target_weight_g = Number(params.targetWeightG || 0);
      } else {
        inject.target_volume_ml = Number(params.targetVolumeMl ?? step.liquidChangeMl ?? 30);
      }

      return { name, ...(defaultPhase && { phase_name: defaultPhase }), inject };
    }

    case NodeType.DRAIN:
      return {
        name,
        ...(defaultPhase && { phase_name: defaultPhase }),
        drain: {
          gas_pump_pwm: Number(params.gasPumpPwm ?? 80),
          empty_tolerance_g: Number(params.emptyToleranceG ?? 10),
          stability_window_s: Number(params.stabilityWindowS ?? 2),
          timeout_s: Number(params.timeoutS ?? 60),
        },
      };

    case NodeType.WASH: {
      const washObj: Record<string, unknown> = {
        wash_liquid_id: String(params.washLiquidId || params.washLiquidName || 'distilled_water'),
        wash_volume_ml: Number(params.washVolumeMl ?? 20),
        repeat_count: Number(params.repeatCount ?? 2),
        gas_pump_pwm: Number(params.gasPumpPwm ?? 50),
        fill_timeout_s: Number(params.fillTimeoutS ?? 60),
        drain_timeout_s: Number(params.drainTimeoutS ?? 60),
        empty_tolerance_g: Number(params.emptyToleranceG ?? 10),
        empty_stability_window_s: Number(params.emptyStabilityWindowS ?? 2),
      };
      if (params.fillMode && params.fillMode !== 'weight') {
        washObj.fill_mode = String(params.fillMode);
      }
      return {
        name,
        ...(defaultPhase && { phase_name: defaultPhase }),
        wash: washObj,
      };
    }

    case NodeType.ACQUIRE: {
      const acquire: Record<string, unknown> = {
        gas_pump_pwm: Number(params.gasPumpPwm ?? 50),
      };

      const terminationType = params.terminationType as string;
      if (terminationType === 'duration') {
        acquire.duration_s = Number(params.durationS ?? 60);
      } else if (terminationType === 'cycles') {
        acquire.heater_cycles = Number(params.heaterCycles ?? 10);
        acquire.max_duration_s = Number(params.maxDurationS ?? 300);
      } else if (terminationType === 'stability') {
        acquire.stability = {
          window_s: Number(params.stabilityWindowS ?? 30),
          threshold_percent: Number(params.stabilityThresholdPercent ?? 5),
        };
        acquire.max_duration_s = Number(params.maxDurationS ?? 300);
      } else {
        acquire.max_duration_s = Number(params.maxDurationS ?? 300);
      }

      return { name, ...(defaultPhase && { phase_name: defaultPhase }), acquire };
    }

    case NodeType.WAIT_TIME:
      return {
        name,
        wait: {
          duration_s: Number(params.durationS ?? 60),
          timeout_s: Number(params.timeoutS ?? 120),
        },
      };

    case NodeType.WAIT_CYCLES:
      return {
        name,
        wait: {
          heater_cycles: Number(params.heaterCycles ?? 5),
          timeout_s: Number(params.timeoutS ?? 300),
        },
      };

    case NodeType.WAIT_STABILITY:
      return {
        name,
        wait: {
          stability: {
            window_s: Number(params.windowS ?? 30),
            threshold_percent: Number(params.thresholdPercent ?? 5),
          },
          timeout_s: Number(params.timeoutS ?? 300),
        },
      };

    case NodeType.SET_STATE:
      return {
        name,
        set_state: {
          state: String(params.state || 'STATE_INITIAL'),
        },
      };

    case NodeType.SET_GAS_PUMP:
      return {
        name,
        set_gas_pump: {
          pwm_percent: Number(params.pwmPercent ?? 0),
        },
      };

    case NodeType.PREHEAT: {
      const preheat: Record<string, unknown> = {
        max_duration_s: Number(params.maxDurationS ?? 120),
        record_data: Boolean(params.recordData ?? false),
        gas_pump_pwm: Number(params.gasPumpPwm ?? 50),
      };

      // 预热模式
      if (params.mode === 'cycles') {
        preheat.cycles = Number(params.cycles ?? 5);
      } else if (params.mode === 'stability') {
        preheat.stability = {
          window_s: Number(params.stabilityWindowS ?? 30),
          threshold_percent: Number(params.stabilityThresholdPercent ?? 5),
        };
      } else {
        preheat.duration_s = Number(params.durationS ?? 60);
      }

      // 目标传感器
      const sensorIndices = params.sensorIndices as number[] | undefined;
      if (sensorIndices && sensorIndices.length > 0) {
        preheat.sensor_indices = sensorIndices;
      }

      return { name, ...(defaultPhase && { phase_name: defaultPhase }), preheat };
    }

    case NodeType.CONFIGURE_HEATER: {
      const configs = (params.configs as Array<{
        profileName?: string;
        temps?: number[];
        durs?: number[];
        sensorIndices?: number[];
      }>) || [];

      return {
        name,
        configure_heater: {
          configs: configs.map(c => ({
            profile_name: c.profileName || '',
            temps: c.temps || [],
            durs: c.durs || [],
            sensor_indices: c.sensorIndices || [],
          })),
        },
      };
    }

    default:
      // 未知类型，跳过
      return null;
  }
}

/**
 * 将编译器输出的步骤数组转换为 YAML 步骤数组
 */
export function compiledStepsToYamlSteps(steps: CompiledStep[]): YamlStep[] {
  return steps
    .map(step => compiledStepToYamlStep(step))
    .filter((step): step is YamlStep => step !== null);
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

// 编译估算信息 (YAML 输出)
interface YamlCompileEstimate {
  total_duration_s: number;
  peak_liquid_level_ml: number;
  peak_liquid_level_ml_with_wash: number;
  total_inject_ml: number;
  total_drain_ml: number;
  total_wash_volume_ml: number;
  liquid_consumption: Array<{
    liquid_id: string;
    liquid_name: string;
    pump_index: number;
    required_ml: number;
  }>;
  pump_estimates: Array<{
    pump_index: number;
    volume_ml: number;
    runtime_s: number;
  }>;
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
  _compile_estimate?: YamlCompileEstimate;
  _editor_layout?: EditorLayout;
}

/**
 * 从编译结果生成 YAML
 * 统一架构：YAML 生成基于编译器输出，确保 UI 显示和导出一致
 */
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
  },
  compilationResult?: CompilationResult  // 使用编译器的完整输出
): string {
  // 收集液体源节点信息（样品液体）
  const liquidSources = nodes.filter((n) => n.type === NodeType.LIQUID_SOURCE);
  const liquids: YamlLiquid[] = liquidSources.map((n) => {
    const data = n.data as Record<string, unknown>;
    // 注意: pump_index 已废弃，不再输出到 YAML
    // 泵绑定在耗材管理中配置，运行时从数据库查询
    return {
      id: String(data.liquidId || `liquid_${n.id}`),
      name: String(data.liquidName || '未命名'),
      type: 'LIQUID_SAMPLE',
    };
  });

  // 收集清洗节点使用的清洗液（去重）
  const washNodes = nodes.filter((n) => n.type === NodeType.WASH);
  const washLiquidIds = new Set<string>();
  for (const washNode of washNodes) {
    const data = washNode.data as Record<string, unknown>;
    const washLiquidId = String(data.washLiquidId || 'distilled_water');
    if (washLiquidId && !washLiquidIds.has(washLiquidId)) {
      washLiquidIds.add(washLiquidId);
      // 检查是否已在样品液体列表中
      const existsInSamples = liquids.some(l => l.id === washLiquidId);
      if (!existsInSamples) {
        liquids.push({
          id: washLiquidId,
          name: String(data.washLiquidName || `清洗液 ${washLiquidId}`),
          type: 'LIQUID_RINSE',
        });
      }
    }
  }

  // 从编译结果生成 YAML 步骤（统一架构的核心）
  const steps: YamlStep[] = compilationResult 
    ? compiledStepsToYamlSteps(compilationResult.steps)
    : [];

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

  // 构建编译估算 (snake_case for YAML)
  const yamlCompileEstimate: YamlCompileEstimate | undefined = compilationResult ? {
    total_duration_s: compilationResult.totalDurationS,
    peak_liquid_level_ml: compilationResult.peakLiquidLevelMl,
    peak_liquid_level_ml_with_wash: compilationResult.peakLiquidLevelMlWithWash,
    total_inject_ml: compilationResult.totalInjectMl,
    total_drain_ml: compilationResult.totalDrainMl,
    total_wash_volume_ml: compilationResult.totalWashVolumeMl,
    liquid_consumption: compilationResult.liquidConsumption.map(lc => ({
      liquid_id: lc.liquidId,
      liquid_name: lc.liquidName,
      pump_index: lc.pumpIndex,
      required_ml: lc.requiredMl,
    })),
    pump_estimates: compilationResult.pumpEstimates.map(pe => ({
      pump_index: pe.pumpIndex,
      volume_ml: pe.volumeMl,
      runtime_s: pe.runtimeS,
    })),
  } : undefined;

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
        { id: 'default', name: '默认液体', type: 'LIQUID_SAMPLE' }
      ],
    },
    steps,
    _compile_estimate: yamlCompileEstimate,
    _editor_layout: editorLayout,
  };

  return YAML.dump(program, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
}

// 收集扫描体/循环体节点 (从 loopBody 输出边开始，沿 flow 边遍历)
// 注意：遇到嵌套的 PARAM_SWEEP/LOOP 时，只收集该节点本身，不深入其内部
function collectLoopBodyNodes(
  loopNodeId: string,
  allNodes: ExperimentNode[],
  allEdges: ExperimentEdge[]
): ExperimentNode[] {
  const bodyNodes: ExperimentNode[] = [];
  
  // 找到循环体输出边 (从节点的 loopBody handle 出发)
  const loopBodyOutEdge = allEdges.find(
    e => e.source === loopNodeId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
  );
  
  if (!loopBodyOutEdge) {
    return bodyNodes;
  }
  
  // 从循环体第一个节点开始，沿着 flow 边遍历
  let currentId: string | undefined = loopBodyOutEdge.target;
  const visitedInLoop = new Set<string>();
  
  // 构建 flow 邻接表
  const flowAdjacency = new Map<string, string>();
  for (const edge of allEdges) {
    if (edge.sourceHandle === HANDLE_TYPES.FLOW || !edge.sourceHandle) {
      flowAdjacency.set(edge.source, edge.target);
    }
  }
  
  while (currentId && !visitedInLoop.has(currentId)) {
    visitedInLoop.add(currentId);
    const bodyNode = allNodes.find(n => n.id === currentId);
    if (!bodyNode) break;
    
    bodyNodes.push(bodyNode);
    
    // 检查是否是循环体返回边的源节点
    const isLoopBodyReturn = allEdges.some(
      e => e.source === currentId && 
           e.target === loopNodeId && 
           e.targetHandle === HANDLE_TYPES.LOOP_BODY
    );
    
    if (isLoopBodyReturn) break;
    
    // 如果是嵌套的 LOOP/PARAM_SWEEP，跳过其内部，从其 flow 输出继续
    // 嵌套节点的 flow 输出会连接到父级循环体的返回点或下一个节点
    currentId = flowAdjacency.get(currentId);
  }
  
  return bodyNodes;
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
    [NodeType.PREHEAT]: '传感器预热',
    [NodeType.CONFIGURE_HEATER]: '配置加热器',
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

  // 创建开始节点 (programId 和 programName 由文件名决定，不存储在节点中)
  const startId = generateId();
  nodes.push({
    id: startId,
    type: NodeType.START,
    position: { x: 250, y: 50 },
    data: {
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
        flowRateMlS: step.inject.flow_rate_ml_s,
        stableTimeoutS: step.inject.stable_timeout_s,
      },
    };
  }

  if (step.drain) {
    return {
      type: NodeType.DRAIN,
      data: {
        name: step.name,
        gasPumpPwm: step.drain.gas_pump_pwm,
        emptyToleranceG: step.drain.empty_tolerance_g,
        stabilityWindowS: step.drain.stability_window_s,
        timeoutS: step.drain.timeout_s,
      },
    };
  }

  if ((step as Record<string, unknown>).wash) {
    const wash = (step as Record<string, unknown>).wash as Record<string, unknown>;
    return {
      type: NodeType.WASH,
      data: {
        name: step.name,
        washLiquidId: wash.wash_liquid_id,
        washVolumeMl: wash.wash_volume_ml,
        repeatCount: wash.repeat_count,
        gasPumpPwm: wash.gas_pump_pwm,
        fillMode: wash.fill_mode || 'weight',
        fillTimeoutS: wash.fill_timeout_s,
        drainTimeoutS: wash.drain_timeout_s,
        emptyToleranceG: wash.empty_tolerance_g,
        emptyStabilityWindowS: wash.empty_stability_window_s,
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
        stabilityWindowS: step.acquire.stability?.window_s,
        stabilityThresholdPercent: step.acquire.stability?.threshold_percent,
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

  // 预热动作
  const preheat = (step as Record<string, unknown>).preheat as Record<string, unknown> | undefined;
  if (preheat) {
    return {
      type: NodeType.PREHEAT,
      data: {
        name: step.name,
        mode: preheat.cycles ? 'cycles' : preheat.stability ? 'stability' : 'duration',
        cycles: preheat.cycles,
        durationS: preheat.duration_s,
        stabilityWindowS: (preheat.stability as Record<string, unknown>)?.window_s,
        stabilityThresholdPercent: (preheat.stability as Record<string, unknown>)?.threshold_percent,
        maxDurationS: preheat.max_duration_s || 120,
        sensorIndices: preheat.sensor_indices || [],
        recordData: preheat.record_data ?? false,
        gasPumpPwm: preheat.gas_pump_pwm || 50,
      },
    };
  }

  // 配置加热器动作
  const configureHeater = (step as Record<string, unknown>).configure_heater as Record<string, unknown> | undefined;
  if (configureHeater) {
    const configs = (configureHeater.configs as Array<Record<string, unknown>>) || [];
    return {
      type: NodeType.CONFIGURE_HEATER,
      data: {
        name: step.name,
        configs: configs.map(c => ({
          profileName: c.profile_name || '',
          temps: c.temps || [],
          durs: c.durs || [],
          sensorIndices: c.sensor_indices || [],
        })),
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

  // 收集所有节点 ID，用于清理残留的 boundVariables 引用
  const allNodeIds = new Set(layout.nodes.map(n => n.id));

  // 从布局信息恢复节点（直接使用保存的 data）
  const nodes: ExperimentNode[] = layout.nodes.map(n => {
    const data = n.data || getNodeDataFromProgram(n.id, n.type as NodeType, program);
    // 清理引用已删除节点的 boundVariables
    const bound = data?.boundVariables as Record<string, string> | undefined;
    if (bound) {
      const cleaned: Record<string, string> = {};
      let changed = false;
      for (const [field, sweepId] of Object.entries(bound)) {
        if (allNodeIds.has(sweepId)) {
          cleaned[field] = sweepId;
        } else {
          changed = true;
        }
      }
      if (changed) {
        return {
          id: n.id,
          type: n.type as NodeType,
          position: n.position,
          data: { ...data, boundVariables: Object.keys(cleaned).length > 0 ? cleaned : undefined },
        };
      }
    }
    return {
      id: n.id,
      type: n.type as NodeType,
      position: n.position,
      data,
    };
  });

  // 从布局信息恢复边（根据类型设置样式）
  const edges: ExperimentEdge[] = layout.edges.map(e => {
    const isLiquid = e.sourceHandle === HANDLE_TYPES.LIQUID;
    const isLoopBody = e.sourceHandle === HANDLE_TYPES.LOOP_BODY || e.targetHandle === HANDLE_TYPES.LOOP_BODY;
    
    let style: React.CSSProperties | undefined;
    if (isLiquid) {
      style = { stroke: '#22c55e', strokeDasharray: '5,5' };
    } else if (isLoopBody) {
      style = { stroke: '#f59e0b', strokeDasharray: '5,5' };
    }
    
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'smoothstep',
      animated: isLiquid || isLoopBody,
      style,
    };
  });

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
