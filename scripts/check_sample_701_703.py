"""诊断脚本：检查样本 #701/#702/#703 的液体配方和比例"""

import psycopg2
import psycopg2.extras
import json

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

# ================================================================
# 1. 检查样本 #701, #702, #703 的液体配方
# ================================================================
print("=" * 80)
print("1. 样本 #701, #702, #703 的液体配方")
print("=" * 80)

for sid in [701, 702, 703]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, run_id, sample_idx, phase_name,
                   liquid_ids, liquid_names, liquid_ratios, liquid_is_solvent,
                   pump_indices, total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
                   params_hash
            FROM samples
            WHERE id = %s
        """, [sid])
        sample = cur.fetchone()

    if not sample:
        print(f"\n  ❌ 样本 S#{sid} 不存在!")
        continue

    print(f"\n  === S#{sid} (run={sample['run_id']}, idx={sample['sample_idx']}, phase={sample['phase_name']}) ===")
    
    liquid_ids = sample.get("liquid_ids") or []
    liquid_names = sample.get("liquid_names") or []
    liquid_ratios = sample.get("liquid_ratios") or []
    liquid_is_solvent = sample.get("liquid_is_solvent") or []
    
    ratio_sum = sum(float(r) for r in liquid_ratios) if liquid_ratios else 0
    
    print(f"  液体数量: {len(liquid_ids)}")
    print(f"  ratio 原始值: {liquid_ratios}")
    print(f"  ratio 总和: {ratio_sum}")
    print(f"  ratio 类型: {[type(r).__name__ for r in liquid_ratios]}")
    print()
    
    for i in range(len(liquid_ids)):
        lid = liquid_ids[i] if i < len(liquid_ids) else "?"
        lname = liquid_names[i] if i < len(liquid_names) else "?"
        lratio = liquid_ratios[i] if i < len(liquid_ratios) else "?"
        lsolvent = liquid_is_solvent[i] if i < len(liquid_is_solvent) else "?"
        
        # 计算百分比（前端逻辑）
        if ratio_sum > 0:
            pct = float(lratio) / ratio_sum * 100
            pct_str = f"{pct:.2f}% → toFixed(0)={pct:.0f}%"
        else:
            pct_str = "N/A"
        
        print(f"  [{i}] id={str(lid):>5s}  name={str(lname):25s}  ratio={str(lratio):>10s}  "
              f"is_solvent={lsolvent}  → 显示: {pct_str}")
    
    # 检查是否有 0 ratio
    zero_count = sum(1 for r in liquid_ratios if float(r) == 0)
    nonzero_count = sum(1 for r in liquid_ratios if float(r) > 0)
    print(f"\n  0值成分数: {zero_count}, 非0成分数: {nonzero_count}")
    
    if nonzero_count == 1:
        dominant = next(liquid_names[i] for i, r in enumerate(liquid_ratios) if float(r) > 0)
        print(f"  → 实际上是纯净物: {dominant}")

# ================================================================
# 2. 查看同一 run 的所有样本的 ratio 模式
# ================================================================
print()
print("=" * 80)
print("2. 查看 run 76 的所有样本 ratio 模式")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, sample_idx, phase_name, liquid_ids, liquid_names, liquid_ratios
        FROM samples
        WHERE run_id = 76
        ORDER BY sample_idx
    """)
    run_samples = cur.fetchall()

for s in run_samples:
    ratios = s['liquid_ratios'] or []
    names = s['liquid_names'] or []
    ratio_str = ", ".join(f"{float(r):.1f}" for r in ratios)
    name_str = ", ".join(str(n) for n in names)
    
    # 计算百分比
    ratio_sum = sum(float(r) for r in ratios) if ratios else 0
    if ratio_sum > 0:
        pcts = [f"{float(r)/ratio_sum*100:.0f}%" for r in ratios]
    else:
        pcts = ["N/A" for _ in ratios]
    pct_str = ", ".join(pcts)
    
    zero_count = sum(1 for r in ratios if float(r) == 0)
    
    print(f"  S#{s['id']:>4d}  idx={s['sample_idx']}  phase={s['phase_name']:10s}  "
          f"ratios=[{ratio_str}]  → pcts=[{pct_str}]  zeros={zero_count}")

conn.close()
print()
print("=" * 80)
print("✅ 诊断完成")
print("=" * 80)
