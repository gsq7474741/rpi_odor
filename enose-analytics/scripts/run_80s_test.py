"""80s ACQUIRE 版本分类精度测试 — 复用现有 truncation_study 框架

对比 run 111+112 (80s) 与 旧 runs 99-108 (120s) 的分类精度。

测试条件:
  1. 80s 全量 ACQUIRE (run 111+112)
  2. 80s ACQUIRE + WASH (run 111+112)
  3. 120s 全量 ACQUIRE (旧 runs, 作为基线)
  4. 120s 截断到 80s (旧 runs, 截断对照)

用法:
  uv run python scripts/run_80s_test.py
"""

from __future__ import annotations

import sys
import time
import json
import numpy as np
from pathlib import Path
from datetime import datetime
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import (
    ALL_RUNS, RESULTS_DIR, N_ALIGN_STEPS, short, ensure_dirs,
)
from truncation_study.data import load_raw_data, build_truncated
from truncation_study.phase_data import load_phase_data, build_phase_dataset
from truncation_study.features import make_features

from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier

# ═══════════════════════════════════════════════════════════════
# 配置
# ═══════════════════════════════════════════════════════════════

RUNS_80S = [111, 112]
RUNS_120S = ALL_RUNS  # [99, 101, 102, 103, 104, 106, 105, 108]

FAST_CLASSIFIERS = {
    "LDA": LinearDiscriminantAnalysis(),
    "SVM-rbf": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=42),
    "RF-100": RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1),
    "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=42),
}

FAST_FEATURES = ["stats", "norm_stats", "log_norm_stats", "seg_norm"]

RESULT_FILE = RESULTS_DIR / "80s_test_results.json"


# ═══════════════════════════════════════════════════════════════
# ML 分类 (复用 run_phase_study 逻辑)
# ═══════════════════════════════════════════════════════════════

def run_fast_ml(X_raw: np.ndarray, y: np.ndarray, seed: int = 42) -> dict:
    features = make_features(X_raw)
    unique_classes = np.unique(y)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    n_splits = min(5, min_class_count)
    if n_splits < 2:
        return {"best_acc": 0, "best_combo": "N/A", "details": {}}

    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    results = {}
    best_acc = 0
    best_combo = ""

    for feat_name in FAST_FEATURES:
        if feat_name not in features:
            continue
        X, desc = features[feat_name]
        for clf_name, clf in FAST_CLASSIFIERS.items():
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
            try:
                scores = cross_val_score(pipe, X, y, cv=skf, scoring="accuracy")
                acc = scores.mean()
                std = scores.std()
            except Exception:
                acc, std = 0.0, 0.0
                scores = []

            combo = f"{feat_name}+{clf_name}"
            results[combo] = {
                "accuracy": round(acc, 4),
                "std": round(std, 4),
                "folds": [round(s, 4) for s in scores] if len(scores) else [],
            }
            if acc > best_acc:
                best_acc = acc
                best_combo = combo

    return {"best_acc": round(best_acc, 4), "best_combo": best_combo, "details": results}


# ═══════════════════════════════════════════════════════════════
# 标签函数
# ═══════════════════════════════════════════════════════════════

def pure_label(s):
    return short(s.names[0]) if hasattr(s, 'names') else short(s["names"][0])

def primary_label(s):
    names = s.names if hasattr(s, 'names') else s["names"]
    ratios = s.ratios if hasattr(s, 'ratios') else s["ratios"]
    is_pure = s.is_pure if hasattr(s, 'is_pure') else (len(names) == 1)
    if is_pure:
        return short(names[0])
    max_i = list(ratios).index(max(ratios))
    return short(names[max_i])


# ═══════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════

