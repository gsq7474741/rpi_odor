"""检查样本之间是否有传感器数据（清洗/解析/排废阶段的数据）"""
import sys
import numpy as np
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import load_db_dsn
import psycopg
from psycopg.rows import dict_row

dsn = load_db_dsn()

with psycopg.connect(dsn, row_factory=dict_row) as conn:
    with conn.cursor() as cur:
        # 取 Run 105 连续 5 个样本，看间隙
        cur.execute("""
            SELECT id, sample_idx, liquid_names, start_time_ms, end_time_ms,
                   (end_time_ms - start_time_ms)/1000.0 as dur_s
            FROM samples
            WHERE run_id = 105 AND end_time_ms IS NOT NULL
            ORDER BY sample_idx
            LIMIT 5
        """)
        samples = cur.fetchall()

        print("=" * 80)
        print("样本间隔分析 (Run 105)")
        print("=" * 80)

        for i in range(len(samples)):
            s = samples[i]
            print(f"\n  样本 idx={s['sample_idx']}: {s['liquid_names']}")
            print(f"    ACQUIRE: {s['start_time_ms']} → {s['end_time_ms']} ({s['dur_s']:.1f}s)")

            if i < len(samples) - 1:
                ns = samples[i + 1]
                gap_ms = ns["start_time_ms"] - s["end_time_ms"]
                gap_s = gap_ms / 1000
                print(f"    ─── 间隙: {gap_s:.1f}s ───")

                # 查看间隙中是否有传感器数据 (sensor 0)
                cur.execute("""
                    SELECT COUNT(*) as cnt,
                           MIN(time_ms) as first_ms, MAX(time_ms) as last_ms,
                           MIN(value) as min_val, MAX(value) as max_val,
                           AVG(value) as avg_val
                    FROM sensor_readings_v2
                    WHERE run_id = 105 AND sensor_idx = 0
                      AND time_ms > %s AND time_ms < %s
                """, [s["end_time_ms"], ns["start_time_ms"]])
                gap_data = cur.fetchone()
                if gap_data and gap_data["cnt"] > 0:
                    print(f"    间隙中有 {gap_data['cnt']} 条传感器数据!")
                    print(f"      时间范围: {gap_data['first_ms']} → {gap_data['last_ms']}")
                    dur_gap = (gap_data["last_ms"] - gap_data["first_ms"]) / 1000
                    print(f"      持续: {dur_gap:.1f}s, 值范围: {gap_data['min_val']:.0f} ~ {gap_data['max_val']:.0f}")

                    # 看间隙数据的趋势
                    cur.execute("""
                        SELECT time_ms, value
                        FROM sensor_readings_v2
                        WHERE run_id = 105 AND sensor_idx = 0
                          AND time_ms > %s AND time_ms < %s
                        ORDER BY time_ms
                    """, [s["end_time_ms"], ns["start_time_ms"]])
                    gap_rows = cur.fetchall()
                    if gap_rows:
                        vals = [r["value"] for r in gap_rows]
                        t_rel = [(r["time_ms"] - s["end_time_ms"]) / 1000 for r in gap_rows]
                        print(f"      起始: {vals[0]:.0f}, 结束: {vals[-1]:.0f}")
                        print(f"      变化: {vals[-1] - vals[0]:+.0f} (解析/恢复趋势)")
                else:
                    print(f"    间隙中无传感器数据")

        # 也检查第一个样本之前是否有数据
        first = samples[0]
        print(f"\n{'='*80}")
        print("第一个样本之前的数据 (可能是排废阶段)")
        print(f"{'='*80}")
        cur.execute("""
            SELECT COUNT(*) as cnt, MIN(time_ms) as first_ms, MAX(time_ms) as last_ms
            FROM sensor_readings_v2
            WHERE run_id = 105 AND sensor_idx = 0
              AND time_ms < %s
        """, [first["start_time_ms"]])
        before = cur.fetchone()
        if before and before["cnt"] > 0:
            dur_before = (before["last_ms"] - before["first_ms"]) / 1000
            print(f"  有 {before['cnt']} 条数据, 持续 {dur_before:.1f}s")
        else:
            print(f"  无数据")

        # 查看 sensor_readings_v2 是否有 sample_id 字段
        print(f"\n{'='*80}")
        print("sensor_readings_v2 表结构")
        print(f"{'='*80}")
        cur.execute("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'sensor_readings_v2'
            ORDER BY ordinal_position
        """)
        for r in cur.fetchall():
            print(f"  {r['column_name']:<20} {r['data_type']}")
