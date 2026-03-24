"""查看 120s ACQUIRE 窗口内传感器响应曲线的时间模式。
目标：判断是否存在明显的 吸附→解析 过渡点。
"""
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
        # 取 Run 105 的前 3 个样本，看传感器 0 的曲线
        cur.execute("""
            SELECT id, sample_idx, liquid_names, start_time_ms, end_time_ms
            FROM samples
            WHERE run_id = 105 AND end_time_ms IS NOT NULL
            ORDER BY sample_idx
            LIMIT 3
        """)
        samples = cur.fetchall()

        for s in samples:
            sid = s["id"]
            start_ms = s["start_time_ms"]
            end_ms = s["end_time_ms"]
            dur_s = (end_ms - start_ms) / 1000

            print(f"\n{'='*70}")
            print(f"Sample {s['sample_idx']}: {s['liquid_names']}  (dur={dur_s:.1f}s)")
            print(f"{'='*70}")

            # 查看 sensor 0 的原始值随时间变化
            cur.execute("""
                SELECT time_ms, sensor_idx, value
                FROM sensor_readings_v2
                WHERE run_id = 105 AND time_ms >= %s AND time_ms <= %s
                  AND sensor_idx = 0
                ORDER BY time_ms
            """, [start_ms, end_ms])
            rows = cur.fetchall()

            if not rows:
                print("  No data")
                continue

            times = np.array([(r["time_ms"] - start_ms) / 1000 for r in rows])
            vals = np.array([r["value"] for r in rows])

            # 打印关键统计
            print(f"  数据点: {len(rows)}, 采样间隔: ~{np.median(np.diff(times)):.2f}s")
            print(f"  起始值: {vals[0]:.0f}, 结束值: {vals[-1]:.0f}")

            # 找峰值和峰值时间
            peak_idx = np.argmax(vals)
            peak_time = times[peak_idx]
            peak_val = vals[peak_idx]
            print(f"  峰值: {peak_val:.0f} @ {peak_time:.1f}s")

            # 分段打印曲线趋势
            segments = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
            print(f"\n  {'时间段':<12} {'均值':>8} {'变化':>8} {'趋势'}")
            prev_mean = None
            for i in range(len(segments)-1):
                t0, t1 = segments[i], segments[i+1]
                mask = (times >= t0) & (times < t1)
                if mask.sum() == 0:
                    continue
                seg_vals = vals[mask]
                seg_mean = seg_vals.mean()
                change = seg_mean - prev_mean if prev_mean is not None else 0
                trend = "↑" if change > 50 else ("↓" if change < -50 else "→")
                print(f"  {t0:>3}-{t1:>3}s     {seg_mean:>8.0f} {change:>+8.0f} {trend}")
                prev_mean = seg_mean

        # 也查看实验程序的 gas_pump_pwm 是否在采集期间变化
        print(f"\n{'='*70}")
        print("gas_pump_pwm 在 ACQUIRE 阶段的值:")
        print(f"{'='*70}")
        cur.execute("""
            SELECT DISTINCT run_id, gas_pump_pwm
            FROM samples
            WHERE run_id IN (99, 105, 108) AND end_time_ms IS NOT NULL
            ORDER BY run_id
        """)
        for r in cur.fetchall():
            print(f"  Run {r['run_id']}: gas_pump_pwm = {r['gas_pump_pwm']}")
