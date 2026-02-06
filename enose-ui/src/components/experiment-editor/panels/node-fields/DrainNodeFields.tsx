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
      <Field label={`气泵 PWM (${data.gasPumpPwm ?? 100}%)`}>
        <Slider
          value={[Number(data.gasPumpPwm ?? 100)]}
          min={0}
          max={100}
          step={5}
          onValueChange={([v]) => handleChange('gasPumpPwm', v)}
        />
      </Field>
      <Field label="空瓶容差 (g)">
        <Input
          type="number"
          step={1}
          value={Number(data.emptyToleranceG || 10)}
          onChange={(e) => handleChange('emptyToleranceG', parseFloat(e.target.value) || 10)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          重量变化小于此值视为空瓶
        </p>
      </Field>
      <Field label="稳定窗口 (秒)">
        <Input
          type="number"
          step={0.5}
          min={0.5}
          max={30}
          value={Number(data.stabilityWindowS || 5)}
          onChange={(e) => handleChange('stabilityWindowS', parseFloat(e.target.value) || 5)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          空瓶检测后保持稳定的确认时间
        </p>
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
