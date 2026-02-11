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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  SplitSquareVertical,
  BarChart3,
  TriangleAlert,
  Info,
  Lightbulb,
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
  classNames?: string[];
}

interface DatasetSummary {
  totalSamples: number;
  nClasses: number;
  classDistribution: { label: string; count: number }[];
  imbalanceRatio: number;
  randomBaseline: number;
  majorityClass: string;
  majorityRatio: number;
  recommendedSplit: string;
  splitPreview: Record<string, Record<string, number>>;
  warnings: string[];
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
  fold?: number;
  nFolds?: number;
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

const SPLIT_METHOD_OPTIONS = [
  { value: "stratified_holdout", label: "分层按比例", desc: "分层抽样，确保每个split类别比例一致" },
  { value: "holdout", label: "随机按比例", desc: "纯随机分割，不考虑类别分布" },
  { value: "stratified_kfold", label: "分层K折", desc: "分层K折交叉验证，小样本推荐" },
  { value: "kfold", label: "K折", desc: "K折交叉验证" },
  { value: "leave_one_out", label: "留一法", desc: "每次留一个样本做测试，极小样本推荐" },
];

// ── 默认超参数 ──

const DEFAULT_HYPERPARAMS: Record<string, Record<string, unknown>> = {
  mlp: { hidden_layers: [128, 64], activation: "relu", dropout: 0.1, epochs: 100, learning_rate: 0.003, batch_size: 32, early_stopping_patience: 10, label_smoothing: 0.1, weight_decay: 0.0001 },
  svm: { C: 1.0, kernel: "rbf", gamma: "scale", degree: 3 },
  xgboost: { n_estimators: 100, max_depth: 6, learning_rate: 0.1, subsample: 0.8, colsample_bytree: 0.8 },
  cnn1d: { n_filters: [32, 64], kernel_sizes: [5, 3], pool_size: 2, fc_dims: [64], dropout: 0.3, epochs: 100, learning_rate: 0.001, batch_size: 32, early_stopping_patience: 10 },
  tcn: { n_channels: [32, 64, 64], kernel_size: 3, dropout: 0.1, epochs: 100, learning_rate: 0.003, batch_size: 32, early_stopping_patience: 10, label_smoothing: 0.1, weight_decay: 0.0001 },
  transformer: { d_model: 64, nhead: 4, n_layers: 2, dim_ff: 128, dropout: 0.1, epochs: 100, learning_rate: 0.001, batch_size: 32, early_stopping_patience: 10 },
};

export function ModelTrainingTab() {
  const { selectedSampleIds, mlLabelConfig, setMlLabelConfig, mlSplitRatios, setMlSplitRatios, frameConfig } = useExperiments();

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
  const [splitMethod, setSplitMethod] = useState("stratified_holdout");
  const [kFolds, setKFolds] = useState(5);
  const [datasetSummary, setDatasetSummary] = useState<DatasetSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

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

  // ── 自动获取数据集摘要 ──
  const fetchDatasetSummary = useCallback(async () => {
    if (!mlLabelConfig || selectedSampleIds.size === 0) {
      setDatasetSummary(null);
      return;
    }
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams({
        action: "preview",
        configName: mlLabelConfig,
        sampleIds: Array.from(selectedSampleIds).join(","),
        trainRatio: String(mlSplitRatios.train / 100),
        valRatio: String(mlSplitRatios.val / 100),
        testRatio: String((100 - mlSplitRatios.train - mlSplitRatios.val) / 100),
      });
      const res = await fetch(`/api/ml-labels?${params}`);
      const data = await res.json();

      if (data.labelDistribution) {
        const dist: { label: string; count: number }[] = data.labelDistribution;
        const total = dist.reduce((s, d) => s + d.count, 0);
        const nClasses = dist.length;
        const maxCount = Math.max(...dist.map((d) => d.count));
        const minCount = Math.min(...dist.map((d) => d.count));
        const imbalanceRatio = minCount > 0 ? Math.round((maxCount / minCount) * 100) / 100 : 999;
        const majorityClass = dist[0]?.label || "";
        const majorityRatio = total > 0 ? Math.round((maxCount / total) * 10000) / 10000 : 0;
        const randomBaseline = nClasses > 0 ? Math.round((1 / nClasses) * 10000) / 10000 : 0;

        // 推荐分割方式
        const labelType = data.labelType || "classification";
        let recommendedSplit = "stratified_holdout";
        if (total <= 10) recommendedSplit = "leave_one_out";
        else if (total <= 50) recommendedSplit = labelType === "classification" ? "stratified_kfold" : "kfold";

        // 模拟分割预览
        const trainR = mlSplitRatios.train / 100;
        const valR = mlSplitRatios.val / 100;
        const splitPreview: Record<string, Record<string, number>> = {};
        const warnings: string[] = [];

        if (labelType === "classification" && (splitMethod === "holdout" || splitMethod === "stratified_holdout")) {
          const train: Record<string, number> = {};
          const val: Record<string, number> = {};
          const test: Record<string, number> = {};
          for (const d of dist) {
            const tTrain = Math.max(1, Math.round(d.count * trainR));
            const tVal = d.count > 1 ? Math.max(0, Math.round(d.count * valR)) : 0;
            let tTest = d.count - tTrain - tVal;
            if (tTest < 0) tTest = 0;
            train[d.label] = tTrain;
            val[d.label] = tVal;
            test[d.label] = tTest;
            if (tTest <= 0) warnings.push(`类别 '${d.label}' 在 test 集中可能无样本`);
            if (tVal <= 0 && valR > 0) warnings.push(`类别 '${d.label}' 在 val 集中可能无样本`);
          }
          splitPreview.train = train;
          splitPreview.val = val;
          splitPreview.test = test;
        }

        if (nClasses === 1 && labelType === "classification") warnings.push("只有 1 个类别，无法进行分类任务");
        if (total < 5) warnings.push(`样本量极少 (${total})，建议使用留一法 (LOO)`);
        if (imbalanceRatio > 10 && labelType === "classification") warnings.push(`类别严重不平衡 (${imbalanceRatio}:1)`);
        if (minCount < 2 && labelType === "classification") warnings.push("最小类别仅 1 个样本，分层抽样可能回退为随机分割");

        setDatasetSummary({
          totalSamples: total,
          nClasses,
          classDistribution: dist,
          imbalanceRatio,
          randomBaseline,
          majorityClass,
          majorityRatio,
          recommendedSplit,
          splitPreview,
          warnings,
        });
      }
    } catch (err) {
      console.error("Failed to fetch dataset summary:", err);
    } finally {
      setSummaryLoading(false);
    }
  }, [mlLabelConfig, selectedSampleIds, mlSplitRatios, splitMethod]);

