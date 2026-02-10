"use client";

import { useMemo, useState } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Grid3X3, FlaskConical, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

// 组合单元格数据
interface CombinationCell {
  substanceA: string;
  substanceB: string;
  totalCount: number;
  ratios: { ratio: number; count: number; goodCount: number }[];
  qualityBreakdown: { good: number; warning: number; poor: number; unknown: number };
}

// 纯物质统计
interface PureSubstanceStat {
  substance: string;
  count: number;
  goodCount: number;
}

// 多元组合数据
interface MultiCombinationCell {
  substances: string[];
  totalCount: number;
  ratioSets: { ratioStr: string; ratios: number[]; count: number }[];
  qualityBreakdown: { good: number; warning: number; poor: number; unknown: number };
}

const MULTI_COLORS = [
  "bg-blue-500/70",
  "bg-emerald-500/70",
  "bg-orange-500/70",
  "bg-purple-500/70",
  "bg-pink-500/70",
];

type ColorMode = "count" | "quality";

/**
 * 组合覆盖热力图 Tab
 * 展示物质两两组合的实验覆盖情况
 */
export function CoverageTab() {
  const { samples } = useExperiments();
  const [colorMode, setColorMode] = useState<ColorMode>("count");

  // 从当前样本中提取所有物质名和组合数据
  const { substances, combinations, pureStats, multiCombos, totalBinary, totalPure, totalMulti } = useMemo(() => {
    const substanceSet = new Set<string>();
    const combMap = new Map<string, CombinationCell>();
    const pureMap = new Map<string, PureSubstanceStat>();
    const multiMap = new Map<string, MultiCombinationCell>();
    let binaryCount = 0;
    let multiCount = 0;

    for (const s of samples) {
      if (s.isAnchor || s.isBlank) continue;

      const names = s.liquidNames;
      const ratios = s.liquidRatios;
      const quality = s.qualityLevel || "unknown";

      if (names.length === 1) {
        // 纯物质
        const name = names[0];
        substanceSet.add(name);
        const existing = pureMap.get(name) || { substance: name, count: 0, goodCount: 0 };
        existing.count++;
        if (quality === "good" || quality === "unknown") existing.goodCount++;
        pureMap.set(name, existing);
      } else if (names.length === 2) {
        // 二元组合
        const [a, b] = names[0] < names[1] ? [names[0], names[1]] : [names[1], names[0]];
        const ratioA = names[0] < names[1] ? ratios[0] : ratios[1];
        substanceSet.add(a);
        substanceSet.add(b);

        const key = `${a}|${b}`;
        const existing = combMap.get(key) || {
          substanceA: a,
          substanceB: b,
          totalCount: 0,
          ratios: [],
          qualityBreakdown: { good: 0, warning: 0, poor: 0, unknown: 0 },
        };
        existing.totalCount++;
        
        // 质量统计
        if (quality === "good") existing.qualityBreakdown.good++;
        else if (quality === "warning") existing.qualityBreakdown.warning++;
        else if (quality === "poor") existing.qualityBreakdown.poor++;
        else existing.qualityBreakdown.unknown++;

        // 比例统计（四舍五入到 0.05 精度）
        const roundedRatio = Math.round(ratioA * 20) / 20;
        const ratioEntry = existing.ratios.find((r) => Math.abs(r.ratio - roundedRatio) < 0.001);
        if (ratioEntry) {
          ratioEntry.count++;
          if (quality === "good" || quality === "unknown") ratioEntry.goodCount++;
        } else {
          existing.ratios.push({
            ratio: roundedRatio,
            count: 1,
            goodCount: quality === "good" || quality === "unknown" ? 1 : 0,
          });
        }
        existing.ratios.sort((a, b) => a.ratio - b.ratio);
        combMap.set(key, existing);
        binaryCount++;
      } else if (names.length >= 3) {
        // 三元及以上：分解两两组合添加到热力图 + 跟踪多元组合
        for (const name of names) substanceSet.add(name);

        // 分解为两两组合（仅计数，不记录比例）
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            const [a, b] = names[i] < names[j] ? [names[i], names[j]] : [names[j], names[i]];
            const pairKey = `${a}|${b}`;
            const pairCell = combMap.get(pairKey) || {
              substanceA: a,
              substanceB: b,
              totalCount: 0,
              ratios: [],
              qualityBreakdown: { good: 0, warning: 0, poor: 0, unknown: 0 },
            };
            pairCell.totalCount++;
            if (quality === "good") pairCell.qualityBreakdown.good++;
            else if (quality === "warning") pairCell.qualityBreakdown.warning++;
            else if (quality === "poor") pairCell.qualityBreakdown.poor++;
            else pairCell.qualityBreakdown.unknown++;
            combMap.set(pairKey, pairCell);
          }
        }

        // 跟踪多元组合
        const sorted = names.map((n, i) => ({ name: n, ratio: ratios[i] || 0 }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const multiKey = sorted.map((p) => p.name).join("|");
        const ratioStr = sorted.map((p) => `${(p.ratio * 100).toFixed(0)}%`).join(":");

        const existingMulti = multiMap.get(multiKey) || {
          substances: sorted.map((p) => p.name),
          totalCount: 0,
          ratioSets: [],
          qualityBreakdown: { good: 0, warning: 0, poor: 0, unknown: 0 },
        };
        existingMulti.totalCount++;
        if (quality === "good") existingMulti.qualityBreakdown.good++;
        else if (quality === "warning") existingMulti.qualityBreakdown.warning++;
        else if (quality === "poor") existingMulti.qualityBreakdown.poor++;
        else existingMulti.qualityBreakdown.unknown++;

        const ratioSetEntry = existingMulti.ratioSets.find((d) => d.ratioStr === ratioStr);
        if (ratioSetEntry) {
          ratioSetEntry.count++;
        } else {
          existingMulti.ratioSets.push({ ratioStr, count: 1, ratios: sorted.map((p) => p.ratio) });
        }
        multiMap.set(multiKey, existingMulti);
        multiCount++;
      }
    }

    const sortedSubstances = Array.from(substanceSet).sort();
    return {
      substances: sortedSubstances,
      combinations: combMap,
      pureStats: pureMap,
      multiCombos: multiMap,
      totalBinary: binaryCount,
      totalPure: Array.from(pureMap.values()).reduce((sum, p) => sum + p.count, 0),
      totalMulti: multiCount,
    };
  }, [samples]);

  // 颜色计算
  const maxCount = useMemo(() => {
    let max = 0;
    combinations.forEach((c) => {
      if (c.totalCount > max) max = c.totalCount;
    });
    return max || 1;
  }, [combinations]);

  const getCellColor = (cell: CombinationCell | undefined): string => {
    if (!cell || cell.totalCount === 0) return "bg-muted/30";

    if (colorMode === "quality") {
      const { good, warning, poor } = cell.qualityBreakdown;
      const total = good + warning + poor + cell.qualityBreakdown.unknown;
      const goodRatio = (good + cell.qualityBreakdown.unknown) / total;
      if (goodRatio >= 0.8) return "bg-green-500/70";
      if (goodRatio >= 0.5) return "bg-yellow-500/70";
      return "bg-red-500/70";
    }

    // count mode
    const intensity = Math.min(cell.totalCount / maxCount, 1);
    if (intensity > 0.75) return "bg-blue-600/80";
    if (intensity > 0.5) return "bg-blue-500/60";
    if (intensity > 0.25) return "bg-blue-400/40";
    return "bg-blue-300/25";
  };

  const getCellTextColor = (cell: CombinationCell | undefined): string => {
    if (!cell || cell.totalCount === 0) return "text-muted-foreground/50";
    const intensity = cell.totalCount / maxCount;
    return intensity > 0.5 ? "text-white" : "text-foreground";
  };

  if (substances.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <Grid3X3 className="h-12 w-12 mx-auto opacity-30" />
          <p>无样本数据</p>
          <p className="text-xs">请在左侧选择包含液体组合的样本</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* 统计摘要 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{substances.length} 种物质</span>
            </div>
            {totalPure > 0 && <Badge variant="secondary">{totalPure} 纯物质样本</Badge>}
            {totalBinary > 0 && <Badge variant="secondary">{totalBinary} 二元组合样本</Badge>}
            {totalMulti > 0 && <Badge variant="secondary">{totalMulti} 多元组合样本</Badge>}
            <Badge variant="outline">
              {combinations.size}/{(substances.length * (substances.length - 1)) / 2} 组合已覆盖
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">染色:</span>
            <Select value={colorMode} onValueChange={(v) => setColorMode(v as ColorMode)}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">重复数</SelectItem>
                <SelectItem value="quality">质量</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 热力图矩阵 */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Grid3X3 className="h-4 w-4" />
              组合覆盖矩阵
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <TooltipProvider delayDuration={200}>
              <div className="overflow-x-auto">
                <table className="border-collapse">
                  <thead>
                    <tr>
                      <th className="p-1 text-xs font-medium text-muted-foreground w-24" />
                      {substances.map((name) => (
                        <th
                          key={name}
                          className="p-1 text-xs font-medium text-muted-foreground min-w-[3rem] text-center"
                        >
                          <span className="writing-mode-vertical inline-block max-w-[3rem] truncate" title={name}>
                            {name.length > 6 ? name.slice(0, 5) + "…" : name}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {substances.map((rowName, ri) => (
                      <tr key={rowName}>
                        <td className="p-1 text-xs font-medium text-muted-foreground truncate max-w-[6rem]" title={rowName}>
                          {rowName}
                        </td>
                        {substances.map((colName, ci) => {
                          if (ci <= ri) {
                            // 对角线和下三角：纯物质 or 空
                            if (ci === ri) {
                              const pure = pureStats.get(rowName);
                              return (
                                <Tooltip key={colName}>
                                  <TooltipTrigger asChild>
                                    <td
                                      className={cn(
                                        "p-1 text-center text-xs font-mono cursor-default border",
                                        pure && pure.count > 0
                                          ? "bg-emerald-500/30 text-foreground"
                                          : "bg-muted/20 text-muted-foreground/40"
                                      )}
                                    >
                                      {pure?.count || "-"}
                                    </td>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-medium">{rowName} (纯物质)</p>
                                    <p className="text-xs">{pure?.count || 0} 样本, {pure?.goodCount || 0} 良好</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            return <td key={colName} className="p-1 border bg-muted/10" />;
                          }

                          // 上三角：二元组合
                          const a = rowName < colName ? rowName : colName;
                          const b = rowName < colName ? colName : rowName;
                          const cell = combinations.get(`${a}|${b}`);

                          return (
                            <Tooltip key={colName}>
                              <TooltipTrigger asChild>
                                <td
                                  className={cn(
                                    "p-1 text-center text-xs font-mono cursor-default border transition-colors",
                                    getCellColor(cell),
                                    getCellTextColor(cell)
                                  )}
                                >
                                  {cell?.totalCount || "-"}
                                </td>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="font-medium">{a} × {b}</p>
                                {cell ? (
                                  <div className="text-xs space-y-1 mt-1">
                                    <p>{cell.totalCount} 样本</p>
                                    <p>
                                      质量: {cell.qualityBreakdown.good} 良好
                                      {cell.qualityBreakdown.warning > 0 && `, ${cell.qualityBreakdown.warning} 警告`}
                                      {cell.qualityBreakdown.poor > 0 && `, ${cell.qualityBreakdown.poor} 差`}
                                    </p>
                                    {cell.ratios.length > 0 && (
                                      <p>
                                        比例点: {cell.ratios.map((r) => `${(r.ratio * 100).toFixed(0)}%`).join(", ")}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">未覆盖</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>

            {/* 图例 */}
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              {colorMode === "count" ? (
                <>
                  <span>少</span>
                  <div className="flex gap-0.5">
                    <div className="w-4 h-4 rounded-sm bg-blue-300/25" />
                    <div className="w-4 h-4 rounded-sm bg-blue-400/40" />
                    <div className="w-4 h-4 rounded-sm bg-blue-500/60" />
                    <div className="w-4 h-4 rounded-sm bg-blue-600/80" />
                  </div>
                  <span>多</span>
                  <div className="w-4 h-4 rounded-sm bg-emerald-500/30 border" />
                  <span>纯物质</span>
                  <div className="w-4 h-4 rounded-sm bg-muted/30 border" />
                  <span>未覆盖</span>
                </>
              ) : (
                <>
                  <div className="w-4 h-4 rounded-sm bg-green-500/70" />
                  <span>良好 ≥80%</span>
                  <div className="w-4 h-4 rounded-sm bg-yellow-500/70" />
                  <span>警告 50-80%</span>
                  <div className="w-4 h-4 rounded-sm bg-red-500/70" />
                  <span>差 &lt;50%</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 比例覆盖详情 */}
        {Array.from(combinations.values()).some((c) => c.ratios.length > 0) && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                二元比例点覆盖
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from(combinations.values())
                  .filter((c) => c.ratios.length > 0)
                  .sort((a, b) => b.totalCount - a.totalCount)
                  .slice(0, 12)
                  .map((cell) => (
                    <div
                      key={`${cell.substanceA}|${cell.substanceB}`}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {cell.substanceA} × {cell.substanceB}
                        </span>
                        <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                          {cell.totalCount}
                        </Badge>
                      </div>
                      {/* 比例条形图 */}
                      <div className="flex items-end gap-px h-8">
                        {cell.ratios.map((r) => {
                          const height = Math.max((r.count / Math.max(...cell.ratios.map((x) => x.count))) * 100, 10);
                          return (
                            <TooltipProvider key={r.ratio} delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="flex-1 bg-blue-500/60 rounded-t-sm min-w-[4px] cursor-default hover:bg-blue-500/80 transition-colors"
                                    style={{ height: `${height}%` }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">
                                    {cell.substanceA} {(r.ratio * 100).toFixed(0)}% : {cell.substanceB} {((1 - r.ratio) * 100).toFixed(0)}%
                                  </p>
                                  <p className="text-xs">{r.count} 样本, {r.goodCount} 良好</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 多元组合详情 */}
        {multiCombos.size > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                多元组合详情 ({multiCombos.size} 种组合)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from(multiCombos.values())
                  .sort((a, b) => b.totalCount - a.totalCount)
                  .map((cell) => (
                    <div
                      key={cell.substances.join("|")}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {cell.substances.join(" × ")}
                        </span>
                        <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                          {cell.totalCount}
                        </Badge>
                      </div>
                      {/* 比例堆叠条 */}
                      <div className="space-y-1.5">
                        {cell.ratioSets
                          .sort((a, b) => b.count - a.count)
                          .slice(0, 8)
                          .map((rs) => (
                            <div key={rs.ratioStr} className="flex items-center gap-2">
                              <div className="flex-1 flex h-5 rounded-sm overflow-hidden border">
                                {rs.ratios.map((r, i) => (
                                  <TooltipProvider key={i} delayDuration={100}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={cn("h-full", MULTI_COLORS[i % MULTI_COLORS.length])}
                                          style={{ width: `${Math.max(r * 100, 2)}%` }}
                                        />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">
                                          {cell.substances[i]}: {(r * 100).toFixed(0)}%
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ))}
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                ×{rs.count}
                              </span>
                            </div>
                          ))}
                      </div>
                      {/* 物质图例 */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        {cell.substances.map((name, i) => (
                          <span key={name} className="flex items-center gap-1">
                            <span
                              className={cn("inline-block w-2 h-2 rounded-sm", MULTI_COLORS[i % MULTI_COLORS.length])}
                            />
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
