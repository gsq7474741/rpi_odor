"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, ChevronDown, ChevronUp, Activity, Thermometer, Droplets, Zap, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { useState } from "react";

// ============================================================
// Types (临时定义, Proto 生成后会替换)
// ============================================================

interface SensorHealth {
  sensorIdx: number;
  alive: boolean;
  completedCycles: number;
  cycleCv: number;
  saturated: boolean;
  responseRatio: number;
  heaterProfile: string;
}

interface QualityAlert {
  id: string;
  flag: string;
  severity: string;
  message: string;
  sensorIdx: number;
  heaterStep: number;
  value: number;
  threshold: number;
  firstSeenMs: number;
  lastSeenMs: number;
  count: number;
}

export interface DataQualitySnapshot {
  overallLevel: number; // 0=UNKNOWN,1=GOOD,2=WARNING,3=POOR
  activeAlertCount: number;
  alerts: QualityAlert[];
  qualityScore: number;
  sensorHealth: SensorHealth[];
  currentTempC: number;
  currentHumidityPct: number;
  envStable: boolean;
  completedCycles: number;
  meanCycleCv: number;
}

// ============================================================
// Helpers
// ============================================================

function qualityLevelInfo(level: number) {
  switch (level) {
    case 1: return { label: "良好", color: "bg-green-500", textColor: "text-green-700", icon: ShieldCheck, variant: "default" as const };
    case 2: return { label: "警告", color: "bg-yellow-500", textColor: "text-yellow-700", icon: ShieldAlert, variant: "secondary" as const };
    case 3: return { label: "差", color: "bg-red-500", textColor: "text-red-700", icon: ShieldX, variant: "destructive" as const };
    default: return { label: "未知", color: "bg-gray-400", textColor: "text-gray-500", icon: Activity, variant: "outline" as const };
  }
}

function severityColor(severity: string) {
  switch (severity) {
    case "ERROR": return "destructive";
    case "WARNING": return "secondary";
    default: return "outline";
  }
}

function formatCv(cv: number): string {
  return (cv * 100).toFixed(1) + "%";
}

// ============================================================
// QualityBadge — 紧凑的质量指示器
// ============================================================

