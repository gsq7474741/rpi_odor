"use client";

import { useMemo, useState } from "react";
import { useExperiments, SampleWithFrameStatus } from "../context/ExperimentsContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FlaskConical,
  Droplets,
  Hash,
  Layers,
  X,
  ChevronDown,
  ChevronRight,
  Beaker,
  Eraser,
  ListFilter,
  Clock,
  Wind,
  Database,
  Thermometer,
  Activity,
} from "lucide-react";

// 颜色调色板
const BAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
  "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-indigo-500",
  "bg-teal-500", "bg-pink-500",
];

interface GroupInfo {
  key: string;
  label: string;
  sampleIds: number[];
  count: number;
}

export function OverviewTab() {
  const {
    samples,
    samplesTotal,
    selectedSampleIds,
    allSelectedSamples,
    removeSamplesFromSelection,
    clearSampleSelection,
    comparisonItems,
    comparisonMode,
  } = useExperiments();

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());


  // === 统计指标 ===
  const stats = useMemo(() => {
    const sel = allSelectedSamples;
    if (sel.length === 0) return null;

    const runIds = new Set(sel.map((s) => s.runId));
    const liquids = new Set(sel.map((s) => s.liquidNames?.join(" + ") || "(无)"));
    const phases = new Set(sel.map((s) => s.phaseName || "(无)"));
    const hashes = new Set(sel.map((s) => s.paramsHash || "(无)"));

    const withFrames = sel.filter((s) => s.frameStatus?.hasFrames).length;
    const frameCoverage = sel.length > 0 ? (withFrames / sel.length) * 100 : 0;

    const durations = sel.filter((s) => s.durationS != null).map((s) => s.durationS!);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const totalDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;

    const temps = sel.filter((s) => s.avgTemperatureC != null).map((s) => s.avgTemperatureC!);
    const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

    const humids = sel.filter((s) => s.avgHumidityPct != null).map((s) => s.avgHumidityPct!);
    const avgHumidity = humids.length > 0 ? humids.reduce((a, b) => a + b, 0) / humids.length : null;

    const readings = sel.filter((s) => s.readingCount > 0).map((s) => s.readingCount);
    const totalReadings = readings.reduce((a, b) => a + b, 0);

    return {
      sampleCount: sel.length,
      runCount: runIds.size,
      liquidCount: liquids.size,
      phaseCount: phases.size,
      hashCount: hashes.size,
      frameCoverage,
      withFrames,
      avgDuration,
      totalDuration,
      avgTemp,
      avgHumidity,
      totalReadings,
    };
  }, [allSelectedSamples]);

  // === 分组统计 ===
  const groupByRun = useMemo((): GroupInfo[] => {
    const map = new Map<number, number[]>();
    allSelectedSamples.forEach((s) => {
      if (!map.has(s.runId)) map.set(s.runId, []);
      map.get(s.runId)!.push(s.id);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([runId, ids]) => ({
        key: `run-${runId}`,
        label: `Run #${runId}`,
        sampleIds: ids,
        count: ids.length,
      }));
  }, [allSelectedSamples]);

  const groupByLiquid = useMemo((): GroupInfo[] => {
    const map = new Map<string, number[]>();
    allSelectedSamples.forEach((s) => {
      const key = s.liquidNames?.join(" + ") || "(无液体)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s.id);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, ids]) => ({
        key: `liq-${name}`,
        label: name,
        sampleIds: ids,
        count: ids.length,
      }));
  }, [allSelectedSamples]);

  const groupByHash = useMemo((): GroupInfo[] => {
    const map = new Map<string, number[]>();
    allSelectedSamples.forEach((s) => {
      const key = s.paramsHash || "(无哈希)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s.id);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([hash, ids]) => ({
        key: `hash-${hash}`,
        label: hash.length > 16 ? hash.slice(0, 8) + "…" : hash,
        sampleIds: ids,
        count: ids.length,
      }));
  }, [allSelectedSamples]);

  const groupByPhase = useMemo((): GroupInfo[] => {
    const map = new Map<string, number[]>();
    allSelectedSamples.forEach((s) => {
      const key = s.phaseName || "(无阶段)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s.id);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([phase, ids]) => ({
        key: `phase-${phase}`,
        label: phase,
        sampleIds: ids,
        count: ids.length,
      }));
  }, [allSelectedSamples]);


  // 切换展开
  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 没有选中任何项目时的提示
  if (selectedSampleIds.size === 0 && !comparisonMode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <FlaskConical className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">选择样本</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          在左侧列表中勾选样本，或点击下方按钮快速选择。
        </p>
        <div className="flex gap-2 mt-4">
          <p className="text-muted-foreground text-xs">
            使用左侧列表的全选复选框可快速选择整页或全部筛选结果。
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-3">
        {/* ===== 选择操作栏（精简） ===== */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">{selectedSampleIds.size}</span>
            <span className="text-sm text-muted-foreground">样本</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 px-2 text-destructive hover:text-destructive" onClick={clearSampleSelection}>
              <Eraser className="h-3 w-3" />
              清空选择
            </Button>
          </div>
        </div>

        {/* ===== KPI 指标网格 ===== */}
        {stats && (
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="运行"
              value={stats.runCount}
              icon={<Beaker className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="液体种类"
              value={stats.liquidCount}
              icon={<Droplets className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="参数组合"
              value={stats.hashCount}
              icon={<Hash className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="帧覆盖"
              value={`${stats.frameCoverage.toFixed(0)}%`}
              sub={`${stats.withFrames}/${stats.sampleCount}`}
              icon={<Database className="h-3.5 w-3.5" />}
              accent={stats.frameCoverage >= 100 ? "green" : stats.frameCoverage > 0 ? "amber" : "red"}
            />
            <StatCard
              label="平均时长"
              value={stats.avgDuration != null ? `${stats.avgDuration.toFixed(1)}s` : "-"}
              sub={stats.totalDuration != null ? `总${(stats.totalDuration / 60).toFixed(1)}min` : undefined}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="数据点"
              value={stats.totalReadings > 1000 ? `${(stats.totalReadings / 1000).toFixed(1)}k` : String(stats.totalReadings)}
              icon={<Activity className="h-3.5 w-3.5" />}
            />
            {stats.avgTemp != null && (
              <StatCard
                label="平均温度"
                value={`${stats.avgTemp.toFixed(1)}°C`}
                icon={<Thermometer className="h-3.5 w-3.5" />}
              />
            )}
            {stats.avgHumidity != null && (
              <StatCard
                label="平均湿度"
                value={`${stats.avgHumidity.toFixed(1)}%`}
                icon={<Wind className="h-3.5 w-3.5" />}
              />
            )}
            <StatCard
              label="阶段"
              value={stats.phaseCount}
              icon={<ListFilter className="h-3.5 w-3.5" />}
            />
          </div>
        )}

        {/* ===== 液体分布 ===== */}
        {groupByLiquid.length > 0 && (
          <DistributionCard
            title="液体分布"
            icon={<Droplets className="h-3.5 w-3.5" />}
            groups={groupByLiquid}
            total={allSelectedSamples.length}
            onRemove={(ids) => removeSamplesFromSelection(ids)}
          />
        )}

        {/* ===== 阶段分布 ===== */}
        {groupByPhase.length > 1 && (
          <DistributionCard
            title="阶段分布"
            icon={<ListFilter className="h-3.5 w-3.5" />}
            groups={groupByPhase}
            total={allSelectedSamples.length}
            onRemove={(ids) => removeSamplesFromSelection(ids)}
          />
        )}

        {/* ===== 分组管理（双列） ===== */}
        <div className="grid grid-cols-2 gap-2">
          {/* 按 Run 分组 */}
          {groupByRun.length > 0 && (
            <GroupCard
              title="按运行"
              icon={<Beaker className="h-3.5 w-3.5" />}
              groups={groupByRun}
              expandedGroups={expandedGroups}
              onToggleGroup={toggleGroup}
              onRemoveGroup={(ids) => removeSamplesFromSelection(ids)}
              allSamples={allSelectedSamples}
            />
          )}

          {/* 按参数哈希分组 */}
          {groupByHash.length > 1 && (
            <GroupCard
              title="按哈希"
              icon={<Hash className="h-3.5 w-3.5" />}
              groups={groupByHash}
              expandedGroups={expandedGroups}
              onToggleGroup={toggleGroup}
              onRemoveGroup={(ids) => removeSamplesFromSelection(ids)}
              allSamples={allSelectedSamples}
              mono
            />
          )}
        </div>

        {/* ===== 对比模式 ===== */}
        {comparisonMode && comparisonItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                对比项 ({comparisonItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-2">
              <div className="flex flex-wrap gap-1">
                {comparisonItems.map((item, idx) => (
                  <Badge key={idx} variant="secondary" className="text-[10px]">
                    {item.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== 选中样本详情（可折叠） ===== */}
        {allSelectedSamples.length > 0 && allSelectedSamples.length <= 30 && (
          <Collapsible>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 pt-2.5 px-3 cursor-pointer hover:bg-accent/50 transition-colors">
                  <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                    <FlaskConical className="h-3.5 w-3.5" />
                    样本列表
                    <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">
                      {allSelectedSamples.length}
                    </Badge>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="px-3 pb-2">
                  <div className="space-y-1">
                    {allSelectedSamples.map((sample) => (
                      <div
                        key={sample.id}
                        className="flex items-center justify-between border rounded px-2 py-1 text-[11px] group"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium tabular-nums shrink-0">S#{sample.id}</span>
                          <span className="text-muted-foreground shrink-0">R#{sample.runId}</span>
                          <Separator orientation="vertical" className="h-2.5" />
                          <span className="truncate text-muted-foreground">{sample.liquidNames?.join(" + ") || "-"}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => removeSamplesFromSelection([sample.id])}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}
      </div>
    </ScrollArea>
  );
}

/** 指标卡片 */
function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: "green" | "amber" | "red";
}) {
  const accentColor = accent === "green"
    ? "text-green-600"
    : accent === "amber"
    ? "text-amber-600"
    : accent === "red"
    ? "text-red-500"
    : "text-foreground";

  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] leading-none">{label}</span>
      </div>
      <div className={`text-lg font-semibold tabular-nums leading-none ${accentColor}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      )}
    </div>
  );
}

/** 分布条形图卡片 */
function DistributionCard({
  title,
  icon,
  groups,
  total,
  onRemove,
}: {
  title: string;
  icon: React.ReactNode;
  groups: GroupInfo[];
  total: number;
  onRemove: (ids: number[]) => void;
}) {
  const maxCount = Math.max(...groups.map((g) => g.count));

  return (
    <Card>
      <CardHeader className="pb-1.5 pt-2.5 px-3">
        <CardTitle className="text-xs font-medium flex items-center gap-1.5">
          {icon}
          {title}
          <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">
            {groups.length} 类
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2.5 space-y-1.5">
        <TooltipProvider delayDuration={200}>
          {groups.map((group, idx) => {
            const pct = total > 0 ? (group.count / total) * 100 : 0;
            const barPct = maxCount > 0 ? (group.count / maxCount) * 100 : 0;
            return (
              <Tooltip key={group.key}>
                <TooltipTrigger asChild>
                  <div className="group/bar cursor-default">
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="truncate max-w-[60%]">{group.label}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="tabular-nums text-muted-foreground">{group.count}</span>
                        <span className="text-[10px] text-muted-foreground/70 tabular-nums w-8 text-right">{pct.toFixed(0)}%</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 opacity-0 group-hover/bar:opacity-100 text-destructive hover:text-destructive shrink-0"
                          onClick={() => onRemove(group.sampleIds)}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${BAR_COLORS[idx % BAR_COLORS.length]}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  {group.label}: {group.count} 样本 ({pct.toFixed(1)}%)
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

/** 分组管理卡片（紧凑） */
function GroupCard({
  title,
  icon,
  groups,
  expandedGroups,
  onToggleGroup,
  onRemoveGroup,
  allSamples,
  mono = false,
}: {
  title: string;
  icon: React.ReactNode;
  groups: GroupInfo[];
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onRemoveGroup: (ids: number[]) => void;
  allSamples: SampleWithFrameStatus[];
  mono?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1.5 pt-2.5 px-3">
        <CardTitle className="text-xs font-medium flex items-center gap-1.5">
          {icon}
          {title}
          <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">{groups.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2 space-y-0.5">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.key);
          return (
            <div key={group.key} className="rounded border">
              <div className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
                <button
                  className="shrink-0 hover:bg-accent rounded p-0.5"
                  onClick={() => onToggleGroup(group.key)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-2.5 w-2.5" />
                  ) : (
                    <ChevronRight className="h-2.5 w-2.5" />
                  )}
                </button>
                <span className={`truncate flex-1 ${mono ? "font-mono text-[10px]" : ""}`}>
                  {group.label}
                </span>
                <Badge variant="secondary" className="text-[9px] h-3.5 px-1 tabular-nums shrink-0">
                  {group.count}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => onRemoveGroup(group.sampleIds)}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
              {isExpanded && (
                <div className="border-t px-1.5 py-0.5 space-y-0">
                  {group.sampleIds.map((id) => {
                    const s = allSamples.find((s) => s.id === id);
                    return (
                      <div key={id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-0.5 group/item">
                        <span className="tabular-nums">S#{id}</span>
                        {s && <span className="truncate">{s.liquidNames?.join("+") || "-"}</span>}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3.5 w-3.5 p-0 ml-auto opacity-0 group-hover/item:opacity-100 shrink-0"
                          onClick={() => onRemoveGroup([id])}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
