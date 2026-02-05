'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Field } from './Field';
import { NodeFieldsProps } from './types';
import { EXPERIMENT_PHASES } from '../../types';

export function PhaseMarkerFields({ data, handleChange }: NodeFieldsProps) {
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
}
