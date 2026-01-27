'use client';

import { memo, useCallback } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Copy, Scissors, Trash2, Maximize2, MousePointer2 } from 'lucide-react';

interface EditorContextMenuProps {
  children: React.ReactNode;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onFitView: () => void;
  hasSelection: boolean;
  hasClipboard: boolean;
}

function EditorContextMenuComponent({
  children,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onSelectAll,
  onFitView,
  hasSelection,
  hasClipboard,
}: EditorContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onCopy} disabled={!hasSelection}>
          <Copy className="w-4 h-4 mr-2" />
          复制
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCut} disabled={!hasSelection}>
          <Scissors className="w-4 h-4 mr-2" />
          剪切
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+X</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onPaste} disabled={!hasClipboard}>
          <Copy className="w-4 h-4 mr-2" />
          粘贴
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+V</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} disabled={!hasSelection}>
          <Trash2 className="w-4 h-4 mr-2" />
          删除
          <span className="ml-auto text-xs text-muted-foreground">Delete</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onSelectAll}>
          <MousePointer2 className="w-4 h-4 mr-2" />
          全选
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+A</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onFitView}>
          <Maximize2 className="w-4 h-4 mr-2" />
          适应画布
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+0</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const EditorContextMenu = memo(EditorContextMenuComponent);
