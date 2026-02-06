"use client";

import { useState, useEffect, useCallback } from 'react';

export interface WashDefaults {
  fillTimeoutS: number;
  drainTimeoutS: number;
  emptyToleranceG: number;
  emptyStabilityWindowS: number;
  gasPumpPwm: number;
  washVolumeMl: number;
  repeatCount: number;
}

export interface SystemDefaults {
  wash: WashDefaults;
}

const FALLBACK: SystemDefaults = {
  wash: {
    fillTimeoutS: 60,
    drainTimeoutS: 60,
    emptyToleranceG: 10,
    emptyStabilityWindowS: 2,
    gasPumpPwm: 50,
    washVolumeMl: 20,
    repeatCount: 2,
  },
};

export function useSystemDefaults() {
  const [defaults, setDefaults] = useState<SystemDefaults>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchDefaults = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/defaults');
      if (res.ok) {
        const data = await res.json();
        setDefaults(data);
      }
    } catch {
      // use fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDefaults();
  }, [fetchDefaults]);

  const saveDefaults = useCallback(async (newDefaults: SystemDefaults) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDefaults),
      });
      if (res.ok) {
        setDefaults(newDefaults);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { defaults, loading, saving, saveDefaults, refetch: fetchDefaults };
}
