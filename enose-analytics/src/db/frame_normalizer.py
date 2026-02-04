"""归一化帧生成模块 - 将异步传感器数据重采样为固定长度帧"""

import logging
from typing import Literal

import numpy as np
import pandas as pd
from scipy import interpolate

from .connection import get_cursor

logger = logging.getLogger(__name__)

InterpolationMethod = Literal["linear", "pchip"]


class FrameNormalizer:
    """归一化帧生成器"""

    def get_raw_sensor_data(
        self,
        run_id: int,
        phase_name: str,
    ) -> pd.DataFrame:
        """获取指定实验和阶段的原始传感器数据"""
        query = """
            SELECT 
                time_ms,
                sensor_idx,
                value,
                temperature,
                humidity,
                pressure
            FROM sensor_readings_v2
            WHERE run_id = %s AND phase_name = %s
            ORDER BY sensor_idx, time_ms
        """
        with get_cursor() as cur:
            cur.execute(query, [run_id, phase_name])
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def create_normalized_frames(
        self,
        run_id: int,
        phase_name: str,
        n_samples: int = 100,
        method: InterpolationMethod = "linear",
    ) -> tuple[pd.DataFrame, dict]:
        """
        将异步传感器数据归一化为固定长度帧
        
        Args:
            run_id: 实验 ID
            phase_name: 阶段名称
            n_samples: 输出帧数
            method: 插值方法 ('linear' 或 'pchip')
        
        Returns:
            (frames_df, meta): 帧数据和元数据
        """
        raw_df = self.get_raw_sensor_data(run_id, phase_name)

        if raw_df.empty:
            logger.warning(f"No data for run_id={run_id}, phase={phase_name}")
            return pd.DataFrame(), {}

        # 定义统一采样网格
        grid = np.linspace(0, 1, n_samples)

        # 存储每个传感器的重采样结果
        resampled_values: dict[int, np.ndarray] = {}
        original_point_counts: list[int] = []

        # 环境数据 (温度、湿度、气压) - 取所有传感器的平均
        env_data = raw_df.groupby("time_ms").agg({
            "temperature": "mean",
            "humidity": "mean", 
            "pressure": "mean",
        }).reset_index()

        # 对每个传感器进行插值
        for sensor_idx in range(8):
            sensor_data = raw_df[raw_df["sensor_idx"] == sensor_idx].copy()
            original_point_counts.append(len(sensor_data))

            if len(sensor_data) < 2:
                resampled_values[sensor_idx] = np.full(n_samples, np.nan)
                continue

            # 排序并去重
            sensor_data = sensor_data.sort_values("time_ms").drop_duplicates("time_ms")

            # 计算归一化时间
            t_min = sensor_data["time_ms"].min()
            t_max = sensor_data["time_ms"].max()
            duration = t_max - t_min

            if duration == 0:
                resampled_values[sensor_idx] = np.full(
                    n_samples, sensor_data["value"].iloc[0]
                )
                continue

            normalized_t = (sensor_data["time_ms"] - t_min) / duration
            values = sensor_data["value"].values

            # 插值
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

                resampled_values[sensor_idx] = f(grid)
            except Exception as e:
                logger.warning(f"Interpolation failed for sensor {sensor_idx}: {e}")
                resampled_values[sensor_idx] = np.full(n_samples, np.nan)

        # 对环境数据也进行插值
        resampled_env: dict[str, np.ndarray] = {}
        if len(env_data) >= 2:
            env_t_min = env_data["time_ms"].min()
            env_t_max = env_data["time_ms"].max()
            env_duration = env_t_max - env_t_min

            if env_duration > 0:
                env_normalized_t = (env_data["time_ms"] - env_t_min) / env_duration

                for col in ["temperature", "humidity", "pressure"]:
                    try:
                        if method == "linear":
                            f = interpolate.interp1d(
                                env_normalized_t,
                                env_data[col].values,
                                kind="linear",
                                fill_value="extrapolate",
                            )
                        else:
                            f = interpolate.PchipInterpolator(
                                env_normalized_t, env_data[col].values, extrapolate=True
                            )
                        resampled_env[col] = f(grid)
                    except Exception:
                        resampled_env[col] = np.full(n_samples, np.nan)

        # 组装帧数据
        frames = []
        for i, t in enumerate(grid):
            mox_readings = [
                float(resampled_values.get(j, np.full(n_samples, np.nan))[i])
                for j in range(8)
            ]
            frames.append({
                "run_id": run_id,
                "phase_name": phase_name,
                "method": method,
                "n_samples": n_samples,
                "frame_idx": i,
                "normalized_t": float(t),
                "mox_readings": mox_readings,
                "temp_c": float(resampled_env.get("temperature", [np.nan] * n_samples)[i]),
                "rh": float(resampled_env.get("humidity", [np.nan] * n_samples)[i]),
                "pressure": float(resampled_env.get("pressure", [np.nan] * n_samples)[i]),
            })

        frames_df = pd.DataFrame(frames)

        # 计算时间范围
        all_times = raw_df["time_ms"]
        time_range_ms = int(all_times.max() - all_times.min()) if len(all_times) > 0 else 0

        meta = {
            "run_id": run_id,
            "phase_name": phase_name,
            "method": method,
            "n_samples": n_samples,
            "original_point_counts": original_point_counts,
            "time_range_ms": time_range_ms,
        }

        return frames_df, meta

    def save_normalized_frames(
        self,
        run_id: int,
        phase_name: str,
        n_samples: int = 100,
        methods: list[InterpolationMethod] | None = None,
    ) -> dict[str, int]:
        """
        生成并保存归一化帧到数据库
        
        Args:
            run_id: 实验 ID
            phase_name: 阶段名称
            n_samples: 采样点数
            methods: 插值方法列表，默认 ['linear', 'pchip']
        
        Returns:
            每种方法保存的帧数
        """
        if methods is None:
            methods = ["linear", "pchip"]

        results = {}

        for method in methods:
            frames_df, meta = self.create_normalized_frames(
                run_id, phase_name, n_samples, method
            )

            if frames_df.empty:
                results[method] = 0
                continue

            # 删除旧数据
            delete_query = """
                DELETE FROM normalized_frames
                WHERE run_id = %s AND phase_name = %s 
                  AND method = %s AND n_samples = %s
            """
            delete_meta_query = """
                DELETE FROM normalized_frames_meta
                WHERE run_id = %s AND phase_name = %s 
                  AND method = %s AND n_samples = %s
            """

            # 插入新数据
            insert_query = """
                INSERT INTO normalized_frames 
                    (run_id, phase_name, method, n_samples, frame_idx, 
                     normalized_t, mox_readings, temp_c, rh, pressure)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """

            insert_meta_query = """
                INSERT INTO normalized_frames_meta
                    (run_id, phase_name, method, n_samples, 
                     original_point_counts, time_range_ms)
                VALUES (%s, %s, %s, %s, %s, %s)
            """

            with get_cursor() as cur:
                # 清理旧数据
                cur.execute(delete_query, [run_id, phase_name, method, n_samples])
                cur.execute(delete_meta_query, [run_id, phase_name, method, n_samples])

                # 批量插入帧数据
                batch_data = [
                    (
                        row["run_id"],
                        row["phase_name"],
                        row["method"],
                        row["n_samples"],
                        row["frame_idx"],
                        row["normalized_t"],
                        row["mox_readings"],
                        row["temp_c"],
                        row["rh"],
                        row["pressure"],
                    )
                    for _, row in frames_df.iterrows()
                ]
                cur.executemany(insert_query, batch_data)

                # 插入元数据
                cur.execute(
                    insert_meta_query,
                    [
                        meta["run_id"],
                        meta["phase_name"],
                        meta["method"],
                        meta["n_samples"],
                        meta["original_point_counts"],
                        meta["time_range_ms"],
                    ],
                )

            results[method] = len(frames_df)
            logger.info(
                f"Saved {len(frames_df)} normalized frames: "
                f"run_id={run_id}, phase={phase_name}, method={method}"
            )

        return results

    def get_normalized_frames(
        self,
        run_id: int,
        phase_name: str | None = None,
        method: InterpolationMethod = "linear",
        n_samples: int = 100,
    ) -> pd.DataFrame:
        """从数据库获取归一化帧"""
        query = """
            SELECT 
                run_id, phase_name, method, n_samples, frame_idx,
                normalized_t, mox_readings, temp_c, rh, pressure
            FROM normalized_frames
            WHERE run_id = %s AND method = %s AND n_samples = %s
        """
        params: list = [run_id, method, n_samples]

        if phase_name:
            query += " AND phase_name = %s"
            params.append(phase_name)

        query += " ORDER BY phase_name, frame_idx"

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def get_normalized_frames_status(
        self,
        run_id: int,
        phase_name: str | None = None,
    ) -> dict:
        """检查归一化帧的状态"""
        query = """
            SELECT 
                m.phase_name,
                m.method::text,
                m.n_samples,
                m.original_point_counts,
                m.time_range_ms,
                COUNT(f.id) as frame_count
            FROM normalized_frames_meta m
            LEFT JOIN normalized_frames f 
                ON m.run_id = f.run_id 
                AND m.phase_name = f.phase_name 
                AND m.method = f.method::interpolation_method 
                AND m.n_samples = f.n_samples
            WHERE m.run_id = %s
        """
        params: list = [run_id]

        if phase_name:
            query += " AND m.phase_name = %s"
            params.append(phase_name)

        query += """
            GROUP BY m.phase_name, m.method, m.n_samples, 
                     m.original_point_counts, m.time_range_ms
            ORDER BY m.phase_name, m.method
        """

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return {"exists": False, "meta": [], "total_frames": 0}

        meta = []
        total_frames = 0
        for row in rows:
            meta.append({
                "phase_name": row["phase_name"],
                "method": row["method"],
                "n_samples": row["n_samples"],
                "original_point_counts": row["original_point_counts"] or [],
                "time_range_ms": row["time_range_ms"] or 0,
            })
            total_frames += row["frame_count"]

        return {"exists": True, "meta": meta, "total_frames": total_frames}

    def get_available_phases(self, run_id: int) -> list[str]:
        """获取实验的所有阶段名称"""
        query = """
            SELECT DISTINCT phase_name 
            FROM sensor_readings_v2 
            WHERE run_id = %s
            ORDER BY phase_name
        """
        with get_cursor() as cur:
            cur.execute(query, [run_id])
            rows = cur.fetchall()
        return [row["phase_name"] for row in rows]

    def generate_all_phases(
        self,
        run_id: int,
        phase_names: list[str] | None = None,
        n_samples: int = 100,
        methods: list[InterpolationMethod] | None = None,
    ) -> dict[str, int]:
        """为所有阶段生成归一化帧"""
        if methods is None:
            methods = ["linear", "pchip"]

        if phase_names is None or len(phase_names) == 0:
            phase_names = self.get_available_phases(run_id)

        results = {}
        for phase in phase_names:
            phase_results = self.save_normalized_frames(
                run_id, phase, n_samples, methods
            )
            for method, count in phase_results.items():
                key = f"{phase}_{method}"
                results[key] = count

        return results
