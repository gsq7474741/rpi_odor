'use client';

import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useEditorStore } from '../store';
import { formatDuration, getDiagnosticIcon, CompilerDiagnostic, CompiledStep, LoopPathEntry } from '../compiler';
import { NODE_META, NodeType } from '../types';
import { cn } from '@/lib/utils';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Info, 
  Clock, 
  Droplets, 
  Zap,
  ListOrdered,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export function CompilerPanel() {
  const {
    nodes,
    edges,
    compilationResult,
    isCompiling,
    autoCompile,
    recompile,
    setAutoCompile,
    setSelectedNodeId,
  } = useEditorStore();

  // 自动编译：节点或边变化时重新编译
  useEffect(() => {
    if (autoCompile) {
      const timer = setTimeout(() => {
        recompile();
      }, 300); // 300ms 防抖
      return () => clearTimeout(timer);
    }
  }, [nodes, edges, autoCompile, recompile]);

  // 初始编译
  useEffect(() => {
    if (!compilationResult) {
      recompile();
    }
  }, []);

  const result = compilationResult;

  // 分类诊断信息
  const { errors, warnings, infos } = useMemo(() => {
    if (!result) return { errors: [], warnings: [], infos: [] };
    return {
      errors: result.diagnostics.filter(d => d.level === 'error'),
      warnings: result.diagnostics.filter(d => d.level === 'warning'),
      infos: result.diagnostics.filter(d => d.level === 'info'),
    };
  }, [result]);

  const { setCenter, getNode } = useReactFlow();

  // 聚焦到节点：选中 + 移动视角 + 放大
  const focusNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = getNode(nodeId);
    if (node) {
      const x = node.position.x + (node.measured?.width || 150) / 2;
      const y = node.position.y + (node.measured?.height || 100) / 2;
      setCenter(x, y, { zoom: 1.5, duration: 500 });
    }
  }, [setCenter, getNode, setSelectedNodeId]);

  // 高亮的步骤索引（用于双向跳转）
  const [highlightedStepIndex, setHighlightedStepIndex] = useState<number | null>(null);
  const stepRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  
  const handleDiagnosticClick = (diagnostic: CompilerDiagnostic) => {
    // 跳转到图中的节点
    if (diagnostic.nodeId) {
      focusNode(diagnostic.nodeId);
    }
    
    // 如果有 stepIndex，同时滚动到步骤列表中的对应步骤
    if (diagnostic.stepIndex !== undefined) {
      setHighlightedStepIndex(diagnostic.stepIndex);
      setStepsExpanded(true);  // 展开步骤列表
      
      // 滚动到对应步骤
      setTimeout(() => {
        const stepElement = stepRefs.current.get(diagnostic.stepIndex!);
        if (stepElement) {
          stepElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      
      // 3秒后取消高亮
      setTimeout(() => {
        setHighlightedStepIndex(null);
      }, 3000);
    }
  };

  const [stepsExpanded, setStepsExpanded] = React.useState(false);
  // 折叠状态：key = loopPath字符串，value = 是否展开
  const [expandedLoops, setExpandedLoops] = useState<Set<string>>(new Set());
  
  // 切换循环折叠状态
  const toggleLoop = useCallback((loopKey: string) => {
    setExpandedLoops(prev => {
      const next = new Set(prev);
      if (next.has(loopKey)) {
        next.delete(loopKey);
      } else {
        next.add(loopKey);
      }
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-background border-l">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" />
          <span className="font-medium text-sm">实时编译器</span>
          {isCompiling && (
            <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setAutoCompile(!autoCompile)}
              >
                {autoCompile ? (
                  <ToggleRight className="w-4 h-4 text-green-500" />
                ) : (
                  <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{autoCompile ? '关闭自动编译' : '开启自动编译'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={recompile}
                disabled={isCompiling}
              >
                <RefreshCw className={cn("w-4 h-4", isCompiling && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>手动编译</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* 编译状态 */}
          <div className={cn(
            "flex items-center gap-2 p-2 rounded-lg",
            result?.success ? "bg-green-500/10" : "bg-red-500/10"
          )}>
            {result?.success ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  编译成功
                </span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-red-500" />
                <span className="text-sm font-medium text-red-700 dark:text-red-400">
                  编译失败
                </span>
              </>
            )}
          </div>

          {/* 估算数据 */}
          {result && result.success && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <Clock className="w-4 h-4 text-blue-500" />
                <div>
                  <div className="text-xs text-muted-foreground">预计时长</div>
                  <div className="text-sm font-medium">
                    {formatDuration(result.totalDurationS)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <Droplets className="w-4 h-4 text-cyan-500" />
                <div>
                  <div className="text-xs text-muted-foreground">峰值样品液位</div>
                  <div className="text-sm font-medium">
                    {result.peakLiquidLevelMl.toFixed(1)} ml
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <Droplets className="w-4 h-4 text-green-500" />
                <div>
                  <div className="text-xs text-muted-foreground">总进样量</div>
                  <div className="text-sm font-medium">
                    {result.totalInjectMl.toFixed(1)} ml
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <Droplets className="w-4 h-4 text-orange-500" />
                <div>
                  <div className="text-xs text-muted-foreground">总排废量</div>
                  <div className="text-sm font-medium">
                    {result.totalDrainMl.toFixed(1)} ml
                    {result.totalWashVolumeMl > 0 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        (进样{result.totalInjectMl.toFixed(1)} + 清洗{result.totalWashVolumeMl.toFixed(1)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 液体消耗明细 */}
          {result && result.liquidConsumption.length > 0 && (
            <div className="p-2 rounded-lg border bg-muted/30">
              <div className="text-xs font-medium text-muted-foreground mb-2">液体消耗明细</div>
              <div className="space-y-1">
                {result.liquidConsumption.map((lc) => {
                  // pumpIndex >= 0: 蠕动泵 (已绑定)
                  // pumpIndex = -1: 可能是清洗泵，也可能是未绑定的样品
                  // isWashPump 标识是否为清洗节点使用的液体
                  const isWashPump = lc.pumpIndex === -1 && lc.isWashPump;
                  const isUnbound = lc.pumpIndex === -1 && !lc.isWashPump;
                  
                  return (
                    <div key={`${lc.liquidId}-${lc.pumpIndex}`} className="flex justify-between items-center text-xs">
                      <span className="truncate" title={lc.liquidName}>
                        {lc.liquidName}
                        {lc.pumpIndex >= 0 && (
                          <span className="text-muted-foreground ml-1">(蠕动泵{lc.pumpIndex})</span>
                        )}
                        {isWashPump && (
                          <span className="text-muted-foreground ml-1">(清洗泵)</span>
                        )}
                        {isUnbound && (
                          <span className="text-yellow-600 ml-1">(未绑定泵)</span>
                        )}
                      </span>
                      <span className="font-medium ml-2">{lc.requiredMl.toFixed(1)} ml</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 诊断信息 */}
          {errors.length > 0 && (
            <DiagnosticSection
              title="错误"
              icon={<XCircle className="w-4 h-4 text-red-500" />}
              diagnostics={errors}
              onClick={handleDiagnosticClick}
              className="border-red-500/30 bg-red-500/5"
            />
          )}

          {warnings.length > 0 && (
            <DiagnosticSection
              title="警告"
              icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}
              diagnostics={warnings}
              onClick={handleDiagnosticClick}
              className="border-yellow-500/30 bg-yellow-500/5"
            />
          )}

          {infos.length > 0 && (
            <DiagnosticSection
              title="信息"
              icon={<Info className="w-4 h-4 text-blue-500" />}
              diagnostics={infos}
              onClick={handleDiagnosticClick}
              className="border-blue-500/30 bg-blue-500/5"
            />
          )}

          {/* 编译步骤列表 */}
          {result && result.steps.length > 0 && (
            <Collapsible open={stepsExpanded} onOpenChange={setStepsExpanded}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-muted/50 transition-colors">
                {stepsExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <ListOrdered className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-medium">执行步骤</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {result.steps.filter(s => s.isAtomic).length} 步
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2">
                  <StepTreeView 
                    steps={result.steps} 
                    expandedLoops={expandedLoops}
                    toggleLoop={toggleLoop}
                    focusNode={focusNode}
                    highlightedStepIndex={highlightedStepIndex}
                    stepRefs={stepRefs}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* 空状态 */}
          {result && result.steps.length === 0 && result.success && (
            <div className="text-center text-sm text-muted-foreground py-4">
              暂无执行步骤
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部时间戳 */}
      {result && (
        <div className="px-3 py-1.5 border-t text-xs text-muted-foreground">
          编译于 {new Date(result.compiledAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

interface DiagnosticSectionProps {
  title: string;
  icon: React.ReactNode;
  diagnostics: CompilerDiagnostic[];
  onClick: (d: CompilerDiagnostic) => void;
  className?: string;
}

function DiagnosticSection({ title, icon, diagnostics, onClick, className }: DiagnosticSectionProps) {
  return (
    <div className={cn("rounded-lg border p-2", className)}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">({diagnostics.length})</span>
      </div>
      <div className="space-y-1">
        {diagnostics.map((d, i) => (
          <div
            key={`${d.code}-${i}`}
            className={cn(
              "text-xs p-1.5 rounded cursor-pointer hover:bg-background/50 transition-colors",
              d.nodeId && "hover:underline"
            )}
            onClick={() => onClick(d)}
          >
            <span className="font-mono text-muted-foreground mr-1">[{d.code}]</span>
            {d.message}
          </div>
        ))}
      </div>
    </div>
  );
}


// 步骤树视图组件
interface StepTreeViewProps {
  steps: CompiledStep[];
  expandedLoops: Set<string>;
  toggleLoop: (key: string) => void;
  focusNode: (nodeId: string) => void;
  highlightedStepIndex: number | null;
  stepRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

function StepTreeView({ steps, expandedLoops, toggleLoop, focusNode, highlightedStepIndex, stepRefs }: StepTreeViewProps) {
  // 构建树形结构
  const tree = useMemo(() => {
    return buildStepTree(steps);
  }, [steps]);
  
  // 计算每个树节点对应的原始步骤索引
  let stepCounter = 0;
  const getStepIndex = () => stepCounter++;
  
  return (
    <div className="space-y-0.5">
      {tree.map((item, index) => {
        const stepIndex = item.type === 'step' ? getStepIndex() : -1;
        return (
          <StepTreeNode 
            key={item.type === 'loop' ? item.key : item.step.id}
            item={item}
            index={index}
            expandedLoops={expandedLoops}
            toggleLoop={toggleLoop}
            focusNode={focusNode}
            depth={0}
            highlightedStepIndex={highlightedStepIndex}
            stepRefs={stepRefs}
            stepIndex={stepIndex}
          />
        );
      })}
    </div>
  );
}

type TreeNode = 
  | { type: 'step'; step: CompiledStep }
  | { type: 'loop'; key: string; loopEntry: LoopPathEntry; children: TreeNode[]; totalDuration: number; stepCount: number };

// 构建步骤树
function buildStepTree(steps: CompiledStep[]): TreeNode[] {
  const result: TreeNode[] = [];
  const loopGroups = new Map<string, { entry: LoopPathEntry; steps: CompiledStep[]; duration: number; count: number }>();
  const seen = new Set<string>();
  
  // 第一遍：按最外层循环分组，收集所有步骤
  for (const step of steps) {
    if (step.loopPath.length === 0) {
      // 顶层步骤，直接添加
      result.push({ type: 'step', step });
    } else {
      // 在循环内的步骤 - 按最外层循环分组
      const outerLoop = step.loopPath[0];
      const key = `${outerLoop.loopId}:${outerLoop.iteration}`;
      
      if (!loopGroups.has(key)) {
        loopGroups.set(key, { 
          entry: outerLoop, 
          steps: [], 
          duration: 0, 
          count: 0 
        });
      }
      
      const group = loopGroups.get(key)!;
      // 收集步骤（移除最外层循环信息）
      const innerStep: CompiledStep = {
        ...step,
        loopPath: step.loopPath.slice(1),
        depth: Math.max(0, step.depth - 1),
      };
      group.steps.push(innerStep);
      
      // 累加时长：原子步骤和非原子汇总步骤都有正确的 estimatedDurationS
      group.duration += step.estimatedDurationS;
      if (step.isAtomic) {
        group.count++;
      } else if (step.estimatedDurationS > 0) {
        group.count++; // 非原子汇总步骤也计为1步
      }
      
      // 按顺序添加循环节点（只添加一次）
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ 
          type: 'loop', 
          key, 
          loopEntry: outerLoop, 
          children: [], // 稍后填充
          totalDuration: 0, 
          stepCount: 0 
        });
      }
    }
  }
  
  // 第二遍：递归构建子树
  for (const node of result) {
    if (node.type === 'loop') {
      const group = loopGroups.get(node.key)!;
      node.children = buildStepTree(group.steps);
      node.totalDuration = group.duration;
      node.stepCount = group.count;
    }
  }
  
  return result;
}

interface StepTreeNodeProps {
  item: TreeNode;
  index: number;
  expandedLoops: Set<string>;
  toggleLoop: (key: string) => void;
  focusNode: (nodeId: string) => void;
  depth: number;
  highlightedStepIndex: number | null;
  stepRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  stepIndex: number;
}

function StepTreeNode({ item, index: _index, expandedLoops, toggleLoop, focusNode, depth, highlightedStepIndex, stepRefs, stepIndex }: StepTreeNodeProps) {
  if (item.type === 'step') {
    const step = item.step;
    const isHighlighted = highlightedStepIndex === stepIndex;
    return (
      <div
        ref={(el) => {
          if (el) stepRefs.current.set(stepIndex, el);
        }}
        className={cn(
          "flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors text-sm",
          isHighlighted && "bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-500"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => step.nodeId && focusNode(step.nodeId)}
      >
        <span className="flex-1 truncate">{step.name}</span>
        {step.estimatedDurationS > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDuration(step.estimatedDurationS)}
          </span>
        )}
      </div>
    );
  }
  
  // 循环组
  const isExpanded = expandedLoops.has(item.key);
  const loopEntry = item.loopEntry;
  
  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer transition-colors text-sm font-medium"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => toggleLoop(item.key)}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
        <span className="text-pink-500">{loopEntry.loopName}</span>
        <span className="text-muted-foreground text-xs">
          #{loopEntry.iteration}/{loopEntry.total}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {item.stepCount}步 · {formatDuration(item.totalDuration)}
        </span>
      </div>
      {isExpanded && (
        <div className="border-l border-pink-500/20 ml-3">
          {item.children.map((child, i) => (
            <StepTreeNode
              key={child.type === 'loop' ? child.key : child.step.id}
              item={child}
              index={i}
              expandedLoops={expandedLoops}
              toggleLoop={toggleLoop}
              focusNode={focusNode}
              depth={depth + 1}
              highlightedStepIndex={highlightedStepIndex}
              stepRefs={stepRefs}
              stepIndex={child.type === 'step' ? stepIndex + i : -1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
