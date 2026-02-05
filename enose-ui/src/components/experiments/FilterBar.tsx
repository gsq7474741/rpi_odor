"use client";

import { useExperiments } from "./context/ExperimentsContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Filter } from "lucide-react";

/**
 * 顶部筛选栏 - 使用下拉列表进行筛选
 */
export function FilterBar() {
  const {
    runs,
    filters,
    updateFilters,
    clearFilters,
    availableLiquids,
    availablePhases,
  } = useExperiments();

  // 计算选中的统计
  const selectedRunCount = filters.runIds.length;
  const hasFilters = selectedRunCount > 0 || filters.phaseNames.length > 0 || filters.liquidIds.length > 0;

  // 切换运行选中
  const toggleRunId = (runId: number) => {
    const current = filters.runIds;
    if (current.includes(runId)) {
      updateFilters({ runIds: current.filter(id => id !== runId) });
    } else {
      updateFilters({ runIds: [...current, runId] });
    }
  };

  // 切换阶段选中
  const togglePhase = (phase: string) => {
    const current = filters.phaseNames;
    if (current.includes(phase)) {
      updateFilters({ phaseNames: current.filter(p => p !== phase) });
    } else {
      updateFilters({ phaseNames: [...current, phase] });
    }
  };

  // 切换液体选中
  const toggleLiquid = (liquidId: string) => {
    const current = filters.liquidIds;
    if (current.includes(liquidId)) {
      updateFilters({ liquidIds: current.filter(id => id !== liquidId) });
    } else {
      updateFilters({ liquidIds: [...current, liquidId] });
    }
  };

  // 全选/取消全选运行
  const selectAllRuns = () => {
    if (filters.runIds.length === runs.length) {
      updateFilters({ runIds: [] });
    } else {
      updateFilters({ runIds: runs.map(r => r.id) });
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
      <Filter className="h-4 w-4 text-muted-foreground" />
      
      {/* 运行选择 - 多选下拉 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">运行:</span>
        <Select
          value={filters.runIds.length === 1 ? filters.runIds[0].toString() : ""}
          onValueChange={(v) => {
            if (v === "__all__") {
              selectAllRuns();
            } else if (v === "__clear__") {
              updateFilters({ runIds: [] });
            } else {
              toggleRunId(parseInt(v));
            }
          }}
        >
          <SelectTrigger className="w-40 h-8">
            <SelectValue placeholder="选择运行">
              {filters.runIds.length === 0 
                ? "全部" 
                : filters.runIds.length === 1 
                  ? `#${filters.runIds[0]}` 
                  : `${filters.runIds.length} 个运行`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              {filters.runIds.length === runs.length ? "取消全选" : "全选"}
            </SelectItem>
            <SelectItem value="__clear__">清除选择</SelectItem>
            <div className="h-px bg-border my-1" />
            {runs.map((run) => (
              <SelectItem 
                key={run.id} 
                value={run.id.toString()}
                className={filters.runIds.includes(run.id) ? "bg-accent" : ""}
              >
                <div className="flex items-center gap-2">
                  {filters.runIds.includes(run.id) && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                  <span>#{run.id}</span>
                  <span className="text-muted-foreground text-xs">
                    ({run.sampleCount} 样本)
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 阶段选择 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">阶段:</span>
        <Select
          value={filters.phaseNames.length === 1 ? filters.phaseNames[0] : ""}
          onValueChange={(v) => {
            if (v === "__clear__") {
              updateFilters({ phaseNames: [] });
            } else {
              togglePhase(v);
            }
          }}
        >
          <SelectTrigger className="w-32 h-8">
            <SelectValue placeholder="全部阶段">
              {filters.phaseNames.length === 0 
                ? "全部" 
                : filters.phaseNames.length === 1 
                  ? filters.phaseNames[0] 
                  : `${filters.phaseNames.length} 个阶段`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__clear__">全部阶段</SelectItem>
            <div className="h-px bg-border my-1" />
            {availablePhases.map((phase) => (
              <SelectItem 
                key={phase} 
                value={phase}
                className={filters.phaseNames.includes(phase) ? "bg-accent" : ""}
              >
                <div className="flex items-center gap-2">
                  {filters.phaseNames.includes(phase) && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                  <span>{phase}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 液体选择 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">液体:</span>
        <Select
          value={filters.liquidIds.length === 1 ? filters.liquidIds[0] : ""}
          onValueChange={(v) => {
            if (v === "__clear__") {
              updateFilters({ liquidIds: [] });
            } else {
              toggleLiquid(v);
            }
          }}
        >
          <SelectTrigger className="w-32 h-8">
            <SelectValue placeholder="全部液体">
              {filters.liquidIds.length === 0 
                ? "全部" 
                : filters.liquidIds.length === 1 
                  ? availableLiquids.find(l => l.id === filters.liquidIds[0])?.name || filters.liquidIds[0]
                  : `${filters.liquidIds.length} 种液体`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__clear__">全部液体</SelectItem>
            <div className="h-px bg-border my-1" />
            {availableLiquids.map((liquid) => (
              <SelectItem 
                key={liquid.id} 
                value={liquid.id}
                className={filters.liquidIds.includes(liquid.id) ? "bg-accent" : ""}
              >
                <div className="flex items-center gap-2">
                  {filters.liquidIds.includes(liquid.id) && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                  <span>{liquid.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 已选标签 */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {filters.phaseNames.map((phase) => (
          <Badge key={`phase-${phase}`} variant="outline" className="gap-1 pr-1">
            {phase}
            <button
              type="button"
              className="ml-1 rounded-full hover:bg-muted p-0.5"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePhase(phase);
              }}
            >
              <X className="h-3 w-3 hover:text-destructive" />
            </button>
          </Badge>
        ))}
      </div>

      {/* 清除筛选 */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="h-4 w-4 mr-1" />
          清除
        </Button>
      )}
    </div>
  );
}
