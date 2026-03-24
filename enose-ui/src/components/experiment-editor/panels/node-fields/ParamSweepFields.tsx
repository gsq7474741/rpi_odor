'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Wand2, Shuffle, FlaskConical } from 'lucide-react';
import { Field } from './Field';
import { NodeFieldsProps, SeqGenType, SEQ_GEN_LABELS, PARAM_TYPE_CONFIG, generateSequence } from './types';
import { NodeType, ExperimentNode, ExperimentEdge, HANDLE_TYPES } from '../../types';

interface ParamSweepFieldsProps extends NodeFieldsProps {
  nodeId: string;
  nodes: ExperimentNode[];
  edges: ExperimentEdge[];
}

// 收集扫描体内的直接节点（沿 flow 边遍历，不深入嵌套循环/扫描）
function collectSweepBodyNodes(
  sweepNodeId: string,
  allNodes: ExperimentNode[],
  allEdges: ExperimentEdge[]
): ExperimentNode[] {
  const bodyNodes: ExperimentNode[] = [];
  const loopBodyOutEdge = allEdges.find(
    e => e.source === sweepNodeId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
  );
  if (!loopBodyOutEdge) return bodyNodes;

  const flowAdj = new Map<string, string>();
  for (const edge of allEdges) {
    if (edge.sourceHandle === HANDLE_TYPES.FLOW || !edge.sourceHandle) {
      flowAdj.set(edge.source, edge.target);
    }
  }

  let currentId: string | undefined = loopBodyOutEdge.target;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = allNodes.find(n => n.id === currentId);
    if (!node) break;
    bodyNodes.push(node);
    // 如果是嵌套循环/扫描，递归收集其内部节点
    if (node.type === NodeType.PARAM_SWEEP || node.type === NodeType.LOOP) {
      const nestedNodes = collectSweepBodyNodes(node.id, allNodes, allEdges);
      bodyNodes.push(...nestedNodes);
    }
    const isReturn = allEdges.some(
      e => e.source === currentId && e.target === sweepNodeId && e.targetHandle === HANDLE_TYPES.LOOP_BODY
    );
    if (isReturn) break;
    currentId = flowAdj.get(currentId);
  }
  return bodyNodes;
}

