"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Beaker, Droplets, Filter, RotateCcw, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Wind } from "lucide-react";

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

export default function ConsumablesPage() {
  const [liquids, setLiquids] = useState<Liquid[]>([]);
  const [pumps, setPumps] = useState<PumpAssignment[]>([]);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLiquid, setNewLiquid] = useState({ name: "", type: "sample", description: "", density: 1.0 });
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [liquidsRes, pumpsRes, consumablesRes] = await Promise.all([
        fetch("/api/consumables?type=liquids"),
        fetch("/api/consumables?type=pumps"),
        fetch("/api/consumables?type=consumables"),
      ]);
      
      const liquidsData = await liquidsRes.json();
      const pumpsData = await pumpsRes.json();
      const consumablesData = await consumablesRes.json();
      
      setLiquids(liquidsData.liquids || []);
      setPumps(pumpsData.assignments || []);
      setConsumables(consumablesData.consumables || []);
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
        body: JSON.stringify(newLiquid),
      });
      if (res.ok) {
        setDialogOpen(false);
        setNewLiquid({ name: "", type: "sample", description: "", density: 1.0 });
        fetchData();
      }
    } catch (error) {
      console.error("创建失败:", error);
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
        <TabsContent value="pumps">
          <Card>
            <CardHeader>
              <CardTitle>泵-液体配置</CardTitle>
              <CardDescription>配置每个蠕动泵当前连接的液体及容量</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {pumps.map((pump) => {
                  const remainingRatio = pump.initialVolumeMl > 0 
                    ? (pump.remainingVolumeMl / pump.initialVolumeMl) * 100 
                    : 0;
                  return (
                    <Card key={pump.pumpIndex} className={pump.isLowVolume ? "border-yellow-500" : ""}>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">泵 #{pump.pumpIndex}</span>
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
                              {liquids.map((liquid) => (
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
        </TabsContent>

        {/* 液体库 */}
        <TabsContent value="liquids" className="space-y-4">
          <div className="flex justify-end">
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
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                  <Button onClick={handleCreateLiquid} disabled={!newLiquid.name}>创建</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              {liquids.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Beaker className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">暂无液体，点击上方按钮添加</p>
                </div>
              ) : (
                <div className="divide-y">
                  {liquids.map((liquid) => (
                    <div key={liquid.id} className="flex items-center justify-between p-4 hover:bg-muted/50">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          {liquid.type === 1 ? (
                            <Beaker className="h-5 w-5 text-primary" />
                          ) : (
                            <Droplets className="h-5 w-5 text-blue-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{liquid.name}</span>
                            <Badge variant="outline" className="text-xs">{getLiquidTypeName(liquid.type)}</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {liquid.description || `密度: ${liquid.density} g/ml`}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteLiquid(liquid.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
