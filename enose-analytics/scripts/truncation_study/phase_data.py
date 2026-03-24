"""扩展数据加载 — 支持完整样本周期 (ACQUIRE + 后续 WASH/INJECT 解析数据)。

每个样本的完整周期:
  [ACQUIRE 120s] → [WASH ~50s] → [INJECT ~15s] → [下一个样本的 ACQUIRE]

本模块加载 ACQUIRE 数据 + 紧随其后的 gap 数据(WASH+INJECT),
并按不同"phase 条件"切片, 供对比实验使用。
"""

from __future__ import annotations

import pickle
import numpy as np
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import defaultdict
from dataclasses import dataclass
from tqdm import tqdm

from .config import (
    CACHE_DIR, N_ALIGN_STEPS, load_db_dsn, ensure_dirs,
)


@dataclass
class SampleCycle:
    """单个样本的完整周期数据"""
    sid: int
    run_id: int
    idx: int
    names: list[str]
    ratios: list[float]
    is_pure: bool
    combo_key: tuple[str, ...]
    # ACQUIRE 阶段
    acq_start_ms: int
    acq_end_ms: int
    acq_dur_s: float
    # readings: {sensor_idx: [(relative_ms, val, temp, hum, press), ...]}
    acq_readings: dict[int, list[tuple]]
    # 解析阶段 (ACQUIRE后 gap 中的 WASH+INJECT 数据)
    # readings: {sensor_idx: [(relative_ms, val, temp, hum, press), ...]}
    # relative_ms 从 acq_start_ms 开始计算, 即 gap 数据的 time 是 120s+
    gap_readings: dict[int, list[tuple]]
    gap_dur_s: float  # gap 的时长


def _cache_key_phase(run_ids: list[int]) -> str:
    ids_str = "_".join(str(r) for r in sorted(run_ids))
    return f"phase_runs_{ids_str}.pkl"


