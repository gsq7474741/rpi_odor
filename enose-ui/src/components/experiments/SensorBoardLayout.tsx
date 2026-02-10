"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HeaterConfig {
  sensorIndices: number[];
  profileName: string;
  temps: number[];
  durs: number[];
}

interface SensorBoardLayoutProps {
  heaterConfigs: HeaterConfig[];
  className?: string;
  compact?: boolean;
}

// BME688 开发板物理布局 (U1-U8)
// 顶行: U8 U6 _ U3 U1 (sensor_idx: 7, 5, _, 2, 0)
// 底行: U7 U5 _ U4 U2 (sensor_idx: 6, 4, _, 3, 1)
const BOARD_LAYOUT: { row: number; col: number; sensorIdx: number; label: string }[] = [
  { row: 0, col: 0, sensorIdx: 7, label: "U8" },
  { row: 0, col: 1, sensorIdx: 5, label: "U6" },
  { row: 0, col: 3, sensorIdx: 2, label: "U3" },
  { row: 0, col: 4, sensorIdx: 0, label: "U1" },
  { row: 1, col: 0, sensorIdx: 6, label: "U7" },
  { row: 1, col: 1, sensorIdx: 4, label: "U5" },
  { row: 1, col: 3, sensorIdx: 3, label: "U4" },
  { row: 1, col: 4, sensorIdx: 1, label: "U2" },
];

// 16 色调色板：HSL 均匀分布，最大感知距离，相邻颜色差异明显
const PROFILE_COLORS = [
  { bg: "bg-red-200 dark:bg-red-800",       border: "border-red-500",       text: "text-red-700 dark:text-red-300",       legend: "bg-red-500" },       // 0  红
  { bg: "bg-teal-200 dark:bg-teal-800",     border: "border-teal-500",      text: "text-teal-700 dark:text-teal-300",     legend: "bg-teal-500" },      // 1  青
  { bg: "bg-amber-200 dark:bg-amber-800",   border: "border-amber-500",     text: "text-amber-700 dark:text-amber-300",   legend: "bg-amber-500" },     // 2  琥珀
  { bg: "bg-indigo-200 dark:bg-indigo-800", border: "border-indigo-500",    text: "text-indigo-700 dark:text-indigo-300", legend: "bg-indigo-500" },    // 3  靛蓝
  { bg: "bg-lime-200 dark:bg-lime-800",     border: "border-lime-500",      text: "text-lime-700 dark:text-lime-300",     legend: "bg-lime-500" },      // 4  青柠
  { bg: "bg-fuchsia-200 dark:bg-fuchsia-800", border: "border-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300", legend: "bg-fuchsia-500" }, // 5  洋红
  { bg: "bg-cyan-200 dark:bg-cyan-800",     border: "border-cyan-500",      text: "text-cyan-700 dark:text-cyan-300",     legend: "bg-cyan-500" },      // 6  青蓝
  { bg: "bg-orange-200 dark:bg-orange-800", border: "border-orange-500",    text: "text-orange-700 dark:text-orange-300", legend: "bg-orange-500" },    // 7  橙
  { bg: "bg-violet-200 dark:bg-violet-800", border: "border-violet-500",    text: "text-violet-700 dark:text-violet-300", legend: "bg-violet-500" },    // 8  紫
  { bg: "bg-emerald-200 dark:bg-emerald-800", border: "border-emerald-500", text: "text-emerald-700 dark:text-emerald-300", legend: "bg-emerald-500" }, // 9  翡翠
  { bg: "bg-rose-200 dark:bg-rose-800",     border: "border-rose-500",      text: "text-rose-700 dark:text-rose-300",     legend: "bg-rose-500" },      // 10 玫瑰
  { bg: "bg-sky-200 dark:bg-sky-800",       border: "border-sky-500",       text: "text-sky-700 dark:text-sky-300",       legend: "bg-sky-500" },       // 11 天蓝
  { bg: "bg-yellow-200 dark:bg-yellow-800", border: "border-yellow-500",    text: "text-yellow-700 dark:text-yellow-300", legend: "bg-yellow-500" },    // 12 黄
  { bg: "bg-pink-200 dark:bg-pink-800",     border: "border-pink-500",      text: "text-pink-700 dark:text-pink-300",     legend: "bg-pink-500" },      // 13 粉
  { bg: "bg-green-200 dark:bg-green-800",   border: "border-green-500",     text: "text-green-700 dark:text-green-300",   legend: "bg-green-500" },     // 14 绿
  { bg: "bg-blue-200 dark:bg-blue-800",     border: "border-blue-500",      text: "text-blue-700 dark:text-blue-300",     legend: "bg-blue-500" },      // 15 蓝
];

const UNASSIGNED_COLOR = {
  bg: "bg-muted", border: "border-muted-foreground/20", text: "text-muted-foreground", legend: "bg-muted-foreground/30",
};

/**
 * 去除 __N 后缀，提取 base profile name
 */
function getBaseProfileName(name: string): string {
  return name.replace(/__\d+$/, '');
}

/**
 * FNV-1a hash + golden ratio 分散 → 稳定的颜色索引
 * 相同 base profile name 永远映射到同一颜色，跨样本一致
 * 相似字符串（constant_100/200/320/400）映射到最大距离的颜色
 */
