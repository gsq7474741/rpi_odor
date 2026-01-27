'use client';

import React, { useEffect, useMemo, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useEditorStore } from '../store';
import { formatDuration, getDiagnosticIcon, CompilerDiagnostic } from '../compiler';
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

  const handleDiagnosticClick = (diagnostic: CompilerDiagnostic) => {
    if (diagnostic.nodeId) {
      focusNode(diagnostic.nodeId);
    }
  };

  const [stepsExpanded, setStepsExpanded] = React.useState(false);

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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setAutoCompile(!autoCompile)}
            title={autoCompile ? '关闭自动编译' : '开启自动编译'}
          >
            {autoCompile ? (
              <ToggleRight className="w-4 h-4 text-green-500" />
            ) : (
              <ToggleLeft className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={recompile}
            disabled={isCompiling}
            title="手动编译"
          >
            <RefreshCw className={cn("w-4 h-4", isCompiling && "animate-spin")} />
          </Button>
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
                  <div className="text-xs text-muted-foreground">峰值液位</div>
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
                  </div>
                </div>
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
                  {result.steps.length} 步
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-1">
                  {result.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors text-sm"
                      onClick={() => step.nodeId && focusNode(step.nodeId)}
                    >
                      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {index + 1}
                      </span>
                      <span className="flex-1 truncate">{step.name}</span>
                      {step.estimatedDurationS > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(step.estimatedDurationS)}
                        </span>
                      )}
                    </div>
                  ))}
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
