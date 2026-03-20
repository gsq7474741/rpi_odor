"use client";

import { useState, useCallback, useEffect } from "react";

// 保存的选择集
export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  // 选中的样本 IDs
  sampleIds: number[];
  // 筛选条件
  filters: {
    runIds: number[];
    phaseNames: string[];
    liquidIds: string[];
    experimentPhases: string[];
    componentCount: number | null;
    qualityLevels: string[];
    showAnchorsOnly: boolean;
    showBlanksOnly: boolean;
    hideAnchorsAndBlanks: boolean;
    searchQuery: string;
    hasAlignedSeries: boolean | null;
  };
  // ML 标签配置
  mlLabelConfig: string;
  mlSplitRatios: { train: number; val: number };
  // 对齐序列配置
  seriesConfig: { method: string; nSamples: number };
}

const STORAGE_KEY = "enose-saved-queries";

function loadFromStorage(): SavedQuery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(queries: SavedQuery[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch {
    console.error("Failed to save queries to localStorage");
  }
}

export function useSavedQueries() {
  const [queries, setQueries] = useState<SavedQuery[]>([]);

  // 初始化加载
  useEffect(() => {
    setQueries(loadFromStorage());
  }, []);

  // 保存选择集
  const saveQuery = useCallback(
    (query: Omit<SavedQuery, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const newQuery: SavedQuery = {
        ...query,
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };
      setQueries((prev) => {
        const next = [newQuery, ...prev];
        saveToStorage(next);
        return next;
      });
      return newQuery;
    },
    []
  );

  // 更新选择集
  const updateQuery = useCallback(
    (id: string, updates: Partial<Omit<SavedQuery, "id" | "createdAt">>) => {
      setQueries((prev) => {
        const next = prev.map((q) =>
          q.id === id
            ? { ...q, ...updates, updatedAt: new Date().toISOString() }
            : q
        );
        saveToStorage(next);
        return next;
      });
    },
    []
  );

  // 删除选择集
  const deleteQuery = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.filter((q) => q.id !== id);
      saveToStorage(next);
      return next;
    });
  }, []);

  // 重命名选择集
  const renameQuery = useCallback(
    (id: string, name: string) => {
      updateQuery(id, { name });
    },
    [updateQuery]
  );

  return { queries, saveQuery, updateQuery, deleteQuery, renameQuery };
}
