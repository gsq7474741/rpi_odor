'use client';

import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Copy, Thermometer, Clock, RefreshCw, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

// 加热器预设类型
export interface HeaterProfile {
  id: number;
  name: string;
  description: string;
  temps: number[];
  durs: number[];
  preheatMode: string;
  preheatCycles: number;
  preheatDurationS: number;
  isBuiltin: boolean;
}

interface HeaterProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfilesChange?: () => void;
}

interface ProfileEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: HeaterProfile | null;
  isNew: boolean;
  onSaved: () => void;
}

// 温度曲线可视化组件 (ECharts)
function TemperatureCurve({ temps, durs, name, className }: { temps: number[]; durs: number[]; name?: string; className?: string }) {
  const TIME_BASE_MS = 140;
  
  const chartOption = useMemo(() => {
    if (!temps.length || !durs.length) return null;
    
    // 生成阶梯数据点 (时间, 温度)
    const data: [number, number][] = [];
    let currentTime = 0;
    
    temps.forEach((temp, i) => {
      data.push([currentTime, temp]);
      currentTime += (durs[i] || 1) * TIME_BASE_MS / 1000;
      data.push([currentTime, temp]);
    });
    
    const totalSeconds = currentTime;
    const maxTemp = Math.max(...temps, 350) + 50;
    
    return {
      backgroundColor: '#fff',
      grid: {
        top: name ? 35 : 20,
        right: 15,
        bottom: 35,
        left: 45,
        containLabel: false,
      },
      title: name ? {
        text: name,
        left: 'center',
        top: 5,
        textStyle: { fontSize: 13, fontWeight: 500, color: '#333' },
      } : undefined,
      tooltip: {
        trigger: 'axis',
        formatter: (params: { data: [number, number] }[]) => {
          const p = params[0];
          return p ? `时间: ${p.data[0].toFixed(2)}s<br/>温度: ${p.data[1]}°C` : '';
        },
      },
      xAxis: {
        type: 'value',
        name: '时间 (s)',
        nameLocation: 'middle',
        nameGap: 22,
        min: 0,
        max: totalSeconds > 0 ? totalSeconds : 1,
        splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } },
        axisLine: { lineStyle: { color: '#999' } },
        axisLabel: { color: '#666', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: '温度 (°C)',
        nameLocation: 'middle',
        nameGap: 35,
        min: 0,
        max: maxTemp,
        splitLine: { lineStyle: { type: 'dashed', color: '#e0e0e0' } },
        axisLine: { lineStyle: { color: '#999' } },
        axisLabel: { color: '#666', fontSize: 10 },
      },
      series: [{
        type: 'line',
        data: data,
        step: 'end',
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#3b82f6', width: 2 },
        itemStyle: { color: '#3b82f6', borderColor: '#fff', borderWidth: 1 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.05)' },
            ],
          },
        },
      }],
    };
  }, [temps, durs, name]);
  
  if (!chartOption) {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground text-sm h-32", className)}>
        无数据
      </div>
    );
  }
  
  const totalTimeS = durs.reduce((a, b) => a + b, 0) * TIME_BASE_MS / 1000;
  
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="w-full" style={{ aspectRatio: '16/9' }}>
        <ReactECharts 
          option={chartOption} 
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mt-1 px-1">
        <span>步数: {temps.length}</span>
        <span>总时长: {totalTimeS.toFixed(2)}s</span>
      </div>
    </div>
  );
}

