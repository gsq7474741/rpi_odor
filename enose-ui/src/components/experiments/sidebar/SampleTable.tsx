"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useExperiments, SampleWithFrameStatus } from "../context/ExperimentsContext";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FlaskConical,
  CheckCircle,
  Circle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Database,
  ArrowUp,
  ArrowDown,
  RefreshCw,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SortField = "runId" | "sampleId" | "time";
type SortOrder = "asc" | "desc";

interface SampleTableProps {
  onSelectSample?: (sample: SampleWithFrameStatus) => void;
}

export function SampleTable({ onSelectSample }: SampleTableProps) {
  const {
    samples,
    samplesLoading,
    samplesTotal,
    samplesPage,
    setSamples,
    setSamplesLoading,
    setSamplesTotal,
    setSamplesPage,
    selectedSampleIds,
    toggleSampleSelection,
    addSamplesToSelection,
    removeSamplesFromSelection,
    filters,
    runs,
  } = useExperiments();

  const [sortField, setSortField] = useState<SortField>("time");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [recalculating, setRecalculating] = useState<Set<number>>(new Set());

  // 用 ref 持有 runs，避免 loadSamples 依赖 runs 导致级联刷新
  const runsRef = useRef(runs);
  runsRef.current = runs;

  // 单样本重新计算数据帧
  const handleRecalcSingle = useCallback(async (sampleId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecalculating(prev => new Set(prev).add(sampleId));
    const toastId = toast.loading(`重新计算 S#${sampleId} 的数据帧...`);
    try {
      const response = await fetch("/api/analytics/sample-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleIds: [sampleId],
          nSamples: 100,
          methods: ["linear", "pchip"],
          useCache: false,
          action: "generateBatch",
        }),
      });
      const result = await response.json();
      // 刷新该样本的帧状态
      const statusRes = await fetch(`/api/analytics/sample-frames?sampleIds=${sampleId}`);
      const statusData = await statusRes.json();
      if (statusData.statuses?.[sampleId]) {
        const updatedSamples = samples.map(s => {
          if (s.id === sampleId) {
            return {
              ...s,
              frameStatus: {
                hasFrames: statusData.statuses[sampleId].exists || false,
                cached: statusData.statuses[sampleId].cached || false,
                variants: statusData.statuses[sampleId].variants || [],
              },
            };
          }
          return s;
        });
        setSamples(updatedSamples);
      }
      if (result.failedCount > 0) {
        toast.warning(`S#${sampleId} 重算部分失败`, { id: toastId });
      } else {
        toast.success(`S#${sampleId} 数据帧已更新`, { id: toastId });
      }
    } catch {
      toast.error(`S#${sampleId} 重算失败`, { id: toastId });
    } finally {
      setRecalculating(prev => {
        const next = new Set(prev);
        next.delete(sampleId);
        return next;
      });
    }
  }, [samples, setSamples]);

  const pageSize = 50;
  const totalPages = Math.ceil(samplesTotal / pageSize);

  // 加载样本列表
  const loadSamples = useCallback(async () => {
    setSamplesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", pageSize.toString());
      params.set("offset", (samplesPage * pageSize).toString());
      
      // 应用筛选条件
      if (filters.runIds.length === 1) {
        params.set("runId", filters.runIds[0].toString());
      } else if (filters.runIds.length > 1) {
        params.set("runIds", filters.runIds.join(","));
      }
      if (filters.phaseNames.length > 0) {
        params.set("phase", filters.phaseNames.join(","));
      }
      if (filters.paramsHash) {
        params.set("paramsHash", filters.paramsHash);
      }
      if (filters.liquidIds.length > 0) {
        params.set("liquid", filters.liquidIds.join(","));
      }
      params.set("sortField", sortField);
      params.set("sortOrder", sortOrder);

      const response = await fetch(`/api/samples?${params.toString()}`);
      const data = await response.json();

      if (data.samples) {
        // 获取 run 创建时间映射（使用 ref 避免依赖 runs）
        const runCreatedAtMap: Record<number, string | null> = {};
        runsRef.current.forEach((run) => {
          runCreatedAtMap[run.id] = run.createdAt;
        });

        // 转换为 SampleWithFrameStatus
        let samplesWithStatus: SampleWithFrameStatus[] = data.samples.map(
          (s: SampleWithFrameStatus) => ({
            ...s,
            frameStatus: null, // 稍后批量获取
            runCreatedAt: runCreatedAtMap[s.runId] || null,
          })
        );

        // 客户端后过滤：组合实验元数据筛选
        if (filters.componentCount !== null) {
          samplesWithStatus = samplesWithStatus.filter(
            (s) => filters.componentCount! >= 4
              ? s.liquidNames.length >= 4
              : s.liquidNames.length === filters.componentCount
          );
        }
        if (filters.qualityLevels.length > 0) {
          samplesWithStatus = samplesWithStatus.filter(
            (s) => s.qualityLevel && filters.qualityLevels.includes(s.qualityLevel)
          );
        }
        if (filters.hideAnchorsAndBlanks) {
          samplesWithStatus = samplesWithStatus.filter(
            (s) => !s.isAnchor && !s.isBlank
          );
        } else if (filters.showAnchorsOnly) {
          samplesWithStatus = samplesWithStatus.filter((s) => s.isAnchor);
        } else if (filters.showBlanksOnly) {
          samplesWithStatus = samplesWithStatus.filter((s) => s.isBlank);
        }
        if (filters.experimentPhases.length > 0) {
          samplesWithStatus = samplesWithStatus.filter(
            (s) => s.experimentPhase && filters.experimentPhases.includes(s.experimentPhase)
          );
        }

        setSamples(samplesWithStatus);
        setSamplesTotal(samplesWithStatus.length);

        // 批量获取数据帧状态
        loadFrameStatuses(samplesWithStatus);
      }
    } catch (error) {
      console.error("Failed to load samples:", error);
    } finally {
      setSamplesLoading(false);
    }
  }, [samplesPage, filters, sortField, sortOrder, setSamples, setSamplesLoading, setSamplesTotal]);

  // 批量获取数据帧状态
  const loadFrameStatuses = async (sampleList: SampleWithFrameStatus[]) => {
    if (sampleList.length === 0) return;
    
    // 使用批量查询接口
    const sampleIds = sampleList.map(s => s.id).join(",");
    
    try {
      const response = await fetch(
        `/api/analytics/sample-frames?sampleIds=${sampleIds}`
      );
      const data = await response.json();
      
      if (data.statuses) {
        const updatedSamples = sampleList.map(sample => ({
          ...sample,
          frameStatus: {
            hasFrames: data.statuses[sample.id]?.exists || false,
            cached: data.statuses[sample.id]?.cached || false,
            variants: data.statuses[sample.id]?.variants || [],
          },
        }));
        setSamples(updatedSamples);
      }
    } catch (error) {
      console.error("Failed to load frame statuses:", error);
    }
  };

  // 筛选或分页变化时重新加载
  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  // 点击样本
  const handleSampleClick = useCallback(
    (sample: SampleWithFrameStatus) => {
      toggleSampleSelection(sample.id);
      onSelectSample?.(sample);
    },
    [toggleSampleSelection, onSelectSample]
  );

  // 全选/取消全选
  const allSelected = samples.length > 0 && samples.every((s) => selectedSampleIds.has(s.id));
  const someSelected = samples.some((s) => selectedSampleIds.has(s.id));

  const handleSelectAll = useCallback(() => {
    const pageIds = samples.map(s => s.id);
    if (allSelected) {
      removeSamplesFromSelection(pageIds);
    } else {
      addSamplesToSelection(pageIds);
    }
  }, [allSelected, samples, addSamplesToSelection, removeSamplesFromSelection]);

  if (samplesLoading && samples.length === 0) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 表头 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={handleSelectAll}
          aria-label="全选"
        />
        <span className="text-sm font-medium">
          样本 ({samplesTotal})
        </span>

        {/* 排序 */}
        <div className="flex items-center gap-1 ml-auto">
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger className="h-6 w-20 text-xs px-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="runId">Run ID</SelectItem>
              <SelectItem value="sampleId">Sample ID</SelectItem>
              <SelectItem value="time">时间</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
          >
            {sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </Button>
        </div>

        {selectedSampleIds.size > 0 && (
          <Badge variant="secondary" className="text-xs">
            {selectedSampleIds.size}
          </Badge>
        )}
      </div>

      {/* 样本列表 */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1">
          {samples.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FlaskConical className="h-8 w-8 mb-2" />
              <span className="text-sm">暂无样本</span>
            </div>
          ) : (
            samples.map((sample) => {
              const isSelected = selectedSampleIds.has(sample.id);
              const hasFrames = sample.frameStatus?.hasFrames;
              const isCached = sample.frameStatus?.cached;

              return (
                <div
                  key={sample.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
                    "hover:bg-accent group",
                    isSelected && "bg-accent"
                  )}
                  onClick={() => handleSampleClick(sample)}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSampleSelection(sample.id)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  <FlaskConical className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        S#{sample.id}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Run #{sample.runId}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate max-w-[120px]">
                        {sample.liquidNames?.join(" + ") || "-"}
                      </span>
                      <span>•</span>
                      <span>{sample.phaseName}</span>
                    </div>
                  </div>

                  {/* 数据帧状态 + 重算按钮 */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {sample.frameStatus === null ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : hasFrames ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs gap-1",
                          isCached
                            ? "border-green-500/50 text-green-700 bg-green-50"
                            : "border-blue-500/50 text-blue-700 bg-blue-50"
                        )}
                        title={
                          sample.frameStatus.variants
                            .map((v) => `${v.method}@${v.nSamples}`)
                            .join(", ") || "有数据帧"
                        }
                      >
                        {isCached ? (
                          <Database className="h-3 w-3" />
                        ) : (
                          <CheckCircle className="h-3 w-3" />
                        )}
                        帧
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground gap-1"
                      >
                        <Circle className="h-3 w-3" />
                        无帧
                      </Badge>
                    )}
                    {/* 单样本重算按钮 */}
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => handleRecalcSingle(sample.id, e)}
                            disabled={recalculating.has(sample.id)}
                          >
                            {recalculating.has(sample.id) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p className="text-xs">重新计算数据帧</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-1.5 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            disabled={samplesPage === 0}
            onClick={() => setSamplesPage(samplesPage - 1)}
            className="h-7 px-2"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {samplesPage + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={samplesPage >= totalPages - 1}
            onClick={() => setSamplesPage(samplesPage + 1)}
            className="h-7 px-2"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
