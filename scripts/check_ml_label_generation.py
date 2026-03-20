"""诊断脚本：检查 ML 标签生成策略对所有样本的覆盖情况，
分析缺失原因并验证生成逻辑是否正确。"""

import psycopg2
import psycopg2.extras
from collections import defaultdict

DB_CONFIG = {
    "host": "192.168.1.235",
    "port": 5432,
    "database": "enose",
    "user": "enose",
    "password": "enose_secure_password_change_me",
}

conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)

# ================================================================
# 1. 标签策略配置总览
# ================================================================
print("=" * 90)
print("1. ML 标签策略配置总览")
print("=" * 90)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, name, label_type, strategy, config, is_active,
               (SELECT COUNT(*) FROM sample_ml_labels WHERE config_id = mlc.id) AS label_count
        FROM ml_label_configs mlc
        ORDER BY id
    """)
    configs = cur.fetchall()

    cur.execute("SELECT COUNT(*) AS total FROM samples")
    total_samples = cur.fetchone()["total"]

for c in configs:
    coverage = f"{c['label_count']}/{total_samples}"
    gap = total_samples - c['label_count']
    status = "✅" if gap == 0 else f"❌ 缺 {gap}"
    config_str = str(c['config']) if c['config'] != {} else "(无额外配置)"
    print(f"  [{c['id']}] {c['name']:20s} {c['label_type']:16s} "
          f"active={c['is_active']}  覆盖={coverage:>8s}  {status}")
    print(f"       config={config_str}")

# ================================================================
# 2. 每个策略缺失的样本列表
# ================================================================
print()
print("=" * 90)
print("2. 每个策略缺失标签的样本")
print("=" * 90)

with conn.cursor() as cur:
    cur.execute("""
        SELECT mlc.name AS config_name, mlc.label_type,
               array_agg(s.id ORDER BY s.id) AS missing_ids,
               COUNT(*) AS missing_count
        FROM samples s
        CROSS JOIN ml_label_configs mlc
        LEFT JOIN sample_ml_labels sml ON s.id = sml.sample_id AND mlc.id = sml.config_id
        WHERE sml.id IS NULL
        GROUP BY mlc.name, mlc.label_type
        ORDER BY mlc.name
    """)
    missing_info = cur.fetchall()

for m in missing_info:
    ids = m["missing_ids"]
    # 压缩连续 ID 为范围
    ranges = []
    start = ids[0]
    end = ids[0]
    for i in ids[1:]:
        if i == end + 1:
            end = i
        else:
            ranges.append(f"{start}-{end}" if start != end else str(start))
            start = end = i
    ranges.append(f"{start}-{end}" if start != end else str(start))

    print(f"  {m['config_name']:20s} ({m['label_type']:16s}) "
          f"缺 {m['missing_count']:>3d} 个: [{', '.join(ranges)}]")

# ================================================================
# 3. 缺失样本的源字段诊断
# ================================================================
print()
print("=" * 90)
print("3. 缺失样本的源数据诊断 (检查字段是否有值)")
print("=" * 90)

# 收集所有缺失的样本 ID
all_missing_ids = set()
for m in missing_info:
    all_missing_ids.update(m["missing_ids"])

if all_missing_ids:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, run_id, sample_idx, phase_name,
                   liquid_ids, liquid_names, liquid_ratios,
                   total_volume_ml, gas_pump_pwm, params_hash,
                   avg_temperature_c, avg_humidity_pct
            FROM samples
            WHERE id = ANY(%s)
            ORDER BY id
        """, [sorted(all_missing_ids)])
        missing_samples = cur.fetchall()

    # 按策略分析缺失原因
    missing_by_config = {}
    for m in missing_info:
        missing_by_config[m["config_name"]] = set(m["missing_ids"])

    # 每个策略需要的字段
    field_requirements = {
        "liquid_identity": ("liquid_ids", "液体ID列表"),
        "primary_liquid": ("liquid_ids", "液体ID列表"),
        "mixture_formula": ("liquid_ids", "液体ID列表"),
        "concentration": ("liquid_ids", "液体ID列表 + config.target_liquid_id"),
        "total_volume": ("total_volume_ml", "进样量"),
        "gas_pump_speed": ("gas_pump_pwm", "气泵PWM"),
        "params_group": ("params_hash", "参数哈希"),
        "env_temperature": ("avg_temperature_c", "平均温度"),
    }

    for config_name, missing_set in sorted(missing_by_config.items()):
        field_key, field_desc = field_requirements.get(config_name, ("?", "?"))
        print(f"\n  --- {config_name} (需要: {field_desc}) ---")

        for s in missing_samples:
            if s["id"] not in missing_set:
                continue

            # 检查该策略所需的字段
            if config_name in ("liquid_identity", "primary_liquid", "mixture_formula"):
                has_data = bool(s["liquid_ids"])
                val = f"liquids={s['liquid_names']}" if has_data else "liquids=NULL"
            elif config_name == "concentration":
                has_data = bool(s["liquid_ids"])
                val = f"liquids={s['liquid_names']} (但 config.target_liquid_id=null)"
            elif config_name == "total_volume":
                has_data = s["total_volume_ml"] is not None
                val = f"total_volume_ml={s['total_volume_ml']}"
            elif config_name == "gas_pump_speed":
                has_data = s["gas_pump_pwm"] is not None
                val = f"gas_pump_pwm={s['gas_pump_pwm']}"
            elif config_name == "params_group":
                has_data = bool(s["params_hash"])
                val = f"params_hash={s['params_hash'][:8] if s['params_hash'] else 'NULL'}"
            elif config_name == "env_temperature":
                has_data = s["avg_temperature_c"] is not None
                val = f"avg_temperature_c={s['avg_temperature_c']}"
            else:
                has_data = False
                val = "?"

            reason = "数据有值→应能生成(可能是未执行生成)" if has_data else "数据缺失→生成逻辑返回None"
            icon = "⚠️" if has_data else "❌"
            print(f"    {icon} S#{s['id']:>4d} run={s['run_id']} {val:40s} → {reason}")

