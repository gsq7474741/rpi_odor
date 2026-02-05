"use client";

import { useCallback, useState } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Download,
  X,
  Loader2,
  Settings,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export function SelectionBar() {
  const {
    samples,
    selectedSampleIds,
    clearSampleSelection,
    setSamples,
  } = useExperiments();

  const [generating, setGenerating] = useState(false);
  const [nSamples, setNSamples] = useState(100);
  const [showSettings, setShowSettings] = useState(false);

  // 计算选中样本来自多少个 Run
  const selectedSamples = samples.filter((s) => selectedSampleIds.has(s.id));
  const runIds = new Set(selectedSamples.map((s) => s.runId));
  const samplesWithoutFrames = selectedSamples.filter(
    (s) => !s.frameStatus?.hasFrames
  );
  const samplesWithFrames = selectedSamples.length - samplesWithoutFrames.length;

  // 批量生成数据帧
  const handleGenerateFrames = useCallback(async () => {
    if (samplesWithoutFrames.length === 0) {
      toast.info("所有选中的样本已有数据帧");
      return;
    }

    setGenerating(true);
    const toastId = toast.loading(
      `正在计算 ${samplesWithoutFrames.length} 个样本的数据帧...`
    );

    try {
      // 批量生成
      const sampleIds = samplesWithoutFrames.map(s => s.id);
      const response = await fetch("/api/analytics/sample-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleIds,
          nSamples,
          methods: ["linear", "pchip"],
          useCache: true,
          action: "generateBatch",
        }),
      });
      const result = await response.json();
      const successCount = result.successCount || 0;
      const failCount = result.failedCount || 0;

      // 刷新样本列表中的帧状态（使用批量查询）
      const selectedIds = Array.from(selectedSampleIds);
      if (selectedIds.length > 0) {
        try {
          const response = await fetch(
            `/api/analytics/sample-frames?sampleIds=${selectedIds.join(",")}`
          );
          const data = await response.json();
          
          if (data.statuses) {
            const updatedSamples = samples.map(sample => {
              if (selectedSampleIds.has(sample.id) && data.statuses[sample.id]) {
                return {
                  ...sample,
                  frameStatus: {
                    hasFrames: data.statuses[sample.id].exists || false,
                    cached: data.statuses[sample.id].cached || false,
                    variants: data.statuses[sample.id].variants || [],
                  },
                };
              }
              return sample;
            });
            setSamples(updatedSamples);
          }
        } catch {
          // ignore
        }
      }

      // 显示结果
      if (failCount === 0) {
        toast.success(
          `计算完成：${successCount} 个样本，每样本 ${nSamples} 个归一化采样点`,
          { id: toastId }
        );
      } else {
        toast.warning(
          `计算完成：成功 ${successCount}，失败 ${failCount}`,
          { id: toastId }
        );
      }
    } catch (error) {
      console.error("Failed to generate frames:", error);
      toast.error("计算数据帧失败", { id: toastId });
    } finally {
      setGenerating(false);
    }
  }, [samplesWithoutFrames, samples, selectedSampleIds, setSamples, nSamples]);

  // 导出数据（TODO）
  const handleExport = useCallback(() => {
    // TODO: 实现导出功能
    toast.info("导出功能开发中...");
    console.log("Export samples:", Array.from(selectedSampleIds));
  }, [selectedSampleIds]);

  const hasSelection = selectedSampleIds.size > 0;

  return (
    <div className="flex items-center gap-3 px-4 h-10 border-b bg-background">
      {/* 选择计数 */}
      <div className="flex items-center gap-2 min-w-0">
        {hasSelection ? (
          <>
            <span className="text-sm font-medium tabular-nums">
              {selectedSampleIds.size}
            </span>
            <span className="text-sm text-muted-foreground truncate">
              样本已选
              {runIds.size > 0 && (
                <span className="text-xs ml-1">
                  ({runIds.size} Run)
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">未选择</span>
        )}
      </div>

      {/* 分隔线 */}
      {hasSelection && <div className="h-4 w-px bg-border" />}

      {/* 操作按钮组 */}
      {hasSelection && (
        <div className="flex items-center gap-1">
          {/* 计算帧按钮 */}
          <Popover open={showSettings} onOpenChange={setShowSettings}>
            <PopoverTrigger asChild>
              <Button
                variant={samplesWithoutFrames.length > 0 ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs gap-1.5"
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : samplesWithFrames === selectedSamples.length ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {samplesWithoutFrames.length > 0 ? (
                  <span>计算 {samplesWithoutFrames.length} 帧</span>
                ) : (
                  <span>已完成</span>
                )}
                <Settings className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-sm mb-1">帧计算设置</h4>
                  <p className="text-xs text-muted-foreground">
                    将原始传感器数据归一化为固定长度的特征向量
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nSamples" className="text-xs">
                    采样点数
                  </Label>
                  <Input
                    id="nSamples"
                    type="number"
                    value={nSamples}
                    onChange={(e) =>
                      setNSamples(
                        Math.max(10, Math.min(1000, parseInt(e.target.value) || 100))
                      )
                    }
                    min={10}
                    max={1000}
                    step={10}
                    className="h-8"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    范围 10-1000，默认 100
                  </p>
                </div>
                <Button 
                  className="w-full h-8" 
                  size="sm"
                  onClick={() => {
                    setShowSettings(false);
                    handleGenerateFrames();
                  }}
                  disabled={generating || samplesWithoutFrames.length === 0}
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      计算中...
                    </>
                  ) : samplesWithoutFrames.length > 0 ? (
                    <>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      计算 {samplesWithoutFrames.length} 个样本
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      全部已完成
                    </>
                  )}
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* 导出 */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </Button>

          {/* 清除 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={clearSampleSelection}
            title="清除选择"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
