"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  RefreshCw,
  Loader2,
  Sparkles,
  BarChart3,
  Info,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LabelConfig {
  id: number;
  name: string;
  labelType: string;
  strategy: string;
  configJson: string;
  description: string;
  isActive: boolean;
  labelCount: number;
}

interface LabelBucket {
  label: string;
  count: number;
  labelIndex: number;
}

const LABEL_TYPE_COLORS: Record<string, string> = {
  classification: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  regression: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  contrastive: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const LABEL_TYPE_LABELS: Record<string, string> = {
  classification: "分类",
  regression: "回归",
  contrastive: "对比学习",
};

export function TrainingTab() {
  const { selectedSampleIds, samples } = useExperiments();

  const [configs, setConfigs] = useState<LabelConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string>("");
  const [distribution, setDistribution] = useState<LabelBucket[]>([]);
  const [distributionTotal, setDistributionTotal] = useState(0);
  // 获取选中样本的 runIds 和 sampleIds
  const selectedRunIds = Array.from(
    new Set(
      samples
        .filter((s) => selectedSampleIds.has(s.id))
        .map((s) => s.runId)
    )
  );
  const selectedSampleIdsList = Array.from(selectedSampleIds);

  // 加载策略列表
  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ml-labels?action=configs");
      if (response.ok) {
        const data = await response.json();
        setConfigs(data.configs || []);
        if (data.configs?.length > 0 && !selectedConfig) {
          setSelectedConfig(data.configs[0].name);
        }
      }
    } catch (error) {
      console.error("Failed to fetch ML label configs:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedConfig]);

  // 加载标签分布
  const fetchDistribution = useCallback(async () => {
    if (!selectedConfig) return;
    try {
      const params = new URLSearchParams({ action: "distribution", configName: selectedConfig });
      if (selectedSampleIdsList.length > 0) {
        params.set("sampleIds", selectedSampleIdsList.join(","));
      }
      const response = await fetch(`/api/ml-labels?${params}`);
      if (response.ok) {
        const data = await response.json();
        setDistribution(data.buckets || []);
        setDistributionTotal(data.totalSamples || 0);
      }
    } catch (error) {
      console.error("Failed to fetch distribution:", error);
    }
  }, [selectedConfig, selectedSampleIdsList.join(",")]);

  // 生成标签
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateResult("");
    try {
      const body: Record<string, unknown> = {};
      if (selectedConfig) body.configName = selectedConfig;
      if (selectedSampleIdsList.length > 0) body.sampleIds = selectedSampleIdsList;
      else if (selectedRunIds.length > 0) body.runIds = selectedRunIds;

      const response = await fetch("/api/ml-labels?action=generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = await response.json();
        setGenerateResult(data.message || "标签生成完成");
        // 刷新分布
        fetchDistribution();
        fetchConfigs();
      }
    } catch (error) {
      console.error("Failed to generate labels:", error);
      setGenerateResult("标签生成失败");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  useEffect(() => {
    if (selectedConfig) {
      fetchDistribution();
    }
  }, [selectedConfig, fetchDistribution]);

  const currentConfig = configs.find((c) => c.name === selectedConfig);
  const maxDistCount = Math.max(...distribution.map((b) => b.count), 1);

  // 动态计算下方区域可用高度
  const outerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [availableH, setAvailableH] = useState(300);
  useEffect(() => {
    const outer = outerRef.current;
    const top = topRef.current;
    if (!outer || !top) return;
    const update = () => {
      const outerH = outer.clientHeight;
      const topH = top.clientHeight;
      // gap-4 = 16px
      setAvailableH(Math.max(outerH - topH - 16, 100));
    };
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    ro.observe(top);
    return () => ro.disconnect();
  }, []);
  // Card header + padding 大约 80px
  const tableMaxH = Math.max(availableH - 80, 100);

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col p-4 gap-4">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5" />
              训练数据集
            </h2>
            <p className="text-sm text-muted-foreground">
              从样本参数自动派生 ML 标签，构建训练数据集
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchConfigs} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div ref={outerRef} className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* 顶部：策略选择 + 策略说明 并排 */}
            <div ref={topRef} className="grid grid-cols-2 gap-4 shrink-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  标签策略
                </CardTitle>
                <CardDescription>
                  选择标签派生策略，从已有样本参数自动生成 ML 标签
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Select value={selectedConfig} onValueChange={setSelectedConfig}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择标签策略..." />
                      </SelectTrigger>
                      <SelectContent>
                        {configs.map((c) => (
                          <SelectItem key={c.name} value={c.name}>
                            <div className="flex items-center gap-2">
                              <span>{c.name}</span>
                              <Badge
                                variant="secondary"
                                className={`text-[10px] px-1.5 py-0 ${LABEL_TYPE_COLORS[c.labelType] || ""}`}
                              >
                                {LABEL_TYPE_LABELS[c.labelType] || c.labelType}
                              </Badge>
                              {c.labelCount > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  ({c.labelCount})
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleGenerate} disabled={generating || !selectedConfig}>
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    生成标签
                  </Button>
                </div>

                {currentConfig && (
                  <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                    <p className="text-sm">{currentConfig.description}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>类型: {LABEL_TYPE_LABELS[currentConfig.labelType] || currentConfig.labelType}</span>
                      <span>·</span>
                      <span>策略: {currentConfig.strategy}</span>
                      <span>·</span>
                      <span>已生成: {currentConfig.labelCount} 个标签</span>
                    </div>
                  </div>
                )}

                {generateResult && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {generateResult}
                  </div>
                )}

                {selectedRunIds.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    范围: 选中的 {selectedRunIds.length} 个 Run (#{selectedRunIds.join(", #")})
                  </div>
                )}

                {/* 无标签提示 */}
                {selectedSampleIds.size > 0 && preview && preview.totalSamples === 0 && !generating && !generateResult && (
                  <Alert variant="default" className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
                      当前选中的 {selectedSampleIds.size} 个样本尚未生成 ML 标签。请先点击上方「生成标签」按钮，标签生成后才能进行数据集分割和导出。
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  标签策略说明
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={LABEL_TYPE_COLORS.classification}>分类</Badge>
                      <span className="text-sm font-medium">liquid_identity / primary_liquid / mixture_formula</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      将液体类型或配方作为离散标签。适用于"这是什么液体"的识别任务。
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={LABEL_TYPE_COLORS.regression}>回归</Badge>
                      <span className="text-sm font-medium">concentration / total_volume / gas_pump_speed</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      将连续数值（浓度比例、进样量等）作为回归目标。适用于浓度预测等任务。
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={LABEL_TYPE_COLORS.contrastive}>对比学习</Badge>
                      <span className="text-sm font-medium">params_group</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      利用 params_hash 分组构建正负样本对。相同实验条件=正对，不同条件=负对。无需显式标签。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            </div>

            {/* 下部：标签分布 + 数据集分割 并排 */}
            <div className="grid grid-cols-2 gap-4" style={{ height: availableH }}>
            {/* 标签分布 */}
              <Card className="overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    标签分布
                    {distribution.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {distributionTotal} 样本
                    </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {distribution.length > 0 ? (
                  <div className="overflow-y-auto" style={{ maxHeight: tableMaxH }}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>标签</TableHead>
                          <TableHead className="w-24 text-right">数量</TableHead>
                          <TableHead className="w-48">占比</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {distribution.map((bucket, idx) => {
                          const pct = distributionTotal > 0
                            ? (bucket.count / distributionTotal * 100)
                            : 0;
                          return (
                            <TableRow key={bucket.label}>
                              <TableCell className="text-muted-foreground text-xs">
                                {idx}
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {bucket.label}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {bucket.count}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Progress
                                    value={(bucket.count / maxDistCount) * 100}
                                    className="h-2 flex-1"
                                  />
                                  <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">
                                    {pct.toFixed(1)}%
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  ) : (
                    <div className="flex items-center justify-center text-sm text-muted-foreground">
                      暂无标签分布数据
                    </div>
                  )}
                </CardContent>
              </Card>

            <Card className="overflow-hidden" style={{ maxHeight: availableH }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <SplitSquareVertical className="h-4 w-4" />
                  数据集分割
                </CardTitle>
                <CardDescription>
                  设置 Train / Val / Test 分割比例
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">训练集</span>
                    <span className="text-sm tabular-nums font-medium text-blue-600">
                      {trainRatio}%
                    </span>
                  </div>
                  <Slider
                    value={[trainRatio]}
                    onValueChange={([v]) => {
                      const maxTrain = 100 - valRatio - 5;
                      setTrainRatio(Math.min(v, maxTrain));
                    }}
                    min={10}
                    max={90}
                    step={5}
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">验证集</span>
                    <span className="text-sm tabular-nums font-medium text-amber-600">
                      {valRatio}%
                    </span>
                  </div>
                  <Slider
                    value={[valRatio]}
                    onValueChange={([v]) => {
                      const maxVal = 100 - trainRatio - 5;
                      setValRatio(Math.min(v, maxVal));
                    }}
                    min={5}
                    max={40}
                    step={5}
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">测试集</span>
                    <span className="text-sm tabular-nums font-medium text-emerald-600">
                      {testRatio}%
                    </span>
                  </div>
                </div>

                {/* 可视化分割条 */}
                <div className="flex h-3 rounded-full overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="bg-blue-500 transition-all"
                        style={{ width: `${trainRatio}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>训练集: {trainRatio}% ({preview?.trainCount || 0} 样本)</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="bg-amber-500 transition-all"
                        style={{ width: `${valRatio}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>验证集: {valRatio}% ({preview?.valCount || 0} 样本)</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="bg-emerald-500 transition-all"
                        style={{ width: `${testRatio}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>测试集: {testRatio}% ({preview?.testCount || 0} 样本)</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <Separator />

                {/* 预览统计 */}
                {preview && (
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <div className="text-lg font-bold tabular-nums">{preview.totalSamples}</div>
                      <div className="text-xs text-muted-foreground">总样本</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-2">
                      <div className="text-lg font-bold tabular-nums text-blue-600">{preview.trainCount}</div>
                      <div className="text-xs text-muted-foreground">训练</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2">
                      <div className="text-lg font-bold tabular-nums text-amber-600">{preview.valCount}</div>
                      <div className="text-xs text-muted-foreground">验证</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-2">
                      <div className="text-lg font-bold tabular-nums text-emerald-600">{preview.testCount}</div>
                      <div className="text-xs text-muted-foreground">测试</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
