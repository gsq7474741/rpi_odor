"""数据加载模块 — PCHIP 对齐 + 样本元数据查询。

核心输出:
  X_raw: np.ndarray (N, T, 32) — 对齐后的传感器序列
  meta:  list[SampleMeta]      — 每个样本的元数据
"""

from __future__ import annotations

import numpy as np
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import defaultdict
from dataclasses import dataclass, field

from .config import ExperimentConfig, load_db_dsn, get_cache_dir
from .utils import log, StepTimer, progress_bar, save_cache, load_cache, save_meta, load_meta


# ═══════════════════════════════════════════════════════════════
# 数据结构
# ═══════════════════════════════════════════════════════════════

@dataclass
class SampleMeta:
    """单个样本的元数据"""
    sid: int
    idx: int
    names: list[str]
    ratios: list[float]
    is_pure: bool
    combo_key: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "sid": self.sid, "idx": self.idx,
            "names": self.names, "ratios": self.ratios,
            "is_pure": self.is_pure, "combo_key": self.combo_key,
        }

    @classmethod
    def from_dict(cls, d: dict) -> SampleMeta:
        return cls(
            sid=d["sid"], idx=d["idx"],
            names=list(d["names"]), ratios=list(d["ratios"]),
            is_pure=bool(d["is_pure"]), combo_key=tuple(d["combo_key"]),
        )


# ═══════════════════════════════════════════════════════════════
# PCHIP 对齐
# ═══════════════════════════════════════════════════════════════

def extract_aligned_series(
    dsn: str, sample_id: int, n_samples: int = 100, method: str = "pchip"
) -> np.ndarray | None:
    """提取单个样本的 32 通道 PCHIP 对齐序列。

    Returns: (n_samples, 32) ndarray 或 None
             列序: [8×value, 8×temperature, 8×humidity, 8×pressure]
    """
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT run_id, start_time_ms, end_time_ms FROM samples WHERE id = %s",
                [sample_id],
            )
            s = cur.fetchone()
            if not s:
                return None
            end_ms = s["end_time_ms"] or 9999999999999
            cur.execute(
                """SELECT time_ms, sensor_idx, value, temperature, humidity, pressure
                   FROM sensor_readings_v2
                   WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                   ORDER BY sensor_idx, time_ms""",
                [s["run_id"], s["start_time_ms"], end_ms],
            )
            rows = cur.fetchall()

    if not rows:
        return None

    grid = np.linspace(0, 1, n_samples)
    ch_names = ("value", "temperature", "humidity", "pressure")
    resampled: dict[str, dict[int, np.ndarray]] = {ch: {} for ch in ch_names}

    for si in range(8):
        sr = [r for r in rows if r["sensor_idx"] == si]
        if len(sr) < 2:
            for ch in ch_names:
                resampled[ch][si] = np.full(n_samples, np.nan)
            continue

        t = np.array([r["time_ms"] for r in sr], dtype=np.float64)
        _, ui = np.unique(t, return_index=True)
        t = t[ui]
        span = t.max() - t.min()

        if span == 0:
            for ch in ch_names:
                vals = [sr[i][ch] for i in ui]
                resampled[ch][si] = np.full(n_samples, vals[0] if vals else np.nan)
            continue

        nt = (t - t.min()) / span
        for ch in ch_names:
            vals = np.array([sr[i][ch] for i in ui], dtype=np.float64)
            try:
                if method == "pchip":
                    f = interpolate.PchipInterpolator(nt, vals, extrapolate=True)
                else:
                    f = interpolate.interp1d(nt, vals, kind="linear", fill_value="extrapolate")
                resampled[ch][si] = f(grid)
            except Exception:
                resampled[ch][si] = np.full(n_samples, np.nan)

    # 组装 (n_samples, 32)
    columns = []
    for ch in ch_names:
        for i in range(8):
            columns.append(resampled[ch].get(i, np.full(n_samples, np.nan)))
    series = np.column_stack(columns)
    np.nan_to_num(series, copy=False, nan=0.0)
    return series


