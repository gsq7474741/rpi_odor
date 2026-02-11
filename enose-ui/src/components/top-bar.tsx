"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Moon,
  OctagonX,
  Power,
  RotateCcw,
  Settings,
  Square,
  Sun,
  Monitor,
  Wifi,
  WifiOff,
  Cpu,
  Radio,
  Cog,
  Database,
  HardDrive,
  Container,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useStatusStream } from "@/hooks/use-status-stream";
import { useLatency } from "@/hooks/use-latency";
import { useAnalyticsLatency } from "@/hooks/use-analytics-latency";
import { useInfraHealth } from "@/hooks/use-infra-health";
import { useSettings } from "@/hooks/use-settings";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ============================================================
// 全组件状态指示器
// ============================================================
interface ServiceHealth {
  ok: boolean;
  latencyMs: number | null;
}

interface ComponentStatusProps {
  latencyConnected: boolean;
  rtt: number | null;
  avg: number | null;
  jitter: number | null;
  sseConnected: boolean;
  sensorConnected: boolean;
  moonrakerConnected: boolean;
  firmwareReady: boolean;
  analyticsConnected: boolean;
  analyticsRtt: number | null;
  infra: {
    timescaledb: ServiceHealth;
    redis: ServiceHealth;
    minio: ServiceHealth;
  };
}

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (warn) return <span className="block h-2 w-2 rounded-full bg-yellow-500" />;
  return <span className={`block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />;
}

function StatusRow({
  icon: Icon,
  label,
  ok,
  warn,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <span className="text-xs flex-1">{label}</span>
      <span className="text-xs text-muted-foreground font-mono">{detail}</span>
      <StatusDot ok={ok} warn={warn} />
    </div>
  );
}

function ComponentStatusIndicator({
  latencyConnected,
  rtt,
  avg,
  jitter,
  sseConnected,
  sensorConnected,
  moonrakerConnected,
  firmwareReady,
  analyticsConnected,
  analyticsRtt,
  infra,
}: ComponentStatusProps) {
  const getLatencyColor = (ms: number | null) => {
    if (ms === null) return "text-zinc-400";
    if (ms < 50) return "text-green-500";
    if (ms < 100) return "text-yellow-500";
    if (ms < 200) return "text-orange-500";
    return "text-red-500";
  };

  // 整体健康度
  const infraAllOk = infra.timescaledb.ok && infra.redis.ok && infra.minio.ok;
  const allOk = latencyConnected && sseConnected && sensorConnected && moonrakerConnected && firmwareReady && analyticsConnected && infraAllOk;
  const hasError = !latencyConnected || !sseConnected || !sensorConnected || !moonrakerConnected || !analyticsConnected || !infraAllOk;
  const hasWarn = !firmwareReady;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          {/* 紧凑状态点 */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  {/* 后端 */}
                  <StatusDot ok={latencyConnected} />
                  {/* 传感器 */}
                  <StatusDot ok={sensorConnected} />
                  {/* Moonraker */}
                  <StatusDot ok={moonrakerConnected} />
                  {/* 固件 */}
                  <StatusDot ok={firmwareReady} warn={!firmwareReady && moonrakerConnected} />
                  {/* Analytics */}
                  <StatusDot ok={analyticsConnected} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {allOk ? "所有组件正常" : hasError ? "部分组件离线" : "有警告"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* RTT 数字 */}
          {latencyConnected ? (
            <Wifi className={`w-3.5 h-3.5 ${getLatencyColor(rtt)}`} />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-500" />
          )}
          <span className={`text-xs font-mono ${getLatencyColor(rtt)}`}>
            {rtt !== null ? `${rtt}ms` : "--"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground mb-2">系统组件状态</p>
          <StatusRow
            icon={Cpu}
            label="后端 (gRPC)"
            ok={latencyConnected}
            detail={latencyConnected ? `${rtt ?? "-"}ms` : "离线"}
          />
          <StatusRow
            icon={Radio}
            label="传感器板 (ESP32)"
            ok={sensorConnected}
            detail={sensorConnected ? "在线" : "离线"}
          />
          <StatusRow
            icon={Cog}
            label="Moonraker"
            ok={moonrakerConnected}
            detail={moonrakerConnected ? "已连接" : "断开"}
          />
          <StatusRow
            icon={Cog}
            label="Klipper 固件"
            ok={firmwareReady}
            warn={!firmwareReady && moonrakerConnected}
            detail={firmwareReady ? "就绪" : "已停止"}
          />
          <StatusRow
            icon={Database}
            label="Analytics 服务"
            ok={analyticsConnected}
            detail={analyticsConnected ? `${analyticsRtt ?? "-"}ms` : "离线"}
          />

          {/* 基础设施 */}
          <div className="pt-2 mt-1 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1">基础设施 (Docker)</p>
            <StatusRow
              icon={Database}
              label="TimescaleDB"
              ok={infra.timescaledb.ok}
              detail={infra.timescaledb.ok ? `${infra.timescaledb.latencyMs ?? "-"}ms` : "离线"}
            />
            <StatusRow
              icon={HardDrive}
              label="Redis"
              ok={infra.redis.ok}
              detail={infra.redis.ok ? `${infra.redis.latencyMs ?? "-"}ms` : "离线"}
            />
            <StatusRow
              icon={Container}
              label="MinIO"
              ok={infra.minio.ok}
              detail={infra.minio.ok ? `${infra.minio.latencyMs ?? "-"}ms` : "离线"}
            />
          </div>

          {/* 详细延迟信息 */}
          {latencyConnected && (
            <div className="pt-2 mt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">延迟详情</p>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <div>
                  <span className="text-muted-foreground">RTT</span>
                  <div className={getLatencyColor(rtt)}>{rtt ?? "-"}ms</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg</span>
                  <div>{avg ?? "-"}ms</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Jitter</span>
                  <div>{jitter ?? "-"}ms</div>
                </div>
              </div>
            </div>
          )}

          {/* SSE 状态 */}
          <div className="pt-2 mt-1 border-t">
            <div className="flex items-center gap-2 text-xs">
              <Wifi className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">SSE 实时推送</span>
              <StatusDot ok={sseConnected} />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TopBar() {
  // 使用 SSE 获取状态（与 ControlPanel 共享同一连接）
  const { status, connected: sseConnected } = useStatusStream();
  // 端到端延迟测量
  const { rtt, avg, jitter, connected: latencyConnected } = useLatency();
  // Analytics 服务延迟
  const { rtt: analyticsRtt, connected: analyticsConnected } = useAnalyticsLatency();
  // 基础设施健康状态
  const infra = useInfraHealth();
  const [firmwareReady, setFirmwareReady] = useState(true);
  const [estopLoading, setEstopLoading] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { setSettingsOpen, connection: connectionSettings } = useSettings();
  const [mounted, setMounted] = useState(false);
  
  // 延迟等级颜色
  const getLatencyColor = (ms: number | null) => {
    if (ms === null) return "text-zinc-400";
    if (ms < 50) return "text-green-500";
    if (ms < 100) return "text-yellow-500";
    if (ms < 200) return "text-orange-500";
    return "text-red-500";
  };

  // 避免SSR hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 SSE 状态同步 firmwareReady
  useEffect(() => {
    if (status && typeof status.firmwareReady === 'boolean') {
      setFirmwareReady(status.firmwareReady);
      // 如果正在等待重启完成，检测到 ready 后停止 loading
      if (status.firmwareReady && restartLoading) {
        setRestartLoading(false);
      }
    }
  }, [status, restartLoading]);

  const handleEmergencyStop = async () => {
    setEstopLoading(true);
    try {
      const res = await fetch('/api/emergency-stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFirmwareReady(false);
      }
    } catch (err) {
      console.error("Emergency stop error:", err);
    } finally {
      setEstopLoading(false);
    }
  };

  const handleFirmwareRestart = async () => {
    setRestartLoading(true);
    try {
      await fetch('/api/firmware-restart', { method: 'POST' });
      // 不立即设置 firmwareReady，等待轮询检测到 ready
    } catch (err) {
      console.error("Firmware restart error:", err);
      setRestartLoading(false);
    }
  };

  const handleAction = async (action: string, endpoint: string) => {
    setActionLoading(action);
    try {
      await fetch(endpoint, { method: 'POST' });
    } catch (err) {
      console.error(`${action} error:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="h-12 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-4 shrink-0">
      {/* 左侧：标题 + 延迟指示器 */}
      <div className="flex items-center gap-3">
        <span className="text-zinc-700 dark:text-zinc-200 text-sm font-medium">Proj RPi Enose 电子鼻实验系统</span>
        
        {/* 全组件状态指示器 */}
        <ComponentStatusIndicator
          latencyConnected={latencyConnected}
          rtt={rtt}
          avg={avg}
          jitter={jitter}
          sseConnected={sseConnected}
          sensorConnected={status?.sensorConnected ?? false}
          moonrakerConnected={status?.moonrakerConnected ?? false}
          firmwareReady={firmwareReady}
          analyticsConnected={analyticsConnected}
          analyticsRtt={analyticsRtt}
          infra={{
            timescaledb: infra.timescaledb,
            redis: infra.redis,
            minio: infra.minio,
          }}
        />
      </div>

      {/* 右侧：急停 + 系统控制 */}
      <div className="flex items-center gap-2">
        {/* 重启固件按钮 (急停后显示) */}
        {!firmwareReady && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
            disabled={restartLoading}
            onClick={handleFirmwareRestart}
          >
            {restartLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-1.5" />
            )}
            <span className="text-xs">重启固件</span>
          </Button>
        )}

        {/* 急停按钮 */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 bg-red-600 hover:bg-red-700 text-white hover:text-white"
          disabled={estopLoading}
          onClick={handleEmergencyStop}
        >
          {estopLoading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <OctagonX className="w-4 h-4 mr-1.5" />
          )}
          <span className="text-xs font-medium">紧急停止</span>
        </Button>

        {/* 主题切换按钮 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800">
              {mounted && (
                <>
                  {theme === "light" && <Sun className="w-4 h-4" />}
                  {theme === "dark" && <Moon className="w-4 h-4" />}
                  {theme === "system" && <Monitor className="w-4 h-4" />}
                </>
              )}
              {!mounted && <Sun className="w-4 h-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer">
              <Sun className="w-4 h-4 mr-2" />
              浅色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer">
              <Moon className="w-4 h-4 mr-2" />
              深色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer">
              <Monitor className="w-4 h-4 mr-2" />
              自动
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 设置按钮 */}
        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800" onClick={() => setSettingsOpen(true)}>
          <Settings className="w-4 h-4" />
        </Button>

        {/* 电源菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800">
              <Power className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* Klipper Control */}
            <DropdownMenuLabel className="text-zinc-500 text-xs">Klipper 控制</DropdownMenuLabel>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer"
              onClick={() => handleAction('klipper-restart', '/api/system/klipper-restart')}
              disabled={actionLoading === 'klipper-restart'}
            >
              <span>重启</span>
              {actionLoading === 'klipper-restart' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer"
              onClick={handleFirmwareRestart}
              disabled={restartLoading}
            >
              <span>固件重启</span>
              {restartLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Service Control */}
            <DropdownMenuLabel className="text-zinc-500 text-xs">服务控制</DropdownMenuLabel>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer"
              onClick={() => handleAction('klipper-service', '/api/system/service-restart?service=klipper')}
              disabled={actionLoading === 'klipper-service'}
            >
              <span>Klipper</span>
              <div className="flex items-center gap-1">
                {actionLoading === 'klipper-service' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <Square className="w-3 h-3" />
                  </>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer"
              onClick={() => handleAction('moonraker-service', '/api/system/service-restart?service=moonraker')}
              disabled={actionLoading === 'moonraker-service'}
            >
              <span>Moonraker</span>
              <div className="flex items-center gap-1">
                {actionLoading === 'moonraker-service' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer"
              onClick={() => handleAction('enose-service', '/api/system/service-restart?service=enose-control')}
              disabled={actionLoading === 'enose-service'}
            >
              <span>E-Nose Control</span>
              <div className="flex items-center gap-1">
                {actionLoading === 'enose-service' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
              </div>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Host Control */}
            <DropdownMenuLabel className="text-zinc-500 text-xs">树莓派控制</DropdownMenuLabel>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer"
              onClick={() => handleAction('host-reboot', '/api/system/host-reboot')}
              disabled={actionLoading === 'host-reboot'}
            >
              <span>重启</span>
              {actionLoading === 'host-reboot' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Power className="w-4 h-4" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer text-red-600 focus:text-red-600"
              onClick={() => handleAction('host-shutdown', '/api/system/host-shutdown')}
              disabled={actionLoading === 'host-shutdown'}
            >
              <span>关机</span>
              {actionLoading === 'host-shutdown' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Power className="w-4 h-4" />
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
