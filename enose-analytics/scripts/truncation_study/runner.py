"""实验编排模块 — 断点续作 + 结构化 JSON 输出 + tqdm 进度。

核心:
  ExperimentRunner  管理整个截断实验的执行流程
  ResultStore       管理结构化结果的持久化和断点续作
"""

from __future__ import annotations

import json
import time
import numpy as np
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from tqdm import tqdm

from .config import (
    RESULTS_DIR, TRUNCATION_SECONDS, GOOD_SENSORS,
    SEED, short, ensure_dirs,
)
from .data import SampleRaw, build_truncated
from .features import make_features
from .models import run_ml, run_dl, ModelResult


# ═══════════════════════════════════════════════════════════════
# 结果存储 (JSON, 支持断点续作)
# ═══════════════════════════════════════════════════════════════

class ResultStore:
    """结构化结果存储, 每次写入即持久化, 支持断点续作。

    JSON 结构:
    {
      "metadata": {...},
      "tasks": {
        "task_name": {
          "config": {...},
          "cutoffs": {
            "60": {
              "n_samples": 200,
              "ml_results": [...],
              "dl_results": [...],
              "best_ml_acc": 0.95,
              "best_dl_acc": 0.90,
              "elapsed_s": 12.3,
              "completed_at": "..."
            },
            ...
          }
        }
      }
    }
    """

    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            print(f"  📂 加载已有结果: {path.name}")
        else:
            self.data = {
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "description": "样本截断时间 vs 分类精度研究",
                },
                "tasks": {},
            }

    def is_done(self, task_name: str, cutoff_s: float, need_dl: bool = True) -> bool:
        """检查某个 (task, cutoff) 是否已完成。

        Args:
            need_dl: 如果为 True, 要求 DL 结果也存在才算完成
        """
        tasks = self.data.get("tasks", {})
        task = tasks.get(task_name, {})
        cutoffs = task.get("cutoffs", {})
        key = str(int(cutoff_s))
        if key not in cutoffs:
            return False
        if need_dl and not cutoffs[key].get("dl_results"):
            return False
        return True

    def save_cutoff_result(
        self,
        task_name: str,
        task_config: dict,
        cutoff_s: float,
        n_samples: int,
        ml_results: list[ModelResult],
        dl_results: list[ModelResult],
        elapsed_s: float,
    ):
        """保存一个 (task, cutoff) 的结果并立即写盘"""
        tasks = self.data.setdefault("tasks", {})
        task = tasks.setdefault(task_name, {"config": task_config, "cutoffs": {}})
        task["config"] = task_config  # 更新配置

        cutoff_key = str(int(cutoff_s))

        def _serialize_results(results: list[ModelResult]) -> list[dict]:
            return [
                {
                    "model": r.model_name,
                    "feature": r.feature_name,
                    "accuracy": round(r.accuracy, 4),
                    "std": round(r.std, 4),
                    "folds": [round(f, 4) for f in r.fold_scores],
                    "train_time_s": round(r.train_time_s, 2),
                    "type": r.model_type,
                }
                for r in results
            ]

        best_ml = max((r.accuracy for r in ml_results), default=0.0)
        best_dl = max((r.accuracy for r in dl_results), default=0.0)

        # 增量更新: 保留已有结果, 只更新新增部分
        existing = task["cutoffs"].get(cutoff_key, {})
        ml_data = _serialize_results(ml_results) if ml_results else existing.get("ml_results", [])
        dl_data = _serialize_results(dl_results) if dl_results else existing.get("dl_results", [])

        if not ml_results and existing.get("best_ml_acc"):
            best_ml = existing["best_ml_acc"]
        if not dl_results and existing.get("best_dl_acc"):
            best_dl = existing["best_dl_acc"]

        task["cutoffs"][cutoff_key] = {
            "n_samples": n_samples,
            "ml_results": ml_data,
            "dl_results": dl_data,
            "best_ml_acc": round(best_ml, 4),
            "best_dl_acc": round(best_dl, 4),
            "best_overall": round(max(best_ml, best_dl), 4),
            "elapsed_s": round(elapsed_s, 2),
            "completed_at": datetime.now().isoformat(),
        }

        self._flush()

    def _flush(self):
        """写盘"""
        self.data["metadata"]["updated_at"] = datetime.now().isoformat()
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def get_summary(self) -> str:
        """生成汇总文本"""
        lines = []
        for task_name, task in self.data.get("tasks", {}).items():
            cfg = task.get("config", {})
            n_classes = cfg.get("n_classes", "?")
            baseline = 1.0 / n_classes if isinstance(n_classes, int) and n_classes > 0 else 0
            lines.append(f"\n{'='*90}")
            lines.append(f"  {task_name} (随机基线={baseline:.1%})")
            lines.append(f"{'='*90}")
            lines.append(
                f"  {'截断(s)':<10} {'样本':<6} {'最佳ML':>8} {'ML模型':<25} "
                f"{'最佳DL':>8} {'DL模型':<15} {'最佳':>8}"
            )
            lines.append(f"  {'-'*85}")

            cutoffs = task.get("cutoffs", {})
            sorted_keys = sorted(cutoffs.keys(), key=lambda x: int(x))
            full_acc = 0.0

            for ck in sorted_keys:
                c = cutoffs[ck]
                # 找最佳 ML
                ml_best = max(c.get("ml_results", [{}]), key=lambda x: x.get("accuracy", 0), default={})
                dl_best = max(c.get("dl_results", [{}]), key=lambda x: x.get("accuracy", 0), default={})
                ml_desc = f"{ml_best.get('feature','?')}+{ml_best.get('model','?')}" if ml_best else "N/A"
                dl_desc = dl_best.get("model", "N/A") if dl_best else "N/A"
                best = c.get("best_overall", 0)
                if int(ck) == 120:
                    full_acc = best
                lines.append(
                    f"  {ck:<10} {c['n_samples']:<6} "
                    f"{c.get('best_ml_acc',0):>7.1%} {ml_desc:<25} "
                    f"{c.get('best_dl_acc',0):>7.1%} {dl_desc:<15} "
                    f"{best:>7.1%}"
                )

            # 拐点分析
            if full_acc > 0 and len(sorted_keys) > 2:
                lines.append(f"\n  完整 120s 精度: {full_acc:.1%}")
                for ck in sorted_keys:
                    c = cutoffs[ck]
                    best = c.get("best_overall", 0)
                    drop = full_acc - best
                    pct = drop / full_acc * 100
                    marker = ""
                    if pct > 10:
                        marker = " <-- 精度下降 >10%"
                    elif pct > 5:
                        marker = " <-- 精度下降 >5%"
                    elif pct > 2:
                        marker = " <-- 精度下降 >2%"
                    lines.append(
                        f"    {ck:>4}s: {best:.1%} (损失 {drop:.1%}, -{pct:.1f}%){marker}"
                    )

        return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# 实验运行器