def main():
    ensure_dirs()

    print("=" * 70)
    print("  80s ACQUIRE 分类精度测试")
    print("  对比 run 111+112 (80s) vs runs 99-108 (120s)")
    print("=" * 70)

    results = {}

    # ──────────────────────────────────────────────────────────
    # A. 加载 80s 数据 (run 111+112)
    # ──────────────────────────────────────────────────────────
    print("\n📥 加载 80s 数据 (runs 111+112)...")
    raw_80s = load_raw_data(RUNS_80S)
    print(f"  ✓ {len(raw_80s)} 样本, ACQUIRE 时长: ~80s")

    pure_80s = [i for i, s in enumerate(raw_80s) if s.is_pure]
    all_80s = list(range(len(raw_80s)))

    # ──────────────────────────────────────────────────────────
    # B. 加载 120s 数据 (旧 runs)
    # ──────────────────────────────────────────────────────────
    print("\n📥 加载 120s 数据 (旧 runs)...")
    raw_120s = load_raw_data(RUNS_120S)
    print(f"  ✓ {len(raw_120s)} 样本, ACQUIRE 时长: ~120s")

    pure_120s = [i for i, s in enumerate(raw_120s) if s.is_pure]
    all_120s = list(range(len(raw_120s)))

    # ──────────────────────────────────────────────────────────
    # C. 加载 80s 完整周期数据 (含 WASH) 用于 phase 条件
    # ──────────────────────────────────────────────────────────
    print("\n📥 加载 80s 完整周期数据 (含 WASH)...")
    cycles_80s = load_phase_data(RUNS_80S)
    print(f"  ✓ {len(cycles_80s)} 完整周期")

    pure_cyc_80s = [i for i, s in enumerate(cycles_80s) if s.is_pure]
    all_cyc_80s = list(range(len(cycles_80s)))

    # ──────────────────────────────────────────────────────────
    # D. 定义实验条件
    # ──────────────────────────────────────────────────────────
    conditions = []

    # 1) 80s 全量 ACQUIRE
    conditions.append({
        "name": "80s_acquire_full",
        "desc": "Run 111+112: ACQUIRE 全量 80s",
        "source": "raw_80s",
        "cutoff_s": 80,
    })

    # 2) 80s ACQUIRE + WASH
    conditions.append({
        "name": "80s_acquire_wash",
        "desc": "Run 111+112: ACQUIRE 80s + WASH",
        "source": "phase_80s",
        "condition": "acquire_wash",
    })

    # 3) 120s 全量 ACQUIRE (基线)
    conditions.append({
        "name": "120s_acquire_full",
        "desc": "旧 Runs: ACQUIRE 全量 120s (基线)",
        "source": "raw_120s",
        "cutoff_s": 120,
    })

    # 4) 120s 截断到 80s
    conditions.append({
        "name": "120s_truncate_80s",
        "desc": "旧 Runs: ACQUIRE 截断至 80s",
        "source": "raw_120s",
        "cutoff_s": 80,
    })

    # 5) 80s head_tail (ACQUIRE 头 30s + WASH 头 30s)
    conditions.append({
        "name": "80s_head_tail",
        "desc": "Run 111+112: ACQUIRE 头30s + WASH 头30s",
        "source": "phase_80s",
        "condition": "head_tail",
    })

    # ──────────────────────────────────────────────────────────
    # E. 定义任务
    # ──────────────────────────────────────────────────────────
    tasks = [
        {"name": "A_纯样5类", "label_fn": pure_label, "pure_only": True},
        {"name": "C_主成分5类", "label_fn": primary_label, "pure_only": False},
    ]

    # ──────────────────────────────────────────────────────────
    # F. 执行所有实验
    # ──────────────────────────────────────────────────────────
    total_t0 = time.time()

    for task in tasks:
        task_results = {}

        print(f"\n{'='*70}")
        print(f"  任务: {task['name']}")
        print(f"{'='*70}")

        for cond in tqdm(conditions, desc=f"  {task['name']}", unit="cond"):
            t0 = time.time()
            cond_name = cond["name"]
            source = cond["source"]

            # 构建数据集
            if source == "raw_80s":
                indices = pure_80s if task["pure_only"] else all_80s
                X, valid_idx = build_truncated(raw_80s, cond["cutoff_s"], indices)
                label_source = raw_80s
            elif source == "raw_120s":
                indices = pure_120s if task["pure_only"] else all_120s
                X, valid_idx = build_truncated(raw_120s, cond["cutoff_s"], indices)
                label_source = raw_120s
            elif source == "phase_80s":
                indices = pure_cyc_80s if task["pure_only"] else all_cyc_80s
                X, valid_idx = build_phase_dataset(cycles_80s, cond["condition"], indices)
                label_source = cycles_80s
            else:
                continue

            if X.shape[0] < 10:
                tqdm.write(f"    ⚠️ {cond_name}: 有效样本不足 ({X.shape[0]}), 跳过")
                continue

            # 构建标签
            y_names = [task["label_fn"](label_source[i]) for i in valid_idx]
            classes = sorted(set(y_names))
            label_map = {name: i for i, name in enumerate(classes)}
            y = np.array([label_map[n] for n in y_names])

            if len(np.unique(y)) < 2:
                tqdm.write(f"    ⚠️ {cond_name}: 类别不足, 跳过")
                continue

            # ML 分类
            ml_result = run_fast_ml(X, y)
            elapsed = time.time() - t0

            task_results[cond_name] = {
                "desc": cond["desc"],
                "n_samples": len(valid_idx),
                "n_classes": len(classes),
                "classes": classes,
                "best_acc": ml_result["best_acc"],
                "best_combo": ml_result["best_combo"],
                "elapsed_s": round(elapsed, 1),
                "details": ml_result["details"],
            }

            tqdm.write(f"  ✅ {cond_name}: {ml_result['best_acc']:.1%} "
                       f"({ml_result['best_combo']}) "
                       f"[{len(valid_idx)} 样本, {elapsed:.1f}s]")

        results[task["name"]] = task_results

    total_elapsed = time.time() - total_t0

    # ──────────────────────────────────────────────────────────
    # G. 保存结果
    # ──────────────────────────────────────────────────────────
    output = {
        "metadata": {
            "created_at": datetime.now().isoformat(),
            "description": "80s vs 120s ACQUIRE 分类精度对比",
            "runs_80s": RUNS_80S,
            "runs_120s": RUNS_120S,
            "total_elapsed_s": round(total_elapsed, 1),
        },
        "results": results,
    }
    with open(RESULT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n💾 结果已保存: {RESULT_FILE}")

    # ──────────────────────────────────────────────────────────
    # H. 打印汇总
    # ──────────────────────────────────────────────────────────
    print(f"\n{'#'*80}")
    print(f"#  80s vs 120s 分类精度对比")
    print(f"{'#'*80}")

    for task_name, task_res in results.items():
        print(f"\n{'='*80}")
        print(f"  {task_name}")
        print(f"{'='*80}")
        print(f"  {'条件':<24} {'样本':>5} {'最佳精度':>8} {'最佳组合':<28} {'耗时':>6}")
        print(f"  {'-'*77}")

        for cond_name, c in task_res.items():
            print(f"  {cond_name:<24} {c['n_samples']:>5} {c['best_acc']:>7.1%} "
                  f"{c['best_combo']:<28} {c['elapsed_s']:>5.1f}s")

        # 基线对比
        baseline_acc = task_res.get("120s_acquire_full", {}).get("best_acc", 0)
        if baseline_acc > 0:
            print(f"\n  📊 以 120s_acquire_full ({baseline_acc:.1%}) 为基线:")
            for cond_name, c in task_res.items():
                if cond_name == "120s_acquire_full":
                    continue
                diff = c["best_acc"] - baseline_acc
                pct = diff / baseline_acc * 100 if baseline_acc > 0 else 0
                arrow = "↑" if diff > 0 else ("↓" if diff < 0 else "→")
                print(f"    {cond_name:<24} {c['best_acc']:.1%} ({diff:+.1%}, {pct:+.1f}%) {arrow}")

    print(f"\n⏱️ 总耗时: {total_elapsed:.1f}s ({total_elapsed/60:.1f}min)")


if __name__ == "__main__":
    main()
