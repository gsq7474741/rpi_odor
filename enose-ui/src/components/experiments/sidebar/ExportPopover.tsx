"use client";

import { useState, useCallback, useMemo } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
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
import {
  Download,
  FileSpreadsheet,
  Database,
  Layers,
  Tags,
  Brain,
  Loader2,
  Info,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import {
  samplesToParamsCsv,
  downloadCsv,
  downloadBlob,
  formatFileSize,
  estimateRawDataSize,
  estimateFrameSize,
} from "@/lib/export-utils";

type FrameFormat = "npz" | "csv";
type DatasetFormat = "npz" | "csv";
type PackageMode = "zip" | "separate";

interface ExportConfig {
  includeParams: boolean;
  includeRawData: boolean;
  includeFrames: boolean;
  frameFormat: FrameFormat;
  includeMlLabels: boolean;
  mlLabelConfigs: string[];
  includeDataset: boolean;
  datasetLabelConfig: string;
  datasetSplit: boolean;
  datasetTrainRatio: number;
  datasetValRatio: number;
  datasetFormat: DatasetFormat;
  packageMode: PackageMode;
}

const DEFAULT_CONFIG: ExportConfig = {
  includeParams: true,
  includeRawData: false,
  includeFrames: false,
  frameFormat: "npz",
  includeMlLabels: false,
  mlLabelConfigs: [],
  includeDataset: false,
  datasetLabelConfig: "liquid_identity",
  datasetSplit: true,
  datasetTrainRatio: 0.7,
  datasetValRatio: 0.15,
  datasetFormat: "npz",
  packageMode: "zip",
};

interface MLLabelConfig {
  id: number;
  name: string;
  labelType: string;
  description: string;
  labelCount: number;
}

export function ExportPopover() {
  const {
    samples,
    selectedSampleIds,
    frameConfig,
  } = useExperiments();

  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);
  const [exporting, setExporting] = useState(false);
  const [labelConfigs, setLabelConfigs] = useState<MLLabelConfig[]>([]);
  const [labelConfigsLoaded, setLabelConfigsLoaded] = useState(false);

  const selectedSamples = useMemo(
    () => samples.filter((s) => selectedSampleIds.has(s.id)),
    [samples, selectedSampleIds]
  );

  // 帧可用性
  const samplesWithFrames = useMemo(
    () => selectedSamples.filter((s) => s.frameStatus?.hasFrames),
    [selectedSamples]
  );
  const framesAvailable = samplesWithFrames.length > 0;

  // 加载 ML 标签策略列表
  const loadLabelConfigs = useCallback(async () => {
    if (labelConfigsLoaded) return;
    try {
      const res = await fetch("/api/ml-labels?action=configs");
      const data = await res.json();
      if (data.configs) {
        setLabelConfigs(data.configs);
      }
      setLabelConfigsLoaded(true);
    } catch (e) {
      console.error("Failed to load label configs:", e);
    }
  }, [labelConfigsLoaded]);

  // 打开 popover 时加载标签策略
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen);
      if (newOpen) {
        loadLabelConfigs();
      }
    },
    [loadLabelConfigs]
  );

  // 估算总大小
  const estimatedSize = useMemo(() => {
    let total = 0;
    if (config.includeParams) {
      total += selectedSamples.length * 200; // ~200 bytes per sample row
    }
    if (config.includeRawData) {
      total += selectedSamples.reduce(
        (acc, s) => acc + estimateRawDataSize(s.readingCount || 0),
        0
      );
    }
    if (config.includeFrames) {
      total += estimateFrameSize(
        frameConfig.nSamples,
        samplesWithFrames.length,
        config.frameFormat
      );
    }
    if (config.includeDataset) {
      total += estimateFrameSize(
        frameConfig.nSamples,
        samplesWithFrames.length,
        config.datasetFormat
      );
    }
    if (config.includeMlLabels) {
      total += selectedSamples.length * 100;
    }
    return total;
  }, [config, selectedSamples, samplesWithFrames, frameConfig]);

  // 有几种数据类型被勾选
  const checkedCount = [
    config.includeParams,
    config.includeRawData,
    config.includeFrames,
    config.includeMlLabels,
    config.includeDataset,
  ].filter(Boolean).length;

  // 是否只有纯前端导出（仅参数表）
  const frontendOnly =
    config.includeParams &&
    !config.includeRawData &&
    !config.includeFrames &&
    !config.includeMlLabels &&
    !config.includeDataset;

  // 执行导出
  const handleExport = useCallback(async () => {
    if (checkedCount === 0) {
      toast.warning("请至少选择一种导出类型");
      return;
    }

    // 纯前端参数 CSV 导出
    if (frontendOnly) {
      const csv = samplesToParamsCsv(selectedSamples);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadCsv(csv, `samples_params_${timestamp}.csv`);
      toast.success(`已导出 ${selectedSamples.length} 个样本的参数表`);
      setOpen(false);
      return;
    }

    // 需要后端的导出
    setExporting(true);
    const toastId = toast.loading("正在准备导出数据...");

    try {
      const body = {
        sampleIds: Array.from(selectedSampleIds),
        includeParams: config.includeParams,
        includeRawData: config.includeRawData,
        includeFrames: config.includeFrames,
        frameMethod: frameConfig.method,
        frameNSamples: frameConfig.nSamples,
        frameFormat: config.frameFormat,
        includeMlLabels: config.includeMlLabels,
        mlLabelConfigs: config.mlLabelConfigs,
        includeDataset: config.includeDataset,
        datasetLabelConfig: config.datasetLabelConfig,
        datasetSplit: config.datasetSplit,
        datasetTrainRatio: config.datasetTrainRatio,
        datasetValRatio: config.datasetValRatio,
        datasetFormat: config.datasetFormat,
      };

      const response = await fetch("/api/analytics/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const ext = checkedCount > 1 || config.packageMode === "zip" ? "zip" : 
                  config.includeRawData ? "zip" :
                  config.includeFrames ? config.frameFormat :
                  config.includeDataset ? config.datasetFormat :
                  "csv";
      downloadBlob(blob, `export_${timestamp}.${ext}`);
      toast.success("导出完成", { id: toastId });
      setOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(`导出失败: ${error instanceof Error ? error.message : "未知错误"}`, {
        id: toastId,
      });
    } finally {
      setExporting(false);
    }
  }, [
    checkedCount,
    frontendOnly,
    selectedSamples,
    selectedSampleIds,
    config,
    frameConfig,
  ]);

  // 更新配置的 helper
  const updateConfig = useCallback(
    <K extends keyof ExportConfig>(key: K, value: ExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // 切换 ML 标签策略
  const toggleLabelConfig = useCallback(
    (name: string) => {
      setConfig((prev) => {
        const configs = prev.mlLabelConfigs.includes(name)
          ? prev.mlLabelConfigs.filter((c) => c !== name)
          : [...prev.mlLabelConfigs, name];
        return { ...prev, mlLabelConfigs: configs };
      });
    },
    []
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          disabled={selectedSampleIds.size === 0}
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px]" align="end" sideOffset={8}>
        <div className="space-y-3">
          {/* 标题 */}
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">导出数据</h4>
            <Badge variant="outline" className="text-[10px] h-5">
              {selectedSamples.length} 样本已选
            </Badge>
          </div>

          <Separator />

          {/* A: 样本参数表 */}
          <ExportOption
            icon={FileSpreadsheet}
            label="样本参数表"
            description="CSV，包含所有样本的实验参数"
            checked={config.includeParams}
            onCheckedChange={(v) => updateConfig("includeParams", v)}
            estimate={formatFileSize(selectedSamples.length * 200)}
          />

          {/* B: 原始传感器数据 */}
          <ExportOption
            icon={Database}
            label="原始传感器数据"
            description="每样本一个 CSV，全量读数"
            checked={config.includeRawData}
            onCheckedChange={(v) => updateConfig("includeRawData", v)}
            estimate={formatFileSize(
              selectedSamples.reduce(
                (acc, s) => acc + estimateRawDataSize(s.readingCount || 0),
                0
              )
            )}
          />

          {/* C: 归一化数据帧 */}
          <div className="space-y-1.5">
            <ExportOption
              icon={Layers}
              label="归一化数据帧"
              description={`${frameConfig.method} × ${frameConfig.nSamples}点 (n, 8)`}
              checked={config.includeFrames}
              onCheckedChange={(v) => updateConfig("includeFrames", v)}
              estimate={formatFileSize(
                estimateFrameSize(
                  frameConfig.nSamples,
                  samplesWithFrames.length,
                  config.frameFormat
                )
              )}
              disabled={!framesAvailable}
              disabledReason={
                !framesAvailable
                  ? "请先在「数据帧管理」中生成帧"
                  : undefined
              }
              badge={
                framesAvailable
                  ? `${samplesWithFrames.length}/${selectedSamples.length} 有帧`
                  : undefined
              }
            />
            {config.includeFrames && (
              <div className="ml-7 space-y-1">
                <FormatSelector
                  value={config.frameFormat}
                  onChange={(v) => updateConfig("frameFormat", v as FrameFormat)}
                />
              </div>
            )}
          </div>

          {/* D: ML 标签 */}
          <div className="space-y-1.5">
            <ExportOption
              icon={Tags}
              label="ML 标签"
              description="CSV，样本标签数据"
              checked={config.includeMlLabels}
              onCheckedChange={(v) => updateConfig("includeMlLabels", v)}
              estimate={formatFileSize(selectedSamples.length * 100)}
              disabled={labelConfigs.length === 0}
              disabledReason={
                labelConfigs.length === 0 ? "无可用标签策略" : undefined
              }
            />
            {config.includeMlLabels && labelConfigs.length > 0 && (
              <div className="ml-7 space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  选择策略
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {labelConfigs.map((lc) => (
                    <label
                      key={lc.name}
                      className="flex items-center gap-1 cursor-pointer"
                    >
                      <Checkbox
                        checked={config.mlLabelConfigs.includes(lc.name)}
                        onCheckedChange={() => toggleLabelConfig(lc.name)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-[11px]">{lc.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* E: 训练数据集 */}
          <div className="space-y-1.5">
            <ExportOption
              icon={Brain}
              label="训练数据集"
              description="帧矩阵 (N, n, 8) + 标签"
              checked={config.includeDataset}
              onCheckedChange={(v) => updateConfig("includeDataset", v)}
              estimate={formatFileSize(
                estimateFrameSize(
                  frameConfig.nSamples,
                  samplesWithFrames.length,
                  config.datasetFormat
                )
              )}
              disabled={!framesAvailable || labelConfigs.length === 0}
              disabledReason={
                !framesAvailable
                  ? "请先生成帧"
                  : labelConfigs.length === 0
                  ? "无可用标签策略"
                  : undefined
              }
            />
            {config.includeDataset && (
              <div className="ml-7 space-y-2">
                {/* 标签策略 */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    标签策略
                  </Label>
                  <Select
                    value={config.datasetLabelConfig}
                    onValueChange={(v) =>
                      updateConfig("datasetLabelConfig", v)
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {labelConfigs.map((lc) => (
                        <SelectItem key={lc.name} value={lc.name}>
                          <span className="text-xs">{lc.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({lc.labelType})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 分割 */}
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={config.datasetSplit}
                      onCheckedChange={(v) =>
                        updateConfig("datasetSplit", v === true)
                      }
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-[11px]">分割数据集</span>
                  </label>
                  {config.datasetSplit && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-muted-foreground">比例:</span>
                      <Input
                        type="number"
                        value={Math.round(config.datasetTrainRatio * 100)}
                        onChange={(e) =>
                          updateConfig(
                            "datasetTrainRatio",
                            Math.max(0.1, Math.min(0.9, parseInt(e.target.value || "70") / 100))
                          )
                        }
                        className="h-6 w-10 text-[11px] text-center px-1"
                        min={10}
                        max={90}
                      />
                      <span>/</span>
                      <Input
                        type="number"
                        value={Math.round(config.datasetValRatio * 100)}
                        onChange={(e) =>
                          updateConfig(
                            "datasetValRatio",
                            Math.max(0, Math.min(0.5, parseInt(e.target.value || "15") / 100))
                          )
                        }
                        className="h-6 w-10 text-[11px] text-center px-1"
                        min={0}
                        max={50}
                      />
                      <span>/</span>
                      <span className="text-muted-foreground tabular-nums">
                        {Math.round(
                          (1 -
                            config.datasetTrainRatio -
                            config.datasetValRatio) *
                            100
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* 格式 */}
                <FormatSelector
                  value={config.datasetFormat}
                  onChange={(v) =>
                    updateConfig("datasetFormat", v as DatasetFormat)
                  }
                />
              </div>
            )}
          </div>

          <Separator />

          {/* 打包模式（多类型时显示） */}
          {checkedCount > 1 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                打包方式
              </Label>
              <RadioGroup
                value={config.packageMode}
                onValueChange={(v) =>
                  updateConfig("packageMode", v as PackageMode)
                }
                className="flex gap-3"
              >
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <RadioGroupItem value="zip" className="h-3.5 w-3.5" />
                  <Package className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px]">ZIP 打包</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <RadioGroupItem value="separate" className="h-3.5 w-3.5" />
                  <span className="text-[11px]">分别下载</span>
                </label>
              </RadioGroup>
            </div>
          )}

          {/* 导出按钮 */}
          <Button
            className="w-full h-8"
            size="sm"
            onClick={handleExport}
            disabled={exporting || checkedCount === 0}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            {exporting
              ? "导出中..."
              : `导出${checkedCount > 0 ? ` (~${formatFileSize(estimatedSize)})` : ""}`}
          </Button>

          {/* 仅前端提示 */}
          {frontendOnly && checkedCount > 0 && (
            <p className="text-[10px] text-muted-foreground text-center">
              参数表在浏览器端生成，无需后端
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── 子组件 ────────────────────────────────────────────────

interface ExportOptionProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  estimate?: string;
  disabled?: boolean;
  disabledReason?: string;
  badge?: string;
}

function ExportOption({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
  estimate,
  disabled,
  disabledReason,
  badge,
}: ExportOptionProps) {
  const content = (
    <label
      className={`flex items-start gap-2 cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => !disabled && onCheckedChange(v === true)}
        disabled={disabled}
        className="h-4 w-4 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium">{label}</span>
          {badge && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1">
              {badge}
            </Badge>
          )}
          {estimate && (
            <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
              ~{estimate}
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
          {description}
        </p>
      </div>
    </label>
  );

  if (disabled && disabledReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{content}</div>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p className="text-xs">{disabledReason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}

function FormatSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] text-muted-foreground">格式:</Label>
      <RadioGroup
        value={value}
        onValueChange={onChange}
        className="flex gap-2"
      >
        <label className="flex items-center gap-1 cursor-pointer">
          <RadioGroupItem value="npz" className="h-3 w-3" />
          <span className="text-[11px]">NPZ</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <RadioGroupItem value="csv" className="h-3 w-3" />
          <span className="text-[11px]">CSV</span>
        </label>
      </RadioGroup>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px]">
            <p className="text-xs">
              <strong>NPZ</strong>: Python np.load() 直接读取
              <br />
              <strong>CSV</strong>: 通用表格格式
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