def load_phase_data(
    run_ids: list[int], force_reload: bool = False,
) -> list[SampleCycle]:
    """加载完整周期数据 (ACQUIRE + gap), 支持缓存。"""
    ensure_dirs()
    cache_path = CACHE_DIR / _cache_key_phase(run_ids)

    if not force_reload and cache_path.exists():
        print(f"  📦 从缓存加载: {cache_path.name}")
        with open(cache_path, "rb") as f:
            data = pickle.load(f)
        print(f"  ✓ {len(data)} 个样本周期")
        return data

    dsn = load_db_dsn()
    placeholders = ",".join(["%s"] * len(run_ids))

    print(f"  🔌 连接数据库, 加载完整周期数据 (runs={run_ids})...")

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # 1) 所有样本元数据 (按 run_id, start_time_ms 排序)
            cur.execute(f"""
                SELECT id, run_id, sample_idx, liquid_names, liquid_ratios,
                       start_time_ms, end_time_ms
                FROM samples
                WHERE run_id IN ({placeholders})
                  AND end_time_ms IS NOT NULL
                ORDER BY run_id, start_time_ms
            """, run_ids)
            sample_rows = cur.fetchall()
            print(f"  ✓ 样本元数据: {len(sample_rows)} 条")

            # 2) 所有传感器读数 (包括 WASH/INJECT)
            print(f"  ⏳ 拉取所有阶段的传感器读数...")
            cur.execute(f"""
                SELECT run_id, time_ms, sensor_idx, value,
                       temperature, humidity, pressure, phase_name
                FROM sensor_readings_v2
                WHERE run_id IN ({placeholders})
                ORDER BY run_id, time_ms
            """, run_ids)
            all_readings = cur.fetchall()
            print(f"  ✓ 传感器读数: {len(all_readings)} 条 (含全阶段)")

    # 3) 按 run_id 分组, 按 time_ms 排序
    readings_by_run: dict[int, list] = defaultdict(list)
    for r in tqdm(all_readings, desc="  按 run 分组", leave=False):
        readings_by_run[r["run_id"]].append(r)
    del all_readings

    # 4) 对每个 run 建立时间有序列表, 预计算每个样本的 gap 边界
    # 按 run 分组样本
    samples_by_run: dict[int, list] = defaultdict(list)
    for s in sample_rows:
        samples_by_run[s["run_id"]].append(s)

    result: list[SampleCycle] = []
    skipped = 0

    for rid in tqdm(sorted(samples_by_run.keys()), desc="  组装周期数据"):
        run_samples = samples_by_run[rid]
        run_readings = readings_by_run.get(rid, [])

        # 建时间索引
        times_arr = np.array([r["time_ms"] for r in run_readings])

        for i, s in enumerate(run_samples):
            acq_start = s["start_time_ms"]
            acq_end = s["end_time_ms"]

            # gap 的结束: 下一个样本的 start_time_ms, 或 acq_end + 120000
            if i + 1 < len(run_samples):
                gap_end = run_samples[i + 1]["start_time_ms"]
            else:
                gap_end = acq_end + 120000  # 最后一个样本, 取 120s 后

            # 二分法找 ACQUIRE 数据
            import bisect
            lo = bisect.bisect_left(times_arr, acq_start)
            hi = bisect.bisect_right(times_arr, acq_end)
            acq_rows = run_readings[lo:hi]

            # 二分法找 gap 数据
            gap_lo = bisect.bisect_left(times_arr, acq_end + 1)
            gap_hi = bisect.bisect_right(times_arr, gap_end - 1)
            gap_rows = run_readings[gap_lo:gap_hi]

            if len(acq_rows) < 10:
                skipped += 1
                continue

            # 按 sensor_idx 分组, 转为相对时间 (relative to acq_start)
            acq_readings: dict[int, list[tuple]] = defaultdict(list)
            for r in acq_rows:
                acq_readings[r["sensor_idx"]].append((
                    r["time_ms"] - acq_start,
                    r["value"], r["temperature"], r["humidity"], r["pressure"],
                ))

            gap_readings: dict[int, list[tuple]] = defaultdict(list)
            for r in gap_rows:
                gap_readings[r["sensor_idx"]].append((
                    r["time_ms"] - acq_start,  # 相对于 acq_start, 所以 >120s
                    r["value"], r["temperature"], r["humidity"], r["pressure"],
                ))

            names = list(s["liquid_names"]) if s["liquid_names"] else []
            ratios = list(s["liquid_ratios"]) if s["liquid_ratios"] else [1.0]
            gap_dur = (gap_end - acq_end) / 1000.0

            result.append(SampleCycle(
                sid=s["id"], run_id=rid, idx=s["sample_idx"],
                names=names, ratios=ratios,
                is_pure=len(names) == 1,
                combo_key=tuple(sorted(names)),
                acq_start_ms=acq_start, acq_end_ms=acq_end,
                acq_dur_s=(acq_end - acq_start) / 1000.0,
                acq_readings=dict(acq_readings),
                gap_readings=dict(gap_readings),
                gap_dur_s=gap_dur,
            ))

    print(f"  ✓ 组装完成: {len(result)} 样本周期, 跳过 {skipped}")

    # 缓存
    print(f"  💾 写入缓存: {cache_path.name}")
    with open(cache_path, "wb") as f:
        pickle.dump(result, f, protocol=5)

    return result


# ═══════════════════════════════════════════════════════════════
# Phase 条件: 从完整周期中切片不同部分
# ═══════════════════════════════════════════════════════════════

