'use client';

import { Input } from '@/components/ui/input';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function HardwareConfigFields({ data, handleChange }: NodeFieldsProps) {
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
}
