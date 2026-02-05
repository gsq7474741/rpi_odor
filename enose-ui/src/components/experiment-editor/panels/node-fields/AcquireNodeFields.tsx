'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function AcquireNodeFields({ data, handleChange }: NodeFieldsProps) {
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
}
