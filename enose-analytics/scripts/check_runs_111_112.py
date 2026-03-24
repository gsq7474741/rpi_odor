"""快速查看 run 111/112 的样本概况"""
import psycopg
from truncation_study.config import load_db_dsn

dsn = load_db_dsn()

with psycopg.connect(dsn) as conn:
    with conn.cursor() as cur:
        # 基本信息
        cur.execute("""
            SELECT r.id, r.created_at, r.state,
                   COUNT(s.id) as n_samples
            FROM runs r
            LEFT JOIN samples s ON s.run_id = r.id
            WHERE r.id IN (111, 112)
            GROUP BY r.id
            ORDER BY r.id
        """)
        print("=== Runs ===")
        for row in cur.fetchall():
            print(f"  Run {row[0]}: created={row[1]}, state={row[2]}, samples={row[3]}")

        # 液体分布
        cur.execute("""
            SELECT s.run_id, s.liquid_names, COUNT(*) as cnt
            FROM samples s
            WHERE s.run_id IN (111, 112)
            GROUP BY s.run_id, s.liquid_names
            ORDER BY s.run_id, cnt DESC
        """)
        print("\n=== 液体分布 ===")
        for row in cur.fetchall():
            print(f"  Run {row[0]}: {row[1]} x{row[2]}")

        # ACQUIRE 时长 (start/end_time_ms 是 bigint ms)
        cur.execute("""
            SELECT s.run_id,
                   AVG((s.end_time_ms - s.start_time_ms)/1000.0) as avg_dur_s,
                   MIN((s.end_time_ms - s.start_time_ms)/1000.0) as min_dur_s,
                   MAX((s.end_time_ms - s.start_time_ms)/1000.0) as max_dur_s
            FROM samples s
            WHERE s.run_id IN (111, 112)
              AND s.end_time_ms IS NOT NULL
            GROUP BY s.run_id
            ORDER BY s.run_id
        """)
        print("\n=== ACQUIRE 时长 (ms 字段) ===")
        for row in cur.fetchall():
            print(f"  Run {row[0]}: avg={row[1]:.1f}s, min={row[2]:.1f}s, max={row[3]:.1f}s")

        # sensor_readings 中 sample_id 情况
        cur.execute("""
            SELECT run_id, phase_name,
                   COUNT(*) as cnt,
                   COUNT(sample_id) as with_sid
            FROM sensor_readings_v2
            WHERE run_id IN (111, 112)
            GROUP BY run_id, phase_name
            ORDER BY run_id, phase_name
        """)
        print("\n=== sensor_readings_v2 phase 分布 ===")
        for row in cur.fetchall():
            print(f"  Run {row[0]}: phase={row[1]}, readings={row[2]}, with_sample_id={row[3]}")
