"""归一化帧生成模块 - 将异步传感器数据重采样为固定长度帧"""

import threading
import time
from typing import Literal

import numpy as np
import pandas as pd
from scipy import interpolate

from .connection import get_cursor
from ..logger import logger
from ..cache.frame_cache import FrameCache


InterpolationMethod = Literal["linear", "pchip"]

# 全局 Redis 缓存实例（懒加载）
_frame_cache: FrameCache | None = None
_frame_cache_last_fail: float = 0.0  # 上次连接失败的时间戳
_FRAME_CACHE_RETRY_INTERVAL = 60.0  # 失败后 60 秒内不重试

# 并发请求去重锁 (防止 thundering herd)
_inflight_locks: dict[str, threading.Lock] = {}
_inflight_meta_lock = threading.Lock()  # 保护 _inflight_locks 字典本身


def _get_inflight_lock(key: str) -> threading.Lock:
    """获取指定 key 的去重锁（线程安全）"""
    with _inflight_meta_lock:
        if key not in _inflight_locks:
            _inflight_locks[key] = threading.Lock()
        return _inflight_locks[key]


def get_frame_cache() -> FrameCache | None:
    """获取或创建 Redis 缓存实例（带失败退避）"""
    global _frame_cache, _frame_cache_last_fail
    if _frame_cache is not None:
        return _frame_cache
    # 退避：距上次失败不足 60 秒则跳过
    if time.time() - _frame_cache_last_fail < _FRAME_CACHE_RETRY_INTERVAL:
        return None
    try:
        cache = FrameCache()
        if not cache.health_check():
            logger.warning("Redis 健康检查失败，禁用缓存 (%.0fs 后重试)", _FRAME_CACHE_RETRY_INTERVAL)
            _frame_cache_last_fail = time.time()
            return None
        _frame_cache = cache
        logger.info("Redis 缓存已连接")
        return _frame_cache
    except Exception as e:
        logger.warning(f"Redis 连接失败，禁用缓存 ({_FRAME_CACHE_RETRY_INTERVAL:.0f}s 后重试): {e}")
        _frame_cache_last_fail = time.time()
        return None


