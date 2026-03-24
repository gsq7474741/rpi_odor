"""Step 4: 多特征 × 多分类器交叉验证分类测试。

依赖: Step 1 的缓存数据
用法: uv run python scripts/run_04_classify.py [--task A|B|C|D|all]

任务:
  A — 纯样 5 类分类 (对照组)
  B — 10 组合分类 (仅混合样)
  C — 比例区间分类 (仅混合样, 3 类)
  D — 全样本 15 类分类 (5 纯 + 10 组合)
"""

from __future__ import annotations

import sys
import argparse
import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from mix_analysis.config import DEFAULT_CONFIG
from mix_analysis.data_loader import load_dataset, SampleMeta
from mix_analysis.features import make_features
from mix_analysis.classifiers import run_classification
from mix_analysis.utils import log, StepTimer, print_header


def _build_labels(
    meta: list[SampleMeta], exp,
) -> dict[str, tuple[np.ndarray, np.ndarray, list[str]]]:
    """构建各任务的 (indices, y, class_names)"""
    tasks = {}

    # 任务 A: 纯样 5 类
    pure_idx = [i for i, m in enumerate(meta) if m.is_pure]
    if len(pure_idx) >= 10:
        y_names = [meta[i].names[0] for i in pure_idx]
        classes = sorted(set(y_names))
        label_map = {n: i for i, n in enumerate(classes)}
        tasks["A"] = (
            np.array(pure_idx),
            np.array([label_map[n] for n in y_names]),
            [exp.short(c) for c in classes],
        )

    # 任务 B: 10 组合 (仅混合样)
    mix_idx = [i for i, m in enumerate(meta) if not m.is_pure]
    if len(mix_idx) >= 10:
        y_names = []
        for i in mix_idx:
            m = meta[i]
            combo = tuple(sorted(m.names))
            y_names.append(f"{exp.short(combo[0])}+{exp.short(combo[1])}")
        classes = sorted(set(y_names))
        label_map = {n: i for i, n in enumerate(classes)}
        tasks["B"] = (
            np.array(mix_idx),
            np.array([label_map[n] for n in y_names]),
            classes,
        )

    # 任务 C: 比例区间 (仅混合样, 3 类)
    if len(mix_idx) >= 10:
        y_names = []
        for i in mix_idx:
            r = max(meta[i].ratios)
            if r >= 0.7:
                y_names.append("75%")
            elif r >= 0.4:
                y_names.append("50%")
            else:
                y_names.append("25%")
        classes = sorted(set(y_names))
        label_map = {n: i for i, n in enumerate(classes)}
        tasks["C"] = (
            np.array(mix_idx),
            np.array([label_map[n] for n in y_names]),
            classes,
        )

    # 任务 D: 全样本 15 类
    y_names = []
    for m in meta:
        if m.is_pure:
            y_names.append(f"纯-{exp.short(m.names[0])}")
        else:
            combo = tuple(sorted(m.names))
            y_names.append(f"{exp.short(combo[0])}+{exp.short(combo[1])}")
    classes = sorted(set(y_names))
    label_map = {n: i for i, n in enumerate(classes)}
    tasks["D"] = (
        np.arange(len(meta)),
        np.array([label_map[n] for n in y_names]),
        classes,
    )

    return tasks


TASK_DESCRIPTIONS = {
    "A": "纯样 5 类分类 (对照组)",
    "B": "10 组合分类 (仅混合样)",
    "C": "比例区间分类 (仅混合样, 3 类)",
    "D": "全样本 15 类分类",
}


def main():
    parser = argparse.ArgumentParser(description="Step 4: 分类测试")
    parser.add_argument(
        "--task", default="all",
        help="要运行的任务: A/B/C/D/all (默认 all)",
    )
    args = parser.parse_args()

    exp = DEFAULT_CONFIG

    with StepTimer("加载缓存数据"):
        X_raw, meta = load_dataset(exp)

    label_tasks = _build_labels(meta, exp)
    requested = list("ABCD") if args.task == "all" else [args.task.upper()]

    for task_key in requested:
        if task_key not in label_tasks:
            log.warning(f"任务 {task_key} 无法构建 (样本不足)")
            continue

        indices, y, class_names = label_tasks[task_key]
        desc = TASK_DESCRIPTIONS.get(task_key, task_key)

        print_header(f"任务 {task_key}: {desc}")
        print(f"  样本: {len(indices)}, 类别: {len(class_names)}")
        for i, name in enumerate(class_names):
            print(f"    [{i}] {name}: {np.sum(y == i)}")

        X_task = X_raw[indices]

        with StepTimer(f"特征工程 (任务 {task_key})"):
            features = make_features(X_task, exp)
            print(f"\n  特征集:")
            for name, fs in features.items():
                print(f"    {name}: {fs.X.shape} — {fs.desc}")

        with StepTimer(f"分类 (任务 {task_key})"):
            result = run_classification(features, y, f"任务{task_key}: {desc}")
            result.print_top(top_k=15)

    log.info("Step 4 完成 ✓")


if __name__ == "__main__":
    main()
