"""一次性脚本：排查真实数据 vs 假数据在导出/训练数据分割时的区别"""

import psycopg2
import psycopg2.extras

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

# 真实数据 sample IDs (from screenshots: S#607-612)
real_ids = [607, 608, 609, 610, 611, 612]
# 假数据 sample IDs (from screenshots: S#499-502)
fake_ids = [499, 500, 501, 502]
all_ids = real_ids + fake_ids

print("=" * 80)
print("1. 样本基本信息对比")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, run_id, sample_idx, phase_name, params_hash,
               liquid_names, liquid_ratios, gas_pump_pwm,
               start_time_ms, end_time_ms,
               avg_temperature_c, avg_humidity_pct
        FROM samples
        WHERE id = ANY(%s)
        ORDER BY id
    """, [all_ids])
    rows = cur.fetchall()
    for r in rows:
        tag = "REAL" if r["id"] in real_ids else "FAKE"
        print(f"  [{tag}] S#{r['id']} Run#{r['run_id']} idx={r['sample_idx']} "
              f"phase={r['phase_name']} hash={r['params_hash'][:8] if r['params_hash'] else 'None'} "
              f"liquids={r['liquid_names']} ratios={r['liquid_ratios']} "
              f"start={r['start_time_ms']} end={r['end_time_ms']}")

print()
print("=" * 80)
print("2. ML 标签对比 (sample_ml_labels)")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT sml.sample_id, sml.config_id, mlc.name as config_name,
               mlc.label_type, mlc.strategy,
               sml.label_str, sml.label_num, sml.label_index
        FROM sample_ml_labels sml
        JOIN ml_label_configs mlc ON sml.config_id = mlc.id
        WHERE sml.sample_id = ANY(%s)
        ORDER BY sml.sample_id, mlc.name
    """, [all_ids])
    rows = cur.fetchall()

    real_labels = [r for r in rows if r["sample_id"] in real_ids]
    fake_labels = [r for r in rows if r["sample_id"] in fake_ids]

    print(f"  真实数据标签数: {len(real_labels)}")
    for r in real_labels:
        print(f"    S#{r['sample_id']} config={r['config_name']} "
              f"type={r['label_type']} str={r['label_str']} "
              f"num={r['label_num']} idx={r['label_index']}")

    print(f"  假数据标签数: {len(fake_labels)}")
    for r in fake_labels:
        print(f"    S#{r['sample_id']} config={r['config_name']} "
              f"type={r['label_type']} str={r['label_str']} "
              f"num={r['label_num']} idx={r['label_index']}")

print()
print("=" * 80)
print("3. 传感器数据量对比 (sensor_readings_v2)")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT sample_id, COUNT(*) as reading_count,
               MIN(time_ms) as min_time, MAX(time_ms) as max_time,
               COUNT(DISTINCT sensor_idx) as sensor_count
        FROM sensor_readings_v2
        WHERE sample_id = ANY(%s)
        GROUP BY sample_id
        ORDER BY sample_id
    """, [all_ids])
    rows = cur.fetchall()

    for r in rows:
        tag = "REAL" if r["sample_id"] in real_ids else "FAKE"
        duration_s = (r["max_time"] - r["min_time"]) / 1000.0 if r["min_time"] and r["max_time"] else 0
        print(f"  [{tag}] S#{r['sample_id']}: {r['reading_count']} readings, "
              f"{r['sensor_count']} sensors, duration={duration_s:.1f}s")

    # 检查没有数据的 sample
    found_ids = {r["sample_id"] for r in rows}
    missing = set(all_ids) - found_ids
    if missing:
        print(f"  ⚠️ 没有传感器数据的样本: {sorted(missing)}")

print()
print("=" * 80)
print("4. 归一化帧缓存对比 (检查 Redis keys)")
print("=" * 80)

try:
    import redis
    r = redis.Redis(host="192.168.1.235", port=6379, db=0)
    for sid in all_ids:
        tag = "REAL" if sid in real_ids else "FAKE"
        # 搜索所有与此 sample_id 相关的 frame keys
        keys = r.keys(f"*sample:{sid}*") + r.keys(f"*frame*{sid}*")
        if keys:
            print(f"  [{tag}] S#{sid}: {len(keys)} frame keys found")
            for k in keys[:3]:
                print(f"    key: {k.decode()}")
        else:
            print(f"  [{tag}] S#{sid}: ❌ 无帧缓存")
except Exception as e:
    print(f"  ⚠️ Redis 连接失败: {e}")

print()
print("=" * 80)
print("5. ML 标签配置列表")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, name, label_type, strategy, is_active,
               (SELECT COUNT(*) FROM sample_ml_labels WHERE config_id = mlc.id) as label_count
        FROM ml_label_configs mlc
        ORDER BY id
    """)
    rows = cur.fetchall()
    for r in rows:
        print(f"  #{r['id']} {r['name']} type={r['label_type']} strategy={r['strategy']} "
              f"active={r['is_active']} labels={r['label_count']}")

conn.close()
print("\n✅ 排查完成")
