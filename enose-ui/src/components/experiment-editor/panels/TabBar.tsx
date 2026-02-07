'use client';

import { useCallback } from 'react';
import { X, Plus, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorStore, TabSnapshot } from '../store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TabBarProps {
  onNewTab: () => void;
  onCloseTab: (tabId: string, isDirty: boolean) => void;
  onCloseOtherTabs: (tabId: string) => void;
}

function TabItem({ 
  tab, 
  isActive, 
  onSwitch, 
  onClose, 
  onCloseOthers,
  tabCount,
}: { 
  tab: TabSnapshot; 
  isActive: boolean; 
  onSwitch: () => void; 
  onClose: () => void; 
  onCloseOthers: () => void;
  tabCount: number;
}) {
  // 当前活动标签读取实时的 isDirty
  const liveIsDirty = useEditorStore(s => s.isDirty);
  const liveFilename = useEditorStore(s => s.currentFilename);
  const liveProgramName = useEditorStore(s => s.programName);
  
  const isDirty = isActive ? liveIsDirty : tab.isDirty;
  const filename = isActive ? liveFilename : tab.filename;
  const programName = isActive ? liveProgramName : tab.programName;
  
  const displayName = filename?.replace(/\.ya?ml$/i, '') || 
    (programName !== 'new_experiment' && programName ? programName : '未命名');

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center gap-1.5 px-3 h-8 text-xs border-r cursor-pointer select-none shrink-0 max-w-[180px]',
            'transition-colors duration-100',
            isActive
              ? 'bg-background text-foreground border-b-2 border-b-primary'
              : 'bg-muted/40 text-muted-foreground hover:bg-muted/70 border-b-2 border-b-transparent'
          )}
          onClick={onSwitch}
          onMouseDown={(e) => {
            // 中键关闭
            if (e.button === 1) {
              e.preventDefault();
              onClose();
            }
          }}
        >
          <FileText className="w-3 h-3 shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate">{displayName}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {filename || displayName}
            </TooltipContent>
          </Tooltip>
          {isDirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
          )}
          {tabCount > 1 && (
            <button
              className={cn(
                'ml-auto w-4 h-4 rounded-sm flex items-center justify-center shrink-0',
                'opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-opacity',
                isActive && 'opacity-60'
              )}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onClose} disabled={tabCount <= 1}>
          关闭
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers} disabled={tabCount <= 1}>
          关闭其他
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => {
          if (filename) {
            navigator.clipboard.writeText(filename);
          }
        }} disabled={!filename}>
          复制文件名
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TabBar({ onNewTab, onCloseTab, onCloseOtherTabs }: TabBarProps) {
  const tabs = useEditorStore(s => s.tabs);
  const activeTabId = useEditorStore(s => s.activeTabId);
  const switchTab = useEditorStore(s => s.switchTab);

  return (
    <div className="flex items-center bg-muted/30 border-b overflow-x-auto">
      <div className="flex items-center min-w-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSwitch={() => switchTab(tab.id)}
            onClose={() => onCloseTab(tab.id, tab.id === activeTabId ? useEditorStore.getState().isDirty : tab.isDirty)}
            onCloseOthers={() => onCloseOtherTabs(tab.id)}
            tabCount={tabs.length}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="w-7 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
            onClick={onNewTab}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">新建标签页</TooltipContent>
      </Tooltip>
    </div>
  );
}
