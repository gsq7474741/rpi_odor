"""诊断脚本：对比 run 93 (正常), 97 (漏水), 99 (修复后) 的传感器数据"""

import psycopg2
import psycopg2.extras

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

RUN_IDS = [93, 97, 99]

def main():
    conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
    
    print("=" * 80)
    print("1. 实验运行基本信息")
    print("=" * 80)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, created_at, completed_at, state, 
                   current_step, total_steps, error_message,
                   EXTRACT(EPOCH FROM (completed_at - created_at)) as duration_s
            FROM runs 
            WHERE id = ANY(%s)
            ORDER BY id
        """, [RUN_IDS])
        for row in cur.fetchall():
            print(f"\n--- Run {row['id']} ---")
            print(f"  状态: {row['state']}")
            print(f"  创建: {row['created_at']}")
            print(f"  完成: {row['completed_at']}")
            print(f"  耗时: {row['duration_s']:.0f}s" if row['duration_s'] else "  耗时: N/A")
            print(f"  步骤: {row['current_step']}/{row['total_steps']}")
            if row['error_message']:
                print(f"  错误: {row['error_message']}")

    print("\n" + "=" * 80)
    print("2. 各 Run 的样本信息")
    print("=" * 80)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, run_id, sample_idx, phase_name,
                   liquid_names, liquid_ratios, total_volume_ml,
                   gas_pump_pwm, start_time_ms, end_time_ms,
                   CASE WHEN end_time_ms IS NOT NULL 
                        THEN (end_time_ms - start_time_ms) / 1000.0 
                        ELSE NULL END as duration_s,
                   heater_configs,
                   avg_temperature_c, avg_humidity_pct
            FROM samples
            WHERE run_id = ANY(%s)
            ORDER BY run_id, sample_idx
        """, [RUN_IDS])
        samples = cur.fetchall()
        
        for row in samples:
            print(f"\n  Sample {row['id']} (run={row['run_id']}, idx={row['sample_idx']})")
            print(f"    阶段: {row['phase_name']}")
            print(f"    液体: {row['liquid_names']} 比例={row['liquid_ratios']}")
            print(f"    总量: {row['total_volume_ml']} ml, 气泵PWM: {row['gas_pump_pwm']}")
            print(f"    时长: {row['duration_s']:.1f}s" if row['duration_s'] else "    时长: N/A")
            print(f"    温度: {row['avg_temperature_c']}, 湿度: {row['avg_humidity_pct']}")

    print("\n" + "=" * 80)
    print("3. 各 Run 的传感器数据量统计 (按 sensor_idx 分组)")
    print("=" * 80)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT sr.run_id, sr.sensor_idx, 
                   COUNT(*) as reading_count,
                   MIN(sr.value) as min_val,
                   MAX(sr.value) as max_val,
                   AVG(sr.value) as avg_val,
                   STDDEV(sr.value) as std_val,
                   MIN(sr.time_ms) as first_time_ms,
                   MAX(sr.time_ms) as last_time_ms,
                   (MAX(sr.time_ms) - MIN(sr.time_ms)) / 1000.0 as span_s
            FROM sensor_readings_v2 sr
            WHERE sr.run_id = ANY(%s)
            GROUP BY sr.run_id, sr.sensor_idx
            ORDER BY sr.run_id, sr.sensor_idx
        """, [RUN_IDS])
        
        current_run = None
        for row in cur.fetchall():
            if row['run_id'] != current_run:
                current_run = row['run_id']
                print(f"\n--- Run {current_run} ---")
                print(f"  {'Sensor':>6} | {'Count':>8} | {'Min':>12} | {'Max':>12} | {'Mean':>12} | {'Std':>10} | {'Span(s)':>8}")
                print(f"  {'-'*6} | {'-'*8} | {'-'*12} | {'-'*12} | {'-'*12} | {'-'*10} | {'-'*8}")
            
            print(f"  {row['sensor_idx']:>6} | {row['reading_count']:>8} | "
                  f"{row['min_val']:>12.1f} | {row['max_val']:>12.1f} | "
                  f"{row['avg_val']:>12.1f} | {row['std_val']:>10.1f} | "
                  f"{row['span_s']:>8.0f}")

    print("\n" + "=" * 80)
    print("4. 各 Sample 的传感器数据量 (使用 run_id + time_ms 范围)")
    print("=" * 80)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT s.id as sample_id, s.run_id, s.sample_idx, s.phase_name,
                   sr.sensor_idx,
                   COUNT(*) as cnt,
                   MIN(sr.value) as min_val,
                   MAX(sr.value) as max_val,
                   AVG(sr.value) as avg_val
            FROM samples s
            JOIN sensor_readings_v2 sr 
                ON sr.run_id = s.run_id
                AND sr.time_ms >= s.start_time_ms
                AND sr.time_ms <= s.end_time_ms
            WHERE s.run_id = ANY(%s)
            GROUP BY s.id, s.run_id, s.sample_idx, s.phase_name, sr.sensor_idx
            ORDER BY s.run_id, s.sample_idx, sr.sensor_idx
        """, [RUN_IDS])
        
        current_sample = None
        for row in cur.fetchall():
            key = (row['run_id'], row['sample_id'])
            if key != current_sample:
                current_sample = key
                print(f"\n  Sample {row['sample_id']} (run={row['run_id']}, idx={row['sample_idx']}, phase={row['phase_name']})")
                print(f"    {'Sensor':>6} | {'Count':>6} | {'Min':>12} | {'Max':>12} | {'Mean':>12}")
                print(f"    {'-'*6} | {'-'*6} | {'-'*12} | {'-'*12} | {'-'*12}")
            
            print(f"    {row['sensor_idx']:>6} | {row['cnt']:>6} | "
                  f"{row['min_val']:>12.1f} | {row['max_val']:>12.1f} | "
                  f"{row['avg_val']:>12.1f}")

    print("\n" + "=" * 80)
    print("5. 对比：相同配置传感器 (排除 sensor 3,7 变温) 的 ACQUIRE 阶段均值")
    print("   Run 93=正常基线, 97=漏水(仅前50个样本), 99=修复后")
    print("=" * 80)
    with conn.cursor() as cur:
        # 只看常温传感器 (排除 93 的 3,7)，ACQUIRE 阶段
        # Run 97 只取前50个样本（漏水前），排除漏水后的异常数据
        cur.execute("""
            SELECT s.run_id, sr.sensor_idx,
                   AVG(sr.value) as avg_val,
                   STDDEV(sr.value) as std_val,
                   COUNT(*) as cnt
            FROM samples s
            JOIN sensor_readings_v2 sr 
                ON sr.run_id = s.run_id
                AND sr.time_ms >= s.start_time_ms
                AND sr.time_ms <= s.end_time_ms
            WHERE s.run_id = ANY(%s)
              AND s.phase_name = 'ACQUIRE'
              AND sr.sensor_idx NOT IN (3, 7)
              AND (s.run_id != 97 OR s.sample_idx < 50)
            GROUP BY s.run_id, sr.sensor_idx
            ORDER BY sr.sensor_idx, s.run_id
        """, [RUN_IDS])
        
        rows = cur.fetchall()
        
        # 按 sensor_idx 分组对比
        from collections import defaultdict
        by_sensor = defaultdict(dict)
        for r in rows:
            by_sensor[r['sensor_idx']][r['run_id']] = r
        
        print(f"\n  {'Sensor':>6} | {'Run 93 (正常)':>20} | {'Run 97 (漏水)':>20} | {'Run 99 (修复)':>20} | {'97/93 比值':>10} | {'99/93 比值':>10}")
        print(f"  {'-'*6} | {'-'*20} | {'-'*20} | {'-'*20} | {'-'*10} | {'-'*10}")
        
        for si in sorted(by_sensor.keys()):
            vals = []
            for rid in RUN_IDS:
                if rid in by_sensor[si]:
                    r = by_sensor[si][rid]
                    vals.append(f"{r['avg_val']:>10.0f}±{r['std_val']:>6.0f}")
                else:
                    vals.append(f"{'N/A':>20}")
            
            # 计算比值
            r93 = by_sensor[si].get(93)
            r97 = by_sensor[si].get(97)
            r99 = by_sensor[si].get(99)
            
            ratio_97 = f"{r97['avg_val']/r93['avg_val']:.3f}" if r93 and r97 and r93['avg_val'] != 0 else "N/A"
            ratio_99 = f"{r99['avg_val']/r93['avg_val']:.3f}" if r93 and r99 and r93['avg_val'] != 0 else "N/A"
            
            print(f"  {si:>6} | {vals[0]:>20} | {vals[1]:>20} | {vals[2]:>20} | {ratio_97:>10} | {ratio_99:>10}")

    print("\n" + "=" * 80)
    print("6. 各 Run 传感器数据的时间覆盖情况")
    print("=" * 80)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT run_id,
                   COUNT(DISTINCT sensor_idx) as sensor_count,
                   COUNT(*) as total_readings,
                   MIN(time_ms) as first_ms,
                   MAX(time_ms) as last_ms,
                   (MAX(time_ms) - MIN(time_ms)) / 1000.0 as total_span_s,
                   COUNT(*) / NULLIF(COUNT(DISTINCT sensor_idx), 0) as readings_per_sensor
            FROM sensor_readings_v2
            WHERE run_id = ANY(%s)
            GROUP BY run_id
            ORDER BY run_id
        """, [RUN_IDS])
        
        for row in cur.fetchall():
            print(f"\n  Run {row['run_id']}:")
            print(f"    活跃传感器数: {row['sensor_count']}")
            print(f"    总读数: {row['total_readings']}")
            print(f"    每传感器读数: {row['readings_per_sensor']}")
            print(f"    时间跨度: {row['total_span_s']:.0f}s ({row['total_span_s']/60:.1f}min)")

    print("\n" + "=" * 80)
    print("7. 检查 Run 97 是否有数据中断（每分钟读数统计）")
    print("=" * 80)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 
                (time_ms / 60000) * 60000 as minute_bucket,
                COUNT(*) as cnt,
                COUNT(DISTINCT sensor_idx) as sensors
            FROM sensor_readings_v2
            WHERE run_id = 97
            GROUP BY minute_bucket
            ORDER BY minute_bucket
        """)
        rows = cur.fetchall()
        if rows:
            first_ms = rows[0]['minute_bucket']
            print(f"  {'相对分钟':>8} | {'读数数':>6} | {'传感器数':>8}")
            print(f"  {'-'*8} | {'-'*6} | {'-'*8}")
            for row in rows:
                rel_min = (row['minute_bucket'] - first_ms) / 60000
                print(f"  {rel_min:>8.0f} | {row['cnt']:>6} | {row['sensors']:>8}")
        else:
            print("  Run 97 无传感器数据！")

    conn.close()
    print("\n完成!")

if __name__ == "__main__":
    main()
