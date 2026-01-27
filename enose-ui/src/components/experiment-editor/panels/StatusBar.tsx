'use client';

import { useReactFlow, useViewport } from '@xyflow/react';
import { useEditorStore } from '../store';

export function StatusBar() {
  const { nodes, edges } = useEditorStore();
  const { zoom } = useViewport();
  
  const selectedCount = nodes.filter(n => n.selected).length;
  
  return (
    <div className="flex items-center justify-between px-4 py-1 border-t bg-muted/30 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>节点: {nodes.length}</span>
        <span>连接: {edges.length}</span>
        {selectedCount > 0 && (
          <span className="text-primary">已选中: {selectedCount}</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span>缩放: {Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
