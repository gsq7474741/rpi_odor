"use client";

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppSettings {
  // 外观
  sidebar: {
    defaultCollapsed: boolean;
  };
  // 连接
  connection: {
    pingIntervalMs: number;
    showLatency: boolean;
  };
  // 编辑器
  editor: {
    autoSaveDraft: boolean;
    maxHistory: number;
  };
  // 传感器面板
  sensor: {
    defaultWindowSeconds: number;
  };
}

interface SettingsStore extends AppSettings {
  // 设置 Dialog 开关
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // 更新方法
  setSidebarDefaultCollapsed: (collapsed: boolean) => void;
  setPingIntervalMs: (ms: number) => void;
  setShowLatency: (show: boolean) => void;
  setAutoSaveDraft: (enabled: boolean) => void;
  setMaxHistory: (max: number) => void;
  setDefaultWindowSeconds: (seconds: number) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      // 默认值
      sidebar: { defaultCollapsed: false },
      connection: { pingIntervalMs: 2000, showLatency: true },
      editor: { autoSaveDraft: true, maxHistory: 50 },
      sensor: { defaultWindowSeconds: 60 },

      // Dialog 状态 (不持久化)
      settingsOpen: false,
      setSettingsOpen: (open) => set({ settingsOpen: open }),

      // 更新方法
      setSidebarDefaultCollapsed: (collapsed) =>
        set((state) => ({ sidebar: { ...state.sidebar, defaultCollapsed: collapsed } })),
      setPingIntervalMs: (ms) =>
        set((state) => ({ connection: { ...state.connection, pingIntervalMs: ms } })),
      setShowLatency: (show) =>
        set((state) => ({ connection: { ...state.connection, showLatency: show } })),
      setAutoSaveDraft: (enabled) =>
        set((state) => ({ editor: { ...state.editor, autoSaveDraft: enabled } })),
      setMaxHistory: (max) =>
        set((state) => ({ editor: { ...state.editor, maxHistory: max } })),
      setDefaultWindowSeconds: (seconds) =>
        set((state) => ({ sensor: { ...state.sensor, defaultWindowSeconds: seconds } })),
    }),
    {
      name: 'enose-settings',
      partialize: (state) => ({
        sidebar: state.sidebar,
        connection: state.connection,
        editor: state.editor,
        sensor: state.sensor,
      }),
    }
  )
);