  useEffect(() => {
    const timer = setTimeout(fetchDatasetSummary, 300);
    return () => clearTimeout(timer);
  }, [fetchDatasetSummary]);

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
          const fold = data.extraMetrics?.fold as number | undefined;
          const nFolds = data.extraMetrics?.n_folds as number | undefined;
          setProgressHistory((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].epoch === data.epoch && prev[prev.length - 1].fold === fold) return prev;
            return [
              ...prev,
              {
                epoch: data.epoch,
                trainLoss: data.trainLoss,
                valLoss: data.valLoss,
                trainAccuracy: data.trainAccuracy,
                valAccuracy: data.valAccuracy,
                fold,
                nFolds,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setProgressHistory(
              progressRes.entries
                .filter((e: any) => e.epoch > 0)
                .map((e: any) => ({
                  epoch: e.epoch,
                  trainLoss: e.trainLoss,
                  valLoss: e.valLoss,
                  trainAccuracy: e.trainAccuracy,
                  valAccuracy: e.valAccuracy,
                  fold: e.extraMetrics?.fold as number | undefined,
                  nFolds: e.extraMetrics?.n_folds as number | undefined,
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
          hyperparams: { ...hyperparams, split_method: splitMethod, k_folds: kFolds },
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
  const kFoldDetails = Array.isArray(activeJob?.extraMetrics?.k_fold_details)
    ? (activeJob!.extraMetrics!.k_fold_details as Record<string, unknown>[])
    : null;
  const kFoldCount = kFoldDetails?.length ?? 0;

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

              </CardContent>
            </Card>

            {/* 数据集分割卡片 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <SplitSquareVertical className="h-4 w-4" />
                  数据分割
                </CardTitle>
                <CardDescription>设置数据集分割方式和比例</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 分割方式 */}
                <div className="space-y-1.5">
                  <Label className="text-xs">分割方式</Label>
                  <Select value={splitMethod} onValueChange={setSplitMethod}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SPLIT_METHOD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="flex items-center gap-1.5">
                            {o.label}
                            <span className="text-[10px] text-muted-foreground">({o.desc})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {datasetSummary?.recommendedSplit && datasetSummary.recommendedSplit !== splitMethod && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Lightbulb className="h-3 w-3" />
                      建议使用: {SPLIT_METHOD_OPTIONS.find((o) => o.value === datasetSummary.recommendedSplit)?.label}
                    </p>
                  )}
                </div>

                {/* Holdout 模式：比例滑块 */}
                {(splitMethod === "holdout" || splitMethod === "stratified_holdout") && (
                  <TooltipProvider>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">训练集</span>
                        <span className="text-xs tabular-nums font-medium text-blue-600">{mlSplitRatios.train}%</span>
                      </div>
                      <Slider
                        value={[mlSplitRatios.train]}
                        onValueChange={([v]) => {
                          const maxTrain = 100 - mlSplitRatios.val - 5;
                          setMlSplitRatios({ ...mlSplitRatios, train: Math.min(v, maxTrain) });
                        }}
                        min={10} max={90} step={5}
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">验证集</span>
                        <span className="text-xs tabular-nums font-medium text-amber-600">{mlSplitRatios.val}%</span>
                      </div>
                      <Slider
                        value={[mlSplitRatios.val]}
                        onValueChange={([v]) => {
                          const maxVal = 100 - mlSplitRatios.train - 5;
                          setMlSplitRatios({ ...mlSplitRatios, val: Math.min(v, maxVal) });
                        }}
                        min={5} max={40} step={5}
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">测试集</span>
                        <span className="text-xs tabular-nums font-medium text-emerald-600">{100 - mlSplitRatios.train - mlSplitRatios.val}%</span>
                      </div>

                      {/* 可视化分割条 */}
                      <div className="flex h-3 rounded-full overflow-hidden">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="bg-blue-500 transition-all" style={{ width: `${mlSplitRatios.train}%` }} />
                          </TooltipTrigger>
                          <TooltipContent><p>训练集: {mlSplitRatios.train}%</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="bg-amber-500 transition-all" style={{ width: `${mlSplitRatios.val}%` }} />
                          </TooltipTrigger>
                          <TooltipContent><p>验证集: {mlSplitRatios.val}%</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="bg-emerald-500 transition-all" style={{ width: `${100 - mlSplitRatios.train - mlSplitRatios.val}%` }} />
                          </TooltipTrigger>
                          <TooltipContent><p>测试集: {100 - mlSplitRatios.train - mlSplitRatios.val}%</p></TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </TooltipProvider>
                )}

                {/* K-Fold 模式：K值输入 */}
                {(splitMethod === "kfold" || splitMethod === "stratified_kfold") && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs w-16 flex-shrink-0">K 值</Label>
                    <Input
                      type="number"
                      value={kFolds}
                      onChange={(e) => setKFolds(Math.max(2, Math.min(50, Number(e.target.value))))}
                      className="h-7 text-xs w-20"
                      min={2} max={50}
                    />
                    <span className="text-xs text-muted-foreground">折</span>
                  </div>
                )}

                {splitMethod === "leave_one_out" && (
                  <p className="text-xs text-muted-foreground">每次留 1 个样本做测试，共 {datasetSummary?.totalSamples || "N"} 次训练</p>
                )}

                <div className="text-xs text-muted-foreground">
                  <p>帧采样: <span className="font-medium text-foreground">{frameConfig.nSamples}</span> 点, {frameConfig.method}</p>
                </div>
              </CardContent>
            </Card>

            {/* 数据集摘要卡片 */}
            {mlLabelConfig && selectedCount > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    数据集摘要
                    {summaryLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {datasetSummary ? (
                    <>
                      {/* 基本统计 */}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-muted/50 p-2">
                          <div className="text-lg font-bold tabular-nums">{datasetSummary.totalSamples}</div>
                          <div className="text-[10px] text-muted-foreground">总样本</div>
                        </div>
                        <div className="rounded-lg bg-muted/50 p-2">
                          <div className="text-lg font-bold tabular-nums">{datasetSummary.nClasses}</div>
                          <div className="text-[10px] text-muted-foreground">类别数</div>
                        </div>
                        <div className="rounded-lg bg-muted/50 p-2">
                          <div className="text-lg font-bold tabular-nums">{(datasetSummary.randomBaseline * 100).toFixed(1)}%</div>
                          <div className="text-[10px] text-muted-foreground">随机基线</div>
                        </div>
                      </div>

                      {/* 类别分布迷你条形图 */}
                      {datasetSummary.classDistribution.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">类别分布</Label>
                          {datasetSummary.classDistribution.slice(0, 8).map((d) => {
                            const maxC = datasetSummary.classDistribution[0]?.count || 1;
                            return (
                              <div key={d.label} className="flex items-center gap-2 text-[11px]">
                                <span className="w-20 truncate text-right text-muted-foreground" title={d.label}>{d.label}</span>
                                <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden">
                                  <div
                                    className="h-full bg-primary/60 rounded-sm transition-all"
                                    style={{ width: `${(d.count / maxC) * 100}%` }}
                                  />
                                </div>
                                <span className="w-8 text-right tabular-nums">{d.count}</span>
                              </div>
                            );
                          })}
                          {datasetSummary.classDistribution.length > 8 && (
                            <p className="text-[10px] text-muted-foreground text-center">
                              ...还有 {datasetSummary.classDistribution.length - 8} 个类别
                            </p>
                          )}
                        </div>
                      )}

                      {/* 不平衡比 */}
                      {datasetSummary.imbalanceRatio > 1 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">不平衡比</span>
                          <Badge variant={datasetSummary.imbalanceRatio > 10 ? "destructive" : datasetSummary.imbalanceRatio > 3 ? "secondary" : "outline"} className="text-[10px]">
                            {datasetSummary.imbalanceRatio}:1
                          </Badge>
                        </div>
                      )}

                      {/* 警告 */}
                      {datasetSummary.warnings.length > 0 && (
                        <div className="space-y-1">
                          {datasetSummary.warnings.map((w, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-600">
                              <TriangleAlert className="h-3 w-3 mt-0.5 flex-shrink-0" />
                              <span>{w}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center py-2">
                      {summaryLoading ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />加载中...</>
                      ) : (
                        <><Info className="h-3 w-3" />选择标签策略后显示摘要</>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 训练按钮 */}
            <Card>
              <CardContent className="pt-4 space-y-3">
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
                      : activeJob.extraMetrics?.detail
                        ? ` - ${String(activeJob.extraMetrics.detail)}`
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
                    <KFoldChart progressHistory={progressHistory} metric="loss" taskType={taskType} />
                  )}

                  {/* Accuracy 曲线（分类任务） */}
                  {progressHistory.length > 1 && taskType === "classification" && (
                    <KFoldChart progressHistory={progressHistory} metric="accuracy" taskType={taskType} />
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
                    {kFoldCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        K-Fold ({kFoldCount} 折)
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* 聚合指标表 */}
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
                      {evaluations.map((ev) => {
                        const isKFold = ev.split === "test" && !!activeJob?.extraMetrics?.k_fold_details;
                        const extra = activeJob?.extraMetrics ?? {};
                        return (
                          <TableRow key={ev.id}>
                            <TableCell className="text-xs font-medium capitalize">
                              {ev.split}
                              {isKFold && <span className="text-muted-foreground ml-1">(mean)</span>}
                            </TableCell>
                            {taskType === "classification" ? (
                              <>
                                <TableCell className="text-xs text-right">
                                  {ev.accuracy != null ? (ev.accuracy * 100).toFixed(1) + "%" : "N/A"}
                                  {isKFold && extra.accuracy_std !== undefined && extra.accuracy_std !== null && (
                                    <span className="text-muted-foreground ml-1">{"±" + (Number(extra.accuracy_std) * 100).toFixed(1)}</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-right">
                                  {ev.f1Macro?.toFixed(3) ?? "N/A"}
                                  {isKFold && extra.f1_macro_std !== undefined && extra.f1_macro_std !== null && (
                                    <span className="text-muted-foreground ml-1">{"±" + Number(extra.f1_macro_std).toFixed(3)}</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-right">{ev.precisionMacro?.toFixed(3) ?? "N/A"}</TableCell>
                                <TableCell className="text-xs text-right">{ev.recallMacro?.toFixed(3) ?? "N/A"}</TableCell>
                                <TableCell className="text-xs text-right">{ev.loss?.toFixed(4) ?? "N/A"}</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-xs text-right">
                                  {ev.mse?.toFixed(4) ?? "N/A"}
                                  {isKFold && extra.mse_std !== undefined && extra.mse_std !== null && (
                                    <span className="text-muted-foreground ml-1">{"±" + Number(extra.mse_std).toFixed(4)}</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-right">{ev.mae?.toFixed(4) ?? "N/A"}</TableCell>
                                <TableCell className="text-xs text-right">{ev.r2Score?.toFixed(4) ?? "N/A"}</TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* K-Fold 逐折详情 */}
                  {kFoldDetails && (
                    <KFoldDetailsTable
                      details={kFoldDetails}
                      taskType={taskType}
                    />
                  )}

                  {/* 混淆矩阵 */}
                  {evaluations.find((e) => e.split === "test")?.confusionMatrix && (
                    <div className="mt-4">
                      <Label className="text-xs font-medium">混淆矩阵 (Test)</Label>
                      <ConfusionMatrixDisplay
                        matrix={evaluations.find((e) => e.split === "test")!.confusionMatrix!}
                        classNames={datasetSummary?.classDistribution.map((d) => d.label)}
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

// ── K-Fold 进度图表（支持多折分组显示） ──

const FOLD_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b",
  "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#14b8a6",
];

function KFoldChart({
  progressHistory,
  metric,
  taskType,
}: {
  progressHistory: ProgressPoint[];
  metric: "loss" | "accuracy";
  taskType: string;
}) {
  const hasMultipleFolds = progressHistory.some((p) => p.fold != null && p.fold > 0);

  if (!hasMultipleFolds) {
    // 普通单次训练 → 原始简单图表
    const isLoss = metric === "loss";
    return (
      <div className="space-y-2">
        <Label className="text-xs">{isLoss ? "Loss" : "Accuracy"}</Label>
        <ReactEChartsCore
          echarts={echarts}
          style={{ height: 180 }}
          option={{
            grid: { left: 40, right: 16, top: 30, bottom: 24 },
            tooltip: { trigger: "axis" },
            legend: { top: 0, textStyle: { fontSize: 11 } },
            xAxis: { type: "category", data: progressHistory.map((p) => p.epoch), axisLabel: { fontSize: 10 } },
            yAxis: { type: "value", ...(isLoss ? {} : { min: 0, max: 1 }), axisLabel: { fontSize: 10 } },
            series: isLoss
              ? [
                  { name: "Train Loss", type: "line", data: progressHistory.map((p) => p.trainLoss), smooth: true, showSymbol: false, lineStyle: { color: "#ef4444" }, itemStyle: { color: "#ef4444" } },
                  { name: "Val Loss", type: "line", data: progressHistory.map((p) => p.valLoss), smooth: true, showSymbol: false, lineStyle: { color: "#3b82f6" }, itemStyle: { color: "#3b82f6" } },
                ]
              : [
                  { name: "Train Acc", type: "line", data: progressHistory.map((p) => p.trainAccuracy), smooth: true, showSymbol: false, lineStyle: { color: "#22c55e" }, itemStyle: { color: "#22c55e" } },
                  { name: "Val Acc", type: "line", data: progressHistory.map((p) => p.valAccuracy), smooth: true, showSymbol: false, lineStyle: { color: "#a855f7" }, itemStyle: { color: "#a855f7" } },
                ],
          }}
        />
      </div>
    );
  }

  // K-Fold: 按折分组
  const foldGroups = new Map<number, ProgressPoint[]>();
  for (const p of progressHistory) {
    const f = p.fold ?? 1;
    if (!foldGroups.has(f)) foldGroups.set(f, []);
    foldGroups.get(f)!.push(p);
  }
  const foldNums = Array.from(foldGroups.keys()).sort((a, b) => a - b);
  const maxEpoch = Math.max(...progressHistory.map((p) => p.epoch));
  const xData = Array.from({ length: maxEpoch }, (_, i) => i + 1);

  const isLoss = metric === "loss";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const series: any[] = [];
  for (const fold of foldNums) {
    const group = foldGroups.get(fold)!;
    const epochMap = new Map(group.map((p) => [p.epoch, p]));
    const trainData = xData.map((e) => {
      const p = epochMap.get(e);
      return p ? (isLoss ? p.trainLoss : p.trainAccuracy) : null;
    });
    const valData = xData.map((e) => {
      const p = epochMap.get(e);
      return p ? (isLoss ? p.valLoss : p.valAccuracy) : null;
    });
    const color = FOLD_COLORS[(fold - 1) % FOLD_COLORS.length];
    series.push({
      name: `F${fold} Train`,
      type: "line",
      data: trainData,
      smooth: true,
      showSymbol: false,
      lineStyle: { color, width: 1.5 },
      itemStyle: { color },
      connectNulls: false,
    });
    series.push({
      name: `F${fold} Val`,
      type: "line",
      data: valData,
      smooth: true,
      showSymbol: false,
      lineStyle: { color, width: 1.5, type: "dashed" },
      itemStyle: { color },
      connectNulls: false,
    });
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">{isLoss ? "Loss" : "Accuracy"} (K-Fold)</Label>
      <ReactEChartsCore
        echarts={echarts}
        style={{ height: 220 }}
        option={{
          grid: { left: 40, right: 16, top: 40, bottom: 24 },
          tooltip: { trigger: "axis" },
          legend: { top: 0, textStyle: { fontSize: 10 }, type: "scroll" },
          xAxis: { type: "category", data: xData, axisLabel: { fontSize: 10 }, name: "Epoch" },
          yAxis: { type: "value", ...(isLoss ? {} : { min: 0, max: 1 }), axisLabel: { fontSize: 10 } },
          series,
        }}
      />
    </div>
  );
}

// ── K-Fold 逐折详情表 ──

function KFoldDetailsTable({
  details,
  taskType,
}: {
  details: Record<string, unknown>[];
  taskType: string;
}) {
  if (!details || details.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">K-Fold 逐折详情</Label>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-16">Fold</TableHead>
            {taskType === "classification" ? (
              <>
                <TableHead className="text-xs text-right">Accuracy</TableHead>
                <TableHead className="text-xs text-right">F1 (macro)</TableHead>
                <TableHead className="text-xs text-right">Precision</TableHead>
                <TableHead className="text-xs text-right">Recall</TableHead>
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
          {details.map((d, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs font-medium">Fold {i + 1}</TableCell>
              {taskType === "classification" ? (
                <>
                  <TableCell className="text-xs text-right">
                    {d.accuracy != null ? (Number(d.accuracy) * 100).toFixed(1) + "%" : "N/A"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {d.f1_macro != null ? Number(d.f1_macro).toFixed(3) : "N/A"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {d.precision_macro != null ? Number(d.precision_macro).toFixed(3) : "N/A"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {d.recall_macro != null ? Number(d.recall_macro).toFixed(3) : "N/A"}
                  </TableCell>
                </>
              ) : (
                <>
                  <TableCell className="text-xs text-right">
                    {d.mse != null ? Number(d.mse).toFixed(4) : "N/A"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {d.mae != null ? Number(d.mae).toFixed(4) : "N/A"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {d.r2_score != null ? Number(d.r2_score).toFixed(4) : "N/A"}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── 混淆矩阵组件 ──

function ConfusionMatrixDisplay({ matrix, classNames }: { matrix: number[][]; classNames?: string[] }) {
  if (!matrix || matrix.length === 0) return null;

  const maxVal = Math.max(...matrix.flat());
  const labels = classNames && classNames.length === matrix.length
    ? classNames
    : matrix.map((_, i) => String(i));

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="p-1 text-[10px] text-muted-foreground">True ↓ / Pred →</th>
            {labels.map((label, j) => (
              <th key={j} className="p-1 text-[10px] text-center text-muted-foreground max-w-16 truncate" title={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="p-1 text-[10px] text-muted-foreground font-medium max-w-20 truncate" title={labels[i]}>{labels[i]}</td>
              {row.map((val, j) => {
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const isDiagonal = i === j;
                return (
                  <td
                    key={j}
                    className="p-1 text-[10px] text-center min-w-8 h-8 border"
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
