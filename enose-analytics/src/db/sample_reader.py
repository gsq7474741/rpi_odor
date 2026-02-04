"""样本数据读取模块"""

import json
import logging
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from .connection import get_cursor

logger = logging.getLogger(__name__)


class SampleReader:
    """样本数据读取器 - 支持跨 run 聚合分析"""

    def list_samples(
        self,
        run_id: int | None = None,
        phase_name: str | None = None,
        params_hash: str | None = None,
        liquid_ids: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """列出样本"""
        query = """
            SELECT 
                id, run_id, sample_idx, start_time_ms, end_time_ms,
                params_hash, liquid_ids, liquid_names, liquid_ratios, pump_indices,
                total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
                termination_type, termination_value, max_duration_s,
                heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                params_json, created_at
            FROM samples
            WHERE 1=1
        """
        params: list[Any] = []

        if run_id is not None:
            query += " AND run_id = %s"
            params.append(run_id)
        if phase_name:
            query += " AND phase_name = %s"
            params.append(phase_name)
        if params_hash:
            query += " AND params_hash = %s"
            params.append(params_hash)
        if liquid_ids:
            query += " AND liquid_ids && %s"
            params.append(liquid_ids)

        query += " ORDER BY run_id DESC, sample_idx LIMIT %s OFFSET %s"
        params.extend([limit, offset])

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        return [self._row_to_sample(row) for row in rows]

    def get_sample(self, sample_id: int) -> dict[str, Any] | None:
        """获取单个样本详情"""
        query = """
            SELECT 
                id, run_id, sample_idx, start_time_ms, end_time_ms,
                params_hash, liquid_ids, liquid_names, liquid_ratios, pump_indices,
                total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
                termination_type, termination_value, max_duration_s,
                heater_configs, pre_wash_count, pre_wash_volume_ml, wash_liquid_id,
                phase_name, avg_temperature_c, avg_humidity_pct, avg_pressure_hpa,
                params_json, created_at
            FROM samples
            WHERE id = %s
        """
        with get_cursor() as cur:
            cur.execute(query, [sample_id])
            row = cur.fetchone()

        return self._row_to_sample(row) if row else None

    def get_sample_groups(
        self,
        phase_name: str | None = None,
        liquid_ids: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """获取样本分组（跨 run 聚合）"""
        query = """
            SELECT 
                params_hash,
                liquid_ids,
                liquid_names,
                gas_pump_pwm,
                phase_name,
                COUNT(*) as sample_count,
                array_agg(DISTINCT run_id) as run_ids,
                MIN(created_at) as first_created,
                MAX(created_at) as last_created
            FROM samples
            WHERE 1=1
        """
        params: list[Any] = []

        if phase_name:
            query += " AND phase_name = %s"
            params.append(phase_name)
        if liquid_ids:
            query += " AND liquid_ids && %s"
            params.append(liquid_ids)

        query += """
            GROUP BY params_hash, liquid_ids, liquid_names, gas_pump_pwm, phase_name
            ORDER BY sample_count DESC
            LIMIT %s OFFSET %s
        """
        params.extend([limit, offset])

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        groups = []
        for row in rows:
            groups.append({
                "params_hash": row["params_hash"],
                "liquid_ids": row["liquid_ids"] or [],
                "liquid_names": row["liquid_names"] or [],
                "gas_pump_pwm": row["gas_pump_pwm"],
                "phase_name": row["phase_name"],
                "sample_count": row["sample_count"],
                "run_ids": row["run_ids"] or [],
                "first_created": row["first_created"],
                "last_created": row["last_created"],
            })
        return groups

    def get_sample_sensor_data(
        self,
        sample_id: int,
        sensor_indices: list[int] | None = None,
        downsample_factor: int = 1,
    ) -> pd.DataFrame:
        """获取样本的传感器数据"""
        # 首先获取样本的时间范围
        sample = self.get_sample(sample_id)
        if not sample:
            return pd.DataFrame()

        start_ms = sample["start_time_ms"]
        end_ms = sample.get("end_time_ms") or (start_ms + 3600000)  # 默认 1 小时

        query = """
            SELECT 
                time_ms, sensor_idx, value, temperature, humidity, pressure, heater_step
            FROM sensor_readings_v2
            WHERE sample_id = %s
        """
        params: list[Any] = [sample_id]

        if sensor_indices:
            query += " AND sensor_idx = ANY(%s)"
            params.append(sensor_indices)

        query += " ORDER BY time_ms, sensor_idx"

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            # 尝试通过时间范围查询（向后兼容）
            return self._get_sensor_data_by_time_range(
                start_ms, end_ms, sensor_indices, downsample_factor
            )

        df = pd.DataFrame(rows)

        # 降采样
        if downsample_factor > 1:
            df = df.iloc[::downsample_factor]

        return df

    def _get_sensor_data_by_time_range(
        self,
        start_ms: int,
        end_ms: int,
        sensor_indices: list[int] | None = None,
        downsample_factor: int = 1,
    ) -> pd.DataFrame:
        """通过时间范围获取传感器数据（向后兼容）"""
        query = """
            SELECT 
                time_ms, sensor_idx, value, temperature, humidity, pressure, heater_step
            FROM sensor_readings_v2
            WHERE time_ms >= %s AND time_ms <= %s
        """
        params: list[Any] = [start_ms, end_ms]

        if sensor_indices:
            query += " AND sensor_idx = ANY(%s)"
            params.append(sensor_indices)

        query += " ORDER BY time_ms, sensor_idx"

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows)

        if downsample_factor > 1:
            df = df.iloc[::downsample_factor]

        return df

    def get_aggregated_features(
        self,
        sample_ids: list[int] | None = None,
        params_hash: str | None = None,
    ) -> pd.DataFrame:
        """获取样本的聚合特征（用于 PCA/t-SNE/UMAP）"""
        if sample_ids:
            query = """
                SELECT 
                    s.id as sample_id,
                    s.params_hash,
                    s.phase_name,
                    s.liquid_names,
                    sr.sensor_idx,
                    AVG(sr.value) as mean_value,
                    STDDEV(sr.value) as std_value,
                    MIN(sr.value) as min_value,
                    MAX(sr.value) as max_value
                FROM samples s
                JOIN sensor_readings_v2 sr ON sr.sample_id = s.id
                WHERE s.id = ANY(%s)
                GROUP BY s.id, s.params_hash, s.phase_name, s.liquid_names, sr.sensor_idx
                ORDER BY s.id, sr.sensor_idx
            """
            params = [sample_ids]
        elif params_hash:
            query = """
                SELECT 
                    s.id as sample_id,
                    s.params_hash,
                    s.phase_name,
                    s.liquid_names,
                    sr.sensor_idx,
                    AVG(sr.value) as mean_value,
                    STDDEV(sr.value) as std_value,
                    MIN(sr.value) as min_value,
                    MAX(sr.value) as max_value
                FROM samples s
                JOIN sensor_readings_v2 sr ON sr.sample_id = s.id
                WHERE s.params_hash = %s
                GROUP BY s.id, s.params_hash, s.phase_name, s.liquid_names, sr.sensor_idx
                ORDER BY s.id, sr.sensor_idx
            """
            params = [params_hash]
        else:
            return pd.DataFrame()

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def count_samples(
        self,
        run_id: int | None = None,
        phase_name: str | None = None,
        params_hash: str | None = None,
    ) -> int:
        """统计样本数量"""
        query = "SELECT COUNT(*) FROM samples WHERE 1=1"
        params: list[Any] = []

        if run_id is not None:
            query += " AND run_id = %s"
            params.append(run_id)
        if phase_name:
            query += " AND phase_name = %s"
            params.append(phase_name)
        if params_hash:
            query += " AND params_hash = %s"
            params.append(params_hash)

        with get_cursor() as cur:
            cur.execute(query, params)
            row = cur.fetchone()

        return row["count"] if row else 0

    def _row_to_sample(self, row: dict[str, Any]) -> dict[str, Any]:
        """将数据库行转换为样本字典"""
        liquids = []
        if row.get("liquid_ids"):
            for i, lid in enumerate(row["liquid_ids"]):
                liquids.append({
                    "id": lid,
                    "name": row["liquid_names"][i] if row.get("liquid_names") else "",
                    "ratio": row["liquid_ratios"][i] if row.get("liquid_ratios") else 0,
                    "pump_index": row["pump_indices"][i] if row.get("pump_indices") else -1,
                })

        heater_configs = []
        if row.get("heater_configs"):
            try:
                configs = row["heater_configs"]
                if isinstance(configs, str):
                    configs = json.loads(configs)
                heater_configs = configs
            except (json.JSONDecodeError, TypeError):
                pass

        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "sample_idx": row["sample_idx"],
            "start_time_ms": row["start_time_ms"],
            "end_time_ms": row.get("end_time_ms"),
            "params_hash": row["params_hash"],
            "liquids": liquids,
            "total_volume_ml": row.get("total_volume_ml"),
            "flow_rate_ml_s": row.get("flow_rate_ml_s"),
            "gas_pump_pwm": row["gas_pump_pwm"],
            "termination_type": row.get("termination_type"),
            "termination_value": row.get("termination_value"),
            "max_duration_s": row.get("max_duration_s"),
            "heater_configs": heater_configs,
            "pre_wash_count": row.get("pre_wash_count", 0),
            "pre_wash_volume_ml": row.get("pre_wash_volume_ml"),
            "wash_liquid_id": row.get("wash_liquid_id"),
            "phase_name": row.get("phase_name"),
            "avg_temperature_c": row.get("avg_temperature_c"),
            "avg_humidity_pct": row.get("avg_humidity_pct"),
            "avg_pressure_hpa": row.get("avg_pressure_hpa"),
            "created_at": row.get("created_at"),
        }
