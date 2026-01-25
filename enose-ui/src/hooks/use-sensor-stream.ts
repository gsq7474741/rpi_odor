"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

const RECONNECT_DELAY_MS = 2000;
const CONNECTION_TIMEOUT_MS = 2000;

// ============================================================
// Sensor Status Stream
// ============================================================

export interface SensorStatus {
  connected: boolean;
  running: boolean;
  sensorCount: number;
  firmwareVersion: string;
  port: string;
}

interface SensorStatusStreamState {
  status: SensorStatus | null;
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

const initialSensorStatus: SensorStatus = {
  connected: false,
  running: false,
  sensorCount: 0,
  firmwareVersion: '',
  port: '',
};

export function useSensorStatusStream(): SensorStatusStreamState {
  const [state, setState] = useState<SensorStatusStreamState>({
    status: initialSensorStatus,
    connected: false,
    lastUpdate: 0,
    error: null,
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    const eventSource = new EventSource('/api/sensor/status/stream');
    eventSourceRef.current = eventSource;

    connectionTimeoutRef.current = setTimeout(() => {
      if (eventSource.readyState !== EventSource.OPEN) {
        setState(prev => ({ ...prev, connected: false, error: 'Connection timeout' }));
        eventSource.close();
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
          setState({
            status: statusData as SensorStatus,
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
      } catch {}
    };

    eventSource.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
      eventSource.close();
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

  return state;
}

// ============================================================
// Sensor Readings Stream
// ============================================================

export interface SensorReading {
  timestamp: number;
  sensorIndex: number;
  temperature: number;
  humidity: number;
  pressure: number;
  gasResistance: number;
  gasIndex: number;
}

interface SensorReadingsStreamState {
  readings: SensorReading[];
  connected: boolean;
  lastUpdate: number;
  error: string | null;
}

export function useSensorReadingsStream(enabled: boolean = true): SensorReadingsStreamState & { clearReadings: () => void } {
  const [state, setState] = useState<SensorReadingsStreamState>({
    readings: [],
    connected: false,
    lastUpdate: 0,
    error: null,
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    const eventSource = new EventSource('/api/sensor/readings/stream');
    eventSourceRef.current = eventSource;

    connectionTimeoutRef.current = setTimeout(() => {
      if (eventSource.readyState !== EventSource.OPEN) {
        setState(prev => ({ ...prev, connected: false, error: 'Connection timeout' }));
        eventSource.close();
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
          const { type, ...readingData } = data;
          setState(prev => ({
            readings: [...prev.readings.slice(-5000), readingData as SensorReading],
            connected: true,
            lastUpdate: readingData.timestamp || Date.now(),
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
        } else if (data.type === 'end') {
          // gRPC stream ended, try to reconnect
          eventSource.close();
          reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      } catch {}
    };

    eventSource.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
      eventSource.close();
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

  const clearReadings = useCallback(() => {
    setState(prev => ({ ...prev, readings: [] }));
  }, []);

  return { ...state, clearReadings };
}
