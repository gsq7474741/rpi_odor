#!/usr/bin/env python3
"""
一次性脚本：清除假数据和坏数据

1. 删除 seed_test_data.py 生成的 90000+ 编号假数据（runs, samples, sensor_readings_v2 等）
2. 删除坏数据 sample_id=389,390,391（No data for sample_id）

用法:
    python scripts/cleanup_bad_data.py
"""

import psycopg

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "dbname": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

BAD_SAMPLE_IDS = [389, 390, 391]


def main():
    conn = psycopg.connect(**DB_CONFIG)

    with conn.cursor() as cur:
        # ============================================================
        # 1. 删除 90000+ 假数据
        # ============================================================
        print("=== 清除 90000+ seed 假数据 ===")

        # sensor_readings_v2
        cur.execute("DELETE FROM sensor_readings_v2 WHERE run_id >= 90000 AND run_id < 100000")
        print(f"  sensor_readings_v2: {cur.rowcount} rows deleted")

        # normalized_frames (通过 sample_id 关联)
        cur.execute("""
            DELETE FROM normalized_frames 
            WHERE sample_id IN (SELECT id FROM samples WHERE run_id >= 90000 AND run_id < 100000)
        """)
        print(f"  normalized_frames (seed): {cur.rowcount} rows deleted")

        # sample_ml_labels
        cur.execute("""
            DELETE FROM sample_ml_labels 
            WHERE sample_id IN (SELECT id FROM samples WHERE run_id >= 90000 AND run_id < 100000)
        """)
        print(f"  sample_ml_labels: {cur.rowcount} rows deleted")

        # sample_phase_transitions
        cur.execute("""
            DELETE FROM sample_phase_transitions 
            WHERE sample_id IN (SELECT id FROM samples WHERE run_id >= 90000 AND run_id < 100000)
        """)
        print(f"  sample_phase_transitions: {cur.rowcount} rows deleted")

        # samples
        cur.execute("DELETE FROM samples WHERE run_id >= 90000 AND run_id < 100000")
        print(f"  samples (seed): {cur.rowcount} rows deleted")

        # runs
        cur.execute("DELETE FROM runs WHERE id >= 90000 AND id < 100000")
        print(f"  runs (seed): {cur.rowcount} rows deleted")

        # ============================================================
        # 2. 删除坏数据 sample_id=389,390,391
        # ============================================================
        print(f"\n=== 清除坏数据 sample_id={BAD_SAMPLE_IDS} ===")

        # normalized_frames
        cur.execute("DELETE FROM normalized_frames WHERE sample_id = ANY(%s)", (BAD_SAMPLE_IDS,))
        print(f"  normalized_frames: {cur.rowcount} rows deleted")

        # sample_ml_labels
        cur.execute("DELETE FROM sample_ml_labels WHERE sample_id = ANY(%s)", (BAD_SAMPLE_IDS,))
        print(f"  sample_ml_labels: {cur.rowcount} rows deleted")

        # sample_phase_transitions
        cur.execute("DELETE FROM sample_phase_transitions WHERE sample_id = ANY(%s)", (BAD_SAMPLE_IDS,))
        print(f"  sample_phase_transitions: {cur.rowcount} rows deleted")

        # sensor_readings_v2
        cur.execute("DELETE FROM sensor_readings_v2 WHERE sample_id = ANY(%s)", (BAD_SAMPLE_IDS,))
        print(f"  sensor_readings_v2: {cur.rowcount} rows deleted")

        # samples
        cur.execute("DELETE FROM samples WHERE id = ANY(%s)", (BAD_SAMPLE_IDS,))
        print(f"  samples: {cur.rowcount} rows deleted")

        # 检查是否有对应的空 run（没有样本的 run）
        cur.execute("""
            SELECT r.id FROM runs r 
            LEFT JOIN samples s ON r.id = s.run_id 
            WHERE s.id IS NULL AND r.id < 90000
        """)
        empty_runs = [row[0] for row in cur.fetchall()]
        if empty_runs:
            print(f"\n  发现 {len(empty_runs)} 个无样本的 run: {empty_runs}")
            cur.execute("DELETE FROM runs WHERE id = ANY(%s)", (empty_runs,))
            print(f"  runs (empty): {cur.rowcount} rows deleted")

    conn.commit()
    conn.close()
    print("\n✅ 清理完成")


if __name__ == "__main__":
    main()
