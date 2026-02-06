"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Palette,
  Wifi,
  Scale,
  FlaskConical,
  Workflow,
  Info,
  Sun,
  Moon,
  Monitor,
  Loader2,
  Save,
  RefreshCw,
  CircleDot,
  GitBranch,
  Server,
  Cpu,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSettings } from "@/hooks/use-settings";
import { useSystemDefaults } from "@/hooks/use-system-defaults";
import { useStatusStream } from "@/hooks/use-status-stream";
import { useLatency } from "@/hooks/use-latency";
import { toast } from "sonner";

// ============================================================
// Shared Components
// ============================================================
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-semibold tracking-tight">{children}</h3>;
}

function SectionDesc({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 min-h-[44px]">
      <div className="flex-1 min-w-0">
        <Label className="text-[13px]">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 divide-y divide-border rounded-lg border bg-card px-4">
      {children}
    </div>
  );
}

function NumberField({
  value,
  onChange,
  step,
  min,
  max,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-8 w-24 text-right text-sm tabular-nums"
      />
      {unit && <span className="text-xs text-muted-foreground w-8">{unit}</span>}
    </div>
  );
}

// ============================================================
// 外观 Tab
// ============================================================
function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { sidebar, setSidebarDefaultCollapsed } = useSettings();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const themes = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>主题模式</SectionTitle>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {mounted &&
            themes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all",
                  theme === value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
        </div>
      </div>

      <div>
        <SectionTitle>布局</SectionTitle>
        <SettingCard>
          <SettingRow label="侧边栏默认折叠" description="启动时自动折叠侧边栏">
            <Switch
              checked={sidebar.defaultCollapsed}
              onCheckedChange={setSidebarDefaultCollapsed}
            />
          </SettingRow>
        </SettingCard>
      </div>
    </div>
  );
}

// ============================================================
// 连接 Tab
// ============================================================
function ConnectionTab() {
  const { connection, setPingIntervalMs, setShowLatency } = useSettings();
  const { connected: statusConnected } = useStatusStream();
  const { connected: latencyConnected, rtt } = useLatency();

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>服务状态</SectionTitle>
        <SettingCard>
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "w-2 h-2 rounded-full",
                statusConnected ? "bg-emerald-500" : "bg-red-500"
              )} />
              <span className="text-[13px]">控制后端 (gRPC)</span>
            </div>
            <Badge
              variant={statusConnected ? "default" : "destructive"}
              className="text-[11px] px-2 py-0"
            >
              {statusConnected ? "已连接" : "未连接"}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px]">往返延迟</span>
            <span className="text-sm font-mono tabular-nums text-muted-foreground">
              {latencyConnected && rtt !== null ? `${rtt} ms` : "—"}
            </span>
          </div>
        </SettingCard>
      </div>

      <div>
        <SectionTitle>检测设置</SectionTitle>
        <SettingCard>
          <SettingRow label="Ping 间隔" description="延迟检测的轮询频率">
            <Select
              value={String(connection.pingIntervalMs)}
              onValueChange={(v) => setPingIntervalMs(Number(v))}
            >
              <SelectTrigger className="w-28 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1000">1 秒</SelectItem>
                <SelectItem value="2000">2 秒</SelectItem>
                <SelectItem value="5000">5 秒</SelectItem>
                <SelectItem value="10000">10 秒</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="延迟指示器" description="在顶栏显示实时延迟">
            <Switch
              checked={connection.showLatency}
              onCheckedChange={setShowLatency}
            />
          </SettingRow>
        </SettingCard>
      </div>
    </div>
  );
}

// ============================================================
// 称重传感器 Tab
// ============================================================
interface LoadCellFormData {
  overflowThreshold: number;
  drainCompleteMargin: number;
  stableThreshold: number;
  mlToWeightSlope: number;
  mlToWeightOffset: number;
  fillLagCompensationG: number;
}

