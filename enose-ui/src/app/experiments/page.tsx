"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ExperimentsProvider,
  useExperiments,
  FilterBar,
  SampleTable,
  SelectionBar,
  OverviewTab,
  TimeSeriesTab,
  ProjectorTab,
  CompareTab,
  LabelsTab,
} from "@/components/experiments";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  LayoutDashboard,
  LineChart,
  ScatterChart,
  GitCompare,
  Tags,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAnalyticsLatency } from "@/hooks/use-analytics-latency";

// Isolated latency indicator - state changes here don't re-render the rest of the page
function LatencyIndicator() {
  const { rtt, connected } = useAnalyticsLatency();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {connected ? (
        <Wifi className="h-4 w-4 text-green-500" />
      ) : (
        <WifiOff className="h-4 w-4 text-red-500" />
      )}
      <span>{rtt && rtt > 0 ? `${rtt}ms` : "-"}</span>
    </div>
  );
}

function ExperimentsContent() {
  const {
    runs,
    runsLoading,
    runsPage,
    setRuns,
    setRunsLoading,
    setRunsTotal,
    filters,
    setAvailableLiquids,
    setAvailablePhases,
  } = useExperiments();

  const [activeTab, setActiveTab] = useState("overview");
  const pageSize = 20;

  // 加载运行列表
  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("action", "experiments");
      params.set("limit", pageSize.toString());
      params.set("offset", (runsPage * pageSize).toString());

      const response = await fetch(`/api/analytics/data?${params}`);
      const data = await response.json();

      if (data.success) {
        const runsData = data.experiments.map((exp: {
          experimentId: string;
          startTime: string | null;
          endTime: string | null;
          frameCount: number;
          sampleCount: number;
          status: string;
        }) => ({
          id: parseInt(exp.experimentId) || 0,
          createdAt: exp.startTime,
          completedAt: exp.endTime,
          state: exp.status,
          configJson: {},
          sampleCount: exp.sampleCount,
        }));
        setRuns(runsData);
        setRunsTotal(data.total);
      }
    } catch (error) {
      console.error("Failed to fetch runs:", error);
    } finally {
      setRunsLoading(false);
    }
  }, [runsPage, setRuns, setRunsLoading, setRunsTotal]);

  // 加载可用的液体和阶段选项
  const fetchFilterOptions = useCallback(async () => {
    try {
      // 获取液体列表
      const liquidRes = await fetch("/api/consumables?type=liquids");
      const liquidData = await liquidRes.json();
      if (liquidData.liquids) {
        setAvailableLiquids(
          liquidData.liquids.map((l: { id: number; name: string }) => ({
            id: String(l.id),
            name: l.name,
          }))
        );
      }

      // 获取阶段列表 (硬编码常用阶段)
      setAvailablePhases([
        "BASELINE",
        "DOSE",
        "EQUILIBRATION",
        "SAMPLE",
        "PURGE",
        "RECOVERY",
        "RINSE",
      ]);
    } catch (error) {
      console.error("Failed to fetch filter options:", error);
    }
  }, [setAvailableLiquids, setAvailablePhases]);

  // 初始化加载
  useEffect(() => {
    fetchRuns();
    fetchFilterOptions();
  }, [fetchRuns, fetchFilterOptions]);

  // 筛选变化时重新加载
  useEffect(() => {
    fetchRuns();
  }, [filters, fetchRuns]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">实验中心</h1>
          <LatencyIndicator />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRuns}
            disabled={runsLoading}
          >
            <RefreshCw className={`h-4 w-4 ${runsLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <FilterBar />

      {/* 主内容区 */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* 主内容区：可调整的左右面板 */}
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            {/* 左侧边栏 - 选择栏 + 样本列表 */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
              <div className="h-full border-r flex flex-col overflow-hidden">
                {/* 选择栏 - 与样本列表同宽 */}
                <SelectionBar />
                {/* 样本列表 */}
                <div className="flex-1 overflow-hidden">
                  <SampleTable />
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* 右侧主内容 */}
            <ResizablePanel defaultSize={75}>
              <div className="h-full flex flex-col overflow-hidden">
                {/* Tab 列表 */}
                <div className="border-b px-4 flex items-center gap-0 h-10">
                  {[
                    { value: "overview", label: "概览", icon: LayoutDashboard },
                    { value: "timeseries", label: "时序图", icon: LineChart },
                    { value: "projector", label: "降维分析", icon: ScatterChart },
                    { value: "compare", label: "参数对比", icon: GitCompare },
                    { value: "labels", label: "标注", icon: Tags },
                  ].map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setActiveTab(value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 h-full px-3 text-xs transition-colors border-b-2",
                        activeTab === value
                          ? "border-primary text-foreground font-semibold [&_svg]:stroke-[2.5]"
                          : "border-transparent text-muted-foreground font-medium hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
                {/* Tab 内容 */}
                <div className="flex-1 overflow-hidden">
                  <TabsContent value="overview" className="h-full m-0">
                  <OverviewTab />
                </TabsContent>

                <TabsContent value="timeseries" className="h-full m-0">
                  <TimeSeriesTab />
                </TabsContent>

                <TabsContent value="projector" className="h-full m-0">
                  <ProjectorTab />
                </TabsContent>

                <TabsContent value="compare" className="h-full m-0">
                  <CompareTab />
                </TabsContent>

                <TabsContent value="labels" className="h-full m-0">
                  <LabelsTab />
                </TabsContent>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </Tabs>
    </div>
  );
}

export default function ExperimentsPage() {
  return (
    <ExperimentsProvider>
      <ExperimentsContent />
    </ExperimentsProvider>
  );
}
