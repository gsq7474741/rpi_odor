'use client';

import { useState, useEffect } from 'react';
import { useEditorStore } from '../store';
import { NodeType, NODE_META, SYSTEM_STATES, EXPERIMENT_PHASES } from '../types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Trash2, RefreshCw, Wand2 } from 'lucide-react';

// 液体库类型
interface LiquidItem {
  id: string;
  name: string;
  category: string;
}

// 序列生成模式
type SeqGenType = 'linear' | 'log' | 'exp' | 'quadratic' | 'sqrt';

const SEQ_GEN_LABELS: Record<SeqGenType, string> = {
  linear: '线性等差',
  log: '对数（小值密集）',
  exp: '指数（大值密集）',
  quadratic: '二次曲线',
  sqrt: '平方根',
};

// 参数类型配置
const PARAM_TYPE_CONFIG: Record<string, { unit: string; min: number; max: number; step: number; defaultStart: number; defaultEnd: number; defaultStep: number }> = {
  ratio: { unit: '%', min: 0, max: 100, step: 5, defaultStart: 10, defaultEnd: 90, defaultStep: 10 },
  volume: { unit: 'ml', min: 1, max: 100, step: 1, defaultStart: 5, defaultEnd: 30, defaultStep: 5 },
  gasPumpPwm: { unit: '%', min: 0, max: 100, step: 5, defaultStart: 20, defaultEnd: 80, defaultStep: 10 },
  duration: { unit: 's', min: 10, max: 600, step: 10, defaultStart: 60, defaultEnd: 300, defaultStep: 60 },
  cycles: { unit: '周期', min: 1, max: 50, step: 1, defaultStart: 5, defaultEnd: 20, defaultStep: 5 },
};

// 生成序列的函数
function generateSequence(type: SeqGenType, min: number, max: number, steps: number): number[] {
  if (steps < 2) return [min, max];
  const result: number[] = [];
  
  switch (type) {
    case 'linear':
      for (let i = 0; i < steps; i++) {
        result.push(Math.round(min + (max - min) * i / (steps - 1)));
      }
      break;
    case 'log':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const logVal = Math.log(1 + t * (Math.E - 1));
        result.push(Math.round(min + (max - min) * logVal));
      }
      break;
    case 'exp':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const expVal = (Math.exp(t) - 1) / (Math.E - 1);
        result.push(Math.round(min + (max - min) * expVal));
      }
      break;
    case 'quadratic':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        result.push(Math.round(min + (max - min) * t * t));
      }
      break;
    case 'sqrt':
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        result.push(Math.round(min + (max - min) * Math.sqrt(t)));
      }
      break;
  }
  
  return [...new Set(result)].sort((a, b) => a - b);
}

