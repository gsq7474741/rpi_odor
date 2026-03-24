"""查询 run_id >= 99 的数据分布和样本时长信息"""

import yaml
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from collections import defaultdict

def load_dsn():
    cfg_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"

def main():
    dsn = load_dsn()
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # 1. 查询 runs
            cur.execute("""
                SELECT id, program_name, created_at
                FROM runs WHERE id >= 99
                ORDER BY id
            """)
            runs = cur.fetchall()
            print(f"=== Runs (id >= 99): {len(runs)} ===")
            for r in runs:
                print(f"  Run {r['id']}: {r['program_name']}  ({r['created_at']})")

            # 2. 查询每个 run 的样本数和时长分布
            cur.execute("""
                SELECT s.run_id, 
                       COUNT(*) as n_samples,
                       array_agg(DISTINCT unnest_names) as unique_liquids,
                       AVG((s.end_time_ms - s.start_time_ms) / 1000.0) as avg_duration_s,
                       MIN((s.end_time_ms - s.start_time_ms) / 1000.0) as min_duration_s,
                       MAX((s.end_time_ms - s.start_time_ms) / 1000.0) as max_duration_s
                FROM samples s
                LEFT JOIN LATERAL unnest(s.liquid_names) AS unnest_names ON true
                WHERE s.run_id >= 99
                  AND s.end_time_ms IS NOT NULL
                GROUP BY s.run_id
                ORDER BY s.run_id
            """)
            stats = cur.fetchall()
            print(f"\n=== 样本时长统计 ===")
            for st in stats:
                print(f"  Run {st['run_id']}: {st['n_samples']} samples, "
                      f"avg={st['avg_duration_s']:.1f}s, min={st['min_duration_s']:.1f}s, max={st['max_duration_s']:.1f}s")
                print(f"    liquids: {st['unique_liquids']}")

            # 3. 逐 run 查询纯样本 vs 混合样本
            print(f"\n=== 纯样 vs 混合 ===")
            cur.execute("""
                SELECT s.run_id, 
                       s.liquid_names,
                       s.liquid_ratios,
                       COUNT(*) as cnt,
                       AVG((s.end_time_ms - s.start_time_ms) / 1000.0) as avg_dur_s
                FROM samples s
                WHERE s.run_id >= 99
                  AND s.end_time_ms IS NOT NULL
                GROUP BY s.run_id, s.liquid_names, s.liquid_ratios
                ORDER BY s.run_id, cnt DESC
            """)
            combos = cur.fetchall()
            current_run = None
            for c in combos:
                if c['run_id'] != current_run:
                    current_run = c['run_id']
                    print(f"\n  Run {current_run}:")
                names = list(c['liquid_names']) if c['liquid_names'] else []
                ratios = list(c['liquid_ratios']) if c['liquid_ratios'] else []
                is_pure = len(names) == 1
                label = "纯" if is_pure else "混"
                names_str = "+".join(names)
                ratios_str = ":".join([f"{r:.0%}" for r in ratios])
                print(f"    [{label}] {names_str} ({ratios_str}) x{c['cnt']} avg={c['avg_dur_s']:.1f}s")

            # 4. 检查一个典型样本的原始数据点密度
            print(f"\n=== 典型样本原始数据点密度 ===")
            cur.execute("""
                SELECT s.id, s.run_id, s.start_time_ms, s.end_time_ms,
                       (s.end_time_ms - s.start_time_ms) / 1000.0 as duration_s
                FROM samples s
                WHERE s.run_id >= 99 AND s.end_time_ms IS NOT NULL
                ORDER BY s.run_id, s.sample_idx
                LIMIT 5
            """)
            sample_examples = cur.fetchall()
            for se in sample_examples:
                cur.execute("""
                    SELECT COUNT(*) as n_readings, 
                           COUNT(DISTINCT sensor_idx) as n_sensors
                    FROM sensor_readings_v2
                    WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                """, [se['run_id'], se['start_time_ms'], se['end_time_ms']])
                rd = cur.fetchone()
                per_sensor = rd['n_readings'] / max(rd['n_sensors'], 1)
                print(f"  Sample {se['id']} (Run {se['run_id']}): "
                      f"dur={se['duration_s']:.1f}s, "
                      f"readings={rd['n_readings']}, "
                      f"sensors={rd['n_sensors']}, "
                      f"per_sensor≈{per_sensor:.0f}")

if __name__ == "__main__":
    main()