def slice_phase(
    sample: SampleCycle,
    condition: str,
) -> dict[int, list[tuple]] | None:
    """根据 condition 从完整周期中切出指定部分的 readings。

    条件:
      "acquire_only"     — 纯 ACQUIRE (0-120s)
      "acquire_wash"     — ACQUIRE + WASH 部分 (~0-170s)
      "acquire_full_gap" — ACQUIRE + 完整 gap (~0-180s)
      "head_tail"        — ACQUIRE 前 30s + gap 后 30s
      "acquire_60"       — ACQUIRE 前 60s (对照, 从截断实验)

    Returns:
        {sensor_idx: [(relative_ms, val, temp, hum, press), ...]} 或 None
    """
    acq = sample.acq_readings
    gap = sample.gap_readings

    if condition == "acquire_only":
        return acq

    elif condition == "acquire_60":
        # 只取前 60s
        cutoff_ms = 60000
        result = {}
        for si, pts in acq.items():
            result[si] = [p for p in pts if p[0] <= cutoff_ms]
        return result

    elif condition == "acquire_wash":
        # ACQUIRE + WASH (gap 中前 50s, 大部分是 WASH)
        merged = {}
        wash_cutoff_ms = 120000 + 50000  # ~170s
        for si in range(8):
            pts = list(acq.get(si, []))
            gap_pts = [p for p in gap.get(si, []) if p[0] <= wash_cutoff_ms]
            pts.extend(gap_pts)
            if pts:
                merged[si] = pts
        return merged

    elif condition == "acquire_full_gap":
        # ACQUIRE + 完整 gap
        merged = {}
        for si in range(8):
            pts = list(acq.get(si, []))
            pts.extend(gap.get(si, []))
            if pts:
                merged[si] = pts
        return merged

    elif condition == "head_tail":
        # ACQUIRE 前 30s + WASH 开头 30s (解析起始, 传感器开始恢复)
        # gap 数据的 relative_ms 从 acq_start 开始, 所以 >120000ms
        acq_head_cutoff_ms = 30000
        gap_start_ms = sample.acq_dur_s * 1000  # ~120000
        gap_head_cutoff_ms = gap_start_ms + 30000  # ~150000
        merged = {}
        for si in range(8):
            head = [p for p in acq.get(si, []) if p[0] <= acq_head_cutoff_ms]
            gap_pts = gap.get(si, [])
            wash_head = [p for p in gap_pts if p[0] <= gap_head_cutoff_ms]
            if head or wash_head:
                merged[si] = head + wash_head
        return merged

    else:
        raise ValueError(f"Unknown condition: {condition}")


def align_readings(
    readings: dict[int, list[tuple]],
    n_steps: int = N_ALIGN_STEPS,
) -> np.ndarray | None:
    """将 readings 做 PCHIP 对齐到 (n_steps, 32)。"""
    grid = np.linspace(0, 1, n_steps)
    ch_indices = [1, 2, 3, 4]  # value, temperature, humidity, pressure
    resampled: dict[int, dict[int, np.ndarray]] = {ci: {} for ci in ch_indices}

    for si in range(8):
        pts = readings.get(si, [])
        if len(pts) < 2:
            for ci in ch_indices:
                resampled[ci][si] = np.full(n_steps, np.nan)
            continue

        t = np.array([p[0] for p in pts], dtype=np.float64)
        _, ui = np.unique(t, return_index=True)
        t = t[ui]
        span = t.max() - t.min()
        if span == 0:
            for ci in ch_indices:
                resampled[ci][si] = np.full(n_steps, pts[0][ci])
            continue

        nt = (t - t.min()) / span
        for ci in ch_indices:
            vals = np.array([pts[i][ci] for i in ui], dtype=np.float64)
            try:
                f = interpolate.PchipInterpolator(nt, vals, extrapolate=True)
                resampled[ci][si] = f(grid)
            except Exception:
                resampled[ci][si] = np.full(n_steps, np.nan)

    columns = []
    for ci in ch_indices:
        for si in range(8):
            columns.append(resampled[ci].get(si, np.full(n_steps, np.nan)))

    series = np.column_stack(columns)
    np.nan_to_num(series, copy=False, nan=0.0)
    return series


def build_phase_dataset(
    samples: list[SampleCycle],
    condition: str,
    indices: list[int] | None = None,
    n_steps: int = N_ALIGN_STEPS,
) -> tuple[np.ndarray, list[int]]:
    """对选定样本按 condition 切片 + PCHIP 对齐。

    Returns:
        X: (N, n_steps, 32), valid_indices
    """
    if indices is None:
        indices = list(range(len(samples)))

    series_list = []
    valid_indices = []

    for i in tqdm(indices, desc=f"    对齐 [{condition}]", leave=False):
        readings = slice_phase(samples[i], condition)
        if readings is None:
            continue
        series = align_readings(readings, n_steps)
        if series is not None:
            series_list.append(series)
            valid_indices.append(i)

    if not series_list:
        return np.empty((0, n_steps, 32)), []

    return np.array(series_list), valid_indices
