"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dumbbell,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  Eye,
  Tag,
} from "lucide-react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart as ELineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([ELineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

// ── 类型定义 ──

interface TrainingJob {
  id: string;
  modelName: string;
  modelType: string;
  taskType: string;
  status: string;
  currentEpoch: number;
  totalEpochs: number;
  trainLoss: number;
  valLoss: number;
  trainAccuracy: number;
  valAccuracy: number;
  testAccuracy: number;
  hyperparams: Record<string, unknown>;
  datasetConfig: Record<string, unknown>;
  errorMessage: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  modelId: string;
  extraMetrics: Record<string, unknown>;
}

interface TrainingEvaluation {
  id: string;
  split: string;
  accuracy: number;
  loss: number;
  f1Macro: number;
  f1Weighted: number;
  precisionMacro: number;
  recallMacro: number;
  r2Score: number;
  mse: number;
  mae: number;
  confusionMatrix: number[][] | null;
  classificationReport: Record<string, unknown> | null;
}

interface ModelInfo {
  id: string;
  name: string;
  modelType: string;
  taskType: string;
  framework: string;
  testAccuracy: number;
  trainAccuracy: number;
  valAccuracy: number;
  extraMetrics: Record<string, unknown> | null;
  createdAt: string;
  fileSize: number;
  trainingJobId: string;
}

interface ProgressPoint {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  trainAccuracy: number;
  valAccuracy: number;
}

// ── 模型配置 ──

const MODEL_OPTIONS = [
  { value: "mlp", label: "MLP", framework: "PyTorch" },
  { value: "svm", label: "SVM", framework: "sklearn" },
  { value: "xgboost", label: "XGBoost", framework: "XGBoost" },
  { value: "cnn1d", label: "CNN-1D", framework: "PyTorch" },
  { value: "tcn", label: "TCN", framework: "PyTorch" },
  { value: "transformer", label: "Transformer", framework: "PyTorch" },
];

const TASK_OPTIONS = [
  { value: "classification", label: "分类" },
  { value: "regression", label: "回归" },
];

const MODEL_TASK_SUPPORT: Record<string, string[]> = {
  mlp: ["classification", "regression"],
  cnn1d: ["classification", "regression"],
  tcn: ["classification", "regression"],
  transformer: ["classification", "regression"],
  svm: ["classification", "regression"],
  xgboost: ["classification", "regression"],
  kmeans: ["clustering"],
};

// ── 默认超参数 ──

const DEFAULT_HYPERPARAMS: Record<string, Record<string, unknown>> = {
  mlp: { hidden_layers: [128, 64], activation: "relu", dropout: 0.3, epochs: 100, learning_rate: 0.001, batch_size: 32, early_stopping_patience: 10 },
  svm: { C: 1.0, kernel: "rbf", gamma: "scale", degree: 3 },
  xgboost: { n_estimators: 100, max_depth: 6, learning_rate: 0.1, subsample: 0.8, colsample_bytree: 0.8 },
  cnn1d: { n_filters: [32, 64], kernel_sizes: [5, 3], pool_size: 2, fc_dims: [64], dropout: 0.3, epochs: 100, learning_rate: 0.001, batch_size: 32, early_stopping_patience: 10 },
  tcn: { n_channels: [32, 64, 64], kernel_size: 3, dropout: 0.2, epochs: 100, learning_rate: 0.001, batch_size: 32, early_stopping_patience: 10 },
  transformer: { d_model: 64, nhead: 4, n_layers: 2, dim_ff: 128, dropout: 0.1, epochs: 100, learning_rate: 0.001, batch_size: 32, early_stopping_patience: 10 },
};

