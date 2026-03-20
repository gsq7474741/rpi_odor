"use client";

import { useState } from "react";
import { useExperiments } from "../context/ExperimentsContext";
import { useSavedQueries, SavedQuery } from "@/hooks/use-saved-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bookmark,
  Save,
  Trash2,
  FolderOpen,
  Tag,
  Database,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

export function QuerySelector() {
  const {
    selectedSampleIds,
    filters,
    mlLabelConfig,
    mlSplitRatios,
    seriesConfig,
    addSamplesToSelection,
    clearSampleSelection,
    updateFilters,
    setMlLabelConfig,
    setMlSplitRatios,
    setSeriesConfig,
  } = useExperiments();

  const { queries, saveQuery, deleteQuery } = useSavedQueries();
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [queryName, setQueryName] = useState("");
  const [queryDesc, setQueryDesc] = useState("");

  // 保存当前状态为选择集
  const handleSave = () => {
    if (!queryName.trim()) {
      toast.error("请输入选择集名称");
      return;
    }

    saveQuery({
      name: queryName.trim(),
      description: queryDesc.trim() || undefined,
      sampleIds: Array.from(selectedSampleIds),
      filters: {
        runIds: filters.runIds,
        phaseNames: filters.phaseNames,
        liquidIds: filters.liquidIds,
        experimentPhases: filters.experimentPhases,
        componentCount: filters.componentCount,
        qualityLevels: filters.qualityLevels,
        showAnchorsOnly: filters.showAnchorsOnly,
        showBlanksOnly: filters.showBlanksOnly,
        hideAnchorsAndBlanks: filters.hideAnchorsAndBlanks,
        searchQuery: filters.searchQuery,
        hasAlignedSeries: filters.hasAlignedSeries,
      },
      mlLabelConfig,
      mlSplitRatios,
      seriesConfig: { method: seriesConfig.method, nSamples: seriesConfig.nSamples },
    });

    toast.success(`选择集「${queryName}」已保存`);
    setQueryName("");
    setQueryDesc("");
    setSaveDialogOpen(false);
  };

  // 加载选择集
  const handleLoad = (query: SavedQuery) => {
    // 恢复样本选择
    clearSampleSelection();
    if (query.sampleIds.length > 0) {
      addSamplesToSelection(query.sampleIds);
    }

    // 恢复筛选条件
    updateFilters(query.filters);

    // 恢复 ML 配置
    if (query.mlLabelConfig) {
      setMlLabelConfig(query.mlLabelConfig);
    }
    if (query.mlSplitRatios) {
      setMlSplitRatios(query.mlSplitRatios);
    }

    // 恢复对齐序列配置
    if (query.seriesConfig) {
      setSeriesConfig({
        method: query.seriesConfig.method as "linear" | "pchip",
        nSamples: query.seriesConfig.nSamples,
      });
    }

    toast.success(`已加载选择集「${query.name}」（${query.sampleIds.length} 样本）`);
    setOpen(false);
  };

  // 删除选择集
  const handleDelete = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteQuery(id);
    toast.success(`已删除选择集「${name}」`);
  };

  // 格式化日期
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
          >
            <Bookmark className="h-3.5 w-3.5" />
            选择集
            {queries.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {queries.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-3 pb-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">选择集</h4>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setOpen(false);
                  setSaveDialogOpen(true);
                }}
                disabled={selectedSampleIds.size === 0}
              >
                <Save className="h-3 w-3" />
                保存当前
              </Button>
            </div>
            {selectedSampleIds.size === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                请先选择样本，再保存为选择集
              </p>
            )}
          </div>

          <Separator />

          {queries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>暂无保存的选择集</p>
              <p className="text-xs mt-1">选择样本后点击「保存当前」</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <div className="p-1">
                {queries.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-start gap-2 p-2 rounded-md hover:bg-accent cursor-pointer group"
                    onClick={() => handleLoad(q)}
                  >
                    <FolderOpen className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {q.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                          onClick={(e) => handleDelete(q.id, q.name, e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {q.description && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {q.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
                          <Database className="h-2.5 w-2.5" />
                          {q.sampleIds.length} 样本
                        </Badge>
                        {q.mlLabelConfig && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
                            <Tag className="h-2.5 w-2.5" />
                            {q.mlLabelConfig}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
                          <Layers className="h-2.5 w-2.5" />
                          {q.seriesConfig.method} × {q.seriesConfig.nSamples}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatDate(q.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>

      {/* 保存对话框 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>保存选择集</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="query-name" className="text-xs">
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="query-name"
                value={queryName}
                onChange={(e) => setQueryName(e.target.value)}
                placeholder="例如：苹果汁训练集"
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="query-desc" className="text-xs">
                描述（可选）
              </Label>
              <Input
                id="query-desc"
                value={queryDesc}
                onChange={(e) => setQueryDesc(e.target.value)}
                placeholder="备注信息..."
                className="h-8 text-sm"
              />
            </div>

            <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1 text-muted-foreground">
              <p>将保存以下配置：</p>
              <ul className="space-y-0.5 ml-3 list-disc">
                <li>{selectedSampleIds.size} 个选中样本</li>
                <li>
                  标签策略：{mlLabelConfig || "未设置"}
                </li>
                <li>
                  数据分割：{mlSplitRatios.train}/{mlSplitRatios.val}/{100 - mlSplitRatios.train - mlSplitRatios.val}
                </li>
                <li>
                  序列配置：{seriesConfig.method} × {seriesConfig.nSamples} 点
                </li>
                {filters.runIds.length > 0 && (
                  <li>筛选 Run: {filters.runIds.join(", ")}</li>
                )}
                {filters.phaseNames.length > 0 && (
                  <li>筛选阶段: {filters.phaseNames.join(", ")}</li>
                )}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!queryName.trim()}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
