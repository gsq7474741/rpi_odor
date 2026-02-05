'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Trash2, Settings2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Field } from './Field';
import { NodeFieldsProps, getBaseProfileName } from './types';
import { HeaterProfileDialog, HeaterProfile } from '../../dialogs/HeaterProfileDialog';

// 加热器预设选择器 - 纯下拉选择
function HeaterProfileSelector({ 
  value, 
  onChange,
  profiles,
  loading = false
}: { 
  value: string; 
  onChange: (name: string) => void;
  profiles: HeaterProfile[];
  loading?: boolean;
}) {
  const baseValue = getBaseProfileName(value);
  
  const handleProfileSelect = (newBaseName: string) => {
    const suffix = value.match(/__\d+$/)?.[0] || '';
    onChange(newBaseName + suffix);
  };

  const selectedProfile = profiles?.find(p => p.name === baseValue);
  
  return (
    <Select value={baseValue} onValueChange={handleProfileSelect}>
      <SelectTrigger className="w-full h-auto min-h-9 py-1.5">
        <SelectValue placeholder={loading ? '加载中...' : '选择预设...'}>
          <div className="flex flex-col items-start text-left overflow-hidden">
            <span className="truncate text-sm">{baseValue}</span>
            {selectedProfile?.description && (
              <span className="text-[10px] text-muted-foreground truncate">
                {selectedProfile.description}
              </span>
            )}
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {profiles?.map((p) => (
          <SelectItem key={p.id} value={p.name}>
            <div className="flex flex-col">
              <span>{p.name}</span>
              {p.description && (
                <span className="text-[10px] text-muted-foreground">{p.description}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ConfigureHeaterFields({ data, handleChange }: NodeFieldsProps) {
  const [profiles, setProfiles] = useState<HeaterProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  const loadProfiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/heater-profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data);
      }
    } catch (err) {
      console.error('Failed to load heater profiles:', err);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    loadProfiles();
  }, []);
  
  // 每个传感器的预设: { [sensorIdx]: profileName }
  const sensorProfiles = (data.sensorProfiles || {}) as Record<number, string>;
  
  // 按预设名称分组传感器
  const profileGroups: Record<string, number[]> = {};
  for (let i = 0; i < 8; i++) {
    const profile = sensorProfiles[i] || '';
    if (!profileGroups[profile]) {
      profileGroups[profile] = [];
    }
    profileGroups[profile].push(i);
  }
  // 处理虚拟传感器 (>=8) 用于创建空组
  Object.keys(sensorProfiles).forEach(key => {
    const idx = parseInt(key);
    if (idx >= 8) {
      const profile = sensorProfiles[idx];
      if (profile && !profileGroups[profile]) {
        profileGroups[profile] = [];
      }
    }
  });
  
  // 添加新的配置组
  const handleAddGroup = (profileName: string) => {
    const existingVirtual = Object.keys(sensorProfiles)
      .map(k => parseInt(k))
      .filter(k => k >= 8);
    const nextVirtualIdx = existingVirtual.length > 0 
      ? Math.max(...existingVirtual) + 1 
      : 8;
    
    let uniqueProfileName = profileName;
    const existingProfiles = new Set(Object.values(sensorProfiles).filter(p => p));
    if (existingProfiles.has(profileName)) {
      let counter = 2;
      while (existingProfiles.has(`${profileName}__${counter}`)) {
        counter++;
      }
      uniqueProfileName = `${profileName}__${counter}`;
    }
    
    handleChange('sensorProfiles', { ...sensorProfiles, [nextVirtualIdx]: uniqueProfileName });
  };
  
  // 更新组的传感器
  const handleGroupSensorsChange = (oldProfile: string, newSensors: number[]) => {
    const newProfiles = { ...sensorProfiles };
    Object.keys(newProfiles).forEach(key => {
      const idx = parseInt(key);
      if (newProfiles[idx] === oldProfile && !newSensors.includes(idx)) {
        newProfiles[idx] = '';
      }
    });
    newSensors.forEach(idx => {
      newProfiles[idx] = oldProfile;
    });
    handleChange('sensorProfiles', newProfiles);
  };
  
  // 更新组的预设
  const handleGroupProfileChange = (oldProfile: string, newProfile: string) => {
    const newProfiles = { ...sensorProfiles };
    Object.keys(newProfiles).forEach(key => {
      const idx = parseInt(key);
      if (newProfiles[idx] === oldProfile) {
        newProfiles[idx] = newProfile;
      }
    });
    handleChange('sensorProfiles', newProfiles);
  };
  
  // 删除配置组
  const handleDeleteGroup = (profile: string) => {
    const newProfiles = { ...sensorProfiles };
    Object.keys(newProfiles).forEach(key => {
      const idx = parseInt(key);
      if (newProfiles[idx] === profile) {
        if (idx >= 8) {
          delete newProfiles[idx];
        } else {
          newProfiles[idx] = '';
        }
      }
    });
    handleChange('sensorProfiles', newProfiles);
  };
  
  // 稳定排序：按预设名称字母顺序排列
  const activeGroups = Object.entries(profileGroups)
    .filter(([profile]) => profile !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const unassignedSensors = profileGroups[''] || [];
  
  return (
    <>
      <Field label="步骤名称">
        <Input
          value={String(data.name || '')}
          onChange={(e) => handleChange('name', e.target.value)}
        />
      </Field>
      
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">传感器加热配置</Label>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setDialogOpen(true)}
              title="管理预设"
            >
              <Settings2 className="w-3 h-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => handleAddGroup('constant_320')}
            >
              <Plus className="w-3 h-3 mr-1" /> 添加配置
            </Button>
          </div>
        </div>
        
        {/* 配置组列表 */}
        <div className="space-y-2">
          {activeGroups.map(([profile, sensors]) => (
            <div key={profile} className="border rounded-lg p-2 space-y-2 bg-muted/30">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <HeaterProfileSelector
                    value={profile}
                    onChange={(newProfile) => handleGroupProfileChange(profile, newProfile)}
                    profiles={profiles}
                    loading={loading}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => handleDeleteGroup(profile)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              
              {/* 传感器选择网格 */}
              <div className="flex flex-wrap gap-1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => {
                  const isSelected = sensors.includes(idx);
                  const isAssignedElsewhere = !isSelected && Boolean(sensorProfiles[idx]);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={cn(
                        "w-7 h-7 text-xs rounded border transition-colors",
                        isSelected 
                          ? "bg-primary text-primary-foreground border-primary"
                          : isAssignedElsewhere
                            ? "bg-muted text-muted-foreground border-transparent cursor-not-allowed opacity-40"
                            : "bg-background hover:bg-accent border-border"
                      )}
                      disabled={isAssignedElsewhere}
                      onClick={() => {
                        if (isSelected) {
                          handleGroupSensorsChange(profile, sensors.filter(s => s !== idx));
                        } else {
                          handleGroupSensorsChange(profile, [...sensors, idx]);
                        }
                      }}
                    >
                      S{idx}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          
          {activeGroups.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              点击"添加配置"为传感器分配加热预设
            </p>
          )}
        </div>
        
        {/* 未分配的传感器提示 */}
        {unassignedSensors.length > 0 && activeGroups.length > 0 && (
          <p className="text-xs text-amber-600">
            未配置: {unassignedSensors.map(i => `S${i}`).join(', ')}
          </p>
        )}
      </div>
      
      {/* 预设管理对话框 */}
      <HeaterProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onProfilesChange={loadProfiles}
      />
    </>
  );
}