export function ModelTrainingTab() {
  const { selectedSampleIds, mlLabelConfig, setMlLabelConfig, mlSplitRatios, frameConfig } = useExperiments();

  // mlLabelConfig 是标签策略名 (string)
  // mlSplitRatios 是 { train: number, val: number } (百分比如 70/15)

  // ── 工具函数：生成 yymmddhhmmss 格式时间 ──
  const formatModelTime = useCallback(() => {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yy}${mm}${dd}${hh}${mi}${ss}`;
  }, []);

  // ── 训练配置状态 ──
  const [modelName, setModelName] = useState("");
  const [modelType, setModelType] = useState("mlp");
  const [taskType, setTaskType] = useState("classification");
  const [hyperparams, setHyperparams] = useState<Record<string, unknown>>(DEFAULT_HYPERPARAMS.mlp);

  // ── 训练任务状态 ──
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<TrainingJob | null>(null);
  const [progressHistory, setProgressHistory] = useState<ProgressPoint[]>([]);
  const [evaluations, setEvaluations] = useState<TrainingEvaluation[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  // ── 模型列表 ──
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [modelsOpen, setModelsOpen] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  // ── 标签策略列表 ──
  const [labelConfigs, setLabelConfigs] = useState<{ name: string; labelType: string; description: string }[]>([]);

  // ── 模型类型变更时更新超参数 ──
  useEffect(() => {
    setHyperparams(DEFAULT_HYPERPARAMS[modelType] || {});
    const supported = MODEL_TASK_SUPPORT[modelType] || [];
    if (!supported.includes(taskType)) {
      setTaskType(supported[0] || "classification");
    }
  }, [modelType]);

  // mlLabelConfig 是策略名字符串，任务类型需从 Tab 页面上下文推断
  // 此处不自动推断，由用户手动选择

  // ── 加载模型列表和训练任务 ──
  const refreshData = useCallback(async () => {
    try {
      const [modelsRes, jobsRes] = await Promise.all([
        fetch("/api/analytics/training?action=models").then((r) => r.json()),
        fetch("/api/analytics/training?action=jobs&limit=10").then((r) => r.json()),
      ]);
      if (modelsRes.models) setModels(modelsRes.models);
      if (jobsRes.jobs) setJobs(jobsRes.jobs);
    } catch (err) {
      console.error("Failed to refresh data:", err);
    }
  }, []);

  // ── 加载标签策略 ──
  useEffect(() => {
    fetch("/api/ml-labels?action=configs")
      .then((r) => r.json())
      .then((data) => {
        if (data.configs) setLabelConfigs(data.configs);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // ── SSE 训练进度 ──
  useEffect(() => {
    if (!activeJobId) return;

    const es = new EventSource(`/api/analytics/training/stream?jobId=${activeJobId}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.done || data.error) {
          es.close();
          fetchJobStatus(activeJobId);
          refreshData();
          return;
        }

        const jobStatus = data.extraMetrics?.jobStatus;
        const errorMsg = data.extraMetrics?.errorMessage;

        // 终态：关闭 SSE 并刷新
        if (jobStatus === "COMPLETED" || jobStatus === "FAILED" || jobStatus === "CANCELLED") {
          es.close();
          fetchJobStatus(activeJobId);
          refreshData();
          return;
        }

        // 更新进度（包括 epoch=0 的中间状态如 SVM fitting）
        if (data.epoch > 0) {
          setProgressHistory((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].epoch === data.epoch) return prev;
            return [
              ...prev,
              {
                epoch: data.epoch,
                trainLoss: data.trainLoss,
                valLoss: data.valLoss,
                trainAccuracy: data.trainAccuracy,
                valAccuracy: data.valAccuracy,
              },
            ];
          });
        }
        setActiveJob((prev) =>
          prev
            ? {
                ...prev,
                status: jobStatus || prev.status,
                currentEpoch: data.epoch,
                trainLoss: data.trainLoss || prev.trainLoss,
                valLoss: data.valLoss || prev.valLoss,
                trainAccuracy: data.trainAccuracy || prev.trainAccuracy,
                valAccuracy: data.valAccuracy || prev.valAccuracy,
                errorMessage: errorMsg || prev.errorMessage,
                extraMetrics: data.extraMetrics || prev.extraMetrics,
              }
            : prev
        );
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      fetchJobStatus(activeJobId);
    };

    return () => {
      es.close();
    };
  }, [activeJobId]);

  const fetchJobStatus = async (jobId: string) => {
    try {
      const res = await fetch(`/api/analytics/training?action=job&jobId=${jobId}`);
      const data = await res.json();
      if (data.job) {
        setActiveJob(data.job);
        const status = data.job.status;

        // 已完成的任务加载历史进度曲线
        if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") {
          const [evalRes, progressRes] = await Promise.all([
            status === "COMPLETED"
              ? fetch(`/api/analytics/training?action=evaluation&jobId=${jobId}`).then((r) => r.json())
              : Promise.resolve({ evaluations: [] }),
            fetch(`/api/analytics/training?action=progress&jobId=${jobId}`).then((r) => r.json()),
          ]);
          if (evalRes.evaluations) setEvaluations(evalRes.evaluations);
          if (progressRes.entries) {
            setProgressHistory(
              progressRes.entries
                .filter((e: ProgressPoint) => e.epoch > 0)
                .map((e: ProgressPoint) => ({
                  epoch: e.epoch,
                  trainLoss: e.trainLoss,
                  valLoss: e.valLoss,
                  trainAccuracy: e.trainAccuracy,
                  valAccuracy: e.valAccuracy,
                }))
            );
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch job status:", err);
    }
  };

  // ── 启动训练 ──
  const handleStartTraining = async () => {
    if (!mlLabelConfig || selectedSampleIds.size === 0) return;
    setIsStarting(true);
    setProgressHistory([]);
    setEvaluations([]);

    try {
      const name = modelName || `${modelType}-${formatModelTime()}`;
      const res = await fetch("/api/analytics/training?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          modelType,
          taskType,
          labelConfigName: mlLabelConfig,
          sampleIds: Array.from(selectedSampleIds),
          trainRatio: mlSplitRatios.train / 100,
          valRatio: mlSplitRatios.val / 100,
          frameNSamples: frameConfig.nSamples,
          frameMethod: frameConfig.method,
          seed: 42,
          hyperparams,
        }),
      });
      const data = await res.json();
      if (data.jobId) {
        setActiveJobId(data.jobId);
        setActiveJob({
          id: data.jobId,
          modelName: name,
          modelType,
          taskType,
          status: "PENDING",
          currentEpoch: 0,
          totalEpochs: (hyperparams.epochs as number) || (hyperparams.n_estimators as number) || 1,
          trainLoss: 0,
          valLoss: 0,
          trainAccuracy: 0,
          valAccuracy: 0,
          testAccuracy: 0,
          hyperparams,
          datasetConfig: {},
          errorMessage: "",
          createdAt: new Date().toISOString(),
          startedAt: "",
          completedAt: "",
          modelId: "",
          extraMetrics: {},
        });
      }
    } catch (err) {
      console.error("Failed to start training:", err);
    } finally {
      setIsStarting(false);
    }
  };

  // ── 取消训练 ──
  const handleCancelTraining = async () => {
    if (!activeJobId) return;
    try {
      await fetch("/api/analytics/training?action=cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      eventSourceRef.current?.close();
      fetchJobStatus(activeJobId);
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  };

  // ── 删除模型 ──
  const handleDeleteModel = async (modelId: string) => {
    try {
      await fetch("/api/analytics/training?action=deleteModel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      refreshData();
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  // ── 取消任意 job ──
  const handleCancelJob = async (jobId: string) => {
    try {
      await fetch("/api/analytics/training?action=cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (jobId === activeJobId) {
        eventSourceRef.current?.close();
      }
      refreshData();
      fetchJobStatus(jobId);
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  };

  // ── 删除训练任务 ──
  const handleDeleteJob = async (jobId: string) => {
    try {
      await fetch("/api/analytics/training?action=deleteJob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (jobId === activeJobId) {
        setActiveJobId(null);
        setActiveJob(null);
        setProgressHistory([]);
        setEvaluations([]);
      }
      refreshData();
    } catch (err) {
      console.error("Failed to delete job:", err);
    }
  };

  // ── 以相同配置重新训练 ──
  const handleRetrain = (job: TrainingJob) => {
    setModelType(job.modelType);
    setTaskType(job.taskType);
    if (job.hyperparams && Object.keys(job.hyperparams).length > 0) {
      setHyperparams(job.hyperparams as Record<string, unknown>);
    }
    setModelName("");
  };

  // ── 状态图标 ──
  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case "COMPLETED": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "FAILED": return <XCircle className="h-4 w-4 text-red-500" />;
      case "RUNNING": return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "CANCELLED": return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isRunning = activeJob?.status === "RUNNING" || activeJob?.status === "PENDING";
  const isCompleted = activeJob?.status === "COMPLETED";
  const progressPercent = activeJob ? Math.round((activeJob.currentEpoch / Math.max(activeJob.totalEpochs, 1)) * 100) : 0;
  const selectedCount = selectedSampleIds.size;

  return (
    <div className="flex gap-4 h-full">
      {/* ── 左侧：训练配置 ── */}
      <div className="w-[380px] flex-shrink-0">
        <ScrollArea className="h-full">
          <div className="space-y-4 pr-2">
            {/* 配置卡片 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Dumbbell className="h-4 w-4" />
                  训练配置
                </CardTitle>
                <CardDescription>配置模型架构和超参数</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 模型名称 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">模型名称</Label>
                  <Input
                    placeholder={`${modelType}-${formatModelTime()}`}
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                {/* 标签策略 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">标签策略</Label>
                  <Select value={mlLabelConfig || ""} onValueChange={(v) => setMlLabelConfig(v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="选择标签策略" />
                    </SelectTrigger>
                    <SelectContent>
                      {labelConfigs.map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          <span className="flex items-center gap-1.5">
                            <Tag className="h-3 w-3" />
                            {c.name}
                            <span className="text-[10px] text-muted-foreground">({c.labelType})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mlLabelConfig && (
                    <p className="text-xs text-muted-foreground">
                      启动训练时将自动生成标签
                    </p>
                  )}
                </div>

                {/* 任务类型 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">任务类型</Label>
                  <Select value={taskType} onValueChange={setTaskType}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_OPTIONS.filter((t) =>
                        (MODEL_TASK_SUPPORT[modelType] || []).includes(t.value)
                      ).map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 模型架构 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">模型架构</Label>
                  <Select value={modelType} onValueChange={setModelType}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                          <span className="ml-2 text-xs text-muted-foreground">({m.framework})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* 超参数 */}
                <div className="space-y-3">
                  <Label className="text-xs font-medium">超参数</Label>
                  <HyperparamsForm
                    modelType={modelType}
                    hyperparams={hyperparams}
                    onChange={setHyperparams}
                    disabled={isRunning}
                  />
                </div>

                <Separator />

                {/* 数据配置摘要 */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">数据配置</Label>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>选中样本: <span className="font-medium text-foreground">{selectedCount}</span> 个</p>
                    <p>数据分割: <span className="font-medium text-foreground">{mlSplitRatios.train}/{mlSplitRatios.val}/{100 - mlSplitRatios.train - mlSplitRatios.val}</span></p>
                    <p>帧采样: <span className="font-medium text-foreground">{frameConfig.nSamples}</span> 点, {frameConfig.method}</p>
                  </div>
                </div>

                {/* 训练按钮 */}
                <Button
                  className="w-full"
                  onClick={handleStartTraining}
                  disabled={isStarting || selectedCount === 0 || !mlLabelConfig}
                >
                  {isStarting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />启动中...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" />开始训练</>
                  )}
                </Button>

                {!mlLabelConfig && (
                  <p className="text-xs text-destructive">请选择标签策略</p>
                )}
                {selectedCount === 0 && (
                  <p className="text-xs text-destructive">请在左侧选择样本</p>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </div>

      {/* ── 右侧：训练监控 + 结果 ── */}
      <div className="flex-1 min-w-0">
        <ScrollArea className="h-full">
          <div ref={rightPanelRef} className="space-y-4 pr-2">
            {/* 训练进度 */}
            {activeJob && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <StatusIcon status={activeJob.status} />
                      训练进度
                      <Badge variant={activeJob.status === "COMPLETED" ? "default" : activeJob.status === "FAILED" ? "destructive" : "secondary"}>
                        {activeJob.status}
                      </Badge>
                    </CardTitle>
                    <div className="flex gap-2">
                      {isRunning && (
                        <Button variant="destructive" size="sm" onClick={handleCancelTraining}>
                          <Square className="h-3 w-3 mr-1" />取消
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={refreshData}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    {activeJob.modelName} ({activeJob.modelType})
                    {activeJob.extraMetrics?.stage === "building_dataset"
                      ? ` - ${String(activeJob.extraMetrics?.detail || "构建数据集中...")}`
                      : ` - Epoch ${activeJob.currentEpoch}/${activeJob.totalEpochs}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activeJob.extraMetrics?.stage === "building_dataset" ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{String(activeJob.extraMetrics?.detail || "正在构建数据集...")}</span>
                    </div>
                  ) : (
                    <Progress value={progressPercent} className="h-2" />
                  )}

                  {/* Loss 曲线 */}
                  {progressHistory.length > 1 && (
                    <div className="space-y-2">
                      <Label className="text-xs">Loss</Label>
                      <ReactEChartsCore
                        echarts={echarts}
                        style={{ height: 180 }}
                        option={{
                          grid: { left: 40, right: 16, top: 30, bottom: 24 },
                          tooltip: { trigger: "axis" },
                          legend: { top: 0, textStyle: { fontSize: 11 } },
                          xAxis: { type: "category", data: progressHistory.map((p) => p.epoch), axisLabel: { fontSize: 10 } },
                          yAxis: { type: "value", axisLabel: { fontSize: 10 } },
                          series: [
                            { name: "Train Loss", type: "line", data: progressHistory.map((p) => p.trainLoss), smooth: true, showSymbol: false, lineStyle: { color: "#ef4444" }, itemStyle: { color: "#ef4444" } },
                            { name: "Val Loss", type: "line", data: progressHistory.map((p) => p.valLoss), smooth: true, showSymbol: false, lineStyle: { color: "#3b82f6" }, itemStyle: { color: "#3b82f6" } },
                          ],
                        }}
                      />
                    </div>
                  )}

                  {/* Accuracy 曲线（分类任务） */}
                  {progressHistory.length > 1 && taskType === "classification" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Accuracy</Label>
                      <ReactEChartsCore
                        echarts={echarts}
                        style={{ height: 180 }}
                        option={{
                          grid: { left: 40, right: 16, top: 30, bottom: 24 },
                          tooltip: { trigger: "axis" },
                          legend: { top: 0, textStyle: { fontSize: 11 } },
                          xAxis: { type: "category", data: progressHistory.map((p) => p.epoch), axisLabel: { fontSize: 10 } },
                          yAxis: { type: "value", min: 0, max: 1, axisLabel: { fontSize: 10 } },
                          series: [
                            { name: "Train Acc", type: "line", data: progressHistory.map((p) => p.trainAccuracy), smooth: true, showSymbol: false, lineStyle: { color: "#22c55e" }, itemStyle: { color: "#22c55e" } },
                            { name: "Val Acc", type: "line", data: progressHistory.map((p) => p.valAccuracy), smooth: true, showSymbol: false, lineStyle: { color: "#a855f7" }, itemStyle: { color: "#a855f7" } },
                          ],
                        }}
                      />
                    </div>
                  )}

                  {activeJob.errorMessage && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                      <p className="text-sm text-destructive">{activeJob.errorMessage}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 训练结果 */}
            {isCompleted && evaluations.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    评估结果
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">数据集</TableHead>
                        {taskType === "classification" ? (
                          <>
                            <TableHead className="text-xs text-right">Accuracy</TableHead>
                            <TableHead className="text-xs text-right">F1 (macro)</TableHead>
                            <TableHead className="text-xs text-right">Precision</TableHead>
                            <TableHead className="text-xs text-right">Recall</TableHead>
                            <TableHead className="text-xs text-right">Loss</TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead className="text-xs text-right">MSE</TableHead>
                            <TableHead className="text-xs text-right">MAE</TableHead>
                            <TableHead className="text-xs text-right">R²</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evaluations.map((ev) => (
                        <TableRow key={ev.id}>
                          <TableCell className="text-xs font-medium capitalize">{ev.split}</TableCell>
                          {taskType === "classification" ? (
                            <>
                              <TableCell className="text-xs text-right">{ev.accuracy != null ? (ev.accuracy * 100).toFixed(1) + "%" : "N/A"}</TableCell>
                              <TableCell className="text-xs text-right">{ev.f1Macro?.toFixed(3) ?? "N/A"}</TableCell>
                              <TableCell className="text-xs text-right">{ev.precisionMacro?.toFixed(3) ?? "N/A"}</TableCell>
                              <TableCell className="text-xs text-right">{ev.recallMacro?.toFixed(3) ?? "N/A"}</TableCell>
                              <TableCell className="text-xs text-right">{ev.loss?.toFixed(4) ?? "N/A"}</TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="text-xs text-right">{ev.mse?.toFixed(4) ?? "N/A"}</TableCell>
                              <TableCell className="text-xs text-right">{ev.mae?.toFixed(4) ?? "N/A"}</TableCell>
                              <TableCell className="text-xs text-right">{ev.r2Score?.toFixed(4) ?? "N/A"}</TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* 混淆矩阵 */}
                  {evaluations.find((e) => e.split === "test")?.confusionMatrix && (
                    <div className="mt-4">
                      <Label className="text-xs font-medium">混淆矩阵 (Test)</Label>
                      <ConfusionMatrixDisplay
                        matrix={evaluations.find((e) => e.split === "test")!.confusionMatrix!}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 模型列表 */}
            <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        已训练模型 ({models.length})
                      </CardTitle>
                      {modelsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    {models.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">暂无已训练模型</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">名称</TableHead>
                            <TableHead className="text-xs">架构</TableHead>
                            <TableHead className="text-xs">任务</TableHead>
                            <TableHead className="text-xs text-right">Test 指标</TableHead>
                            <TableHead className="text-xs text-right">大小</TableHead>
                            <TableHead className="text-xs text-right">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {models.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell className="text-xs font-medium">{m.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">{m.modelType}</Badge>
                              </TableCell>
                              <TableCell className="text-xs">{m.taskType}</TableCell>
                              <TableCell className="text-xs text-right">
                                {m.taskType === "classification"
                                  ? `${(m.testAccuracy * 100).toFixed(1)}%`
                                  : m.extraMetrics?.r2_score != null
                                    ? `R²=${Number(m.extraMetrics.r2_score).toFixed(3)}`
                                    : "-"}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                {m.fileSize ? `${(m.fileSize / 1024).toFixed(0)} KB` : "-"}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleDeleteModel(m.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* 训练历史 */}
            {jobs.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">训练历史</CardTitle>
                    <Button variant="outline" size="sm" onClick={refreshData}>
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-8">状态</TableHead>
                        <TableHead className="text-xs">名称</TableHead>
                        <TableHead className="text-xs">架构</TableHead>
                        <TableHead className="text-xs">标签策略</TableHead>
                        <TableHead className="text-xs text-right">Epoch</TableHead>
                        <TableHead className="text-xs text-right">Test Acc</TableHead>
                        <TableHead className="text-xs text-right w-20">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((j) => (
                        <TableRow
                          key={j.id}
                          className={`cursor-pointer hover:bg-muted/50 ${activeJobId === j.id ? "bg-muted/30" : ""}`}
                          onClick={() => {
                            setActiveJobId(j.id);
                            fetchJobStatus(j.id);
                            if (j.status === "RUNNING" || j.status === "PENDING") {
                              setProgressHistory([]);
                            }
                          }}
                        >
                          <TableCell><StatusIcon status={j.status} /></TableCell>
                          <TableCell className="text-xs font-medium">{j.modelName}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{j.modelType}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {j.datasetConfig?.labelConfigName ? (
                              <span className="flex items-center gap-1">
                                <Tag className="h-3 w-3" />
                                {String(j.datasetConfig.labelConfigName)}
                              </span>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="text-xs text-right">{j.currentEpoch}/{j.totalEpochs}</TableCell>
                          <TableCell className="text-xs text-right">
                            {j.testAccuracy ? `${(j.testAccuracy * 100).toFixed(1)}%` : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                title="查看详情"
                                onClick={() => {
                                  setActiveJobId(j.id);
                                  fetchJobStatus(j.id);
                                  rightPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                              >
                                <Eye className="h-3 w-3" />
                              </Button>
                              {(j.status === "COMPLETED" || j.status === "FAILED" || j.status === "CANCELLED") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  title="以相同配置重新训练"
                                  onClick={() => handleRetrain(j)}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </Button>
                              )}
                              {(j.status === "RUNNING" || j.status === "PENDING") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive"
                                  title="取消训练"
                                  onClick={() => handleCancelJob(j.id)}
                                >
                                  <Square className="h-3 w-3" />
                                </Button>
                              )}
                              {(j.status === "FAILED" || j.status === "CANCELLED") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive"
                                  title="删除任务"
                                  onClick={() => handleDeleteJob(j.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* 空状态 */}
            {!activeJob && models.length === 0 && jobs.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Dumbbell className="h-12 w-12 mb-4 opacity-30" />
                  <p className="text-sm">选择样本和标签策略后开始训练模型</p>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ── 超参数表单 ──

function HyperparamsForm({
  modelType,
  hyperparams,
  onChange,
  disabled,
}: {
  modelType: string;
  hyperparams: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const update = (key: string, value: unknown) => {
    onChange({ ...hyperparams, [key]: value });
  };

  const renderField = (key: string, value: unknown) => {
    if (typeof value === "number") {
      if (key.includes("dropout") || key.includes("ratio") || key.includes("subsample") || key.includes("colsample")) {
        return (
          <div key={key} className="space-y-1">
            <div className="flex justify-between">
              <Label className="text-[11px] text-muted-foreground">{key}</Label>
              <span className="text-[11px] font-mono">{value}</span>
            </div>
            <Slider
              value={[value as number]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={([v]) => update(key, v)}
              disabled={disabled}
            />
          </div>
        );
      }
      return (
        <div key={key} className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground w-32 flex-shrink-0">{key}</Label>
          <Input
            type="number"
            value={value}
            onChange={(e) => update(key, Number(e.target.value))}
            className="h-7 text-xs"
            disabled={disabled}
          />
        </div>
      );
    }
    if (typeof value === "string") {
      if (key === "activation") {
        return (
          <div key={key} className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground w-32 flex-shrink-0">{key}</Label>
            <Select value={value} onValueChange={(v) => update(key, v)} disabled={disabled}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["relu", "gelu", "silu", "tanh", "leaky_relu"].map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
      if (key === "kernel") {
        return (
          <div key={key} className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground w-32 flex-shrink-0">{key}</Label>
            <Select value={value} onValueChange={(v) => update(key, v)} disabled={disabled}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["rbf", "linear", "poly", "sigmoid"].map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
      return (
        <div key={key} className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground w-32 flex-shrink-0">{key}</Label>
          <Input
            value={value}
            onChange={(e) => update(key, e.target.value)}
            className="h-7 text-xs"
            disabled={disabled}
          />
        </div>
      );
    }
    if (Array.isArray(value)) {
      return (
        <div key={key} className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground w-32 flex-shrink-0">{key}</Label>
          <Input
            value={JSON.stringify(value)}
            onChange={(e) => {
              try { update(key, JSON.parse(e.target.value)); } catch { /* ignore */ }
            }}
            className="h-7 text-xs font-mono"
            disabled={disabled}
          />
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-2">
      {Object.entries(hyperparams).map(([key, value]) => renderField(key, value))}
    </div>
  );
}

// ── 混淆矩阵组件 ──

function ConfusionMatrixDisplay({ matrix }: { matrix: number[][] }) {
  if (!matrix || matrix.length === 0) return null;

  const maxVal = Math.max(...matrix.flat());

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="p-1 text-[10px] text-muted-foreground">Pred →</th>
            {matrix[0].map((_, j) => (
              <th key={j} className="p-1 text-[10px] text-center text-muted-foreground w-10">{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="p-1 text-[10px] text-muted-foreground font-medium">{i}</td>
              {row.map((val, j) => {
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const isDiagonal = i === j;
                return (
                  <td
                    key={j}
                    className="p-1 text-[10px] text-center w-10 h-8 border"
                    style={{
                      backgroundColor: isDiagonal
                        ? `rgba(34, 197, 94, ${intensity * 0.6})`
                        : val > 0
                          ? `rgba(239, 68, 68, ${intensity * 0.4})`
                          : "transparent",
                    }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
