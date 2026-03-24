"""阶段对比实验 — 吸附 vs 吸附+解析 vs 头尾拼接

对比不同数据段组合对分类精度的影响, 用快速模型子集运行。

实验条件:
  acquire_only     — 纯 ACQUIRE 120s (吸附, 当前基线)
  acquire_60       — ACQUIRE 前 60s (截断对照)
  acquire_wash     — ACQUIRE + WASH ~170s (吸附+解析前段)
  acquire_full_gap — ACQUIRE + 完整 gap ~180s (吸附+完整解析)
  head_tail        — ACQUIRE 前 30s + gap 最后 30s (头尾拼接)

用法:
  uv run python scripts/run_phase_study.py              # 全部
  uv run python scripts/run_phase_study.py --summary    # 只看结果
  uv run python scripts/run_phase_study.py --reload     # 强制重新加载
"""

from __future__ import annotations

import sys
import time
import json
import argparse
import numpy as np
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent))

from truncation_study.config import (
    ALL_RUNS, PURE_RUNS, MIX_RUNS, RESULTS_DIR, short, ensure_dirs,
)
from truncation_study.phase_data import (
    SampleCycle, load_phase_data, build_phase_dataset,
)
from truncation_study.features import make_features

# ═══════════════════════════════════════════════════════════════
# 快速模型子集 (只用 4 个代表性模型)
# ═══════════════════════════════════════════════════════════════

from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier


FAST_CLASSIFIERS = {
    "LDA": LinearDiscriminantAnalysis(),
    "SVM-rbf": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=42),
    "RF-100": RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1),
    "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=42),
}

FAST_FEATURES = ["stats", "norm_stats", "log_norm_stats", "seg_norm"]


def run_fast_ml(X_raw: np.ndarray, y: np.ndarray, seed: int = 42) -> dict:
    """快速 ML 分类: 4 个特征 × 4 个模型 = 16 组合。"""
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
# 结果存储 (JSON 断点续作)
# ═══════════════════════════════════════════════════════════════

RESULT_FILE = RESULTS_DIR / "phase_study_results.json"

CONDITIONS = [
    "acquire_60",
    "acquire_only",
    "acquire_wash",
    "acquire_full_gap",
    "head_tail",
]

CONDITION_DESC = {
    "acquire_60": "ACQUIRE 前 60s (吸附截断)",
    "acquire_only": "ACQUIRE 全部 120s (纯吸附)",
    "acquire_wash": "ACQUIRE + WASH ~170s (吸附+解析前段)",
    "acquire_full_gap": "ACQUIRE + 全 gap ~180s (吸附+完整解析)",
    "head_tail": "ACQUIRE 前 30s + WASH 前 30s (吸附头+解析头)",
}


class PhaseResultStore:
    def __init__(self):
        self.path = RESULT_FILE
        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            print(f"  📂 加载已有结果: {self.path.name}")
        else:
            self.data = {
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "description": "阶段对比实验: 吸附 vs 吸附+解析",
                    "conditions": CONDITION_DESC,
                },
                "tasks": {},
            }

    def is_done(self, task_name: str, condition: str) -> bool:
        task = self.data.get("tasks", {}).get(task_name, {})
        return condition in task.get("conditions", {})

    def save(self, task_name: str, task_config: dict, condition: str,
             n_samples: int, ml_result: dict, elapsed_s: float):
        tasks = self.data.setdefault("tasks", {})
        task = tasks.setdefault(task_name, {"config": task_config, "conditions": {}})
        task["config"] = task_config

        task["conditions"][condition] = {
            "description": CONDITION_DESC.get(condition, condition),
            "n_samples": n_samples,
            "best_acc": ml_result["best_acc"],
            "best_combo": ml_result["best_combo"],
            "details": ml_result["details"],
            "elapsed_s": round(elapsed_s, 2),
            "completed_at": datetime.now().isoformat(),
        }
        self._flush()

    def _flush(self):
        self.data["metadata"]["updated_at"] = datetime.now().isoformat()
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)


# ═══════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════

