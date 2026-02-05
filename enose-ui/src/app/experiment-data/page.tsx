"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsLatency } from "@/hooks/use-analytics-latency";
import { 
  Database, 
  FlaskConical, 
  BarChart3, 
  Table as TableIcon,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Wifi,
  WifiOff,
  Eye,
  LineChart,
  Beaker,
  Layers,
  Loader2,
} from "lucide-react";
import Link from "next/link";

// 运行记录 (一次实验执行)
interface Run {
  id: number;
  createdAt: string | null;
  completedAt: string | null;
  state: string;
  configJson: Record<string, unknown>;
  sampleCount: number;
}

// 样本记录 (一次采集)
interface Sample {
  id: number;
  runId: number;
  sampleIdx: number;
  startTimeMs: number;
  endTimeMs: number | null;
  paramsHash: string;
  liquidNames: string[];
  liquidRatios: number[];
  totalVolumeMl: number;
  gasPumpPwm: number;
  phaseName: string;
  durationS: number | null;
}

// 样本组 (相同参数的样本聚合)
interface SampleGroup {
  paramsHash: string;
  liquidNames: string[];
  gasPumpPwm: number;
  phaseName: string;
  sampleCount: number;
  runIds: number[];
  firstCreated: string | null;
  lastCreated: string | null;
}

// 保留原有的 Experiment 接口用于兼容旧的聚合查询
interface Experiment {
  experimentId: string;
  startTime: string | null;
  endTime: string | null;
  frameCount: number;
  phases: string[];
  labels: string[];
  status: string;
}

interface SensorDataRow {
  ts: string | null;
  seq: number;
  experimentId: string;
  phase: string;
  moxReadings: number[];
  temperature: number;
  humidity: number;
  heaterStep: number;
  label: string;
}

interface AggregatedGroup {
  key: string;
  label: string;
  sampleCount: number;
  sensorStats: {
    sensorIdx: number;
    min: number;
    max: number;
    mean: number;
    std: number;
    median: number;
  }[];
  avgTemperature: number;
  avgHumidity: number;
  startTime: string | null;
  endTime: string | null;
}

