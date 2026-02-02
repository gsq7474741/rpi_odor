"""质检结果存储模块"""

import json
import logging
from datetime import datetime
from typing import Any

from .connection import get_connection, get_cursor

logger = logging.getLogger(__name__)


class QualityRepository:
    """质检结果存储库"""

    def save_result(
        self,
        ts: datetime,
        sensor_seq: int,
        alerts: list[dict[str, Any]],
        metrics: list[dict[str, Any]],
        prediction: dict[str, Any] | None = None,
        experiment_id: str | None = None,
    ) -> int:
        """保存质检结果"""
        query = """
            INSERT INTO quality_results 
                (ts, sensor_seq, experiment_id, alerts, metrics, prediction)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    (
                        ts,
                        sensor_seq,
                        experiment_id,
                        json.dumps(alerts),
                        json.dumps(metrics),
                        json.dumps(prediction) if prediction else None,
                    ),
                )
                result = cur.fetchone()
                conn.commit()
                return result["id"] if result else 0

    def get_results(
        self,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        experiment_id: str | None = None,
        has_alerts: bool | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """查询质检结果"""
        query = """
            SELECT id, ts, sensor_seq, experiment_id, alerts, metrics, prediction
            FROM quality_results
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
        if has_alerts is True:
            query += " AND jsonb_array_length(alerts) > 0"
        elif has_alerts is False:
            query += " AND jsonb_array_length(alerts) = 0"

        query += " ORDER BY ts DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        return [dict(row) for row in rows]

    def get_alert_count(
        self,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        experiment_id: str | None = None,
    ) -> dict[str, int]:
        """获取告警统计"""
        query = """
            SELECT 
                alert->>'flag' as flag,
                COUNT(*) as count
            FROM quality_results,
                 jsonb_array_elements(alerts) as alert
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

        query += " GROUP BY alert->>'flag'"

        with get_cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        return {row["flag"]: row["count"] for row in rows}

    def get_config(self) -> dict[str, Any]:
        """获取质检配置"""
        query = "SELECT config FROM quality_config WHERE id = 1"
        with get_cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
        return row["config"] if row else {}

    def update_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """更新质检配置"""
        query = """
            UPDATE quality_config 
            SET config = %s, updated_at = NOW()
            WHERE id = 1
            RETURNING config
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (json.dumps(config),))
                result = cur.fetchone()
                conn.commit()
                return result["config"] if result else config
