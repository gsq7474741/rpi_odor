"""对比 S#604 和 S#610 的数据库数据，排查图表空白原因"""
import psycopg2

DB = dict(host="192.168.1.235", port=5432, database="enose",
          user="enose", password="enose_secure_password_change_me")

conn = psycopg2.connect(**DB)

for sid in [604, 610]:
    print(f"\n{'='*60}")
    print(f"Sample #{sid}")
    print('='*60)

    with conn.cursor() as cur:
        # 1. samples 表基本信息
        cur.execute("""
            SELECT id, run_id, sample_idx, phase_name, 
                   start_time_ms, end_time_ms,
                   liquid_names, liquid_ratios,
                   gas_pump_pwm, flow_rate_ml_s
            FROM samples WHERE id = %s
        """, (sid,))
        row = cur.fetchone()
        if row:
            cols = [d[0] for d in cur.description]
            for c, v in zip(cols, row):
                print(f"  {c}: {v}")
        else:
            print("  [NOT FOUND in samples]")
            continue

        start_ms = row[4]
        end_ms = row[5]
        run_id = row[1]

        # 2. sensor_readings_v2 统计
        cur.execute("""
            SELECT count(*), min(time_ms), max(time_ms),
                   min(sensor_idx), max(sensor_idx)
            FROM sensor_readings_v2
            WHERE sample_id = %s
        """, (sid,))
        r = cur.fetchone()
        print(f"\n  sensor_readings (by sample_id):")
        print(f"    count={r[0]}, time_range=[{r[1]} ~ {r[2]}], sensor_idx=[{r[3]} ~ {r[4]}]")

        # 3. 也按 run_id 查询（可能 sample_id 未关联）
        cur.execute("""
            SELECT count(*), min(time_ms), max(time_ms)
            FROM sensor_readings_v2
            WHERE run_id = %s
        """, (run_id,))
        r2 = cur.fetchone()
        print(f"  sensor_readings (by run_id={run_id}):")
        print(f"    count={r2[0]}, time_range=[{r2[1]} ~ {r2[2]}]")

        # 4. 前端过滤逻辑模拟：raw 模式下只保留 [start_time_ms, end_time_ms] 范围内的数据
        if start_ms and end_ms:
            cur.execute("""
                SELECT count(*)
                FROM sensor_readings_v2
                WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
            """, (run_id, start_ms, end_ms))
            r3 = cur.fetchone()
            print(f"  sensor_readings in sample time range [{start_ms} ~ {end_ms}]:")
            print(f"    count={r3[0]}")
        elif start_ms:
            print(f"  ⚠ end_time_ms is NULL! start_time_ms={start_ms}")
            cur.execute("""
                SELECT count(*)
                FROM sensor_readings_v2
                WHERE run_id = %s AND time_ms >= %s
            """, (run_id, start_ms))
            r3 = cur.fetchone()
            print(f"  sensor_readings after start_time_ms: count={r3[0]}")
        else:
            print(f"  ⚠ start_time_ms is NULL!")

        # 5. normalized_frames
        cur.execute("""
            SELECT count(*), method, n_samples
            FROM normalized_frames
            WHERE sample_id = %s
            GROUP BY method, n_samples
        """, (sid,))
        frames = cur.fetchall()
        if frames:
            print(f"\n  normalized_frames:")
            for f in frames:
                print(f"    method={f[1]}, n_samples={f[2]}, count={f[0]}")
        else:
            print(f"\n  normalized_frames: NONE")

        # 6. phase_transitions
        cur.execute("""
            SELECT phase_name, phase_order, start_time_ms, end_time_ms
            FROM sample_phase_transitions
            WHERE sample_id = %s
            ORDER BY phase_order
        """, (sid,))
        phases = cur.fetchall()
        if phases:
            print(f"\n  phase_transitions:")
            for p in phases:
                print(f"    order={p[1]} phase={p[0]} [{p[2]} ~ {p[3]}]")
        else:
            print(f"\n  phase_transitions: NONE")

print("\n\n" + "="*60)
print("Additional: Check normalized_frames values for S#604")
print("="*60)

with conn.cursor() as cur:
    # Check actual frame values
    cur.execute("""
        SELECT frame_idx, "values"[1:4] as first4values
        FROM normalized_frames
        WHERE sample_id = 604 AND method = 'linear' AND n_samples = 100
        ORDER BY frame_idx
        LIMIT 5
    """)
    rows = cur.fetchall()
    for r in rows:
        print(f"  frame_idx={r[0]}, first4values={r[1]}")

    # Check sensor_readings_v2 time format (what does analytics service see)
    cur.execute("""
        SELECT time_ms, sensor_idx, value
        FROM sensor_readings_v2
        WHERE sample_id = 604
        ORDER BY time_ms
        LIMIT 3
    """)
    rows = cur.fetchall()
    print(f"\n  Raw sensor readings for S#604 (first 3):")
    for r in rows:
        print(f"    time_ms={r[0]}, sensor_idx={r[1]}, value={r[2]}")

    # Check if run_id=29 has sensor data with ts that matches
    cur.execute("""
        SELECT time_ms, sensor_idx, value
        FROM sensor_readings_v2
        WHERE run_id = 29
        ORDER BY time_ms
        LIMIT 3
    """)
    rows = cur.fetchall()
    print(f"\n  Raw sensor readings for run 29 (first 3):")
    for r in rows:
        print(f"    time_ms={r[0]}, sensor_idx={r[1]}, value={r[2]}")

    # Key question: are there readings where sample_id is NULL but run_id=29
    # and time is within the sample range?
    cur.execute("""
        SELECT count(*), 
               count(*) FILTER (WHERE sample_id = 604) as with_sample,
               count(*) FILTER (WHERE sample_id IS NULL) as no_sample
        FROM sensor_readings_v2
        WHERE run_id = 29
    """)
    r = cur.fetchone()
    print(f"\n  run_id=29 readings: total={r[0]}, with_sample_id=604={r[1]}, sample_id_null={r[2]}")

    # Check what old samples (before refactor) look like
    # S#388 is from run 22, listed in the UI as old data
    for sid in [388, 393]:
        cur.execute("""
            SELECT id, run_id, start_time_ms, end_time_ms
            FROM samples WHERE id = %s
        """, (sid,))
        row = cur.fetchone()
        if row:
            print(f"\n  Old sample S#{sid}: run_id={row[1]}, start={row[2]}, end={row[3]}")
            cur.execute("""
                SELECT count(*) FROM sensor_readings_v2
                WHERE run_id = %s
            """, (row[1],))
            r2 = cur.fetchone()
            print(f"    sensor_readings by run_id: {r2[0]}")
            cur.execute("""
                SELECT count(*) FROM sensor_readings_v2
                WHERE sample_id = %s
            """, (sid,))
            r3 = cur.fetchone()
            print(f"    sensor_readings by sample_id: {r3[0]}")

conn.close()
