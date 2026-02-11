import { useState, useEffect, useRef, useCallback } from "react";

interface ServiceHealth {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

interface InfraHealthState {
  timescaledb: ServiceHealth;
  redis: ServiceHealth;
  minio: ServiceHealth;
  lastCheck: number;
}

const POLL_INTERVAL = 10000; // 每 10 秒检查一次（基础设施变化慢，不需要太频繁）

const defaultService: ServiceHealth = { ok: false, latencyMs: null };

export function useInfraHealth() {
  const [state, setState] = useState<InfraHealthState>({
    timescaledb: defaultService,
    redis: defaultService,
    minio: defaultService,
    lastCheck: 0,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      setState({
        timescaledb: data.services?.timescaledb ?? defaultService,
        redis: data.services?.redis ?? defaultService,
        minio: data.services?.minio ?? defaultService,
        lastCheck: data.timestamp ?? Date.now(),
      });
    } catch {
      setState((prev) => ({
        ...prev,
        timescaledb: { ok: false, latencyMs: null },
        redis: { ok: false, latencyMs: null },
        minio: { ok: false, latencyMs: null },
      }));
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check]);

  return state;
}