# ================================================================
# 4. 模拟生成逻辑验证 (本地计算)
# ================================================================
print()
print("=" * 90)
print("4. 模拟标签生成逻辑验证 (本地 Python 模拟)")
print("=" * 90)

with conn.cursor() as cur:
    cur.execute("""
        SELECT id, liquid_ids, liquid_names, liquid_ratios,
               total_volume_ml, gas_pump_pwm, params_hash, avg_temperature_c
        FROM samples
        ORDER BY id
    """)
    all_samples = cur.fetchall()

    cur.execute("SELECT id, name, label_type, config FROM ml_label_configs ORDER BY id")
    all_configs = cur.fetchall()

def simulate_compute_label(sample, config):
    """模拟 label_generator.py 的 _compute_label 逻辑"""
    name = config["name"]
    # 构造 liquids 列表 (模拟 _row_to_sample)
    liquids = []
    if sample.get("liquid_ids"):
        for i, lid in enumerate(sample["liquid_ids"]):
            liquids.append({
                "id": lid,
                "name": sample["liquid_names"][i] if sample.get("liquid_names") else "",
                "ratio": sample["liquid_ratios"][i] if sample.get("liquid_ratios") else 0,
            })

    if name == "liquid_identity":
        if not liquids:
            return {"label_str": "unknown"}
        if len(liquids) == 1:
            return {"label_str": liquids[0]["name"]}
        parts = sorted(liquids, key=lambda l: -(l.get("ratio", 0)))
        return {"label_str": " + ".join(l["name"] for l in parts)}

    elif name == "primary_liquid":
        if not liquids:
            return {"label_str": "unknown"}
        primary = max(liquids, key=lambda l: l.get("ratio", 0))
        return {"label_str": primary["name"]}

    elif name == "mixture_formula":
        if not liquids:
            return {"label_str": "empty"}
        parts = sorted(liquids, key=lambda l: l.get("id", ""))
        formula = "|".join(f'{l["id"]}:{l["ratio"]:.4f}' for l in parts)
        return {"label_str": formula}

    elif name == "concentration":
        cfg = config.get("config", {}) or {}
        target_id = cfg.get("target_liquid_id")
        if not target_id:
            return None  # ← 这是为什么 concentration 全部缺失
        target_id = str(target_id)
        for liq in liquids:
            if str(liq.get("id", "")) == target_id:
                return {"label_num": liq.get("ratio", 0.0)}
        return {"label_num": 0.0}

    elif name == "total_volume":
        return {"label_num": sample.get("total_volume_ml", 0)}

    elif name == "gas_pump_speed":
        pwm = sample.get("gas_pump_pwm", 0)
        return {"label_num": pwm / 100.0 if pwm else 0.0}

    elif name == "params_group":
        return {"label_str": sample.get("params_hash", "")}

    elif name == "env_temperature":
        temp = sample.get("avg_temperature_c")
        return {"label_num": temp} if temp is not None else None

    return None

