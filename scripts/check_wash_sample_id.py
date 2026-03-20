"""检查 WASH 阶段传感器数据的 sample_id 情况"""
import psycopg2
import psycopg2.extras

conn = psycopg2.connect(
    host="192.168.1.235",
    port=5432,
    database="enose",
    user="enose",
    password="enose_secure_password_change_me",
)

with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    # 1. 查看各 phase 的 sample_id 分布
    print("=" * 60)
    print("各 phase_name 的 sample_id 分布:")
    print("=" * 60)
    cur.execute("""
        SELECT phase_name, 
               COUNT(*) as total,
               COUNT(sample_id) as with_sample_id,
               COUNT(*) - COUNT(sample_id) as without_sample_id
        FROM sensor_readings_v2
        WHERE phase_name IS NOT NULL
        GROUP BY phase_name
        ORDER BY phase_name
    """)
    for row in cur.fetchall():
        print(f"  {row['phase_name']:15s}  total={row['total']:6d}  "
              f"with_sample_id={row['with_sample_id']:6d}  "
              f"without={row['without_sample_id']:6d}")

    # 2. 查看 sample_phase_transitions 中 WASH 的记录
    print("\n" + "=" * 60)
    print("sample_phase_transitions 中 WASH 相关记录 (最近10条):")
    print("=" * 60)
    cur.execute("""
        SELECT spt.sample_id, spt.phase_name, spt.start_time_ms, spt.end_time_ms,
               s.run_id
        FROM sample_phase_transitions spt
        JOIN samples s ON s.id = spt.sample_id
        WHERE spt.phase_name = 'WASH'
        ORDER BY spt.id DESC
        LIMIT 10
    """)
    for row in cur.fetchall():
        print(f"  sample_id={row['sample_id']}  run_id={row['run_id']}  "
              f"start={row['start_time_ms']}  end={row['end_time_ms']}")

    # 3. 查看一个有 WASH 的样本的完整 phase 转换
    print("\n" + "=" * 60)
    print("某个样本的完整 phase 转换:")
    print("=" * 60)
    cur.execute("""
        SELECT spt.sample_id, spt.phase_name, spt.start_time_ms, spt.end_time_ms, spt.phase_order
        FROM sample_phase_transitions spt
        WHERE spt.sample_id = (
            SELECT sample_id FROM sample_phase_transitions 
            WHERE phase_name = 'WASH' 
            ORDER BY id DESC LIMIT 1
        )
        ORDER BY spt.phase_order
    """)
    for row in cur.fetchall():
        print(f"  order={row['phase_order']}  phase={row['phase_name']:15s}  "
              f"start={row['start_time_ms']}  end={row['end_time_ms']}")

    # 4. 对比: WASH 时间段内的 sensor_readings_v2 是否有数据
    print("\n" + "=" * 60)
    print("WASH 时间段内的 sensor_readings_v2 数据 (最近一条 WASH 转换):")
    print("=" * 60)
    cur.execute("""
        SELECT spt.sample_id, spt.start_time_ms, spt.end_time_ms, s.run_id
        FROM sample_phase_transitions spt
        JOIN samples s ON s.id = spt.sample_id
        WHERE spt.phase_name = 'WASH'
        ORDER BY spt.id DESC LIMIT 1
    """)
    wash = cur.fetchone()
    if wash:
        print(f"  WASH phase: sample_id={wash['sample_id']}, run_id={wash['run_id']}, "
              f"time=[{wash['start_time_ms']}, {wash['end_time_ms']}]")
        
        cur.execute("""
            SELECT COUNT(*) as cnt, 
                   COUNT(sample_id) as with_sid,
                   COUNT(DISTINCT phase_name) as phases,
                   array_agg(DISTINCT phase_name) as phase_names
            FROM sensor_readings_v2
            WHERE run_id = %s 
              AND time_ms >= %s AND time_ms <= %s
        """, [wash['run_id'], wash['start_time_ms'], wash['end_time_ms']])
        result = cur.fetchone()
        print(f"  sensor data in range: count={result['cnt']}, "
              f"with_sample_id={result['with_sid']}, "
              f"phases={result['phase_names']}")

conn.close()
print("\nDone.")
