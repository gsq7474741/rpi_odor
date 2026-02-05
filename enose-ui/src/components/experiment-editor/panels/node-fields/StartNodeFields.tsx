'use client';

import { Input } from '@/components/ui/input';
import { Field } from './Field';
import { NodeFieldsProps } from './types';

export function StartNodeFields({ data, handleChange }: NodeFieldsProps) {
  return (
    <>
      <Field label="程序ID">
        <Input
          value={String(data.programId || '')}
          onChange={(e) => handleChange('programId', e.target.value)}
          placeholder="my_experiment"
        />
      </Field>
      <Field label="程序名称">
        <Input
          value={String(data.programName || '')}
          onChange={(e) => handleChange('programName', e.target.value)}
          placeholder="我的实验"
        />
      </Field>
      <Field label="描述">
        <Input
          value={String(data.description || '')}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="实验描述..."
        />
      </Field>
      <Field label="版本">
        <Input
          value={String(data.version || '1.0.0')}
          onChange={(e) => handleChange('version', e.target.value)}
          placeholder="1.0.0"
        />
      </Field>
    </>
  );
}
