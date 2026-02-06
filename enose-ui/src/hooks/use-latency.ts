import { useState, useEffect, useRef, useCallback } from "react";
import { useSettings } from "@/hooks/use-settings";

interface LatencyState {
  rtt: number | null;        // 完整往返时间 (ms)
  grpcTime: number | null;   // gRPC 调用时间 (ms)
  connected: boolean;        // 后端是否连接
  history: number[];         // 最近 N 次延迟记录
  avg: number | null;        // 平均延迟
  jitter: number | null;     // 抖动 (标准差)
}

const HISTORY_SIZE = 10;     // 保留最近 10 次测量
export function useLatency() {
  const pingIntervalMs = useSettings((s) => s.connection.pingIntervalMs);
  const [state, setState] = useState<LatencyState>({
    rtt: null,
    grpcTime: null,
    connected: false,
    history: [],
    avg: null,
    jitter: null,
  });
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const ping = useCallback(async () => {
    const startTime = performance.now();
    
    try {
      const res = await fetch("/api/ping", { 
        cache: "no-store",
        signal: AbortSignal.timeout(5000),  // 5秒超时
      });
      const endTime = performance.now();
      const browserRtt = Math.round(endTime - startTime);
      
      const data = await res.json();
      
      setState(prev => {
        // 使用浏览器测量的 RTT（更准确）
        const newRtt = browserRtt;
        const newHistory = [...prev.history, newRtt].slice(-HISTORY_SIZE);
        
        // 计算平均值
        const avg = newHistory.length > 0
          ? Math.round(newHistory.reduce((a, b) => a + b, 0) / newHistory.length)
          : null;
        
        // 计算抖动 (标准差)
        let jitter: number | null = null;
        if (newHistory.length >= 2 && avg !== null) {
          const variance = newHistory.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / newHistory.length;
          jitter = Math.round(Math.sqrt(variance));
        }
        
        return {
          rtt: newRtt,
          grpcTime: data.grpcTime ?? null,
          connected: data.success && data.connected,
          history: newHistory,
          avg,
          jitter,
        };
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        rtt: null,
        grpcTime: null,
        connected: false,
      }));
    }
  }, []);
  
  useEffect(() => {
    // 立即执行一次
    ping();
    
    // 设置定时器
    intervalRef.current = setInterval(ping, pingIntervalMs);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [ping, pingIntervalMs]);
  
  return {
    ...state,
    ping,  // 暴露手动 ping 方法
  };
}
