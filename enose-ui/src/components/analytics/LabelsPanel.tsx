"use client";

import { useState, useEffect } from "react";
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
import { Plus, Trash2, RefreshCw, Tag, Calendar } from "lucide-react";

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

export function LabelsPanel() {
  const [labels, setLabels] = useState<SampleLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState({ name: "", description: "" });

  const fetchLabels = async () => {
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
  };

  useEffect(() => {
    fetchLabels();
  }, []);

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

  const getTotalSamples = (label: SampleLabel) => {
    return label.ranges.reduce((sum, range) => {
      const start = new Date(range.startTime).getTime();
      const end = new Date(range.endTime).getTime();
      const durationSec = (end - start) / 1000;
      return sum + Math.floor(durationSec);
    }, 0);
  };

  return (
    <div className="space-y-6">
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
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
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
                  创建样品标签用于标注传感器数据
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>标签名称</Label>
                  <Input
                    value={newLabel.name}
                    onChange={(e) =>
                      setNewLabel({ ...newLabel, name: e.target.value })
                    }
                    placeholder="如：苹果汁、橙汁、空白样"
                  />
                </div>

                <div className="space-y-2">
                  <Label>描述 (可选)</Label>
                  <Textarea
                    value={newLabel.description}
                    onChange={(e) =>
                      setNewLabel({ ...newLabel, description: e.target.value })
                    }
                    placeholder="标签的详细描述..."
                    rows={3}
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
                <Button onClick={handleCreate}>创建</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 标签列表 */}
      <Card>
        <CardHeader>
          <CardTitle>已创建标签</CardTitle>
          <CardDescription>共 {labels.length} 个标签</CardDescription>
        </CardHeader>
        <CardContent>
          {labels.length === 0 ? (
            <div className="text-center py-12">
              <Tag className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                暂无标签，点击"创建标签"开始
              </p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {labels.map((label) => (
                <AccordionItem key={label.id} value={label.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-4 flex-1">
                      <Badge variant="outline" className="font-normal">
                        <Tag className="h-3 w-3 mr-1" />
                        {label.name}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {label.ranges.length} 个标注范围 ·{" "}
                        {getTotalSamples(label)} 采样点
                      </span>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(label.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pl-4 space-y-4">
                      {label.description && (
                        <p className="text-sm text-muted-foreground">
                          {label.description}
                        </p>
                      )}

                      <div className="text-sm text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        创建于 {new Date(label.createdAt).toLocaleString()}
                      </div>

                      {label.ranges.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>实验 ID</TableHead>
                              <TableHead>开始时间</TableHead>
                              <TableHead>结束时间</TableHead>
                              <TableHead>阶段</TableHead>
                              <TableHead>时长</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {label.ranges.map((range) => {
                              const start = new Date(range.startTime);
                              const end = new Date(range.endTime);
                              const durationSec =
                                (end.getTime() - start.getTime()) / 1000;
                              return (
                                <TableRow key={range.id}>
                                  <TableCell className="font-mono text-xs">
                                    {range.experimentId || "-"}
                                  </TableCell>
                                  <TableCell>
                                    {start.toLocaleString()}
                                  </TableCell>
                                  <TableCell>{end.toLocaleString()}</TableCell>
                                  <TableCell>
                                    {range.phase ? (
                                      <Badge variant="secondary">
                                        {range.phase}
                                      </Badge>
                                    ) : (
                                      "-"
                                    )}
                                  </TableCell>
                                  <TableCell>{durationSec.toFixed(0)}s</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          暂无标注范围，请在实验数据页面添加
                        </p>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card>
        <CardHeader>
          <CardTitle>如何标注数据</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. 创建标签（如"苹果汁"、"橙汁"）</p>
          <p>2. 在实验数据页面选择时间范围</p>
          <p>3. 将选中的时间范围关联到标签</p>
          <p>4. 使用已标注的数据训练模型</p>
        </CardContent>
      </Card>
    </div>
  );
}
