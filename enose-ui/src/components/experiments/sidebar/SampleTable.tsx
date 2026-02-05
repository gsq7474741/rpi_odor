"use client";

import { useCallback, useEffect, useState } from "react";
import { useExperiments, SampleWithFrameStatus } from "../context/ExperimentsContext";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FlaskConical,
  CheckCircle,
  Circle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    selectAllSamples,
    clearSampleSelection,
    filters,
    runs,
  } = useExperiments();

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
      if (filters.runIds.length > 0) {
        params.set("runId", filters.runIds[0].toString()); // TODO: 支持多 runId
      }
      if (filters.phaseNames.length > 0) {
        params.set("phase", filters.phaseNames[0]);
      }
      if (filters.paramsHash) {
        params.set("paramsHash", filters.paramsHash);
      }
      if (filters.liquidIds.length > 0) {
        params.set("liquid", filters.liquidIds.join(","));
      }

      const response = await fetch(`/api/samples?${params.toString()}`);
      const data = await response.json();

      if (data.samples) {
        // 获取 run 创建时间映射
        const runCreatedAtMap: Record<number, string | null> = {};
        runs.forEach((run) => {
          runCreatedAtMap[run.id] = run.createdAt;
        });

        // 转换为 SampleWithFrameStatus
        const samplesWithStatus: SampleWithFrameStatus[] = data.samples.map(
          (s: SampleWithFrameStatus) => ({
            ...s,
            frameStatus: null, // 稍后批量获取
            runCreatedAt: runCreatedAtMap[s.runId] || null,
          })
        );

        setSamples(samplesWithStatus);
        setSamplesTotal(data.total || 0);

        // 批量获取数据帧状态
        loadFrameStatuses(samplesWithStatus);
      }
    } catch (error) {
      console.error("Failed to load samples:", error);
    } finally {
      setSamplesLoading(false);
    }
  }, [samplesPage, filters, runs, setSamples, setSamplesLoading, setSamplesTotal]);

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
    if (allSelected) {
      clearSampleSelection();
    } else {
      selectAllSamples();
    }
  }, [allSelected, clearSampleSelection, selectAllSamples]);

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
          checked={allSelected}
          onCheckedChange={handleSelectAll}
          aria-label="全选"
          className={cn(someSelected && !allSelected && "data-[state=checked]:bg-primary/50")}
        />
        <span className="text-sm font-medium flex-1">
          样本列表 ({samplesTotal})
        </span>
        {selectedSampleIds.size > 0 && (
          <Badge variant="secondary" className="text-xs">
            已选 {selectedSampleIds.size}
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
                    "hover:bg-accent",
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

                  {/* 数据帧状态 */}
                  <div className="flex-shrink-0">
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
