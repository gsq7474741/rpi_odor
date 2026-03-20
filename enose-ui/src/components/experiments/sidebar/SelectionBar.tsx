"use client";

import { useExperiments } from "../context/ExperimentsContext";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { ExportPopover } from "./ExportPopover";
import { QuerySelector } from "./QuerySelector";

export function SelectionBar() {
  const {
    selectedSampleIds,
    allSelectedSamples,
    clearSampleSelection,
  } = useExperiments();

  // 计算选中样本来自多少个 Run（使用 allSelectedSamples 支持跨页）
  const selectedSamples = allSelectedSamples;
  const runIds = new Set(selectedSamples.map((s) => s.runId));

  const hasSelection = selectedSampleIds.size > 0;

  return (
    <div className="flex items-center gap-3 px-4 h-10 border-b bg-background">
      {/* 选择计数 */}
      <div className="flex items-center gap-2 min-w-0">
        {hasSelection ? (
          <>
            <span className="text-sm font-medium tabular-nums">
              {selectedSampleIds.size}
            </span>
            <span className="text-sm text-muted-foreground truncate">
              样本已选
              {runIds.size > 0 && (
                <span className="text-xs ml-1">
                  ({runIds.size} Run)
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">未选择</span>
        )}
      </div>

      {/* 选择集 - 始终可见 */}
      <QuerySelector />

      {/* 分隔线 */}
      {hasSelection && <div className="h-4 w-px bg-border" />}

      {/* 操作按钮组 */}
      {hasSelection && (
        <div className="flex items-center gap-1">
          {/* 导出 */}
          <ExportPopover />

          {/* 清除 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={clearSampleSelection}
            title="清除选择"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
