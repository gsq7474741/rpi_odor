"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
  preWashCount: number;
  phaseName: string;
  avgTemperatureC: number | null;
  avgHumidityPct: number | null;
  avgPressureHpa: number | null;
  durationS: number | null;
  phaseTransitions: PhaseTransition[];
  readingCount: number;
}

// 数据帧状态
export interface FrameStatus {
  hasFrames: boolean;
  cached: boolean;
  variants: {
    method: string;
    nSamples: number;
  }[];
}

// 数据帧使用配置（选择使用哪个变体）
export interface FrameConfig {
  method: "linear" | "pchip";
  nSamples: number;
}

// 带数据帧状态的样本
export interface SampleWithFrameStatus extends Sample {
  frameStatus: FrameStatus | null;
  runCreatedAt: string | null;  // Run 创建时间，用于显示来源
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
  timeRange: [Date, Date] | null;
  pwmRange: [number, number] | null;
  paramsHash: string | null;
  searchQuery: string;
  hasFrames: boolean | null;  // 按数据帧状态筛选
}

// 上下文状态
export interface ExperimentsState {
  // 数据 - Runs (仅用于筛选选项)
  runs: Run[];
  runsLoading: boolean;
  runsTotal: number;
  runsPage: number;
  
  // 数据 - Samples (核心数据)
  samples: SampleWithFrameStatus[];
  samplesLoading: boolean;
  samplesTotal: number;
  samplesPage: number;
  
  // 旧版兼容 - 展开的运行及其样本 (TODO: 待移除)
  expandedRuns: Set<number>;
  runSamples: Record<number, Sample[]>;
  runSamplesLoading: Set<number>;
  
  // 选中项 - 唯一选择实体是样本
  selectedSampleIds: Set<number>;
  // @deprecated 待移除，保留用于兼容
  selectedRunIds: Set<number>;
  
  // 对比模式
  comparisonMode: boolean;
  comparisonItems: ComparisonItem[];
  
  // 筛选
  filters: FilterState;
  
  // 数据帧使用配置
  frameConfig: FrameConfig;
  setFrameConfig: (config: Partial<FrameConfig>) => void;
  
  // ML 标签配置（TrainingTab 写入，ExportPopover 读取）
  mlLabelConfig: string;
  setMlLabelConfig: (config: string) => void;
  mlSplitRatios: { train: number; val: number };
  setMlSplitRatios: (ratios: { train: number; val: number }) => void;
  
  // 可用的筛选选项
  availableLiquids: { id: string; name: string }[];
  availablePhases: string[];
  
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
  // @deprecated
  selectAllRuns: () => void;
  clearRunSelection: () => void;
  
  // 样本数据操作
  setSamples: (samples: SampleWithFrameStatus[]) => void;
  setSamplesLoading: (loading: boolean) => void;
  setSamplesTotal: (total: number) => void;
  setSamplesPage: (page: number) => void;
  
  toggleComparisonMode: () => void;
  addToComparison: (item: ComparisonItem) => void;
  removeFromComparison: (item: ComparisonItem) => void;
  clearComparison: () => void;
  
  updateFilters: (filters: Partial<FilterState>) => void;
  clearFilters: () => void;
  
  setAvailableLiquids: (liquids: { id: string; name: string }[]) => void;
  setAvailablePhases: (phases: string[]) => void;
  
  // 刷新选中样本的帧状态
  refreshFrameStatuses: () => Promise<void>;
}

const defaultFilters: FilterState = {
  runIds: [],
  phaseNames: [],
  liquidIds: [],
  timeRange: null,
  pwmRange: null,
  paramsHash: null,
  searchQuery: "",
  hasFrames: null,
};

const ExperimentsContext = createContext<ExperimentsState | null>(null);

export function ExperimentsProvider({ children }: { children: ReactNode }) {
  // 数据状态
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsPage, setRunsPage] = useState(0);
  
  // 样本数据状态
  const [samples, setSamples] = useState<SampleWithFrameStatus[]>([]);
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
  
  // 对比模式
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonItems, setComparisonItems] = useState<ComparisonItem[]>([]);
  
  // 筛选
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  
  // 数据帧使用配置
  const [frameConfig, setFrameConfigState] = useState<FrameConfig>({ method: "linear", nSamples: 100 });
  const setFrameConfig = useCallback((partial: Partial<FrameConfig>) => {
    setFrameConfigState(prev => ({ ...prev, ...partial }));
  }, []);
  
  // 可用选项
  const [availableLiquids, setAvailableLiquids] = useState<{ id: string; name: string }[]>([]);
  const [availablePhases, setAvailablePhases] = useState<string[]>([]);
  
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
      } else {
        next.add(sampleId);
      }
      return next;
    });
  }, []);
  
  // 全选样本
  const selectAllSamples = useCallback(() => {
    setSelectedSampleIds(new Set(samples.map(s => s.id)));
  }, [samples]);
  
  // 清除样本选中
  const clearSampleSelection = useCallback(() => {
    setSelectedSampleIds(new Set());
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
    setRunsPage(0); // 重置分页
  }, []);
  
  // 清空筛选
  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
    setRunsPage(0);
  }, []);

  // 刷新选中样本的帧状态
  const refreshFrameStatuses = useCallback(async () => {
    const selectedIds = Array.from(selectedSampleIds);
    if (selectedIds.length === 0) return;
    try {
      const response = await fetch(
        `/api/analytics/sample-frames?sampleIds=${selectedIds.join(",")}`
      );
      const data = await response.json();
      if (data.statuses) {
        setSamples(prev => prev.map((sample) => {
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
    comparisonMode,
    comparisonItems,
    filters,
    frameConfig,
    setFrameConfig,
    mlLabelConfig,
    setMlLabelConfig,
    mlSplitRatios,
    setMlSplitRatios,
    availableLiquids,
    availablePhases,
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
    selectAllRuns,
    clearRunSelection,
    toggleComparisonMode,
    addToComparison,
    removeFromComparison,
    clearComparison,
    updateFilters,
    clearFilters,
    setAvailableLiquids,
    setAvailablePhases,
    refreshFrameStatuses,
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
