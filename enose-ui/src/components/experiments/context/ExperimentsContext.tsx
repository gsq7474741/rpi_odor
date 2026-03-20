"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from "react";

// 运行记录
export interface Run {
  id: number;
  createdAt: string | null;
  completedAt: string | null;
  state: string;
  configJson: Record<string, unknown>;
  sampleCount: number;
}

// Phase 转换记录
export interface PhaseTransition {
  id: number;
  phaseName: string;
  startTimeMs: number;
  endTimeMs: number | null;
  phaseOrder: number;
}

// 样本记录
export interface Sample {
  id: number;
  runId: number;
  sampleIdx: number;
  startTimeMs: number;
  endTimeMs: number | null;
  paramsHash: string;
  liquidNames: string[];
  liquidRatios: number[];
  totalVolumeMl: number;
  flowRateMlS: number;
  gasPumpPwm: number;
  terminationType: string;
  terminationValue: number;
  maxDurationS: number;
  heaterProfiles: string[];
  heaterConfigs: {
    sensorIndices: number[];
    profileName: string;
    temps: number[];
    durs: number[];
  }[];
  preWashCount: number;
  phaseName: string;
  avgTemperatureC: number | null;
  avgHumidityPct: number | null;
  avgPressureHpa: number | null;
  durationS: number | null;
  phaseTransitions: PhaseTransition[];
  readingCount: number;
  // 组合实验元数据 (0016)
  reagentBatchId: string | null;
  reagentPrepDate: string | null;
  prevSampleId: number | null;
  samplesSinceWash: number;
  sensorHoursAtSample: number | null;
  isAnchor: boolean;
  isBlank: boolean;
  experimentPhase: string | null;
  sequenceBlock: string | null;
  randomizationSeed: number | null;
  washResidualResponse: number[];
  qualityScore: number | null;
  qualityLevel: string | null;
}

// 对齐序列状态
export interface AlignedSeriesStatus {
  hasAlignedSeries: boolean;
  cached: boolean;
  variants: {
    method: string;
    nSamples: number;
  }[];
}

// 对齐序列使用配置（选择使用哪个变体）
export interface AlignedSeriesConfig {
  method: "linear" | "pchip";
  nSamples: number;
}

// 异常标记
export type AnomalyFlag =
  | "incomplete"       // end_time_ms 为空，采集未正常结束
  | "too_short"        // 持续时间 < 5 秒
  | "missing_liquid"   // SAMPLE/DOSE/INJECT 阶段缺少液体信息
  | "no_readings"      // readingCount === 0（无传感器数据）
  | "run_error";       // 所属 Run 状态为 error/aborted

export const ANOMALY_LABELS: Record<AnomalyFlag, string> = {
  incomplete: "采集未完成",
  too_short: "持续时间过短",
  missing_liquid: "液体信息缺失",
  no_readings: "无传感器数据",
  run_error: "Run 异常终止",
};

/** 根据样本数据计算异常标记 */
export function detectAnomalies(
  sample: Sample,
  runState?: string,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  // 1. 采集未完成
  if (sample.endTimeMs === null || sample.endTimeMs === 0) {
    flags.push("incomplete");
  }
  // 2. 持续时间过短（< 5 秒）
  if (
    sample.durationS !== null &&
    sample.durationS >= 0 &&
    sample.durationS < 5
  ) {
    flags.push("too_short");
  }
  // 3. 需要液体的阶段缺少液体信息
  const needsLiquid = ["SAMPLE", "DOSE", "INJECT"];
  if (
    needsLiquid.includes(sample.phaseName) &&
    (!sample.liquidNames || sample.liquidNames.length === 0)
  ) {
    flags.push("missing_liquid");
  }
  // 4. Run 异常
  if (runState && (runState === "error" || runState === "aborted")) {
    flags.push("run_error");
  }
  return flags;
}

// 带对齐序列状态的样本
export interface SampleWithSeriesStatus extends Sample {
  seriesStatus: AlignedSeriesStatus | null;
  runCreatedAt: string | null;  // Run 创建时间，用于显示来源
  anomalyFlags: AnomalyFlag[];  // 异常标记
}

