"""调研样本的 phase 结构和时间分布"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import load_db_dsn, ALL_RUNS
import psycopg
from psycopg.rows import dict_row
from collections import defaultdict

dsn = load_db_dsn()

with psycopg.connect(dsn, row_factory=dict_row) as conn:
    with conn.cursor() as cur:
        # 1) 查看 samples 表的 phase_name 分布
        print("=" * 70)
        print("1. phase_name 分布 (run_id >= 99)")
        print("=" * 70)
        cur.execute("""
            SELECT run_id, phase_name, COUNT(*) as cnt,
                   AVG((end_time_ms - start_time_ms)/1000.0) as avg_dur_s,
                   MIN((end_time_ms - start_time_ms)/1000.0) as min_dur_s,
                   MAX((end_time_ms - start_time_ms)/1000.0) as max_dur_s
            FROM samples
            WHERE run_id >= 99 AND end_time_ms IS NOT NULL
            GROUP BY run_id, phase_name
            ORDER BY run_id, phase_name
        """)
        rows = cur.fetchall()
        current_run = None
        for r in rows:
            if r["run_id"] != current_run:
                current_run = r["run_id"]
                print(f"\n  Run {current_run}:")
            print(f"    {r['phase_name']:<20} {r['cnt']:>4} 样本  "
                  f"时长: {r['avg_dur_s']:.1f}s (min={r['min_dur_s']:.1f}, max={r['max_dur_s']:.1f})")

        # 2) 查看单个 run 内样本的时间顺序和 phase 交替模式
        print("\n" + "=" * 70)
        print("2. Run 105 样本时间序列 (前 30 个)")
        print("=" * 70)
        cur.execute("""
            SELECT id, sample_idx, phase_name, liquid_names, liquid_ratios,
                   start_time_ms, end_time_ms,
                   (end_time_ms - start_time_ms)/1000.0 as dur_s
            FROM samples
            WHERE run_id = 105 AND end_time_ms IS NOT NULL
            ORDER BY sample_idx
            LIMIT 30
        """)
        rows = cur.fetchall()
        for r in rows:
            names = r["liquid_names"] if r["liquid_names"] else []
            ratios = r["liquid_ratios"] if r["liquid_ratios"] else []
            print(f"  idx={r['sample_idx']:>3} phase={r['phase_name']:<12} "
                  f"dur={r['dur_s']:.1f}s  liquids={names} ratios={ratios}")

        # 3) 查看一个纯样 run 的 phase 模式
        print("\n" + "=" * 70)
        print("3. Run 99 样本时间序列 (前 30 个)")
        print("=" * 70)
        cur.execute("""
            SELECT id, sample_idx, phase_name, liquid_names, liquid_ratios,
                   start_time_ms, end_time_ms,
                   (end_time_ms - start_time_ms)/1000.0 as dur_s
            FROM samples
            WHERE run_id = 99 AND end_time_ms IS NOT NULL
            ORDER BY sample_idx
            LIMIT 30
        """)
        rows = cur.fetchall()
        for r in rows:
            names = r["liquid_names"] if r["liquid_names"] else []
            ratios = r["liquid_ratios"] if r["liquid_ratios"] else []
            print(f"  idx={r['sample_idx']:>3} phase={r['phase_name']:<12} "
                  f"dur={r['dur_s']:.1f}s  liquids={names} ratios={ratios}")

        # 4) 统计所有 phase_name 的唯一值
        print("\n" + "=" * 70)
        print("4. 所有唯一 phase_name")
        print("=" * 70)
        cur.execute("""
            SELECT DISTINCT phase_name FROM samples WHERE run_id >= 99
        """)
        phases = [r["phase_name"] for r in cur.fetchall()]
        print(f"  {phases}")
