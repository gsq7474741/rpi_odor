"use client";

import { useState, useEffect, useCallback } from "react";
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
  OctagonX,
  Power,
  RotateCcw,
  Settings,
  Square,
} from "lucide-react";

export function TopBar() {
  const [firmwareReady, setFirmwareReady] = useState(true);
  const [estopLoading, setEstopLoading] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 轮询后端状态检测物理急停
  const checkFirmwareStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        if (typeof data.firmwareReady === 'boolean') {
          setFirmwareReady(data.firmwareReady);
          // 如果正在等待重启完成，检测到 ready 后停止 loading
          if (data.firmwareReady && restartLoading) {
            setRestartLoading(false);
          }
        }
      }
    } catch {
      // 忽略网络错误
    }
  }, [restartLoading]);

  useEffect(() => {
    checkFirmwareStatus();
    const interval = setInterval(checkFirmwareStatus, 1000);
    return () => clearInterval(interval);
  }, [checkFirmwareStatus]);

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
    <div className="h-12 bg-white border-b border-zinc-200 flex items-center justify-between px-4 shrink-0">
      {/* 左侧：标题 */}
      <div className="flex items-center gap-3">
        <span className="text-zinc-700 text-sm font-medium">Proj RPi Enose 电子鼻实验系统</span>
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

        {/* 设置按钮 (预留) */}
        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100">
          <Settings className="w-4 h-4" />
        </Button>

        {/* 电源菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100">
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
