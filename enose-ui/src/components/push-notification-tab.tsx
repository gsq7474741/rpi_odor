"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bell,
  BellOff,
  Loader2,
  Plus,
  Trash2,
  Smartphone,
  RefreshCw,
  CheckCircle,
  XCircle,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

interface PushSubscription {
  id: number;
  device_name: string;
  endpoint: string;
  enabled: boolean;
  created_at: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationTab() {
  const [subscriptions, setSubscriptions] = useState<PushSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [swSupported, setSwSupported] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [currentSub, setCurrentSub] = useState<globalThis.PushSubscription | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [isStandalone, setIsStandalone] = useState(false);

  // 检测环境
  useEffect(() => {
    const sw = "serviceWorker" in navigator;
    const push = "PushManager" in window;
    setSwSupported(sw);
    setPushSupported(push);
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true
    );

    // 注册 service worker
    if (sw) {
      navigator.serviceWorker.register("/sw.js").then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setCurrentSub(sub);
      }).catch(console.error);
    }
  }, []);

  // 加载已有订阅列表
  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/push-subscription");
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data.subscriptions || []);
      }
    } catch (e) {
      console.error("Failed to fetch subscriptions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  // 订阅推送
  const handleSubscribe = async () => {
    if (!swSupported || !pushSupported) {
      toast.error("当前浏览器不支持推送通知");
      return;
    }

    setSubscribing(true);
    try {
      // 获取 VAPID public key
      const keyRes = await fetch("/api/push-subscription?action=vapid-key");
      const { vapidPublicKey } = await keyRes.json();

      // 请求通知权限
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("通知权限被拒绝");
        setSubscribing(false);
        return;
      }

      // 订阅推送
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });

      setCurrentSub(sub);

      // 保存到后端
      const subJson = sub.toJSON();
      const res = await fetch("/api/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          deviceName: deviceName || getDefaultDeviceName(),
        }),
      });

      if (res.ok) {
        toast.success("推送通知已启用");
        setDeviceName("");
        fetchSubscriptions();
      } else {
        toast.error("保存订阅失败");
      }
    } catch (e) {
      console.error("Subscribe error:", e);
      toast.error("订阅失败: " + String(e));
    } finally {
      setSubscribing(false);
    }
  };

  // 取消订阅
  const handleUnsubscribe = async (id: number) => {
    try {
      await fetch("/api/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", id }),
      });
      toast.success("已删除订阅");
      fetchSubscriptions();
    } catch {
      toast.error("删除失败");
    }
  };

  // 切换启用状态
  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await fetch("/api/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", id, enabled }),
      });
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled } : s))
      );
    } catch {
      toast.error("切换失败");
    }
  };

  // 默认设备名
  function getDefaultDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    if (/Mac/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows PC";
    return "Unknown Device";
  }

  // 复制订阅链接（当前页面 URL）
  const copySubscribeUrl = () => {
    const url = window.location.origin;
    navigator.clipboard.writeText(url).then(() => {
      toast.success("已复制地址: " + url);
    });
  };

  const isCurrentDevice = (sub: PushSubscription) => {
    return currentSub && sub.endpoint === currentSub.endpoint;
  };

  return (
    <div className="space-y-6">
      {/* 环境检测 */}
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">环境检测</h3>
        <div className="mt-2 divide-y divide-border rounded-lg border bg-card px-4">
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px]">Service Worker</span>
            <Badge variant={swSupported ? "default" : "destructive"} className="text-[11px] px-2 py-0">
              {swSupported ? "支持" : "不支持"}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px]">Push API</span>
            <Badge variant={pushSupported ? "default" : "destructive"} className="text-[11px] px-2 py-0">
              {pushSupported ? "支持" : "不支持"}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px]">PWA 模式</span>
            <Badge variant={isStandalone ? "default" : "secondary"} className="text-[11px] px-2 py-0">
              {isStandalone ? "已添加到主屏幕" : "浏览器模式"}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px]">通知权限</span>
            <Badge
              variant={
                typeof Notification !== "undefined" && Notification.permission === "granted"
                  ? "default"
                  : "secondary"
              }
              className="text-[11px] px-2 py-0"
            >
              {typeof Notification !== "undefined" ? Notification.permission : "unknown"}
            </Badge>
          </div>
        </div>
      </div>

      {/* iOS 提示 */}
      {!isStandalone && /iPhone|iPad/.test(navigator.userAgent) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
          <p className="font-medium">iOS 需要将此网页添加到主屏幕才能接收推送</p>
          <p>点击 Safari 分享按钮 → &ldquo;添加到主屏幕&rdquo; → 从主屏幕打开后再订阅</p>
        </div>
      )}

      {/* 订阅当前设备 */}
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">订阅当前设备</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          实验需要人工操作时（如补充液体），将向已订阅设备发送推送通知
        </p>
        <div className="mt-3 flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">设备名称（可选）</Label>
            <Input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={getDefaultDeviceName()}
              className="h-8 text-sm mt-1"
            />
          </div>
          <Button
            size="sm"
            onClick={handleSubscribe}
            disabled={subscribing || !swSupported || !pushSupported}
            className="gap-1.5 shrink-0"
          >
            {subscribing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            订阅推送
          </Button>
        </div>
      </div>

      {/* 在其他设备上订阅 */}
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">在其他设备上订阅</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          用目标设备的浏览器打开以下地址，进入设置页面订阅推送
        </p>
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={copySubscribeUrl} className="gap-1.5">
            <Copy className="w-3.5 h-3.5" />
            复制网页地址
          </Button>
        </div>
      </div>

      {/* 已订阅设备列表 */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold tracking-tight">已订阅设备</h3>
          <Button size="sm" variant="ghost" onClick={fetchSubscriptions} className="h-7 gap-1 text-xs">
            <RefreshCw className="w-3 h-3" />
            刷新
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <BellOff className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">暂无订阅设备</p>
          </div>
        ) : (
          <div className="mt-2 divide-y divide-border rounded-lg border bg-card">
            {subscriptions.map((sub) => (
              <div key={sub.id} className="flex items-center gap-3 px-4 py-3">
                <Smartphone className="w-4 h-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium truncate">
                      {sub.device_name || "未命名设备"}
                    </span>
                    {isCurrentDevice(sub) && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        当前设备
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {sub.endpoint.replace(/^https?:\/\//, "").substring(0, 50)}...
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(sub.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {sub.enabled ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <Switch
                    checked={sub.enabled}
                    onCheckedChange={(checked) => handleToggle(sub.id, checked)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleUnsubscribe(sub.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
