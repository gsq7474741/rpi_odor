'use client';

import { Input } from '@/components/ui/input';
import { Field } from './Field';
import { NodeFieldsProps } from './types';
import { useEditorStore } from '../../store';

export function StartNodeFields({ data, handleChange }: NodeFieldsProps) {
  const currentFilename = useEditorStore((state) => state.currentFilename);
  
  // 从文件名派生显示名称（去掉 .yaml 扩展名）
  const displayName = currentFilename 
    ? currentFilename.replace(/\.ya?ml$/i, '') 
    : '未保存的程序';
  
  return (
    <>
      <Field label="程序文件">
        <div className="px-3 py-2 text-sm bg-muted rounded-md font-mono">
          {displayName}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          程序标识符由文件名决定
        </p>
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
