'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface ExperimentStatus {
  state: number;
  programId: string;
  currentStepIndex: number;
  currentStepName: string;
  loopIteration: number;
  loopTotal: number;
  progressPercent: number;
  elapsedS: number;
  remainingS: number;
  message: string;
  logs: string[];
  error: string;
  timestamp: number;
}

export function useExperimentStream(enabled: boolean = true) {
  const [status, setStatus] = useState<ExperimentStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;
    
    // 关闭现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const eventSource = new EventSource('/api/run/stream');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ExperimentStatus;
          setStatus(data);
          if (data.error) {
            setError(data.error);
          }
        } catch (e) {
          console.error('解析 SSE 数据失败:', e);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();
        
        // 3秒后重连
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (enabled) {
            connect();
          }
        }, 3000);
      };
    } catch (e) {
      console.error('创建 SSE 连接失败:', e);
      setError('连接失败');
    }
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
    setIsConnected(false);
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

  return {
    status,
    isConnected,
    error,
    reconnect: connect,
  };
}
