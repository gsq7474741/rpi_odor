"""修复脚本：移除样本中 ratio=0 的液体成分

问题：YAML 编译器输出了 ratio=0 的成分，C++ 后端原样存入数据库。
修复：从 liquid_ids, liquid_names, liquid_ratios, pump_indices, liquid_is_solvent
数组中移除 ratio=0 的元素。

用法：
  python scripts/fix_zero_ratio_components.py --dry-run   # 预览
  python scripts/fix_zero_ratio_components.py              # 执行
"""

import sys
import psycopg2
import psycopg2.extras

DRY_RUN = "--dry-run" in sys.argv

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

with conn.cursor() as cur:
    # 查找所有包含 0 ratio 的样本
    cur.execute("""
        SELECT id, run_id, sample_idx,
               liquid_ids, liquid_names, liquid_ratios,
               pump_indices, liquid_is_solvent
        FROM samples
        WHERE 0 = ANY(liquid_ratios)
        ORDER BY id
    """)
    rows = cur.fetchall()

print(f"找到 {len(rows)} 个包含 0% 成分的样本")
print("=" * 80)

fixed_count = 0
for row in rows:
    sid = row["id"]
    ids = row["liquid_ids"] or []
    names = row["liquid_names"] or []
    ratios = row["liquid_ratios"] or []
    pumps = row["pump_indices"] or []
    solvents = row["liquid_is_solvent"] or []

    # 找出非零索引
    keep_idx = [i for i, r in enumerate(ratios) if r != 0]

    if len(keep_idx) == len(ratios):
        continue  # 没有零成分，跳过

    new_ids = [ids[i] for i in keep_idx] if ids else []
    new_names = [names[i] for i in keep_idx] if names else []
    new_ratios = [ratios[i] for i in keep_idx]
    new_pumps = [pumps[i] for i in keep_idx] if pumps else []
    new_solvents = [solvents[i] for i in keep_idx] if solvents else []

    removed = len(ratios) - len(keep_idx)
    print(f"S#{sid} (Run {row['run_id']}, idx={row['sample_idx']}): "
          f"移除 {removed} 个 0% 成分")
    print(f"  前: {list(zip(names, ratios))}")
    print(f"  后: {list(zip(new_names, new_ratios))}")

    if not DRY_RUN:
        with conn.cursor() as cur2:
            cur2.execute("""
                UPDATE samples SET
                    liquid_ids = %s,
                    liquid_names = %s,
                    liquid_ratios = %s,
                    pump_indices = %s,
                    liquid_is_solvent = %s
                WHERE id = %s
            """, (new_ids, new_names, new_ratios, new_pumps, new_solvents, sid))

    fixed_count += 1

print("=" * 80)
print(f"共修复 {fixed_count} 个样本")

if DRY_RUN:
    conn.rollback()
    print("[DRY RUN] 预览完成，未实际修改")
else:
    conn.commit()
    print("✅ 修改已提交")

conn.close()
