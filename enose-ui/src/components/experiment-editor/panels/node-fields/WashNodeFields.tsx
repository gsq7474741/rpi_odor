'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Field } from './Field';
import { NodeFieldsWithExternalDataProps } from './types';

export function WashNodeFields({ 
  data, 
  handleChange,
  liquids,
  loadingLiquids,
  onRefreshLiquids
}: NodeFieldsWithExternalDataProps) {
  // 筛选清洗液（type=2 为清洗液）
  const washLiquids = useMemo(() => {
    return liquids.filter(l => l.type === 2);
  }, [liquids]);
  
  return (
    <>
      <Field label="步骤名称">
        <Input
          value={String(data.name || '')}
          onChange={(e) => handleChange('name', e.target.value)}
        />
      </Field>
      <Field label="清洗液">
        <div className="flex gap-2">
          <Select
            value={String(data.washLiquidId || '')}
            onValueChange={(v) => {
              const liquid = washLiquids.find(l => l.id === v);
              if (liquid) {
                handleChange('washLiquidId', liquid.id);
                handleChange('washLiquidName', liquid.name);
              }
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="选择清洗液..." />
            </SelectTrigger>
            <SelectContent>
              {washLiquids.length === 0 ? (
                <SelectItem value="_empty" disabled>暂无清洗液</SelectItem>
              ) : (
                washLiquids.map((liquid) => (
                  <SelectItem key={liquid.id} value={liquid.id}>
                    {liquid.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={onRefreshLiquids}
            disabled={loadingLiquids}
          >
            <RefreshCw className={`w-4 h-4 ${loadingLiquids ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          需要在耗材管理页面添加清洗液（类别设为 cleaning）
        </p>
      </Field>
      <Field label="每次清洗量 (ml)">
        <Input
          type="number"
          step={5}
          value={Number(data.washVolumeMl || 20)}
          onChange={(e) => handleChange('washVolumeMl', parseFloat(e.target.value) || 20)}
        />
      </Field>
      <Field label="重复次数">
        <Input
          type="number"
          min={1}
          max={10}
          value={Number(data.repeatCount || 2)}
          onChange={(e) => handleChange('repeatCount', parseInt(e.target.value) || 2)}
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
      <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-600 mt-2">
        <p className="font-medium mb-1">清洗流程说明：</p>
        <p>每次清洗循环：排废确认空瓶 → 注入清洗液 → 排废</p>
        <p className="mt-1">多次清洗时，每次循环之间都会排废以防止溢出。</p>
      </div>
    </>
  );
}
