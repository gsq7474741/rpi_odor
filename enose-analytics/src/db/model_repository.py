"""ML 模型存储模块"""

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from .connection import get_connection, get_cursor

logger = logging.getLogger(__name__)


class ModelRepository:
    """ML 模型存储库"""

    def create(
        self,
        name: str,
        config: dict[str, Any],
        input_dim: int,
        output_dim: int,
        class_names: list[str],
        minio_path: str,
        description: str | None = None,
        train_accuracy: float | None = None,
        val_accuracy: float | None = None,
        train_loss: float | None = None,
        val_loss: float | None = None,
        file_size: int | None = None,
    ) -> dict[str, Any]:
        """创建模型记录"""
        query = """
            INSERT INTO ml_models 
                (name, description, config, input_dim, output_dim, class_names,
                 train_accuracy, val_accuracy, train_loss, val_loss,
                 minio_path, file_size)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    (
                        name,
                        description,
                        json.dumps(config),
                        input_dim,
                        output_dim,
                        class_names,
                        train_accuracy,
                        val_accuracy,
                        train_loss,
                        val_loss,
                        minio_path,
                        file_size,
                    ),
                )
                result = cur.fetchone()
                conn.commit()
                return dict(result) if result else {}

    def get_by_id(self, model_id: str | UUID) -> dict[str, Any] | None:
        """根据 ID 获取模型"""
        query = "SELECT * FROM ml_models WHERE id = %s"
        with get_cursor() as cur:
            cur.execute(query, (str(model_id),))
            row = cur.fetchone()
        return dict(row) if row else None

    def get_by_name(self, name: str) -> dict[str, Any] | None:
        """根据名称获取模型"""
        query = "SELECT * FROM ml_models WHERE name = %s"
        with get_cursor() as cur:
            cur.execute(query, (name,))
            row = cur.fetchone()
        return dict(row) if row else None

    def list_models(
        self,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        """列出所有模型"""
        count_query = "SELECT COUNT(*) as total FROM ml_models"
        query = """
            SELECT * FROM ml_models
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """

        with get_cursor() as cur:
            cur.execute(count_query)
            total = cur.fetchone()["total"]

            cur.execute(query, (limit, offset))
            rows = cur.fetchall()

        return [dict(row) for row in rows], total

    def update(
        self,
        model_id: str | UUID,
        **kwargs: Any,
    ) -> dict[str, Any] | None:
        """更新模型"""
        allowed_fields = {
            "name",
            "description",
            "train_accuracy",
            "val_accuracy",
            "train_loss",
            "val_loss",
            "file_size",
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed_fields and v is not None}

        if not updates:
            return self.get_by_id(model_id)

        set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
        query = f"""
            UPDATE ml_models 
            SET {set_clause}, updated_at = NOW()
            WHERE id = %s
            RETURNING *
        """

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (*updates.values(), str(model_id)))
                result = cur.fetchone()
                conn.commit()
                return dict(result) if result else None

    def delete(self, model_id: str | UUID) -> bool:
        """删除模型"""
        query = "DELETE FROM ml_models WHERE id = %s"
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (str(model_id),))
                deleted = cur.rowcount > 0
                conn.commit()
                return deleted
