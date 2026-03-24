"""查看完整的 样本周期: INJECT → ACQUIRE → WASH 的时间和数据关系"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import load_db_dsn
import psycopg
from psycopg.rows import dict_row

dsn = load_db_dsn()

with psycopg.connect(dsn, row_factory=dict_row) as conn:
    with conn.cursor() as cur:
        # 取 Run 105 连续几个样本, 按 sample_id 查看 phase 数据
        cur.execute("""
            SELECT id, sample_idx, liquid_names, start_time_ms, end_time_ms
            FROM samples WHERE run_id = 105 AND end_time_ms IS NOT NULL
            ORDER BY sample_idx LIMIT 3
        """)
        samples = cur.fetchall()

        for s in samples:
            sid = s["id"]
            print(f"\n{'='*80}")
            print(f"Sample idx={s['sample_idx']} (id={sid}): {s['liquid_names']}")
            print(f"ACQUIRE: {s['start_time_ms']} → {s['end_time_ms']}")
            print(f"{'='*80}")

            # 查看 sample_id = sid 的所有 phase 数据
            cur.execute("""
                SELECT phase_name, COUNT(*) as cnt,
                       MIN(time_ms) as first_ms, MAX(time_ms) as last_ms,
                       MIN(value) as min_val, MAX(value) as max_val
                FROM sensor_readings_v2
                WHERE sample_id = %s AND sensor_idx = 0
                GROUP BY phase_name
                ORDER BY MIN(time_ms)
            """, [sid])
            rows = cur.fetchall()
            for r in rows:
                dur_s = (r["last_ms"] - r["first_ms"]) / 1000
                print(f"  {r['phase_name']:<10} {r['cnt']:>4} pts  "
                      f"{dur_s:.1f}s  val={r['min_val']:.0f}~{r['max_val']:.0f}")

            # 也查看该样本时间范围前后的数据 (可能 sample_id=NULL 的)
            # 查看 ACQUIRE 之后紧接的 WASH/INJECT 数据
            cur.execute("""
                SELECT phase_name, COUNT(*) as cnt,
                       MIN(time_ms) as first_ms, MAX(time_ms) as last_ms,
                       MIN(value) as min_val, MAX(value) as max_val
                FROM sensor_readings_v2
                WHERE run_id = 105 AND sensor_idx = 0
                  AND time_ms > %s AND time_ms < %s + 120000
                  AND (sample_id IS NULL OR sample_id != %s)
                GROUP BY phase_name
                ORDER BY MIN(time_ms)
            """, [s["end_time_ms"], s["end_time_ms"], sid])
            rows = cur.fetchall()
            if rows:
                print(f"  --- ACQUIRE之后 (sample_id!=当前 or NULL): ---")
                for r in rows:
                    dur_s = (r["last_ms"] - r["first_ms"]) / 1000
                    print(f"  {r['phase_name']:<10} {r['cnt']:>4} pts  "
                          f"{dur_s:.1f}s  val={r['min_val']:.0f}~{r['max_val']:.0f}")

        # 再看一下 WASH phase 数据的 sample_id 关联
        print(f"\n{'='*80}")
        print("WASH phase 的 sample_id 关联情况")
        print(f"{'='*80}")
        cur.execute("""
            SELECT sample_id, COUNT(*) as cnt
            FROM sensor_readings_v2
            WHERE run_id = 105 AND phase_name = 'WASH' AND sensor_idx = 0
            GROUP BY sample_id
            ORDER BY sample_id NULLS FIRST
            LIMIT 15
        """)
        for r in cur.fetchall():
            print(f"  sample_id={r['sample_id']}: {r['cnt']} pts")

        # INJECT phase
        print(f"\n{'='*80}")
        print("INJECT phase 的 sample_id 关联情况")
        print(f"{'='*80}")
        cur.execute("""
            SELECT sample_id, COUNT(*) as cnt
            FROM sensor_readings_v2
            WHERE run_id = 105 AND phase_name = 'INJECT' AND sensor_idx = 0
            GROUP BY sample_id
            ORDER BY sample_id NULLS FIRST
            LIMIT 15
        """)
        for r in cur.fetchall():
            print(f"  sample_id={r['sample_id']}: {r['cnt']} pts")
