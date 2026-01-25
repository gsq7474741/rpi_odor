"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, OctagonX, RotateCcw } from "lucide-react";

export function EmergencyStopButton() {
  const [loading, setLoading] = useState(false);
  const [firmwareReady, setFirmwareReady] = useState(true);
  const [restartLoading, setRestartLoading] = useState(false);

  // 轮询后端状态检测物理急停
  const checkFirmwareStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        if (typeof data.firmwareReady === 'boolean') {
          setFirmwareReady(data.firmwareReady);
        }
      }
    } catch {
      // 忽略网络错误
    }
  }, []);

  useEffect(() => {
    // 初始检查
    checkFirmwareStatus();
    // 每 2 秒轮询一次
    const interval = setInterval(checkFirmwareStatus, 2000);
    return () => clearInterval(interval);
  }, [checkFirmwareStatus]);

  const handleEmergencyStop = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/emergency-stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFirmwareReady(false);
      }
    } catch (err) {
      console.error("Emergency stop error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFirmwareRestart = async () => {
    setRestartLoading(true);
    try {
      const res = await fetch('/api/firmware-restart', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFirmwareReady(true);
      }
    } catch (err) {
      console.error("Firmware restart error:", err);
    } finally {
      setRestartLoading(false);
    }
  };

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
      {!firmwareReady && (
        <Button
          variant="outline"
          size="sm"
          className="border-orange-400 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 shadow-sm h-8"
          disabled={restartLoading}
          onClick={handleFirmwareRestart}
        >
          {restartLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          <span className="ml-1.5 text-xs">重启固件</span>
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        className="bg-red-500 hover:bg-red-600 shadow-sm h-8 px-3"
        disabled={loading}
        onClick={handleEmergencyStop}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <OctagonX className="w-3.5 h-3.5" />}
        <span className="ml-1.5 text-xs font-medium">急停</span>
      </Button>
    </div>
  );
}