# ═══════════════════════════════════════════════════════════════
# 批量加载
# ═══════════════════════════════════════════════════════════════

def query_samples(dsn: str, run_id: int) -> list[dict]:
    """查询指定 run 的所有样本元信息"""
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, sample_idx, liquid_names, liquid_ratios,
                       start_time_ms, end_time_ms
                FROM samples WHERE run_id = %s ORDER BY sample_idx
            """, (run_id,))
            return cur.fetchall()


def load_dataset(
    exp: ExperimentConfig, force_reload: bool = False
) -> tuple[np.ndarray, list[SampleMeta]]:
    """加载完整数据集，支持缓存。

    Returns:
        X_raw: (N, T, 32) 对齐序列
        meta:  N 个 SampleMeta
    """
    cache_dir = get_cache_dir(exp)
    cache_name = f"aligned_r{exp.run_id}_t{exp.alignment.n_samples}_{exp.alignment.method}"

    # 尝试从缓存加载
    if not force_reload:
        cached = load_cache(cache_dir, cache_name)
        meta_raw = load_meta(cache_dir, cache_name)
        if cached is not None and meta_raw is not None:
            X_raw = cached["X_raw"]
            meta = [SampleMeta.from_dict(m) for m in meta_raw]
            log.info(f"从缓存加载: X_raw={X_raw.shape}, meta={len(meta)}")
            return X_raw, meta

    # 从数据库加载
    dsn = load_db_dsn()

    with StepTimer(f"查询 Run {exp.run_id} 样本列表"):
        samples = query_samples(dsn, exp.run_id)
        log.info(f"  样本总数: {len(samples)}")

    with StepTimer(f"PCHIP 对齐 ({exp.alignment.n_samples} 步, {exp.alignment.method})"):
        series_list = []
        meta_list: list[SampleMeta] = []
        skipped = 0

        for s in progress_bar(samples, desc="对齐传感器序列"):
            ser = extract_aligned_series(
                dsn, s["id"], exp.alignment.n_samples, exp.alignment.method
            )
            if ser is None:
                skipped += 1
                continue

            series_list.append(ser)
            names = list(s["liquid_names"]) if s["liquid_names"] else []
            ratios = list(s["liquid_ratios"]) if s["liquid_ratios"] else [1.0]
            meta_list.append(SampleMeta(
                sid=s["id"], idx=s["sample_idx"],
                names=names, ratios=ratios,
                is_pure=len(names) == 1,
                combo_key=tuple(sorted(names)),
            ))

        X_raw = np.array(series_list)  # (N, T, 32)
        log.info(f"  加载完成: {X_raw.shape}, 跳过 {skipped} 个")

    # 保存缓存
    save_cache(cache_dir, cache_name, X_raw=X_raw)
    save_meta(cache_dir, cache_name, [m.to_dict() for m in meta_list])

    return X_raw, meta_list


# ═══════════════════════════════════════════════════════════════
# 辅助: 数据概况打印
# ═══════════════════════════════════════════════════════════════

def print_dataset_summary(exp: ExperimentConfig, meta: list[SampleMeta]):
    """打印数据集概况"""
    from .utils import print_header, print_table

    print_header(f"Run {exp.run_id} 数据概况 — {exp.description}")

    # 组合统计
    combo_counts: dict[tuple, int] = defaultdict(int)
    for m in meta:
        combo_counts[m.combo_key] += 1

    rows = []
    for combo, count in sorted(combo_counts.items(), key=lambda x: (-len(x[0]), x[0])):
        label = " + ".join([exp.short(c) for c in combo])
        rows.append([label, str(count)])
    print_table(["组合", "样本"], rows, [40, 6])

    # 比例分布
    ratio_dist: dict[str, int] = defaultdict(int)
    for m in meta:
        rkey = ":".join([f"{r:.0%}" for r in m.ratios])
        ratio_dist[rkey] += 1
    print("\n  比例分布:")
    for rkey, cnt in sorted(ratio_dist.items()):
        print(f"    {rkey} → {cnt}")
