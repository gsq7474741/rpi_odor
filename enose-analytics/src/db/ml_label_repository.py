"""ML 标签仓库 - 管理标签策略和样本标签"""

import json
from typing import Any

from .connection import get_cursor
from ..logger import logger


class MLLabelRepository:
    """ML 标签数据访问层"""

    # ── 标签策略 CRUD ──

    def list_configs(self, active_only: bool = True) -> list[dict[str, Any]]:
        """列出所有标签策略配置"""
        query = "SELECT * FROM ml_label_configs"
        if active_only:
            query += " WHERE is_active = TRUE"
        query += " ORDER BY id"

        with get_cursor() as cur:
            cur.execute(query)
            return [dict(r) for r in cur.fetchall()]

    def get_config(self, config_id: int) -> dict[str, Any] | None:
        with get_cursor() as cur:
            cur.execute("SELECT * FROM ml_label_configs WHERE id = %s", [config_id])
            row = cur.fetchone()
            return dict(row) if row else None

    def get_config_by_name(self, name: str) -> dict[str, Any] | None:
        with get_cursor() as cur:
            cur.execute("SELECT * FROM ml_label_configs WHERE name = %s", [name])
            row = cur.fetchone()
            return dict(row) if row else None

    def create_config(
        self,
        name: str,
        label_type: str,
        strategy: str,
        config: dict | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        query = """
            INSERT INTO ml_label_configs (name, label_type, strategy, config, description)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """
        with get_cursor() as cur:
            cur.execute(query, [
                name, label_type, strategy,
                json.dumps(config or {}),
                description,
            ])
            return dict(cur.fetchone())

    def update_config(self, config_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"name", "label_type", "strategy", "config", "description", "is_active"}
        fields = {k: v for k, v in updates.items() if k in allowed}
        if not fields:
            return self.get_config(config_id)

        set_parts = []
        params: list[Any] = []
        for k, v in fields.items():
            set_parts.append(f"{k} = %s")
            params.append(json.dumps(v) if k == "config" else v)
        set_parts.append("updated_at = NOW()")
        params.append(config_id)

        query = f"UPDATE ml_label_configs SET {', '.join(set_parts)} WHERE id = %s RETURNING *"
        with get_cursor() as cur:
            cur.execute(query, params)
            row = cur.fetchone()
            return dict(row) if row else None

    def delete_config(self, config_id: int) -> bool:
        with get_cursor() as cur:
            cur.execute("DELETE FROM ml_label_configs WHERE id = %s", [config_id])
            return cur.rowcount > 0

    # ── 样本标签 CRUD ──

    def upsert_label(
        self,
        sample_id: int,
        config_id: int,
        label_str: str | None = None,
        label_num: float | None = None,
        label_json: dict | None = None,
        label_index: int | None = None,
    ) -> dict[str, Any]:
        query = """
            INSERT INTO sample_ml_labels (sample_id, config_id, label_str, label_num, label_json, label_index)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (sample_id, config_id) DO UPDATE SET
                label_str = EXCLUDED.label_str,
                label_num = EXCLUDED.label_num,
                label_json = EXCLUDED.label_json,
                label_index = EXCLUDED.label_index
            RETURNING *
        """
        with get_cursor() as cur:
            cur.execute(query, [
                sample_id, config_id,
                label_str, label_num,
                json.dumps(label_json) if label_json else None,
                label_index,
            ])
            return dict(cur.fetchone())

    def upsert_labels_batch(
        self,
        labels: list[dict[str, Any]],
    ) -> int:
        """批量 upsert 标签，返回处理的行数"""
        if not labels:
            return 0
        query = """
            INSERT INTO sample_ml_labels (sample_id, config_id, label_str, label_num, label_json, label_index)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (sample_id, config_id) DO UPDATE SET
                label_str = EXCLUDED.label_str,
                label_num = EXCLUDED.label_num,
                label_json = EXCLUDED.label_json,
                label_index = EXCLUDED.label_index
        """
        with get_cursor() as cur:
            count = 0
            for lbl in labels:
                cur.execute(query, [
                    lbl["sample_id"], lbl["config_id"],
                    lbl.get("label_str"), lbl.get("label_num"),
                    json.dumps(lbl["label_json"]) if lbl.get("label_json") else None,
                    lbl.get("label_index"),
                ])
                count += 1
            return count

    def get_labels_for_sample(self, sample_id: int) -> list[dict[str, Any]]:
        query = """
            SELECT sml.*, mlc.name AS config_name, mlc.label_type
            FROM sample_ml_labels sml
            JOIN ml_label_configs mlc ON sml.config_id = mlc.id
            WHERE sml.sample_id = %s
            ORDER BY mlc.name
        """
        with get_cursor() as cur:
            cur.execute(query, [sample_id])
            return [dict(r) for r in cur.fetchall()]

    def get_labels_by_config(
        self,
        config_name: str,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
        limit: int = 10000,
    ) -> list[dict[str, Any]]:
        """按策略名获取所有样本标签（可选筛选）"""
        query = """
            SELECT
                s.id AS sample_id,
                s.run_id,
                s.sample_idx,
                s.params_hash,
                s.liquid_names,
                s.liquid_ratios,
                s.start_time_ms,
                s.end_time_ms,
                sml.label_str,
                sml.label_num,
                sml.label_index,
                sml.label_json
            FROM samples s
            JOIN sample_ml_labels sml ON s.id = sml.sample_id
            JOIN ml_label_configs mlc ON sml.config_id = mlc.id
            WHERE mlc.name = %s
        """
        params: list[Any] = [config_name]

        if sample_ids:
            query += " AND s.id = ANY(%s)"
            params.append(sample_ids)
        elif run_ids:
            query += " AND s.run_id = ANY(%s)"
            params.append(run_ids)
        if phase_names:
            query += " AND s.phase_name = ANY(%s)"
            params.append(phase_names)

        query += " ORDER BY s.run_id, s.sample_idx LIMIT %s"
        params.append(limit)

        with get_cursor() as cur:
            cur.execute(query, params)
            return [dict(r) for r in cur.fetchall()]

    def get_label_distribution(
        self,
        config_name: str,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
    ) -> dict[str, int]:
        """获取某策略下的标签分布"""
        query = """
            SELECT sml.label_str, COUNT(*) AS cnt
            FROM sample_ml_labels sml
            JOIN ml_label_configs mlc ON sml.config_id = mlc.id
            JOIN samples s ON sml.sample_id = s.id
            WHERE mlc.name = %s AND sml.label_str IS NOT NULL
        """
        params: list[Any] = [config_name]

        if sample_ids:
            query += " AND s.id = ANY(%s)"
            params.append(sample_ids)
        elif run_ids:
            query += " AND s.run_id = ANY(%s)"
            params.append(run_ids)
        if phase_names:
            query += " AND s.phase_name = ANY(%s)"
            params.append(phase_names)

        query += " GROUP BY sml.label_str ORDER BY cnt DESC"
        with get_cursor() as cur:
            cur.execute(query, params)
            return {r["label_str"]: r["cnt"] for r in cur.fetchall()}

    def delete_labels_by_config(self, config_id: int) -> int:
        """删除某策略下的所有标签"""
        with get_cursor() as cur:
            cur.execute("DELETE FROM sample_ml_labels WHERE config_id = %s", [config_id])
            return cur.rowcount

    def count_labels(self, config_id: int) -> int:
        with get_cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM sample_ml_labels WHERE config_id = %s", [config_id])
            return cur.fetchone()["count"]

    # ── 数据集 ──

    def list_datasets(self) -> list[dict[str, Any]]:
        query = """
            SELECT d.*, mlc.name AS config_name, mlc.label_type
            FROM ml_datasets d
            JOIN ml_label_configs mlc ON d.config_id = mlc.id
            ORDER BY d.created_at DESC
        """
        with get_cursor() as cur:
            cur.execute(query)
            return [dict(r) for r in cur.fetchall()]

    def create_dataset(
        self,
        name: str,
        config_id: int,
        description: str | None = None,
        filter_run_ids: list[int] | None = None,
        filter_phase_names: list[str] | None = None,
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15,
    ) -> dict[str, Any]:
        query = """
            INSERT INTO ml_datasets (
                name, config_id, description,
                filter_run_ids, filter_phase_names,
                train_ratio, val_ratio, test_ratio
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """
        with get_cursor() as cur:
            cur.execute(query, [
                name, config_id, description,
                filter_run_ids, filter_phase_names,
                train_ratio, val_ratio, test_ratio,
            ])
            return dict(cur.fetchone())

    def delete_dataset(self, dataset_id: int) -> bool:
        with get_cursor() as cur:
            cur.execute("DELETE FROM ml_datasets WHERE id = %s", [dataset_id])
            return cur.rowcount > 0