function profileNameToColorIndex(baseName: string): number {
  // FNV-1a hash (良好的雪崩效应，单字符差异也会大幅改变结果)
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < baseName.length; i++) {
    hash ^= baseName.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Golden ratio 分散：将 hash 映射到 [0,1) 再量化，最大化相邻 hash 的索引距离
  const golden = (((hash >>> 0) * 2654435769) >>> 0) / 4294967296;
  return Math.floor(golden * PROFILE_COLORS.length);
}

/**
 * BME688 风格传感器板布局图
 * 显示每个传感器（U1-U8）使用的加热配置，颜色区分不同 profile
 * 颜色基于 base profile name 的 hash 全局固定映射
 */
export function SensorBoardLayout({ heaterConfigs, className, compact = false }: SensorBoardLayoutProps) {
  // 构建 sensorIdx -> profileName 映射 和 baseName -> color 映射
  const { sensorMap, profileColorMap, legendEntries } = useMemo(() => {
    const sMap: Record<number, string> = {};
    const baseNameSet = new Set<string>();

    for (const config of heaterConfigs) {
      for (const idx of config.sensorIndices) {
        sMap[idx] = config.profileName;
      }
      baseNameSet.add(getBaseProfileName(config.profileName));
    }

    // 基于 base name hash 的固定颜色映射
    const pcMap: Record<string, typeof PROFILE_COLORS[0]> = {};
    for (const baseName of baseNameSet) {
      pcMap[baseName] = PROFILE_COLORS[profileNameToColorIndex(baseName)];
    }

    // 图例条目：去重后的 base name，按字母排序
    const entries = Array.from(baseNameSet).sort();

    return { sensorMap: sMap, profileColorMap: pcMap, legendEntries: entries };
  }, [heaterConfigs]);

  if (!heaterConfigs.length) {
    return (
      <div className={cn("text-xs text-muted-foreground", className)}>
        无加热器配置
      </div>
    );
  }

  const cellSize = compact ? "w-7 h-7" : "w-9 h-9";
  const fontSize = compact ? "text-[9px]" : "text-[10px]";
  const gapSize = compact ? "gap-0.5" : "gap-1";

  // 计算单周期时长
  const getCycleDuration = (config: HeaterConfig) => {
    if (!config.durs?.length) return null;
    return config.durs.reduce((s, d) => s + d, 0) * 0.14;
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* 传感器板 */}
      <div className="flex items-center gap-3">
        {/* USB 接口指示 */}
        <div className={cn(
          "rounded-sm bg-muted border flex items-center justify-center",
          compact ? "w-3 h-10" : "w-4 h-14"
        )}>
          <span className={cn("text-muted-foreground rotate-[-90deg] whitespace-nowrap", compact ? "text-[6px]" : "text-[7px]")}>
            USB
          </span>
        </div>

        {/* 传感器网格 */}
        <div className={cn("grid grid-cols-5 grid-rows-2", gapSize)}>
          {[0, 1].map((row) =>
            [0, 1, 2, 3, 4].map((col) => {
              const cell = BOARD_LAYOUT.find(c => c.row === row && c.col === col);
              if (!cell) {
                // 空位 (col=2 是连接器位置)
                return (
                  <div
                    key={`${row}-${col}`}
                    className={cn(cellSize, "flex items-center justify-center")}
                  >
                    {col === 2 && (
                      <div className={cn(
                        "bg-muted-foreground/30 rounded-sm",
                        compact ? "w-3 h-1.5" : "w-4 h-2"
                      )} />
                    )}
                  </div>
                );
              }

              const profileName = sensorMap[cell.sensorIdx];
              const baseName = profileName ? getBaseProfileName(profileName) : null;
              const color = baseName ? profileColorMap[baseName] : UNASSIGNED_COLOR;

              return (
                <Tooltip key={`${row}-${col}`}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        cellSize,
                        "rounded-md border-2 flex flex-col items-center justify-center cursor-default transition-colors",
                        color.bg,
                        color.border
                      )}
                    >
                      <span className={cn(fontSize, "font-bold leading-none", color.text)}>
                        {cell.label}
                      </span>
                      {!compact && (
                        <span className={cn("text-[7px] leading-none mt-0.5 opacity-70", color.text)}>
                          S{cell.sensorIdx}
                        </span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <div className="space-y-1">
                      <p className="font-medium">{cell.label} (sensor {cell.sensorIdx})</p>
                      <p>{baseName || "未分配"}</p>
                      {profileName && (() => {
                        const config = heaterConfigs.find(c => c.profileName === profileName);
                        if (!config) return null;
                        const dur = getCycleDuration(config);
                        return (
                          <>
                            <p className="text-muted-foreground">
                              {config.temps.length} 步, 周期 {dur ? `${dur.toFixed(1)}s` : "?"}
                            </p>
                            <p className="text-muted-foreground font-mono text-[10px]">
                              T: [{config.temps.join(",")}]
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })
          )}
        </div>
      </div>

      {/* 图例 */}
      <div className={cn("flex flex-wrap", compact ? "gap-x-2 gap-y-0.5" : "gap-x-3 gap-y-1")}>
        {legendEntries.map((baseName) => {
          const color = profileColorMap[baseName];
          const config = heaterConfigs.find(c => getBaseProfileName(c.profileName) === baseName);
          const dur = config ? getCycleDuration(config) : null;
          return (
            <div key={baseName} className="flex items-center gap-1">
              <div className={cn("rounded-sm", color.legend, compact ? "w-2.5 h-2.5" : "w-3 h-3")} />
              <span className={cn(compact ? "text-[9px]" : "text-[10px]", "text-muted-foreground")}>
                {baseName}
                {dur && !compact ? ` (${dur.toFixed(1)}s)` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