# ═══════════════════════════════════════════════════════════════

class ExperimentRunner:
    """截断实验运行器"""

    def __init__(
        self,
        samples: list[SampleRaw],
        result_file: str = "truncation_results.json",
        cutoff_list: list[float] | None = None,
        n_workers: int = 4,
    ):
        ensure_dirs()
        self.samples = samples
        self.store = ResultStore(RESULTS_DIR / result_file)
        self.cutoff_list = cutoff_list or TRUNCATION_SECONDS
        self.n_workers = n_workers

    def run_task(
        self,
        task_name: str,
        indices: list[int],
        label_fn,
        skip_dl: bool = False,
    ):
        """运行一个分类任务的全部截断实验。

        Args:
            task_name: 任务名称
            indices: 该任务使用的样本索引
            label_fn: meta → str 标签函数
            skip_dl: 跳过 DL 模型
        """
        # 构建标签
        y_names = [label_fn(self.samples[i]) for i in indices]
        classes = sorted(set(y_names))
        label_map = {name: i for i, name in enumerate(classes)}
        n_classes = len(classes)

        task_config = {
            "n_samples": len(indices),
            "n_classes": n_classes,
            "classes": classes,
            "class_distribution": {c: y_names.count(c) for c in classes},
        }

        print(f"\n{'='*70}")
        print(f"  任务: {task_name}")
        print(f"  样本: {len(indices)}, 类别: {n_classes}")
        for c in classes:
            print(f"    {c}: {y_names.count(c)}")
        print(f"{'='*70}")

        # 统计需要跳过和需要运行的 cutoff
        todo_cutoffs = []
        skip_cutoffs = []
        need_dl = not skip_dl
        for cutoff_s in self.cutoff_list:
            if self.store.is_done(task_name, cutoff_s, need_dl=need_dl):
                skip_cutoffs.append(cutoff_s)
            else:
                todo_cutoffs.append(cutoff_s)

        if skip_cutoffs:
            print(f"  ⏩ 已完成 (跳过): {skip_cutoffs}")
        if not todo_cutoffs:
            print(f"  ✅ 该任务已全部完成!")
            return

        print(f"  📋 待运行: {todo_cutoffs}")

        # 逐 cutoff 运行
        outer_bar = tqdm(todo_cutoffs, desc=f"  {task_name}", unit="cutoff")
        for cutoff_s in outer_bar:
            outer_bar.set_postfix(cutoff=f"{cutoff_s}s")
            t0 = time.time()

            # 截断 + 对齐
            X_trunc, valid_idx = build_truncated(
                self.samples, cutoff_s, indices, n_workers=self.n_workers,
            )
            if X_trunc.shape[0] < 10:
                tqdm.write(f"    ⚠️ {cutoff_s}s: 有效样本不足 ({X_trunc.shape[0]}), 跳过")
                continue

            # 重建标签
            y_valid = np.array([label_map[label_fn(self.samples[i])] for i in valid_idx])
            if len(np.unique(y_valid)) < n_classes:
                tqdm.write(f"    ⚠️ {cutoff_s}s: 某些类缺失, 跳过")
                continue

            # 检查是否已有 ML 结果 (增量: 只补 DL)
            has_existing_ml = self.store.is_done(task_name, cutoff_s, need_dl=False)

            # 特征工程 + ML
            ml_results = []
            if not has_existing_ml:
                features = make_features(X_trunc)
                tqdm.write(f"  ⏳ {cutoff_s}s: ML 分类...")
                ml_results = run_ml(features, y_valid)
            else:
                tqdm.write(f"  ⏩ {cutoff_s}s: ML 已有结果, 跳过")

            # DL
            dl_results = []
            if not skip_dl:
                tqdm.write(f"  ⏳ {cutoff_s}s: DL 分类...")
                dl_results = run_dl(X_trunc, y_valid)

            elapsed = time.time() - t0

            # 保存
            self.store.save_cutoff_result(
                task_name, task_config, cutoff_s,
                n_samples=len(valid_idx),
                ml_results=ml_results,
                dl_results=dl_results,
                elapsed_s=elapsed,
            )

            # 实时打印
            best_ml = ml_results[0] if ml_results else None
            best_dl = dl_results[0] if dl_results else None
            ml_str = f"{best_ml.accuracy:.1%} ({best_ml.feature_name}+{best_ml.model_name})" if best_ml else "N/A"
            dl_str = f"{best_dl.accuracy:.1%} ({best_dl.model_name})" if best_dl else "N/A"
            tqdm.write(
                f"  ✅ {cutoff_s:>4}s | ML={ml_str} | DL={dl_str} | {elapsed:.1f}s"
            )

    def print_summary(self):
        """打印全部结果汇总"""
        summary = self.store.get_summary()
        print(summary)

        # 最终结论
        print(f"\n\n{'#'*90}")
        print(f"#  最终结论")
        print(f"{'#'*90}")

        for task_name, task in self.store.data.get("tasks", {}).items():
            cutoffs = task.get("cutoffs", {})
            if "120" not in cutoffs:
                continue
            full_acc = cutoffs["120"].get("best_overall", 0)
            if full_acc == 0:
                continue

            # 找精度损失 ≤5% 的最短时间
            min_time = None
            for ck in sorted(cutoffs.keys(), key=lambda x: int(x)):
                best = cutoffs[ck].get("best_overall", 0)
                drop_pct = (full_acc - best) / full_acc * 100
                if drop_pct <= 5:
                    min_time = int(ck)
                    min_acc = best
                    break

            if min_time:
                print(f"\n  {task_name}:")
                print(f"    完整 120s 精度: {full_acc:.1%}")
                print(f"    最短可接受时长 (精度损失<=5%): {min_time}s -> {min_acc:.1%}")
                print(f"    可压缩: {120 - min_time}s ({(120-min_time)/120*100:.0f}%)")
            else:
                print(f"\n  {task_name}: 所有截断时间精度损失均 >5%")