// 样本组
export interface SampleGroup {
  paramsHash: string;
  liquidNames: string[];
  gasPumpPwm: number;
  phaseName: string;
  sampleCount: number;
  runIds: number[];
  firstCreated: string | null;
  lastCreated: string | null;
}

// 对比项
export interface ComparisonItem {
  type: "run" | "sample" | "sample_group";
  id: number | string;
  label: string;
}

// 筛选状态
export interface FilterState {
  runIds: number[];           // 按 Run 筛选（不是选择！）
  phaseNames: string[];       // 按阶段筛选
  liquidIds: string[];        // 按液体筛选
  // 组合实验筛选 (0016)
  experimentPhases: string[]; // 按实验设计阶段筛选（Phase 1-6）
  componentCount: number | null; // 混合物复杂度筛选（1=纯物质, 2=二元, 3=三元, null=全部）
  qualityLevels: string[];    // 按质量等级筛选（good/warning/poor）
  showAnchorsOnly: boolean;   // 仅显示锚点样品
  showBlanksOnly: boolean;    // 仅显示空白对照
  hideAnchorsAndBlanks: boolean; // 隐藏锚点和空白（默认 false）
  timeRange: [Date, Date] | null;
  pwmRange: [number, number] | null;
  paramsHash: string | null;
  searchQuery: string;
  hasAlignedSeries: boolean | null;  // 按对齐序列状态筛选
  showAnomaliesOnly: boolean;        // 仅显示异常样本
}

// 上下文状态
export interface ExperimentsState {
  // 数据 - Runs (仅用于筛选选项)
  runs: Run[];
  runsLoading: boolean;
  runsTotal: number;
  runsPage: number;
  
  // 数据 - Samples (核心数据)
  samples: SampleWithSeriesStatus[];
  samplesLoading: boolean;
  samplesTotal: number;
  samplesPage: number;
  
  // 旧版兼容 - 展开的运行及其样本 (TODO: 待移除)
  expandedRuns: Set<number>;
  runSamples: Record<number, Sample[]>;
  runSamplesLoading: Set<number>;
  
  // 选中项 - 唯一选择实体是样本
  selectedSampleIds: Set<number>;
  // 所有选中样本的缓存数据（跨页保持）
  allSelectedSamples: SampleWithSeriesStatus[];
  // @deprecated 待移除，保留用于兼容
  selectedRunIds: Set<number>;
  
  // 对比模式
  comparisonMode: boolean;
  comparisonItems: ComparisonItem[];
  
  // 筛选
  filters: FilterState;
  
  // 对齐序列使用配置
  seriesConfig: AlignedSeriesConfig;
  setSeriesConfig: (config: Partial<AlignedSeriesConfig>) => void;
  
  // ML 标签配置（TrainingTab 写入，ExportPopover 读取）
  mlLabelConfig: string;
  setMlLabelConfig: (config: string) => void;
  mlSplitRatios: { train: number; val: number };
  setMlSplitRatios: (ratios: { train: number; val: number }) => void;
  
  // 可用的筛选选项
  availableRuns: { id: number; sampleCount: number }[];
  availableLiquids: { id: string; name: string }[];
  availablePhases: string[];
  filterOptionsLoading: boolean;
  
  // 操作
  setRuns: (runs: Run[]) => void;
  setRunsLoading: (loading: boolean) => void;
  setRunsTotal: (total: number) => void;
  setRunsPage: (page: number) => void;
  
  toggleRunExpand: (runId: number) => void;
  setRunSamples: (runId: number, samples: Sample[]) => void;
  setRunSamplesLoading: (runId: number, loading: boolean) => void;
  
  toggleRunSelection: (runId: number) => void;
  toggleSampleSelection: (sampleId: number) => void;
  selectAllSamples: () => void;
  clearSampleSelection: () => void;
  addSamplesToSelection: (sampleIds: number[]) => void;
  removeSamplesFromSelection: (sampleIds: number[]) => void;
  // @deprecated
  selectAllRuns: () => void;
  clearRunSelection: () => void;
  
  // 样本数据操作
  setSamples: (samples: SampleWithSeriesStatus[]) => void;
  setSamplesLoading: (loading: boolean) => void;
  setSamplesTotal: (total: number) => void;
  setSamplesPage: (page: number) => void;
  
