"""将 config/heater_profiles/all.json 中的 17 个加热配置导入数据库 heater_profiles 表"""

import json
import os
import psycopg2
import psycopg2.extras

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

# all.json 路径
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ALL_JSON = os.path.join(SCRIPT_DIR, "..", "config", "heater_profiles", "all.json")

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

# ================================================================
# 1. 查看表结构和现有数据
# ================================================================
print("=" * 80)
print("1. heater_profiles 表结构")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'heater_profiles'
        ORDER BY ordinal_position
    """)
    for row in cur.fetchall():
        print(f"  {row['column_name']:25s} {row['data_type']:20s} null={row['is_nullable']:3s} default={row['column_default']}")

print()
print("=" * 80)
print("2. 现有加热配置")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("SELECT id, name, description, temps, durs, is_builtin FROM heater_profiles ORDER BY id")
    existing = cur.fetchall()
    existing_names = {row['name'] for row in existing}
    
    if not existing:
        print("  (空表)")
    for row in existing:
        temps = row['temps']
        durs = row['durs']
        print(f"  id={row['id']:3d} name={row['name']:25s} builtin={row['is_builtin']} "
              f"steps={len(temps)} temps={temps[:3]}... durs={durs[:3]}...")

# ================================================================
# 3. 读取 all.json
# ================================================================
print()
print("=" * 80)
print("3. 读取 all.json")
print("=" * 80)

with open(ALL_JSON, "r", encoding="utf-8") as f:
    profiles = json.load(f)

print(f"  共 {len(profiles)} 个加热配置")

# ================================================================
# 4. 插入新配置
# ================================================================
print()
print("=" * 80)
print("4. 插入加热配置")
print("=" * 80)

inserted = 0
skipped = 0

with conn.cursor() as cur:
    for p in profiles:
        name = p["id"]  # e.g. "heater_1", "heater_322"
        description = p.get("description", "")
        ttv = p["temperatureTimeVectors"]
        
        temps = [step[0] for step in ttv]
        durs = [step[1] for step in ttv]
        
        if name in existing_names:
            print(f"  SKIP  {name:20s} (已存在)")
            skipped += 1
            continue
        
        # 恒温配置用 cycles 预热，变温配置也用 cycles（稳态检测在实验编排中单独配置）
        preheat_mode = "cycles"
        preheat_cycles = 3
        preheat_duration_s = None
        
        cur.execute("""
            INSERT INTO heater_profiles 
                (name, description, temps, durs, preheat_mode, preheat_cycles, preheat_duration_s, is_builtin)
            VALUES 
                (%s, %s, %s::SMALLINT[], %s::SMALLINT[], %s, %s, %s, TRUE)
            ON CONFLICT (name) DO NOTHING
            RETURNING id
        """, (name, description, temps, durs, preheat_mode, preheat_cycles, preheat_duration_s))
        
        result = cur.fetchone()
        if result:
            print(f"  INSERT {name:20s} id={result['id']} temps={temps[:3]}... durs={durs[:3]}...")
            inserted += 1
        else:
            print(f"  SKIP  {name:20s} (ON CONFLICT)")
            skipped += 1

conn.commit()

print()
print(f"完成: 插入 {inserted} 条, 跳过 {skipped} 条")

# ================================================================
# 5. 验证: 查看插入后的数据
# ================================================================
print()
print("=" * 80)
print("5. 插入后验证")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("SELECT id, name, description, temps, durs, is_builtin FROM heater_profiles ORDER BY id")
    for row in cur.fetchall():
        temps = row['temps']
        durs = row['durs']
        desc = (row['description'] or "")[:50]
        print(f"  id={row['id']:3d} name={row['name']:25s} builtin={row['is_builtin']} "
              f"steps={len(temps)} | {desc}")

conn.close()
print("\n数据库连接已关闭。")
