/**
 * 外部数据获取模块
 * 将 store 和 PropertyPanel 中的 API 调用逻辑统一到此处
 */

import { HeaterProfileInfo, PumpBindingInfo } from './compiler';

// 液体库类型
export interface LiquidItem {
  id: string;
  name: string;
  category: string;
  type: number;  // 1=样品, 2=清洗液, 3=其他
}

// 泵配置类型
export interface PumpAssignment {
  pumpIndex: number;
  liquidId: number;
  liquidName: string;
}

// 加热器预设类型
export interface HeaterProfile {
  id: number;
  name: string;
  description?: string;
  temps: number[];
  durs: number[];
}

// 编译所需的外部数据
export interface CompilerExternalData {
  heaterProfiles: HeaterProfileInfo[];
  pumpBindings: PumpBindingInfo[];
}

// 属性面板所需的外部数据
export interface PropertyPanelExternalData {
  liquids: LiquidItem[];
  pumpAssignments: PumpAssignment[];
  heaterProfiles: HeaterProfile[];
}

/**
 * 获取编译所需的外部数据（加热器预设、泵绑定）
 */
export async function fetchCompilerData(): Promise<CompilerExternalData> {
  const [heaterProfilesRes, pumpBindingsRes] = await Promise.all([
    fetch('/api/heater-profiles').then(r => r.ok ? r.json() : []),
    fetch('/api/consumables?type=pumps').then(r => r.ok ? r.json() : { assignments: [] }),
  ]);
  
  // 转换加热器预设格式
  const heaterProfiles: HeaterProfileInfo[] = (heaterProfilesRes || []).map(
    (p: { name: string; temps: number[]; durs: number[] }) => ({
      name: p.name,
      temps: p.temps || [],
      durs: p.durs || [],
    })
  );
  
  // 转换泵绑定格式
  const pumpBindings: PumpBindingInfo[] = (pumpBindingsRes.assignments || []).map(
    (a: { pumpIndex: number; liquidId: number; liquidName: string }) => ({
      pumpIndex: a.pumpIndex,
      liquidId: a.liquidId,
      liquidName: a.liquidName,
    })
  );
  
  return { heaterProfiles, pumpBindings };
}

/**
 * 获取液体库列表
 */
export async function fetchLiquids(): Promise<LiquidItem[]> {
  const res = await fetch('/api/consumables?type=liquids');
  if (!res.ok) return [];
  
  const data = await res.json();
  return (data.liquids || []).map((l: { id: number; name: string; type: number }) => ({
    id: String(l.id),
    name: l.name,
    category: '',
    type: l.type || 0,
  }));
}

/**
 * 获取泵配置列表
 */
export async function fetchPumpAssignments(): Promise<PumpAssignment[]> {
  const res = await fetch('/api/consumables?type=pumps');
  if (!res.ok) return [];
  
  const data = await res.json();
  return (data.assignments || []).map((a: { pumpIndex: number; liquidId: number; liquidName: string }) => ({
    pumpIndex: a.pumpIndex,
    liquidId: a.liquidId,
    liquidName: a.liquidName,
  }));
}

/**
 * 获取加热器预设列表
 */
export async function fetchHeaterProfiles(): Promise<HeaterProfile[]> {
  const res = await fetch('/api/heater-profiles');
  if (!res.ok) return [];
  return res.json();
}

/**
 * 获取属性面板所需的全部外部数据
 */
export async function fetchPropertyPanelData(): Promise<PropertyPanelExternalData> {
  const [liquids, pumpAssignments, heaterProfiles] = await Promise.all([
    fetchLiquids(),
    fetchPumpAssignments(),
    fetchHeaterProfiles(),
  ]);
  
  return { liquids, pumpAssignments, heaterProfiles };
}
