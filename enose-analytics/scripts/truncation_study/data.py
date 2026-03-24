"""数据加载模块 — 单次 DB 查询 + 本地 pickle 缓存 + 并行 PCHIP 对齐。

核心流程:
  1. load_raw_data()    → 从 DB / 缓存加载原始传感器数据
  2. build_truncated()  → 按截断秒数截取 + PCHIP 对齐 (多进程)
"""

from __future__ import annotations

import pickle
import hashlib
import numpy as np
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from tqdm import tqdm

from .config import (
    CACHE_DIR, GOOD_SENSORS, N_ALIGN_STEPS, SEED,
    load_db_dsn, ensure_dirs,
)


# ═══════════════════════════════════════════════════════════════
# 数据结构
# ═══════════════════════════════════════════════════════════════

@dataclass
class SampleRaw:
    """单个样本的原始数据 (带绝对时间戳)"""
    sid: int
    run_id: int
    idx: int
    names: list[str]
    ratios: list[float]
    is_pure: bool
    combo_key: tuple[str, ...]
    start_ms: int
    end_ms: int
    duration_s: float
    # 按 sensor_idx 分组的原始读数: {sensor_idx: [(time_ms, value, temp, hum, press), ...]}
    readings: dict[int, list[tuple[int, float, float, float, float]]]

    def to_cache_dict(self) -> dict:
        return {
            "sid": self.sid, "run_id": self.run_id, "idx": self.idx,
            "names": self.names, "ratios": self.ratios,
            "is_pure": self.is_pure, "combo_key": list(self.combo_key),
            "start_ms": self.start_ms, "end_ms": self.end_ms,
            "duration_s": self.duration_s,
            "readings": {k: v for k, v in self.readings.items()},
        }

    @classmethod
    def from_cache_dict(cls, d: dict) -> SampleRaw:
        return cls(
            sid=d["sid"], run_id=d["run_id"], idx=d["idx"],
            names=d["names"], ratios=d["ratios"],
            is_pure=d["is_pure"], combo_key=tuple(d["combo_key"]),
            start_ms=d["start_ms"], end_ms=d["end_ms"],
            duration_s=d["duration_s"],
            readings=d["readings"],
        )


# ═══════════════════════════════════════════════════════════════
# 1. 数据加载 (单次 DB 查询 + 缓存)
# ═══════════════════════════════════════════════════════════════

def _cache_key(run_ids: list[int]) -> str:
    """生成缓存文件名"""
    ids_str = "_".join(str(r) for r in sorted(run_ids))
    return f"raw_runs_{ids_str}.pkl"


def load_raw_data(
    run_ids: list[int], force_reload: bool = False
) -> list[SampleRaw]:
    """加载原始传感器数据: 优先本地缓存, 否则从 DB 单次查询。

    Args:
        run_ids: 要加载的 run ID 列表
        force_reload: 跳过缓存, 强制从 DB 加载

    Returns:
        list[SampleRaw] — 所有样本的原始数据
    """
    ensure_dirs()
    cache_path = CACHE_DIR / _cache_key(run_ids)

    # ── 尝试缓存 ──
    if not force_reload and cache_path.exists():
        print(f"  📦 从缓存加载: {cache_path.name}")
        with open(cache_path, "rb") as f:
            cache_list = pickle.load(f)
        samples = [SampleRaw.from_cache_dict(d) for d in tqdm(cache_list, desc="  反序列化")]
        print(f"  ✓ {len(samples)} 个样本")
        return samples

    # ── 从 DB 加载 (单次连接, 两次查询) ──
    dsn = load_db_dsn()
    placeholders = ",".join(["%s"] * len(run_ids))

    print(f"  🔌 连接数据库, 加载 runs={run_ids}...")

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # 查询 1: 所有样本元数据
            cur.execute(f"""
                SELECT id, run_id, sample_idx, liquid_names, liquid_ratios,
                       start_time_ms, end_time_ms
                FROM samples
                WHERE run_id IN ({placeholders})
                  AND end_time_ms IS NOT NULL
                ORDER BY run_id, sample_idx
            """, run_ids)
            sample_rows = cur.fetchall()
            print(f"  ✓ 样本元数据: {len(sample_rows)} 条")

            # 查询 2: 所有传感器读数 (一次拉取)
            print(f"  ⏳ 拉取传感器读数 (可能较慢)...")
            cur.execute(f"""
                SELECT run_id, time_ms, sensor_idx, value,
                       temperature, humidity, pressure
                FROM sensor_readings_v2
                WHERE run_id IN ({placeholders})
                ORDER BY run_id, time_ms
            """, run_ids)
            all_readings = cur.fetchall()
            print(f"  ✓ 传感器读数: {len(all_readings)} 条")

    # ── 按 (run_id, time_ms) 建索引, 供快速筛选 ──
    print(f"  ⏳ 建立索引...")
    # 先按 run_id 分组
    readings_by_run: dict[int, list] = defaultdict(list)
    for r in tqdm(all_readings, desc="  按 run 分组"):
        readings_by_run[r["run_id"]].append(r)
    del all_readings

    # 每个 run 内按 time_ms 排序 (DB 已排序, 但确保)
    for rid in readings_by_run:
        readings_by_run[rid].sort(key=lambda x: x["time_ms"])

    # ── 组装 SampleRaw ──
    samples: list[SampleRaw] = []
    skipped = 0

    for s in tqdm(sample_rows, desc="  组装样本数据"):
        rid = s["run_id"]
        start_ms = s["start_time_ms"]
        end_ms = s["end_time_ms"]
        run_data = readings_by_run.get(rid, [])

        # 二分法找起止位置 (run_data 已按 time_ms 排序)
        import bisect
        times = [r["time_ms"] for r in run_data]
        lo = bisect.bisect_left(times, start_ms)
        hi = bisect.bisect_right(times, end_ms)
        matched = run_data[lo:hi]

        if not matched:
            skipped += 1
            continue

        # 按 sensor_idx 分组为紧凑元组
        readings: dict[int, list[tuple]] = defaultdict(list)
        for r in matched:
            readings[r["sensor_idx"]].append((
                r["time_ms"], r["value"],
                r["temperature"], r["humidity"], r["pressure"],
            ))

        names = list(s["liquid_names"]) if s["liquid_names"] else []
        ratios = list(s["liquid_ratios"]) if s["liquid_ratios"] else [1.0]

        samples.append(SampleRaw(
            sid=s["id"], run_id=rid, idx=s["sample_idx"],
            names=names, ratios=ratios,
            is_pure=len(names) == 1,
            combo_key=tuple(sorted(names)),
            start_ms=start_ms, end_ms=end_ms,
            duration_s=(end_ms - start_ms) / 1000.0,
            readings=dict(readings),
        ))

    print(f"  ✓ 组装完成: {len(samples)} 样本, 跳过 {skipped}")

    # ── 写入缓存 ──
    print(f"  💾 写入缓存: {cache_path.name}")
    with open(cache_path, "wb") as f:
        pickle.dump([s.to_cache_dict() for s in samples], f, protocol=5)

    return samples


