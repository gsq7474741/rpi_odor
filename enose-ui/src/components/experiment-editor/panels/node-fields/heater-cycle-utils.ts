/**
 * 共享工具函数：从节点图中反向查找上游加热配置，计算最长周期时长
 * 供 PreheatNodeFields 和 AcquireNodeFields 共用
 */

import { ExperimentNode, ExperimentEdge, NodeType } from '../../types';
import { HeaterProfile } from '../../data-fetcher';
import { getBaseProfileName } from './types';

/**
 * 沿流程边反向查找最近的 CONFIGURE_HEATER 节点
 */
export function findPrecedingConfigureHeater(
  nodeId: string,
  nodes: ExperimentNode[],
  edges: ExperimentEdge[]
): ExperimentNode | null {
  const visited = new Set<string>();
  let currentId = nodeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const incomingEdge = edges.find(e => e.target === currentId);
    if (!incomingEdge) return null;

    const sourceNode = nodes.find(n => n.id === incomingEdge.source);
    if (!sourceNode) return null;

    if (sourceNode.type === NodeType.CONFIGURE_HEATER) {
      return sourceNode;
    }
    currentId = sourceNode.id;
  }
  return null;
}

/**
 * 从 CONFIGURE_HEATER 节点数据中提取最长加热周期时长 (秒)
 */
export function computeMaxCycleDurationS(
  configHeaterNode: ExperimentNode,
  profiles: HeaterProfile[]
): number {
  const nodeData = configHeaterNode.data as Record<string, unknown>;
  const sensorProfiles = (nodeData.sensorProfiles || {}) as Record<number, string>;
  const uniqueNames = new Set(
    Object.values(sensorProfiles).filter(Boolean).map(n => getBaseProfileName(n))
  );

  let maxDuration = 0;
  for (const baseName of uniqueNames) {
    const profile = profiles.find(p => p.name === baseName);
    if (profile?.durs?.length) {
      const cycleDur = profile.durs.reduce((s, d) => s + d, 0) * 0.14;
      if (cycleDur > maxDuration) maxDuration = cycleDur;
    }
  }
  return maxDuration;
}
