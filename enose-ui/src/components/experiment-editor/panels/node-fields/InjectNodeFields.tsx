'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from './Field';
import { NodeFieldsProps } from './types';
import { ExperimentNode } from '../../types';

interface InjectNodeFieldsProps extends NodeFieldsProps {
  nodes: ExperimentNode[];
}

export function InjectNodeFields({ data, handleChange, nodes }: InjectNodeFieldsProps) {
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
