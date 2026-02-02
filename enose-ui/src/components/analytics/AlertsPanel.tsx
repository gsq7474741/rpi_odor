"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  RefreshCw,
  Settings,
} from "lucide-react";

interface QualityAlert {
  id: number;
  ts: string;
  flag: string;
  severity: string;
  message: string;
  channel: number;
  value: number;
  threshold: number;
  experimentId?: string;
}

const severityConfig: Record<
  string,
  { icon: React.ReactNode; color: string; label: string }
> = {
  INFO: {
    icon: <Info className="h-4 w-4" />,
    color: "bg-blue-100 text-blue-800",
    label: "信息",
  },
  WARNING: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: "bg-yellow-100 text-yellow-800",
    label: "警告",
  },
  ERROR: {
    icon: <AlertCircle className="h-4 w-4" />,
    color: "bg-red-100 text-red-800",
    label: "错误",
  },
  CRITICAL: {
    icon: <XCircle className="h-4 w-4" />,
    color: "bg-red-200 text-red-900",
    label: "严重",
  },
};

const flagLabels: Record<string, string> = {
  QF_BASELINE_UNSTABLE: "基线不稳定",
  QF_SENSOR_SATURATION: "传感器饱和",
  QF_EXCESS_NOISE: "噪声过大",
  QF_HUMIDITY_OUT_OF_RANGE: "湿度异常",
  QF_TEMP_OUT_OF_RANGE: "温度异常",
  QF_FLOW_SUSPECTED: "流量异常",
  QF_SENSOR_DRIFT: "传感器漂移",
  QF_SIGNAL_ANOMALY: "信号异常",
};

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<QualityAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all");

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (severityFilter !== "all") params.set("severity", severityFilter);
      if (flagFilter !== "all") params.set("flag", flagFilter);

      const response = await fetch(`/api/analytics/alerts?${params}`);
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts || []);
      }
    } catch (error) {
      console.error("Failed to fetch alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [severityFilter, flagFilter]);

  const getSeverityBadge = (severity: string) => {
    const config = severityConfig[severity] || severityConfig.INFO;
    return (
      <Badge variant="outline" className={config.color}>
        {config.icon}
        <span className="ml-1">{config.label}</span>
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">总告警数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alerts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600">
              严重/错误
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {
                alerts.filter(
                  (a) => a.severity === "CRITICAL" || a.severity === "ERROR"
                ).length
              }
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600">
              警告
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {alerts.filter((a) => a.severity === "WARNING").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600">
              信息
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {alerts.filter((a) => a.severity === "INFO").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 过滤器 */}
      <Card>
        <CardHeader>
          <CardTitle>告警列表</CardTitle>
          <CardDescription>实时质量检测告警记录</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="严重程度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部级别</SelectItem>
                <SelectItem value="INFO">信息</SelectItem>
                <SelectItem value="WARNING">警告</SelectItem>
                <SelectItem value="ERROR">错误</SelectItem>
                <SelectItem value="CRITICAL">严重</SelectItem>
              </SelectContent>
            </Select>

            <Select value={flagFilter} onValueChange={setFlagFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="告警类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {Object.entries(flagLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button variant="outline" onClick={fetchAlerts} disabled={loading}>
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
              />
              刷新
            </Button>

            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              配置
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">时间</TableHead>
                <TableHead className="w-[100px]">级别</TableHead>
                <TableHead className="w-[140px]">类型</TableHead>
                <TableHead className="w-[80px]">通道</TableHead>
                <TableHead>消息</TableHead>
                <TableHead className="w-[120px]">值/阈值</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    暂无告警数据
                  </TableCell>
                </TableRow>
              ) : (
                alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-mono text-sm">
                      {new Date(alert.ts).toLocaleString()}
                    </TableCell>
                    <TableCell>{getSeverityBadge(alert.severity)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {flagLabels[alert.flag] || alert.flag}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {alert.channel >= 0 ? `CH${alert.channel}` : "全局"}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {alert.message}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {alert.value.toFixed(3)} / {alert.threshold.toFixed(3)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