export function ParamSweepFields({ data, handleChange, nodeId, nodes, edges }: ParamSweepFieldsProps) {
  const [seqGenSteps, setSeqGenSteps] = useState(5);
  
  const paramType = String(data.paramType || 'volume');
  const paramConfig = PARAM_TYPE_CONFIG[paramType] || PARAM_TYPE_CONFIG.volume;
  const seqMode = String(data.seqMode || 'linear') as SeqGenType;
  const start = Number(data.startValue ?? paramConfig.defaultStart);
  const end = Number(data.endValue ?? paramConfig.defaultEnd);
  const stepVal = Number(data.stepValue ?? paramConfig.defaultStep);
  
  // 获取当前扫描体内的进样节点，再通过 LIQUID 边找到连接的液体源
  const bodyNodes = collectSweepBodyNodes(nodeId, nodes, edges);
  const injectNodeIds = new Set(bodyNodes.filter(n => n.type === NodeType.INJECT).map(n => n.id));
  const connectedLiquidSourceIds = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceHandle === HANDLE_TYPES.LIQUID && injectNodeIds.has(edge.target)) {
      connectedLiquidSourceIds.add(edge.source);
    }
  }
  const liquidSourceNodes = nodes.filter(n => connectedLiquidSourceIds.has(n.id));
  const ratioSweepPoints = (data.ratioSweepPoints as Array<{ratios: Record<string, number>}>) || [];
  
  // 根据模式计算序列（非比例类型）
  const sequence = paramType !== 'ratio' ? (
    seqMode === 'linear' 
      ? (() => {
          const seq: number[] = [];
          for (let v = start; v <= end; v += stepVal) seq.push(v);
          return seq;
        })()
      : generateSequence(seqMode, start, end, seqGenSteps)
  ) : [];
  
  // 计算当前扫描点数
  const sweepCount = paramType === 'ratio' ? ratioSweepPoints.length : sequence.length;
  const shuffledOrder = (data.shuffledOrder as number[] | undefined) || [];
  
  // Fisher-Yates 洗牌，生成随机排列索引
  const generateShuffledOrder = (length: number) => {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  };
  
  // 添加比例扫描点
  const addRatioPoint = () => {
    const newPoint: {ratios: Record<string, number>} = { ratios: {} };
    const avgRatio = liquidSourceNodes.length > 0 ? Math.floor(100 / liquidSourceNodes.length) : 100;
    let remaining = 100;
    liquidSourceNodes.forEach((node, idx) => {
      const nodeData = node.data as Record<string, unknown>;
      const liquidId = String(nodeData.liquidId || node.id);
      if (idx === liquidSourceNodes.length - 1) {
        newPoint.ratios[liquidId] = remaining;
      } else {
        newPoint.ratios[liquidId] = avgRatio;
        remaining -= avgRatio;
      }
    });
    const newPoints = [...ratioSweepPoints, newPoint];
    updateRatioPointsAndShuffle(newPoints);
  };
  
  // 更新比例扫描点
  const updateRatioPoint = (pointIdx: number, liquidId: string, value: number) => {
    const newPoints = [...ratioSweepPoints];
    newPoints[pointIdx] = {
      ...newPoints[pointIdx],
      ratios: { ...newPoints[pointIdx].ratios, [liquidId]: value }
    };
    handleChange('ratioSweepPoints', newPoints);
  };
  
  // 删除比例扫描点
  const removeRatioPoint = (pointIdx: number) => {
    const newPoints = ratioSweepPoints.filter((_, i) => i !== pointIdx);
    updateRatioPointsAndShuffle(newPoints);
  };
  
  // 获取液体节点的 ID 和名称
  const getLiquidInfo = (node: ExperimentNode) => {
    const d = node.data as Record<string, unknown>;
    return {
      id: String(d.liquidId || node.id),
      name: String(d.liquidName || d.liquidId || node.id),
    };
  };

  // 选中的液体对索引（>2 液体时使用）
  const selectedPairKey = String(data._selectedPairKey || '');
  const setSelectedPairKey = (key: string) => handleChange('_selectedPairKey', key);

  // 生成所有 C(n,2) 液体对
  const allPairs: Array<[number, number]> = [];
  for (let i = 0; i < liquidSourceNodes.length; i++) {
    for (let j = i + 1; j < liquidSourceNodes.length; j++) {
      allPairs.push([i, j]);
    }
  }

  // 为指定液体对生成二元混合扫描点
  const generatePairPoints = (nodeA: ExperimentNode, nodeB: ExperimentNode): Array<{ratios: Record<string, number>}> => {
    const idA = getLiquidInfo(nodeA).id;
    const idB = getLiquidInfo(nodeB).id;
    const points: Array<{ratios: Record<string, number>}> = [];
    // 所有液体的基础比例为 0
    const baseRatios: Record<string, number> = {};
    for (const n of liquidSourceNodes) {
      baseRatios[getLiquidInfo(n).id] = 0;
    }
    for (let r = start; r <= end; r += stepVal) {
      points.push({ ratios: { ...baseRatios, [idA]: r, [idB]: 100 - r } });
    }
    return points;
  };

  // 更新扫描点并同步乱序
  const updateRatioPointsAndShuffle = (points: Array<{ratios: Record<string, number>}>) => {
    handleChange('ratioSweepPoints', points);
    if (Boolean(data.randomize) && points.length > 0) {
      handleChange('shuffledOrder', generateShuffledOrder(points.length));
    }
  };

  // 自动生成比例扫描点（指定液体对）
  const autoGenerateRatioPoints = (idxA?: number, idxB?: number) => {
    if (liquidSourceNodes.length < 2) return;
    const a = idxA ?? 0;
    const b = idxB ?? 1;
    const points = generatePairPoints(liquidSourceNodes[a], liquidSourceNodes[b]);
    updateRatioPointsAndShuffle(points);
  };

  // 生成所有 C(n,2) 组合的扫描点
  const autoGenerateAllCombos = () => {
    const allPoints: Array<{ratios: Record<string, number>}> = [];
    for (const [i, j] of allPairs) {
      allPoints.push(...generatePairPoints(liquidSourceNodes[i], liquidSourceNodes[j]));
    }
    updateRatioPointsAndShuffle(allPoints);
  };
  
  return (
    <>
      <Field label="扫描名称">
        <Input
          value={String(data.name || '')}
          onChange={(e) => handleChange('name', e.target.value)}
        />
      </Field>
      <Field label="参数类型">
        <Select
          value={paramType}
          onValueChange={(v) => {
            handleChange('paramType', v);
            if (v !== 'ratio') {
              const cfg = PARAM_TYPE_CONFIG[v] || PARAM_TYPE_CONFIG.volume;
              handleChange('startValue', cfg.defaultStart);
              handleChange('endValue', cfg.defaultEnd);
              handleChange('stepValue', cfg.defaultStep);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ratio">混合比例</SelectItem>
            <SelectItem value="volume">进样量</SelectItem>
            <SelectItem value="gasPumpPwm">气泵速度</SelectItem>
            <SelectItem value="duration">采集时间</SelectItem>
            <SelectItem value="cycles">采集周期</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      
      <div className="flex items-center justify-between p-2 bg-muted/30 rounded border">
        <div className="flex items-center gap-2">
          <Shuffle className="w-3.5 h-3.5 text-pink-500" />
          <Label htmlFor="randomize-switch" className="text-xs cursor-pointer">
            随机化执行顺序
          </Label>
        </div>
        <Switch
          id="randomize-switch"
          checked={Boolean(data.randomize)}
          onCheckedChange={(checked) => {
            handleChange('randomize', checked);
            if (checked && sweepCount > 0) {
              handleChange('shuffledOrder', generateShuffledOrder(sweepCount));
            } else if (!checked) {
              handleChange('shuffledOrder', undefined);
            }
          }}
        />
      </div>
      {Boolean(data.randomize) && (
        <div className="space-y-1.5 -mt-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                if (sweepCount > 0) {
                  handleChange('shuffledOrder', generateShuffledOrder(sweepCount));
                }
              }}
            >
              <Shuffle className="w-3 h-3 mr-1" />
              重新洗牌
            </Button>
            {shuffledOrder.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                顺序: {shuffledOrder.map(i => i + 1).join(' → ')}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            展开后的扫描参数组将按此顺序执行，避免传感器记忆效应
          </p>
        </div>
      )}
      
      {paramType === 'ratio' ? (
        // 比例扫描配置
        <>
          {liquidSourceNodes.length === 0 ? (
            <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-600">
              请先添加液体源节点
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                检测到 {liquidSourceNodes.length} 种液体源
              </div>
              
              {liquidSourceNodes.length >= 2 && (
                <>
                  <Field label="主液体比例范围 (%)">
                    <div className="flex gap-2 items-end">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground">起始</span>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={start}
                          onChange={(e) => { const v = parseInt(e.target.value); handleChange('startValue', isNaN(v) ? 0 : v); }}
                          className="w-16"
                        />
                      </div>
                      <span className="text-muted-foreground pb-1.5">→</span>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground">结束</span>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={end}
                          onChange={(e) => { const v = parseInt(e.target.value); handleChange('endValue', isNaN(v) ? 100 : v); }}
                          className="w-16"
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground">步长</span>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          step={5}
                          value={stepVal}
                          onChange={(e) => handleChange('stepValue', parseInt(e.target.value) || 10)}
                          className="w-16"
                        />
                      </div>
                    </div>
                  </Field>

                  {liquidSourceNodes.length === 2 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => autoGenerateRatioPoints()}
                    >
                      <Wand2 className="w-3 h-3 mr-1" />
                      自动生成扫描点
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <Field label="二元组合配对">
                        <Select
                          value={selectedPairKey || `${0}-${1}`}
                          onValueChange={setSelectedPairKey}
                        >
                          <SelectTrigger className="text-xs h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {allPairs.map(([i, j]) => {
                              const a = getLiquidInfo(liquidSourceNodes[i]);
                              const b = getLiquidInfo(liquidSourceNodes[j]);
                              return (
                                <SelectItem key={`${i}-${j}`} value={`${i}-${j}`}>
                                  {a.name} × {b.name}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          const key = selectedPairKey || `${0}-${1}`;
                          const [a, b] = key.split('-').map(Number);
                          autoGenerateRatioPoints(a, b);
                        }}
                      >
                        <Wand2 className="w-3 h-3 mr-1" />
                        生成该配对扫描点
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={autoGenerateAllCombos}
                      >
                        <FlaskConical className="w-3 h-3 mr-1" />
                        生成所有 C({liquidSourceNodes.length},2)={allPairs.length} 种组合
                      </Button>
                      <p className="text-[10px] text-muted-foreground">
                        共 {allPairs.length} 种二元组合，每组合 {stepVal > 0 ? Math.floor((end - start) / stepVal) + 1 : 0} 个扫描点，
                        合计 {allPairs.length * (stepVal > 0 ? Math.floor((end - start) / stepVal) + 1 : 0)} 个点
                      </p>
                    </div>
                  )}
                </>
              )}
              
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">扫描点列表 ({ratioSweepPoints.length})</span>
                  <Button variant="ghost" size="sm" onClick={addRatioPoint} className="h-6 px-2">
                    + 添加
                  </Button>
                </div>
                
                {ratioSweepPoints.length > 0 && (
                  <div className="space-y-1">
                    {ratioSweepPoints.map((point, pointIdx) => {
                      const total = Object.values(point.ratios).reduce((sum, v) => sum + v, 0);
                      const isValid = Math.abs(total - 100) < 0.1;
                      return (
                        <div 
                          key={pointIdx} 
                          className={`p-2 rounded border text-[10px] ${isValid ? 'bg-muted/30' : 'bg-red-500/10 border-red-500/30'}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">#{pointIdx + 1}</span>
                            <div className="flex items-center gap-1">
                              {!isValid && <span className="text-red-500">≠100%</span>}
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-5 w-5 p-0"
                                onClick={() => removeRatioPoint(pointIdx)}
                              >
                                ×
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {liquidSourceNodes.map(node => {
                              const nodeData = node.data as Record<string, unknown>;
                              const liquidId = String(nodeData.liquidId || node.id);
                              const liquidName = String(nodeData.liquidName || liquidId);
                              return (
                                <div key={liquidId} className="flex items-center gap-1">
                                  <span className="truncate flex-1" title={liquidName}>{liquidName}</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={point.ratios[liquidId] ?? 0}
                                    onChange={(e) => updateRatioPoint(pointIdx, liquidId, parseInt(e.target.value) || 0)}
                                    className="w-12 h-5 text-[10px] px-1"
                                  />
                                  <span>%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        // 其他参数类型扫描
        <>
          <Field label="序列模式">
            <Select
              value={seqMode}
              onValueChange={(v) => handleChange('seqMode', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SEQ_GEN_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`起始值 (${paramConfig.unit})`}>
            <Input
              type="number"
              step={paramConfig.step}
              min={paramConfig.min}
              max={paramConfig.max}
              value={start}
              onChange={(e) => handleChange('startValue', parseFloat(e.target.value) || paramConfig.defaultStart)}
            />
          </Field>
          <Field label={`结束值 (${paramConfig.unit})`}>
            <Input
              type="number"
              step={paramConfig.step}
              min={paramConfig.min}
              max={paramConfig.max}
              value={end}
              onChange={(e) => handleChange('endValue', parseFloat(e.target.value) || paramConfig.defaultEnd)}
            />
          </Field>
          {seqMode === 'linear' ? (
            <Field label={`步长 (${paramConfig.unit})`}>
              <Input
                type="number"
                step={paramConfig.step}
                min={1}
                value={stepVal}
                onChange={(e) => handleChange('stepValue', parseFloat(e.target.value) || paramConfig.defaultStep)}
              />
            </Field>
          ) : (
            <Field label="序列点数">
              <Input
                type="number"
                min={2}
                max={20}
                value={seqGenSteps}
                onChange={(e) => setSeqGenSteps(parseInt(e.target.value) || 5)}
              />
            </Field>
          )}
          <div className="p-2 bg-muted/50 rounded text-[10px] space-y-1">
            <div className="font-medium">序列预览 ({sequence.length} 点):</div>
            <div className="text-muted-foreground break-all">
              {sequence.slice(0, 10).join(', ')}
              {sequence.length > 10 && ` ... (共${sequence.length}个)`}
            </div>
          </div>
        </>
      )}
    </>
  );
}
