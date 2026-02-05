'use client';

import { Input } from '@/components/ui/input';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function WaitTimeFields({ data, handleChange }: NodeFieldsProps) {
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
}

export function WaitCyclesFields({ data, handleChange }: NodeFieldsProps) {
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
}

export function WaitStabilityFields({ data, handleChange }: NodeFieldsProps) {
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
}