class FrameNormalizer:
    """归一化帧生成器"""

    def get_raw_sensor_data_by_sample(
        self,
        sample_id: int,
    ) -> pd.DataFrame:
        """获取指定样本的原始传感器数据（新接口）"""
        query = """
            SELECT 
                time_ms,
                sensor_idx,
                value,
                temperature,
                humidity,
                pressure
            FROM sensor_readings_v2
            WHERE sample_id = %s
            ORDER BY sensor_idx, time_ms
        """
        with get_cursor() as cur:
            cur.execute(query, [sample_id])
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def get_sample_data_info(
        self,
        sample_id: int,
        phase_names: list[str] | None = None,
    ) -> dict:
        """获取样本原始数据的统计信息，用于变长处理和质量评估

        Args:
            sample_id: 样本 ID
            phase_names: 可选的 phase 名称列表

        Returns:
            {
                "sample_id": int,
                "original_point_counts": list[int],  # 每个传感器的原始点数
                "min_points": int,                    # 所有传感器中的最少点数
                "max_points": int,                    # 所有传感器中的最多点数
                "median_points": int,                 # 中位数点数
                "time_range_ms": int,                 # 原始时间跨度
                "recommended_n_samples": int,         # 推荐的 n_samples
                "quality_warnings": list[str],        # 质量警告
            }
        """
        if phase_names:
            raw_df = self.get_raw_sensor_data_by_phases(sample_id, phase_names)
        else:
            raw_df = self.get_raw_sensor_data_by_sample(sample_id)

        if raw_df.empty:
            return {
                "sample_id": sample_id,
                "original_point_counts": [0] * 8,
                "min_points": 0,
                "max_points": 0,
                "median_points": 0,
                "time_range_ms": 0,
                "recommended_n_samples": 0,
                "quality_warnings": ["无传感器数据"],
            }

        counts = []
        for sensor_idx in range(8):
            n = len(raw_df[raw_df["sensor_idx"] == sensor_idx])
            counts.append(n)

        # 只统计有数据的传感器
        active_counts = [c for c in counts if c > 0]
        min_pts = min(active_counts) if active_counts else 0
        max_pts = max(active_counts) if active_counts else 0
        median_pts = int(np.median(active_counts)) if active_counts else 0

        # 推荐 n_samples: 中位数点数的 80%，但不超过 500，不少于 10
        recommended = max(10, min(500, int(median_pts * 0.8)))

        all_times = raw_df["time_ms"]
        time_range_ms = int(all_times.max() - all_times.min()) if len(all_times) > 0 else 0

        warnings: list[str] = []
        if min_pts < 5:
            warnings.append(f"传感器数据过少 (最少 {min_pts} 点)，插值可能不可靠")
        if min_pts < 2:
            warnings.append("至少有一个传感器数据不足 2 点，无法插值")
        if max_pts > 0 and min_pts > 0 and max_pts / min_pts > 5:
            warnings.append(
                f"传感器间数据量差异大 (最多 {max_pts} vs 最少 {min_pts})，"
                "部分传感器采样率可能异常"
            )
        inactive = sum(1 for c in counts if c == 0)
        if inactive > 0:
            warnings.append(f"{inactive} 个传感器无数据")

        return {
            "sample_id": sample_id,
            "original_point_counts": counts,
            "min_points": min_pts,
            "max_points": max_pts,
            "median_points": median_pts,
            "time_range_ms": time_range_ms,
            "recommended_n_samples": recommended,
            "quality_warnings": warnings,
        }

    def get_raw_sensor_data_by_phases(
        self,
        sample_id: int,
        phase_names: list[str],
    ) -> pd.DataFrame:
        """按 phase transition 时间范围获取传感器数据

        通过 sample_phase_transitions 查找时间范围，再用 run_id + 时间范围
        从 sensor_readings_v2 获取数据。这样即使某些阶段的 sample_id 为 NULL
        （如 WASH、DRAIN 等），也能正确获取数据。

        Args:
            sample_id: 样本 ID
            phase_names: 要获取的阶段名称列表

        Returns:
            包含所有指定阶段传感器数据的 DataFrame
        """
        # 1. 获取样本的 run_id 和 phase transitions
        with get_cursor() as cur:
            cur.execute("SELECT run_id FROM samples WHERE id = %s", [sample_id])
            sample_row = cur.fetchone()
            if not sample_row:
                logger.warning(f"Sample not found: sample_id={sample_id}")
                return pd.DataFrame()
            run_id = sample_row["run_id"]

            cur.execute(
                """
                SELECT phase_name, start_time_ms, end_time_ms
                FROM sample_phase_transitions
                WHERE sample_id = %s AND phase_name = ANY(%s)
                ORDER BY phase_order
                """,
                [sample_id, phase_names],
            )
            transitions = cur.fetchall()

        if not transitions:
            logger.warning(
                f"No phase transitions for sample_id={sample_id}, phases={phase_names}"
            )
            return pd.DataFrame()

        # 2. 对每个 phase 按时间范围查询传感器数据
        all_dfs: list[pd.DataFrame] = []
        for t in transitions:
            start = t["start_time_ms"]
            end = t["end_time_ms"]
            if end:
                q = """
                    SELECT time_ms, sensor_idx, value, temperature, humidity, pressure
                    FROM sensor_readings_v2
                    WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                    ORDER BY sensor_idx, time_ms
                """
                params = [run_id, start, end]
            else:
                q = """
                    SELECT time_ms, sensor_idx, value, temperature, humidity, pressure
                    FROM sensor_readings_v2
                    WHERE run_id = %s AND time_ms >= %s
                    ORDER BY sensor_idx, time_ms
                """
                params = [run_id, start]

            with get_cursor() as cur:
                cur.execute(q, params)
                rows = cur.fetchall()
            if rows:
                all_dfs.append(pd.DataFrame(rows))

        if not all_dfs:
            logger.warning(
                f"No sensor data in phase time ranges: sample_id={sample_id}, "
                f"phases={phase_names}"
            )
            return pd.DataFrame()

        combined = pd.concat(all_dfs, ignore_index=True)
        logger.debug(
            f"Phase data fetch: sample_id={sample_id} phases={phase_names} "
            f"run_id={run_id} → {len(combined)} rows"
        )
        return combined

    def _filter_by_phases(
        self,
        raw_df: pd.DataFrame,
        sample_id: int,
        phase_names: list[str],
    ) -> pd.DataFrame:
        """按 phase 时间区间过滤传感器数据，仅保留指定 phase 内的读数"""
        query = """
            SELECT phase_name, start_time_ms, end_time_ms
            FROM sample_phase_transitions
            WHERE sample_id = %s AND phase_name = ANY(%s)
            ORDER BY phase_order
        """
        with get_cursor() as cur:
            cur.execute(query, [sample_id, phase_names])
            transitions = cur.fetchall()

        if not transitions:
            logger.warning(f"No phase transitions for sample_id={sample_id}, phases={phase_names}")
            return pd.DataFrame()

        # 构建时间范围 mask
        mask = pd.Series(False, index=raw_df.index)
        for t in transitions:
            start = t["start_time_ms"]
            end = t["end_time_ms"]
            if end:
                mask |= (raw_df["time_ms"] >= start) & (raw_df["time_ms"] <= end)
            else:
                mask |= raw_df["time_ms"] >= start

        filtered = raw_df[mask]
        logger.debug(
            f"Phase filter: sample_id={sample_id} phases={phase_names} "
            f"kept {len(filtered)}/{len(raw_df)} rows"
        )
        return filtered

    def _interpolate_channel(
        self,
        normalized_t: np.ndarray,
        values: np.ndarray,
        grid: np.ndarray,
        method: InterpolationMethod,
        n_samples: int,
    ) -> np.ndarray:
        """对单个通道进行插值"""
        try:
            if method == "linear":
                f = interpolate.interp1d(
                    normalized_t,
                    values,
                    kind="linear",
                    fill_value="extrapolate",
                )
            elif method == "pchip":
                f = interpolate.PchipInterpolator(
                    normalized_t, values, extrapolate=True
                )
            else:
                raise ValueError(f"Unknown interpolation method: {method}")
            return f(grid)
        except Exception:
            return np.full(n_samples, np.nan)

    def create_normalized_frames_by_sample(
        self,
        sample_id: int,
        n_samples: int = 100,
        method: InterpolationMethod = "linear",
        phase_names: list[str] | None = None,
    ) -> tuple[np.ndarray, dict]:
        """
        将异步传感器数据归一化为固定长度帧（基于 sample_id 的新接口）
        
        每个传感器 4 通道: value, temperature, humidity, pressure
        输出 shape = (n_samples, 32)，列顺序:
          [sen0_value, sen1_value, ..., sen7_value,
           sen0_temp,  sen1_temp,  ..., sen7_temp,
           sen0_hum,   sen1_hum,   ..., sen7_hum,
           sen0_pres,  sen1_pres,  ..., sen7_pres]
        
        Args:
            sample_id: 样本 ID
            n_samples: 输出帧数
            method: 插值方法 ('linear' 或 'pchip')
            phase_names: 可选的 phase 名称列表，仅使用这些 phase 时间段内的数据
        
        Returns:
            (frames_array, meta): 帧数据 (n_samples, 32) 和元数据
        """
        # 根据是否指定 phase_names 选择数据获取方式
        if phase_names:
            # 通过 phase transition 时间范围 + run_id 获取数据
            # 能获取到 sample_id 为 NULL 的阶段数据（如 WASH、DRAIN）
            raw_df = self.get_raw_sensor_data_by_phases(sample_id, phase_names)
        else:
            raw_df = self.get_raw_sensor_data_by_sample(sample_id)

        if raw_df.empty:
            logger.warning(f"No data for sample_id={sample_id}")
            return np.array([]), {}

        # 定义统一采样网格
        grid = np.linspace(0, 1, n_samples)

        # 每个通道的重采样结果: channel_name -> sensor_idx -> array
        channels = ["value", "temperature", "humidity", "pressure"]
        resampled: dict[str, dict[int, np.ndarray]] = {ch: {} for ch in channels}
        original_point_counts: list[int] = []

        # 对每个传感器进行插值
        for sensor_idx in range(8):
            sensor_data = raw_df[raw_df["sensor_idx"] == sensor_idx].copy()
            original_point_counts.append(len(sensor_data))

            if len(sensor_data) < 2:
                for ch in channels:
                    resampled[ch][sensor_idx] = np.full(n_samples, np.nan)
                continue

            # 排序并去重
            sensor_data = sensor_data.sort_values("time_ms").drop_duplicates("time_ms")

            # 计算归一化时间
            t_min = sensor_data["time_ms"].min()
            t_max = sensor_data["time_ms"].max()
            duration = t_max - t_min

            if duration == 0:
                for ch in channels:
                    col = ch if ch in sensor_data.columns else "value"
                    resampled[ch][sensor_idx] = np.full(
                        n_samples, sensor_data[col].iloc[0] if col in sensor_data.columns else np.nan
                    )
                continue

            normalized_t = (sensor_data["time_ms"] - t_min) / duration

            # 对每个通道分别插值
            for ch in channels:
                if ch not in sensor_data.columns:
                    resampled[ch][sensor_idx] = np.full(n_samples, np.nan)
                    continue
                values = sensor_data[ch].values
                resampled[ch][sensor_idx] = self._interpolate_channel(
                    normalized_t.values, values, grid, method, n_samples
                )

        # 组装为 numpy 数组 (n_samples, 32)
        # 列顺序: [8×value, 8×temperature, 8×humidity, 8×pressure]
        all_columns = []
        for ch in channels:
            for i in range(8):
                all_columns.append(
                    resampled[ch].get(i, np.full(n_samples, np.nan))
                )
        frames_array = np.column_stack(all_columns)

        # 计算时间范围
        all_times = raw_df["time_ms"]
        time_range_ms = int(all_times.max() - all_times.min()) if len(all_times) > 0 else 0

        meta = {
            "sample_id": sample_id,
            "method": method,
            "n_samples": n_samples,
            "n_channels": 32,
            "original_point_counts": original_point_counts,
            "time_range_ms": time_range_ms,
            "phase_names": phase_names,
        }

        return frames_array, meta

    # ============================================================
    # 基于 sample_id 的接口 (唯一接口)
    # ============================================================

    # [已移除] save_normalized_frames_by_sample - DB 持久化已废弃
    # [已移除] create_normalized_frames (旧 run_id 接口)
    # [已移除] save_normalized_frames / get_normalized_frames / get_normalized_frames_status
    # [已移除] get_available_phases / generate_all_phases
    # 上述方法的功能已被 get_normalized_frames_by_sample (Redis-only) 替代

    @staticmethod
    def _phase_names_suffix(phase_names: list[str] | None) -> str:
        """生成 phase_names 的缓存 key 后缀"""
        if not phase_names:
            return ""
        return ":" + ",".join(sorted(phase_names))

    def get_normalized_frames_by_sample(
        self,
        sample_id: int,
        method: InterpolationMethod = "linear",
        n_samples: int = 100,
        use_cache: bool = True,
        phase_names: list[str] | None = None,
    ) -> tuple[np.ndarray | None, bool]:
        """获取或生成归一化帧（唯一入口）

        缓存: 仅 Redis（不再使用 PostgreSQL normalized_frames 表）
        使用 per-key 锁防止并发 thundering herd

        输出 (n_samples, 32)：每传感器 4 通道 (value, temp, humidity, pressure)

        Args:
            sample_id: 样本 ID
            method: 插值方法
            n_samples: 采样点数
            use_cache: 是否使用缓存（True=优先从缓存读取，False=强制重新生成）
            phase_names: 可选的阶段名称列表，仅使用这些阶段的数据生成帧

        Returns:
            (numpy array (n_samples, 32) 或 None, from_cache: bool)
        """
        n_channels = 32  # 8 sensors × 4 channels
        redis_cache = get_frame_cache()
        phase_suffix = self._phase_names_suffix(phase_names)
        cache_key = f"{sample_id}:{method}:{n_samples}{phase_suffix}"

        # ── 快速路径: 无锁读 Redis 缓存 ──
        if use_cache and redis_cache:
            if phase_names:
                cached = redis_cache.get_by_key(cache_key, n_samples, n_channels)
            else:
                cached = redis_cache.get(sample_id, method, n_samples)
                # 检查 shape 是否匹配（旧缓存可能是 8 通道）
                if cached is not None and cached.shape != (n_samples, n_channels):
                    logger.info(f"缓存 STALE ({cached.shape}): sample={sample_id}, 需重新生成")
                    redis_cache.delete(sample_id, method, n_samples)
                    cached = None
            if cached is not None:
                logger.info(f"缓存 HIT (redis): sample={sample_id}, {method}/{n_samples}")
                return cached, True

        # ── 慢路径: 加锁生成, 防止并发重复计算 ──
        lock = _get_inflight_lock(cache_key)
        acquired = lock.acquire(timeout=120)  # 最多等 2 分钟
        if not acquired:
            logger.warning(f"缓存锁超时: sample={sample_id}, {method}/{n_samples}")
            return None, False

        try:
            # double-check: 可能其他线程已经生成完毕
            if use_cache and redis_cache:
                if phase_names:
                    cached = redis_cache.get_by_key(cache_key, n_samples, n_channels)
                else:
                    cached = redis_cache.get(sample_id, method, n_samples)
                    if cached is not None and cached.shape != (n_samples, n_channels):
                        redis_cache.delete(sample_id, method, n_samples)
                        cached = None
                if cached is not None:
                    logger.info(f"缓存 HIT (redis, after lock): sample={sample_id}, {method}/{n_samples}")
                    return cached, True

            # 生成帧
            logger.info(
                f"缓存 MISS → 生成: sample={sample_id}, {method}/{n_samples}"
                + (f", phases={phase_names}" if phase_names else "")
            )
            frames_array, meta = self.create_normalized_frames_by_sample(
                sample_id=sample_id,
                n_samples=n_samples,
                method=method,
                phase_names=phase_names,
            )
            if frames_array is None or frames_array.size == 0:
                return None, False

            # 写入 Redis 缓存
            if redis_cache:
                if phase_names:
                    redis_cache.set_by_key(cache_key, frames_array, n_samples)
                else:
                    redis_cache.set(sample_id, method, n_samples, frames_array)
                logger.info(f"缓存 SET (redis): sample={sample_id}, {method}/{n_samples}")

            return frames_array, False
        finally:
            lock.release()

    def get_normalized_frames_status_by_sample(
        self,
        sample_id: int,
    ) -> dict:
        """检查归一化帧的缓存状态

        注意：不再查 DB，仅检查 Redis 缓存和原始数据质量
        """
        redis_cache = get_frame_cache()

        # Redis 缓存状态
        variants: list[dict] = []
        if redis_cache:
            status = redis_cache.get_status(sample_id)
            for v in status.get("variants", []):
                variants.append({
                    "method": v.get("method", ""),
                    "n_samples": v.get("nSamples", 0),
                    "original_point_counts": [],
                    "time_range_ms": 0,
                })

        return {
            "exists": len(variants) > 0,
            "cached": len(variants) > 0,
            "variants": variants,
        }
