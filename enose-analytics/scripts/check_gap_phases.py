"""查看间隙中传感器数据的 phase_name 和 sample_id"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import load_db_dsn
import psycopg
from psycopg.rows import dict_row

dsn = load_db_dsn()

with psycopg.connect(dsn, row_factory=dict_row) as conn:
    with conn.cursor() as cur:
        # Run 105 前两个样本间隙中的 phase_name
        cur.execute("""
            SELECT id, sample_idx, start_time_ms, end_time_ms
            FROM samples WHERE run_id = 105 AND end_time_ms IS NOT NULL
            ORDER BY sample_idx LIMIT 2
        """)
        samples = cur.fetchall()
        s0, s1 = samples[0], samples[1]

        print("=" * 70)
        print(f"间隙 phase_name 分析: Sample {s0['sample_idx']} → Sample {s1['sample_idx']}")
        print(f"间隙时间: {s0['end_time_ms']} → {s1['start_time_ms']}")
        print("=" * 70)

        cur.execute("""
            SELECT DISTINCT phase_name, sample_id, COUNT(*) as cnt
            FROM sensor_readings_v2
            WHERE run_id = 105 AND sensor_idx = 0
              AND time_ms > %s AND time_ms < %s
            GROUP BY phase_name, sample_id
        """, [s0["end_time_ms"], s1["start_time_ms"]])
        for r in cur.fetchall():
            print(f"  phase={r['phase_name']}, sample_id={r['sample_id']}, count={r['cnt']}")

        # 查看所有 phase_name 值 in sensor_readings_v2
        print(f"\n{'='*70}")
        print("sensor_readings_v2 中所有 phase_name (Run 105)")
        print(f"{'='*70}")
        cur.execute("""
            SELECT phase_name, COUNT(*) as cnt
            FROM sensor_readings_v2
            WHERE run_id = 105 AND sensor_idx = 0
            GROUP BY phase_name
            ORDER BY cnt DESC
        """)
        for r in cur.fetchall():
            print(f"  {str(r['phase_name']):<20} {r['cnt']:>8} 条")

        # 查看 ACQUIRE 之外的 phase_name 的时间和值模式
        print(f"\n{'='*70}")
        print("非 ACQUIRE 阶段的数据统计 (sensor 0, Run 105)")
        print(f"{'='*70}")
        cur.execute("""
            SELECT phase_name, COUNT(*) as cnt,
                   MIN(value) as min_val, MAX(value) as max_val, AVG(value) as avg_val
            FROM sensor_readings_v2
            WHERE run_id = 105 AND sensor_idx = 0
              AND (phase_name != 'ACQUIRE' OR phase_name IS NULL)
            GROUP BY phase_name
        """)
        for r in cur.fetchall():
            print(f"  phase={r['phase_name']}: {r['cnt']} 条, "
                  f"val={r['min_val']:.0f}~{r['max_val']:.0f} (avg={r['avg_val']:.0f})")
