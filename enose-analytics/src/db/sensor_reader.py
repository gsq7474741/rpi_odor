"""传感器数据读取模块"""

from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from .connection import get_cursor
from ..logger import logger



class SensorReader:
    """传感器数据读取器"""

    def get_frames(
        self,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        experiment_id: str | None = None,
        phase: str | None = None,
        limit: int = 10000,
    ) -> pd.DataFrame:
        """获取传感器帧数据"""
        query = """
            SELECT 
                ts, seq, experiment_id, phase_name,
                mox_readings, temp_c, rh, pressure
            FROM sensor_frames
            WHERE 1=1
        """
        params: list[Any] = []

        if start_time:
            query += " AND ts >= %s"
            params.append(start_time)
        if end_time:
            query += " AND ts <= %s"
            params.append(end_time)
        if experiment_id:
            query += " AND experiment_id = %s"
            params.append(experiment_id)
        if phase:
            query += " AND phase_name = %s"
            params.append(phase)

        query += " ORDER BY ts DESC LIMIT %s"
        params.append(limit)

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows)
        return df

    def get_labeled_data(
        self,
        label_ids: list[str],
        limit: int | None = None,
    ) -> pd.DataFrame:
        """获取已标注的传感器数据"""
        query = """
            SELECT * FROM get_training_dataset(%s::uuid[])
        """
        params = [label_ids]

        if limit:
            query = f"SELECT * FROM ({query}) t LIMIT %s"
            params.append(limit)

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def get_recent_frames(
        self,
        window_size: int = 60,
        experiment_id: str | None = None,
    ) -> pd.DataFrame:
        """获取最近的传感器帧 (用于实时质检)"""
        query = """
            SELECT 
                ts, seq, experiment_id, phase_name,
                mox_readings, temp_c, rh, pressure
            FROM sensor_frames
            WHERE ts >= NOW() - INTERVAL '%s seconds'
        """
        params: list[Any] = [window_size]

        if experiment_id:
            query += " AND experiment_id = %s"
            params.append(experiment_id)

        query += " ORDER BY ts"

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def get_frame_stats(
        self,
        start_time: datetime,
        end_time: datetime,
        experiment_id: str | None = None,
    ) -> dict[str, Any]:
        """获取时间范围内的统计信息"""
        query = """
            SELECT 
                COUNT(*) as frame_count,
                MIN(ts) as first_ts,
                MAX(ts) as last_ts,
                AVG(temp_c) as avg_temp,
                AVG(rh) as avg_rh
            FROM sensor_frames
            WHERE ts BETWEEN %s AND %s
        """
        params: list[Any] = [start_time, end_time]

        if experiment_id:
            query += " AND experiment_id = %s"
            params.append(experiment_id)

        with get_cursor() as cur:
            cur.execute(query, params)
            row = cur.fetchone()

        return dict(row) if row else {}
