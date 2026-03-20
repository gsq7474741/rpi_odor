"""诊断脚本：检查样本 S#637 的原始数据和标签生成情况"""

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
# 1. 样本原始数据
# ================================================================
print("=" * 80)
print("1. 样本 S#637 原始数据")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, run_id, sample_idx, phase_name,
               liquid_ids, liquid_names, liquid_ratios, liquid_is_solvent,
               pump_indices, total_volume_ml, flow_rate_ml_s, gas_pump_pwm,
               params_hash, params_json, created_at
        FROM samples
        WHERE id = 637
    """)
    sample = cur.fetchone()

if not sample:
    print("  ❌ 样本 S#637 不存在!")
    conn.close()
    exit()

for k, v in sample.items():
    print(f"  {k:25s} = {v}")

# ================================================================
# 2. 液体详情（逐个解析）
# ================================================================
print()
print("=" * 80)
print("2. 液体组成详情")
print("=" * 80)

liquid_ids = sample.get("liquid_ids") or []
liquid_names = sample.get("liquid_names") or []
liquid_ratios = sample.get("liquid_ratios") or []
liquid_is_solvent = sample.get("liquid_is_solvent") or []

for i in range(len(liquid_ids)):
    lid = liquid_ids[i] if i < len(liquid_ids) else "?"
    lname = liquid_names[i] if i < len(liquid_names) else "?"
    lratio = liquid_ratios[i] if i < len(liquid_ratios) else "?"
    lsolvent = liquid_is_solvent[i] if i < len(liquid_is_solvent) else "?"
    print(f"  [{i}] id={lid:>5s}  name={lname:15s}  ratio={lratio!r:>10s}  is_solvent={lsolvent}")

print()
print(f"  ratio 总和 = {sum(float(r) for r in liquid_ratios)}")
print(f"  ratio 类型 = {[type(r).__name__ for r in liquid_ratios]}")

# ================================================================
# 3. 同一 run 的所有样本
# ================================================================
print()
print("=" * 80)
print(f"3. Run #{sample['run_id']} 的所有样本")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, sample_idx, phase_name, liquid_ids, liquid_names, liquid_ratios,
               liquid_is_solvent, total_volume_ml
        FROM samples
        WHERE run_id = %s
        ORDER BY sample_idx
    """, [sample['run_id']])
    run_samples = cur.fetchall()

for s in run_samples:
    ratios_str = ", ".join(f"{r}" for r in (s['liquid_ratios'] or []))
    names_str = ", ".join(s['liquid_names'] or [])
    solvent_str = ", ".join(str(x) for x in (s['liquid_is_solvent'] or []))
    print(f"  S#{s['id']:>4d}  idx={s['sample_idx']}  phase={s['phase_name']:10s}  "
          f"liquids=[{names_str}]  ratios=[{ratios_str}]  solvent=[{solvent_str}]  "
          f"vol={s['total_volume_ml']}")

# ================================================================
# 4. 已生成的标签
# ================================================================
print()
print("=" * 80)
print("4. S#637 的已生成标签")
print("=" * 80)

with conn.cursor() as cur:
    cur.execute("""
        SELECT sml.id, mlc.name AS config_name, mlc.label_type,
               sml.label_str, sml.label_num, sml.label_json, sml.label_index
        FROM sample_ml_labels sml
        JOIN ml_label_configs mlc ON sml.config_id = mlc.id
        WHERE sml.sample_id = 637
        ORDER BY mlc.id
    """)
    labels = cur.fetchall()

for l in labels:
    json_str = json.dumps(l['label_json'], ensure_ascii=False) if l['label_json'] else "null"
    print(f"  [{l['config_name']:20s}] type={l['label_type']:16s}  "
          f"str={l['label_str']!r:30s}  num={l['label_num']}  "
          f"idx={l['label_index']}  json={json_str}")

# ================================================================
# 5. 对比：YAML 中的配方 vs DB 中存储的比例
# ================================================================
print()
print("=" * 80)
print("5. 分析 ratio 问题")
print("=" * 80)

if liquid_ratios:
    total = sum(float(r) for r in liquid_ratios)
    print(f"  原始 ratios: {liquid_ratios}")
    print(f"  总和: {total}")
    if total > 10:
        print(f"  → 看起来是百分比 (如 20:80)")
        print(f"  → 归一化后: {[float(r)/total for r in liquid_ratios]}")
    elif total <= 1.01:
        print(f"  → 看起来是小数比例 (如 0.2:0.8)")
    else:
        print(f"  → 不确定格式")
    
    # 检查浓度标签生成逻辑
    print()
    print("  浓度标签生成模拟:")
    conc = {}
    for i, lid in enumerate(liquid_ids):
        name = liquid_names[i] if i < len(liquid_names) else "?"
        ratio = float(liquid_ratios[i]) if i < len(liquid_ratios) else 0.0
        conc[name] = ratio
    label_str = "|".join(f"{k}:{v:.0f}" for k, v in sorted(conc.items()))
    print(f"  → label_str = '{label_str}'")
    print(f"  → label_json = {json.dumps(conc, ensure_ascii=False)}")

# ================================================================
# 6. 检查实验程序 YAML 中的 ratio 定义
# ================================================================
print()
print("=" * 80)
print("6. 检查 C++ 后端写入 DB 时的 ratio 来源")
print("=" * 80)
print("  ratio 来自 YAML inject.components[].ratio")
print("  tea_test.yaml 中使用比例扫描时 ratio 值范围是 20:80 等百分比")
print("  heater_test.yaml 中使用固定比例时 ratio 值是 0.2:0.8 等小数")
print()
print("  问题: 格式不统一 → 浓度标签生成使用 :.0f 格式化")
print("  如果 ratio=0.8 → 格式化为 '自来水:1' (四舍五入) ← 这就是 bug!")
print()
print("  修复建议: _label_concentration 中应使用更合适的格式化方式")

conn.close()
print()
print("=" * 80)
print("✅ 诊断完成")
print("=" * 80)
