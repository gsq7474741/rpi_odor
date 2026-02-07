'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { RefreshCw, ChevronDown, Scale, Timer } from 'lucide-react';
import { Field } from './Field';
import { NodeFieldsWithExternalDataProps } from './types';

export function WashNodeFields({ 
  data, 
  handleChange,
  liquids,
  loadingLiquids,
  onRefreshLiquids
}: NodeFieldsWithExternalDataProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  
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
      <Field label="注入控制模式">
        <ToggleGroup
          type="single"
          value={String(data.fillMode || 'weight')}
          onValueChange={(v) => { if (v) handleChange('fillMode', v); }}
          className="justify-start"
        >
          <ToggleGroupItem value="weight" className="gap-1 text-xs px-3">
            <Scale className="w-3.5 h-3.5" />
            称重
          </ToggleGroupItem>
          <ToggleGroupItem value="timed" className="gap-1 text-xs px-3">
            <Timer className="w-3.5 h-3.5" />
            定时
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field label="每次清洗量 (ml)">
        <Input
          type="number"
          step={5}
          value={Number(data.washVolumeMl || 20)}
          onChange={(e) => handleChange('washVolumeMl', parseFloat(e.target.value) || 20)}
        />
        {data.fillMode === 'timed' && (
          <p className="text-[10px] text-muted-foreground mt-1">
            定时模式: 注入约 {((Number(data.washVolumeMl) || 20) / 10).toFixed(1)} 秒（基于 10 ml/s 流速）
          </p>
        )}
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
      <Field label={`排废气泵 PWM (${data.gasPumpPwm || 50}%)`}>
        <Slider
          value={[Number(data.gasPumpPwm || 50)]}
          min={0}
          max={100}
          step={5}
          onValueChange={([v]) => handleChange('gasPumpPwm', v)}
        />
      </Field>
      
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground mt-1">
            高级参数
            <ChevronDown className={`w-3 h-3 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 mt-1">
          <Field label="注入超时 (秒)">
            <Input
              type="number"
              min={1}
              max={120}
              value={Number(data.fillTimeoutS ?? 60)}
              onChange={(e) => handleChange('fillTimeoutS', parseFloat(e.target.value) || 60)}
            />
          </Field>
          <Field label="排废超时 (秒)">
            <Input
              type="number"
              min={1}
              max={120}
              value={Number(data.drainTimeoutS ?? 60)}
              onChange={(e) => handleChange('drainTimeoutS', parseFloat(e.target.value) || 60)}
            />
          </Field>
          <Field label="空瓶检测容差 (g)">
            <Input
              type="number"
              min={1}
              max={50}
              step={1}
              value={Number(data.emptyToleranceG ?? 10)}
              onChange={(e) => handleChange('emptyToleranceG', parseFloat(e.target.value) || 10)}
            />
          </Field>
          <Field label="空瓶稳定窗口 (秒)">
            <Input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={Number(data.emptyStabilityWindowS ?? 2)}
              onChange={(e) => handleChange('emptyStabilityWindowS', parseFloat(e.target.value) || 2)}
            />
          </Field>
        </CollapsibleContent>
      </Collapsible>
      
      <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-600 mt-2">
        <p className="font-medium mb-1">清洗流程说明：</p>
        <p>每次清洗循环：排废确认空瓶 → 注入清洗液 → 排废</p>
        <p className="mt-1">
          {data.fillMode === 'timed' 
            ? '定时模式：按体积÷流速计算注入时长，开环控制。' 
            : '称重模式：通过称重传感器检测注入量，达到目标即停止。'}
        </p>
      </div>
    </>
  );
}
