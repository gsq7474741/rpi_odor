"use client";

import { useState, useEffect } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  X,
  CalendarIcon,
  ChevronDown,
  Droplets,
  Layers,
  Wind,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function FilterPanel() {
  const {
    filters,
    updateFilters,
    clearFilters,
    availableLiquids,
    availablePhases,
  } = useExperiments();

  const [liquidOpen, setLiquidOpen] = useState(true);
  const [phaseOpen, setPhaseOpen] = useState(true);
  const [pwmOpen, setPwmOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const hasActiveFilters =
    filters.liquidIds.length > 0 ||
    filters.phaseNames.length > 0 ||
    filters.pwmRange !== null ||
    filters.timeRange !== null ||
    filters.paramsHash !== null ||
    filters.searchQuery !== "";

  const toggleLiquid = (liquidId: string) => {
    const current = filters.liquidIds;
    const next = current.includes(liquidId)
      ? current.filter((id) => id !== liquidId)
      : [...current, liquidId];
    updateFilters({ liquidIds: next });
  };

  const togglePhase = (phase: string) => {
    const current = filters.phaseNames;
    const next = current.includes(phase)
      ? current.filter((p) => p !== phase)
      : [...current, phase];
    updateFilters({ phaseNames: next });
  };

  return (
    <div className="space-y-3">
      {/* 清除按钮 */}
      {hasActiveFilters && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-6 text-xs"
          >
            <X className="h-3 w-3 mr-1" />
            清除筛选
          </Button>
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索运行..."
          value={filters.searchQuery}
          onChange={(e) => updateFilters({ searchQuery: e.target.value })}
          className="pl-8 h-9"
        />
      </div>

      {/* 时间范围 */}
      <Collapsible open={dateOpen} onOpenChange={setDateOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between h-8 px-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              <span className="text-sm">时间范围</span>
            </div>
            <div className="flex items-center gap-2">
              {filters.timeRange && (
                <Badge variant="secondary" className="text-xs">
                  已设置
                </Badge>
              )}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", dateOpen && "rotate-180")}
              />
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.timeRange?.[0]?.toISOString().split('T')[0] || ""}
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value) : null;
                  if (date) {
                    updateFilters({
                      timeRange: [date, filters.timeRange?.[1] || new Date()],
                    });
                  }
                }}
              />
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.timeRange?.[1]?.toISOString().split('T')[0] || ""}
                onChange={(e) => {
                  const date = e.target.value ? new Date(e.target.value) : null;
                  if (date) {
                    updateFilters({
                      timeRange: [filters.timeRange?.[0] || new Date(), date],
                    });
                  }
                }}
              />
            </div>
            {filters.timeRange && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => updateFilters({ timeRange: null })}
              >
                清除时间范围
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* 液体类型 */}
      <Collapsible open={liquidOpen} onOpenChange={setLiquidOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between h-8 px-2">
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4" />
              <span className="text-sm">液体类型</span>
            </div>
            <div className="flex items-center gap-2">
              {filters.liquidIds.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {filters.liquidIds.length}
                </Badge>
              )}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", liquidOpen && "rotate-180")}
              />
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <ScrollArea className="h-24">
            <div className="space-y-1 pr-4">
              {availableLiquids.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">暂无液体数据</p>
              ) : (
                availableLiquids.map((liquid) => (
                  <div
                    key={liquid.id}
                    className="flex items-center gap-2 py-0.5"
                  >
                    <Checkbox
                      id={`liquid-${liquid.id}`}
                      checked={filters.liquidIds.includes(liquid.id)}
                      onCheckedChange={() => toggleLiquid(liquid.id)}
                    />
                    <label
                      htmlFor={`liquid-${liquid.id}`}
                      className="text-xs cursor-pointer flex-1 truncate"
                    >
                      {liquid.name}
                    </label>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>

      {/* 阶段 */}
      <Collapsible open={phaseOpen} onOpenChange={setPhaseOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between h-8 px-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              <span className="text-sm">阶段</span>
            </div>
            <div className="flex items-center gap-2">
              {filters.phaseNames.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {filters.phaseNames.length}
                </Badge>
              )}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", phaseOpen && "rotate-180")}
              />
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="space-y-1">
            {availablePhases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">暂无阶段数据</p>
            ) : (
              availablePhases.map((phase) => (
                <div key={phase} className="flex items-center gap-2 py-1">
                  <Checkbox
                    id={`phase-${phase}`}
                    checked={filters.phaseNames.includes(phase)}
                    onCheckedChange={() => togglePhase(phase)}
                  />
                  <label
                    htmlFor={`phase-${phase}`}
                    className="text-sm cursor-pointer flex-1"
                  >
                    {phase}
                  </label>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* 气泵 PWM */}
      <Collapsible open={pwmOpen} onOpenChange={setPwmOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between h-8 px-2">
            <div className="flex items-center gap-2">
              <Wind className="h-4 w-4" />
              <span className="text-sm">气泵 PWM</span>
            </div>
            <div className="flex items-center gap-2">
              {filters.pwmRange && (
                <Badge variant="secondary" className="text-xs">
                  {filters.pwmRange[0]}-{filters.pwmRange[1]}
                </Badge>
              )}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", pwmOpen && "rotate-180")}
              />
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 px-2">
          <div className="space-y-4">
            <Slider
              defaultValue={[0, 100]}
              value={filters.pwmRange || [0, 100]}
              min={0}
              max={100}
              step={5}
              onValueChange={(value) =>
                updateFilters({ pwmRange: value as [number, number] })
              }
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{filters.pwmRange?.[0] || 0}%</span>
              <span>{filters.pwmRange?.[1] || 100}%</span>
            </div>
            {filters.pwmRange && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => updateFilters({ pwmRange: null })}
              >
                清除 PWM 筛选
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* 参数哈希 */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">参数哈希</Label>
        <Input
          placeholder="输入参数哈希..."
          value={filters.paramsHash || ""}
          onChange={(e) =>
            updateFilters({ paramsHash: e.target.value || null })
          }
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
