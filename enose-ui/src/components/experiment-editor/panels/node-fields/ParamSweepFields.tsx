'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Wand2 } from 'lucide-react';
import { Field } from './Field';
import { NodeFieldsProps, SeqGenType, SEQ_GEN_LABELS, PARAM_TYPE_CONFIG, generateSequence } from './types';
import { NodeType, ExperimentNode } from '../../types';

interface ParamSweepFieldsProps extends NodeFieldsProps {
  nodes: ExperimentNode[];
}

export function ParamSweepFields({ data, handleChange, nodes }: ParamSweepFieldsProps) {
  const [seqGenSteps, setSeqGenSteps] = useState(5);
  
  const paramType = String(data.paramType || 'volume');
  const paramConfig = PARAM_TYPE_CONFIG[paramType] || PARAM_TYPE_CONFIG.volume;
  const seqMode = String(data.seqMode || 'linear') as SeqGenType;
  const start = Number(data.startValue ?? paramConfig.defaultStart);
  const end = Number(data.endValue ?? paramConfig.defaultEnd);
  const stepVal = Number(data.stepValue ?? paramConfig.defaultStep);
  
  // 获取当前程序中的液体源节点
  const liquidSourceNodes = nodes.filter(n => n.type === NodeType.LIQUID_SOURCE);
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
    handleChange('ratioSweepPoints', [...ratioSweepPoints, newPoint]);
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
    handleChange('ratioSweepPoints', ratioSweepPoints.filter((_, i) => i !== pointIdx));
  };
  
  // 自动生成比例扫描点（2液体时）
  const autoGenerateRatioPoints = () => {
    if (liquidSourceNodes.length !== 2) return;
    const [node1, node2] = liquidSourceNodes;
    const id1 = String((node1.data as Record<string, unknown>).liquidId || node1.id);
    const id2 = String((node2.data as Record<string, unknown>).liquidId || node2.id);
    
    const points: Array<{ratios: Record<string, number>}> = [];
    for (let r = start; r <= end; r += stepVal) {
      points.push({ ratios: { [id1]: r, [id2]: 100 - r } });
    }
    handleChange('ratioSweepPoints', points);
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
              
              {liquidSourceNodes.length === 2 && (
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
                          onChange={(e) => handleChange('startValue', parseInt(e.target.value) || 10)}
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
                          onChange={(e) => handleChange('endValue', parseInt(e.target.value) || 90)}
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={autoGenerateRatioPoints}
                  >
                    <Wand2 className="w-3 h-3 mr-1" />
                    自动生成扫描点
                  </Button>
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
                  <div className="max-h-48 overflow-y-auto space-y-1">
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
                                    value={point.ratios[liquidId] || 0}
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
