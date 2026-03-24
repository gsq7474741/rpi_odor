"""数据审计脚本 — 对照论文实验设计检查现有数据

论文: 基于电子鼻的对比香气表征学习用于茶叶拼配表征
目标: 检查数据库中的数据是否足以支撑论文的各项实验
"""

import yaml
import json
from pathlib import Path
from collections import defaultdict, Counter
from itertools import combinations
import psycopg
from psycopg.rows import dict_row
import numpy as np


def load_dsn():
    cfg_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


def main():
    dsn = load_dsn()
    report = {}

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # ═══════════════════════════════════════════════════
            # 1. 所有 Runs 概况
            # ═══════════════════════════════════════════════════
            print("=" * 80)
            print("  1. Runs 概况")
            print("=" * 80)
            cur.execute("""
                SELECT r.id as run_id, r.program_name, r.state, r.created_at,
                       COUNT(s.id) as sample_count
                FROM runs r
                LEFT JOIN samples s ON s.run_id = r.id AND s.end_time_ms IS NOT NULL
                GROUP BY r.id, r.program_name, r.state, r.created_at
                ORDER BY r.id
            """)
            runs = cur.fetchall()
            print(f"  总 Runs 数: {len(runs)}")
            for r in runs:
                print(f"    Run {r['run_id']:>4}: {r['sample_count']:>4} 样本  "
                      f"program={r['program_name'] or 'N/A':<40} "
                      f"status={r['state'] or 'N/A'}  "
                      f"date={str(r['created_at'])[:10] if r['created_at'] else 'N/A'}")

            # ═══════════════════════════════════════════════════
            # 2. 所有已完成样本统计
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  2. 样本总览")
            print("=" * 80)
            cur.execute("""
                SELECT id, run_id, sample_idx, liquid_names, liquid_ratios,
                       phase_name, start_time_ms, end_time_ms, gas_pump_pwm
                FROM samples
                WHERE end_time_ms IS NOT NULL
                ORDER BY run_id, sample_idx
            """)
            samples = cur.fetchall()
            print(f"  已完成样本总数: {len(samples)}")

            # 分类: 纯样 vs 二元混合 vs 三元混合
            pure_samples = []
            binary_samples = []
            ternary_samples = []
            other_samples = []

            for s in samples:
                names = list(s["liquid_names"]) if s["liquid_names"] else []
                n_components = len(names)
                if n_components == 1:
                    pure_samples.append(s)
                elif n_components == 2:
                    binary_samples.append(s)
                elif n_components == 3:
                    ternary_samples.append(s)
                else:
                    other_samples.append(s)

            print(f"  纯样 (单一液体): {len(pure_samples)}")
            print(f"  二元混合: {len(binary_samples)}")
            print(f"  三元混合: {len(ternary_samples)}")
            print(f"  其他: {len(other_samples)}")

            # ═══════════════════════════════════════════════════
            # 3. 液体种类
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  3. 液体种类")
            print("=" * 80)
            all_liquids = set()
            for s in samples:
                names = list(s["liquid_names"]) if s["liquid_names"] else []
                for n in names:
                    all_liquids.add(n)
            all_liquids = sorted(all_liquids)
            print(f"  液体种类数: {len(all_liquids)}")
            for liq in all_liquids:
                # 统计纯样数量
                pure_cnt = sum(1 for s in pure_samples
                               if list(s["liquid_names"])[0] == liq)
                # 参与混合样的数量
                mix_cnt = sum(1 for s in binary_samples + ternary_samples
                              if liq in list(s["liquid_names"]))
                print(f"    {liq}: 纯样={pure_cnt}, 参与混合={mix_cnt}")

            # ═══════════════════════════════════════════════════
            # 4. 纯样详情 (对应论文 Phase 1)
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  4. 纯样详情 (Phase 1: 单茶指纹)")
            print("=" * 80)
            pure_by_liquid = defaultdict(list)
            for s in pure_samples:
                name = list(s["liquid_names"])[0]
                pure_by_liquid[name].append(s)

            print(f"  论文目标: 5种茶 × 15重复 = 75 纯样")
            print(f"  实际数量: {len(all_liquids)}种液体 × ? 重复")
            for liq in sorted(pure_by_liquid.keys()):
                ss = pure_by_liquid[liq]
                runs_set = set(s["run_id"] for s in ss)
                durations = [(s["end_time_ms"] - s["start_time_ms"]) / 1000.0 for s in ss]
                print(f"    {liq}: {len(ss)} 样本, runs={sorted(runs_set)}, "
                      f"时长={np.mean(durations):.1f}s (min={np.min(durations):.1f}, max={np.max(durations):.1f})")

            # ═══════════════════════════════════════════════════
            # 5. 二元混合详情 (对应论文 Phase 2)
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  5. 二元混合详情 (Phase 2: 二元拼配)")
            print("=" * 80)

            # 按组合分组
            binary_by_combo = defaultdict(list)
            for s in binary_samples:
                names = sorted(list(s["liquid_names"]))
                combo_key = tuple(names)
                binary_by_combo[combo_key].append(s)

            n_possible_pairs = len(all_liquids) * (len(all_liquids) - 1) // 2
            print(f"  论文目标: 10组 × 11比例 × 8重复 = 880")
            print(f"  可能的组合数 (C({len(all_liquids)},2)): {n_possible_pairs}")
            print(f"  实际覆盖的组合数: {len(binary_by_combo)}")
            print(f"  实际二元样本总数: {len(binary_samples)}")

            for combo in sorted(binary_by_combo.keys()):
                ss = binary_by_combo[combo]
                # 分析比例分布
                ratio_counter = Counter()
                for s in ss:
                    names = list(s["liquid_names"])
                    ratios = list(s["liquid_ratios"])
                    # 归一化比例表示 (按字母序)
                    if names[0] > names[1]:
                        names = [names[1], names[0]]
                        ratios = [ratios[1], ratios[0]]
                    ratio_key = f"{ratios[0]:.2f}:{ratios[1]:.2f}"
                    ratio_counter[ratio_key] += 1

                n_ratios = len(ratio_counter)
                n_total = len(ss)
                runs_set = sorted(set(s["run_id"] for s in ss))
                avg_repeat = n_total / n_ratios if n_ratios > 0 else 0

                short_names = [n.replace("东方树叶-", "") for n in combo]
                print(f"\n    {short_names[0]} + {short_names[1]}:")
                print(f"      总样本: {n_total}, 比例数: {n_ratios}, "
                      f"平均重复: {avg_repeat:.1f}, runs={runs_set}")
                # 按比例排序显示
                for ratio_key in sorted(ratio_counter.keys()):
                    cnt = ratio_counter[ratio_key]
                    print(f"        {ratio_key}: {cnt} 次")

            # ═══════════════════════════════════════════════════
            # 6. 三元混合详情 (对应论文 Phase 3)
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  6. 三元混合详情 (Phase 3)")
            print("=" * 80)
            if ternary_samples:
                ternary_by_combo = defaultdict(list)
                for s in ternary_samples:
                    names = sorted(list(s["liquid_names"]))
                    combo_key = tuple(names)
                    ternary_by_combo[combo_key].append(s)

                print(f"  三元组合数: {len(ternary_by_combo)}")
                print(f"  三元样本总数: {len(ternary_samples)}")
                for combo in sorted(ternary_by_combo.keys()):
                    ss = ternary_by_combo[combo]
                    short_names = [n.replace("东方树叶-", "") for n in combo]
                    print(f"    {'+'.join(short_names)}: {len(ss)} 样本")
            else:
                print(f"  无三元混合数据")

            # ═══════════════════════════════════════════════════
            # 7. 数据质量 - 传感器读数覆盖
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  7. 传感器数据覆盖")
            print("=" * 80)
            # 抽样检查几个 run 的传感器读数密度
            sample_runs = sorted(set(s["run_id"] for s in samples))[-5:]  # 最近5个run
            for rid in sample_runs:
                cur.execute("""
                    SELECT COUNT(*) as cnt, 
                           COUNT(DISTINCT sensor_idx) as n_sensors,
                           MIN(time_ms) as t_min, MAX(time_ms) as t_max
                    FROM sensor_readings_v2
                    WHERE run_id = %s
                """, [rid])
                info = cur.fetchone()
                if info and info["cnt"] > 0:
                    span_s = (info["t_max"] - info["t_min"]) / 1000.0
                    rate = info["cnt"] / span_s if span_s > 0 else 0
                    print(f"    Run {rid}: {info['cnt']} 读数, "
                          f"{info['n_sensors']} 传感器, "
                          f"跨度 {span_s:.0f}s, ~{rate:.1f} 读/秒")

            # ═══════════════════════════════════════════════════
            # 8. Per-Run 样本分布
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  8. Per-Run 样本分布")
            print("=" * 80)
            run_stats = defaultdict(lambda: {"pure": 0, "binary": 0, "ternary": 0, "liquids": set()})
            for s in samples:
                rid = s["run_id"]
                names = list(s["liquid_names"]) if s["liquid_names"] else []
                for n in names:
                    run_stats[rid]["liquids"].add(n)
                if len(names) == 1:
                    run_stats[rid]["pure"] += 1
                elif len(names) == 2:
                    run_stats[rid]["binary"] += 1
                elif len(names) == 3:
                    run_stats[rid]["ternary"] += 1

            for rid in sorted(run_stats.keys()):
                st = run_stats[rid]
                total = st["pure"] + st["binary"] + st["ternary"]
                liq_short = [n.replace("东方树叶-", "") for n in sorted(st["liquids"])]
                print(f"    Run {rid:>4}: 纯样={st['pure']:>3} 二元={st['binary']:>3} "
                      f"三元={st['ternary']:>3} 总={total:>4}  "
                      f"液体: {', '.join(liq_short)}")

            # ═══════════════════════════════════════════════════
            # 9. 汇总: 论文需求 vs 实际数据
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  9. 论文需求 vs 实际数据 对照表")
            print("=" * 80)

            n_teas = len(all_liquids)
            n_pure = len(pure_samples)
            n_binary = len(binary_samples)
            n_ternary = len(ternary_samples)
            n_total = len(samples)

            # 纯样重复数
            min_pure_repeat = min(len(v) for v in pure_by_liquid.values()) if pure_by_liquid else 0
            max_pure_repeat = max(len(v) for v in pure_by_liquid.values()) if pure_by_liquid else 0

            # 二元覆盖比例数
            all_ratio_counts = []
            all_repeat_counts = []
            for combo, ss in binary_by_combo.items():
                ratio_counter = Counter()
                for s in ss:
                    names = list(s["liquid_names"])
                    ratios = list(s["liquid_ratios"])
                    if names[0] > names[1]:
                        ratios = [ratios[1], ratios[0]]
                    ratio_key = f"{ratios[0]:.2f}:{ratios[1]:.2f}"
                    ratio_counter[ratio_key] += 1
                all_ratio_counts.append(len(ratio_counter))
                all_repeat_counts.extend(ratio_counter.values())

            avg_ratios_per_combo = np.mean(all_ratio_counts) if all_ratio_counts else 0
            avg_repeats = np.mean(all_repeat_counts) if all_repeat_counts else 0
            min_repeats = min(all_repeat_counts) if all_repeat_counts else 0

            print(f"""
  ┌────────────────────────────┬──────────────┬──────────────┬─────────────┐
  │ 指标                       │ 论文计划      │ 实际数据      │ 状态         │
  ├────────────────────────────┼──────────────┼──────────────┼─────────────┤
  │ 茶种类数                   │ 5            │ {n_teas:<13}│ {'✅' if n_teas >= 5 else '⚠️ 不足'}          │
  │ Phase 1: 纯样总数          │ 75           │ {n_pure:<13}│ {'✅ 充足' if n_pure >= 75 else '⚠️ 不足 ' + str(n_pure) + '/75'}     │
  │   每种茶纯样重复数         │ 15           │ {min_pure_repeat}-{max_pure_repeat:<9}│ {'✅' if min_pure_repeat >= 15 else '⚠️ 最少' + str(min_pure_repeat)}         │
  │ Phase 2: 二元组合数        │ 10           │ {len(binary_by_combo):<13}│ {'✅' if len(binary_by_combo) >= 10 else '⚠️ ' + str(len(binary_by_combo)) + '/10'}         │
  │   平均比例步长数            │ 11           │ {avg_ratios_per_combo:<13.1f}│ {'✅' if avg_ratios_per_combo >= 11 else '⚠️ 不足'}         │
  │   平均每条件重复数          │ 8            │ {avg_repeats:<13.1f}│ {'✅' if avg_repeats >= 8 else '⚠️ ' + f'{avg_repeats:.1f}/8'}       │
  │   最少重复数               │ 8            │ {min_repeats:<13}│ {'✅' if min_repeats >= 8 else '⚠️ 最少' + str(min_repeats)}         │
  │   二元样本总数             │ 880          │ {n_binary:<13}│ {'✅' if n_binary >= 880 else '⚠️ ' + str(n_binary) + '/880'}      │
  │ Phase 3: 三元样本总数      │ ~660-990     │ {n_ternary:<13}│ {'✅' if n_ternary >= 660 else '❌ ' + str(n_ternary) + '/660'}      │
  │ Phase 4: 验证集            │ ~200         │ ?            │ 从已有数据划分 │
  │ Phase 5: 泡后vs泡前对照    │ ~10          │ 0            │ ❌ 未实施     │
  │ 总样本数                   │ ~2000        │ {n_total:<13}│ {'✅' if n_total >= 2000 else '⚠️ ' + str(n_total) + '/2000'}     │
  └────────────────────────────┴──────────────┴──────────────┴─────────────┘
""")

            # ═══════════════════════════════════════════════════
            # 10. 可加性分析所需的数据检查
            # ═══════════════════════════════════════════════════
            print("=" * 80)
            print("  10. NLDI 可加性分析的数据充分性")
            print("=" * 80)
            print("  NLDI 计算需要: 纯茶A基线 + 纯茶B基线 + A:B混合的多个比例实测值")
            print()
            for combo in sorted(binary_by_combo.keys()):
                a, b = combo
                a_pure = len(pure_by_liquid.get(a, []))
                b_pure = len(pure_by_liquid.get(b, []))
                mix_ss = binary_by_combo[combo]
                ratio_counter = Counter()
                for s in mix_ss:
                    names = list(s["liquid_names"])
                    ratios = list(s["liquid_ratios"])
                    if names[0] > names[1]:
                        ratios = [ratios[1], ratios[0]]
                    ratio_key = f"{ratios[0]:.2f}"
                    ratio_counter[ratio_key] += 1

                short_a = a.replace("东方树叶-", "")
                short_b = b.replace("东方树叶-", "")
                can_nldi = a_pure >= 5 and b_pure >= 5 and len(ratio_counter) >= 3
                status = "✅ 可计算" if can_nldi else "❌ 数据不足"
                print(f"    {short_a}+{short_b}: 纯A={a_pure}, 纯B={b_pure}, "
                      f"混合比例数={len(ratio_counter)}, 混合样本={len(mix_ss)}  → {status}")

            # ═══════════════════════════════════════════════════
            # 11. CARL 对比学习的数据充分性
            # ═══════════════════════════════════════════════════
            print("\n" + "=" * 80)
            print("  11. CARL 对比学习的数据充分性")
            print("=" * 80)
            print("  CARL 需要: 足够多的样本对（同茶对同比例=正对, 不同=负对）")
            print(f"  训练集 (80%): ~{int(n_total * 0.8)} 样本")
            print(f"  验证集 (20%): ~{int(n_total * 0.2)} 样本")

            # 计算标签多样性
            label_counter = Counter()
            for s in samples:
                names = list(s["liquid_names"]) if s["liquid_names"] else []
                ratios = list(s["liquid_ratios"]) if s["liquid_ratios"] else []
                if len(names) == 1:
                    label = names[0].replace("东方树叶-", "")
                elif len(names) == 2:
                    sorted_pairs = sorted(zip(names, ratios))
                    n1 = sorted_pairs[0][0].replace("东方树叶-", "")
                    n2 = sorted_pairs[1][0].replace("东方树叶-", "")
                    r1 = sorted_pairs[0][1]
                    # 离散化比例到5个区间
                    if r1 <= 0.1:
                        bin_label = "0-10%"
                    elif r1 <= 0.3:
                        bin_label = "10-30%"
                    elif r1 <= 0.5:
                        bin_label = "30-50%"
                    elif r1 <= 0.7:
                        bin_label = "50-70%"
                    else:
                        bin_label = "70-100%"
                    label = f"{n1}+{n2}@{bin_label}"
                else:
                    label = "ternary"
                label_counter[label] += 1

            print(f"  标签种类数 (茶对×比例区间): {len(label_counter)}")
            print(f"  标签分布:")
            for label, cnt in sorted(label_counter.items(), key=lambda x: -x[1])[:30]:
                print(f"    {label}: {cnt}")
            if len(label_counter) > 30:
                print(f"    ... 共 {len(label_counter)} 种标签")

            min_label_cnt = min(label_counter.values())
            labels_with_few = sum(1 for c in label_counter.values() if c < 5)
            print(f"\n  最少标签样本数: {min_label_cnt}")
            print(f"  样本数<5的标签: {labels_with_few}/{len(label_counter)}")

            # 对比学习最低要求
            carl_ok = n_total >= 500 and len(label_counter) >= 20
            print(f"\n  CARL 可行性: {'✅ 可行' if carl_ok else '⚠️ 样本可能偏少'}")
            if not carl_ok:
                print(f"    建议: 至少 500 样本 + 20 种标签")

    print("\n" + "#" * 80)
    print("#  审计完成")
    print("#" * 80)


if __name__ == "__main__":
    main()
