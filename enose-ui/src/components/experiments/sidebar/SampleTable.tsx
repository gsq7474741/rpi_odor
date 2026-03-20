"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useExperiments, SampleWithSeriesStatus, detectAnomalies, ANOMALY_LABELS } from "../context/ExperimentsContext";
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
  Trash2,
  ClipboardCopy,
  CheckSquare,
  Filter,
  AlertTriangle,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SortField = "runId" | "sampleId" | "time";
type SortOrder = "asc" | "desc";

interface SampleTableProps {
  onSelectSample?: (sample: SampleWithSeriesStatus) => void;
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
    updateFilters,
    runs,
    hoveredSampleId,
    setHoveredSampleId,
  } = useExperiments();

  const [sortField, setSortField] = useState<SortField>("time");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // 方案D: 全选全部筛选结果状态
  const [showSelectAllBanner, setShowSelectAllBanner] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

  // 右键菜单 & 删除确认
  const [deleteTarget, setDeleteTarget] = useState<{ ids: number[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 右键菜单触发删除（单个样本或选中的多个样本）
  const handleDeleteRequest = useCallback((sample: SampleWithSeriesStatus) => {
    if (selectedSampleIds.has(sample.id) && selectedSampleIds.size > 1) {
      const ids = Array.from(selectedSampleIds);
      setDeleteTarget({ ids, label: `${ids.length} 个选中样本` });
    } else {
      setDeleteTarget({ ids: [sample.id], label: `S#${sample.id}` });
    }
  }, [selectedSampleIds]);

  // 执行删除
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const toastId = toast.loading(`正在删除 ${deleteTarget.label}...`);
    try {
      const res = await fetch("/api/samples", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleIds: deleteTarget.ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");

      // 从本地状态移除
      removeSamplesFromSelection(deleteTarget.ids);
      const deletedSet = new Set(deleteTarget.ids);
      setSamples(samples.filter(s => !deletedSet.has(s.id)));
      setSamplesTotal(samplesTotal - (data.deleted || 0));

      toast.success(`已删除 ${data.deleted} 个样本`, { id: toastId });
      setDeleteTarget(null);
    } catch (err) {
      toast.error(`删除失败: ${err}`, { id: toastId });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, samples, samplesTotal, removeSamplesFromSelection, setSamples, setSamplesTotal]);

  // 复制样本 ID 到剪贴板
  const handleCopyIds = useCallback((sample: SampleWithSeriesStatus) => {
    const ids = selectedSampleIds.has(sample.id) && selectedSampleIds.size > 1
      ? Array.from(selectedSampleIds)
      : [sample.id];
    navigator.clipboard.writeText(ids.join(", "));
    toast.success(`已复制 ${ids.length} 个样本 ID`);
  }, [selectedSampleIds]);

  // 仅选中此样本
  const handleSelectOnly = useCallback((sample: SampleWithSeriesStatus) => {
    removeSamplesFromSelection(Array.from(selectedSampleIds));
    addSamplesToSelection([sample.id]);
  }, [selectedSampleIds, removeSamplesFromSelection, addSamplesToSelection]);

  // 按 Run 筛选
  const handleFilterByRun = useCallback((sample: SampleWithSeriesStatus) => {
    updateFilters({ runIds: [sample.runId] });
    toast.success(`已筛选 Run #${sample.runId}`);
  }, [updateFilters]);

  // 用 ref 持有 runs，避免 loadSamples 依赖 runs 导致级联刷新
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const pageSize = 50;
  const totalPages = Math.ceil(samplesTotal / pageSize);

  // 加载样本列表
  const loadSamples = useCallback(async () => {
    setSamplesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", pageSize.toString());
      params.set("offset", (samplesPage * pageSize).toString());
      
      // 应用筛选条件（基础筛选）
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
      // 服务端过滤参数（原客户端过滤迁移至服务端）
      if (filters.componentCount !== null) {
        params.set("componentCount", filters.componentCount.toString());
      }
      if (filters.qualityLevels.length > 0) {
        params.set("qualityLevels", filters.qualityLevels.join(","));
      }
      if (filters.showAnchorsOnly) {
        params.set("showAnchorsOnly", "true");
      }
      if (filters.showBlanksOnly) {
        params.set("showBlanksOnly", "true");
      }
      if (filters.hideAnchorsAndBlanks) {
        params.set("hideAnchorsAndBlanks", "true");
      }
      if (filters.experimentPhases.length > 0) {
        params.set("experimentPhases", filters.experimentPhases.join(","));
      }
      if (filters.searchQuery) {
        params.set("searchQuery", filters.searchQuery);
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

        // 获取 run 状态映射（用于异常检测）
        const runStateMap: Record<number, string> = {};
        runsRef.current.forEach((run) => {
          runStateMap[run.id] = run.state;
        });

        // 转换为 SampleWithSeriesStatus，并计算异常标记
        const samplesWithStatus: SampleWithSeriesStatus[] = data.samples.map(
          (s: SampleWithSeriesStatus) => ({
            ...s,
            seriesStatus: null, // 稍后批量获取
            runCreatedAt: runCreatedAtMap[s.runId] || null,
            anomalyFlags: detectAnomalies(s, runStateMap[s.runId]),
          })
        );

        setSamples(samplesWithStatus);
        setSamplesTotal(data.total); // 使用服务端返回的真实总数

        // 批量获取对齐序列状态
        loadSeriesStatuses(samplesWithStatus);
      }
    } catch (error) {
      console.error("Failed to load samples:", error);
    } finally {
      setSamplesLoading(false);
    }
  }, [samplesPage, filters, sortField, sortOrder, setSamples, setSamplesLoading, setSamplesTotal]);

  // 批量获取对齐序列状态
  const loadSeriesStatuses = async (sampleList: SampleWithSeriesStatus[]) => {
    if (sampleList.length === 0) return;
    
    // 使用批量查询接口
    const sampleIds = sampleList.map(s => s.id).join(",");
    
    try {
      const response = await fetch(
        `/api/analytics/sample-aligned-series?sampleIds=${sampleIds}`
      );
      const data = await response.json();
      
      if (data.statuses) {
        const updatedSamples = sampleList.map(sample => ({
          ...sample,
          seriesStatus: {
            hasAlignedSeries: data.statuses[sample.id]?.exists || false,
            cached: data.statuses[sample.id]?.cached || false,
            variants: data.statuses[sample.id]?.variants || [],
          },
        }));
        setSamples(updatedSamples);
      }
    } catch (error) {
      console.error("Failed to load series statuses:", error);
    }
  };

  // 筛选或分页变化时重新加载
  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  // 客户端异常筛选（showAnomaliesOnly）
  const displaySamples = useMemo(() => {
    if (!filters.showAnomaliesOnly) return samples;
    return samples.filter(s => s.anomalyFlags && s.anomalyFlags.length > 0);
  }, [samples, filters.showAnomaliesOnly]);

  // 筛选变更时重置"全选全部"提示条
  useEffect(() => {
    setShowSelectAllBanner(false);
  }, [filters]);

  // 点击样本
  const handleSampleClick = useCallback(
    (sample: SampleWithSeriesStatus) => {
      toggleSampleSelection(sample.id);
      onSelectSample?.(sample);
    },
    [toggleSampleSelection, onSelectSample]
  );

  // 全选/取消全选
  const allSelected = displaySamples.length > 0 && displaySamples.every((s) => selectedSampleIds.has(s.id));
  const someSelected = displaySamples.some((s) => selectedSampleIds.has(s.id));

  // 构建当前筛选条件的 URL 参数（复用于 loadSamples 和 fetchAllFilteredIds）
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
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
    if (filters.componentCount !== null) {
      params.set("componentCount", filters.componentCount.toString());
    }
    if (filters.qualityLevels.length > 0) {
      params.set("qualityLevels", filters.qualityLevels.join(","));
    }
    if (filters.showAnchorsOnly) params.set("showAnchorsOnly", "true");
    if (filters.showBlanksOnly) params.set("showBlanksOnly", "true");
    if (filters.hideAnchorsAndBlanks) params.set("hideAnchorsAndBlanks", "true");
    if (filters.experimentPhases.length > 0) {
      params.set("experimentPhases", filters.experimentPhases.join(","));
    }
    if (filters.searchQuery) params.set("searchQuery", filters.searchQuery);
    return params;
  }, [filters]);

  const handleSelectAll = useCallback(() => {
    const pageIds = displaySamples.map(s => s.id);
    if (allSelected) {
      removeSamplesFromSelection(pageIds);
      setShowSelectAllBanner(false);
    } else {
      addSamplesToSelection(pageIds);
      // 如果总数超过当前页，显示“全选全部筛选结果”提示
      if (samplesTotal > displaySamples.length) {
        setShowSelectAllBanner(true);
      }
    }
  }, [allSelected, displaySamples, samplesTotal, addSamplesToSelection, removeSamplesFromSelection]);

  // 方案D: 全选全部筛选结果
  const handleSelectAllFiltered = useCallback(async () => {
    setSelectingAll(true);
    try {
      const params = buildFilterParams();
      params.set("returnIdsOnly", "true");
      const response = await fetch(`/api/samples?${params.toString()}`);
      const data = await response.json();
      if (data.ids) {
        addSamplesToSelection(data.ids);
      }
      setShowSelectAllBanner(false);
    } catch (error) {
      console.error("Failed to fetch all filtered IDs:", error);
    } finally {
      setSelectingAll(false);
    }
  }, [buildFilterParams, addSamplesToSelection]);

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

      {/* 方案D: 全选全部筛选结果提示条 */}
      {showSelectAllBanner && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-b bg-blue-50 dark:bg-blue-950/30 text-xs">
          <span>已选中当前页 {displaySamples.length} 个样本。</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-blue-600 dark:text-blue-400"
            onClick={handleSelectAllFiltered}
            disabled={selectingAll}
          >
            {selectingAll ? (
              <><Loader2 className="h-3 w-3 animate-spin mr-1" />加载中...</>
            ) : (
              <>选择全部 {samplesTotal} 个筛选结果</>
            )}
          </Button>
        </div>
      )}

      {/* 样本列表 */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1">
          {displaySamples.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FlaskConical className="h-8 w-8 mb-2" />
              <span className="text-sm">{filters.showAnomaliesOnly ? "无异常样本" : "暂无样本"}</span>
            </div>
          ) : (
            displaySamples.map((sample) => {
              const isSelected = selectedSampleIds.has(sample.id);
              const hasAlignedSeries = sample.seriesStatus?.hasAlignedSeries;
              const isCached = sample.seriesStatus?.cached;
              const hasAnomaly = sample.anomalyFlags && sample.anomalyFlags.length > 0;

              return (
                <ContextMenu key={sample.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn(
                        "flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
                        "hover:bg-accent group",
                        isSelected && "bg-accent",
                        hasAnomaly && !isSelected && "bg-orange-50/50 dark:bg-orange-950/20",
                        hoveredSampleId === sample.id && "ring-1 ring-primary/50"
                      )}
                      onClick={() => handleSampleClick(sample)}
                      onMouseEnter={() => isSelected && setHoveredSampleId(sample.id)}
                      onMouseLeave={() => hoveredSampleId === sample.id && setHoveredSampleId(null)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSampleSelection(sample.id)}
                        onClick={(e) => e.stopPropagation()}
                      />

                      {hasAnomaly ? (
                        <span title={sample.anomalyFlags.map(f => ANOMALY_LABELS[f]).join("、")}>
                          <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                        </span>
                      ) : (
                        <FlaskConical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            S#{sample.id}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            Run #{sample.runId}
                          </Badge>
                          {hasAnomaly && (
                            <Badge
                              variant="outline"
                              className="text-xs border-orange-400/50 text-orange-600 bg-orange-50 dark:bg-orange-950/30"
                              title={sample.anomalyFlags.map(f => ANOMALY_LABELS[f]).join("、")}
                            >
                              <AlertTriangle className="h-3 w-3 mr-0.5" />
                              {sample.anomalyFlags.length}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate max-w-[120px]">
                            {sample.liquidNames?.join(" + ") || "-"}
                          </span>
                          <span>•</span>
                          <span>{sample.phaseName}</span>
                        </div>
                      </div>

                  {/* 对齐序列状态 */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {sample.seriesStatus === null ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : hasAlignedSeries ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs gap-1",
                          isCached
                            ? "border-green-500/50 text-green-700 bg-green-50"
                            : "border-blue-500/50 text-blue-700 bg-blue-50"
                        )}
                        title={
                          sample.seriesStatus.variants
                            .map((v: { method: string; nSamples: number }) => `${v.method}@${v.nSamples}`)
                            .join(", ") || "有对齐序列"
                        }
                      >
                        {isCached ? (
                          <Database className="h-3 w-3" />
                        ) : (
                          <CheckCircle className="h-3 w-3" />
                        )}
                        已对齐
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground gap-1"
                      >
                        <Circle className="h-3 w-3" />
                        未对齐
                      </Badge>
                    )}
                  </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => handleSelectOnly(sample)}>
                      <CheckSquare className="mr-2 h-4 w-4" />
                      仅选中此样本
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleCopyIds(sample)}>
                      <ClipboardCopy className="mr-2 h-4 w-4" />
                      {selectedSampleIds.has(sample.id) && selectedSampleIds.size > 1
                        ? `复制ID ${selectedSampleIds.size} 个 ID`
                        : `复制 S#${sample.id}`}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleFilterByRun(sample)}>
                      <Filter className="mr-2 h-4 w-4" />
                      筛选 Run #{sample.runId}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDeleteRequest(sample)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {selectedSampleIds.has(sample.id) && selectedSampleIds.size > 1
                        ? `删除 ${selectedSampleIds.size} 个选中样本`
                        : `删除 S#${sample.id}`}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
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

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {deleteTarget?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除样本及其所有关联数据（传感器读数、对齐序列、ML 标签、Phase 转换记录）。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
