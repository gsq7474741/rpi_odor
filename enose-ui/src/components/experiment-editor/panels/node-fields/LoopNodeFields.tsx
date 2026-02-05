'use client';

import { Input } from '@/components/ui/input';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function LoopNodeFields({ data, handleChange }: NodeFieldsProps) {
  return (
    <Field label="循环次数">
      <Input
        type="number"
        min={1}
        max={100}
        value={Number(data.count || 1)}
        onChange={(e) => handleChange('count', parseInt(e.target.value) || 1)}
      />
    </Field>
  );
}
