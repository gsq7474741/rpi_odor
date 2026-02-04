'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useEditorStore } from '../store';
import { NodeType, NODE_META, SYSTEM_STATES, EXPERIMENT_PHASES, HANDLE_TYPES, PARAM_TYPE_BINDABLE_FIELDS, ParamSweepNodeData } from '../types';
import { HeaterProfileDialog, HeaterProfile } from '../dialogs/HeaterProfileDialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Trash2, RefreshCw, Wand2, Settings2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// 加热器预设类型别名
type HeaterProfileItem = HeaterProfile;

// 提取基础预设名称（去除 __N 后缀）
function getBaseProfileName(name: string): string {
  return name.replace(/__\d+$/, '');
}

// 加热器预设选择器 - 纯下拉选择，不包含对话框
function HeaterProfileSelector({ 
  value, 
  onChange,
  profiles,
  loading = false
}: { 
  value: string; 
  onChange: (name: string) => void;
  profiles: HeaterProfileItem[];
  loading?: boolean;
}) {
  // 提取基础名称用于匹配预设列表
  const baseValue = getBaseProfileName(value);
  
  // 处理预设选择，保留原始后缀
  const handleProfileSelect = (newBaseName: string) => {
    const suffix = value.match(/__\d+$/)?.[0] || '';
    onChange(newBaseName + suffix);
  };

  const selectedProfile = profiles?.find(p => p.name === baseValue);
  
  return (
    <Select value={baseValue} onValueChange={handleProfileSelect}>
      <SelectTrigger className="w-full h-auto min-h-9 py-1.5">
        <SelectValue placeholder={loading ? '加载中...' : '选择预设...'}>
          <div className="flex flex-col items-start text-left overflow-hidden">
            <span className="truncate text-sm">{baseValue}</span>
            {selectedProfile?.description && (
              <span className="text-[10px] text-muted-foreground truncate">
                {selectedProfile.description}
              </span>
            )}
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {profiles?.map((p) => (
          <SelectItem key={p.id} value={p.name}>
            <div className="flex flex-col">
              <span>{p.name}</span>
              {p.description && (
                <span className="text-[10px] text-muted-foreground">{p.description}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// 配置加热器字段组件 - 包含预设管理
function ConfigureHeaterFields({ 
  data, 
  handleChange 
}: { 
  data: Record<string, unknown>; 
  handleChange: (key: string, value: unknown) => void;
}) {
  const [profiles, setProfiles] = useState<HeaterProfileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  const loadProfiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/heater-profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data);
      }
    } catch (err) {
      console.error('Failed to load heater profiles:', err);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    loadProfiles();
  }, []);
  
  // 每个传感器的预设: { [sensorIdx]: profileName }
  const sensorProfiles = (data.sensorProfiles || {}) as Record<number, string>;
  
  // 按预设名称分组传感器
  const profileGroups: Record<string, number[]> = {};
  for (let i = 0; i < 8; i++) {
    const profile = sensorProfiles[i] || '';
    if (!profileGroups[profile]) {
      profileGroups[profile] = [];
    }
    profileGroups[profile].push(i);
  }
  // 处理虚拟传感器 (>=8) 用于创建空组
  Object.keys(sensorProfiles).forEach(key => {
    const idx = parseInt(key);
    if (idx >= 8) {
      const profile = sensorProfiles[idx];
      if (profile && !profileGroups[profile]) {
        profileGroups[profile] = [];
      }
    }
  });
  
  // 添加新的配置组
  const handleAddGroup = (profileName: string) => {
    const existingVirtual = Object.keys(sensorProfiles)
      .map(k => parseInt(k))
      .filter(k => k >= 8);
    const nextVirtualIdx = existingVirtual.length > 0 
      ? Math.max(...existingVirtual) + 1 
      : 8;
    
    let uniqueProfileName = profileName;
    const existingProfiles = new Set(Object.values(sensorProfiles).filter(p => p));
    if (existingProfiles.has(profileName)) {
      let counter = 2;
      while (existingProfiles.has(`${profileName}__${counter}`)) {
        counter++;
      }
      uniqueProfileName = `${profileName}__${counter}`;
    }
    
    handleChange('sensorProfiles', { ...sensorProfiles, [nextVirtualIdx]: uniqueProfileName });
  };
  
  // 更新组的传感器
  const handleGroupSensorsChange = (oldProfile: string, newSensors: number[]) => {
    const newProfiles = { ...sensorProfiles };
    Object.keys(newProfiles).forEach(key => {
      const idx = parseInt(key);
      if (newProfiles[idx] === oldProfile && !newSensors.includes(idx)) {
        newProfiles[idx] = '';
      }
    });
    newSensors.forEach(idx => {
      newProfiles[idx] = oldProfile;
    });
    handleChange('sensorProfiles', newProfiles);
  };
  
  // 更新组的预设
  const handleGroupProfileChange = (oldProfile: string, newProfile: string) => {
    const newProfiles = { ...sensorProfiles };
    Object.keys(newProfiles).forEach(key => {
      const idx = parseInt(key);
      if (newProfiles[idx] === oldProfile) {
        newProfiles[idx] = newProfile;
      }
    });
    handleChange('sensorProfiles', newProfiles);
  };
  
  // 删除配置组
  const handleDeleteGroup = (profile: string) => {
    const newProfiles = { ...sensorProfiles };
    Object.keys(newProfiles).forEach(key => {
      const idx = parseInt(key);
      if (newProfiles[idx] === profile) {
        if (idx >= 8) {
          delete newProfiles[idx];
        } else {
          newProfiles[idx] = '';
        }
      }
    });
    handleChange('sensorProfiles', newProfiles);
  };
  
  // 稳定排序：按预设名称字母顺序排列，避免重渲染时顺序跳动
  const activeGroups = Object.entries(profileGroups)
    .filter(([profile]) => profile !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const unassignedSensors = profileGroups[''] || [];
  
  return (
    <>
      <Field label="步骤名称">
        <Input
          value={String(data.name || '')}
          onChange={(e) => handleChange('name', e.target.value)}
        />
      </Field>
      
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">传感器加热配置</Label>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setDialogOpen(true)}
              title="管理预设"
            >
              <Settings2 className="w-3 h-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => handleAddGroup('constant_320')}
            >
              <Plus className="w-3 h-3 mr-1" /> 添加配置
            </Button>
          </div>
        </div>
        
        {/* 配置组列表 */}
        <div className="space-y-2">
          {activeGroups.map(([profile, sensors]) => (
            <div key={profile} className="border rounded-lg p-2 space-y-2 bg-muted/30">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <HeaterProfileSelector
                    value={profile}
                    onChange={(newProfile) => handleGroupProfileChange(profile, newProfile)}
                    profiles={profiles}
                    loading={loading}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => handleDeleteGroup(profile)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              
              {/* 传感器选择网格 */}
              <div className="flex flex-wrap gap-1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => {
                  const isSelected = sensors.includes(idx);
                  const isAssignedElsewhere = !isSelected && Boolean(sensorProfiles[idx]);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={cn(
                        "w-7 h-7 text-xs rounded border transition-colors",
                        isSelected 
                          ? "bg-primary text-primary-foreground border-primary"
                          : isAssignedElsewhere
                            ? "bg-muted text-muted-foreground border-transparent cursor-not-allowed opacity-40"
                            : "bg-background hover:bg-accent border-border"
                      )}
                      disabled={isAssignedElsewhere}
                      onClick={() => {
                        if (isSelected) {
                          handleGroupSensorsChange(profile, sensors.filter(s => s !== idx));
                        } else {
                          handleGroupSensorsChange(profile, [...sensors, idx]);
                        }
                      }}
                    >
                      S{idx}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          
          {activeGroups.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              点击"添加配置"为传感器分配加热预设
            </p>
          )}
        </div>
        
        {/* 未分配的传感器提示 */}
        {unassignedSensors.length > 0 && activeGroups.length > 0 && (
          <p className="text-xs text-amber-600">
            未配置: {unassignedSensors.map(i => `S${i}`).join(', ')}
          </p>
        )}
      </div>
      
      {/* 预设管理对话框 */}
      <HeaterProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onProfilesChange={loadProfiles}
      />
    </>
  );
}

// 传感器网格选择器
function SensorGrid({ 
  selected, 
  onChange 
}: { 
  selected: number[]; 
  onChange: (indices: number[]) => void;
}) {
  const toggle = (idx: number) => {
    onChange(
      selected.includes(idx) 
        ? selected.filter(i => i !== idx) 
        : [...selected, idx].sort()
    );
  };
  
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">选择传感器</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([0, 1, 2, 3, 4, 5, 6, 7])}
          className="h-5 text-[10px] px-1"
        >
          全选
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
          <button
            key={idx}
            onClick={() => toggle(idx)}
            className={cn(
              "h-7 rounded border text-xs font-medium transition-colors",
              selected.includes(idx)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted border-input"
            )}
          >
            S{idx}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        已选: {selected.length === 0 ? '无' : selected.map(i => `S${i}`).join(', ')}
      </p>
    </div>
  );
}

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

// 查找液体源节点连接的进样节点ID列表
function findConnectedInjectNodes(
  liquidSourceId: string,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>
): string[] {
  // 液体源通过 liquid 类型边连接到进样节点
  return edges
    .filter(e => e.source === liquidSourceId && e.sourceHandle === HANDLE_TYPES.LIQUID)
    .map(e => e.target);
}

// 递归查找包含指定节点的所有父级扫描节点（支持嵌套扫描穿透）
function findParentSweepNodesRecursive(
  nodeId: string,
  nodes: Array<{ id: string; type?: string; data: unknown }>,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
  visited: Set<string> = new Set()
): Array<{ id: string; name: string; paramType: string; variableName: string }> {
  const parentSweeps: Array<{ id: string; name: string; paramType: string; variableName: string }> = [];
  const loopBodyEdges = edges.filter(e => e.sourceHandle === HANDLE_TYPES.LOOP_BODY);
  const sweepNodes = nodes.filter(n => n.type === NodeType.PARAM_SWEEP);
  
  for (const sweepNode of sweepNodes) {
    if (visited.has(sweepNode.id)) continue;
    
    const bodyStartEdge = loopBodyEdges.find(e => e.source === sweepNode.id);
    if (!bodyStartEdge) continue;
    
    // 检查扫描体是否包含目标节点（包括嵌套的扫描/循环内部）
    if (isNodeInSweepBody(nodeId, sweepNode.id, nodes, edges)) {
      const data = sweepNode.data as ParamSweepNodeData;
      parentSweeps.push({
        id: sweepNode.id,
        name: data.name || '参数扫描',
        paramType: data.paramType || 'volume',
        variableName: data.variableName || `${data.name || '扫描'}.${data.paramType || 'value'}`,
      });
      
      // 递归查找外层扫描节点
      visited.add(sweepNode.id);
      const outerSweeps = findParentSweepNodesRecursive(sweepNode.id, nodes, edges, visited);
      parentSweeps.push(...outerSweeps);
    }
  }
  
  return parentSweeps;
}

// 检查节点是否在扫描体内（支持嵌套穿透）
function isNodeInSweepBody(
  nodeId: string,
  sweepNodeId: string,
  nodes: Array<{ id: string; type?: string; data: unknown }>,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>
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
    
    // 先检查是否找到目标节点
    if (currentId === nodeId) return true;
    
    // 如果是嵌套的扫描/循环节点，也检查其内部
    const currentNode = nodes.find(n => n.id === currentId);
    if (currentNode?.type === NodeType.PARAM_SWEEP || currentNode?.type === NodeType.LOOP) {
      const nestedBodyEdge = edges.find(e => e.source === currentId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY);
      if (nestedBodyEdge) {
        queue.push(nestedBodyEdge.target);
      }
    }
    
    // 检查是否回到扫描节点（在处理嵌套节点之后）
    const returnEdge = edges.find(e => 
      e.source === currentId && 
      e.targetHandle === HANDLE_TYPES.LOOP_BODY && 
      e.target === sweepNodeId
    );
    if (returnEdge) continue; // 不继续沿 flow 边，但继续处理队列中的其他节点
    
    // 继续沿 flow 边
    const nextEdge = flowEdges.find(e => e.source === currentId);
    if (nextEdge) queue.push(nextEdge.target);
  }
  
  return false;
}

// 查找包含指定节点的所有父级扫描/循环节点（支持嵌套穿透）
function findParentSweepNodes(
  nodeId: string,
  nodes: Array<{ id: string; type?: string; data: unknown }>,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>
): Array<{ id: string; name: string; paramType: string; variableName: string }> {
  const parentSweeps: Array<{ id: string; name: string; paramType: string; variableName: string }> = [];
  
  // 对于每个扫描节点，检查其扫描体是否包含目标节点（使用穿透逻辑）
  const sweepNodes = nodes.filter(n => n.type === NodeType.PARAM_SWEEP);
  
  for (const sweepNode of sweepNodes) {
    // 使用穿透逻辑检查节点是否在扫描体内（包括嵌套的扫描/循环内部）
    if (isNodeInSweepBody(nodeId, sweepNode.id, nodes, edges)) {
      const data = sweepNode.data as ParamSweepNodeData;
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

export function PropertyPanel() {
  const { nodes, edges, selectedNodeId, updateNodeData, deleteNode } = useEditorStore();
  
  // 液体库状态
  const [liquids, setLiquids] = useState<LiquidItem[]>([]);
  const [loadingLiquids, setLoadingLiquids] = useState(false);
  
  // 序列生成器状态
  const [seqGenType, setSeqGenType] = useState<SeqGenType>('linear');
  const [seqGenSteps, setSeqGenSteps] = useState(5);
  
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const nodeType = selectedNode?.type as NodeType | undefined;
  
  // 查找当前节点所在的扫描体 (必须在所有条件返回之前调用)
  const parentSweeps = useMemo(() => {
    if (!selectedNode) return [];
    return findParentSweepNodes(selectedNode.id, nodes, edges);
  }, [selectedNode, nodes, edges]);
  
  // 检查当前节点类型是否可以绑定扫描变量 (必须在所有条件返回之前调用)
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
  
  // 加载液体库
  const loadLiquids = useCallback(async () => {
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
  }, []);
  
  // 初始加载液体库
  useEffect(() => {
    loadLiquids();
  }, [loadLiquids]);
  
  // 筛选清洗液（category 为 cleaning 或 name 包含清洗/水/乙醇）
  const washLiquids = useMemo(() => {
    return liquids.filter(l => 
      l.category === 'cleaning' || 
      l.name.includes('水') || 
      l.name.includes('清洗') ||
      l.name.includes('乙醇')
    );
  }, [liquids]);
  
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
        
      case NodeType.INJECT: {
        // 检测节点数据中的绑定状态（只有明确绑定才禁用）
        const injectBoundVars = (data.boundVariables || {}) as Record<string, string>;
        const isVolumeBound = !!injectBoundVars.targetVolumeMl;
        const isRatioBound = !!injectBoundVars.ratio;
        
        // 获取绑定的扫描节点名称
        const volumeBoundSweep = isVolumeBound ? nodes.find(n => n.id === injectBoundVars.targetVolumeMl) : null;
        const ratioBoundSweep = isRatioBound ? nodes.find(n => n.id === injectBoundVars.ratio) : null;
        const volumeBoundName = volumeBoundSweep ? (volumeBoundSweep.data as Record<string, unknown>).name as string || '参数扫描' : '';
        const ratioBoundName = ratioBoundSweep ? (ratioBoundSweep.data as Record<string, unknown>).name as string || '参数扫描' : '';
        
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            
            {/* 已绑定的扫描变量提示 */}
            {(isVolumeBound || isRatioBound) && (
              <div className="p-2 bg-pink-500/10 border border-pink-500/30 rounded text-xs space-y-1">
                <div className="font-medium text-pink-600">⟳ 已绑定扫描变量</div>
                {isVolumeBound && (
                  <div className="text-pink-500">进样量 ← {volumeBoundName}</div>
                )}
                {isRatioBound && (
                  <div className="text-pink-500">混合比例 ← {ratioBoundName}</div>
                )}
              </div>
            )}
            
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
              <Field label={`目标体积 (ml)${isVolumeBound ? ' - 由扫描控制' : ''}`}>
                <Input
                  type="number"
                  step={0.1}
                  value={Number(data.targetVolumeMl || 0)}
                  onChange={(e) => handleChange('targetVolumeMl', parseFloat(e.target.value) || 0)}
                  disabled={isVolumeBound}
                  className={isVolumeBound ? 'opacity-50 cursor-not-allowed' : ''}
                />
                {isVolumeBound && (
                  <p className="text-[10px] text-pink-500 mt-1">
                    由「{volumeBoundName}」扫描控制
                  </p>
                )}
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
            <Field label="流速 (ml/s)">
              <Input
                type="number"
                step={0.1}
                value={Number(data.flowRateMlS || 0.5)}
                onChange={(e) => handleChange('flowRateMlS', parseFloat(e.target.value) || 0.5)}
              />
            </Field>
            <Field label="稳定超时 (s)">
              <Input
                type="number"
                step={1}
                min={5}
                max={300}
                value={Number(data.stableTimeoutS || 5)}
                onChange={(e) => handleChange('stableTimeoutS', parseFloat(e.target.value) || 5)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                进样完成后等待称重稳定的超时时间
              </p>
            </Field>
          </>
        );
      }
      
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
        
      case NodeType.LIQUID_SOURCE: {
        // 检测连接的进样节点是否明确绑定了 ratio 扫描变量
        const connectedInjectIds = findConnectedInjectNodes(selectedNode.id, edges);
        let ratioBindingForLiquid: { sweepName: string; injectName: string } | undefined;
        
        for (const injectId of connectedInjectIds) {
          const injectNode = nodes.find(n => n.id === injectId);
          if (injectNode) {
            const injectData = injectNode.data as Record<string, unknown>;
            const injectBoundVars = (injectData.boundVariables || {}) as Record<string, string>;
            // 只有当进样节点明确绑定了 ratio 扫描时才禁用
            if (injectBoundVars.ratio) {
              const boundSweep = nodes.find(n => n.id === injectBoundVars.ratio);
              ratioBindingForLiquid = {
                sweepName: boundSweep ? (boundSweep.data as Record<string, unknown>).name as string || '参数扫描' : '参数扫描',
                injectName: injectData.name as string || '进样',
              };
              break;
            }
          }
        }
        
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
            
            {/* 比例扫描绑定提示 - 只有明确绑定时才显示 */}
            {ratioBindingForLiquid && (
              <div className="p-2 bg-pink-500/10 border border-pink-500/30 rounded text-xs">
                <div className="font-medium text-pink-600">⟳ 比例由扫描控制</div>
                <div className="text-pink-500 text-[10px] mt-1">
                  「{ratioBindingForLiquid.sweepName}」→「{ratioBindingForLiquid.injectName}」
                </div>
              </div>
            )}
            
            <Field label={`比例 (${((Number(data.ratio) || 1) * 100).toFixed(0)}%)${ratioBindingForLiquid ? ' - 由扫描控制' : ''}`}>
              <Slider
                value={[Number(data.ratio || 1) * 100]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => handleChange('ratio', v / 100)}
                disabled={!!ratioBindingForLiquid}
                className={ratioBindingForLiquid ? 'opacity-50' : ''}
              />
            </Field>
            <p className="text-xs text-muted-foreground mt-2">
              注：泵编号在耗材管理中配置，此处只需选择液体类型和比例
            </p>
          </>
        );
      }
      
      case NodeType.WASH:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="清洗液">
              <div className="flex gap-2">
                <Select
                  value={String(data.washLiquidId || '')}
                  onValueChange={(v) => {
                    const liquid = washLiquids.find(l => l.id === v);
                    if (liquid) {
                      handleChange('washLiquidId', liquid.id);
                      handleChange('washLiquidName', liquid.name);
                    }
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="选择清洗液..." />
                  </SelectTrigger>
                  <SelectContent>
                    {washLiquids.length === 0 ? (
                      <SelectItem value="_empty" disabled>暂无清洗液</SelectItem>
                    ) : (
                      washLiquids.map((liquid) => (
                        <SelectItem key={liquid.id} value={liquid.id}>
                          {liquid.name}
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
              <p className="text-[10px] text-muted-foreground mt-1">
                需要在耗材管理页面添加清洗液（类别设为 cleaning）
              </p>
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
            <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-600 mt-2">
              <p className="font-medium mb-1">清洗流程说明：</p>
              <p>每次清洗循环：排废确认空瓶 → 注入清洗液 → 排废</p>
              <p className="mt-1">多次清洗时，每次循环之间都会排废以防止溢出。</p>
            </div>
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
            {data.terminationType === 'stability' && (
              <>
                <Field label="稳定窗口 (秒)">
                  <Input
                    type="number"
                    value={Number(data.stabilityWindowS || 30)}
                    onChange={(e) => handleChange('stabilityWindowS', parseInt(e.target.value) || 30)}
                  />
                </Field>
                <Field label="稳定阈值 (%)">
                  <Input
                    type="number"
                    value={Number(data.stabilityThresholdPercent || 5)}
                    onChange={(e) => handleChange('stabilityThresholdPercent', parseInt(e.target.value) || 5)}
                  />
                </Field>
              </>
            )}
            {data.terminationType !== 'duration' && (
              <Field label="最大时长 (秒)">
                <Input
                  type="number"
                  value={Number(data.maxDurationS || 300)}
                  onChange={(e) => handleChange('maxDurationS', parseInt(e.target.value) || 300)}
                />
              </Field>
            )}
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
      
      case NodeType.PREHEAT:
        return (
          <>
            <Field label="步骤名称">
              <Input
                value={String(data.name || '')}
                onChange={(e) => handleChange('name', e.target.value)}
              />
            </Field>
            <Field label="预热模式">
              <Select
                value={String(data.preheatMode || 'duration')}
                onValueChange={(v) => handleChange('preheatMode', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="duration">固定时间 (秒)</SelectItem>
                  <SelectItem value="cycles">加热周期数</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {data.preheatMode === 'cycles' ? (
              <Field label="预热周期数">
                <Input
                  type="number"
                  min={1}
                  value={Number(data.cycles || 3)}
                  onChange={(e) => handleChange('cycles', parseInt(e.target.value) || 3)}
                />
              </Field>
            ) : (
              <Field label="预热时间 (秒)">
                <Input
                  type="number"
                  min={10}
                  value={Number(data.durationS || 60)}
                  onChange={(e) => handleChange('durationS', parseInt(e.target.value) || 60)}
                />
              </Field>
            )}
            <Field label="最大时长 (秒)">
              <Input
                type="number"
                min={30}
                value={Number(data.maxDurationS || 300)}
                onChange={(e) => handleChange('maxDurationS', parseInt(e.target.value) || 300)}
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
            <Field label="记录预热数据">
              <div className="flex items-center gap-2">
                <Switch
                  checked={Boolean(data.recordData)}
                  onCheckedChange={(checked) => handleChange('recordData', checked)}
                />
                <span className="text-sm text-muted-foreground">
                  {data.recordData ? '是 (phase=PREHEAT)' : '否'}
                </span>
              </div>
            </Field>
          </>
        );
      
      case NodeType.CONFIGURE_HEATER:
        return <ConfigureHeaterFields data={data} handleChange={handleChange} />;
      
      case NodeType.END:
        return <p className="text-sm text-muted-foreground">实验结束节点，无可编辑属性</p>;
        
      default:
        return <p className="text-sm text-muted-foreground">此节点没有可编辑的属性</p>;
    }
  };

  // 当前节点的变量绑定
  const boundVariables = (data.boundVariables || {}) as Record<string, string>;

  return (
    <div className="h-full bg-muted/30 border-l overflow-y-auto">
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
        
        {/* 显示所在扫描体信息（调试） */}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
