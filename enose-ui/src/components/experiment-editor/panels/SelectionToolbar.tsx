'use client';

import { memo, useMemo } from 'react';
import { useReactFlow, Node, Edge } from '@xyflow/react';
import { NodeType, HANDLE_TYPES } from '../types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Trash2, 
  AlignLeft, 
  AlignCenter, 
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Copy,
  LayoutGrid,
  ArrowDownUp,
  ArrowLeftRight
} from 'lucide-react';
import { useEditorStore } from '../store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

interface SelectionToolbarProps {
  selectedNodes: Node[];
}

export const SelectionToolbar = memo(function SelectionToolbar({ selectedNodes }: SelectionToolbarProps) {
  const { setNodes, getNodes, getEdges } = useReactFlow();
  const { saveToHistory, addNode } = useEditorStore();

  const selectedIds = useMemo(() => new Set(selectedNodes.map(n => n.id)), [selectedNodes]);

  if (selectedNodes.length < 2) return null;

  // 计算选中节点的边界
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of selectedNodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + (node.measured?.width || 160));
      maxY = Math.max(maxY, node.position.y + (node.measured?.height || 80));
    }
    return { minX, minY, maxX, maxY };
  }, [selectedNodes]);

  // 删除选中节点
  const handleDelete = () => {
    saveToHistory();
    setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
  };

  // 左对齐
  const handleAlignLeft = () => {
    saveToHistory();
    setNodes(nodes => nodes.map(n => {
      if (selectedIds.has(n.id)) {
        return { ...n, position: { ...n.position, x: bounds.minX } };
      }
      return n;
    }));
  };

  // 水平居中对齐
  const handleAlignCenterH = () => {
    saveToHistory();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    setNodes(nodes => nodes.map(n => {
      if (selectedIds.has(n.id)) {
        const nodeWidth = n.measured?.width || 160;
        return { ...n, position: { ...n.position, x: centerX - nodeWidth / 2 } };
      }
      return n;
    }));
  };

  // 右对齐
  const handleAlignRight = () => {
    saveToHistory();
    setNodes(nodes => nodes.map(n => {
      if (selectedIds.has(n.id)) {
        const nodeWidth = n.measured?.width || 160;
        return { ...n, position: { ...n.position, x: bounds.maxX - nodeWidth } };
      }
      return n;
    }));
  };

  // 顶部对齐
  const handleAlignTop = () => {
    saveToHistory();
    setNodes(nodes => nodes.map(n => {
      if (selectedIds.has(n.id)) {
        return { ...n, position: { ...n.position, y: bounds.minY } };
      }
      return n;
    }));
  };

  // 垂直居中对齐
  const handleAlignCenterV = () => {
    saveToHistory();
    const centerY = (bounds.minY + bounds.maxY) / 2;
    setNodes(nodes => nodes.map(n => {
      if (selectedIds.has(n.id)) {
        const nodeHeight = n.measured?.height || 80;
        return { ...n, position: { ...n.position, y: centerY - nodeHeight / 2 } };
      }
      return n;
    }));
  };

  // 底部对齐
  const handleAlignBottom = () => {
    saveToHistory();
    setNodes(nodes => nodes.map(n => {
      if (selectedIds.has(n.id)) {
        const nodeHeight = n.measured?.height || 80;
        return { ...n, position: { ...n.position, y: bounds.maxY - nodeHeight } };
      }
      return n;
    }));
  };

  // 水平均匀分布
  const handleDistributeH = () => {
    if (selectedNodes.length < 3) return;
    saveToHistory();
    const sortedNodes = [...selectedNodes].sort((a, b) => a.position.x - b.position.x);
    const totalWidth = bounds.maxX - bounds.minX;
    const nodeWidths = sortedNodes.reduce((sum, n) => sum + (n.measured?.width || 160), 0);
    const gap = (totalWidth - nodeWidths) / (sortedNodes.length - 1);
    
    let currentX = bounds.minX;
    const newPositions = new Map<string, number>();
    for (const node of sortedNodes) {
      newPositions.set(node.id, currentX);
      currentX += (node.measured?.width || 160) + gap;
    }

    setNodes(nodes => nodes.map(n => {
      if (newPositions.has(n.id)) {
        return { ...n, position: { ...n.position, x: newPositions.get(n.id)! } };
      }
      return n;
    }));
  };

  // 垂直均匀分布
  const handleDistributeV = () => {
    if (selectedNodes.length < 3) return;
    saveToHistory();
    const sortedNodes = [...selectedNodes].sort((a, b) => a.position.y - b.position.y);
    const totalHeight = bounds.maxY - bounds.minY;
    const nodeHeights = sortedNodes.reduce((sum, n) => sum + (n.measured?.height || 80), 0);
    const gap = (totalHeight - nodeHeights) / (sortedNodes.length - 1);
    
    let currentY = bounds.minY;
    const newPositions = new Map<string, number>();
    for (const node of sortedNodes) {
      newPositions.set(node.id, currentY);
      currentY += (node.measured?.height || 80) + gap;
    }

    setNodes(nodes => nodes.map(n => {
      if (newPositions.has(n.id)) {
        return { ...n, position: { ...n.position, y: newPositions.get(n.id)! } };
      }
      return n;
    }));
  };

  // 智能自动布局 - 处理循环/扫描体、嵌套、旁路节点
  const handleAutoLayout = () => {
    saveToHistory();
    const allNodes = getNodes();
    const allEdges = getEdges();

    // ─── 常量 ─────────────────────────────────────────────
    const MAIN_GAP_Y = 50;       // 主流程垂直间距
    const BODY_GAP_X = 40;       // 循环体水平间距
    const BODY_OFFSET_Y = 30;    // 循环体相对循环节点的垂直偏移
    const SIDE_GAP_X = 30;       // 旁路节点与目标的水平间距
    const SIDE_GAP_Y = 20;       // 旁路节点之间的垂直间距
    const NODE_W = 180;          // 默认节点宽度
    const NODE_H = 100;          // 默认节点高度

    // ─── 辅助函数 ────────────────────────────────────────
    const nw = (n: Node) => n.measured?.width || NODE_W;
    const nh = (n: Node) => n.measured?.height || NODE_H;
    const nodeById = (id: string) => allNodes.find(n => n.id === id);

    const selectedIdSet = new Set(selectedNodes.map(n => n.id));
    const sideNodeTypes = new Set([NodeType.LIQUID_SOURCE, NodeType.HARDWARE_CONFIG]);

    // ─── 1. 识别所有循环/扫描节点及其循环体 ─────────────
    const loopLikeTypes = new Set([NodeType.LOOP, NodeType.PARAM_SWEEP]);

    // 收集循环体: loopId → 有序 body node ID 列表
    const loopBodyOrderedIds = new Map<string, string[]>();

    const collectLoopBody = (loopId: string): string[] => {
      const bodyIds: string[] = [];
      const outEdge = allEdges.find(
        e => e.source === loopId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
      );
      if (!outEdge) return bodyIds;

      let curId: string | undefined = outEdge.target;
      const visited = new Set<string>();
      while (curId && !visited.has(curId)) {
        visited.add(curId);
        bodyIds.push(curId);
        // 检查是否返回循环节点
        const returnEdge = allEdges.find(
          e => e.source === curId && e.target === loopId && e.targetHandle === HANDLE_TYPES.LOOP_BODY
        );
        if (returnEdge) break;
        // 沿 flow 继续
        const nextEdge = allEdges.find(
          e => e.source === curId && (!e.sourceHandle || e.sourceHandle === HANDLE_TYPES.FLOW)
        );
        curId = nextEdge?.target;
        if (curId === loopId) break;
      }
      return bodyIds;
    };

    // 收集所有循环体（包括嵌套）
    for (const node of selectedNodes) {
      if (loopLikeTypes.has(node.type as NodeType)) {
        loopBodyOrderedIds.set(node.id, collectLoopBody(node.id));
      }
    }

    // 所有属于某个循环体的节点 ID
    const allBodyNodeIds = new Set<string>();
    for (const ids of loopBodyOrderedIds.values()) {
      for (const id of ids) allBodyNodeIds.add(id);
    }

    // ─── 2. 分离节点 ────────────────────────────────────
    const sideNodes: Node[] = [];
    const mainFlowNodes: Node[] = []; // 不含循环体、不含旁路

    for (const node of selectedNodes) {
      if (sideNodeTypes.has(node.type as NodeType)) {
        sideNodes.push(node);
      } else if (!allBodyNodeIds.has(node.id)) {
        mainFlowNodes.push(node);
      }
    }

    // ─── 3. 拓扑排序主流程 ─────────────────────────────
    const mainIdSet = new Set(mainFlowNodes.map(n => n.id));
    const inDeg = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const n of mainFlowNodes) {
      inDeg.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of allEdges) {
      if (mainIdSet.has(e.source) && mainIdSet.has(e.target)) {
        if (!e.sourceHandle || e.sourceHandle === HANDLE_TYPES.FLOW) {
          inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
          adj.get(e.source)?.push(e.target);
        }
      }
    }

    const sorted: Node[] = [];
    const queue: string[] = [];
    for (const [id, d] of inDeg) { if (d === 0) queue.push(id); }
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = mainFlowNodes.find(n => n.id === id);
      if (node) sorted.push(node);
      for (const next of adj.get(id) || []) {
        const nd = (inDeg.get(next) || 1) - 1;
        inDeg.set(next, nd);
        if (nd === 0) queue.push(next);
      }
    }
    // 添加未被拓扑排序覆盖的节点
    for (const n of mainFlowNodes) {
      if (!sorted.find(s => s.id === n.id)) sorted.push(n);
    }

    // ─── 4. 布局 ────────────────────────────────────────
    const newPos = new Map<string, { x: number; y: number }>();
    // 追踪每个节点的 y 和 height（含循环体展开后的总高度）
    const nodePosY = new Map<string, number>();
    const nodeTotalH = new Map<string, number>(); // 包含循环体的高度

    const mainX = bounds.minX + 200;
    let curY = bounds.minY;

    /**
     * 递归布局循环体。返回循环体区域的总高度。
     * bodyX: 循环体起始 X 位置
     * bodyY: 循环体起始 Y 位置
     */
    const layoutLoopBody = (loopId: string, bodyX: number, bodyY: number): { width: number; height: number } => {
      const bodyIds = loopBodyOrderedIds.get(loopId) || [];
      if (bodyIds.length === 0) return { width: 0, height: 0 };

      let maxBodyH = 0;
      let curX = bodyX;

      for (const bodyNodeId of bodyIds) {
        const bodyNode = nodeById(bodyNodeId);
        if (!bodyNode) continue;

        const w = nw(bodyNode);
        const h = nh(bodyNode);

        // 如果这个 body 节点本身也是循环/扫描节点，递归布局
        let subBodyH = 0;
        if (loopBodyOrderedIds.has(bodyNodeId)) {
          const subResult = layoutLoopBody(
            bodyNodeId,
            curX,
            bodyY + h + BODY_OFFSET_Y
          );
          subBodyH = subResult.height > 0 ? h + BODY_OFFSET_Y + subResult.height : 0;
        }

        newPos.set(bodyNodeId, { x: curX, y: bodyY });
        nodePosY.set(bodyNodeId, bodyY);
        nodeTotalH.set(bodyNodeId, Math.max(h, subBodyH));

        maxBodyH = Math.max(maxBodyH, h, subBodyH);
        curX += w + BODY_GAP_X;
      }

      return { width: curX - bodyX - BODY_GAP_X, height: maxBodyH };
    };

    // 布局主流程
    for (const node of sorted) {
      const h = nh(node);
      newPos.set(node.id, { x: mainX, y: curY });
      nodePosY.set(node.id, curY);

      // 如果是循环/扫描节点，在其下方布局循环体
      let totalH = h;
      if (loopBodyOrderedIds.has(node.id)) {
        const bodyIds = loopBodyOrderedIds.get(node.id)!;
        if (bodyIds.length > 0) {
          // 循环体水平居中于主流程列
          // 先计算循环体总宽度
          let bodyTotalW = 0;
          for (const bid of bodyIds) {
            const bn = nodeById(bid);
            bodyTotalW += bn ? nw(bn) : NODE_W;
          }
          bodyTotalW += (bodyIds.length - 1) * BODY_GAP_X;

          // 循环体起始 X：以主流程 X 为中心对齐，但至少从 mainX - bodyTotalW/3 开始
          const bodyStartX = mainX - bodyTotalW / 3;
          const bodyStartY = curY + h + BODY_OFFSET_Y;

          const result = layoutLoopBody(node.id, bodyStartX, bodyStartY);
          if (result.height > 0) {
            totalH = h + BODY_OFFSET_Y + result.height;
          }
        }
      }

      nodeTotalH.set(node.id, totalH);
      curY += totalH + MAIN_GAP_Y;
    }

    // ─── 5. 旁路节点布局（液体源、硬件配置） ──────────
    // 按连接目标分组
    const sideByTarget = new Map<string, Node[]>();
    for (const node of sideNodes) {
      // 找到这个旁路节点连接到哪个目标
      const outEdge = allEdges.find((e: Edge) => e.source === node.id && selectedIdSet.has(e.target));
      const targetId = outEdge?.target || '';
      if (!sideByTarget.has(targetId)) sideByTarget.set(targetId, []);
      sideByTarget.get(targetId)!.push(node);
    }

    for (const [targetId, nodes] of sideByTarget) {
      const targetPos = newPos.get(targetId);
      if (!targetPos) continue;

      const targetH = nodeTotalH.get(targetId) ?? NODE_H;

      // 计算旁路节点总高度
      let totalSideH = 0;
      for (const n of nodes) totalSideH += nh(n);
      totalSideH += (nodes.length - 1) * SIDE_GAP_Y;

      // 旁路节点 X: 目标节点左侧
      const targetW = (() => {
        const tn = nodeById(targetId);
        return tn ? nw(tn) : NODE_W;
      })();
      const sideX = targetPos.x - targetW - SIDE_GAP_X;

      // 垂直居中对齐目标节点（使用原始高度而非含循环体的高度）
      const targetNodeH = (() => {
        const tn = nodeById(targetId);
        return tn ? nh(tn) : NODE_H;
      })();
      let sideY = targetPos.y + (targetNodeH - totalSideH) / 2;

      for (const node of nodes) {
        newPos.set(node.id, { x: sideX, y: sideY });
        nodePosY.set(node.id, sideY);
        sideY += nh(node) + SIDE_GAP_Y;
      }
    }

    // 没有连接的旁路节点放在底部左侧
    let unconnectedY = curY;
    const fallbackSideX = bounds.minX;
    for (const node of sideNodes) {
      if (!newPos.has(node.id)) {
        newPos.set(node.id, { x: fallbackSideX, y: unconnectedY });
        unconnectedY += nh(node) + SIDE_GAP_Y;
      }
    }

    // ─── 6. 应用位置 ───────────────────────────────────
    setNodes(ns => ns.map(n => {
      const pos = newPos.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));
  };

  // 复制选中节点
  const handleCopy = () => {
    saveToHistory();
    const allNodes = getNodes();
    const newNodes: Node[] = [];
    const idMap = new Map<string, string>();
    
    // 生成新ID
    let maxId = 0;
    for (const node of allNodes) {
      const match = node.id.match(/node_(\d+)/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1]));
      }
    }

    // 复制节点
    for (const node of selectedNodes) {
      const newId = `node_${++maxId}`;
      idMap.set(node.id, newId);
      newNodes.push({
        ...node,
        id: newId,
        position: {
          x: node.position.x + 50,
          y: node.position.y + 50,
        },
        selected: false,
      });
    }

    setNodes(nodes => [...nodes, ...newNodes]);
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 p-2 bg-background border rounded-lg shadow-lg">
      <span className="text-sm text-muted-foreground mr-2">
        已选择 {selectedNodes.length} 个节点
      </span>

      {/* 对齐下拉菜单 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <AlignLeft className="w-4 h-4 mr-1" />
            对齐
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>水平对齐</DropdownMenuLabel>
          <DropdownMenuItem onClick={handleAlignLeft}>
            <AlignLeft className="w-4 h-4 mr-2" /> 左对齐
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAlignCenterH}>
            <AlignCenter className="w-4 h-4 mr-2" /> 水平居中
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAlignRight}>
            <AlignRight className="w-4 h-4 mr-2" /> 右对齐
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>垂直对齐</DropdownMenuLabel>
          <DropdownMenuItem onClick={handleAlignTop}>
            <AlignStartVertical className="w-4 h-4 mr-2" /> 顶部对齐
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAlignCenterV}>
            <AlignCenterVertical className="w-4 h-4 mr-2" /> 垂直居中
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAlignBottom}>
            <AlignEndVertical className="w-4 h-4 mr-2" /> 底部对齐
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 分布 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={selectedNodes.length < 3}>
            <ArrowLeftRight className="w-4 h-4 mr-1" />
            分布
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleDistributeH}>
            <ArrowLeftRight className="w-4 h-4 mr-2" /> 水平均匀分布
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDistributeV}>
            <ArrowDownUp className="w-4 h-4 mr-2" /> 垂直均匀分布
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 自动布局 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={handleAutoLayout}>
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>自动布局</TooltipContent>
      </Tooltip>

      {/* 复制 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={handleCopy}>
            <Copy className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>复制选中节点</TooltipContent>
      </Tooltip>

      {/* 删除 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleDelete} 
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>删除选中节点</TooltipContent>
      </Tooltip>
    </div>
  );
});