  toggleComparisonMode: () => void;
  addToComparison: (item: ComparisonItem) => void;
  removeFromComparison: (item: ComparisonItem) => void;
  clearComparison: () => void;
  
  updateFilters: (filters: Partial<FilterState>) => void;
  clearFilters: () => void;
  
  setAvailableRuns: (runs: { id: number; sampleCount: number }[]) => void;
  setAvailableLiquids: (liquids: { id: string; name: string }[]) => void;
  setAvailablePhases: (phases: string[]) => void;
  setFilterOptionsLoading: (loading: boolean) => void;
  
  // 刷新选中样本的对齐序列状态
  refreshSeriesStatuses: () => Promise<void>;
  
  // 悬停联动（SampleTable ↔ 散点图）
  hoveredSampleId: number | null;
  setHoveredSampleId: (id: number | null) => void;
}

const defaultFilters: FilterState = {
  runIds: [],
  phaseNames: [],
  liquidIds: [],
  experimentPhases: [],
  componentCount: null,
  qualityLevels: [],
  showAnchorsOnly: false,
  showBlanksOnly: false,
  hideAnchorsAndBlanks: false,
  timeRange: null,
  pwmRange: null,
  paramsHash: null,
  searchQuery: "",
  hasAlignedSeries: null,
  showAnomaliesOnly: false,
};

const ExperimentsContext = createContext<ExperimentsState | null>(null);