export function PropertyPanel() {
  const { nodes, selectedNodeId, updateNodeData, deleteNode } = useEditorStore();
  
  // 液体库状态
  const [liquids, setLiquids] = useState<LiquidItem[]>([]);
  const [loadingLiquids, setLoadingLiquids] = useState(false);
  
  // 序列生成器状态
  const [seqGenType, setSeqGenType] = useState<SeqGenType>('linear');
  const [seqGenSteps, setSeqGenSteps] = useState(5);
  
  // 加载液体库
  const loadLiquids = async () => {
    setLoadingLiquids(true);
    try {
      const res = await fetch('/api/consumables?type=liquids');
      if (res.ok) {
        const data = await res.json();
        setLiquids(data.liquids || []);
      }
    } catch (error) {
      console.error('加载液体库失败:', error);
    } finally {
      setLoadingLiquids(false);
    }
  };
  
  // 初始加载液体库
  useEffect(() => {
    loadLiquids();
  }, []);
  
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  
  if (!selectedNode) {
    return (
      <div className="w-64 bg-muted/30 border-l p-4">
        <p className="text-sm text-muted-foreground">选择一个节点来编辑属性</p>
      </div>
    );
  }
  
  const nodeType = selectedNode.type as NodeType;
  const meta = NODE_META[nodeType];
  const data = selectedNode.data as Record<string, unknown>;
  
  const handleChange = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, { [key]: value });
  };

  const renderFields = () => {
    switch (nodeType) {
      case NodeType.START:
        return (
          <>
            <Field label="程序ID">
              <Input
                value={String(data.programId || '')}
                onChange={(e) => handleChange('programId', e.target.value)}
                placeholder="my_experiment"
              />
            </Field>
            <Field label="程序名称">
              <Input
                value={String(data.programName || '')}
                onChange={(e) => handleChange('programName', e.target.value)}
                placeholder="我的实验"
              />
            </Field>
            <Field label="描述">
              <Input
                value={String(data.description || '')}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="实验描述..."
              />
            </Field>
            <Field label="版本">
              <Input
                value={String(data.version || '1.0.0')}
                onChange={(e) => handleChange('version', e.target.value)}
                placeholder="1.0.0"
              />
            </Field>
          </>
        );
        
      case NodeType.LOOP:
        return (
          <Field label="循环次数">
            <Input
              type="number"
              min={1}
              max={100}
              value={Number(data.count || 1)}
              onChange={(e) => handleChange('count', parseInt(e.target.value) || 1)}
            />
          </Field>
        );
        
      case NodeType.PHASE_MARKER:
        return (
          <>
            <Field label="阶段名称">
              <Select
                value={String(data.phaseName || 'SAMPLE')}
                onValueChange={(v) => handleChange('phaseName', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择阶段" />
                </SelectTrigger>
                <SelectContent>
                  {EXPERIMENT_PHASES.map((phase) => (
                    <SelectItem key={phase.value} value={phase.value}>
                      <div className="flex flex-col">
                        <span>{phase.label}</span>
                        <span className="text-xs text-muted-foreground">{phase.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="标记类型">
              <div className="flex items-center gap-2">
                <Switch
                  checked={Boolean(data.isStart)}
                  onCheckedChange={(checked) => handleChange('isStart', checked)}
                />
                <span className="text-sm">{data.isStart ? '开始' : '结束'}</span>
              </div>
            </Field>
          </>
        );
        
      case NodeType.INJECT:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="目标类型">
              <Select
                value={String(data.targetType || 'volume')}
                onValueChange={(v) => handleChange('targetType', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">体积 (ml)</SelectItem>
                  <SelectItem value="weight">重量 (g)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {data.targetType === 'volume' ? (
              <Field label="目标体积 (ml)">
                <Input
                  type="number"
                  step={0.1}
                  value={Number(data.targetVolumeMl || 0)}
                  onChange={(e) => handleChange('targetVolumeMl', parseFloat(e.target.value) || 0)}
                />
              </Field>
            ) : (
              <Field label="目标重量 (g)">
                <Input
                  type="number"
                  step={0.1}
                  value={Number(data.targetWeightG || 0)}
                  onChange={(e) => handleChange('targetWeightG', parseFloat(e.target.value) || 0)}
                />
              </Field>
            )}
            <Field label="容差">
              <Input
                type="number"
                step={0.1}
                value={Number(data.tolerance || 0.5)}
                onChange={(e) => handleChange('tolerance', parseFloat(e.target.value) || 0.5)}
              />
            </Field>
            <Field label="流速 (ml/min)">
              <Input
                type="number"
                step={0.5}
                value={Number(data.flowRateMlMin || 5)}
                onChange={(e) => handleChange('flowRateMlMin', parseFloat(e.target.value) || 5)}
              />
            </Field>
          </>
        );
        
      case NodeType.DRAIN:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label={`气泵 PWM (${data.gasPumpPwm || 80}%)`}>
              <Slider
                value={[Number(data.gasPumpPwm || 80)]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => handleChange('gasPumpPwm', v)}
              />
            </Field>
            <Field label="超时 (秒)">
              <Input
                type="number"
                value={Number(data.timeoutS || 60)}
                onChange={(e) => handleChange('timeoutS', parseInt(e.target.value) || 60)}
              />
            </Field>
          </>
        );
        
      case NodeType.LIQUID_SOURCE:
        return (
          <>
            <Field label="从液体库选择">
              <div className="flex gap-1">
                <Select
                  value={String(data.liquidId || '')}
                  onValueChange={(v) => {
                    const liquid = liquids.find(l => l.id === v);
                    if (liquid) {
                      handleChange('liquidId', liquid.id);
                      handleChange('liquidName', liquid.name);
                    }
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="选择液体..." />
                  </SelectTrigger>
                  <SelectContent>
                    {liquids.length === 0 ? (
                      <SelectItem value="_empty" disabled>暂无液体</SelectItem>
                    ) : (
                      liquids.map((liquid) => (
                        <SelectItem key={liquid.id} value={liquid.id}>
                          {liquid.name} ({liquid.category})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={loadLiquids}
                  disabled={loadingLiquids}
                >
                  <RefreshCw className={`w-4 h-4 ${loadingLiquids ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </Field>
            <Field label="液体名称">
              <Input
                value={String(data.liquidName || '')}
                onChange={(e) => handleChange('liquidName', e.target.value)}
                placeholder="手动输入或从上方选择"
              />
            </Field>
            <Field label={`比例 (${((Number(data.ratio) || 1) * 100).toFixed(0)}%)`}>
              <Slider
                value={[Number(data.ratio || 1) * 100]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => handleChange('ratio', v / 100)}
              />
            </Field>
            <p className="text-xs text-muted-foreground mt-2">
              注：泵编号在耗材管理中配置，此处只需选择液体类型和比例
            </p>
          </>
        );
        
      case NodeType.WASH:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="清洗液ID">
              <Select
                value={String(data.washLiquidId || 'distilled_water')}
                onValueChange={(v) => handleChange('washLiquidId', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="distilled_water">蒸馏水</SelectItem>
                  <SelectItem value="ethanol">乙醇</SelectItem>
                  <SelectItem value="cleaning_solution">清洗液</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="每次清洗量 (ml)">
              <Input
                type="number"
                step={5}
                value={Number(data.washVolumeMl || 20)}
                onChange={(e) => handleChange('washVolumeMl', parseFloat(e.target.value) || 20)}
              />
            </Field>
            <Field label="重复次数">
              <Input
                type="number"
                min={1}
                max={10}
                value={Number(data.repeatCount || 2)}
                onChange={(e) => handleChange('repeatCount', parseInt(e.target.value) || 2)}
              />
            </Field>
            <Field label={`气泵 PWM (${data.gasPumpPwm || 50}%)`}>
              <Slider
                value={[Number(data.gasPumpPwm || 50)]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => handleChange('gasPumpPwm', v)}
              />
            </Field>
            <Field label="清洗后排废">
              <div className="flex items-center gap-2">
                <Switch
                  checked={Boolean(data.drainAfter ?? true)}
                  onCheckedChange={(checked) => handleChange('drainAfter', checked)}
                />
                <span className="text-sm">{data.drainAfter !== false ? '是' : '否'}</span>
              </div>
            </Field>
          </>
        );
        
      case NodeType.PARAM_SWEEP:
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
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              value={start}
                              onChange={(e) => handleChange('startValue', parseInt(e.target.value) || 10)}
                              className="w-16"
                              placeholder="起始"
                            />
                            <span className="text-muted-foreground self-center">→</span>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              value={end}
                              onChange={(e) => handleChange('endValue', parseInt(e.target.value) || 90)}
                              className="w-16"
                              placeholder="结束"
                            />
                            <Input
                              type="number"
                              min={1}
                              max={50}
                              step={5}
                              value={stepVal}
                              onChange={(e) => handleChange('stepValue', parseInt(e.target.value) || 10)}
                              className="w-16"
                              placeholder="步长"
                            />
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
        
      case NodeType.ACQUIRE:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label={`气泵 PWM (${data.gasPumpPwm || 50}%)`}>
              <Slider
                value={[Number(data.gasPumpPwm || 50)]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => handleChange('gasPumpPwm', v)}
              />
            </Field>
            <Field label="终止条件">
              <Select
                value={String(data.terminationType || 'cycles')}
                onValueChange={(v) => handleChange('terminationType', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="duration">固定时间</SelectItem>
                  <SelectItem value="cycles">加热周期</SelectItem>
                  <SelectItem value="stability">稳定后</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {data.terminationType === 'duration' && (
              <Field label="持续时间 (秒)">
                <Input
                  type="number"
                  value={Number(data.durationS || 60)}
                  onChange={(e) => handleChange('durationS', parseInt(e.target.value) || 60)}
                />
              </Field>
            )}
            {data.terminationType === 'cycles' && (
              <Field label="加热周期数">
                <Input
                  type="number"
                  value={Number(data.heaterCycles || 10)}
                  onChange={(e) => handleChange('heaterCycles', parseInt(e.target.value) || 10)}
                />
              </Field>
            )}
            <Field label="最大时长 (秒)">
              <Input
                type="number"
                value={Number(data.maxDurationS || 300)}
                onChange={(e) => handleChange('maxDurationS', parseInt(e.target.value) || 300)}
              />
            </Field>
          </>
        );
        
      case NodeType.WAIT_TIME:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="等待时间 (秒)">
              <Input
                type="number"
                value={Number(data.durationS || 60)}
                onChange={(e) => handleChange('durationS', parseInt(e.target.value) || 60)}
              />
            </Field>
            <Field label="超时 (秒)">
              <Input
                type="number"
                value={Number(data.timeoutS || 120)}
                onChange={(e) => handleChange('timeoutS', parseInt(e.target.value) || 120)}
              />
            </Field>
          </>
        );
        
      case NodeType.WAIT_CYCLES:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="加热周期数">
              <Input
                type="number"
                value={Number(data.heaterCycles || 5)}
                onChange={(e) => handleChange('heaterCycles', parseInt(e.target.value) || 5)}
              />
            </Field>
            <Field label="超时 (秒)">
              <Input
                type="number"
                value={Number(data.timeoutS || 300)}
                onChange={(e) => handleChange('timeoutS', parseInt(e.target.value) || 300)}
              />
            </Field>
          </>
        );
        
      case NodeType.WAIT_STABILITY:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="稳定窗口 (秒)">
              <Input
                type="number"
                value={Number(data.windowS || 30)}
                onChange={(e) => handleChange('windowS', parseInt(e.target.value) || 30)}
              />
            </Field>
            <Field label="阈值 (%)">
              <Input
                type="number"
                value={Number(data.thresholdPercent || 5)}
                onChange={(e) => handleChange('thresholdPercent', parseInt(e.target.value) || 5)}
              />
            </Field>
            <Field label="超时 (秒)">
              <Input
                type="number"
                value={Number(data.timeoutS || 300)}
                onChange={(e) => handleChange('timeoutS', parseInt(e.target.value) || 300)}
              />
            </Field>
          </>
        );
        
      case NodeType.SET_STATE:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="系统状态">
              <Select
                value={String(data.state || 'STATE_INITIAL')}
                onValueChange={(v) => handleChange('state', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_STATES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        );
        
      case NodeType.SET_GAS_PUMP:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label={`PWM (${data.pwmPercent || 0}%)`}>
              <Slider
                value={[Number(data.pwmPercent || 0)]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => handleChange('pwmPercent', v)}
              />
            </Field>
          </>
        );
        
      case NodeType.HARDWARE_CONFIG:
        return (
          <>
            <Field label="瓶容量 (ml)">
              <Input
                type="number"
                value={Number(data.bottleCapacityMl || 150)}
                onChange={(e) => handleChange('bottleCapacityMl', parseInt(e.target.value) || 150)}
              />
            </Field>
            <Field label="最大液位 (ml)">
              <Input
                type="number"
                value={Number(data.maxFillMl || 100)}
                onChange={(e) => handleChange('maxFillMl', parseInt(e.target.value) || 100)}
              />
            </Field>
          </>
        );
      
      case NodeType.END:
        return <p className="text-sm text-muted-foreground">实验结束节点，无可编辑属性</p>;
        
      default:
        return <p className="text-sm text-muted-foreground">此节点没有可编辑的属性</p>;
    }
  };

  return (
    <div className="w-64 bg-muted/30 border-l overflow-y-auto">
      <div className="p-3 border-b flex items-center justify-between">
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
      <div className="p-3 space-y-4">
        {renderFields()}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
