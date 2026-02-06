#!/usr/bin/env python3
"""
一次性脚本：查询数据库中的泵绑定情况
用于调试后端验证器的泵绑定检测逻辑
"""

import psycopg2
from psycopg2.extras import RealDictCursor

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

def main():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    print("=" * 60)
    print("1. 样品泵绑定 (pump_assignments)")
    print("=" * 60)
    cur.execute("""
        SELECT pump_index, liquid_id, notes, 
               COALESCE(initial_volume_ml, 0) as initial_ml,
               COALESCE(consumed_volume_ml, 0) as consumed_ml,
               updated_at
        FROM pump_assignments
        ORDER BY pump_index
    """)
    rows = cur.fetchall()
    if rows:
        for row in rows:
            print(f"  泵 {row['pump_index']}: 液体ID={row['liquid_id']}, "
                  f"初始={row['initial_ml']}ml, 已消耗={row['consumed_ml']}ml, "
                  f"备注={row['notes']}")
    else:
        print("  (无数据)")
    
    print()
    print("=" * 60)
    print("2. 清洗泵绑定 (wash_pump_assignments)")
    print("=" * 60)
    cur.execute("""
        SELECT pump_index, liquid_id, notes,
               COALESCE(initial_volume_ml, 0) as initial_ml,
               COALESCE(consumed_volume_ml, 0) as consumed_ml,
               updated_at
        FROM wash_pump_assignments
        ORDER BY pump_index
    """)
    rows = cur.fetchall()
    if rows:
        for row in rows:
            print(f"  清洗泵 {row['pump_index']}: 液体ID={row['liquid_id']}, "
                  f"初始={row['initial_ml']}ml, 已消耗={row['consumed_ml']}ml, "
                  f"备注={row['notes']}")
    else:
        print("  (无数据)")
    
    print()
    print("=" * 60)
    print("3. 液体库存 (liquids)")
    print("=" * 60)
    cur.execute("""
        SELECT id, name, type, density_g_ml, is_active
        FROM liquids
        WHERE id IN (6, 31, 37)
        ORDER BY id
    """)
    rows = cur.fetchall()
    if rows:
        for row in rows:
            print(f"  液体 {row['id']}: 名称={row['name']}, 类型={row['type']}, "
                  f"密度={row['density_g_ml']}, 活跃={row['is_active']}")
    else:
        print("  (无数据)")
    
    print()
    print("=" * 60)
    print("4. 检查液体6的绑定情况")
    print("=" * 60)
    
    # 检查样品泵
    cur.execute("SELECT * FROM pump_assignments WHERE liquid_id = 6")
    sample_pump = cur.fetchone()
    if sample_pump:
        print(f"  ✅ 液体6 绑定到样品泵 {sample_pump['pump_index']}")
    else:
        print("  ❌ 液体6 未绑定到任何样品泵")
    
    # 检查清洗泵
    cur.execute("SELECT * FROM wash_pump_assignments WHERE liquid_id = 6")
    wash_pump = cur.fetchone()
    if wash_pump:
        print(f"  ⚠️ 液体6 也绑定到清洗泵 {wash_pump['pump_index']}")
    else:
        print("  ✅ 液体6 未绑定到清洗泵")
    
    print()
    print("=" * 60)
    print("5. 检查液体31的绑定情况")
    print("=" * 60)
    
    cur.execute("SELECT * FROM pump_assignments WHERE liquid_id = 31")
    sample_pump = cur.fetchone()
    if sample_pump:
        print(f"  ✅ 液体31 绑定到样品泵 {sample_pump['pump_index']}")
    else:
        print("  ❌ 液体31 未绑定到任何样品泵")
    
    cur.execute("SELECT * FROM wash_pump_assignments WHERE liquid_id = 31")
    wash_pump = cur.fetchone()
    if wash_pump:
        print(f"  ⚠️ 液体31 也绑定到清洗泵 {wash_pump['pump_index']}")
    else:
        print("  ✅ 液体31 未绑定到清洗泵")
    
    print()
    print("=" * 60)
    print("6. 检查液体37的绑定情况 (清洗液)")
    print("=" * 60)
    
    cur.execute("SELECT * FROM pump_assignments WHERE liquid_id = 37")
    sample_pump = cur.fetchone()
    if sample_pump:
        print(f"  ⚠️ 液体37 绑定到样品泵 {sample_pump['pump_index']}")
    else:
        print("  ✅ 液体37 未绑定到样品泵")
    
    cur.execute("SELECT * FROM wash_pump_assignments WHERE liquid_id = 37")
    wash_pump = cur.fetchone()
    if wash_pump:
        print(f"  ✅ 液体37 绑定到清洗泵 {wash_pump['pump_index']}")
    else:
        print("  ❌ 液体37 未绑定到任何清洗泵")
    
    cur.close()
    conn.close()
    
    print()
    print("=" * 60)
    print("诊断完成")
    print("=" * 60)

if __name__ == "__main__":
    main()