export function ExperimentsProvider({ children }: { children: ReactNode }) {
  // 数据状态
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsPage, setRunsPage] = useState(0);
  
  // 样本数据状态
  const [samples, setSamples] = useState<SampleWithSeriesStatus[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [samplesTotal, setSamplesTotal] = useState(0);
  const [samplesPage, setSamplesPage] = useState(0);
  
  // 展开状态
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const [runSamples, setRunSamplesState] = useState<Record<number, Sample[]>>({});
  const [runSamplesLoading, setRunSamplesLoadingState] = useState<Set<number>>(new Set());
  
  // 选中状态
  const [selectedRunIds, setSelectedRunIds] = useState<Set<number>>(new Set());
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set());
  // 跨页选中样本缓存：当样本被选中时缓存其数据，取消时移除
  const [selectedSamplesCache, setSelectedSamplesCache] = useState<Map<number, SampleWithSeriesStatus>>(new Map());
  
  // 当前页样本变化时，将已选中的样本数据同步到缓存
  useEffect(() => {
    if (samples.length === 0) return;
    setSelectedSamplesCache(prev => {
      let changed = false;
      const next = new Map(prev);
      // 添加当前页中已选中的样本到缓存
      for (const s of samples) {
        if (selectedSampleIds.has(s.id) && !next.has(s.id)) {
          next.set(s.id, s);
          changed = true;
        }
      }
      // 移除已不在选中集中的缓存
      for (const id of next.keys()) {
        if (!selectedSampleIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [samples, selectedSampleIds]);

  // 所有选中样本（缓存中的 + 当前页中新选的）
  const allSelectedSamples = useMemo(() => {
    const map = new Map(selectedSamplesCache);
    // 确保当前页中已选中的样本也在结果中
    for (const s of samples) {
      if (selectedSampleIds.has(s.id)) {
        map.set(s.id, s);
      }
    }
    return Array.from(map.values());
  }, [selectedSamplesCache, samples, selectedSampleIds]);

  // 方案C: 自动获取缺失样本缓存
  const fetchingMissingRef = useRef(false);
  useEffect(() => {
    if (fetchingMissingRef.current) return;
    const currentPageIds = new Set(samples.map(s => s.id));
    const missingIds = Array.from(selectedSampleIds).filter(
      id => !selectedSamplesCache.has(id) && !currentPageIds.has(id)
    );
    if (missingIds.length === 0) return;

    fetchingMissingRef.current = true;
    // 分批获取，每批最多 200 个
    const BATCH = 200;
    const batches: number[][] = [];
    for (let i = 0; i < missingIds.length; i += BATCH) {
      batches.push(missingIds.slice(i, i + BATCH));
    }

    (async () => {
      try {
        for (const batch of batches) {
          const resp = await fetch(`/api/samples?action=byIds&ids=${batch.join(",")}`);
          const data = await resp.json();
          if (data.samples && data.samples.length > 0) {
            setSelectedSamplesCache(prev => {
              const next = new Map(prev);
              for (const s of data.samples) {
                // 只添加仍在选中集中的样本
                if (selectedSampleIds.has(s.id)) {
                  next.set(s.id, { ...s, seriesStatus: null, runCreatedAt: null, anomalyFlags: detectAnomalies(s) } as SampleWithSeriesStatus);
                }
              }
              return next;
            });
          }
        }
      } catch (e) {
        console.error("Failed to fetch missing selected samples:", e);
      } finally {
        fetchingMissingRef.current = false;
      }
    })();
  }, [selectedSampleIds, selectedSamplesCache, samples]);

  // 对比模式
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonItems, setComparisonItems] = useState<ComparisonItem[]>([]);
  
  // 筛选
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  
  // 悬停联动
  const [hoveredSampleId, setHoveredSampleId] = useState<number | null>(null);
  
  // 对齐序列使用配置
  const [seriesConfig, setSeriesConfigState] = useState<AlignedSeriesConfig>({ method: "pchip", nSamples: 50 });
  const setSeriesConfig = useCallback((partial: Partial<AlignedSeriesConfig>) => {
    setSeriesConfigState(prev => ({ ...prev, ...partial }));
  }, []);
  
  // 可用选项
  const [availableRuns, setAvailableRuns] = useState<{ id: number; sampleCount: number }[]>([]);
  const [availableLiquids, setAvailableLiquids] = useState<{ id: string; name: string }[]>([]);
  const [availablePhases, setAvailablePhases] = useState<string[]>([]);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  
  // ML 标签共享状态
  const [mlLabelConfig, setMlLabelConfig] = useState<string>("");
  const [mlSplitRatios, setMlSplitRatiosState] = useState({ train: 70, val: 15 });
  const setMlSplitRatios = useCallback((ratios: { train: number; val: number }) => {
    setMlSplitRatiosState(ratios);
  }, []);
  
  // 切换运行展开
  const toggleRunExpand = useCallback((runId: number) => {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);
  
  // 设置运行的样本
  const setRunSamples = useCallback((runId: number, samples: Sample[]) => {
    setRunSamplesState(prev => ({ ...prev, [runId]: samples }));
  }, []);
  
  // 设置样本加载状态
  const setRunSamplesLoading = useCallback((runId: number, loading: boolean) => {
    setRunSamplesLoadingState(prev => {
      const next = new Set(prev);
      if (loading) {
        next.add(runId);
      } else {
        next.delete(runId);
      }
      return next;
    });
  }, []);
  
  // 切换运行选中
  const toggleRunSelection = useCallback((runId: number) => {
    setSelectedRunIds(prev => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);
  
  // 切换样本选中
  const toggleSampleSelection = useCallback((sampleId: number) => {
    setSelectedSampleIds(prev => {
      const next = new Set(prev);
      if (next.has(sampleId)) {
        next.delete(sampleId);
        setSelectedSamplesCache(c => { const m = new Map(c); m.delete(sampleId); return m; });
      } else {
        next.add(sampleId);
      }
      return next;
    });
  }, []);
  
  // 全选样本（并集：将当前页样本添加到已有选择）
  const selectAllSamples = useCallback(() => {
    setSelectedSampleIds(prev => {
      const next = new Set(prev);
      samples.forEach(s => next.add(s.id));
      return next;
    });
  }, [samples]);
  
  // 清除样本选中
  const clearSampleSelection = useCallback(() => {
    setSelectedSampleIds(new Set());
    setSelectedSamplesCache(new Map());
  }, []);
  
  // 批量添加样本到选择
  const addSamplesToSelection = useCallback((sampleIds: number[]) => {
    setSelectedSampleIds(prev => {
      const next = new Set(prev);
      sampleIds.forEach(id => next.add(id));
      return next;
    });
  }, []);
  
  // 批量移除样本从选择
  const removeSamplesFromSelection = useCallback((sampleIds: number[]) => {
    setSelectedSampleIds(prev => {
      const next = new Set(prev);
      sampleIds.forEach(id => next.delete(id));
      return next;
    });
    setSelectedSamplesCache(prev => {
      const next = new Map(prev);
      sampleIds.forEach(id => next.delete(id));
      return next;
    });
  }, []);
  
  // @deprecated 全选运行
  const selectAllRuns = useCallback(() => {
    setSelectedRunIds(new Set(runs.map(r => r.id)));
  }, [runs]);
  
  // @deprecated 清除运行选中
  const clearRunSelection = useCallback(() => {
    setSelectedRunIds(new Set());
  }, []);
  
  // 切换对比模式
  const toggleComparisonMode = useCallback(() => {
    setComparisonMode(prev => !prev);
  }, []);
  
  // 添加到对比
  const addToComparison = useCallback((item: ComparisonItem) => {
    setComparisonItems(prev => {
      const exists = prev.some(i => i.type === item.type && i.id === item.id);
      if (exists) return prev;
      return [...prev, item];
    });
  }, []);
  
  // 从对比移除
  const removeFromComparison = useCallback((item: ComparisonItem) => {
    setComparisonItems(prev => prev.filter(i => !(i.type === item.type && i.id === item.id)));
  }, []);
  
  // 清空对比
  const clearComparison = useCallback(() => {
    setComparisonItems([]);
  }, []);
  
  // 更新筛选
  const updateFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setRunsPage(0);
    setSamplesPage(0); // 筛选变更 → 回到第一页
    setSelectedSampleIds(new Set()); // 筛选变更 → 清除选择
    setSelectedSamplesCache(new Map());
  }, []);
  
  // 清空筛选
  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
    setRunsPage(0);
    setSamplesPage(0);
    setSelectedSampleIds(new Set());
    setSelectedSamplesCache(new Map());
  }, []);

  // 刷新选中样本的对齐序列状态
  const refreshSeriesStatuses = useCallback(async () => {
    const selectedIds = Array.from(selectedSampleIds);
    if (selectedIds.length === 0) return;
    try {
      const response = await fetch(
        `/api/analytics/sample-aligned-series?sampleIds=${selectedIds.join(",")}`
      );
      const data = await response.json();
      if (data.statuses) {
        setSamples(prev => prev.map((sample) => {
          if (selectedSampleIds.has(sample.id) && data.statuses[sample.id]) {
            return {
              ...sample,
              seriesStatus: {
                hasAlignedSeries: data.statuses[sample.id].exists || false,
                cached: data.statuses[sample.id].cached || false,
                variants: data.statuses[sample.id].variants || [],
              },
            };
          }
          return sample;
        }));
      }
    } catch {
      // ignore
    }
  }, [selectedSampleIds]);
  
  const value: ExperimentsState = {
    runs,
    runsLoading,
    runsTotal,
    runsPage,
    samples,
    samplesLoading,
    samplesTotal,
    samplesPage,
    expandedRuns,
    runSamples,
    runSamplesLoading,
    selectedRunIds,
    selectedSampleIds,
    allSelectedSamples,
    comparisonMode,
    comparisonItems,
    filters,
    seriesConfig,
    setSeriesConfig,
    mlLabelConfig,
    setMlLabelConfig,
    mlSplitRatios,
    setMlSplitRatios,
    availableRuns,
    availableLiquids,
    availablePhases,
    filterOptionsLoading,
    setRuns,
    setRunsLoading,
    setRunsTotal,
    setRunsPage,
    setSamples,
    setSamplesLoading,
    setSamplesTotal,
    setSamplesPage,
    toggleRunExpand,
    setRunSamples,
    setRunSamplesLoading,
    toggleRunSelection,
    toggleSampleSelection,
    selectAllSamples,
    clearSampleSelection,
    addSamplesToSelection,
    removeSamplesFromSelection,
    selectAllRuns,
    clearRunSelection,
    toggleComparisonMode,
    addToComparison,
    removeFromComparison,
    clearComparison,
    updateFilters,
    clearFilters,
    setAvailableRuns,
    setAvailableLiquids,
    setAvailablePhases,
    setFilterOptionsLoading,
    refreshSeriesStatuses,
    hoveredSampleId,
    setHoveredSampleId,
  };
  
  return (
    <ExperimentsContext.Provider value={value}>
      {children}
    </ExperimentsContext.Provider>
  );
}

export function useExperiments() {
  const context = useContext(ExperimentsContext);
  if (!context) {
    throw new Error("useExperiments must be used within ExperimentsProvider");
  }
  return context;
}
