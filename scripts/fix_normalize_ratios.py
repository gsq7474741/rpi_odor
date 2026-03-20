"""一次性脚本：规约液体配方，移除占比 < 1% 的虚假低比例成分

背景：前端 YAML 编译器在 one-hot 参数扫描时，由于 JS falsy bug (0 || 1 === 1)，
将 ratio=0 的成分写为 ratio=1，导致数据库中存储了类似 [1,1,100,1,1] 的配方，
实际应为 [100]（纯净物）。

操作：
1. 扫描所有多成分样本
2. 计算每个成分的占比
3. 过滤掉占比 < 1% 的成分（同步更新所有液体相关数组字段）
4. 清理受影响样本的 ML 标签（下次生成时自动重算）

用法：python scripts/fix_normalize_ratios.py [--dry-run]
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

THRESHOLD = 0.01  # 1%

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

# ================================================================
# 1. 扫描需要规约的样本
# ================================================================
print("=" * 80)
print(f"液体配方规约 ({'DRY RUN' if DRY_RUN else 'LIVE'})")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, liquid_ids, liquid_names, liquid_ratios, pump_indices, liquid_is_solvent
        FROM samples
        WHERE liquid_ratios IS NOT NULL
          AND array_length(liquid_ratios, 1) > 1
        ORDER BY id
    """)
    samples = cur.fetchall()

print(f"找到 {len(samples)} 个多成分样本\n")

updated_ids = []
skipped = 0

for s in samples:
    sid = s["id"]
    ids = s["liquid_ids"] or []
    names = s["liquid_names"] or []
    ratios = [float(r) for r in (s["liquid_ratios"] or [])]
    pumps = s["pump_indices"] or []
    solvents = s["liquid_is_solvent"] or []

    total = sum(ratios)
    if total <= 0:
        skipped += 1
        continue

    # 找出有效成分（占比 >= 1%）
    keep = [i for i, r in enumerate(ratios) if r / total >= THRESHOLD]

    if len(keep) == len(ratios):
        skipped += 1
        continue

    # 需要过滤
    removed = [i for i in range(len(ratios)) if i not in keep]
    removed_names = [names[i] if i < len(names) else "?" for i in removed]
    removed_pcts = [f"{ratios[i]/total*100:.2f}%" for i in removed]

    new_ids = [ids[i] for i in keep if i < len(ids)]
    new_names = [names[i] for i in keep if i < len(names)]
    new_ratios = [ratios[i] for i in keep]
    new_pumps = [pumps[i] for i in keep if i < len(pumps)]
    new_solvents = [solvents[i] for i in keep if i < len(solvents)]

    kept_names = [names[i] if i < len(names) else "?" for i in keep]
    kept_pcts = [f"{ratios[i]/total*100:.1f}%" for i in keep]

    print(f"  S#{sid}: {len(ratios)}成分 → {len(keep)}成分")
    print(f"    原始: {list(zip(names, ratios))}")
    print(f"    保留: {list(zip(kept_names, kept_pcts))}")
    print(f"    移除: {list(zip(removed_names, removed_pcts))}")

    if not DRY_RUN:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE samples SET
                    liquid_ids = %s,
                    liquid_names = %s,
                    liquid_ratios = %s,
                    pump_indices = %s,
                    liquid_is_solvent = %s
                WHERE id = %s
            """, [new_ids, new_names, new_ratios, new_pumps, new_solvents, sid])

    updated_ids.append(sid)

# ================================================================
# 2. 清理受影响样本的 ML 标签
# ================================================================
if updated_ids and not DRY_RUN:
    print(f"\n清理 {len(updated_ids)} 个样本的 ML 标签...")
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM sample_ml_labels WHERE sample_id = ANY(%s)",
            [updated_ids],
        )
        deleted = cur.rowcount
        print(f"  删除 {deleted} 条标签记录")

# ================================================================
# 3. 提交
# ================================================================
if DRY_RUN:
    conn.rollback()
    print(f"\n[DRY RUN] 将更新 {len(updated_ids)} 个样本, 跳过 {skipped} 个")
    print("加 --dry-run 以外的方式运行以实际执行")
else:
    conn.commit()
    print(f"\n✅ 已更新 {len(updated_ids)} 个样本, 跳过 {skipped} 个")

conn.close()
