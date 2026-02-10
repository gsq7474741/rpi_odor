"use client";

import { useState, useMemo } from "react";
import { useExperiments } from "./context/ExperimentsContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { X, Filter, ChevronsUpDown, Anchor, FlaskConical, ShieldCheck, Search } from "lucide-react";
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
  loading = false,
  searchable = false,
}: {
  label: string;
  items: { id: T; label: string; detail?: string; tooltip?: string }[];
  selectedIds: T[];
  onToggle: (id: T) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  renderItem?: (item: { id: T; label: string; detail?: string; tooltip?: string }, selected: boolean) => React.ReactNode;
  width?: string;
  loading?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.detail && item.detail.toLowerCase().includes(q)) ||
        String(item.id).includes(q)
    );
  }, [items, search]);

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
        {/* 搜索框 */}
        {searchable && (
          <div className="px-2 pt-2 pb-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={`搜索${label}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>
        )}
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
        <div className="max-h-72 overflow-y-auto p-1">
          {filteredItems.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <div
                key={String(item.id)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent",
                  selected && "bg-accent/50"
                )}
                onClick={() => onToggle(item.id)}
                title={item.tooltip}
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
          {filteredItems.length === 0 && (
            <div className="px-2 py-4 text-sm text-center text-muted-foreground">
              {loading ? "加载中..." : search ? "无匹配项" : "无可选项"}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 顶部筛选栏 - 支持多选和排序
 */
export function FilterBar() {
  const {
    filters,
    updateFilters,
    clearFilters,
    availableRuns,
    availableLiquids,
    availablePhases,
    filterOptionsLoading,
  } = useExperiments();

  const hasFilters =
    filters.runIds.length > 0 ||
    filters.phaseNames.length > 0 ||
    filters.liquidIds.length > 0 ||
    filters.experimentPhases.length > 0 ||
    filters.componentCount !== null ||
    filters.qualityLevels.length > 0 ||
    filters.showAnchorsOnly ||
    filters.showBlanksOnly ||
    filters.hideAnchorsAndBlanks;

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

  // 运行列表项（使用独立的 availableRuns，不受分页影响）
  const runItems = availableRuns.map((r) => ({
    id: r.id,
    label: `#${r.id}`,
    detail: `${r.sampleCount} 样本`,
    tooltip: `运行 #${r.id}，共 ${r.sampleCount} 个样本`,
  }));

  // 阶段列表项
  const phaseDescriptions: Record<string, string> = {
    BASELINE: "基线阶段 - 采集环境基准信号",
    DOSE: "加样阶段 - 注入样品液体",
    EQUILIBRATION: "平衡阶段 - 等待信号稳定",
    SAMPLE: "采样阶段 - 正式采集传感器数据",
    PURGE: "吹扫阶段 - 清除残留气体",
    RECOVERY: "恢复阶段 - 等待传感器恢复",
    RINSE: "清洗阶段 - 管路液体清洗",
    PREHEAT: "预热阶段 - 加热器预热",
    INJECT: "注入阶段 - 液体注入气室",
    ACQUIRE: "采集阶段 - 传感器数据采集",
    DRAIN: "排液阶段 - 排出残余液体",
    WASH: "清洗阶段 - 气室清洗",
  };
  const phaseItems = availablePhases.map((p) => ({
    id: p,
    label: p,
    tooltip: phaseDescriptions[p] || p,
  }));

  // 液体列表项
  const liquidItems = availableLiquids.map((l) => ({
    id: l.id,
    label: l.name,
    tooltip: `液体: ${l.name}`,
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
                filters.runIds.length === availableRuns.length
                  ? []
                  : availableRuns.map((r) => r.id),
            })
          }
          onClear={() => updateFilters({ runIds: [] })}
          width="w-40"
          loading={filterOptionsLoading}
          searchable
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

      {/* 组分数量 */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
              <Select
                value={filters.componentCount?.toString() || "all"}
                onValueChange={(v) =>
                  updateFilters({ componentCount: v === "all" ? null : parseInt(v) })
                }
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="1">1元（纯物质）</SelectItem>
                  <SelectItem value="2">2元混合</SelectItem>
                  <SelectItem value="3">3元混合</SelectItem>
                  <SelectItem value="4">4元及以上</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>按液体组分数量筛选（n元 = n种液体混合）</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 质量等级 */}
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
        <MultiSelectPopover
          label="质量"
          items={[
            { id: "good", label: "良好" },
            { id: "warning", label: "警告" },
            { id: "poor", label: "差" },
          ]}
          selectedIds={filters.qualityLevels}
          onToggle={(level) => {
            const current = filters.qualityLevels;
            updateFilters({
              qualityLevels: current.includes(level)
                ? current.filter((l) => l !== level)
                : [...current, level],
            });
          }}
          onClear={() => updateFilters({ qualityLevels: [] })}
          width="w-28"
        />
      </div>

      {/* 锚点/空白快捷筛选 */}
      <div className="flex items-center gap-1">
        <Button
          variant={filters.hideAnchorsAndBlanks ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() =>
            updateFilters({
              hideAnchorsAndBlanks: !filters.hideAnchorsAndBlanks,
              showAnchorsOnly: false,
              showBlanksOnly: false,
            })
          }
          title="隐藏锚点和空白样品"
        >
          隐藏QC
        </Button>
        <Button
          variant={filters.showAnchorsOnly ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() =>
            updateFilters({
              showAnchorsOnly: !filters.showAnchorsOnly,
              showBlanksOnly: false,
              hideAnchorsAndBlanks: false,
            })
          }
          title="仅显示漂移校准锚点"
        >
          <Anchor className="h-3 w-3 mr-1" />
          锚点
        </Button>
      </div>

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