function LoadCellTab() {
  const [form, setForm] = useState<LoadCellFormData>({
    overflowThreshold: 435,
    drainCompleteMargin: 10,
    stableThreshold: 2,
    mlToWeightSlope: 0.0314,
    mlToWeightOffset: -7.34,
    fillLagCompensationG: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastCalibrationTime, setLastCalibrationTime] = useState("");

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/load-cell/config");
      if (res.ok) {
        const data = await res.json();
        setForm({
          overflowThreshold: data.overflowThreshold ?? 435,
          drainCompleteMargin: data.drainCompleteMargin ?? 10,
          stableThreshold: data.stableThreshold ?? 2,
          mlToWeightSlope: data.mlToWeightSlope ?? 0.0314,
          mlToWeightOffset: data.mlToWeightOffset ?? -7.34,
          fillLagCompensationG: data.fillLagCompensationG ?? 0,
        });
        setLastCalibrationTime(data.lastCalibrationTime || "");
      }
    } catch {
      // use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/load-cell/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", config: form }),
      });
      if (res.ok) {
        toast.success("称重传感器配置已保存");
      } else {
        toast.error("保存失败");
      }
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: keyof LoadCellFormData, value: number) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {lastCalibrationTime && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleDot className="w-3.5 h-3.5" />
          最后标定: {lastCalibrationTime}
        </div>
      )}

      <div>
        <SectionTitle>安全阈值</SectionTitle>
        <SettingCard>
          <SettingRow label="溢出阈值" description="超过此重量触发溢出警告">
            <NumberField value={form.overflowThreshold} onChange={(v) => updateField("overflowThreshold", v)} step={5} unit="g" />
          </SettingRow>
          <SettingRow label="排空余量" description="判定排空完成的重量余量">
            <NumberField value={form.drainCompleteMargin} onChange={(v) => updateField("drainCompleteMargin", v)} step={1} unit="g" />
          </SettingRow>
          <SettingRow label="稳定检测标准差" description="判定重量稳定的阈值">
            <NumberField value={form.stableThreshold} onChange={(v) => updateField("stableThreshold", v)} step={0.5} unit="g" />
          </SettingRow>
        </SettingCard>
      </div>

      <div>
        <SectionTitle>校准系数</SectionTitle>
        <SectionDesc>线性模型: weight = volume × slope + offset</SectionDesc>
        <SettingCard>
          <SettingRow label="ml → 重量 斜率">
            <NumberField value={form.mlToWeightSlope} onChange={(v) => updateField("mlToWeightSlope", v)} step={0.001} unit="g/ml" />
          </SettingRow>
          <SettingRow label="ml → 重量 截距">
            <NumberField value={form.mlToWeightOffset} onChange={(v) => updateField("mlToWeightOffset", v)} step={0.1} unit="g" />
          </SettingRow>
          <SettingRow label="注入滞后补偿" description="动态读数滞后于真实重量的补偿">
            <NumberField value={form.fillLagCompensationG} onChange={(v) => updateField("fillLagCompensationG", v)} step={0.5} unit="g" />
          </SettingRow>
        </SettingCard>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          保存到后端
        </Button>
        <Button size="sm" variant="outline" onClick={fetchConfig} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          刷新
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// 实验默认值 Tab
// ============================================================
function ExperimentDefaultsTab() {
  const { defaults, loading, saving, saveDefaults, refetch } = useSystemDefaults();
  const [form, setForm] = useState(defaults.wash);

  useEffect(() => {
    setForm(defaults.wash);
  }, [defaults]);

  const handleSave = async () => {
    const success = await saveDefaults({ ...defaults, wash: form });
    if (success) {
      toast.success("实验默认值已保存");
    } else {
      toast.error("保存失败");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionDesc>
        清洗 / 排废节点的初始默认参数，每个节点可单独覆盖。
      </SectionDesc>

      <div>
        <SectionTitle>基本参数</SectionTitle>
        <SettingCard>
          <SettingRow label="默认清洗量">
            <NumberField value={form.washVolumeMl} onChange={(v) => setForm({ ...form, washVolumeMl: v })} step={5} min={1} max={200} unit="ml" />
          </SettingRow>
          <SettingRow label="默认重复次数">
            <NumberField value={form.repeatCount} onChange={(v) => setForm({ ...form, repeatCount: Math.round(v) })} min={1} max={10} unit="次" />
          </SettingRow>
          <SettingRow label={`排废气泵 PWM (${form.gasPumpPwm}%)`}>
            <Slider
              value={[form.gasPumpPwm]}
              min={0} max={100} step={5}
              onValueChange={([v]) => setForm({ ...form, gasPumpPwm: v })}
              className="w-28"
            />
          </SettingRow>
        </SettingCard>
      </div>

      <div>
        <SectionTitle>高级参数</SectionTitle>
        <SettingCard>
          <SettingRow label="注入超时">
            <NumberField value={form.fillTimeoutS} onChange={(v) => setForm({ ...form, fillTimeoutS: v })} min={1} max={300} unit="秒" />
          </SettingRow>
          <SettingRow label="排废超时">
            <NumberField value={form.drainTimeoutS} onChange={(v) => setForm({ ...form, drainTimeoutS: v })} min={1} max={300} unit="秒" />
          </SettingRow>
          <SettingRow label="空瓶检测容差">
            <NumberField value={form.emptyToleranceG} onChange={(v) => setForm({ ...form, emptyToleranceG: v })} step={1} min={1} max={50} unit="g" />
          </SettingRow>
          <SettingRow label="空瓶稳定窗口">
            <NumberField value={form.emptyStabilityWindowS} onChange={(v) => setForm({ ...form, emptyStabilityWindowS: v })} step={0.5} min={0.5} max={30} unit="秒" />
          </SettingRow>
        </SettingCard>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          保存
        </Button>
        <Button size="sm" variant="outline" onClick={refetch} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          刷新
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// 编辑器 Tab
// ============================================================
function EditorTab() {
  const {
    editor, sensor,
    setAutoSaveDraft, setMaxHistory, setDefaultWindowSeconds,
  } = useSettings();

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>实验编辑器</SectionTitle>
        <SettingCard>
          <SettingRow label="自动保存草稿" description="自动保存未保存的更改">
            <Switch checked={editor.autoSaveDraft} onCheckedChange={setAutoSaveDraft} />
          </SettingRow>
          <SettingRow label="最大撤销步数">
            <Select
              value={String(editor.maxHistory)}
              onValueChange={(v) => setMaxHistory(Number(v))}
            >
              <SelectTrigger className="w-24 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20 步</SelectItem>
                <SelectItem value="50">50 步</SelectItem>
                <SelectItem value="100">100 步</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingCard>
      </div>

      <div>
        <SectionTitle>传感器面板</SectionTitle>
        <SettingCard>
          <SettingRow label="默认时间窗" description="图表初始显示的时间范围">
            <Select
              value={String(sensor.defaultWindowSeconds)}
              onValueChange={(v) => setDefaultWindowSeconds(Number(v))}
            >
              <SelectTrigger className="w-24 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 秒</SelectItem>
                <SelectItem value="60">60 秒</SelectItem>
                <SelectItem value="120">2 分钟</SelectItem>
                <SelectItem value="300">5 分钟</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingCard>
      </div>
    </div>
  );
}

// ============================================================
// 关于 Tab
// ============================================================
function AboutTab() {
  const infoItems = [
    { icon: Info, label: "系统", value: "电子鼻实验系统" },
    { icon: GitBranch, label: "版本", value: "0.1.0" },
    { icon: Server, label: "控制后端", value: "rpi5.local:50051", mono: true },
    { icon: Server, label: "分析后端", value: "rpi5.local:50052", mono: true },
    { icon: Monitor, label: "前端框架", value: "Next.js 15 + React 19" },
    { icon: Cpu, label: "运行设备", value: "Raspberry Pi 5" },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
          <FlaskConical className="w-7 h-7 text-primary" />
        </div>
        <h3 className="text-base font-semibold">Proj RPi Enose</h3>
        <p className="text-xs text-muted-foreground mt-1">Electronic Nose Control System</p>
      </div>

      <SettingCard>
        {infoItems.map(({ icon: Icon, label, value, mono }, i) => (
          <div key={i} className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </div>
            <span className={cn("text-[13px]", mono && "font-mono text-xs")}>{value}</span>
          </div>
        ))}
      </SettingCard>
    </div>
  );
}

// ============================================================
// Main Dialog
// ============================================================
const navItems = [
  { key: "appearance", label: "外观", icon: Palette },
  { key: "connection", label: "连接", icon: Wifi },
  { key: "loadcell", label: "称重传感器", icon: Scale },
  { key: "defaults", label: "实验默认值", icon: FlaskConical },
  { key: "editor", label: "编辑器", icon: Workflow },
  { key: "about", label: "关于", icon: Info },
] as const;

type NavKey = (typeof navItems)[number]["key"];

const panels: Record<NavKey, React.FC> = {
  appearance: AppearanceTab,
  connection: ConnectionTab,
  loadcell: LoadCellTab,
  defaults: ExperimentDefaultsTab,
  editor: EditorTab,
  about: AboutTab,
};

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useSettings();
  const [active, setActive] = useState<NavKey>("appearance");

  const ActivePanel = panels[active];
  const activeItem = navItems.find((n) => n.key === active)!;

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="!block sm:!max-w-4xl h-[80vh] p-0 gap-0 overflow-hidden rounded-xl">
        <div className="flex h-full">
          {/* 左侧导航 */}
          <nav className="w-48 shrink-0 border-r bg-muted/40 flex flex-col">
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-sm font-semibold">设置</h2>
            </div>
            <div className="flex-1 px-2 pb-2 space-y-0.5 overflow-y-auto">
              {navItems.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActive(key)}
                  className={cn(
                    "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] transition-colors",
                    active === key
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="pl-2">{label}</div>
                </button>
              ))}
            </div>
          </nav>
          {/* 右侧内容 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="shrink-0 px-6 pt-5 pb-4 border-b">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                  <activeItem.icon className="w-4 h-4" />
                </div>
                <h2 className="text-base font-semibold">{activeItem.label}</h2>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <ActivePanel />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
