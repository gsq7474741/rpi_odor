'use client';

import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Field } from './Field';
import { NodeFieldsProps } from './types';
import { ExperimentNode, ExperimentEdge } from '../../types';
import { HeaterProfile, fetchHeaterProfiles } from '../../data-fetcher';
import { findPrecedingConfigureHeater, computeMaxCycleDurationS } from './heater-cycle-utils';

interface AcquireNodeFieldsProps extends NodeFieldsProps {
  nodeId?: string;
  nodes?: ExperimentNode[];
  edges?: ExperimentEdge[];
}

export function AcquireNodeFields({ data, handleChange, nodeId, nodes, edges }: AcquireNodeFieldsProps) {
  const [profiles, setProfiles] = useState<HeaterProfile[]>([]);

  useEffect(() => {
    fetchHeaterProfiles().then(setProfiles);
  }, []);

  // 计算上游最长加热周期时长
  const maxCycleDurS = useMemo(() => {
    if (!nodeId || !nodes?.length || !edges?.length || !profiles.length) return 0;
    const configNode = findPrecedingConfigureHeater(nodeId, nodes, edges);
    if (!configNode) return 0;
    return computeMaxCycleDurationS(configNode, profiles);
  }, [nodeId, nodes, edges, profiles]);

  const cycleDurS = maxCycleDurS > 0 ? maxCycleDurS : 11;
  const windowCycles = Math.max(5, Math.floor((Number(data.stabilityWindowS) || 30) / 10));

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
          onValueChange={(v) => {
            handleChange('terminationType', v);
            if (v === 'duration' && !data.durationS) {
              handleChange('durationS', 60);
            } else if (v === 'cycles' && !data.heaterCycles) {
              handleChange('heaterCycles', 10);
            } else if (v === 'stability') {
              if (!data.stabilityWindowS) handleChange('stabilityWindowS', 30);
              if (!data.stabilityThresholdPercent) handleChange('stabilityThresholdPercent', 5);
            }
          }}
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
        <Field
          label="加热周期数"
          hint={`等待加热器完成指定数量的完整温度扫描周期（每周期 ≈ ${cycleDurS.toFixed(1)}s）`}
        >
          <Input
            type="number"
            value={Number(data.heaterCycles || 10)}
            onChange={(e) => handleChange('heaterCycles', parseInt(e.target.value) || 10)}
          />
        </Field>
      )}
      {data.terminationType === 'stability' && (
        <>
          <div className="rounded-md bg-muted/50 border px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
            按 <span className="font-medium text-foreground">(传感器 × 加热步骤)</span> 分组，
            每组仅比较<span className="font-medium text-foreground">同一温度点在不同周期间</span>的读数漂移。
            <span className="font-medium text-foreground">所有组都达标后同时截断</span>，周期最长的配置决定收敛速度。
          </div>
          <Field
            label="比较窗口 (周期数)"
            hint={`保留最近 ${windowCycles} 个周期的读数（≈ ${Math.round(windowCycles * cycleDurS)}s，基于上一步最长配置 ${cycleDurS.toFixed(1)}s/周期）`}
          >
            <Input
              type="number"
              min={3}
              value={windowCycles}
              onChange={(e) => {
                const cycles = Math.max(3, parseInt(e.target.value) || 5);
                handleChange('stabilityWindowS', cycles * 10);
              }}
            />
          </Field>
          <Field
            label="跨周期变化率阈值 (%)"
            hint="同一 (传感器, 加热步骤) 在窗口内各周期读数的 (max−min)/mean，所有组都低于此值时判定稳定"
          >
            <Input
              type="number"
              min={0.1}
              step={0.5}
              value={Number(data.stabilityThresholdPercent || 5)}
              onChange={(e) => handleChange('stabilityThresholdPercent', parseFloat(e.target.value) || 5)}
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
