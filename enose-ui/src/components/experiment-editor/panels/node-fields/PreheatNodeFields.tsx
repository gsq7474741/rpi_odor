'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function PreheatNodeFields({ data, handleChange }: NodeFieldsProps) {
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
}
