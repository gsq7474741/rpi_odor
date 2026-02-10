"use client";

import React, { useMemo, useState } from "react";
import { useExperiments, SampleWithFrameStatus } from "../context/ExperimentsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GitCompare,
  X,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SensorBoardLayout } from "../SensorBoardLayout";

interface ParamRow {
  key: string;
  label: string;
  values: (string | number | null)[];
  isDifferent: boolean;
}

// 检查两个 heaterConfigs 是否相同（用于差异检测）
function heaterConfigsEqual(
  a: { sensorIndices: number[]; profileName: string }[],
  b: { sensorIndices: number[]; profileName: string }[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].profileName !== b[i].profileName) return false;
    if (a[i].sensorIndices.join(",") !== b[i].sensorIndices.join(",")) return false;
  }
  return true;
}

// 单元格内容：超长时截断并显示 tooltip
const TRUNCATE_LEN = 24;
function CellValue({ value }: { value: string | number | null }) {
  const text = value == null ? "-" : String(value);
  if (text.length <= TRUNCATE_LEN) {
    return <span className="whitespace-nowrap">{text}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block truncate cursor-default" title={text}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs break-all">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// 哈希单元格：截断显示 + hover 查看完整值 + 点击复制
function HashCell({ value }: { value: string | number | null }) {
  const [copied, setCopied] = React.useState(false);
  const full = value == null ? "-" : String(value);
  const short = full.length > 12 ? full.slice(0, 12) + "…" : full;

  const handleCopy = async () => {
    if (full === "-") return;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 font-mono text-xs cursor-pointer hover:text-primary transition-colors"
          onClick={handleCopy}
        >
          {short}
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3 opacity-0 group-hover/hash:opacity-60" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs break-all font-mono text-xs">
        <p>{full}</p>
        <p className="text-muted-foreground mt-1">点击复制</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function CompareTab() {
  const {
    comparisonMode,
    comparisonItems,
    selectedSampleIds,
    samples,
    clearComparison,
    removeFromComparison,
    toggleComparisonMode,
  } = useExperiments();

  // 收集选中的样本数据 - 使用新的 samples 数组
  const selectedSamples = useMemo(() => {
    // 从 comparisonItems 获取样本 ID
    const comparisonSampleIds = comparisonItems
      .filter((item) => item.type === "sample")
      .map((item) => item.id as number);

    // 优先使用 comparisonItems，否则使用 selectedSampleIds
    const targetIds = comparisonSampleIds.length > 0 
      ? comparisonSampleIds 
      : Array.from(selectedSampleIds);

    // 从 samples 数组中查找匹配的样本
    return samples.filter((s) => targetIds.includes(s.id));
  }, [comparisonItems, selectedSampleIds, samples]);

  // 构建参数对比表
  const paramRows = useMemo((): ParamRow[] => {
    if (selectedSamples.length < 2) return [];

    const formatLiquidFormula = (s: SampleWithFrameStatus) => {
      if (!s.liquidNames || s.liquidNames.length === 0) return "-";
      if (s.liquidNames.length === 1) return s.liquidNames[0];
      // 归一化比例：ratio 可能是小数(0.2, 0.8)或百分比(20, 80)，统一按比例归一化
      const ratioSum = s.liquidRatios?.reduce((a, b) => a + b, 0) ?? 0;
      return s.liquidNames
        .map((name, i) => {
          const ratio = s.liquidRatios?.[i];
          if (ratio == null || ratioSum <= 0) return name;
          const pct = (ratio / ratioSum * 100).toFixed(0);
          return `${name}(${pct}%)`;
        })
        .join(" + ");
    };

    const formatTermination = (s: SampleWithFrameStatus) => {
      if (!s.terminationType) return "-";
      return `${s.terminationType}: ${s.terminationValue}`;
    };

    const rows: ParamRow[] = [
      {
        key: "runId",
        label: "运行 ID",
        values: selectedSamples.map((s) => s.runId),
        isDifferent: false,
      },
      {
        key: "sampleIdx",
        label: "样本序号",
        values: selectedSamples.map((s) => s.sampleIdx),
        isDifferent: false,
      },
      {
        key: "liquidFormula",
        label: "液体配方",
        values: selectedSamples.map(formatLiquidFormula),
        isDifferent: false,
      },
      {
        key: "totalVolumeMl",
        label: "进样量 (ml)",
        values: selectedSamples.map((s) => s.totalVolumeMl?.toFixed(2) || "-"),
        isDifferent: false,
      },
      {
        key: "flowRateMlS",
        label: "流速 (ml/s)",
        values: selectedSamples.map((s) => s.flowRateMlS?.toFixed(3) || "-"),
        isDifferent: false,
      },
      {
        key: "gasPumpPwm",
        label: "气泵 PWM",
        values: selectedSamples.map((s) => `${s.gasPumpPwm}%`),
        isDifferent: false,
      },
      {
        key: "termination",
        label: "终止条件",
        values: selectedSamples.map(formatTermination),
        isDifferent: false,
      },
      {
        key: "heaterProfiles",
        label: "加热器配置",
        values: selectedSamples.map((s) => s.heaterProfiles?.join(", ") || "-"),
        isDifferent: false,
      },
      {
        key: "phaseName",
        label: "阶段",
        values: selectedSamples.map((s) => s.phaseName),
        isDifferent: false,
      },
      {
        key: "durationS",
        label: "时长 (s)",
        values: selectedSamples.map((s) => s.durationS != null ? s.durationS.toFixed(1) : "-"),
        isDifferent: false,
      },
      {
        key: "preWashCount",
        label: "预清洗次数",
        values: selectedSamples.map((s) => s.preWashCount || 0),
        isDifferent: false,
      },
      {
        key: "avgTemperatureC",
        label: "平均温度 (°C)",
        values: selectedSamples.map((s) => s.avgTemperatureC?.toFixed(1) || "-"),
        isDifferent: false,
      },
      {
        key: "avgHumidityPct",
        label: "平均湿度 (%)",
        values: selectedSamples.map((s) => s.avgHumidityPct?.toFixed(1) || "-"),
        isDifferent: false,
      },
      {
        key: "avgPressureHpa",
        label: "平均气压 (hPa)",
        values: selectedSamples.map((s) => s.avgPressureHpa?.toFixed(1) || "-"),
        isDifferent: false,
      },
      {
        key: "paramsHash",
        label: "参数哈希",
        values: selectedSamples.map((s) => s.paramsHash || "-"),
        isDifferent: false,
      },
    ];

    // 计算差异
    rows.forEach((row) => {
      const uniqueValues = new Set(row.values.map((v) => String(v)));
      row.isDifferent = uniqueValues.size > 1;
    });

    return rows;
  }, [selectedSamples]);

  // 选中项不足
  if (selectedSamples.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <GitCompare className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">选择更多样本</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          在左侧列表中展开运行并选择至少 2 个样本进行参数对比。
          <br />
          当前已选择 {selectedSamples.length} 个样本。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {selectedSamples.length} 个样本
          </Badge>
          {paramRows.filter((r) => r.isDifferent).length > 0 && (
            <Badge variant="outline" className="text-orange-600 border-orange-300">
              {paramRows.filter((r) => r.isDifferent).length} 项差异
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={clearComparison}>
          <Trash2 className="h-4 w-4 mr-2" />
          清空对比
        </Button>
      </div>

      {/* 对比表格 */}
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">参数对比</CardTitle>
          <CardDescription>
            差异项以橙色高亮显示
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-300px)]">
            <div className="min-w-max">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36 sticky left-0 bg-background z-10">参数</TableHead>
                  {selectedSamples.map((sample) => (
                    <TableHead key={sample.id} className="min-w-40">
                      <div className="flex items-center gap-1">
                        <span className="font-mono">#{sample.id}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() =>
                            removeFromComparison({
                              type: "sample",
                              id: sample.id,
                              label: `样本 ${sample.id}`,
                            })
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* 传感器板布局行 */}
                {(() => {
                  const hasConfigs = selectedSamples.some(s => s.heaterConfigs?.length > 0);
                  if (!hasConfigs) return null;
                  const allSame = selectedSamples.every(s =>
                    heaterConfigsEqual(s.heaterConfigs || [], selectedSamples[0].heaterConfigs || [])
                  );
                  return (
                    <TableRow className={cn(!allSame && "bg-orange-50 dark:bg-orange-950/20")}>
                      <TableCell className="font-medium whitespace-nowrap sticky left-0 bg-background z-10 align-top">
                        传感器布局
                        {!allSame && <span className="ml-1 text-orange-500">●</span>}
                      </TableCell>
                      {selectedSamples.map((sample) => (
                        <TableCell key={sample.id} className="min-w-40 align-top">
                          {sample.heaterConfigs?.length > 0 ? (
                            <SensorBoardLayout heaterConfigs={sample.heaterConfigs} compact />
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })()}
                {paramRows.map((row) => (
                  <TableRow
                    key={row.key}
                    className={cn(row.isDifferent && "bg-orange-50 dark:bg-orange-950/20")}
                  >
                    <TableCell className="font-medium whitespace-nowrap sticky left-0 bg-background z-10">
                      {row.label}
                      {row.isDifferent && (
                        <span className="ml-1 text-orange-500">●</span>
                      )}
                    </TableCell>
                    {row.values.map((value, idx) => (
                      <TableCell
                        key={idx}
                        className={cn(
                          "min-w-40 max-w-48",
                          row.key === "paramsHash" && "group/hash",
                          row.isDifferent && "font-medium text-orange-700 dark:text-orange-300"
                        )}
                      >
                        {row.key === "paramsHash" ? (
                          <HashCell value={value} />
                        ) : (
                          <CellValue value={value} />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 差异摘要 */}
      {paramRows.filter((r) => r.isDifferent).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">差异摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {paramRows
                .filter((r) => r.isDifferent)
                .map((row) => (
                  <Badge key={row.key} variant="outline" className="text-orange-600 border-orange-300">
                    {row.label}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
