"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

const RECONNECT_DELAY_MS = 2000;
const CONNECTION_TIMEOUT_MS = 2000;

export interface LoadCellReading {
  weightGrams: number;
  rawPercent: number;
  isCalibrated: boolean;
  isStable: boolean;
  trend: number;
}

interface LoadCellStreamState {
  reading: LoadCellReading | null;
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

const initialReading: LoadCellReading = {
  weightGrams: 0,
  rawPercent: 0,
  isCalibrated: false,
  isStable: false,
  trend: 0,
};

export function useLoadCellStream(enabled: boolean = true): LoadCellStreamState {
  const [state, setState] = useState<LoadCellStreamState>({
    reading: initialReading,
    connected: false,
    lastUpdate: 0,
    error: null,
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;
    
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

    const eventSource = new EventSource('/api/load-cell/reading/stream');
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
        
        if (data.type === 'reading') {
          const { type, timestamp, ...readingData } = data;
          setState({
            reading: {
              weightGrams: readingData.weightGrams ?? 0,
              rawPercent: readingData.rawPercent ?? 0,
              isCalibrated: readingData.isCalibrated ?? false,
              isStable: readingData.isStable ?? false,
              trend: readingData.trend ?? 0,
            },
            connected: true,
            lastUpdate: timestamp || Date.now(),
            error: null,
          });
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
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  }, [enabled]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    setState(prev => ({ ...prev, connected: false }));
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
    
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return state;
}
