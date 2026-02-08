'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useEditorStore } from '../store';
import { NodeType, NODE_META, PARAM_TYPE_BINDABLE_FIELDS, ParamSweepNodeData, HANDLE_TYPES, ExperimentNode, ExperimentEdge } from '../types';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Trash2, Wand2 } from 'lucide-react';
import { LiquidItem, PumpAssignment, fetchLiquids, fetchPumpAssignments } from '../data-fetcher';

// 导入节点字段组件
import { 
  StartNodeFields, 
  LoopNodeFields, 
  PhaseMarkerFields,
  InjectNodeFields,
  DrainNodeFields,
  LiquidSourceFields,
  WashNodeFields,
  ParamSweepFields,
  AcquireNodeFields,
  WaitTimeFields,
  WaitCyclesFields,
  WaitStabilityFields,
  SetStateFields,
  SetGasPumpFields,
  HardwareConfigFields,
  PreheatNodeFields,
  ConfigureHeaterFields,
} from './node-fields';

// 查找包含指定节点的所有父级扫描节点
function findParentSweepNodes(
  nodeId: string,
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): Array<{ id: string; name: string; paramType: string; variableName: string }> {
  const parentSweeps: Array<{ id: string; name: string; paramType: string; variableName: string }> = [];
  const sweepNodes = nodes.filter(n => n.type === NodeType.PARAM_SWEEP);
  
  for (const sweepNode of sweepNodes) {
    if (isNodeInSweepBody(nodeId, sweepNode.id, nodes, edges)) {
      const data = sweepNode.data as unknown as ParamSweepNodeData;
      parentSweeps.push({
        id: sweepNode.id,
        name: data.name || '参数扫描',
        paramType: data.paramType || 'volume',
        variableName: data.variableName || `${data.name || '扫描'}.${data.paramType || 'value'}`,
      });
    }
  }
  
  return parentSweeps;
}

// 检查节点是否在扫描体内
function isNodeInSweepBody(
  nodeId: string,
  sweepNodeId: string,
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): boolean {
  const bodyStartEdge = edges.find(e => e.source === sweepNodeId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY);
  if (!bodyStartEdge) return false;
  
  const flowEdges = edges.filter(e => !e.sourceHandle || e.sourceHandle === HANDLE_TYPES.FLOW);
  const visited = new Set<string>();
  const queue: string[] = [bodyStartEdge.target];
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    
    if (currentId === nodeId) return true;
    
    const currentNode = nodes.find(n => n.id === currentId);
    if (currentNode?.type === NodeType.PARAM_SWEEP || currentNode?.type === NodeType.LOOP) {
      const nestedBodyEdge = edges.find(e => e.source === currentId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY);
      if (nestedBodyEdge) {
        queue.push(nestedBodyEdge.target);
      }
    }
    
    const returnEdge = edges.find(e => 
      e.source === currentId && 
      e.targetHandle === HANDLE_TYPES.LOOP_BODY && 
      e.target === sweepNodeId
    );
    if (returnEdge) continue;
    
    const nextEdge = flowEdges.find(e => e.source === currentId);
    if (nextEdge) queue.push(nextEdge.target);
  }
  
  return false;
}