# 统计模拟结果
can_generate = defaultdict(int)  # config_name → 能生成的数量
cannot_generate = defaultdict(list)  # config_name → 不能生成的 sample_ids

for s in all_samples:
    for c in all_configs:
        result = simulate_compute_label(s, c)
        if result is not None:
            can_generate[c["name"]] += 1
        else:
            cannot_generate[c["name"]].append(s["id"])

for c in all_configs:
    name = c["name"]
    gen = can_generate[name]
    no_gen = cannot_generate[name]
    icon = "✅" if not no_gen else "⚠️"
    print(f"  {icon} {name:20s}: 可生成 {gen}/{total_samples}", end="")
    if no_gen:
        ids_str = ", ".join(str(x) for x in no_gen[:10])
        if len(no_gen) > 10:
            ids_str += f" ...共{len(no_gen)}个"
        print(f"  | 无法生成: [{ids_str}]", end="")
    print()

# ================================================================
# 5. 实际 vs 理论对比 → 找出"应能生成但没有生成"的缺口
# ================================================================
print()
print("=" * 90)
print("5. 实际 vs 理论对比 → 找出 '应能生成但未生成' 的样本")
print("=" * 90)

# 获取实际已生成的标签
with conn.cursor() as cur:
    cur.execute("""
        SELECT sml.sample_id, mlc.name AS config_name
        FROM sample_ml_labels sml
        JOIN ml_label_configs mlc ON sml.config_id = mlc.id
    """)
    actual_labels = cur.fetchall()

actual_set = set()
for r in actual_labels:
    actual_set.add((r["sample_id"], r["config_name"]))

should_exist_but_missing = defaultdict(list)
for s in all_samples:
    for c in all_configs:
        result = simulate_compute_label(s, c)
        key = (s["id"], c["name"])
        if result is not None and key not in actual_set:
            should_exist_but_missing[c["name"]].append(s["id"])

if not should_exist_but_missing:
    print("  ✅ 所有理论上能生成的标签都已存在！")
else:
    total_gap = 0
    for config_name in sorted(should_exist_but_missing):
        ids = should_exist_but_missing[config_name]
        total_gap += len(ids)
        # 压缩连续 ID
        ranges = []
        start = ids[0]
        end = ids[0]
        for i in ids[1:]:
            if i == end + 1:
                end = i
            else:
                ranges.append(f"{start}-{end}" if start != end else str(start))
                start = end = i
        ranges.append(f"{start}-{end}" if start != end else str(start))
        print(f"  ⚠️ {config_name:20s}: {len(ids)} 个样本应能生成但缺失 [{', '.join(ranges)}]")

    print(f"\n  总计: {total_gap} 个标签缺口（原因：用户未对这些策略执行过生成操作）")

# ================================================================
# 6. concentration 策略专项检查
# ================================================================
print()
print("=" * 90)
print("6. concentration 策略专项检查")
print("=" * 90)

with conn.cursor() as cur:
    cur.execute("SELECT config FROM ml_label_configs WHERE name = 'concentration'")
    conc_config = cur.fetchone()

print(f"  当前 config: {conc_config['config']}")
target = (conc_config['config'] or {}).get("target_liquid_id")
if target is None:
    print("  ❌ target_liquid_id 未设置 → 所有样本都无法生成 concentration 标签")
    print("     这是 BY DESIGN：需要用户指定要追踪哪个液体的浓度")
    print()
    # 列出可选的液体
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT unnest(liquid_ids) AS lid, unnest(liquid_names) AS lname
            FROM samples
            ORDER BY lid
        """)
        liquids = cur.fetchall()
    print("     可选的液体 (用于 target_liquid_id):")
    for l in liquids:
        print(f"       id={l['lid']:>4s}  name={l['lname']}")
else:
    print(f"  target_liquid_id = {target}")

# ================================================================
# 7. 前端生成按钮行为分析
# ================================================================
print()
print("=" * 90)
print("7. 前端 '生成标签' 按钮行为分析")
print("=" * 90)
print("  当前行为: handleGenerate 发送 configName=selectedConfig")
print("  → 后端只为当前选中的单个策略生成标签")
print("  → 用户需要逐一切换策略并点击生成，才能覆盖所有策略")
print()
print("  建议: 增加 '全部生成' 按钮，不传 configName，")
print("  后端会调用 generate_for_all_configs 为所有活跃策略生成")

conn.close()
print()
print("=" * 90)
print("✅ 诊断完成")
print("=" * 90)