def define_tasks(samples: list[SampleCycle]) -> list[dict]:
    tasks = []
    pure_idx = [i for i, s in enumerate(samples) if s.is_pure]
    tasks.append({
        "name": "A_纯样5类",
        "indices": pure_idx,
        "label_fn": lambda s: short(s.names[0]),
        "desc": f"纯样 5 种茶分类 ({len(pure_idx)} 样本)",
    })

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


def print_summary(store: PhaseResultStore):
    print(f"\n{'#'*80}")
    print(f"#  阶段对比实验结果汇总")
    print(f"{'#'*80}")

    for task_name, task in store.data.get("tasks", {}).items():
        cfg = task.get("config", {})
        conditions = task.get("conditions", {})
        n_classes = cfg.get("n_classes", "?")
        baseline = 100.0 / n_classes if isinstance(n_classes, int) and n_classes > 0 else 0

        print(f"\n{'='*80}")
        print(f"  {task_name} (随机基线={baseline:.1f}%)")
        print(f"{'='*80}")
        print(f"  {'条件':<22} {'样本':>5} {'最佳精度':>8} {'最佳组合':<28} {'耗时':>6}")
        print(f"  {'-'*75}")

        # 按条件顺序打印
        for cond in CONDITIONS:
            if cond not in conditions:
                continue
            c = conditions[cond]
            print(f"  {cond:<22} {c['n_samples']:>5} {c['best_acc']:>7.1%} "
                  f"{c['best_combo']:<28} {c['elapsed_s']:>5.1f}s")

        # 精度对比分析
        acq_only = conditions.get("acquire_only", {}).get("best_acc", 0)
        if acq_only > 0:
            print(f"\n  📊 以 acquire_only ({acq_only:.1%}) 为基线:")
            for cond in CONDITIONS:
                if cond == "acquire_only" or cond not in conditions:
                    continue
                other_acc = conditions[cond]["best_acc"]
                diff = other_acc - acq_only
                pct = diff / acq_only * 100 if acq_only > 0 else 0
                arrow = "↑" if diff > 0 else ("↓" if diff < 0 else "→")
                print(f"    {cond:<22} {other_acc:.1%} ({diff:+.1%}, {pct:+.1f}%) {arrow}")


def main():
    parser = argparse.ArgumentParser(description="阶段对比实验")
    parser.add_argument("--summary", action="store_true", help="只打印汇总")
    parser.add_argument("--reload", action="store_true", help="强制重新加载数据")
    args = parser.parse_args()

    ensure_dirs()

    print("=" * 70)
    print("  阶段对比实验: 吸附 vs 吸附+解析")
    print("  目标: 确定最佳数据段组合")
    print("=" * 70)

    store = PhaseResultStore()

    if args.summary:
        print_summary(store)
        return

    # 加载数据
    print(f"\n📥 加载完整周期数据...")
    t0 = time.time()
    samples = load_phase_data(ALL_RUNS, force_reload=args.reload)
    print(f"  ⏱️ 数据加载耗时: {time.time()-t0:.1f}s")

    # 概况
    pure_n = sum(1 for s in samples if s.is_pure)
    mix_n = len(samples) - pure_n
    gap_durs = [s.gap_dur_s for s in samples if s.gap_dur_s > 0]
    print(f"  纯样: {pure_n}, 混合: {mix_n}, 总计: {len(samples)}")
    if gap_durs:
        print(f"  Gap 时长: {np.mean(gap_durs):.1f}s (min={np.min(gap_durs):.1f}, max={np.max(gap_durs):.1f})")

    # 定义任务
    tasks = define_tasks(samples)
    print(f"\n📋 定义了 {len(tasks)} 个分类任务:")
    for t in tasks:
        print(f"  - {t['name']}: {t['desc']}")

    # 执行
    total_t0 = time.time()

    for task in tasks:
        y_names = [task["label_fn"](samples[i]) for i in task["indices"]]
        classes = sorted(set(y_names))
        label_map = {name: i for i, name in enumerate(classes)}
        n_classes = len(classes)

        task_config = {
            "n_samples": len(task["indices"]),
            "n_classes": n_classes,
            "classes": classes,
        }

        print(f"\n{'='*70}")
        print(f"  任务: {task['name']}")
        print(f"  样本: {len(task['indices'])}, 类别: {n_classes}")
        print(f"{'='*70}")

        # 统计已完成和待运行
        todo = []
        skip = []
        for cond in CONDITIONS:
            if store.is_done(task["name"], cond):
                skip.append(cond)
            else:
                todo.append(cond)

        if skip:
            print(f"  ⏩ 已完成: {skip}")
        if not todo:
            print(f"  ✅ 全部完成!")
            continue

        for cond in tqdm(todo, desc=f"  {task['name']}", unit="cond"):
            t0 = time.time()
            tqdm.write(f"  ⏳ {cond}: 构建数据集...")

            X, valid_idx = build_phase_dataset(
                samples, cond, task["indices"],
            )

            if X.shape[0] < 10:
                tqdm.write(f"    ⚠️ {cond}: 有效样本不足 ({X.shape[0]}), 跳过")
                continue

            y = np.array([label_map[task["label_fn"](samples[i])] for i in valid_idx])

            if len(np.unique(y)) < n_classes:
                tqdm.write(f"    ⚠️ {cond}: 类别不全, 跳过")
                continue

            tqdm.write(f"  ⏳ {cond}: 快速 ML 分类 ({X.shape[0]} 样本)...")
            ml_result = run_fast_ml(X, y)
            elapsed = time.time() - t0

            store.save(task["name"], task_config, cond,
                       n_samples=len(valid_idx),
                       ml_result=ml_result, elapsed_s=elapsed)

            tqdm.write(f"  ✅ {cond}: {ml_result['best_acc']:.1%} ({ml_result['best_combo']}) [{elapsed:.1f}s]")

    total_elapsed = time.time() - total_t0
    print(f"\n⏱️ 全部耗时: {total_elapsed:.1f}s ({total_elapsed/60:.1f}min)")

    print_summary(store)

    # 生成报告
    generate_report(store)


