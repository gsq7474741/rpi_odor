"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ChevronDown, 
  ChevronRight, 
  Filter, 
  RefreshCw, 
  Beaker,
  Clock,
  Hash,
  Layers
} from "lucide-react";

// 样本接口
export interface Sample {
  id: number;
  runId: number;
  sampleIdx: number;
  startTimeMs: number;
  endTimeMs?: number;
  paramsHash: string;
  liquids: {
    id: string;
    name: string;
    ratio: number;
    pumpIndex: number;
  }[];
  totalVolumeMl?: number;
  flowRateMlS?: number;
  gasPumpPwm: number;
  terminationType?: string;
  terminationValue?: number;
  maxDurationS?: number;
  preWashCount: number;
  phaseName?: string;
  avgTemperatureC?: number;
  avgHumidityPct?: number;
  createdAt?: string;
}

// 样本组接口
export interface SampleGroup {
  paramsHash: string;
  liquids: { id: string; name: string; ratio: number }[];
  gasPumpPwm: number;
  phaseName?: string;
  sampleCount: number;
  runIds: number[];
  firstCreated?: string;
  lastCreated?: string;
}

interface SampleSelectorProps {
  onSelectionChange?: (selectedIds: number[], selectedHashes: string[]) => void;
  mode?: "samples" | "groups";
  maxSelection?: number;
}

export function SampleSelector({
  onSelectionChange,
  mode = "groups",
  maxSelection = 100,
}: SampleSelectorProps) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [groups, setGroups] = useState<SampleGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 过滤器状态
  const [phaseFilter, setPhaseFilter] = useState<string>("");
  const [liquidFilter, setLiquidFilter] = useState<string>("");
  const [runIdFilter, setRunIdFilter] = useState<string>("");

  // 选择状态
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set());
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());

  // 展开状态
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (phaseFilter) params.set("phase", phaseFilter);
      if (liquidFilter) params.set("liquid", liquidFilter);
      if (runIdFilter) params.set("runId", runIdFilter);
      params.set("limit", "200");

      if (mode === "groups") {
        const res = await fetch(`/api/samples/groups?${params}`);
        if (!res.ok) throw new Error("加载样本组失败");
        const data = await res.json();
        setGroups(data.groups || []);
      } else {
        const res = await fetch(`/api/samples?${params}`);
        if (!res.ok) throw new Error("加载样本失败");
        const data = await res.json();
        setSamples(data.samples || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [mode, phaseFilter, liquidFilter, runIdFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 通知选择变化
  useEffect(() => {
    onSelectionChange?.(
      Array.from(selectedSampleIds),
      Array.from(selectedHashes)
    );
  }, [selectedSampleIds, selectedHashes, onSelectionChange]);

  // 切换样本选择
  const toggleSample = (id: number) => {
    setSelectedSampleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < maxSelection) {
        next.add(id);
      }
      return next;
    });
  };

  // 切换组选择
  const toggleGroup = (hash: string) => {
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  };

  // 切换组展开
  const toggleExpand = (hash: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  };

  // 格式化液体显示
  const formatLiquids = (liquids: { name: string; ratio: number }[]) => {
    if (!liquids || liquids.length === 0) return "(无)";
    return liquids.map((l) => `${l.name} ${(l.ratio * 100).toFixed(0)}%`).join(" + ");
  };

  // 格式化时间
  const formatDuration = (startMs: number, endMs?: number) => {
    if (!endMs) return "进行中";
    const durationS = (endMs - startMs) / 1000;
    if (durationS < 60) return `${durationS.toFixed(1)}s`;
    return `${(durationS / 60).toFixed(1)}min`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5" />
              样本选择器
            </CardTitle>
            <CardDescription>
              {mode === "groups" ? "按参数组聚合" : "单个样本"}
              {selectedHashes.size > 0 && ` · 已选 ${selectedHashes.size} 组`}
              {selectedSampleIds.size > 0 && ` · 已选 ${selectedSampleIds.size} 个`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 过滤器 */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={phaseFilter} onValueChange={setPhaseFilter}>
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue placeholder="阶段" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部阶段</SelectItem>
                <SelectItem value="BASELINE">BASELINE</SelectItem>
                <SelectItem value="SAMPLE">SAMPLE</SelectItem>
                <SelectItem value="PURGE">PURGE</SelectItem>
                <SelectItem value="RECOVERY">RECOVERY</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Input
            placeholder="液体名称"
            value={liquidFilter}
            onChange={(e) => setLiquidFilter(e.target.value)}
            className="w-[140px] h-8"
          />

          <Input
            placeholder="Run ID"
            value={runIdFilter}
            onChange={(e) => setRunIdFilter(e.target.value)}
            className="w-[100px] h-8"
          />
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        {/* 样本组列表 */}
        {mode === "groups" && (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {groups.map((group) => (
                <Collapsible
                  key={group.paramsHash}
                  open={expandedGroups.has(group.paramsHash)}
                >
                  <div
                    className={`border rounded-lg p-3 ${
                      selectedHashes.has(group.paramsHash)
                        ? "border-primary bg-primary/5"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedHashes.has(group.paramsHash)}
                        onCheckedChange={() => toggleGroup(group.paramsHash)}
                      />

                      <CollapsibleTrigger
                        onClick={() => toggleExpand(group.paramsHash)}
                        className="flex-1"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            {expandedGroups.has(group.paramsHash) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            <Beaker className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">
                              {formatLiquids(group.liquids)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {group.phaseName && (
                              <Badge variant="outline">{group.phaseName}</Badge>
                            )}
                            <Badge variant="secondary">
                              {group.sampleCount} 样本
                            </Badge>
                            <Badge variant="outline">
                              {group.runIds.length} runs
                            </Badge>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                    </div>

                    <CollapsibleContent className="mt-3 pt-3 border-t">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Hash className="h-3 w-3" />
                          <span>哈希: {group.paramsHash.slice(0, 8)}...</span>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>气泵: {group.gasPumpPwm}%</span>
                        </div>
                      </div>
                      {group.runIds.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Run IDs: {group.runIds.slice(0, 5).join(", ")}
                          {group.runIds.length > 5 && ` +${group.runIds.length - 5}`}
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}

              {groups.length === 0 && !loading && (
                <div className="text-center text-muted-foreground py-8">
                  暂无样本数据
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* 单个样本列表 */}
        {mode === "samples" && (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>液体</TableHead>
                  <TableHead>阶段</TableHead>
                  <TableHead>时长</TableHead>
                  <TableHead>Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {samples.map((sample) => (
                  <TableRow
                    key={sample.id}
                    className={
                      selectedSampleIds.has(sample.id) ? "bg-primary/5" : ""
                    }
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedSampleIds.has(sample.id)}
                        onCheckedChange={() => toggleSample(sample.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono">{sample.id}</TableCell>
                    <TableCell>{formatLiquids(sample.liquids)}</TableCell>
                    <TableCell>
                      {sample.phaseName && (
                        <Badge variant="outline">{sample.phaseName}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDuration(sample.startTimeMs, sample.endTimeMs)}
                    </TableCell>
                    <TableCell>{sample.runId}</TableCell>
                  </TableRow>
                ))}

                {samples.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      暂无样本数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
