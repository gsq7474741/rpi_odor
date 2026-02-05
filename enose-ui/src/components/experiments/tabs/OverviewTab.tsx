"use client";

import { useExperiments, SampleWithFrameStatus } from "../context/ExperimentsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FlaskConical,
  Clock,
  Droplets,
  Wind,
  Layers,
  Hash,
  Download,
  Tag,
  Cpu,
  RefreshCw,
} from "lucide-react";

export function OverviewTab() {
  const {
    samples,
    selectedSampleIds,
    comparisonItems,
    comparisonMode,
  } = useExperiments();

  // 获取选中的样本（从新的 samples 数组）
  const selectedSamples: SampleWithFrameStatus[] = samples.filter(
    (s) => selectedSampleIds.has(s.id)
  );

  // 统计选中样本来自哪些 Run
  const runIds = new Set(selectedSamples.map((s) => s.runId));

  // 没有选中任何项目时的提示
  if (selectedSampleIds.size === 0 && !comparisonMode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <FlaskConical className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">选择样本</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          在左侧列表中勾选样本。
          {comparisonMode
            ? "勾选多个项目可进行对比分析。"
            : "选中后可查看详细信息和进行数据分析。"}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* 选择摘要 */}
        {selectedSamples.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>已选 {selectedSamples.length} 个样本</span>
            {runIds.size > 0 && (
              <span>（来自 {runIds.size} 个 Run）</span>
            )}
          </div>
        )}

        {/* 选中的样本 */}
        {selectedSamples.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                选中的样本 ({selectedSamples.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {selectedSamples.map((sample) => (
                  <div
                    key={sample.id}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          Run #{sample.runId} - Sample #{sample.sampleIdx}
                        </Badge>
                        <Badge variant="outline">{sample.phaseName}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        ID: {sample.id}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Droplets className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">液体</p>
                          <p className="font-medium">
                            {sample.liquidNames?.join(", ") || "-"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">体积</p>
                          <p className="font-medium">
                            {sample.totalVolumeMl?.toFixed(2) || "-"} ml
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Wind className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">气泵 PWM</p>
                          <p className="font-medium">{sample.gasPumpPwm}%</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">时长</p>
                          <p className="font-medium">
                            {sample.durationS ? `${sample.durationS}s` : "-"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <Hash className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">参数哈希:</span>
                      <code className="bg-muted px-1 rounded">
                        {sample.paramsHash?.slice(0, 16)}...
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 对比模式下的对比项 */}
        {comparisonMode && comparisonItems.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" />
                对比项 ({comparisonItems.length})
              </CardTitle>
              <CardDescription>
                切换到"参数对比"标签页查看详细对比
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {comparisonItems.map((item, idx) => (
                  <Badge key={idx} variant="secondary">
                    {item.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 快速操作 */}
        {selectedSamples.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">快速操作</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm">
                  <Cpu className="h-4 w-4 mr-2" />
                  生成归一化帧
                </Button>
                <Button variant="outline" size="sm">
                  <Tag className="h-4 w-4 mr-2" />
                  批量打标签
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  导出数据
                </Button>
                <Button variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  刷新帧缓存
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
