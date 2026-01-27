'use client';

import { memo, ReactNode, useState } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { NodeType, NODE_META, NODE_CATEGORIES, HANDLE_TYPES } from '../types';
import {
  Play, Square, Repeat, Flag, Droplets, Trash2, Beaker,
  Activity, Clock, Timer, TrendingDown, Settings, Wind, Cpu, Circle, LucideIcon,
  ArrowDown, ArrowUp, ArrowLeft, ArrowRight
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  Play, Square, Repeat, Flag, Droplets, Trash2, Beaker,
  Activity, Clock, Timer, TrendingDown, Settings, Wind, Cpu, Circle
};

// 简洁的句柄提示信息
interface HandleInfo {
  label: string;
  color: string;
  hint?: string; // 可选提示
}

const HANDLE_INFO: Record<string, Record<'in' | 'out', HandleInfo>> = {
  flow: {
    in: { label: '流程', color: '#64748b', hint: '← 输入' },
    out: { label: '流程', color: '#64748b', hint: '输出 →' },
  },
  liquid: {
    in: { label: '液体', color: '#22c55e', hint: '可多源' },
    out: { label: '液体', color: '#22c55e' },
  },
  hardware: {
    in: { label: '硬件配置', color: '#6366f1' },
    out: { label: '→开始', color: '#6366f1' },
  },
};

// 带 tooltip 的 Handle 组件
interface TooltipHandleProps {
  type: 'source' | 'target';
  position: Position;
  id: string;
  className: string;
  style?: React.CSSProperties;
  handleType: 'flow' | 'liquid' | 'hardware';
}

const TooltipHandle = memo(function TooltipHandle({ 
  type, position, id, className, style, handleType 
}: TooltipHandleProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const direction = type === 'target' ? 'in' : 'out';
  const info = HANDLE_INFO[handleType]?.[direction];
  
  if (!info) return <Handle type={type} position={position} id={id} className={className} style={style} />;
  
  // 计算tooltip位置
  const getTooltipStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 50,
      pointerEvents: 'none',
    };
    
    switch (position) {
      case Position.Top:
        return { ...base, bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8 };
      case Position.Bottom:
        return { ...base, top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 8 };
      case Position.Left:
        return { ...base, right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 8 };
      case Position.Right:
        return { ...base, left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 8 };
      default:
        return base;
    }
  };

  return (
    <div 
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Handle
        type={type}
        position={position}
        id={id}
        className={className}
        style={style}
      />
      {showTooltip && (
        <div style={getTooltipStyle()}>
          <div 
            className="flex items-center gap-1.5 px-2 py-1 rounded-md shadow-lg border text-[11px] font-medium whitespace-nowrap"
            style={{ 
              backgroundColor: `${info.color}15`,
              borderColor: info.color,
              color: info.color,
            }}
          >
            <div 
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: info.color }}
            />
            <span>{info.label}</span>
            {info.hint && (
              <span className="opacity-60">{info.hint}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

interface BaseNodeProps extends NodeProps {
  children?: ReactNode;
  className?: string;
}

function getCategoryColor(nodeType: NodeType): string {
  for (const [, category] of Object.entries(NODE_CATEGORIES)) {
    if (category.nodes.includes(nodeType)) {
      return category.color;
    }
  }
  return '#6b7280';
}

export const BaseNode = memo(function BaseNode({
  type,
  selected,
  children,
  className,
}: BaseNodeProps) {
  const nodeType = type as NodeType;
  const meta = NODE_META[nodeType];
  const color = getCategoryColor(nodeType);
  
  const IconComponent = iconMap[meta.icon] || Circle;

  return (
    <div
      className={cn(
        'relative rounded-lg border-2 bg-background shadow-md transition-shadow',
        selected && 'ring-2 ring-primary shadow-lg',
        className
      )}
      style={{ borderColor: color }}
    >
      {/* 流程输入句柄 */}
      {meta.hasFlowIn && (
        <TooltipHandle
          type="target"
          position={Position.Top}
          id={HANDLE_TYPES.FLOW}
          className="!w-3 !h-3 !bg-slate-500 !border-2 !border-background"
          handleType="flow"
        />
      )}
      
      {/* 硬件配置输入句柄 */}
      {meta.hasHardwareIn && (
        <TooltipHandle
          type="target"
          position={Position.Left}
          id={HANDLE_TYPES.HARDWARE}
          className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-background"
          style={{ top: '50%' }}
          handleType="hardware"
        />
      )}
      
      {/* 液体输入句柄 */}
      {meta.hasLiquidIn && (
        <TooltipHandle
          type="target"
          position={Position.Left}
          id={HANDLE_TYPES.LIQUID}
          className="!w-3 !h-3 !bg-green-500 !border-2 !border-background"
          style={{ top: '50%' }}
          handleType="liquid"
        />
      )}
      
      {/* 节点头部 */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-md"
        style={{ backgroundColor: `${color}20` }}
      >
        <IconComponent className="w-4 h-4" style={{ color }} />
        <span className="text-sm font-medium">{meta.label}</span>
      </div>
      
      {/* 节点内容 */}
      <div className="px-3 py-2 min-w-[160px]">
        {children}
      </div>
      
      {/* 流程输出句柄 */}
      {meta.hasFlowOut && (
        <TooltipHandle
          type="source"
          position={Position.Bottom}
          id={HANDLE_TYPES.FLOW}
          className="!w-3 !h-3 !bg-slate-500 !border-2 !border-background"
          handleType="flow"
        />
      )}
      
      {/* 液体输出句柄 */}
      {meta.hasLiquidOut && (
        <TooltipHandle
          type="source"
          position={Position.Right}
          id={HANDLE_TYPES.LIQUID}
          className="!w-3 !h-3 !bg-green-500 !border-2 !border-background"
          style={{ top: '50%' }}
          handleType="liquid"
        />
      )}
      
      {/* 硬件配置输出句柄 */}
      {meta.hasHardwareOut && (
        <TooltipHandle
          type="source"
          position={Position.Right}
          id={HANDLE_TYPES.HARDWARE}
          className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-background"
          style={{ top: '50%' }}
          handleType="hardware"
        />
      )}
    </div>
  );
});
