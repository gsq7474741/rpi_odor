"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Square, Trash2, Download, RefreshCw } from "lucide-react";

interface LogEntry {
  timestamp: Date;
  content: string;
  type: "log" | "error";
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource("/api/logs/stream?lines=100");
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.log) {
          const lines = data.log.split("\n").filter((line: string) => line.trim());
          const newEntries: LogEntry[] = lines.map((line: string) => ({
            timestamp: new Date(),
            content: line,
            type: "log" as const,
          }));
          setLogs((prev) => [...prev, ...newEntries].slice(-1000));
        }

        if (data.error) {
          setLogs((prev) => [
            ...prev,
            { timestamp: new Date(), content: data.error, type: "error" as const },
          ].slice(-1000));
        }

        if (data.closed) {
          setIsConnected(false);
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
    };
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const downloadLogs = useCallback(() => {
    const content = logs.map((log) => log.content).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enose-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">服务日志</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-4">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm text-muted-foreground">
              {isConnected ? "已连接" : "未连接"}
            </span>
          </div>

          {isConnected ? (
            <Button variant="outline" size="sm" onClick={disconnect}>
              <Square className="w-4 h-4 mr-1" />
              停止
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={connect}>
              <Play className="w-4 h-4 mr-1" />
              连接
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => { disconnect(); clearLogs(); connect(); }}>
            <RefreshCw className="w-4 h-4 mr-1" />
            重连
          </Button>

          <Button variant="outline" size="sm" onClick={clearLogs}>
            <Trash2 className="w-4 h-4 mr-1" />
            清空
          </Button>

          <Button variant="outline" size="sm" onClick={downloadLogs} disabled={logs.length === 0}>
            <Download className="w-4 h-4 mr-1" />
            下载
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="py-3 px-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              enose-control 输出 ({logs.length} 行)
            </CardTitle>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded"
              />
              自动滚动
            </label>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full" ref={scrollAreaRef}>
            <div className="p-4 font-mono text-xs space-y-0.5">
              {logs.length === 0 ? (
                <div className="text-muted-foreground text-center py-8">
                  {isConnected ? "等待日志..." : "点击「连接」开始查看日志"}
                </div>
              ) : (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className={`whitespace-pre-wrap break-all ${
                      log.type === "error" ? "text-red-500" : "text-foreground"
                    }`}
                  >
                    {log.content}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
