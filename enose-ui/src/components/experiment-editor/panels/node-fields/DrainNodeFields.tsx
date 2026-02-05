'use client';

import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function DrainNodeFields({ data, handleChange }: NodeFieldsProps) {
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
}
