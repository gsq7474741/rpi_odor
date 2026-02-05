'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Field } from './Field';
import { NodeFieldsProps } from './types';
import { SYSTEM_STATES } from '../../types';

export function SetStateFields({ data, handleChange }: NodeFieldsProps) {
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
}

export function SetGasPumpFields({ data, handleChange }: NodeFieldsProps) {
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
}