export function QualityBadge({ quality }: { quality?: DataQualitySnapshot }) {
  if (!quality || quality.overallLevel === 0) return null;
  
  const info = qualityLevelInfo(quality.overallLevel);
  const Icon = info.icon;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={info.variant} className="gap-1 cursor-default">
            <Icon className="h-3 w-3" />
            <span>{Math.round(quality.qualityScore)}</span>
            {quality.activeAlertCount > 0 && (
              <span className="ml-0.5 text-xs">({quality.activeAlertCount})</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>数据质量: {info.label} ({quality.qualityScore.toFixed(1)}分)</p>
          {quality.activeAlertCount > 0 && (
            <p className="text-xs text-muted-foreground">{quality.activeAlertCount} 个活跃告警</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================
// QualityMonitor — 详细的质量监控面板
// ============================================================

export function QualityMonitor({ quality }: { quality?: DataQualitySnapshot }) {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!quality || quality.overallLevel === 0) {
    return null;
  }
  
  const info = qualityLevelInfo(quality.overallLevel);
  const Icon = info.icon;
  const aliveSensors = quality.sensorHealth?.filter(s => s.alive).length ?? 0;
  const totalSensors = quality.sensorHealth?.length ?? 8;
  
  return (
    <Card className="border-l-4" style={{ borderLeftColor: quality.overallLevel === 1 ? '#22c55e' : quality.overallLevel === 2 ? '#eab308' : '#ef4444' }}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer py-3 px-4 hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${info.textColor}`} />
                <CardTitle className="text-sm font-medium">
                  数据质量
                </CardTitle>
                <Badge variant={info.variant} className="text-xs">
                  {Math.round(quality.qualityScore)}分 · {info.label}
                </Badge>
              </div>
              
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {aliveSensors}/{totalSensors}
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {quality.completedCycles} 周期
                </span>
                <span className="flex items-center gap-1">
                  <Thermometer className="h-3 w-3" />
                  {quality.currentTempC.toFixed(1)}°C
                </span>
                <span className="flex items-center gap-1">
                  <Droplets className="h-3 w-3" />
                  {quality.currentHumidityPct.toFixed(0)}%
                </span>
                {quality.activeAlertCount > 0 && (
                  <Badge variant="destructive" className="text-xs h-5">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {quality.activeAlertCount}
                  </Badge>
                )}
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4 space-y-4">
            {/* 传感器健康状态 */}
            {quality.sensorHealth && quality.sensorHealth.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">传感器状态</h4>
                <div className="grid grid-cols-4 gap-2">
                  {quality.sensorHealth.map((sensor) => (
                    <SensorHealthCard key={sensor.sensorIdx} sensor={sensor} />
                  ))}
                </div>
              </div>
            )}
            
            {/* 环境状态 */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">环境参数</h4>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Thermometer className="h-4 w-4 text-muted-foreground" />
                  <span>{quality.currentTempC.toFixed(1)}°C</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Droplets className="h-4 w-4 text-muted-foreground" />
                  <span>{quality.currentHumidityPct.toFixed(1)}%</span>
                </div>
                <Badge variant={quality.envStable ? "default" : "secondary"} className="text-xs">
                  {quality.envStable ? "稳定" : "波动中"}
                </Badge>
                {quality.meanCycleCv > 0 && (
                  <span className="text-xs text-muted-foreground">
                    平均 CV: {formatCv(quality.meanCycleCv)}
                  </span>
                )}
              </div>
            </div>
            
            {/* 活跃告警 */}
            {quality.alerts && quality.alerts.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  活跃告警 ({quality.alerts.length})
                </h4>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {quality.alerts.map((alert) => (
                    <AlertItem key={alert.id} alert={alert} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ============================================================
// SensorHealthCard
// ============================================================

function SensorHealthCard({ sensor }: { sensor: SensorHealth }) {
  const bgColor = !sensor.alive
    ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
    : sensor.saturated
    ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
    : "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800";
  
  const dotColor = !sensor.alive ? "bg-red-500" : sensor.saturated ? "bg-yellow-500" : "bg-green-500";
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`rounded-md border p-2 text-xs ${bgColor}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">S{sensor.sensorIdx}</span>
              <span className={`h-2 w-2 rounded-full ${dotColor}`} />
            </div>
            <div className="text-muted-foreground space-y-0.5">
              <div>{sensor.completedCycles} 周期</div>
              {sensor.cycleCv > 0 && <div>CV {formatCv(sensor.cycleCv)}</div>}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>传感器 S{sensor.sensorIdx}</p>
          <p>配置: {sensor.heaterProfile || "默认"}</p>
          <p>状态: {sensor.alive ? "在线" : "离线"}</p>
          {sensor.saturated && <p className="text-yellow-500">饱和中</p>}
          {sensor.responseRatio > 0 && <p>响应比: {(sensor.responseRatio * 100).toFixed(1)}%</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================
// AlertItem
// ============================================================

function AlertItem({ alert }: { alert: QualityAlert }) {
  return (
    <div className="flex items-start gap-2 text-xs p-2 rounded-md bg-muted/50">
      <Badge variant={severityColor(alert.severity) as any} className="text-[10px] shrink-0 mt-0.5">
        {alert.severity}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="truncate">{alert.message}</p>
        {alert.count > 1 && (
          <p className="text-muted-foreground">出现 {alert.count} 次</p>
        )}
      </div>
      {alert.sensorIdx >= 0 && (
        <span className="text-muted-foreground shrink-0">S{alert.sensorIdx}</span>
      )}
    </div>
  );
}
