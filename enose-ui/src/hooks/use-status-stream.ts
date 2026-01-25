"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SystemStatus } from "@/lib/api";

const RECONNECT_DELAY_MS = 2000;
const CONNECTION_TIMEOUT_MS = 2000;

interface StatusStreamState {
  status: SystemStatus | null;
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

const initialStatus: SystemStatus = {
  currentState: 0,
  peripheralStatus: {
    valveWaste: 0,
    valvePinch: 0,
    valveAir: 0,
    valveOutlet: 0,
    airPumpPwm: 0,
    cleaningPump: 0,
    pump0: 1,
    pump1: 1,
    pump2: 1,
    pump3: 1,
    pump4: 1,
    pump5: 1,
    pump6: 1,
    pump7: 1,
    heaterChamber: 0,
    sensorChamberTemp: undefined,
    scaleWeight: undefined,
  },
  moonrakerConnected: false,
  sensorConnected: false,
  firmwareReady: true,
};

export function useStatusStream(): StatusStreamState & { refreshStatus: () => void } {
  const [state, setState] = useState<StatusStreamState>({
    status: initialStatus,
    connected: false,
    lastUpdate: 0,
    error: null,
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // 清理之前的连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    const eventSource = new EventSource('/api/status/stream');
    eventSourceRef.current = eventSource;

    // 连接超时检测
    connectionTimeoutRef.current = setTimeout(() => {
      if (eventSource.readyState !== EventSource.OPEN) {
        setState(prev => ({ ...prev, connected: false, error: 'Connection timeout' }));
        eventSource.close();
        // 重连
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    }, CONNECTION_TIMEOUT_MS);

    eventSource.onopen = () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      setState(prev => ({ ...prev, connected: true, error: null }));
    };

    eventSource.onmessage = (event) => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'status') {
          const { type, timestamp, ...statusData } = data;
          setState(prev => ({
            status: {
              ...initialStatus,
              ...prev.status,
              ...statusData,
              peripheralStatus: {
                ...initialStatus.peripheralStatus,
                ...prev.status?.peripheralStatus,
                ...statusData.peripheralStatus,
              },
            } as SystemStatus,
            connected: true,
            lastUpdate: timestamp || Date.now(),
            error: null,
          }));
        } else if (data.type === 'error') {
          setState(prev => ({
            ...prev,
            connected: true,
            error: data.message,
            lastUpdate: data.timestamp || Date.now(),
          }));
        } else if (data.type === 'heartbeat') {
          setState(prev => ({
            ...prev,
            connected: true,
            lastUpdate: data.timestamp || Date.now(),
          }));
        }
      } catch {
        // JSON 解析失败，忽略
      }
    };

    eventSource.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
      eventSource.close();
      // 自动重连
      reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, [connect]);

  const refreshStatus = useCallback(() => {
    // 强制重连以获取最新状态
    connect();
  }, [connect]);

  return { ...state, refreshStatus };
}
