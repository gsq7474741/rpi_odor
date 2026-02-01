"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Beaker, Droplets, Filter, RotateCcw, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Wind, MoreHorizontal, Pencil, Copy, Settings2, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Liquid {
  id: number;
  name: string;
  type: number;
  description: string;
  density: number;
  metadataJson: string;
  isActive: boolean;
}

interface PumpAssignment {
  pumpIndex: number;
  liquidId?: number;
  liquid?: Liquid;
  notes: string;
  initialVolumeMl: number;
  consumedVolumeMl: number;
  remainingVolumeMl: number;
  lowVolumeThresholdMl: number;
  isLowVolume: boolean;
}

interface Consumable {
  id: string;
  name: string;
  type: number;
  accumulatedSeconds: string;
  lifetimeSeconds: string;
  warningThreshold: number;
  criticalThreshold: number;
  status: number;
  remainingRatio: number;
  remainingSeconds: string;
}

interface MetadataField {
  id: number;
  entityType: string;
  fieldKey: string;
  fieldName: string;
  fieldType: number;
  description: string;
  isRequired: boolean;
  defaultValue: string;
  optionsJson: string;
  displayOrder: number;
  isActive: boolean;
}

const FIELD_TYPES = [
  { value: 1, label: "文本", icon: "Aa" },
  { value: 2, label: "数字", icon: "#" },
  { value: 3, label: "布尔", icon: "☑" },
  { value: 4, label: "单选", icon: "○" },
  { value: 5, label: "多选", icon: "☐" },
  { value: 6, label: "标签", icon: "🏷" },
  { value: 10, label: "日期", icon: "📅" },
];

