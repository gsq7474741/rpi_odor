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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Download,
  X,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Layers,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

type InterpolationMethod = "linear" | "pchip";

const ALL_METHODS: InterpolationMethod[] = ["linear", "pchip"];
const ALL_NSAMPLES = [50, 100, 200, 500];

export function SelectionBar() {
  const {
    samples,
    selectedSampleIds,
    clearSampleSelection,
    frameConfig,
    setFrameConfig,
    refreshFrameStatuses,
  } = useExperiments();

  const [generating, setGenerating] = useState(false);
  const [nSamples, setNSamples] = useState(100);
  const [methods, setMethods] = useState<InterpolationMethod[]>(["linear", "pchip"]);
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // 计算选中样本来自多少个 Run
  const selectedSamples = samples.filter((s) => selectedSampleIds.has(s.id));
  const runIds = new Set(selectedSamples.map((s) => s.runId));
  const samplesWithoutFrames = selectedSamples.filter(
    (s) => !s.frameStatus?.hasFrames
  );
  const samplesWithFrames = selectedSamples.length - samplesWithoutFrames.length;

  // 收集所有实际存在的 nSamples 值，合并预设值，去重排序
  const matrixNSamples = (() => {
    const nSet = new Set(ALL_NSAMPLES);
    for (const s of selectedSamples) {
      if (s.frameStatus?.variants) {
        for (const v of s.frameStatus.variants) {
          nSet.add(v.nSamples);
        }
      }
    }
    // 也包含当前使用中的 frameConfig.nSamples
    nSet.add(frameConfig.nSamples);
    return Array.from(nSet).sort((a, b) => a - b);
  })();

  // 构建二维矩阵：(method, nSamples) → 拥有该组合帧的样本数
  const variantMatrix = (() => {
    const matrix: Record<string, Record<number, number>> = {};
    for (const m of ALL_METHODS) {
      matrix[m] = {};
      for (const n of matrixNSamples) {
        matrix[m][n] = 0;
      }
    }
    for (const s of selectedSamples) {
      if (s.frameStatus?.variants) {
        for (const v of s.frameStatus.variants) {
          if (matrix[v.method] && matrix[v.method][v.nSamples] !== undefined) {
            matrix[v.method][v.nSamples]++;
          }
        }
      }
    }
    return matrix;
  })();

  // 当前 frameConfig 组合的覆盖情况
  const activeVariantCount = variantMatrix[frameConfig.method]?.[frameConfig.nSamples] ?? 0;
  const activeVariantMissing = selectedSamples.length - activeVariantCount;

  // 切换插值方法
  const toggleMethod = (method: InterpolationMethod) => {
    setMethods((prev) => {
      if (prev.includes(method)) {
        if (prev.length === 1) return prev; // 至少保留一个
        return prev.filter((m) => m !== method);
      }
      return [...prev, method];
    });
  };

  // refreshFrameStatuses 已提升到 Context 中

  // 批量生成数据帧（支持 forceRecalculate，分块发送以获取实时进度）
  const CHUNK_SIZE = 5;
  const handleGenerateFrames = useCallback(
    async (forceRecalculate: boolean = false) => {
      const targetSamples = forceRecalculate
        ? selectedSamples
        : samplesWithoutFrames;

      if (targetSamples.length === 0) {
        toast.info("没有需要计算的样本");
        return;
      }

      setGenerating(true);
      setProgress({ current: 0, total: targetSamples.length });

      const actionLabel = forceRecalculate ? "重新计算" : "计算";
      const toastId = toast.loading(
        `正在${actionLabel} ${targetSamples.length} 个样本的数据帧...`
      );

      let totalSuccess = 0;
      let totalFail = 0;
      let totalFromCache = 0;

      try {
        const allIds = targetSamples.map((s) => s.id);

        // 分块发送请求，每完成一块更新进度
        for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
          const chunkIds = allIds.slice(i, i + CHUNK_SIZE);

          const response = await fetch("/api/analytics/sample-frames", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sampleIds: chunkIds,
              nSamples,
              methods,
              useCache: !forceRecalculate,
              action: "generateBatch",
            }),
          });
          const result = await response.json();
          totalSuccess += result.successCount || 0;
          totalFail += result.failedCount || 0;
          totalFromCache += result.fromCacheCount || 0;

          // 更新进度
          const completed = Math.min(i + CHUNK_SIZE, allIds.length);
          setProgress({ current: completed, total: allIds.length });
          toast.loading(
            `正在${actionLabel}... ${completed}/${allIds.length}`,
            { id: toastId }
          );
        }

        // 刷新帧状态
        await refreshFrameStatuses();

        // 显示结果
        const parts: string[] = [];
        if (totalSuccess > 0) parts.push(`成功 ${totalSuccess}`);
        if (totalFromCache > 0) parts.push(`缓存 ${totalFromCache}`);
        if (totalFail > 0) parts.push(`失败 ${totalFail}`);

        const detail = `${nSamples}点 × ${methods.join("+")} × 32ch`;

        if (totalFail === 0) {
          toast.success(`${actionLabel}完成：${parts.join("，")}（${detail}）`, {
            id: toastId,
          });
        } else {
          toast.warning(`${actionLabel}完成：${parts.join("，")}`, {
            id: toastId,
          });
        }
      } catch (error) {
        console.error("Failed to generate frames:", error);
        toast.error(`${actionLabel}数据帧失败`, { id: toastId });
      } finally {
        setGenerating(false);
        setTimeout(() => setProgress(null), 1500);
      }
    },
    [selectedSamples, samplesWithoutFrames, nSamples, methods, refreshFrameStatuses]
  );

  // 导出数据（TODO）
  const handleExport = useCallback(() => {
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
          {/* 计算帧按钮 + 设置面板 */}
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
                {generating ? (
                  <span>
                    计算中
                    {progress ? ` ${progress.current}/${progress.total}` : "..."}
                  </span>
                ) : samplesWithoutFrames.length > 0 ? (
                  <span>计算 {samplesWithoutFrames.length} 帧</span>
                ) : (
                  <span>数据帧</span>
                )}
                <Layers className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto min-w-[340px] max-w-[480px]" align="start">
              <div className="space-y-3">
                {/* 标题 */}
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">数据帧管理</h4>
                  <Badge variant="outline" className="text-[10px] h-5">
                    {selectedSamples.length} 样本已选
                  </Badge>
                </div>

                {/* 帧覆盖矩阵：(method × nSamples) */}
                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <h5 className="text-xs font-medium">帧覆盖矩阵</h5>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[200px]">
                          <p className="text-xs">
                            每格显示拥有该 (方法, 点数) 组合帧的样本数。
                            点击格子切换当前使用配置。
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="border rounded-md overflow-hidden">
                    {/* 表头 */}
                    <div className="grid text-[10px] text-muted-foreground bg-muted/30" style={{ gridTemplateColumns: `64px repeat(${matrixNSamples.length}, 1fr)` }}>
                      <div className="px-2 py-1 font-medium border-r">方法＼点数</div>
                      {matrixNSamples.map((n) => (
                        <div key={n} className="px-1 py-1 text-center font-medium">
                          {n}
                        </div>
                      ))}
                    </div>
                    {/* 数据行 */}
                    {ALL_METHODS.map((m) => (
                      <div key={m} className="grid border-t" style={{ gridTemplateColumns: `64px repeat(${matrixNSamples.length}, 1fr)` }}>
                        <div className="px-2 py-1 text-xs font-medium border-r bg-muted/20 flex items-center">
                          {m}
                        </div>
                        {matrixNSamples.map((n) => {
                          const count = variantMatrix[m][n];
                          const total = selectedSamples.length;
                          const isActive = frameConfig.method === m && frameConfig.nSamples === n;
                          const isFull = count === total && total > 0;
                          const isPartial = count > 0 && count < total;
                          const isEmpty = count === 0;

                          return (
                            <button
                              key={n}
                              className={`px-1.5 py-1 text-center text-xs transition-colors cursor-pointer hover:bg-accent ${
                                isActive
                                  ? "ring-2 ring-inset ring-primary bg-primary/5 font-semibold"
                                  : ""
                              } ${
                                isFull
                                  ? "text-green-700"
                                  : isPartial
                                  ? "text-orange-600"
                                  : isEmpty
                                  ? "text-muted-foreground/50"
                                  : ""
                              }`}
                              onClick={() => setFrameConfig({ method: m, nSamples: n })}
                              title={`${m} × ${n}点: ${count}/${total} 样本`}
                            >
                              {count > 0 ? (
                                <span>{count}<span className="text-[9px] text-muted-foreground">/{total}</span></span>
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {/* 当前配置状态提示 */}
                  <div className={`mt-1.5 text-[11px] flex items-center gap-1 ${
                    activeVariantMissing > 0 ? "text-orange-600" : "text-green-700"
                  }`}>
                    <span className="font-medium">使用中:</span>
                    <Badge variant={activeVariantMissing > 0 ? "destructive" : "secondary"} className="text-[10px] h-4 px-1">
                      {frameConfig.method} × {frameConfig.nSamples}点
                    </Badge>
                    {activeVariantMissing > 0 ? (
                      <span>— {activeVariantMissing} 样本缺失此变体</span>
                    ) : activeVariantCount > 0 ? (
                      <span>— 全部覆盖</span>
                    ) : null}
                  </div>
                </div>

                <Separator />

                {/* 批量计算参数 */}
                <div className="space-y-2.5">
                  <h5 className="text-xs font-medium">批量计算</h5>

                  {/* 采样点数 */}
                  <div className="space-y-1">
                    <Label htmlFor="nSamples" className="text-[11px] text-muted-foreground">
                      采样点数
                    </Label>
                    <div className="flex items-center gap-2">
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
                        className="h-7 text-xs w-20"
                      />
                      <div className="flex gap-1">
                        {ALL_NSAMPLES.map((v) => (
                          <Button
                            key={v}
                            variant={nSamples === v ? "default" : "outline"}
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setNSamples(v)}
                          >
                            {v}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 插值方法 */}
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">插值方法</Label>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={methods.includes("linear")}
                          onCheckedChange={() => toggleMethod("linear")}
                        />
                        <span className="text-xs">Linear</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={methods.includes("pchip")}
                          onCheckedChange={() => toggleMethod("pchip")}
                        />
                        <span className="text-xs">PCHIP</span>
                      </label>
                    </div>
                  </div>

                  {/* 输出维度提示 */}
                  <div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    输出: {nSamples}帧 × 32通道 (8传感器 × 4ch) = {nSamples * 32} 维特征
                  </div>
                </div>

                <Separator />

                {/* 进度条 */}
                {progress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>计算进度</span>
                      <span>{progress.current} / {progress.total}</span>
                    </div>
                    <Progress value={(progress.current / progress.total) * 100} className="h-1.5" />
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-8"
                    size="sm"
                    onClick={() => {
                      setShowSettings(false);
                      handleGenerateFrames(false);
                    }}
                    disabled={generating || samplesWithoutFrames.length === 0}
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {samplesWithoutFrames.length > 0
                      ? `计算 ${samplesWithoutFrames.length} 缺失`
                      : "全部已有帧"}
                  </Button>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2.5"
                          onClick={() => {
                            setShowSettings(false);
                            handleGenerateFrames(true);
                          }}
                          disabled={generating}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">
                          强制重算全部 {selectedSamples.length} 个样本（忽略缓存）
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
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
