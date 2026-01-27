'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NodeType, NODE_CATEGORIES, NODE_META } from '../types';
import { useEditorStore } from '../store';

export function NodePalette() {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(NODE_CATEGORIES))
  );
  const addNode = useEditorStore((state) => state.addNode);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, nodeType: NodeType) => {
    e.dataTransfer.setData('application/reactflow', nodeType);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDoubleClick = (nodeType: NodeType) => {
    addNode(nodeType, { x: 250, y: 200 });
  };

  return (
    <div className="w-56 bg-muted/30 border-r overflow-y-auto">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">节点库</h3>
        <p className="text-xs text-muted-foreground mt-1">
          拖拽或双击添加节点
        </p>
      </div>
      
      <div className="p-2">
        {Object.entries(NODE_CATEGORIES).map(([key, category]) => (
          <div key={key} className="mb-2">
            <button
              onClick={() => toggleCategory(key)}
              className="flex items-center gap-1 w-full px-2 py-1.5 text-sm font-medium hover:bg-muted rounded"
            >
              {expandedCategories.has(key) ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              <span>{category.label}</span>
            </button>
            
            {expandedCategories.has(key) && (
              <div className="ml-4 mt-1 space-y-1">
                {category.nodes.map((nodeType) => {
                  const meta = NODE_META[nodeType];
                  return (
                    <div
                      key={nodeType}
                      draggable
                      onDragStart={(e) => handleDragStart(e, nodeType)}
                      onDoubleClick={() => handleDoubleClick(nodeType)}
                      className={cn(
                        'flex flex-col gap-0.5 px-2 py-1.5 text-sm rounded cursor-grab',
                        'hover:bg-muted active:cursor-grabbing',
                        'border border-transparent hover:border-border'
                      )}
                      title={meta.description}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: category.color }}
                        />
                        <span>{meta.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground ml-3.5 line-clamp-2">
                        {meta.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