export default function ConsumablesPage() {
  const [liquids, setLiquids] = useState<Liquid[]>([]);
  const [pumps, setPumps] = useState<PumpAssignment[]>([]);
  const [washPumps, setWashPumps] = useState<PumpAssignment[]>([]);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [metadataFields, setMetadataFields] = useState<MetadataField[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLiquid, setNewLiquid] = useState({ name: "", type: "sample", description: "", density: 1.0 });
  const [liquidMetadata, setLiquidMetadata] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<MetadataField | null>(null);
  const [newField, setNewField] = useState({
    fieldKey: "",
    fieldName: "",
    fieldType: 1,
    description: "",
    isRequired: false,
    defaultValue: "",
    optionsJson: "[]",
  });

  const fetchData = useCallback(async () => {
    try {
      const [liquidsRes, pumpsRes, washPumpsRes, consumablesRes, fieldsRes] = await Promise.all([
        fetch("/api/consumables?type=liquids"),
        fetch("/api/consumables?type=pumps"),
        fetch("/api/consumables?type=wash-pumps"),
        fetch("/api/consumables?type=consumables"),
        fetch("/api/consumables?type=fields&entity=liquid"),
      ]);
      
      const liquidsData = await liquidsRes.json();
      const pumpsData = await pumpsRes.json();
      const washPumpsData = await washPumpsRes.json();
      const consumablesData = await consumablesRes.json();
      const fieldsData = await fieldsRes.json();
      
      setLiquids(liquidsData.liquids || []);
      setPumps(pumpsData.assignments || []);
      setWashPumps(washPumpsData.assignments || []);
      setConsumables(consumablesData.consumables || []);
      setMetadataFields(fieldsData.fields || []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateLiquid = async () => {
    try {
      const res = await fetch("/api/consumables?action=create-liquid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newLiquid,
          metadataJson: JSON.stringify(liquidMetadata),
        }),
      });
      if (res.ok) {
        setDialogOpen(false);
        setNewLiquid({ name: "", type: "sample", description: "", density: 1.0 });
        setLiquidMetadata({});
        fetchData();
      }
    } catch (error) {
      console.error("创建失败:", error);
    }
  };

  const handleCreateField = async () => {
    try {
      const res = await fetch("/api/consumables?action=create-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "liquid",
          ...newField,
        }),
      });
      if (res.ok) {
        setFieldDialogOpen(false);
        setNewField({
          fieldKey: "",
          fieldName: "",
          fieldType: 1,
          description: "",
          isRequired: false,
          defaultValue: "",
          optionsJson: "[]",
        });
        fetchData();
      }
    } catch (error) {
      console.error("创建字段失败:", error);
    }
  };

  const handleUpdateField = async () => {
    if (!editingField) return;
    try {
      const res = await fetch("/api/consumables?action=update-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingField.id,
          fieldName: editingField.fieldName,
          description: editingField.description,
          isRequired: editingField.isRequired,
          defaultValue: editingField.defaultValue,
          optionsJson: editingField.optionsJson,
          displayOrder: editingField.displayOrder,
          isActive: editingField.isActive,
        }),
      });
      if (res.ok) {
        setEditingField(null);
        fetchData();
      }
    } catch (error) {
      console.error("更新字段失败:", error);
    }
  };

  const handleDeleteField = async (id: number) => {
    try {
      const res = await fetch("/api/consumables?action=delete-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("删除字段失败:", error);
    }
  };

  const handleDeleteLiquid = async (id: number) => {
    try {
      const res = await fetch("/api/consumables?action=delete-liquid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("删除失败:", error);
    }
  };

  const handleSetPump = async (pumpIndex: number, liquidId: number | null) => {
    try {
      const res = await fetch("/api/consumables?action=set-pump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pumpIndex, liquidId }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("配置失败:", error);
    }
  };

  const handleResetConsumable = async (consumableId: string) => {
    try {
      const res = await fetch("/api/consumables?action=reset-consumable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consumableId, notes: "手动重置" }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("重置失败:", error);
    }
  };

  const handleSetPumpVolume = async (pumpIndex: number, volumeMl: number) => {
    try {
      const res = await fetch("/api/consumables?action=set-pump-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          pumpIndex, 
          initialVolumeMl: volumeMl,
          resetConsumed: true 
        }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("设置容量失败:", error);
    }
  };

  const handleSetWashPump = async (pumpIndex: number, liquidId: number | null) => {
    try {
      const res = await fetch("/api/consumables?action=set-wash-pump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pumpIndex, liquidId }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("配置清洗泵失败:", error);
    }
  };

  const handleSetWashPumpVolume = async (pumpIndex: number, volumeMl: number) => {
    try {
      const res = await fetch("/api/consumables?action=set-wash-pump-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          pumpIndex, 
          initialVolumeMl: volumeMl,
          resetConsumed: true 
        }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("设置清洗泵容量失败:", error);
    }
  };

  const formatDuration = (seconds: string) => {
    const s = parseInt(seconds) || 0;
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    return `${hours}小时${minutes}分钟`;
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 2:
        return <Badge variant="destructive">危险</Badge>;
      case 1:
        return <Badge variant="secondary" className="bg-yellow-500 text-white">警告</Badge>;
      default:
        return <Badge variant="secondary" className="bg-green-500 text-white">正常</Badge>;
    }
  };

  const getLiquidTypeName = (type: number) => {
    switch (type) {
      case 1: return "样品";
      case 2: return "清洗液";
      default: return "其他";
    }
  };

  const getLiquidTypeBadge = (type: number) => {
    switch (type) {
      case 1:
        return <Badge className="bg-blue-500 hover:bg-blue-600">样品</Badge>;
      case 2:
        return <Badge className="bg-cyan-500 hover:bg-cyan-600">清洗液</Badge>;
      default:
        return <Badge variant="secondary">其他</Badge>;
    }
  };

  const liquidColumns: ColumnDef<Liquid>[] = useMemo(() => {
    const baseColumns: ColumnDef<Liquid>[] = [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="ID" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">#{row.getValue("id")}</span>
        ),
        size: 80,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="名称" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.type === 2 ? (
              <Droplets className="h-4 w-4 text-cyan-500" />
            ) : (
              <Beaker className="h-4 w-4 text-blue-500" />
            )}
            <span className="font-medium">{row.getValue("name")}</span>
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="类型" />
        ),
        cell: ({ row }) => getLiquidTypeBadge(row.getValue("type")),
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id));
        },
        size: 100,
      },
      {
        accessorKey: "density",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="密度 (g/ml)" />
        ),
        cell: ({ row }) => (
          <span className="font-mono">{(row.getValue("density") as number).toFixed(3)}</span>
        ),
        size: 120,
      },
    ];

    // 动态添加元数据列
    const metadataColumns: ColumnDef<Liquid>[] = metadataFields.map((field) => ({
      id: `meta_${field.fieldKey}`,
      header: field.fieldName,
      cell: ({ row }) => {
        try {
          const metadata = JSON.parse(row.original.metadataJson || "{}");
          const value = metadata[field.fieldKey];
          if (value === undefined || value === null || value === "") return <span className="text-muted-foreground">-</span>;
          if (field.fieldType === 3) return value === "true" ? "是" : "否";
          return <span>{String(value)}</span>;
        } catch {
          return <span className="text-muted-foreground">-</span>;
        }
      },
      size: 120,
    }));

    const endColumns: ColumnDef<Liquid>[] = [
      {
        accessorKey: "description",
        header: "描述",
        cell: ({ row }) => (
          <span className="text-muted-foreground max-w-[200px] truncate block">
            {row.getValue("description") || "-"}
          </span>
        ),
      },
      {
        accessorKey: "isActive",
        header: "状态",
        cell: ({ row }) => (
          row.getValue("isActive") ? (
            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              启用
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-gray-100 text-gray-500">
              <XCircle className="h-3 w-3 mr-1" />
              停用
            </Badge>
          )
        ),
        size: 100,
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => {
          const liquid = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">打开菜单</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>操作</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(liquid.id.toString())}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  复制 ID
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Pencil className="h-4 w-4 mr-2" />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-red-600"
                  onClick={() => handleDeleteLiquid(liquid.id)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 80,
      },
    ];

    return [...baseColumns, ...metadataColumns, ...endColumns];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataFields]);

  const getConsumableIcon = (type: number) => {
    switch (type) {
      case 1: return <Droplets className="h-5 w-5" />;
      case 2: return <Filter className="h-5 w-5" />;
      case 3: return <Filter className="h-5 w-5" />;
      default: return <Beaker className="h-5 w-5" />;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">耗材管理</h1>
          <p className="text-muted-foreground">管理液体、泵配置和耗材寿命</p>
        </div>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Tabs defaultValue="consumables" className="space-y-4">
        <TabsList>
          <TabsTrigger value="consumables">耗材状态</TabsTrigger>
          <TabsTrigger value="pumps">泵配置</TabsTrigger>
          <TabsTrigger value="liquids">液体库</TabsTrigger>
        </TabsList>

        {/* 耗材状态 */}
        <TabsContent value="consumables" className="space-y-6">
          {/* 气路系统 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Wind className="h-5 w-5 text-blue-500" />
              <h3 className="font-semibold">气路系统</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {consumables
                .filter(c => c.id === 'carbon_filter' || c.id === 'vacuum_filter')
                .sort((a, b) => a.id === 'carbon_filter' ? -1 : 1)
                .map((c) => (
                <Card key={c.id} className={c.status === 2 ? "border-red-500" : c.status === 1 ? "border-yellow-500" : ""}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Filter className="h-5 w-5" />
                        <CardTitle className="text-lg">{c.name}</CardTitle>
                      </div>
                      {getStatusBadge(c.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>剩余寿命</span>
                        <span>{Math.round(c.remainingRatio * 100)}%</span>
                      </div>
                      <Progress 
                        value={c.remainingRatio * 100} 
                        className={c.status === 2 ? "[&>div]:bg-red-500" : c.status === 1 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                      <div>
                        <span className="block font-medium">已使用</span>
                        {formatDuration(c.accumulatedSeconds)}
                      </div>
                      <div>
                        <span className="block font-medium">剩余</span>
                        {formatDuration(c.remainingSeconds)}
                      </div>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={() => handleResetConsumable(c.id)}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      重置（更换后）
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* 液路系统 - 蠕动泵管 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Droplets className="h-5 w-5 text-cyan-500" />
              <h3 className="font-semibold">液路系统（蠕动泵管）</h3>
            </div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {consumables
                .filter(c => c.id.startsWith('pump_tube_'))
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((c) => {
                  const pumpNum = c.id.replace('pump_tube_', '');
                  return (
                    <Card key={c.id} className={`${c.status === 2 ? "border-red-500" : c.status === 1 ? "border-yellow-500" : ""}`}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">泵 #{pumpNum}</span>
                          {getStatusBadge(c.status)}
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>剩余</span>
                            <span>{Math.round(c.remainingRatio * 100)}%</span>
                          </div>
                          <Progress 
                            value={c.remainingRatio * 100} 
                            className={`h-2 ${c.status === 2 ? "[&>div]:bg-red-500" : c.status === 1 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}`}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          已用 {formatDuration(c.accumulatedSeconds)}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full h-7 text-xs"
                          onClick={() => handleResetConsumable(c.id)}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          重置
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </div>
          
          {consumables.some(c => c.status > 0) && (
            <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
              <CardContent className="flex items-center gap-4 pt-6">
                <AlertTriangle className="h-8 w-8 text-yellow-600" />
                <div>
                  <p className="font-medium">耗材提醒</p>
                  <p className="text-sm text-muted-foreground">
                    有 {consumables.filter(c => c.status === 2).length} 个耗材需要立即更换，
                    {consumables.filter(c => c.status === 1).length} 个耗材即将到期
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 泵配置 */}
        <TabsContent value="pumps" className="space-y-6">
          {/* 样品泵 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Beaker className="h-5 w-5 text-blue-500" />
                样品泵配置
              </CardTitle>
              <CardDescription>配置样品泵连接的液体（只能绑定非清洗液）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {pumps.map((pump) => {
                  const remainingRatio = pump.initialVolumeMl > 0 
                    ? (pump.remainingVolumeMl / pump.initialVolumeMl) * 100 
                    : 0;
                  const sampleLiquids = liquids.filter(l => l.type !== 2);
                  return (
                    <Card key={pump.pumpIndex} className={pump.isLowVolume ? "border-yellow-500" : ""}>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">样品泵 #{pump.pumpIndex}</span>
                          {pump.isLowVolume && (
                            <Badge variant="secondary" className="bg-yellow-500 text-white">余量不足</Badge>
                          )}
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">绑定液体</Label>
                          <Select
                            value={pump.liquidId?.toString() || "none"}
                            onValueChange={(value) => handleSetPump(pump.pumpIndex, value === "none" ? null : parseInt(value))}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="未配置" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未配置</SelectItem>
                              {sampleLiquids.map((liquid) => (
                                <SelectItem key={liquid.id} value={liquid.id.toString()}>
                                  {liquid.name} ({getLiquidTypeName(liquid.type)})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {pump.liquidId && (
                          <>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>余量</span>
                                <span>{pump.remainingVolumeMl.toFixed(1)} / {pump.initialVolumeMl.toFixed(1)} ml</span>
                              </div>
                              <Progress 
                                value={remainingRatio} 
                                className={`h-2 ${pump.isLowVolume ? "[&>div]:bg-yellow-500" : "[&>div]:bg-blue-500"}`}
                              />
                            </div>
                            
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <Label className="text-xs">补充容量 (ml)</Label>
                                <div className="flex gap-1">
                                  <Input 
                                    type="number" 
                                    className="h-8 text-sm"
                                    placeholder="ml"
                                    id={`volume-${pump.pumpIndex}`}
                                    defaultValue={pump.initialVolumeMl || 100}
                                  />
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="h-8"
                                    onClick={() => {
                                      const input = document.getElementById(`volume-${pump.pumpIndex}`) as HTMLInputElement;
                                      handleSetPumpVolume(pump.pumpIndex, parseFloat(input?.value || "100"));
                                    }}
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 清洗泵 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-cyan-500" />
                清洗泵配置
              </CardTitle>
              <CardDescription>配置清洗泵连接的液体（只能绑定清洗液）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {washPumps.map((pump) => {
                  const remainingRatio = pump.initialVolumeMl > 0 
                    ? (pump.remainingVolumeMl / pump.initialVolumeMl) * 100 
                    : 0;
                  const rinseLiquids = liquids.filter(l => l.type === 2);
                  return (
                    <Card key={pump.pumpIndex} className={pump.isLowVolume ? "border-yellow-500" : ""}>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">清洗泵 #{pump.pumpIndex}</span>
                          {pump.isLowVolume && (
                            <Badge variant="secondary" className="bg-yellow-500 text-white">余量不足</Badge>
                          )}
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">绑定清洗液</Label>
                          <Select
                            value={pump.liquidId?.toString() || "none"}
                            onValueChange={(value) => handleSetWashPump(pump.pumpIndex, value === "none" ? null : parseInt(value))}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="未配置" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">未配置</SelectItem>
                              {rinseLiquids.length === 0 ? (
                                <SelectItem value="no-rinse" disabled>无可用清洗液</SelectItem>
                              ) : (
                                rinseLiquids.map((liquid) => (
                                  <SelectItem key={liquid.id} value={liquid.id.toString()}>
                                    {liquid.name}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {pump.liquidId && (
                          <>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>余量</span>
                                <span>{pump.remainingVolumeMl.toFixed(1)} / {pump.initialVolumeMl.toFixed(1)} ml</span>
                              </div>
                              <Progress 
                                value={remainingRatio} 
                                className={`h-2 ${pump.isLowVolume ? "[&>div]:bg-yellow-500" : "[&>div]:bg-cyan-500"}`}
                              />
                            </div>
                            
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <Label className="text-xs">补充容量 (ml)</Label>
                                <div className="flex gap-1">
                                  <Input 
                                    type="number" 
                                    className="h-8 text-sm"
                                    placeholder="ml"
                                    id={`wash-volume-${pump.pumpIndex}`}
                                    defaultValue={pump.initialVolumeMl || 100}
                                  />
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="h-8"
                                    onClick={() => {
                                      const input = document.getElementById(`wash-volume-${pump.pumpIndex}`) as HTMLInputElement;
                                      handleSetWashPumpVolume(pump.pumpIndex, parseFloat(input?.value || "100"));
                                    }}
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                {washPumps.length === 0 && (
                  <div className="col-span-2 text-center py-8 text-muted-foreground">
                    暂无清洗泵配置
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 液体库 */}
        <TabsContent value="liquids" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Beaker className="h-5 w-5" />
                液体库
              </CardTitle>
              <CardDescription>管理所有样品和清洗液，支持搜索、排序和筛选</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={liquidColumns}
                data={liquids}
                searchKey="name"
                searchPlaceholder="搜索液体名称..."
                toolbar={
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        添加液体
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>添加新液体</DialogTitle>
                        <DialogDescription>创建新的样品或清洗液</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>名称</Label>
                          <Input
                            value={newLiquid.name}
                            onChange={(e) => setNewLiquid({ ...newLiquid, name: e.target.value })}
                            placeholder="例如：苹果汁"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>类型</Label>
                          <Select
                            value={newLiquid.type}
                            onValueChange={(value) => setNewLiquid({ ...newLiquid, type: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sample">样品</SelectItem>
                              <SelectItem value="rinse">清洗液</SelectItem>
                              <SelectItem value="other">其他</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>描述</Label>
                          <Input
                            value={newLiquid.description}
                            onChange={(e) => setNewLiquid({ ...newLiquid, description: e.target.value })}
                            placeholder="可选描述"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>密度 (g/ml)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={newLiquid.density}
                            onChange={(e) => setNewLiquid({ ...newLiquid, density: parseFloat(e.target.value) || 1.0 })}
                          />
                        </div>
                        {metadataFields.length > 0 && (
                          <div className="border-t pt-4 space-y-4">
                            <Label className="text-muted-foreground text-xs">自定义属性</Label>
                            {metadataFields.map((field) => (
                              <div key={field.id} className="space-y-2">
                                <Label className="flex items-center gap-1">
                                  {field.fieldName}
                                  {field.isRequired && <span className="text-red-500">*</span>}
                                </Label>
                                {field.fieldType === 1 && (
                                  <Input
                                    value={liquidMetadata[field.fieldKey] || ""}
                                    onChange={(e) => setLiquidMetadata({ ...liquidMetadata, [field.fieldKey]: e.target.value })}
                                    placeholder={field.description || field.fieldName}
                                  />
                                )}
                                {field.fieldType === 2 && (
                                  <Input
                                    type="number"
                                    value={liquidMetadata[field.fieldKey] || ""}
                                    onChange={(e) => setLiquidMetadata({ ...liquidMetadata, [field.fieldKey]: e.target.value })}
                                    placeholder={field.description || field.fieldName}
                                  />
                                )}
                                {field.fieldType === 3 && (
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={liquidMetadata[field.fieldKey] === "true"}
                                      onCheckedChange={(checked) => setLiquidMetadata({ ...liquidMetadata, [field.fieldKey]: checked ? "true" : "false" })}
                                    />
                                    <span className="text-sm text-muted-foreground">{liquidMetadata[field.fieldKey] === "true" ? "是" : "否"}</span>
                                  </div>
                                )}
                                {field.fieldType === 4 && (
                                  <Select
                                    value={liquidMetadata[field.fieldKey] || ""}
                                    onValueChange={(value) => setLiquidMetadata({ ...liquidMetadata, [field.fieldKey]: value })}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="选择..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(() => {
                                        try {
                                          const opts = JSON.parse(field.optionsJson || "[]");
                                          return Array.isArray(opts) ? opts.map((opt: string) => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                          )) : null;
                                        } catch { return null; }
                                      })()}
                                    </SelectContent>
                                  </Select>
                                )}
                                {field.fieldType === 10 && (
                                  <Input
                                    type="date"
                                    value={liquidMetadata[field.fieldKey] || ""}
                                    onChange={(e) => setLiquidMetadata({ ...liquidMetadata, [field.fieldKey]: e.target.value })}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                        <Button onClick={handleCreateLiquid} disabled={!newLiquid.name}>创建</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                }
              />
            </CardContent>
          </Card>

          {/* 元数据字段管理 */}
          <Collapsible open={fieldsOpen} onOpenChange={setFieldsOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings2 className="h-5 w-5" />
                      自定义属性字段
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{metadataFields.length} 个字段</Badge>
                      {fieldsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                  </CardTitle>
                  <CardDescription>定义液体可以有哪些自定义属性（如产地、批次号、保质期等）</CardDescription>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm">
                            <Plus className="h-4 w-4 mr-2" />
                            添加字段
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>添加自定义字段</DialogTitle>
                            <DialogDescription>为液体添加新的自定义属性字段</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>字段键名</Label>
                                <Input
                                  value={newField.fieldKey}
                                  onChange={(e) => setNewField({ ...newField, fieldKey: e.target.value.replace(/\s/g, "_").toLowerCase() })}
                                  placeholder="origin"
                                />
                                <p className="text-xs text-muted-foreground">用于存储，只能用英文和下划线</p>
                              </div>
                              <div className="space-y-2">
                                <Label>显示名称</Label>
                                <Input
                                  value={newField.fieldName}
                                  onChange={(e) => setNewField({ ...newField, fieldName: e.target.value })}
                                  placeholder="产地"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>字段类型</Label>
                              <Select
                                value={String(newField.fieldType)}
                                onValueChange={(value) => setNewField({ ...newField, fieldType: parseInt(value) })}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={String(t.value)}>
                                      <span className="flex items-center gap-2">
                                        <span className="w-5 text-center">{t.icon}</span>
                                        {t.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>描述</Label>
                              <Input
                                value={newField.description}
                                onChange={(e) => setNewField({ ...newField, description: e.target.value })}
                                placeholder="可选描述"
                              />
                            </div>
                            {(newField.fieldType === 4 || newField.fieldType === 5) && (
                              <div className="space-y-2">
                                <Label>选项（每行一个）</Label>
                                <textarea
                                  className="w-full h-24 p-2 border rounded-md text-sm"
                                  value={(() => { try { const o = JSON.parse(newField.optionsJson || "[]"); return Array.isArray(o) ? o.join("\n") : ""; } catch { return ""; } })()}
                                  onChange={(e) => setNewField({ 
                                    ...newField, 
                                    optionsJson: JSON.stringify(e.target.value.split("\n").filter(Boolean))
                                  })}
                                  placeholder="选项1&#10;选项2&#10;选项3"
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={newField.isRequired}
                                onCheckedChange={(checked) => setNewField({ ...newField, isRequired: checked })}
                              />
                              <Label>必填字段</Label>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setFieldDialogOpen(false)}>取消</Button>
                            <Button onClick={handleCreateField} disabled={!newField.fieldKey || !newField.fieldName}>创建</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {metadataFields.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Settings2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>暂无自定义字段</p>
                        <p className="text-sm">点击上方按钮添加自定义属性</p>
                      </div>
                    ) : (
                      <div className="border rounded-md">
                        {metadataFields.map((field, index) => (
                          <div 
                            key={field.id} 
                            className={`flex items-center justify-between p-3 ${index > 0 ? "border-t" : ""}`}
                          >
                            <div className="flex items-center gap-3">
                              <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                              <div className="w-8 h-8 flex items-center justify-center bg-muted rounded text-sm">
                                {FIELD_TYPES.find(t => t.value === field.fieldType)?.icon || "?"}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{field.fieldName}</span>
                                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{field.fieldKey}</code>
                                  {field.isRequired && <Badge variant="destructive" className="text-xs">必填</Badge>}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {FIELD_TYPES.find(t => t.value === field.fieldType)?.label}
                                  {field.description && ` · ${field.description}`}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingField(field)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-600"
                                onClick={() => handleDeleteField(field.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* 编辑字段对话框 */}
          <Dialog open={!!editingField} onOpenChange={(open) => !open && setEditingField(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>编辑字段</DialogTitle>
                <DialogDescription>修改字段属性</DialogDescription>
              </DialogHeader>
              {editingField && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>显示名称</Label>
                    <Input
                      value={editingField.fieldName}
                      onChange={(e) => setEditingField({ ...editingField, fieldName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>描述</Label>
                    <Input
                      value={editingField.description}
                      onChange={(e) => setEditingField({ ...editingField, description: e.target.value })}
                    />
                  </div>
                  {(editingField.fieldType === 4 || editingField.fieldType === 5) && (
                    <div className="space-y-2">
                      <Label>选项（每行一个）</Label>
                      <textarea
                        className="w-full h-24 p-2 border rounded-md text-sm"
                        value={(() => { try { const o = JSON.parse(editingField.optionsJson || "[]"); return Array.isArray(o) ? o.join("\n") : ""; } catch { return ""; } })()}
                        onChange={(e) => setEditingField({ 
                          ...editingField, 
                          optionsJson: JSON.stringify(e.target.value.split("\n").filter(Boolean))
                        })}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editingField.isRequired}
                      onCheckedChange={(checked) => setEditingField({ ...editingField, isRequired: checked })}
                    />
                    <Label>必填字段</Label>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingField(null)}>取消</Button>
                <Button onClick={handleUpdateField}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