export default function ExperimentDataPage() {
  const [activeTab, setActiveTab] = useState("runs");
  const { rtt, connected } = useAnalyticsLatency();

  // Runs state (运行列表)
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsPage, setRunsPage] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  
  // 展开的运行及其样本
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const [runSamples, setRunSamples] = useState<Record<number, Sample[]>>({});
  const [runSamplesLoading, setRunSamplesLoading] = useState<Set<number>>(new Set());

  // Samples state (样本列表)
  const [samples, setSamples] = useState<Sample[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [samplesTotal, setSamplesTotal] = useState(0);
  const [samplesPage, setSamplesPage] = useState(0);

  // Sample groups state (样本组)
  const [sampleGroups, setSampleGroups] = useState<SampleGroup[]>([]);
  const [sampleGroupsLoading, setSampleGroupsLoading] = useState(false);

  // Raw data state (原始数据)
  const [sensorData, setSensorData] = useState<SensorDataRow[]>([]);
  const [sensorDataLoading, setSensorDataLoading] = useState(false);
  const [sensorDataTotal, setSensorDataTotal] = useState(0);
  const [sensorDataPage, setSensorDataPage] = useState(0);
  const [downsampleFactor, setDownsampleFactor] = useState(1);

  // 兼容旧的 experiments 状态用于其他 API
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(null);

  const pageSize = 20;

  // Fetch runs (运行列表)
  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const response = await fetch(
        `/api/analytics/data?action=experiments&limit=${pageSize}&offset=${runsPage * pageSize}`
      );
      const data = await response.json();
      if (data.success) {
        // 将 experiments 格式转换为 runs 格式
        const runsData: Run[] = data.experiments.map((exp: Experiment) => ({
          id: parseInt(exp.experimentId) || 0,
          createdAt: exp.startTime,
          completedAt: exp.endTime,
          state: exp.status,
          configJson: {},
          sampleCount: exp.frameCount,
        }));
        setRuns(runsData);
        setRunsTotal(data.total);
        // 同时保留 experiments 用于聚合查询
        setExperiments(data.experiments);
      }
    } catch (error) {
      console.error("Failed to fetch runs:", error);
    } finally {
      setRunsLoading(false);
    }
  }, [runsPage]);

  // 切换运行展开状态并加载样本
  const toggleRunExpand = useCallback(async (runId: number) => {
    const newExpanded = new Set(expandedRuns);
    
    if (newExpanded.has(runId)) {
      // 收起
      newExpanded.delete(runId);
      setExpandedRuns(newExpanded);
    } else {
      // 展开并加载样本
      newExpanded.add(runId);
      setExpandedRuns(newExpanded);
      
      // 如果还没加载过样本，加载它们
      if (!runSamples[runId]) {
        setRunSamplesLoading(prev => new Set(prev).add(runId));
        try {
          const response = await fetch(`/api/samples?runId=${runId}&limit=100`);
          const data = await response.json();
          if (data.samples) {
            setRunSamples(prev => ({ ...prev, [runId]: data.samples }));
          }
        } catch (error) {
          console.error(`Failed to fetch samples for run ${runId}:`, error);
        } finally {
          setRunSamplesLoading(prev => {
            const next = new Set(prev);
            next.delete(runId);
            return next;
          });
        }
      }
    }
  }, [expandedRuns, runSamples]);

  // Fetch samples (样本列表)
  const fetchSamples = useCallback(async () => {
    setSamplesLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRunId) params.set("runId", selectedRunId.toString());
      params.set("limit", pageSize.toString());
      params.set("offset", (samplesPage * pageSize).toString());
      
      const response = await fetch(`/api/samples?${params}`);
      const data = await response.json();
      if (data.samples) {
        setSamples(data.samples);
        setSamplesTotal(data.total || data.samples.length);
      }
    } catch (error) {
      console.error("Failed to fetch samples:", error);
    } finally {
      setSamplesLoading(false);
    }
  }, [selectedRunId, samplesPage]);

  // Fetch sample groups (样本组)
  const fetchSampleGroups = useCallback(async () => {
    setSampleGroupsLoading(true);
    try {
      const response = await fetch(`/api/samples/groups?limit=100`);
      const data = await response.json();
      if (data.groups) {
        setSampleGroups(data.groups);
      }
    } catch (error) {
      console.error("Failed to fetch sample groups:", error);
    } finally {
      setSampleGroupsLoading(false);
    }
  }, []);

  // Fetch sensor data (原始数据)
  const fetchSensorData = useCallback(async () => {
    if (!selectedRunId && !selectedExperiment) return;
    setSensorDataLoading(true);
    try {
      const expId = selectedExperiment || selectedRunId?.toString();
      const response = await fetch(
        `/api/analytics/data?action=sensor-data&experimentId=${expId}&limit=${pageSize}&offset=${sensorDataPage * pageSize}&downsample=${downsampleFactor}`
      );
      const data = await response.json();
      if (data.success) {
        setSensorData(data.rows);
        setSensorDataTotal(data.total);
      }
    } catch (error) {
      console.error("Failed to fetch sensor data:", error);
    } finally {
      setSensorDataLoading(false);
    }
  }, [selectedRunId, selectedExperiment, sensorDataPage, downsampleFactor]);


  // Effects
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (activeTab === "samples") {
      fetchSamples();
    }
  }, [activeTab, fetchSamples]);

  useEffect(() => {
    if (activeTab === "sample-groups") {
      fetchSampleGroups();
    }
  }, [activeTab, fetchSampleGroups]);

  useEffect(() => {
    if (activeTab === "raw-data" && (selectedRunId || selectedExperiment)) {
      fetchSensorData();
    }
  }, [activeTab, fetchSensorData, selectedRunId, selectedExperiment]);

  const getLatencyColor = (ms: number | null) => {
    if (ms === null) return "text-zinc-400";
    if (ms < 50) return "text-green-500";
    if (ms < 100) return "text-yellow-500";
    return "text-red-500";
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("zh-CN");
  };

  const formatNumber = (num: number | undefined, decimals = 2) => {
    if (num === undefined || isNaN(num)) return "-";
    return num.toFixed(decimals);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="w-8 h-8" />
            实验数据
          </h1>
          <p className="text-muted-foreground mt-1">
            浏览原始数据、按实验/样品查询、聚合统计与可视化
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800"
            title={`Analytics Service | RTT: ${rtt ?? "-"}ms`}
          >
            {connected ? (
              <Wifi className={`w-4 h-4 ${getLatencyColor(rtt)}`} />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className={`text-sm font-mono ${getLatencyColor(rtt)}`}>
              {rtt !== null ? `${rtt}ms` : "--"}
            </span>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="runs" className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            运行列表
          </TabsTrigger>
          <TabsTrigger value="samples" className="flex items-center gap-2">
            <Beaker className="w-4 h-4" />
            样本列表
          </TabsTrigger>
          <TabsTrigger value="sample-groups" className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            样本组
          </TabsTrigger>
          <TabsTrigger value="raw-data" className="flex items-center gap-2">
            <TableIcon className="w-4 h-4" />
            原始数据
          </TabsTrigger>
        </TabsList>

        {/* Runs Tab (运行列表) */}
        <TabsContent value="runs" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>运行列表</CardTitle>
                  <CardDescription>共 {runsTotal} 次实验运行</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchRuns}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>运行 ID</TableHead>
                        <TableHead>开始时间</TableHead>
                        <TableHead>结束时间</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>样本数</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => {
                        const isExpanded = expandedRuns.has(run.id);
                        const isLoadingSamples = runSamplesLoading.has(run.id);
                        const samples = runSamples[run.id] || [];
                        
                        return (
                          <React.Fragment key={run.id}>
                            <TableRow
                              className={`cursor-pointer hover:bg-muted/50 ${selectedRunId === run.id ? "bg-muted" : ""}`}
                              onClick={() => toggleRunExpand(run.id)}
                            >
                              <TableCell className="w-8 p-2">
                                {isLoadingSamples ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {run.id}
                              </TableCell>
                              <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                              <TableCell>{formatDateTime(run.completedAt)}</TableCell>
                              <TableCell>
                                <Badge variant={run.state === "completed" ? "default" : run.state === "error" ? "destructive" : "secondary"}>
                                  {run.state}
                                </Badge>
                              </TableCell>
                              <TableCell>{run.sampleCount}</TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedRunId(run.id);
                                      setSelectedExperiment(run.id.toString());
                                      setActiveTab("samples");
                                    }}
                                  >
                                    <Beaker className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedRunId(run.id);
                                      setSelectedExperiment(run.id.toString());
                                      setActiveTab("raw-data");
                                    }}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  <Link href={`/analytics?experimentId=${run.id}`}>
                                    <Button variant="ghost" size="sm">
                                      <LineChart className="w-4 h-4" />
                                    </Button>
                                  </Link>
                                </div>
                              </TableCell>
                            </TableRow>
                            {/* 展开的样本列表 */}
                            {isExpanded && (
                              <TableRow key={`${run.id}-samples`}>
                                <TableCell colSpan={7} className="p-0 bg-muted/30">
                                  <div className="max-h-80 overflow-y-auto border-l-4 border-primary/20 ml-4">
                                    {isLoadingSamples ? (
                                      <div className="p-4 flex items-center gap-2 text-muted-foreground">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        加载样本中...
                                      </div>
                                    ) : samples.length === 0 ? (
                                      <div className="p-4 text-muted-foreground text-sm">
                                        暂无样本数据
                                      </div>
                                    ) : (
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted/50 sticky top-0">
                                          <tr>
                                            <th className="text-left p-2 font-medium">序号</th>
                                            <th className="text-left p-2 font-medium">液体</th>
                                            <th className="text-left p-2 font-medium">体积</th>
                                            <th className="text-left p-2 font-medium">气泵 PWM</th>
                                            <th className="text-left p-2 font-medium">阶段</th>
                                            <th className="text-left p-2 font-medium">时长</th>
                                            <th className="text-left p-2 font-medium">参数哈希</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {samples.map((sample: Sample, idx: number) => (
                                            <tr key={sample.id} className={idx % 2 === 0 ? "bg-background/50" : ""}>
                                              <td className="p-2">{sample.sampleIdx}</td>
                                              <td className="p-2">
                                                {sample.liquidNames?.join(", ") || "-"}
                                              </td>
                                              <td className="p-2">{sample.totalVolumeMl?.toFixed(1) || "-"} ml</td>
                                              <td className="p-2">{sample.gasPumpPwm}</td>
                                              <td className="p-2">
                                                <Badge variant="outline" className="text-xs">
                                                  {sample.phaseName}
                                                </Badge>
                                              </td>
                                              <td className="p-2">{sample.durationS?.toFixed(1) || "-"}s</td>
                                              <td className="p-2 font-mono text-xs text-muted-foreground">
                                                {sample.paramsHash?.substring(0, 8)}...
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-muted-foreground">
                      显示 {runsPage * pageSize + 1} - {Math.min((runsPage + 1) * pageSize, runsTotal)} / {runsTotal}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={runsPage === 0}
                        onClick={() => setRunsPage((p: number) => p - 1)}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(runsPage + 1) * pageSize >= runsTotal}
                        onClick={() => setRunsPage((p: number) => p + 1)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Samples Tab (样本列表) */}
        <TabsContent value="samples" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>样本列表</CardTitle>
                  <CardDescription>
                    {selectedRunId ? `运行 ${selectedRunId} 的样本 | ` : ""}共 {samplesTotal} 个样本
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchSamples}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {samplesLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : samples.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无样本数据，请先运行实验或选择一个运行
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>样本 ID</TableHead>
                        <TableHead>运行 ID</TableHead>
                        <TableHead>液体</TableHead>
                        <TableHead>体积 (ml)</TableHead>
                        <TableHead>气泵 PWM</TableHead>
                        <TableHead>阶段</TableHead>
                        <TableHead>时长 (s)</TableHead>
                        <TableHead>参数哈希</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {samples.map((sample) => (
                        <TableRow key={sample.id}>
                          <TableCell className="font-mono text-sm">{sample.id}</TableCell>
                          <TableCell>{sample.runId}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {sample.liquidNames?.map((name, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {name}
                                </Badge>
                              )) || "-"}
                            </div>
                          </TableCell>
                          <TableCell>{sample.totalVolumeMl?.toFixed(1) || "-"}</TableCell>
                          <TableCell>{sample.gasPumpPwm}%</TableCell>
                          <TableCell>
                            <Badge variant="outline">{sample.phaseName}</Badge>
                          </TableCell>
                          <TableCell>{sample.durationS?.toFixed(1) || "-"}</TableCell>
                          <TableCell className="font-mono text-xs">{sample.paramsHash?.slice(0, 8) || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-muted-foreground">
                      显示 {samplesPage * pageSize + 1} - {Math.min((samplesPage + 1) * pageSize, samplesTotal)} / {samplesTotal}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={samplesPage === 0}
                        onClick={() => setSamplesPage((p: number) => p - 1)}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(samplesPage + 1) * pageSize >= samplesTotal}
                        onClick={() => setSamplesPage((p: number) => p + 1)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sample Groups Tab (样本组) */}
        <TabsContent value="sample-groups" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>样本组</CardTitle>
                  <CardDescription>按参数分组的样本统计，相同参数的样本会被聚合</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchSampleGroups}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sampleGroupsLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : sampleGroups.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无样本组数据
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>参数哈希</TableHead>
                      <TableHead>液体</TableHead>
                      <TableHead>气泵 PWM</TableHead>
                      <TableHead>阶段</TableHead>
                      <TableHead>样本数</TableHead>
                      <TableHead>涉及运行</TableHead>
                      <TableHead>首次创建</TableHead>
                      <TableHead>最后创建</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleGroups.map((group) => (
                      <TableRow key={group.paramsHash}>
                        <TableCell className="font-mono text-xs">{group.paramsHash?.slice(0, 8) || "-"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {group.liquidNames?.map((name, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {name}
                              </Badge>
                            )) || "-"}
                          </div>
                        </TableCell>
                        <TableCell>{group.gasPumpPwm}%</TableCell>
                        <TableCell>
                          <Badge variant="outline">{group.phaseName}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="default">{group.sampleCount}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {group.runIds?.slice(0, 3).join(", ")}
                          {group.runIds?.length > 3 && ` +${group.runIds.length - 3}`}
                        </TableCell>
                        <TableCell>{formatDateTime(group.firstCreated)}</TableCell>
                        <TableCell>{formatDateTime(group.lastCreated)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Raw Data Tab */}
        <TabsContent value="raw-data" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>原始传感器数据</CardTitle>
                  <CardDescription>
                    {selectedRunId
                      ? `运行: ${selectedRunId} | 共 ${sensorDataTotal.toLocaleString()} 条记录`
                      : "请先选择一个运行"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedRunId?.toString() || ""}
                    onValueChange={(v) => {
                      setSelectedRunId(parseInt(v));
                      setSelectedExperiment(v);
                    }}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="选择运行" />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map((run) => (
                        <SelectItem key={run.id} value={run.id.toString()}>
                          运行 {run.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(downsampleFactor)}
                    onValueChange={(v) => setDownsampleFactor(parseInt(v))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">无降采样</SelectItem>
                      <SelectItem value="10">1/10</SelectItem>
                      <SelectItem value="100">1/100</SelectItem>
                      <SelectItem value="1000">1/1000</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={fetchSensorData}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!selectedRunId ? (
                <div className="text-center py-12 text-muted-foreground">
                  请从运行列表中选择一个运行，或使用上方下拉框选择
                </div>
              ) : sensorDataLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>时间</TableHead>
                          <TableHead>阶段</TableHead>
                          <TableHead>标签</TableHead>
                          <TableHead>加热步骤</TableHead>
                          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                            <TableHead key={i} className="text-right">
                              S{i}
                            </TableHead>
                          ))}
                          <TableHead className="text-right">温度</TableHead>
                          <TableHead className="text-right">湿度</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sensorData.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs">
                              {row.ts ? new Date(row.ts).toLocaleTimeString("zh-CN") : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {row.phase || "-"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {row.label && (
                                <Badge variant="default" className="text-xs">
                                  {row.label}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-center">{row.heaterStep}</TableCell>
                            {row.moxReadings.map((val, i) => (
                              <TableCell key={i} className="text-right font-mono text-xs">
                                {formatNumber(val, 0)}
                              </TableCell>
                            ))}
                            <TableCell className="text-right">{formatNumber(row.temperature, 1)}°C</TableCell>
                            <TableCell className="text-right">{formatNumber(row.humidity, 1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-muted-foreground">
                      显示 {sensorDataPage * pageSize + 1} - {Math.min((sensorDataPage + 1) * pageSize, sensorDataTotal)} / {sensorDataTotal.toLocaleString()}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sensorDataPage === 0}
                        onClick={() => setSensorDataPage((p) => p - 1)}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(sensorDataPage + 1) * pageSize >= sensorDataTotal}
                        onClick={() => setSensorDataPage((p) => p + 1)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
