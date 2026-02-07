'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Field } from './Field';
import { NodeFieldsWithExternalDataProps, NodeFieldsWithContextProps } from './types';
import { HANDLE_TYPES, ExperimentNode, ExperimentEdge } from '../../types';

interface LiquidSourceFieldsProps extends NodeFieldsWithExternalDataProps, NodeFieldsWithContextProps {}

// 查找液体源节点连接的进样节点ID列表
function findConnectedInjectNodes(
  liquidSourceId: string,
  edges: ExperimentEdge[]
): string[] {
  return edges
    .filter(e => e.source === liquidSourceId && e.sourceHandle === HANDLE_TYPES.LIQUID)
    .map(e => e.target);
}

export function LiquidSourceFields({ 
  data, 
  handleChange,
  liquids,
  pumpAssignments,
  loadingLiquids,
  onRefreshLiquids,
  nodeId,
  nodes,
  edges
}: LiquidSourceFieldsProps) {
  // 检测连接的进样节点是否明确绑定了 ratio 扫描变量
  const connectedInjectIds = findConnectedInjectNodes(nodeId, edges);
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
                // 从泵配置中查找该液体对应的泵索引
                const pumpAssignment = pumpAssignments.find(p => String(p.liquidId) === liquid.id);
                handleChange('pumpIndex', pumpAssignment?.pumpIndex ?? -1);
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
            onClick={onRefreshLiquids}
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
      <Field label="标记为稀释液">
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(data.isSolvent)}
            onCheckedChange={(v) => handleChange('isSolvent', v)}
          />
          <span className="text-xs text-muted-foreground">
            {data.isSolvent ? '此液体在本实验中为稀释液/溶剂' : '非稀释液'}
          </span>
        </div>
      </Field>
      <p className="text-xs text-muted-foreground mt-2">
        注：泵编号在耗材管理中配置，此处只需选择液体类型和比例
      </p>
    </>
  );
}
