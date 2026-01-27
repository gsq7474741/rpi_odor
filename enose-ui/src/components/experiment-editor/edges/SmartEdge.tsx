'use client';

import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeProps,
  getSmoothStepPath,
  useReactFlow,
} from '@xyflow/react';

/**
 * 智能边组件
 * - 使用 smoothstep 路径避免穿过节点
 * - 根据连接位置动态调整 offset 避免线重合
 */
function SmartEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const { getEdges, getNodes } = useReactFlow();
  
  // 计算动态 offset 以避免线重合
  const offset = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    
    // 找出所有具有相同源节点或目标节点的边
    const currentEdge = edges.find(e => e.id === id);
    if (!currentEdge) return 20;
    
    const siblingEdges = edges.filter(e => 
      e.id !== id && (
        (e.source === currentEdge.source && e.target === currentEdge.target) ||
        (e.source === currentEdge.target && e.target === currentEdge.source)
      )
    );
    
    // 如果有重复的边，根据索引调整 offset
    if (siblingEdges.length > 0) {
      const allSameEdges = [currentEdge, ...siblingEdges].sort((a, b) => a.id.localeCompare(b.id));
      const index = allSameEdges.findIndex(e => e.id === id);
      return 20 + index * 15;
    }
    
    // 检查是否有节点在路径上，如果有则增加 offset
    const minX = Math.min(sourceX, targetX);
    const maxX = Math.max(sourceX, targetX);
    const minY = Math.min(sourceY, targetY);
    const maxY = Math.max(sourceY, targetY);
    
    const nodesInPath = nodes.filter(node => {
      if (node.id === currentEdge.source || node.id === currentEdge.target) return false;
      const nodeX = node.position.x + (node.measured?.width || 150) / 2;
      const nodeY = node.position.y + (node.measured?.height || 50) / 2;
      const nodeWidth = node.measured?.width || 150;
      const nodeHeight = node.measured?.height || 50;
      
      // 检查节点是否在边的包围盒内
      return (
        nodeX + nodeWidth / 2 > minX - 50 &&
        nodeX - nodeWidth / 2 < maxX + 50 &&
        nodeY + nodeHeight / 2 > minY - 50 &&
        nodeY - nodeHeight / 2 < maxY + 50
      );
    });
    
    if (nodesInPath.length > 0) {
      return 40; // 有节点在路径上时使用更大的 offset
    }
    
    return 20;
  }, [id, sourceX, sourceY, targetX, targetY, getEdges, getNodes]);
  
  // 根据源和目标的相对位置计算路径
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={style}
      markerEnd={markerEnd}
    />
  );
}

export const SmartEdge = memo(SmartEdgeComponent);