def generate_report(store: PhaseResultStore):
    """生成 Markdown 格式的文字报告"""
    report_path = RESULTS_DIR / "phase_study_report.md"

    lines = []
    lines.append("# 阶段对比实验报告")
    lines.append(f"\n> 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    lines.append("## 一、实验背景")
    lines.append("")
    lines.append("电子鼻每个采样周期包含多个阶段:")
    lines.append("1. **WASH** (~50s): 清洗阶段, 传感器恢复至基线")
    lines.append("2. **INJECT** (~15s): 注入液体, 传感器接近基线")
    lines.append("3. **ACQUIRE** (120s): 采集阶段, 传感器吸附响应")
    lines.append("")
    lines.append("当前截断实验仅使用 ACQUIRE 阶段数据。本实验探究:")
    lines.append("- 加入 ACQUIRE 后的解析/恢复数据 (WASH+INJECT) 是否能提升分类精度")
    lines.append("- 如果有提升, 用「头尾拼接」策略能否在减少数据量的同时保留精度")
    lines.append("")
    lines.append("## 二、实验条件")
    lines.append("")
    lines.append("| 条件 | 描述 | 时长 |")
    lines.append("|------|------|------|")
    lines.append("| `acquire_60` | ACQUIRE 前 60s | ~60s |")
    lines.append("| `acquire_only` | ACQUIRE 全部 | ~120s |")
    lines.append("| `acquire_wash` | ACQUIRE + WASH | ~170s |")
    lines.append("| `acquire_full_gap` | ACQUIRE + 完整 gap | ~180s |")
    lines.append("| `head_tail` | 前 30s + gap 尾 30s | ~60s |")
    lines.append("")
    lines.append("模型: LDA, SVM-rbf, RF-100, GBM (4 个代表性分类器)")
    lines.append("")
    lines.append("特征: stats, norm_stats, log_norm_stats, seg_norm (4 种统计特征)")
    lines.append("")

    lines.append("## 三、实验结果")
    lines.append("")

    for task_name, task in store.data.get("tasks", {}).items():
        cfg = task.get("config", {})
        conditions = task.get("conditions", {})
        n_classes = cfg.get("n_classes", "?")
        baseline = 100.0 / n_classes if isinstance(n_classes, int) and n_classes > 0 else 0

        lines.append(f"### {task_name}")
        lines.append(f"\n- 类别数: {n_classes}, 随机基线: {baseline:.1f}%")
        lines.append("")
        lines.append("| 条件 | 样本数 | 最佳精度 | 最佳模型组合 |")
        lines.append("|------|--------|----------|-------------|")

        for cond in CONDITIONS:
            if cond not in conditions:
                continue
            c = conditions[cond]
            lines.append(f"| `{cond}` | {c['n_samples']} | **{c['best_acc']:.1%}** | {c['best_combo']} |")

        # 对比分析
        acq_only = conditions.get("acquire_only", {}).get("best_acc", 0)
        if acq_only > 0:
            lines.append("")
            lines.append(f"以 `acquire_only` ({acq_only:.1%}) 为基线:")
            lines.append("")
            for cond in CONDITIONS:
                if cond == "acquire_only" or cond not in conditions:
                    continue
                other_acc = conditions[cond]["best_acc"]
                diff = other_acc - acq_only
                pct = diff / acq_only * 100 if acq_only > 0 else 0
                arrow = "↑ 提升" if diff > 0.005 else ("↓ 下降" if diff < -0.005 else "→ 持平")
                lines.append(f"- `{cond}`: {other_acc:.1%} ({diff:+.1%}, {pct:+.1f}%) {arrow}")

        lines.append("")

    # 结论
    lines.append("## 四、结论与建议")
    lines.append("")

    # 自动生成结论
    for task_name, task in store.data.get("tasks", {}).items():
        conditions = task.get("conditions", {})
        acq_only = conditions.get("acquire_only", {}).get("best_acc", 0)
        acq_wash = conditions.get("acquire_wash", {}).get("best_acc", 0)
        acq_full = conditions.get("acquire_full_gap", {}).get("best_acc", 0)
        head_tail = conditions.get("head_tail", {}).get("best_acc", 0)
        acq_60 = conditions.get("acquire_60", {}).get("best_acc", 0)

        lines.append(f"### {task_name}")
        lines.append("")

        # 解析是否有帮助
        best_with_gap = max(acq_wash, acq_full)
        if best_with_gap > acq_only + 0.02:
            lines.append(f"- ✅ **加入解析阶段有显著提升**: "
                         f"吸附+解析 {best_with_gap:.1%} vs 纯吸附 {acq_only:.1%} "
                         f"(+{best_with_gap - acq_only:.1%})")
            if head_tail > acq_only + 0.01:
                lines.append(f"- ✅ **头尾拼接策略有效**: {head_tail:.1%}, "
                             f"用 ~60s 数据接近 180s 的效果")
            else:
                lines.append(f"- ❌ **头尾拼接无效**: {head_tail:.1%}, "
                             f"不如完整解析数据")
        elif best_with_gap > acq_only + 0.005:
            lines.append(f"- ⚠️ **解析阶段轻微提升**: "
                         f"{best_with_gap:.1%} vs {acq_only:.1%} "
                         f"(+{best_with_gap - acq_only:.1%}), 提升有限")
        else:
            lines.append(f"- ❌ **解析阶段无显著帮助**: "
                         f"{best_with_gap:.1%} vs {acq_only:.1%}")

        # 推荐配置
        all_accs = {
            "acquire_60": acq_60, "acquire_only": acq_only,
            "acquire_wash": acq_wash, "acquire_full_gap": acq_full,
            "head_tail": head_tail,
        }
        best_cond = max(all_accs, key=all_accs.get)
        lines.append(f"- **推荐配置**: `{best_cond}` ({all_accs[best_cond]:.1%})")
        lines.append("")

    lines.append("## 五、方法说明")
    lines.append("")
    lines.append("- 数据对齐: PCHIP 插值到 100 个等距时间步")
    lines.append("- 交叉验证: 5-fold 分层 CV")
    lines.append("- 特征: 统计特征 (均值/std/min/max/斜率等) 和分段统计")
    lines.append("- 模型: LDA, SVM-rbf, RF-100, GBM")
    lines.append("")

    report = "\n".join(lines)

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"\n📝 报告已生成: {report_path}")


if __name__ == "__main__":
    main()
