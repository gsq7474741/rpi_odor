'use client';

import { memo } from 'react';
import { NodeProps, useEdges, useNodes } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeType, SYSTEM_STATES, HANDLE_TYPES } from '../types';

// 开始节点
export const StartNode = memo(function StartNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs text-muted-foreground">
        <div className="font-medium">{data.programName as string || '新实验'}</div>
        <div className="text-[10px] opacity-70">v{data.version as string || '1.0.0'}</div>
      </div>
    </BaseNode>
  );
});

// 结束节点
export const EndNode = memo(function EndNode(props: NodeProps) {
  return (
    <BaseNode {...props}>
      <div className="text-xs text-muted-foreground">实验结束</div>
    </BaseNode>
  );
});

// 循环节点
export const LoopNode = memo(function LoopNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs">
        <span className="text-muted-foreground">重复 </span>
        <span className="font-medium">{String(data.count ?? 1)}</span>
        <span className="text-muted-foreground"> 次</span>
      </div>
    </BaseNode>
  );
});

// 阶段标记节点
export const PhaseMarkerNode = memo(function PhaseMarkerNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs">
        <span className="font-medium">{data.phaseName as string || 'SAMPLE'}</span>
        <span className="text-muted-foreground ml-1">
          {data.isStart ? '开始' : '结束'}
        </span>
      </div>
    </BaseNode>
  );
});

// 进样节点
export const InjectNode = memo(function InjectNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const edges = useEdges();
  const nodes = useNodes();
  
  const targetType = data.targetType as string;
  const targetValue = targetType === 'volume' 
    ? Number(data.targetVolumeMl ?? 0)
    : Number(data.targetWeightG ?? 0);
  const valueUnit = targetType === 'volume' ? 'ml' : 'g';
  
  // 获取连接到此进样节点的液体源
  const liquidEdges = edges.filter(
    (e) => e.target === props.id && e.targetHandle === HANDLE_TYPES.LIQUID
  );
  const connectedLiquids = liquidEdges.map((edge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (sourceNode?.type === NodeType.LIQUID_SOURCE) {
      const sourceData = sourceNode.data as Record<string, unknown>;
      return {
        name: sourceData.liquidName as string || '未命名',
        ratio: Number(sourceData.ratio ?? 1),
      };
    }
    return null;
  }).filter(Boolean) as { name: string; ratio: number }[];
  
  // 计算总比例（以百分比计算，应该等于100）
  const totalRatioPercent = connectedLiquids.reduce((sum, l) => sum + l.ratio * 100, 0);
  const isRatioValid = Math.abs(totalRatioPercent - 100) < 0.1; // 允许0.1%误差
  
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{String(data.name ?? '进样')}</div>
        <div className="text-muted-foreground">
          总量: {targetValue} {valueUnit}
        </div>
        {connectedLiquids.length > 0 ? (
          <>
            <div className="text-[10px] space-y-0.5 pt-1 border-t border-border/50">
              {connectedLiquids.map((liquid, i) => {
                const amount = (targetValue * liquid.ratio).toFixed(1);
                return (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span>{liquid.name}</span>
                    <span>{amount} {valueUnit} ({(liquid.ratio * 100).toFixed(0)}%)</span>
                  </div>
                );
              })}
            </div>
            {!isRatioValid && (
              <div className="text-[10px] text-red-500">
                ⚠ 比例总和: {totalRatioPercent.toFixed(0)}% (应为100%)
              </div>
            )}
          </>
        ) : (
          <div className="text-[10px] text-amber-500">⚠ 未连接液体源</div>
        )}
      </div>
    </BaseNode>
  );
});

// 排废节点
export const DrainNode = memo(function DrainNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '排废'}</div>
        <div className="text-muted-foreground">
          气泵: {String(data.gasPumpPwm ?? 80)}%
        </div>
        <div className="text-muted-foreground">
          超时: {String(data.timeoutS ?? 60)}s
        </div>
      </div>
    </BaseNode>
  );
});

// 液体源节点
export const LiquidSourceNode = memo(function LiquidSourceNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const ratio = (data.ratio as number) ?? 1;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.liquidName as string || '未选择'}</div>
        <div className="text-muted-foreground">
          比例: {(ratio * 100).toFixed(0)}%
        </div>
      </div>
    </BaseNode>
  );
});

// 清洗节点
export const WashNode = memo(function WashNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '清洗'}</div>
        <div className="text-muted-foreground">
          {String(data.washVolumeMl ?? 20)} ml × {String(data.repeatCount ?? 1)}
        </div>
        <div className="text-muted-foreground">
          气泵: {String(data.gasPumpPwm ?? 50)}%
        </div>
      </div>
    </BaseNode>
  );
});

