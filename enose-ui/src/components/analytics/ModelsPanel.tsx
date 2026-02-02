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
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
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
  Plus,
  Play,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  Brain,
} from "lucide-react";

interface MLModel {
  id: string;
  name: string;
  description?: string;
  inputDim: number;
  outputDim: number;
  classNames: string[];
  trainAccuracy?: number;
  valAccuracy?: number;
  trainLoss?: number;
  valLoss?: number;
  createdAt: string;
  minioPath: string;
  fileSize?: number;
}

interface TrainProgress {
  epoch: number;
  totalEpochs: number;
  trainLoss: number;
  valLoss: number;
  trainAccuracy: number;
  valAccuracy: number;
  status: string;
}

export function ModelsPanel() {
  const [models, setModels] = useState<MLModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [trainDialogOpen, setTrainDialogOpen] = useState(false);
  const [training, setTraining] = useState(false);
  const [trainProgress, setTrainProgress] = useState<TrainProgress | null>(
    null
  );

  // 训练配置
  const [trainConfig, setTrainConfig] = useState({
    name: "",
    labelIds: [] as string[],
    hiddenLayers: [64, 32],
    epochs: 100,
    batchSize: 32,
    learningRate: 0.001,
    dropout: 0.2,
  });

  const fetchModels = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics/models");
      if (response.ok) {
        const data = await response.json();
        setModels(data.models || []);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleTrain = async () => {
    if (!trainConfig.name) return;

    setTraining(true);
    setTrainProgress(null);

    try {
      const response = await fetch("/api/analytics/models/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trainConfig),
      });

      if (response.ok) {
        const reader = response.body?.getReader();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = new TextDecoder().decode(value);
            const lines = text.split("\n").filter((l) => l.trim());
            for (const line of lines) {
              try {
                const progress = JSON.parse(line);
                setTrainProgress(progress);
                if (progress.status === "completed") {
                  fetchModels();
                  setTrainDialogOpen(false);
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Training failed:", error);
    } finally {
      setTraining(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个模型吗？")) return;

    try {
      const response = await fetch(`/api/analytics/models/${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchModels();
      }
    } catch (error) {
      console.error("Failed to delete model:", error);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">MLP 模型管理</h2>
          <p className="text-sm text-muted-foreground">
            训练、管理和部署分类模型
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchModels} disabled={loading}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
          <Dialog open={trainDialogOpen} onOpenChange={setTrainDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                训练新模型
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>训练新模型</DialogTitle>
                <DialogDescription>
                  使用已标注的数据训练 MLP 分类模型
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>模型名称</Label>
                  <Input
                    value={trainConfig.name}
                    onChange={(e) =>
                      setTrainConfig({ ...trainConfig, name: e.target.value })
                    }
                    placeholder="my-model"
                  />
                </div>

                <div className="space-y-2">
                  <Label>训练轮数: {trainConfig.epochs}</Label>
                  <Slider
                    value={[trainConfig.epochs]}
                    onValueChange={([v]) =>
                      setTrainConfig({ ...trainConfig, epochs: v })
                    }
                    min={10}
                    max={500}
                    step={10}
                  />
                </div>

                <div className="space-y-2">
                  <Label>批大小: {trainConfig.batchSize}</Label>
                  <Slider
                    value={[trainConfig.batchSize]}
                    onValueChange={([v]) =>
                      setTrainConfig({ ...trainConfig, batchSize: v })
                    }
                    min={8}
                    max={128}
                    step={8}
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    学习率: {trainConfig.learningRate.toExponential(0)}
                  </Label>
                  <Slider
                    value={[Math.log10(trainConfig.learningRate)]}
                    onValueChange={([v]) =>
                      setTrainConfig({
                        ...trainConfig,
                        learningRate: Math.pow(10, v),
                      })
                    }
                    min={-5}
                    max={-1}
                    step={0.5}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Dropout: {trainConfig.dropout}</Label>
                  <Slider
                    value={[trainConfig.dropout]}
                    onValueChange={([v]) =>
                      setTrainConfig({ ...trainConfig, dropout: v })
                    }
                    min={0}
                    max={0.5}
                    step={0.05}
                  />
                </div>

                {trainProgress && (
                  <div className="space-y-2 pt-4 border-t">
                    <div className="flex justify-between text-sm">
                      <span>
                        Epoch {trainProgress.epoch}/{trainProgress.totalEpochs}
                      </span>
                      <span>
                        验证准确率:{" "}
                        {(trainProgress.valAccuracy * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={
                        (trainProgress.epoch / trainProgress.totalEpochs) * 100
                      }
                    />
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>
                        训练损失: {trainProgress.trainLoss.toFixed(4)}
                      </span>
                      <span>验证损失: {trainProgress.valLoss.toFixed(4)}</span>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setTrainDialogOpen(false)}
                  disabled={training}
                >
                  取消
                </Button>
                <Button onClick={handleTrain} disabled={training}>
                  {training ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      训练中...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      开始训练
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 模型列表 */}
      <Card>
        <CardHeader>
          <CardTitle>已训练模型</CardTitle>
          <CardDescription>共 {models.length} 个模型</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>输入/输出维度</TableHead>
                <TableHead>类别数</TableHead>
                <TableHead>验证准确率</TableHead>
                <TableHead>文件大小</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-[120px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p>暂无模型，点击"训练新模型"开始</p>
                  </TableCell>
                </TableRow>
              ) : (
                models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{model.name}</p>
                        {model.description && (
                          <p className="text-sm text-muted-foreground">
                            {model.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {model.inputDim} → {model.outputDim}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {model.classNames.length} 类
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {model.valAccuracy
                        ? `${(model.valAccuracy * 100).toFixed(1)}%`
                        : "-"}
                    </TableCell>
                    <TableCell>{formatFileSize(model.fileSize)}</TableCell>
                    <TableCell>
                      {new Date(model.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(model.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
