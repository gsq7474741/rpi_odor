'use client';

import { memo, useMemo } from 'react';
import { useReactFlow, Node, Edge } from '@xyflow/react';
import { NodeType, HANDLE_TYPES } from '../types';
import { Button } from '@/components/ui/button';
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

  // 智能自动布局 - 考虑旁路节点和循环体
  const handleAutoLayout = () => {
    saveToHistory();
    const allNodes = getNodes();
    const allEdges = getEdges();
    
    // 分离节点类型
    const sideNodeTypes = [NodeType.LIQUID_SOURCE, NodeType.HARDWARE_CONFIG];
    const mainNodes: Node[] = [];
    const sideNodes: Node[] = [];
    const loopNodes: Node[] = [];
    
    for (const node of selectedNodes) {
      if (sideNodeTypes.includes(node.type as NodeType)) {
        sideNodes.push(node);
      } else if (node.type === NodeType.LOOP) {
        loopNodes.push(node);
        mainNodes.push(node);
      } else {
        mainNodes.push(node);
      }
    }
    
    // 识别循环体节点
    const loopBodyNodes = new Map<string, Set<string>>(); // loopId -> Set<bodyNodeId>
    for (const loopNode of loopNodes) {
      const bodyNodeIds = new Set<string>();
      // 找到循环体出口边
      const loopBodyOutEdge = allEdges.find(
        e => e.source === loopNode.id && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
      );
      if (loopBodyOutEdge) {
        // 从循环体第一个节点遍历到返回点
        let currentId: string | undefined = loopBodyOutEdge.target;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          bodyNodeIds.add(currentId);
          // 检查是否返回到循环节点
          const returnEdge = allEdges.find(
            e => e.source === currentId && e.target === loopNode.id && e.targetHandle === HANDLE_TYPES.LOOP_BODY
          );
          if (returnEdge) break;
          // 继续沿 flow 边遍历
          const nextEdge = allEdges.find(
            e => e.source === currentId && (!e.sourceHandle || e.sourceHandle === HANDLE_TYPES.FLOW)
          );
          currentId = nextEdge?.target;
        }
      }
      loopBodyNodes.set(loopNode.id, bodyNodeIds);
    }
    
    // 所有循环体节点集合
    const allLoopBodyNodeIds = new Set<string>();
    for (const bodyIds of loopBodyNodes.values()) {
      for (const id of bodyIds) allLoopBodyNodeIds.add(id);
    }
    
    // 主流程节点（排除循环体节点）
    const mainFlowNodes = mainNodes.filter(n => !allLoopBodyNodeIds.has(n.id));
    
    // 构建主流程的拓扑排序
    const mainNodeIds = new Set(mainFlowNodes.map(n => n.id));
    const inDegree = new Map<string, number>();
    const outEdges = new Map<string, string[]>();
    
    for (const node of mainFlowNodes) {
      inDegree.set(node.id, 0);
      outEdges.set(node.id, []);
    }
    
    for (const edge of allEdges) {
      if (mainNodeIds.has(edge.source) && mainNodeIds.has(edge.target)) {
        if (!edge.sourceHandle || edge.sourceHandle === HANDLE_TYPES.FLOW) {
          inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
          outEdges.get(edge.source)?.push(edge.target);
        }
      }
    }
    
    // 拓扑排序
    const sorted: Node[] = [];
    const queue: string[] = [];
    
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }
    
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = mainFlowNodes.find(n => n.id === id);
      if (node) sorted.push(node);
      
      for (const next of outEdges.get(id) || []) {
        const newDegree = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDegree);
        if (newDegree === 0) queue.push(next);
      }
    }
    
    // 添加未排序的节点
    for (const node of mainFlowNodes) {
      if (!sorted.find(n => n.id === node.id)) {
        sorted.push(node);
      }
    }
    
    // 布局主流程节点
    const mainX = bounds.minX + 200;
    const gap = 50;
    let currentY = bounds.minY;
    const newPositions = new Map<string, { x: number; y: number }>();
    const nodeYPositions = new Map<string, number>();
    const nodeHeights = new Map<string, number>();
    
    for (const node of sorted) {
      const height = node.measured?.height || 100;
      newPositions.set(node.id, { x: mainX, y: currentY });
      nodeYPositions.set(node.id, currentY);
      nodeHeights.set(node.id, height);
      currentY += height + gap;
    }
    
    // 布局循环体节点（放在循环节点右侧，水平排列）
    const loopBodyX = mainX + 250; // 循环体在主流程右侧
    const loopBodyGap = 40;
    
    for (const [loopId, bodyIds] of loopBodyNodes) {
      const loopY = nodeYPositions.get(loopId) ?? bounds.minY;
      let bodyX = loopBodyX;
      
      // 按顺序获取循环体节点
      const bodyNodesOrdered: Node[] = [];
      const loopBodyOutEdge = allEdges.find(
        e => e.source === loopId && e.sourceHandle === HANDLE_TYPES.LOOP_BODY
      );
      if (loopBodyOutEdge) {
        let currentId: string | undefined = loopBodyOutEdge.target;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId) && bodyIds.has(currentId)) {
          visited.add(currentId);
          const node = allNodes.find(n => n.id === currentId);
          if (node) bodyNodesOrdered.push(node);
          const nextEdge = allEdges.find(
            e => e.source === currentId && (!e.sourceHandle || e.sourceHandle === HANDLE_TYPES.FLOW)
          );
          currentId = nextEdge?.target;
          if (currentId === loopId) break;
        }
      }
      
      for (const node of bodyNodesOrdered) {
        const width = node.measured?.width || 160;
        newPositions.set(node.id, { x: bodyX, y: loopY });
        bodyX += width + loopBodyGap;
      }
    }
    
    // 布局旁路节点（放在其连接目标的左侧）
    const sideX = bounds.minX;
    const sideGap = 30;
    const sideNodesByTarget = new Map<string, Node[]>();
    
    for (const node of sideNodes) {
      const targetEdge = allEdges.find((e: Edge) => e.source === node.id);
      const targetId = targetEdge?.target || '';
      if (!sideNodesByTarget.has(targetId)) {
        sideNodesByTarget.set(targetId, []);
      }
      sideNodesByTarget.get(targetId)!.push(node);
    }
    
    for (const [targetId, nodes] of sideNodesByTarget) {
      const targetY = nodeYPositions.get(targetId) ?? bounds.minY;
      const targetHeight = nodeHeights.get(targetId) ?? 100;
      
      let totalHeight = 0;
      for (const node of nodes) {
        totalHeight += (node.measured?.height || 80);
      }
      totalHeight += (nodes.length - 1) * sideGap;
      
      let offsetY = targetY + (targetHeight - totalHeight) / 2;
      
      for (const node of nodes) {
        const nodeHeight = node.measured?.height || 80;
        newPositions.set(node.id, { x: sideX, y: offsetY });
        offsetY += nodeHeight + sideGap;
      }
    }
    
    // 对于没有连接的旁路节点，放在底部
    let unconnectedY = currentY;
    for (const node of sideNodes) {
      if (!newPositions.has(node.id)) {
        newPositions.set(node.id, { x: sideX, y: unconnectedY });
        unconnectedY += (node.measured?.height || 80) + sideGap;
      }
    }
    
    setNodes(nodes => nodes.map(n => {
      const newPos = newPositions.get(n.id);
      if (newPos) {
        return { ...n, position: newPos };
      }
      return n;
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
      <Button variant="ghost" size="icon" onClick={handleAutoLayout} title="自动布局">
        <LayoutGrid className="w-4 h-4" />
      </Button>

      {/* 复制 */}
      <Button variant="ghost" size="icon" onClick={handleCopy} title="复制选中节点">
        <Copy className="w-4 h-4" />
      </Button>

      {/* 删除 */}
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={handleDelete} 
        className="text-destructive hover:text-destructive"
        title="删除选中节点"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
});