# ═══════════════════════════════════════════════════════════════
# 2. 截断 + PCHIP 对齐 (支持并行)
# ═══════════════════════════════════════════════════════════════

def _pchip_align_single(
    readings: dict[int, list[tuple]],
    start_ms: int,
    cutoff_s: float,
    n_steps: int,
) -> np.ndarray | None:
    """对单个样本截断 + PCHIP 对齐。

    Args:
        readings: {sensor_idx: [(time_ms, val, temp, hum, press), ...]}
        start_ms: 样本起始时间
        cutoff_s: 截断秒数
        n_steps: 对齐后时间步数

    Returns:
        (n_steps, 32) ndarray 或 None
    """
    cutoff_ms = start_ms + cutoff_s * 1000
    grid = np.linspace(0, 1, n_steps)
    ch_indices = [1, 2, 3, 4]  # value, temperature, humidity, pressure
    resampled: dict[int, dict[int, np.ndarray]] = {ci: {} for ci in ch_indices}

    for si in range(8):
        raw = readings.get(si, [])
        # 截断
        pts = [p for p in raw if p[0] <= cutoff_ms]
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

    # 组装 (n_steps, 32): [8×value, 8×temp, 8×humidity, 8×pressure]
    columns = []
    for ci in ch_indices:
        for si in range(8):
            columns.append(resampled[ci].get(si, np.full(n_steps, np.nan)))

    series = np.column_stack(columns)
    np.nan_to_num(series, copy=False, nan=0.0)
    return series


def _align_worker(args):
    """multiprocessing worker — 对一个样本做截断对齐"""
    idx, readings, start_ms, cutoff_s, n_steps = args
    result = _pchip_align_single(readings, start_ms, cutoff_s, n_steps)
    return idx, result


def build_truncated(
    samples: list[SampleRaw],
    cutoff_s: float,
    indices: list[int] | None = None,
    n_steps: int = N_ALIGN_STEPS,
    n_workers: int = 4,
) -> tuple[np.ndarray, list[int]]:
    """对选定样本按 cutoff_s 截断 + PCHIP 对齐 (多进程)。

    Args:
        samples: 全部 SampleRaw 列表
        cutoff_s: 截断秒数
        indices: 选定的样本索引 (None=全部)
        n_steps: 对齐时间步数
        n_workers: 并行进程数

    Returns:
        X: (N, n_steps, 32) ndarray
        valid_indices: 成功对齐的原始索引列表
    """
    if indices is None:
        indices = list(range(len(samples)))

    # 构建任务列表
    tasks = []
    for i in indices:
        s = samples[i]
        tasks.append((i, s.readings, s.start_ms, cutoff_s, n_steps))

    # 多进程执行
    series_list = []
    valid_indices = []

    if n_workers <= 1 or len(tasks) <= 10:
        # 小任务量直接串行
        for args in tqdm(tasks, desc=f"    对齐 {cutoff_s:.0f}s", leave=False):
            idx, result = _align_worker(args)
            if result is not None:
                series_list.append(result)
                valid_indices.append(idx)
    else:
        # 多进程
        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            futures = {pool.submit(_align_worker, t): t[0] for t in tasks}
            for future in tqdm(
                as_completed(futures), total=len(futures),
                desc=f"    对齐 {cutoff_s:.0f}s", leave=False,
            ):
                idx, result = future.result()
                if result is not None:
                    series_list.append((idx, result))

            # 按原始索引排序
            series_list.sort(key=lambda x: x[0])
            valid_indices = [x[0] for x in series_list]
            series_list = [x[1] for x in series_list]

    if not series_list:
        return np.empty((0, n_steps, 32)), []

    return np.array(series_list), valid_indices
