"""验证脚本：检查规约后的液体配方数据是否正确"""

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

# ================================================================
# 1. 检查已修复的样本
# ================================================================
print("=" * 80)
print("1. 检查已修复的样本 (S#688,689,698,699,701,702,703)")
print("=" * 80)

fixed_ids = [688, 689, 698, 699, 701, 702, 703]
all_ok = True

for sid in fixed_ids:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, liquid_ids, liquid_names, liquid_ratios, liquid_is_solvent
            FROM samples WHERE id = %s
        """, [sid])
        s = cur.fetchone()

    if not s:
        print(f"  ❌ S#{sid} 不存在!")
        all_ok = False
        continue

    names = s["liquid_names"] or []
    ratios = [float(r) for r in (s["liquid_ratios"] or [])]
    n = len(names)
    total = sum(ratios)

    # 检查：不应有占比 < 1% 的成分
    bad = []
    for i, r in enumerate(ratios):
        if total > 0 and r / total < 0.01:
            bad.append(f"{names[i]}({r/total*100:.2f}%)")

    if bad:
        print(f"  ❌ S#{sid}: 仍有低比例成分: {bad}")
        all_ok = False
    else:
        pcts = [f"{r/total*100:.1f}%" if total > 0 else "?" for r in ratios]
        label = ", ".join(f"{names[i]}({pcts[i]})" for i in range(n))
        pure = " [纯净物]" if n == 1 else ""
        print(f"  ✅ S#{sid}: {n}成分{pure} → {label}")

# ================================================================
# 2. 全局扫描：确保没有遗漏
# ================================================================
print("\n" + "=" * 80)
print("2. 全局扫描：检查是否还有占比 < 1% 的成分")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, liquid_names, liquid_ratios
        FROM samples
        WHERE liquid_ratios IS NOT NULL
          AND array_length(liquid_ratios, 1) > 1
        ORDER BY id
    """)
    multi = cur.fetchall()

remaining_bad = []
for s in multi:
    ratios = [float(r) for r in (s["liquid_ratios"] or [])]
    total = sum(ratios)
    if total <= 0:
        continue
    for i, r in enumerate(ratios):
        if r / total < 0.01:
            remaining_bad.append(s["id"])
            break

if remaining_bad:
    print(f"  ⚠️ 仍有 {len(remaining_bad)} 个样本含低比例成分: {remaining_bad}")
    all_ok = False
else:
    print(f"  ✅ 所有 {len(multi)} 个多成分样本均正常")

# ================================================================
# 3. 检查 ML 标签是否已清理
# ================================================================
print("\n" + "=" * 80)
print("3. 检查已修复样本的 ML 标签是否已清理")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute(
        "SELECT sample_id, config_id, label_str FROM sample_ml_labels WHERE sample_id = ANY(%s)",
        [fixed_ids],
    )
    labels = cur.fetchall()

if labels:
    print(f"  ⚠️ 还有 {len(labels)} 条旧标签未清理:")
    for l in labels:
        print(f"    S#{l['sample_id']} config={l['config_id']} label={l['label_str']}")
    all_ok = False
else:
    print(f"  ✅ 已修复样本的 ML 标签已全部清理")

# ================================================================
# 4. 统计总览
# ================================================================
print("\n" + "=" * 80)
print("4. 数据库液体配方统计")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT 
            array_length(liquid_ratios, 1) as comp_count,
            count(*) as sample_count
        FROM samples
        WHERE liquid_ratios IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """)
    stats = cur.fetchall()

for row in stats:
    n = row["comp_count"]
    c = row["sample_count"]
    label = "纯净物" if n == 1 else f"{n}元混合"
    print(f"  {label}: {c} 个样本")

conn.close()

print("\n" + "=" * 80)
if all_ok:
    print("✅ 全部验证通过!")
else:
    print("❌ 存在问题，请检查上述输出")
print("=" * 80)
