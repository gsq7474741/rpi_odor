"use client";

import { useMemo } from "react";
import { useExperiments, SampleWithFrameStatus } from "../context/ExperimentsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GitCompare,
  X,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ParamRow {
  key: string;
  label: string;
  values: (string | number | null)[];
  isDifferent: boolean;
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
        key: "liquidNames",
        label: "液体",
        values: selectedSamples.map((s) => s.liquidNames?.join(", ") || "-"),
        isDifferent: false,
      },
      {
        key: "totalVolumeMl",
        label: "体积 (ml)",
        values: selectedSamples.map((s) => s.totalVolumeMl?.toFixed(2) || "-"),
        isDifferent: false,
      },
      {
        key: "gasPumpPwm",
        label: "气泵 PWM",
        values: selectedSamples.map((s) => `${s.gasPumpPwm}%`),
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
        values: selectedSamples.map((s) => s.durationS?.toString() || "-"),
        isDifferent: false,
      },
      {
        key: "paramsHash",
        label: "参数哈希",
        values: selectedSamples.map((s) => s.paramsHash?.slice(0, 12) + "..." || "-"),
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

  // 没有启用对比模式
  if (!comparisonMode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <GitCompare className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">启用对比模式</h3>
        <p className="text-muted-foreground text-sm max-w-md mb-4">
          点击顶部工具栏的"对比模式"按钮，然后在左侧列表中选择多个样本进行参数对比。
        </p>
        <Button onClick={toggleComparisonMode}>
          <GitCompare className="h-4 w-4 mr-2" />
          启用对比模式
        </Button>
      </div>
    );
  }

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">参数</TableHead>
                  {selectedSamples.map((sample) => (
                    <TableHead key={sample.id} className="min-w-32">
                      <div className="flex items-center gap-1">
                        <span>样本 #{sample.id}</span>
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
                {paramRows.map((row) => (
                  <TableRow
                    key={row.key}
                    className={cn(row.isDifferent && "bg-orange-50 dark:bg-orange-950/20")}
                  >
                    <TableCell className="font-medium">
                      {row.label}
                      {row.isDifferent && (
                        <span className="ml-1 text-orange-500">●</span>
                      )}
                    </TableCell>
                    {row.values.map((value, idx) => (
                      <TableCell
                        key={idx}
                        className={cn(
                          row.isDifferent && "font-medium text-orange-700 dark:text-orange-300"
                        )}
                      >
                        {value}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
