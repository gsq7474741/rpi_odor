"""样品标签存储模块"""

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from .connection import get_connection, get_cursor

logger = logging.getLogger(__name__)


class LabelRepository:
    """样品标签存储库"""

    def create(
        self,
        name: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        """创建标签"""
        query = """
            INSERT INTO sample_labels (name, description)
            VALUES (%s, %s)
            RETURNING *
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (name, description))
                result = cur.fetchone()
                conn.commit()
                return dict(result) if result else {}

    def get_by_id(self, label_id: str | UUID) -> dict[str, Any] | None:
        """根据 ID 获取标签"""
        query = "SELECT * FROM sample_labels WHERE id = %s"
        with get_cursor() as cur:
            cur.execute(query, (str(label_id),))
            row = cur.fetchone()
        return dict(row) if row else None

    def list_labels(
        self,
        experiment_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        """列出标签"""
        if experiment_id:
            count_query = """
                SELECT COUNT(DISTINCT sl.id) as total
                FROM sample_labels sl
                JOIN labeled_ranges lr ON sl.id = lr.label_id
                WHERE lr.experiment_id = %s
            """
            query = """
                SELECT DISTINCT sl.*
                FROM sample_labels sl
                JOIN labeled_ranges lr ON sl.id = lr.label_id
                WHERE lr.experiment_id = %s
                ORDER BY sl.created_at DESC
                LIMIT %s OFFSET %s
            """
            params = [experiment_id]
        else:
            count_query = "SELECT COUNT(*) as total FROM sample_labels"
            query = """
                SELECT * FROM sample_labels
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """
            params = []

        with get_cursor() as cur:
            if experiment_id:
                cur.execute(count_query, params)
            else:
                cur.execute(count_query)
            total = cur.fetchone()["total"]

            cur.execute(query, params + [limit, offset])
            rows = cur.fetchall()

        return [dict(row) for row in rows], total

    def update(
        self,
        label_id: str | UUID,
        name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any] | None:
        """更新标签"""
        updates = {}
        if name is not None:
            updates["name"] = name
        if description is not None:
            updates["description"] = description

        if not updates:
            return self.get_by_id(label_id)

        set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
        query = f"""
            UPDATE sample_labels 
            SET {set_clause}, updated_at = NOW()
            WHERE id = %s
            RETURNING *
        """

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (*updates.values(), str(label_id)))
                result = cur.fetchone()
                conn.commit()
                return dict(result) if result else None

    def delete(self, label_id: str | UUID) -> bool:
        """删除标签"""
        query = "DELETE FROM sample_labels WHERE id = %s"
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (str(label_id),))
                deleted = cur.rowcount > 0
                conn.commit()
                return deleted

    def add_range(
        self,
        label_id: str | UUID,
        start_time: datetime,
        end_time: datetime,
        experiment_id: str | None = None,
        phase: str | None = None,
    ) -> dict[str, Any]:
        """添加标注范围"""
        query = """
            INSERT INTO labeled_ranges 
                (label_id, experiment_id, start_time, end_time, phase)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    (str(label_id), experiment_id, start_time, end_time, phase),
                )
                result = cur.fetchone()
                conn.commit()
                return dict(result) if result else {}

    def get_ranges(self, label_id: str | UUID) -> list[dict[str, Any]]:
        """获取标签的所有标注范围"""
        query = """
            SELECT * FROM labeled_ranges
            WHERE label_id = %s
            ORDER BY start_time
        """
        with get_cursor() as cur:
            cur.execute(query, (str(label_id),))
            rows = cur.fetchall()
        return [dict(row) for row in rows]

    def delete_ranges(self, label_id: str | UUID) -> int:
        """删除标签的所有标注范围"""
        query = "DELETE FROM labeled_ranges WHERE label_id = %s"
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (str(label_id),))
                deleted = cur.rowcount
                conn.commit()
                return deleted
