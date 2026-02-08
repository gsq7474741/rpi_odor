"use client";

import { useState } from "react";
import { useExperiments } from "./context/ExperimentsContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Filter, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortField = "runId" | "sampleIdx" | "time" | "phase";
export type SortOrder = "asc" | "desc";

/**
 * 多选下拉组件
 */
function MultiSelectPopover<T extends string | number>({
  label,
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  renderItem,
  width = "w-48",
}: {
  label: string;
  items: { id: T; label: string; detail?: string }[];
  selectedIds: T[];
  onToggle: (id: T) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  renderItem?: (item: { id: T; label: string; detail?: string }, selected: boolean) => React.ReactNode;
  width?: string;
}) {
  const [open, setOpen] = useState(false);

  const displayText =
    selectedIds.length === 0
      ? "全部"
      : selectedIds.length === 1
        ? items.find((i) => i.id === selectedIds[0])?.label || String(selectedIds[0])
        : `${selectedIds.length} 项`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 justify-between gap-1 font-normal", width)}
        >
          <span className="truncate">{displayText}</span>
          <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", width)} align="start">
        {/* 全选/清除 */}
        {(onSelectAll || onClear) && (
          <div className="flex items-center justify-between px-3 py-2 border-b">
            {onSelectAll && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onSelectAll}
              >
                {selectedIds.length === items.length ? "取消全选" : "全选"}
              </Button>
            )}
            {onClear && selectedIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onClear}
              >
                清除
              </Button>
            )}
          </div>
        )}
        <ScrollArea className="max-h-60">
          <div className="p-1">
            {items.map((item) => {
              const selected = selectedIds.includes(item.id);
              return (
                <div
                  key={String(item.id)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent",
                    selected && "bg-accent/50"
                  )}
                  onClick={() => onToggle(item.id)}
                >
                  <Checkbox checked={selected} className="pointer-events-none" />
                  {renderItem ? (
                    renderItem(item, selected)
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm truncate">{item.label}</span>
                      {item.detail && (
                        <span className="text-xs text-muted-foreground">{item.detail}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                无可选项
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 顶部筛选栏 - 支持多选和排序
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

  const hasFilters =
    filters.runIds.length > 0 ||
    filters.phaseNames.length > 0 ||
    filters.liquidIds.length > 0;

  // 切换函数
  const toggleRunId = (runId: number) => {
    const current = filters.runIds;
    updateFilters({
      runIds: current.includes(runId)
        ? current.filter((id) => id !== runId)
        : [...current, runId],
    });
  };

  const togglePhase = (phase: string) => {
    const current = filters.phaseNames;
    updateFilters({
      phaseNames: current.includes(phase)
        ? current.filter((p) => p !== phase)
        : [...current, phase],
    });
  };

  const toggleLiquid = (liquidId: string) => {
    const current = filters.liquidIds;
    updateFilters({
      liquidIds: current.includes(liquidId)
        ? current.filter((id) => id !== liquidId)
        : [...current, liquidId],
    });
  };

  // 运行列表项
  const runItems = runs.map((r) => ({
    id: r.id,
    label: `#${r.id}`,
    detail: `${r.sampleCount} 样本`,
  }));

  // 阶段列表项
  const phaseItems = availablePhases.map((p) => ({
    id: p,
    label: p,
  }));

  // 液体列表项
  const liquidItems = availableLiquids.map((l) => ({
    id: l.id,
    label: l.name,
  }));

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
      <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

      {/* 运行多选 */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">运行:</span>
        <MultiSelectPopover
          label="运行"
          items={runItems}
          selectedIds={filters.runIds}
          onToggle={toggleRunId}
          onSelectAll={() =>
            updateFilters({
              runIds:
                filters.runIds.length === runs.length
                  ? []
                  : runs.map((r) => r.id),
            })
          }
          onClear={() => updateFilters({ runIds: [] })}
          width="w-40"
        />
      </div>

      {/* 阶段多选 */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">阶段:</span>
        <MultiSelectPopover
          label="阶段"
          items={phaseItems}
          selectedIds={filters.phaseNames}
          onToggle={togglePhase}
          onClear={() => updateFilters({ phaseNames: [] })}
          width="w-36"
        />
      </div>

      {/* 液体多选 */}
      {liquidItems.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">液体:</span>
          <MultiSelectPopover
            label="液体"
            items={liquidItems}
            selectedIds={filters.liquidIds}
            onToggle={toggleLiquid}
            onClear={() => updateFilters({ liquidIds: [] })}
            width="w-52"
          />
        </div>
      )}

      {/* 已选标签 */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {filters.runIds.map((id) => (
          <Badge key={`run-${id}`} variant="secondary" className="gap-1 pr-1 text-xs shrink-0">
            Run #{id}
            <button
              type="button"
              className="ml-0.5 rounded-full hover:bg-muted p-0.5"
              onClick={() => toggleRunId(id)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {filters.phaseNames.map((phase) => (
          <Badge key={`phase-${phase}`} variant="outline" className="gap-1 pr-1 text-xs shrink-0">
            {phase}
            <button
              type="button"
              className="ml-0.5 rounded-full hover:bg-muted p-0.5"
              onClick={() => togglePhase(phase)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      {/* 清除筛选 */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
          <X className="h-4 w-4 mr-1" />
          清除
        </Button>
      )}
    </div>
  );
}
