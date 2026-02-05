"use client";

import { useCallback, useEffect } from "react";
import { useExperiments, Sample } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  Play,
  Square,
  CheckCircle2,
  XCircle,
  FlaskConical,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getStateIcon(state: string) {
  switch (state) {
    case "running":
      return <Play className="h-3 w-3 text-blue-500" />;
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-500" />;
    case "stopped":
      return <Square className="h-3 w-3 text-yellow-500" />;
    default:
      return null;
  }
}

function getStateColor(state: string): string {
  switch (state) {
    case "running":
      return "bg-blue-500/10 text-blue-700 border-blue-200";
    case "completed":
      return "bg-green-500/10 text-green-700 border-green-200";
    case "failed":
      return "bg-red-500/10 text-red-700 border-red-200";
    case "stopped":
      return "bg-yellow-500/10 text-yellow-700 border-yellow-200";
    default:
      return "";
  }
}

interface RunTreeProps {
  onSelectRun?: (runId: number) => void;
  onSelectSample?: (sample: Sample) => void;
}

export function RunTree({ onSelectRun, onSelectSample }: RunTreeProps) {
  const {
    runs,
    runsLoading,
    runsTotal,
    runsPage,
    setRunsPage,
    expandedRuns,
    runSamples,
    runSamplesLoading,
    selectedRunIds,
    selectedSampleIds,
    comparisonMode,
    toggleRunExpand,
    setRunSamples,
    setRunSamplesLoading,
    toggleRunSelection,
    toggleSampleSelection,
    addToComparison,
  } = useExperiments();

  const pageSize = 20;
  const totalPages = Math.ceil(runsTotal / pageSize);

  // 加载样本
  const loadSamplesForRun = useCallback(
    async (runId: number) => {
      if (runSamples[runId]) return; // 已加载

      setRunSamplesLoading(runId, true);
      try {
        const response = await fetch(`/api/samples?runId=${runId}&limit=100`);
        const data = await response.json();
        if (data.samples) {
          setRunSamples(runId, data.samples);
        }
      } catch (error) {
        console.error(`Failed to fetch samples for run ${runId}:`, error);
      } finally {
        setRunSamplesLoading(runId, false);
      }
    },
    [runSamples, setRunSamples, setRunSamplesLoading]
  );

  // 点击运行行
  const handleRunClick = useCallback(
    (runId: number) => {
      toggleRunExpand(runId);
      if (!expandedRuns.has(runId)) {
        loadSamplesForRun(runId);
      }
      // 多选模式：切换选中状态
      toggleRunSelection(runId);
      onSelectRun?.(runId);
    },
    [toggleRunExpand, expandedRuns, loadSamplesForRun, toggleRunSelection, onSelectRun]
  );

  // 点击样本行
  const handleSampleClick = useCallback(
    (sample: Sample) => {
      // 始终切换样本选中状态（多选）
      toggleSampleSelection(sample.id);
      if (comparisonMode) {
        addToComparison({
          type: "sample",
          id: sample.id,
          label: `样本 ${sample.id}`,
        });
      }
      onSelectSample?.(sample);
    },
    [toggleSampleSelection, comparisonMode, addToComparison, onSelectSample]
  );

  if (runsLoading && runs.length === 0) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 运行列表头 */}
      <div className="flex items-center justify-between px-2 py-1 border-b">
        <span className="text-sm font-medium">
          运行列表 ({runsTotal})
        </span>
        {comparisonMode && selectedRunIds.size > 0 && (
          <Badge variant="secondary" className="text-xs">
            已选 {selectedRunIds.size}
          </Badge>
        )}
      </div>

      {/* 运行列表 */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1">
          {runs.map((run) => {
            const isExpanded = expandedRuns.has(run.id);
            const isLoading = runSamplesLoading.has(run.id);
            const samples = runSamples[run.id] || [];
            const isSelected = selectedRunIds.has(run.id);

            return (
              <div key={run.id} className="space-y-0.5">
                {/* 运行行 */}
                <div
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
                    "hover:bg-accent",
                    isSelected && "bg-accent"
                  )}
                  onClick={() => handleRunClick(run.id)}
                >
                  {/* 展开图标 */}
                  <div className="w-4 h-4 flex items-center justify-center">
                    {isLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </div>

                  {/* 对比模式复选框 */}
                  {comparisonMode && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRunSelection(run.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}

                  {/* 状态图标 */}
                  {getStateIcon(run.state)}

                  {/* 运行信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        Run #{run.id}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn("text-xs", getStateColor(run.state))}
                      >
                        {run.state}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {run.createdAt
                          ? new Date(run.createdAt).toLocaleDateString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </span>
                      <span>•</span>
                      <span>{run.sampleCount} 样本</span>
                    </div>
                  </div>
                </div>

                {/* 展开的样本列表 */}
                {isExpanded && (
                  <div className="ml-6 border-l pl-2">
                    {isLoading ? (
                      <div className="py-2">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                      </div>
                    ) : samples.length === 0 ? (
                      <div className="py-2 text-xs text-muted-foreground text-center">
                        暂无样本
                      </div>
                    ) : (
                      <ScrollArea className="max-h-60">
                        <div className="space-y-0.5 py-1">
                          {samples.map((sample) => {
                            const isSampleSelected = selectedSampleIds.has(sample.id);
                            return (
                              <div
                                key={sample.id}
                                className={cn(
                                  "flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors",
                                  "hover:bg-accent/50",
                                  isSampleSelected && "bg-accent/50"
                                )}
                                onClick={() => handleSampleClick(sample)}
                              >
                                {/* 对比模式复选框 */}
                                {comparisonMode && (
                                  <Checkbox
                                    checked={isSampleSelected}
                                    onCheckedChange={() =>
                                      toggleSampleSelection(sample.id)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                )}

                                <FlaskConical className="h-3 w-3 text-muted-foreground" />

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs font-medium">
                                      #{sample.sampleIdx}
                                    </span>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {sample.liquidNames?.join(", ") || "-"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>{sample.phaseName}</span>
                                    <span>•</span>
                                    <span>PWM {sample.gasPumpPwm}%</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-1 border-t">
          <Button
            variant="ghost"
            size="sm"
            disabled={runsPage === 0}
            onClick={() => setRunsPage(runsPage - 1)}
            className="h-7 text-xs"
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            {runsPage + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={runsPage >= totalPages - 1}
            onClick={() => setRunsPage(runsPage + 1)}
            className="h-7 text-xs"
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
