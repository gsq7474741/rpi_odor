"""实验数据查询仓库"""

from datetime import datetime
from typing import Any

import numpy as np

from .connection import get_cursor
from ..logger import logger



class DataRepository:
    """实验数据查询仓库"""

    def list_experiments(
        self,
        limit: int = 50,
        offset: int = 0,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        label_id: str | None = None,
    ) -> tuple[list[dict], int]:
        """列出实验"""
        # 构建查询
        query = """
            WITH exp_data AS (
                SELECT DISTINCT
                    run_id as experiment_id,
                    MIN(time_ms) as start_time_ms,
                    MAX(time_ms) as end_time_ms,
                    COUNT(*) as frame_count,
                    ARRAY_AGG(DISTINCT phase_name) FILTER (WHERE phase_name IS NOT NULL) as phases
                FROM sensor_readings_v2
                WHERE run_id IS NOT NULL
                GROUP BY run_id
            ),
            exp_samples AS (
                SELECT run_id, COUNT(*) as sample_count
                FROM samples
                GROUP BY run_id
            ),
            exp_labels AS (
                SELECT DISTINCT
                    lr.experiment_id,
                    ARRAY_AGG(DISTINCT sl.name) as labels
                FROM labeled_ranges lr
                JOIN sample_labels sl ON lr.label_id = sl.id
                GROUP BY lr.experiment_id
            )
            SELECT 
                ed.experiment_id::text,
                ed.start_time_ms,
                ed.end_time_ms,
                ed.frame_count,
                COALESCE(es.sample_count, 0) as sample_count,
                ed.phases,
                COALESCE(el.labels, ARRAY[]::text[]) as labels
            FROM exp_data ed
            LEFT JOIN exp_samples es ON ed.experiment_id = es.run_id
            LEFT JOIN exp_labels el ON ed.experiment_id::text = el.experiment_id
            WHERE 1=1
        """
        params: list[Any] = []

        if start_time:
            query += " AND ed.start_time_ms >= %s"
            params.append(int(start_time.timestamp() * 1000))
        if end_time:
            query += " AND ed.end_time_ms <= %s"
            params.append(int(end_time.timestamp() * 1000))
        if label_id:
            query += " AND el.experiment_id IS NOT NULL"

        # 获取总数
        count_query = f"SELECT COUNT(*) as cnt FROM ({query}) t"
        
        # 添加分页
        query += " ORDER BY ed.start_time_ms DESC LIMIT %s OFFSET %s"
        params.append(limit)
        params.append(offset)

        with get_cursor() as cur:
            # 获取总数
            cur.execute(count_query, params[:-2] if params else [])
            total = cur.fetchone()["cnt"]

            # 获取数据
            cur.execute(query, params)
            rows = cur.fetchall()

        experiments = []
        for row in rows:
            experiments.append({
                "experiment_id": str(row["experiment_id"]),
                "start_time_ms": row["start_time_ms"],
                "end_time_ms": row["end_time_ms"],
                "frame_count": row["frame_count"],
                "sample_count": row["sample_count"],
                "phases": row["phases"] or [],
                "labels": row["labels"] or [],
                "status": "completed",
            })

        return experiments, total

    def query_sensor_data(
        self,
        experiment_id: str | None = None,
        label_id: str | None = None,
        phase: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        limit: int = 1000,
        offset: int = 0,
        downsample_factor: int = 1,
    ) -> tuple[list[dict], int]:
        """查询传感器数据"""
        # 基础查询
        base_query = """
            SELECT 
                sr.time_ms,
                sr.sensor_idx,
                sr.value,
                sr.temperature,
                sr.humidity,
                sr.heater_step,
                sr.run_id,
                sr.phase_name,
                sl.name as label_name
            FROM sensor_readings_v2 sr
            LEFT JOIN labeled_ranges lr ON 
                sr.time_ms BETWEEN EXTRACT(EPOCH FROM lr.start_time) * 1000 
                               AND EXTRACT(EPOCH FROM lr.end_time) * 1000
            LEFT JOIN sample_labels sl ON lr.label_id = sl.id
            WHERE 1=1
        """
        params: list[Any] = []

        if experiment_id:
            base_query += " AND sr.run_id = %s"
            # 支持纯数字或 test_exp_ 前缀格式
            try:
                run_id = int(experiment_id.replace("test_exp_", ""))
            except ValueError:
                run_id = int(experiment_id)
            params.append(run_id)
        if label_id:
            base_query += " AND lr.label_id = %s"
            params.append(label_id)
        if phase:
            base_query += " AND sr.phase_name = %s"
            params.append(phase)
        if start_time:
            base_query += " AND sr.time_ms >= %s"
            params.append(int(start_time.timestamp() * 1000))
        if end_time:
            base_query += " AND sr.time_ms <= %s"
            params.append(int(end_time.timestamp() * 1000))

        # 获取总数
        count_query = f"SELECT COUNT(DISTINCT time_ms) as cnt FROM ({base_query}) t"

        # 添加降采样
        if downsample_factor > 1:
            base_query = f"""
                WITH numbered AS (
                    SELECT *, ROW_NUMBER() OVER (ORDER BY time_ms) as rn
                    FROM ({base_query}) t
                )
                SELECT * FROM numbered WHERE rn % {downsample_factor} = 0
            """

        # 添加排序和分页
        query = f"{base_query} ORDER BY time_ms LIMIT %s OFFSET %s"
        params.append(limit * 8)  # 8 个传感器
        params.append(offset * 8)

        with get_cursor() as cur:
            # 获取总数
            cur.execute(count_query, params[:-2])
            total = cur.fetchone()["cnt"]

            # 获取数据
            cur.execute(query, params)
            rows = cur.fetchall()

        # 按时间聚合传感器数据
        data_by_time: dict[int, dict] = {}
        for row in rows:
            time_ms = row["time_ms"]
            sensor_idx = row["sensor_idx"]
            
            if time_ms not in data_by_time:
                data_by_time[time_ms] = {
                    "ts_ms": time_ms,
                    "experiment_id": str(row["run_id"]) if row["run_id"] else None,
                    "phase": row["phase_name"],
                    "mox_readings": [0.0] * 8,
                    "temperature": row["temperature"],
                    "humidity": row["humidity"],
                    "heater_step": row["heater_step"],
                    "label": row["label_name"],
                }
            
            if 0 <= sensor_idx < 8:
                data_by_time[time_ms]["mox_readings"][sensor_idx] = float(row["value"])

        result = list(data_by_time.values())
        result.sort(key=lambda x: x["ts_ms"])

        return result, total

    def get_aggregated_stats(
        self,
        dimension: str,
        experiment_id: str | None = None,
        label_id: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        time_bucket: str = "1h",
        sensor_indices: list[int] | None = None,
    ) -> list[dict]:
        """获取聚合统计"""
        # 确定分组列
        group_by_map = {
            "experiment": "run_id",
            "label": "sl.name",
            "phase": "phase_name",
            "heater_step": "heater_step",
            "sensor": "sensor_idx",
        }

        group_col = group_by_map.get(dimension, "run_id")

        # 构建查询
        query = f"""
            SELECT 
                {group_col}::text as group_key,
                COUNT(*) as sample_count,
                sensor_idx,
                MIN(value) as min_val,
                MAX(value) as max_val,
                AVG(value) as mean_val,
                STDDEV(value) as std_val,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) as median_val,
                AVG(temperature) as avg_temp,
                AVG(humidity) as avg_humidity,
                MIN(time_ms) as start_time_ms,
                MAX(time_ms) as end_time_ms
            FROM sensor_readings_v2 sr
            LEFT JOIN labeled_ranges lr ON 
                sr.time_ms BETWEEN EXTRACT(EPOCH FROM lr.start_time) * 1000 
                               AND EXTRACT(EPOCH FROM lr.end_time) * 1000
            LEFT JOIN sample_labels sl ON lr.label_id = sl.id
            WHERE 1=1
        """
        params: list[Any] = []

        if experiment_id:
            query += " AND sr.run_id = %s"
            try:
                run_id = int(experiment_id.replace("test_exp_", ""))
            except ValueError:
                run_id = int(experiment_id)
            params.append(run_id)
        if label_id:
            query += " AND lr.label_id = %s"
            params.append(label_id)
        if start_time:
            query += " AND sr.time_ms >= %s"
            params.append(int(start_time.timestamp() * 1000))
        if end_time:
            query += " AND sr.time_ms <= %s"
            params.append(int(end_time.timestamp() * 1000))
        if sensor_indices:
            query += f" AND sr.sensor_idx = ANY(%s)"
            params.append(sensor_indices)

        query += f" GROUP BY {group_col}, sensor_idx ORDER BY group_key, sensor_idx"

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        # 按分组键聚合
        groups: dict[str, dict] = {}
        for row in rows:
            key = str(row["group_key"]) if row["group_key"] else "unknown"
            sensor_idx = row["sensor_idx"]

            if key not in groups:
                groups[key] = {
                    "key": key,
                    "label": key,
                    "sample_count": 0,
                    "sensor_stats": [],
                    "avg_temperature": 0,
                    "avg_humidity": 0,
                    "start_time_ms": None,
                    "end_time_ms": None,
                }

            groups[key]["sample_count"] += row["sample_count"]
            groups[key]["sensor_stats"].append({
                "sensor_idx": sensor_idx,
                "min": float(row["min_val"]) if row["min_val"] else 0,
                "max": float(row["max_val"]) if row["max_val"] else 0,
                "mean": float(row["mean_val"]) if row["mean_val"] else 0,
                "std": float(row["std_val"]) if row["std_val"] else 0,
                "median": float(row["median_val"]) if row["median_val"] else 0,
            })
            groups[key]["avg_temperature"] = float(row["avg_temp"]) if row["avg_temp"] else 0
            groups[key]["avg_humidity"] = float(row["avg_humidity"]) if row["avg_humidity"] else 0
            
            start_ms = row["start_time_ms"]
            end_ms = row["end_time_ms"]
            if groups[key]["start_time_ms"] is None or start_ms < groups[key]["start_time_ms"]:
                groups[key]["start_time_ms"] = start_ms
            if groups[key]["end_time_ms"] is None or end_ms > groups[key]["end_time_ms"]:
                groups[key]["end_time_ms"] = end_ms

        return list(groups.values())

    def get_experiment_detail(self, experiment_id: str) -> dict | None:
        """获取实验详情"""
        try:
            run_id = int(experiment_id.replace("test_exp_", ""))
        except ValueError:
            run_id = int(experiment_id)

        # 基础信息
        query = """
            SELECT 
                run_id,
                MIN(time_ms) as start_time_ms,
                MAX(time_ms) as end_time_ms,
                COUNT(*) / 8 as frame_count,
                ARRAY_AGG(DISTINCT phase_name) FILTER (WHERE phase_name IS NOT NULL) as phases
            FROM sensor_readings_v2
            WHERE run_id = %s
            GROUP BY run_id
        """

        with get_cursor() as cur:
            cur.execute(query, [run_id])
            row = cur.fetchone()

        if not row:
            return None

        result = {
            "experiment_id": str(row["run_id"]),
            "start_time_ms": row["start_time_ms"],
            "end_time_ms": row["end_time_ms"],
            "frame_count": row["frame_count"],
            "status": "completed",
            "phases": [],
            "labels": [],
            "sensor_summary": [],
            "avg_temperature": 0,
            "avg_humidity": 0,
            "total_alerts": 0,
            "critical_alerts": 0,
            "warning_alerts": 0,
        }

        # 阶段信息
        phase_query = """
            SELECT 
                phase_name,
                MIN(time_ms) as start_time_ms,
                MAX(time_ms) as end_time_ms,
                COUNT(*) / 8 as frame_count
            FROM sensor_readings_v2
            WHERE run_id = %s AND phase_name IS NOT NULL
            GROUP BY phase_name
            ORDER BY start_time_ms
        """

        with get_cursor() as cur:
            cur.execute(phase_query, [run_id])
            phases = cur.fetchall()

        result["phases"] = [
            {
                "name": p["phase_name"],
                "start_time_ms": p["start_time_ms"],
                "end_time_ms": p["end_time_ms"],
                "frame_count": p["frame_count"],
            }
            for p in phases
        ]

        # 传感器统计
        stats_query = """
            SELECT 
                sensor_idx,
                MIN(value) as min_val,
                MAX(value) as max_val,
                AVG(value) as mean_val,
                STDDEV(value) as std_val,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) as median_val,
                AVG(temperature) as avg_temp,
                AVG(humidity) as avg_humidity
            FROM sensor_readings_v2
            WHERE run_id = %s
            GROUP BY sensor_idx
            ORDER BY sensor_idx
        """

        with get_cursor() as cur:
            cur.execute(stats_query, [run_id])
            stats = cur.fetchall()

        for s in stats:
            result["sensor_summary"].append({
                "sensor_idx": s["sensor_idx"],
                "min": float(s["min_val"]) if s["min_val"] else 0,
                "max": float(s["max_val"]) if s["max_val"] else 0,
                "mean": float(s["mean_val"]) if s["mean_val"] else 0,
                "std": float(s["std_val"]) if s["std_val"] else 0,
                "median": float(s["median_val"]) if s["median_val"] else 0,
            })
            result["avg_temperature"] = float(s["avg_temp"]) if s["avg_temp"] else 0
            result["avg_humidity"] = float(s["avg_humidity"]) if s["avg_humidity"] else 0

        return result
