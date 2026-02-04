"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertsPanel } from "@/components/analytics/AlertsPanel";
import { VisualizationPanel } from "@/components/analytics/VisualizationPanel";
import { ModelsPanel } from "@/components/analytics/ModelsPanel";
import { LabelsPanel } from "@/components/analytics/LabelsPanel";
import { useAnalyticsLatency } from "@/hooks/use-analytics-latency";
import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function AnalyticsPage() {
  const searchParams = useSearchParams();
  const experimentId = searchParams.get("experimentId");
  const labelId = searchParams.get("labelId");
  
  const [activeTab, setActiveTab] = useState("alerts");
  const { rtt, avg, jitter, connected } = useAnalyticsLatency();

  // 如果有 experimentId 或 labelId 参数，自动切换到可视化 tab
  useEffect(() => {
    if (experimentId || labelId) {
      setActiveTab("visualization");
    }
  }, [experimentId, labelId]);

  const getLatencyColor = (ms: number | null) => {
    if (ms === null) return "text-zinc-400";
    if (ms < 50) return "text-green-500";
    if (ms < 100) return "text-yellow-500";
    if (ms < 200) return "text-orange-500";
    return "text-red-500";
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">数据分析</h1>
          <p className="text-muted-foreground mt-1">
            质量检测、模型训练、数据可视化与样品标注
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800"
          title={`Analytics Service | RTT: ${rtt ?? "-"}ms | Avg: ${avg ?? "-"}ms | Jitter: ${jitter ?? "-"}ms`}
        >
          {connected ? (
            <Wifi className={`w-4 h-4 ${getLatencyColor(rtt)}`} />
          ) : (
            <WifiOff className="w-4 h-4 text-red-500" />
          )}
          <span className={`text-sm font-mono ${getLatencyColor(rtt)}`}>
            {rtt !== null ? `${rtt}ms` : "--"}
          </span>
          <span className="text-xs text-muted-foreground ml-1">Analytics</span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="alerts">质量告警</TabsTrigger>
          <TabsTrigger value="visualization">数据可视化</TabsTrigger>
          <TabsTrigger value="models">模型管理</TabsTrigger>
          <TabsTrigger value="labels">样品标注</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-6">
          <AlertsPanel />
        </TabsContent>

        <TabsContent value="visualization" className="mt-6">
          {(experimentId || labelId) && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">筛选条件:</span>
              {experimentId && (
                <Badge variant="secondary">实验: {experimentId}</Badge>
              )}
              {labelId && (
                <Badge variant="secondary">标签: {labelId}</Badge>
              )}
            </div>
          )}
          <VisualizationPanel experimentId={experimentId} labelId={labelId} />
        </TabsContent>

        <TabsContent value="models" className="mt-6">
          <ModelsPanel />
        </TabsContent>

        <TabsContent value="labels" className="mt-6">
          <LabelsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
