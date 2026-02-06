/**
 * 数据导出工具函数
 */

import type { SampleWithFrameStatus } from "@/components/experiments/context/ExperimentsContext";

/**
 * 将样本数组转为参数 CSV 字符串
 */
export function samplesToParamsCsv(samples: SampleWithFrameStatus[]): string {
  const headers = [
    "sample_id",
    "run_id",
    "sample_idx",
    "phase_name",
    "liquid_names",
    "liquid_ratios",
    "total_volume_ml",
    "flow_rate_ml_s",
    "gas_pump_pwm",
    "termination_type",
    "termination_value",
    "max_duration_s",
    "heater_profiles",
    "pre_wash_count",
    "avg_temperature_c",
    "avg_humidity_pct",
    "avg_pressure_hpa",
    "params_hash",
    "duration_s",
    "reading_count",
    "has_frames",
  ];

  const rows = samples.map((s) => [
    s.id,
    s.runId,
    s.sampleIdx,
    csvEscape(s.phaseName),
    csvEscape(s.liquidNames?.join(" + ") ?? ""),
    csvEscape(s.liquidRatios?.map((r) => r.toFixed(4)).join(";") ?? ""),
    s.totalVolumeMl ?? "",
    s.flowRateMlS ?? "",
    s.gasPumpPwm,
    csvEscape(s.terminationType ?? ""),
    s.terminationValue ?? "",
    s.maxDurationS ?? "",
    csvEscape(s.heaterProfiles?.join(";") ?? ""),
    s.preWashCount ?? 0,
    s.avgTemperatureC ?? "",
    s.avgHumidityPct ?? "",
    s.avgPressureHpa ?? "",
    s.paramsHash,
    s.durationS ?? "",
    s.readingCount ?? "",
    s.frameStatus?.hasFrames ? "true" : "false",
  ]);

  const csvLines = [
    headers.join(","),
    ...rows.map((row) => row.map(String).join(",")),
  ];

  return csvLines.join("\n");
}

/**
 * CSV 字段转义：包含逗号、引号或换行时用双引号包裹
 */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 触发浏览器下载文件
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 下载 CSV 字符串为文件
 */
export function downloadCsv(csvContent: string, filename: string) {
  // 添加 BOM 以确保 Excel 正确识别 UTF-8
  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 估算原始传感器数据大小（粗略）
 * 每行约 ~50 bytes，每个 reading 对应一行
 */
export function estimateRawDataSize(readingCount: number): number {
  return readingCount * 50;
}

/**
 * 估算帧数据大小
 * NPZ: n_samples * 8 channels * 8 bytes (float64) + overhead
 * CSV: n_samples * 8 channels * ~10 chars + headers
 */
export function estimateFrameSize(
  nSamples: number,
  sampleCount: number,
  format: "npz" | "csv"
): number {
  if (format === "npz") {
    return sampleCount * nSamples * 8 * 8 + 1024; // numpy overhead
  }
  return sampleCount * nSamples * 8 * 10 + sampleCount * 200; // CSV overhead
}
