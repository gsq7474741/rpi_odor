import { useState, useEffect, useRef, useCallback } from "react";

interface AnalyticsLatencyState {
  rtt: number | null;
  connected: boolean;
  history: number[];
  avg: number | null;
  jitter: number | null;
}

const HISTORY_SIZE = 10;
const PING_INTERVAL = 3000; // 每 3 秒 ping 一次

export function useAnalyticsLatency() {
  const [state, setState] = useState<AnalyticsLatencyState>({
    rtt: null,
    connected: false,
    history: [],
    avg: null,
    jitter: null,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const ping = useCallback(async () => {
    const startTime = performance.now();

    try {
      const res = await fetch("/api/analytics/ping", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const endTime = performance.now();
      const browserRtt = Math.round(endTime - startTime);

      const data = await res.json();

      setState((prev) => {
        const newRtt = browserRtt;
        const newHistory = [...prev.history, newRtt].slice(-HISTORY_SIZE);

        const avg =
          newHistory.length > 0
            ? Math.round(
                newHistory.reduce((a, b) => a + b, 0) / newHistory.length
              )
            : null;

        let jitter: number | null = null;
        if (newHistory.length >= 2 && avg !== null) {
          const variance =
            newHistory.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
            newHistory.length;
          jitter = Math.round(Math.sqrt(variance));
        }

        return {
          rtt: newRtt,
          connected: data.success && data.connected,
          history: newHistory,
          avg,
          jitter,
        };
      });
    } catch {
      setState((prev) => ({
        ...prev,
        rtt: null,
        connected: false,
      }));
    }
  }, []);

  useEffect(() => {
    ping();
    intervalRef.current = setInterval(ping, PING_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [ping]);

  return {
    ...state,
    ping,
  };
}
