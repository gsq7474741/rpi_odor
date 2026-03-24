"""样本截断时间 vs 分类精度研究 — 入口脚本

用法:
  uv run python scripts/run_truncation_study.py              # 运行全部任务
  uv run python scripts/run_truncation_study.py --task A     # 只运行任务 A
  uv run python scripts/run_truncation_study.py --no-dl      # 跳过 DL 模型
  uv run python scripts/run_truncation_study.py --reload     # 强制重新从 DB 加载
  uv run python scripts/run_truncation_study.py --summary    # 只打印已有结果汇总
"""

from __future__ import annotations

import sys
import argparse
import time

# 确保 scripts/ 在 path 中
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import (
    ALL_RUNS, PURE_RUNS, MIX_RUNS,
    TRUNCATION_SECONDS, short, ensure_dirs,
)
from truncation_study.data import SampleRaw, load_raw_data
from truncation_study.runner import ExperimentRunner


def define_tasks(samples: list[SampleRaw]) -> list[dict]:
    """定义分类任务。

    Returns:
        list of {name, indices, label_fn, description}
    """
    tasks = []

    # ── 任务 A: 纯样 5 类分类 ──
    pure_idx = [i for i, s in enumerate(samples) if s.is_pure]
    tasks.append({
        "name": "A_纯样5类",
        "indices": pure_idx,
        "label_fn": lambda s: short(s.names[0]),
        "desc": f"纯样 5 种茶分类 ({len(pure_idx)} 样本)",
    })

    # ── 任务 B: 混合样组合分类 ──
    mix_idx = [i for i, s in enumerate(samples) if not s.is_pure]
    if len(mix_idx) >= 20:
        def mix_label(s):
            combo = tuple(sorted(s.names))
            return f"{short(combo[0])}+{short(combo[1])}"
        tasks.append({
            "name": "B_混合组合",
            "indices": mix_idx,
            "label_fn": mix_label,
            "desc": f"混合样液体组合分类 ({len(mix_idx)} 样本)",
        })

    # ── 任务 C: 全样本主成分分类 ──
    all_idx = list(range(len(samples)))
    def primary_label(s):
        if s.is_pure:
            return short(s.names[0])
        max_i = s.ratios.index(max(s.ratios))
        return short(s.names[max_i])
    tasks.append({
        "name": "C_主成分5类",
        "indices": all_idx,
        "label_fn": primary_label,
        "desc": f"全样本按主成分分类 ({len(all_idx)} 样本)",
    })

    return tasks


def main():
    parser = argparse.ArgumentParser(description="样本截断时间 vs 分类精度研究")
    parser.add_argument("--task", type=str, default=None,
                        help="只运行指定任务 (A/B/C), 默认全部")
    parser.add_argument("--no-dl", action="store_true",
                        help="跳过 DL 模型 (加速)")
    parser.add_argument("--reload", action="store_true",
                        help="强制重新从 DB 加载数据")
    parser.add_argument("--summary", action="store_true",
                        help="只打印已有结果汇总")
    parser.add_argument("--workers", type=int, default=4,
                        help="PCHIP 对齐并行进程数")
    args = parser.parse_args()

    ensure_dirs()

    print("=" * 70)
    print("  样本截断时间 vs 分类精度研究")
    print("  目标: 确定最短可接受采集时长")
    print("=" * 70)

    # 如果只看汇总
    if args.summary:
        runner = ExperimentRunner([], result_file="truncation_results.json")
        runner.print_summary()
        return

    # 加载数据
    print(f"\n📥 加载原始数据 (runs={ALL_RUNS})...")
    t0 = time.time()
    samples = load_raw_data(ALL_RUNS, force_reload=args.reload)
    print(f"  ⏱️ 数据加载耗时: {time.time()-t0:.1f}s")

    # 打印概况
    from collections import defaultdict
    run_counts = defaultdict(int)
    pure_n = mix_n = 0
    for s in samples:
        run_counts[s.run_id] += 1
        if s.is_pure:
            pure_n += 1
        else:
            mix_n += 1
    print(f"\n  Per-Run 分布:")
    for rid in sorted(run_counts):
        print(f"    Run {rid}: {run_counts[rid]} 样本")
    print(f"  纯样: {pure_n}, 混合: {mix_n}, 总计: {len(samples)}")

    # 定义任务
    tasks = define_tasks(samples)
    print(f"\n📋 定义了 {len(tasks)} 个分类任务:")
    for t in tasks:
        print(f"  - {t['name']}: {t['desc']}")

    # 创建运行器
    runner = ExperimentRunner(
        samples,
        result_file="truncation_results.json",
        n_workers=args.workers,
    )

    # 过滤任务
    if args.task:
        task_filter = args.task.upper()
        tasks = [t for t in tasks if t["name"].startswith(task_filter)]
        if not tasks:
            print(f"  ❌ 未找到任务 '{args.task}'")
            return

    # 执行
    total_t0 = time.time()
    for t in tasks:
        runner.run_task(
            t["name"], t["indices"], t["label_fn"],
            skip_dl=args.no_dl,
        )

    total_elapsed = time.time() - total_t0
    print(f"\n⏱️ 全部实验耗时: {total_elapsed:.1f}s ({total_elapsed/60:.1f}min)")

    # 输出汇总
    runner.print_summary()


if __name__ == "__main__":
    main()