// 参数扫描节点
export const ParamSweepNode = memo(function ParamSweepNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const paramTypeLabels: Record<string, string> = {
    ratio: '混合比例',
    volume: '进样量',
    gasPumpPwm: '气泵速度',
    duration: '采集时间',
    cycles: '采集周期',
  };
  const paramType = data.paramType as string || 'volume';
  const ratioSweepPoints = (data.ratioSweepPoints as Array<unknown>) || [];
  
  // 计算迭代次数
  let iterations = 0;
  if (paramType === 'ratio') {
    iterations = ratioSweepPoints.length;
  } else {
    const start = data.startValue as number ?? 0;
    const end = data.endValue as number ?? 100;
    const step = data.stepValue as number ?? 10;
    iterations = step > 0 ? Math.floor((end - start) / step) + 1 : 1;
  }
  
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '参数扫描'}</div>
        <div className="text-muted-foreground">
          {paramTypeLabels[paramType] || paramType}
        </div>
        {paramType === 'ratio' ? (
          <div className="text-muted-foreground">
            {iterations > 0 ? `${iterations} 组比例配置` : '未配置扫描点'}
          </div>
        ) : (
          <div className="text-muted-foreground">
            {String(data.startValue ?? 0)} → {String(data.endValue ?? 100)}
          </div>
        )}
        <div className="text-pink-500 font-medium">
          ⟳ {iterations} 次迭代
        </div>
      </div>
    </BaseNode>
  );
});

// 数据采集节点
export const AcquireNode = memo(function AcquireNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const termType = data.terminationType as string;
  let termText = '';
  if (termType === 'duration') {
    termText = `${data.durationS || 0}s`;
  } else if (termType === 'cycles') {
    termText = `${data.heaterCycles || 0} 周期`;
  } else {
    termText = '稳定后';
  }
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '数据采集'}</div>
        <div className="text-muted-foreground">
          气泵: {String(data.gasPumpPwm ?? 50)}%
        </div>
        <div className="text-muted-foreground">
          终止: {termText}
        </div>
      </div>
    </BaseNode>
  );
});

// 等待时间节点
export const WaitTimeNode = memo(function WaitTimeNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '等待'}</div>
        <div className="text-muted-foreground">
          {String(data.durationS ?? 60)} 秒
        </div>
      </div>
    </BaseNode>
  );
});

// 等待周期节点
export const WaitCyclesNode = memo(function WaitCyclesNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '等待周期'}</div>
        <div className="text-muted-foreground">
          {String(data.heaterCycles ?? 5)} 个加热周期
        </div>
      </div>
    </BaseNode>
  );
});

// 等待稳定节点
export const WaitStabilityNode = memo(function WaitStabilityNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '等待稳定'}</div>
        <div className="text-muted-foreground">
          窗口: {String(data.windowS ?? 30)}s · 阈值: {String(data.thresholdPercent ?? 5)}%
        </div>
      </div>
    </BaseNode>
  );
});

// 设置状态节点
export const SetStateNode = memo(function SetStateNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const stateValue = data.state as string;
  const stateLabel = SYSTEM_STATES.find(s => s.value === stateValue)?.label || stateValue;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '设置状态'}</div>
        <div className="text-muted-foreground">{stateLabel}</div>
      </div>
    </BaseNode>
  );
});

// 设置气泵节点
export const SetGasPumpNode = memo(function SetGasPumpNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="font-medium">{data.name as string || '设置气泵'}</div>
        <div className="text-muted-foreground">
          PWM: {String(data.pwmPercent ?? 0)}%
        </div>
      </div>
    </BaseNode>
  );
});

// 硬件配置节点
export const HardwareConfigNode = memo(function HardwareConfigNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  return (
    <BaseNode {...props}>
      <div className="text-xs space-y-1">
        <div className="text-muted-foreground">
          瓶容量: {String(data.bottleCapacityMl ?? 150)} ml
        </div>
        <div className="text-muted-foreground">
          最大液位: {String(data.maxFillMl ?? 100)} ml
        </div>
      </div>
    </BaseNode>
  );
});

// 导出节点类型映射
export const nodeTypes = {
  [NodeType.START]: StartNode,
  [NodeType.END]: EndNode,
  [NodeType.LOOP]: LoopNode,
  [NodeType.PHASE_MARKER]: PhaseMarkerNode,
  [NodeType.INJECT]: InjectNode,
  [NodeType.DRAIN]: DrainNode,
  [NodeType.WASH]: WashNode,
  [NodeType.LIQUID_SOURCE]: LiquidSourceNode,
  [NodeType.PARAM_SWEEP]: ParamSweepNode,
  [NodeType.ACQUIRE]: AcquireNode,
  [NodeType.WAIT_TIME]: WaitTimeNode,
  [NodeType.WAIT_CYCLES]: WaitCyclesNode,
  [NodeType.WAIT_STABILITY]: WaitStabilityNode,
  [NodeType.SET_STATE]: SetStateNode,
  [NodeType.SET_GAS_PUMP]: SetGasPumpNode,
  [NodeType.HARDWARE_CONFIG]: HardwareConfigNode,
};
