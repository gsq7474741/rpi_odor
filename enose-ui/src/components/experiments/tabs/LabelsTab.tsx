"use client";

import { useState, useEffect, useCallback } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Plus, Trash2, RefreshCw, Tag, Calendar, Loader2 } from "lucide-react";

interface LabeledRange {
  id: string;
  labelId: string;
  experimentId?: string;
  startTime: string;
  endTime: string;
  phase?: string;
}

interface SampleLabel {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  ranges: LabeledRange[];
}

export function LabelsTab() {
  const { selectedRunIds } = useExperiments();

  const [labels, setLabels] = useState<SampleLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState({ name: "", description: "" });

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics/labels");
      if (response.ok) {
        const data = await response.json();
        setLabels(data.labels || []);
      }
    } catch (error) {
      console.error("Failed to fetch labels:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  const handleCreate = async () => {
    if (!newLabel.name) return;

    try {
      const response = await fetch("/api/analytics/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLabel),
      });

      if (response.ok) {
        setNewLabel({ name: "", description: "" });
        setCreateDialogOpen(false);
        fetchLabels();
      }
    } catch (error) {
      console.error("Failed to create label:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个标签吗？关联的标注范围也会被删除。")) return;

    try {
      const response = await fetch(`/api/analytics/labels/${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchLabels();
      }
    } catch (error) {
      console.error("Failed to delete label:", error);
    }
  };

  const getTotalRanges = (label: SampleLabel) => {
    return label.ranges.length;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "-";
    }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">样品标注</h2>
          <p className="text-sm text-muted-foreground">
            为传感器数据添加标签，用于模型训练
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchLabels} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            刷新
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                创建标签
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>创建新标签</DialogTitle>
                <DialogDescription>
                  创建一个新的样品标签，用于标注传感器数据
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">标签名称</Label>
                  <Input
                    id="name"
                    value={newLabel.name}
                    onChange={(e) =>
                      setNewLabel({ ...newLabel, name: e.target.value })
                    }
                    placeholder="例如：苹果汁、橙汁"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">描述（可选）</Label>
                  <Textarea
                    id="description"
                    value={newLabel.description}
                    onChange={(e) =>
                      setNewLabel({ ...newLabel, description: e.target.value })
                    }
                    placeholder="标签的详细描述..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  取消
                </Button>
                <Button onClick={handleCreate} disabled={!newLabel.name}>
                  创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 选中运行提示 */}
      {selectedRunIds.size > 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span>
                已选择 {selectedRunIds.size} 个运行，可为其数据添加标注
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 标签列表 */}
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">标签列表</CardTitle>
          <CardDescription>
            共 {labels.length} 个标签
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-350px)]">
            {loading && labels.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : labels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无标签</p>
                <p className="text-sm">点击"创建标签"添加新标签</p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {labels.map((label) => (
                  <AccordionItem key={label.id} value={label.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 flex-1">
                        <Tag className="h-4 w-4" />
                        <span className="font-medium">{label.name}</span>
                        <Badge variant="secondary" className="ml-2">
                          {getTotalRanges(label)} 个范围
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {label.description && (
                          <p className="text-sm text-muted-foreground">
                            {label.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          创建于 {formatDate(label.createdAt)}
                        </div>

                        {label.ranges.length > 0 && (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>运行 ID</TableHead>
                                <TableHead>阶段</TableHead>
                                <TableHead>开始时间</TableHead>
                                <TableHead>结束时间</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {label.ranges.slice(0, 5).map((range) => (
                                <TableRow key={range.id}>
                                  <TableCell>
                                    {range.experimentId || "-"}
                                  </TableCell>
                                  <TableCell>{range.phase || "-"}</TableCell>
                                  <TableCell>
                                    {formatDate(range.startTime)}
                                  </TableCell>
                                  <TableCell>
                                    {formatDate(range.endTime)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}

                        {label.ranges.length > 5 && (
                          <p className="text-xs text-muted-foreground text-center">
                            还有 {label.ranges.length - 5} 个范围...
                          </p>
                        )}

                        <div className="flex justify-end">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(label.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            删除标签
                          </Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