// 独立的预设编辑器对话框
function ProfileEditorDialog({ 
  open,
  onOpenChange,
  profile: initialProfile,
  isNew,
  onSaved
}: ProfileEditorDialogProps) {
  const [profile, setProfile] = useState<HeaterProfile | null>(null);
  const [saving, setSaving] = useState(false);
  
  // 临时存储输入值，避免实时验证干扰输入
  const [tempInputs, setTempInputs] = useState<Record<number, string>>({});
  const [durInputs, setDurInputs] = useState<Record<number, string>>({});
  
  // 当对话框打开时，复制初始值
  useEffect(() => {
    if (open && initialProfile) {
      setProfile({ ...initialProfile });
      setTempInputs({});
      setDurInputs({});
    }
  }, [open, initialProfile]);
  
  if (!profile) return null;
  
  const updateStep = (index: number, field: 'temp' | 'dur', value: number) => {
    const newTemps = [...profile.temps];
    const newDurs = [...profile.durs];
    if (field === 'temp') {
      newTemps[index] = Math.max(100, Math.min(400, value));
    } else {
      newDurs[index] = Math.max(1, Math.min(100, value));
    }
    setProfile({ ...profile, temps: newTemps, durs: newDurs });
  };
  
  const handleTempInputChange = (index: number, value: string) => {
    setTempInputs(prev => ({ ...prev, [index]: value }));
  };
  
  const handleDurInputChange = (index: number, value: string) => {
    setDurInputs(prev => ({ ...prev, [index]: value }));
  };
  
  const handleTempBlur = (index: number) => {
    const value = tempInputs[index];
    if (value !== undefined) {
      updateStep(index, 'temp', parseInt(value) || 320);
      setTempInputs(prev => { const n = {...prev}; delete n[index]; return n; });
    }
  };
  
  const handleDurBlur = (index: number) => {
    const value = durInputs[index];
    if (value !== undefined) {
      updateStep(index, 'dur', parseInt(value) || 5);
      setDurInputs(prev => { const n = {...prev}; delete n[index]; return n; });
    }
  };
  
  const addStep = () => {
    if (profile.temps.length >= 10) return;
    const lastTemp = profile.temps[profile.temps.length - 1] || 320;
    const lastDur = profile.durs[profile.durs.length - 1] || 5;
    setProfile({ 
      ...profile, 
      temps: [...profile.temps, lastTemp], 
      durs: [...profile.durs, lastDur] 
    });
  };
  
  const removeStep = (index: number) => {
    if (profile.temps.length <= 1) return;
    setProfile({
      ...profile,
      temps: profile.temps.filter((_, i) => i !== index),
      durs: profile.durs.filter((_, i) => i !== index)
    });
  };
  
  const handleSave = async () => {
    setSaving(true);
    try {
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch('/api/heater-profiles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      
      if (res.ok) {
        onSaved();
        onOpenChange(false);
      }
    } catch (e) {
      console.error('Failed to save profile:', e);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Thermometer className="w-5 h-5" />
            {isNew ? '新建加热预设' : '编辑加热预设'}
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 pr-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">预设名称</Label>
                <Input
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  placeholder="my_profile"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">预热模式</Label>
                <Select
                  value={profile.preheatMode}
                  onValueChange={(v) => setProfile({ ...profile, preheatMode: v })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cycles">周期数</SelectItem>
                    <SelectItem value="duration">固定时间</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">描述</Label>
              <Textarea
                value={profile.description}
                onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                placeholder="预设描述..."
                className="h-16 text-sm resize-none"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {profile.preheatMode === 'cycles' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">预热周期数</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={profile.preheatCycles}
                    onChange={(e) => setProfile({ ...profile, preheatCycles: parseInt(e.target.value) || 3 })}
                    className="h-8 text-sm"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">预热时间 (秒)</Label>
                  <Input
                    type="number"
                    min={10}
                    max={600}
                    value={profile.preheatDurationS}
                    onChange={(e) => setProfile({ ...profile, preheatDurationS: parseInt(e.target.value) || 60 })}
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>
            
            {/* 加热步骤编辑 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">加热步骤 ({profile.temps.length}/10)</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addStep}
                  disabled={profile.temps.length >= 10}
                  className="h-6 px-2 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  添加
                </Button>
              </div>
              
              <ScrollArea className="h-40 border rounded-md p-2">
                <div className="space-y-1">
                  {profile.temps.map((temp, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-muted-foreground text-xs">{i + 1}</span>
                      <div className="flex items-center gap-1">
                        <Thermometer className="w-3 h-3 text-orange-500" />
                        <Input
                          type="number"
                          min={100}
                          max={400}
                          value={tempInputs[i] ?? temp}
                          onChange={(e) => handleTempInputChange(i, e.target.value)}
                          onBlur={() => handleTempBlur(i)}
                          className="h-6 w-16 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">°C</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-blue-500" />
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={durInputs[i] ?? profile.durs[i]}
                          onChange={(e) => handleDurInputChange(i, e.target.value)}
                          onBlur={() => handleDurBlur(i)}
                          className="h-6 w-12 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">×140ms</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStep(i)}
                        disabled={profile.temps.length <= 1}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            
            {/* 曲线预览 */}
            <div className="border rounded-md p-2 bg-muted/30">
              <Label className="text-xs mb-2 block">温度曲线预览</Label>
              <TemperatureCurve temps={profile.temps} durs={profile.durs} />
            </div>
          </div>
        </ScrollArea>
        
        <DialogFooter className="shrink-0 pt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !profile.name.trim()}>
            {saving ? '保存中...' : (isNew ? '创建' : '保存')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HeaterProfileDialog({
  open,
  onOpenChange,
  onProfilesChange
}: HeaterProfileDialogProps) {
  const [profiles, setProfiles] = useState<HeaterProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  
  // 编辑器对话框状态
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<HeaterProfile | null>(null);
  const [isNewProfile, setIsNewProfile] = useState(false);
  
  // 加载预设列表
  const loadProfiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/heater-profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data);
        if (data.length > 0 && !selectedId) {
          setSelectedId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load profiles:', err);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (open) {
      loadProfiles();
    }
  }, [open]);
  
  const selectedProfile = profiles.find(p => p.id === selectedId);
  
  const handleCreateNew = () => {
    setEditingProfile({
      id: 0,
      name: '',
      description: '',
      temps: [320, 320, 320, 320, 320],
      durs: [5, 5, 5, 5, 5],
      preheatMode: 'cycles',
      preheatCycles: 3,
      preheatDurationS: 60,
      isBuiltin: false
    });
    setIsNewProfile(true);
    setEditorOpen(true);
  };
  
  const handleEdit = (profile: HeaterProfile) => {
    if (profile.isBuiltin) {
      // 复制内置预设
      setEditingProfile({
        ...profile,
        id: 0,
        name: profile.name + '_copy',
        isBuiltin: false
      });
      setIsNewProfile(true);
    } else {
      setEditingProfile({ ...profile });
      setIsNewProfile(false);
    }
    setEditorOpen(true);
  };
  
  const handleEditorSaved = async () => {
    await loadProfiles();
    onProfilesChange?.();
  };
  
  const handleDeleteProfile = async (id: number) => {
    if (!confirm('确定删除此预设?')) return;
    
    try {
      const res = await fetch(`/api/heater-profiles?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadProfiles();
        if (selectedId === id) {
          setSelectedId(profiles[0]?.id ?? null);
        }
        onProfilesChange?.(); // 通知外部刷新
      }
    } catch (e) {
      console.error('Failed to delete profile:', e);
    }
  };
  
  return (
    <>
      {/* 主对话框：预设列表和预览 */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Thermometer className="w-5 h-5" />
              管理加热器预设
              <Badge variant="outline" className="ml-2">
                {profiles.length} 个预设
              </Badge>
            </DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
            {/* 左侧：预设列表 */}
            <div className="space-y-2 flex flex-col min-h-0">
              <div className="flex items-center justify-between shrink-0">
                <Label className="text-sm font-medium">预设列表</Label>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={handleCreateNew}>
                    <Plus className="w-3 h-3 mr-1" /> 新建
                  </Button>
                  <Button variant="ghost" size="sm" onClick={loadProfiles} disabled={loading}>
                    <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 border rounded-md">
                <div className="p-1 space-y-1">
                  {profiles.map((profile) => (
                    <div
                      key={profile.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
                        selectedId === profile.id 
                          ? "bg-primary/10 border border-primary/30" 
                          : "hover:bg-muted"
                      )}
                      onClick={() => setSelectedId(profile.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium truncate">{profile.name}</span>
                          {profile.isBuiltin && (
                            <Badge variant="secondary" className="text-[10px] px-1">内置</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {profile.description || `${profile.temps.length}步`}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleEdit(profile); }}
                        className="h-7 px-2"
                      >
                        {profile.isBuiltin ? <Copy className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                      </Button>
                      {!profile.isBuiltin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}
                          className="h-7 px-2 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            
            {/* 右侧：温度曲线预览 */}
            <div className="col-span-2 min-h-0">
              {selectedProfile ? (
                <div className="border rounded-md p-3 bg-muted/30 h-full">
                  <div className="text-sm font-medium mb-2">{selectedProfile.name}</div>
                  {selectedProfile.description && (
                    <p className="text-xs text-muted-foreground mb-3">{selectedProfile.description}</p>
                  )}
                  <TemperatureCurve temps={selectedProfile.temps} durs={selectedProfile.durs} />
                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground grid grid-cols-2 gap-2">
                    <div>步数: {selectedProfile.temps.length}</div>
                    <div>预热: {selectedProfile.preheatMode === 'cycles' ? `${selectedProfile.preheatCycles}周期` : `${selectedProfile.preheatDurationS}秒`}</div>
                  </div>
                </div>
              ) : (
                <div className="border rounded-md p-3 bg-muted/30 h-full flex items-center justify-center text-muted-foreground text-sm">
                  选择预设查看曲线
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* 独立的编辑器对话框 */}
      <ProfileEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        profile={editingProfile}
        isNew={isNewProfile}
        onSaved={handleEditorSaved}
      />
    </>
  );
}