export function PropertyPanel() {
  const { nodes, edges, selectedNodeId, updateNodeData, deleteNode } = useEditorStore();
  
  // 外部数据状态
  const [liquids, setLiquids] = useState<LiquidItem[]>([]);
  const [pumpAssignments, setPumpAssignments] = useState<PumpAssignment[]>([]);
  const [loadingLiquids, setLoadingLiquids] = useState(false);
  
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const nodeType = selectedNode?.type as NodeType | undefined;
  
  // 查找当前节点所在的扫描体
  const parentSweeps = useMemo(() => {
    if (!selectedNode) return [];
    return findParentSweepNodes(selectedNode.id, nodes, edges);
  }, [selectedNode, nodes, edges]);
  
  // 检查当前节点类型是否可以绑定扫描变量
  const bindableFields = useMemo(() => {
    if (!nodeType) return [];
    const fields: Array<{ sweepId: string; sweepName: string; paramType: string; variableName: string; field: string; label: string }> = [];
    for (const sweep of parentSweeps) {
      const binding = PARAM_TYPE_BINDABLE_FIELDS[sweep.paramType as keyof typeof PARAM_TYPE_BINDABLE_FIELDS];
      if (binding && binding.nodeTypes.includes(nodeType)) {
        fields.push({
          sweepId: sweep.id,
          sweepName: sweep.name,
          paramType: sweep.paramType,
          variableName: sweep.variableName,
          field: binding.field,
          label: binding.label,
        });
      }
    }
    return fields;
  }, [parentSweeps, nodeType]);
  
  // 加载外部数据
  const loadExternalData = useCallback(async () => {
    setLoadingLiquids(true);
    try {
      const [liquidsData, pumpsData] = await Promise.all([
        fetchLiquids(),
        fetchPumpAssignments(),
      ]);
      setLiquids(liquidsData);
      setPumpAssignments(pumpsData);
    } catch (error) {
      console.error('加载外部数据失败:', error);
    } finally {
      setLoadingLiquids(false);
    }
  }, []);
  
  useEffect(() => {
    loadExternalData();
  }, [loadExternalData]);
  
  if (!selectedNode || !nodeType) {
    return (
      <div className="w-64 bg-muted/30 border-l p-4">
        <p className="text-sm text-muted-foreground">选择一个节点来编辑属性</p>
      </div>
    );
  }
  
  const meta = NODE_META[nodeType];
  const data = selectedNode.data as Record<string, unknown>;
  
  const handleChange = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, { [key]: value });
  };

  // 渲染节点特定的字段
  const renderFields = () => {
    const commonProps = { data, handleChange };
    const externalDataProps = {
      ...commonProps,
      liquids,
      pumpAssignments,
      loadingLiquids,
      onRefreshLiquids: loadExternalData,
    };
    const contextProps = {
      ...commonProps,
      nodeId: selectedNode.id,
      nodes,
      edges,
    };
    
    switch (nodeType) {
      case NodeType.START:
        return <StartNodeFields {...commonProps} />;
      case NodeType.LOOP:
        return <LoopNodeFields {...commonProps} />;
      case NodeType.PHASE_MARKER:
        return <PhaseMarkerFields {...commonProps} />;
      case NodeType.INJECT:
        return <InjectNodeFields {...commonProps} nodes={nodes} />;
      case NodeType.DRAIN:
        return <DrainNodeFields {...commonProps} />;
      case NodeType.LIQUID_SOURCE:
        return <LiquidSourceFields {...externalDataProps} {...contextProps} />;
      case NodeType.WASH:
        return <WashNodeFields {...externalDataProps} />;
      case NodeType.PARAM_SWEEP:
        return <ParamSweepFields {...commonProps} nodes={nodes} />;
      case NodeType.ACQUIRE:
        return <AcquireNodeFields {...commonProps} />;
      case NodeType.WAIT_TIME:
        return <WaitTimeFields {...commonProps} />;
      case NodeType.WAIT_CYCLES:
        return <WaitCyclesFields {...commonProps} />;
      case NodeType.WAIT_STABILITY:
        return <WaitStabilityFields {...commonProps} />;
      case NodeType.SET_STATE:
        return <SetStateFields {...commonProps} />;
      case NodeType.SET_GAS_PUMP:
        return <SetGasPumpFields {...commonProps} />;
      case NodeType.HARDWARE_CONFIG:
        return <HardwareConfigFields {...commonProps} />;
      case NodeType.PREHEAT:
        return <PreheatNodeFields {...commonProps} />;
      case NodeType.CONFIGURE_HEATER:
        return <ConfigureHeaterFields {...commonProps} />;
      case NodeType.END:
        return <p className="text-sm text-muted-foreground">实验结束节点，无可编辑属性</p>;
      default:
        return <p className="text-sm text-muted-foreground">此节点没有可编辑的属性</p>;
    }
  };

  // 当前节点的变量绑定
  const boundVariables = (data.boundVariables || {}) as Record<string, string>;

  return (
    <div className="h-full bg-muted/30 border-l flex flex-col">
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-sm">{meta.label}</h3>
        {nodeType !== NodeType.START && nodeType !== NodeType.END && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => deleteNode(selectedNode.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        {renderFields()}
        
        {/* 扫描变量绑定区域 */}
        {bindableFields.length > 0 && (
          <div className="pt-3 border-t space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-pink-500" />
              <span className="text-xs font-medium text-pink-600">扫描变量绑定</span>
            </div>
            {bindableFields.map((field) => (
              <div key={`${field.sweepId}_${field.field}`} className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <span className="text-muted-foreground">{field.sweepName}</span>
                  <span className="text-pink-500">→</span>
                  <span>{field.label}</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={boundVariables[field.field] === field.sweepId}
                    onCheckedChange={(checked) => {
                      const newBound = { ...boundVariables };
                      if (checked) {
                        newBound[field.field] = field.sweepId;
                      } else {
                        delete newBound[field.field];
                      }
                      handleChange('boundVariables', newBound);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {boundVariables[field.field] === field.sweepId ? (
                      <span className="text-pink-500">已绑定: {field.variableName}</span>
                    ) : (
                      '未绑定'
                    )}
                  </span>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              绑定后，此参数将使用扫描节点的迭代值
            </p>
          </div>
        )}
        
        {/* 显示所在扫描体信息 */}
        {parentSweeps.length > 0 && (
          <div className="pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              所在扫描体 ({parentSweeps.length}): {parentSweeps.map(s => `${s.name}(${s.paramType})`).join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
