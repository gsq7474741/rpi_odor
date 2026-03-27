"""Session-based 泛化评估 — 审稿意见第3点。

审稿人指出: 模型评估主要在同一总体数据上做分层交叉验证,
不足以证明模型能抗 session shift。

本模块实现:
  1. Leave-one-run-out: 按 run_id 划分训练/测试
  2. 按采集日分组的训练/测试划分
  3. 报告跨 session 泛化性能
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from collections import Counter

from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error
from sklearn.linear_model import Ridge

from .config import (
    SEED, PURE_RUNS, MIX_RUNS, FONT_SIZE,
    TABLES_DIR, FIGURES_DIR, ensure_dirs,
)
from .data import PaperDataset
from .viz import init_style, save_fig

np.random.seed(SEED)


def _get_run_groups(ds: PaperDataset) -> dict[int, list[int]]:
    """获取每个 run_id 包含的样本索引。"""
    run_to_idx = {}
    for i, rid in enumerate(ds.run_ids):
        run_to_idx.setdefault(rid, []).append(i)
    return run_to_idx


def leave_one_run_out_classification(
    ds: PaperDataset,
    carl_embeddings: np.ndarray | None = None,
) -> list[dict]:
    """Leave-one-run-out 纯茶分类评估。

    每次用一个 run 的纯茶样本作为测试集, 其余作为训练集。
    """
    print(f"  Leave-one-run-out 纯茶分类...")
    pure_idx = ds.pure_indices
    if len(pure_idx) < 20:
        return []

    run_ids_pure = np.array([ds.run_ids[i] for i in pure_idx])
    y_pure = np.array([ds.tea_ids[i] for i in pure_idx])
    unique_runs = sorted(set(run_ids_pure))

    results = []

    for feat_name in ["norm_stats"]:
        X_feat = ds.features[feat_name][0][pure_idx]

        fold_results = []
        for test_run in unique_runs:
            test_mask = run_ids_pure == test_run
            train_mask = ~test_mask

            if test_mask.sum() < 3 or train_mask.sum() < 10:
                continue

            # Check all classes present in train
            if len(set(y_pure[train_mask])) < 5:
                continue

            scaler = StandardScaler()
            X_tr = scaler.fit_transform(X_feat[train_mask])
            X_te = scaler.transform(X_feat[test_mask])

            knn = KNeighborsClassifier(n_neighbors=5)
            knn.fit(X_tr, y_pure[train_mask])
            y_pred = knn.predict(X_te)
            acc = accuracy_score(y_pure[test_mask], y_pred)
            fold_results.append({
                "test_run": int(test_run),
                "n_test": int(test_mask.sum()),
                "accuracy": round(acc * 100, 1),
            })

        if fold_results:
            mean_acc = np.mean([r["accuracy"] for r in fold_results])
            std_acc = np.std([r["accuracy"] for r in fold_results])
            results.append({
                "feature": f"HC ({feat_name})",
                "method": "k-NN",
                "mean_accuracy": round(mean_acc, 1),
                "std_accuracy": round(std_acc, 1),
                "n_folds": len(fold_results),
                "folds": fold_results,
            })
            print(f"    HC k-NN: {mean_acc:.1f} ± {std_acc:.1f}% ({len(fold_results)} runs)")

    # CARL embeddings
    if carl_embeddings is not None:
        X_emb = carl_embeddings[pure_idx]
        fold_results = []
        for test_run in unique_runs:
            test_mask = run_ids_pure == test_run
            train_mask = ~test_mask
            if test_mask.sum() < 3 or train_mask.sum() < 10:
                continue
            if len(set(y_pure[train_mask])) < 5:
                continue

            scaler = StandardScaler()
            X_tr = scaler.fit_transform(X_emb[train_mask])
            X_te = scaler.transform(X_emb[test_mask])

            knn = KNeighborsClassifier(n_neighbors=5)
            knn.fit(X_tr, y_pure[train_mask])
            y_pred = knn.predict(X_te)
            acc = accuracy_score(y_pure[test_mask], y_pred)
            fold_results.append({
                "test_run": int(test_run),
                "n_test": int(test_mask.sum()),
                "accuracy": round(acc * 100, 1),
            })

        if fold_results:
            mean_acc = np.mean([r["accuracy"] for r in fold_results])
            std_acc = np.std([r["accuracy"] for r in fold_results])
            results.append({
                "feature": "CARL embedding",
                "method": "k-NN",
                "mean_accuracy": round(mean_acc, 1),
                "std_accuracy": round(std_acc, 1),
                "n_folds": len(fold_results),
                "folds": fold_results,
            })
            print(f"    CARL k-NN: {mean_acc:.1f} ± {std_acc:.1f}% ({len(fold_results)} runs)")

    return results


def leave_one_run_out_regression(
    ds: PaperDataset,
    carl_embeddings: np.ndarray | None = None,
) -> list[dict]:
    """Leave-one-run-out 比例回归评估 (混合样)。"""
    print(f"  Leave-one-run-out 比例回归...")
    mix_idx = ds.mix_indices
    if len(mix_idx) < 20:
        return []

    run_ids_mix = np.array([ds.run_ids[i] for i in mix_idx])
    y_ratio = np.array([ds.ratios[i] for i in mix_idx])
    y_combo = np.array([ds.combo_ids[i] for i in mix_idx])
    unique_runs = sorted(set(run_ids_mix))

    results = []

    # Hand-crafted features
    X_feat = ds.features["norm_stats"][0][mix_idx]
    le = LabelEncoder()
    combo_enc = le.fit_transform(y_combo)
    from sklearn.preprocessing import OneHotEncoder
    ohe = OneHotEncoder(sparse_output=False)
    combo_oh = ohe.fit_transform(combo_enc.reshape(-1, 1))
    X_feat_cond = np.hstack([X_feat, combo_oh])

    fold_results = []
    for test_run in unique_runs:
        test_mask = run_ids_mix == test_run
        train_mask = ~test_mask
        if test_mask.sum() < 3 or train_mask.sum() < 20:
            continue

        scaler = StandardScaler()
        X_tr = scaler.fit_transform(X_feat_cond[train_mask])
        X_te = scaler.transform(X_feat_cond[test_mask])

        model = Ridge(alpha=1.0)
        model.fit(X_tr, y_ratio[train_mask])
        y_pred = model.predict(X_te)
        r2 = r2_score(y_ratio[test_mask], y_pred)
        mae = mean_absolute_error(y_ratio[test_mask], y_pred)
        fold_results.append({
            "test_run": int(test_run),
            "n_test": int(test_mask.sum()),
            "r2": round(r2, 3),
            "mae": round(mae, 4),
        })

    if fold_results:
        mean_r2 = np.mean([r["r2"] for r in fold_results])
        mean_mae = np.mean([r["mae"] for r in fold_results])
        results.append({
            "feature": "HC+combo (Ridge)",
            "mean_r2": round(mean_r2, 3),
            "mean_mae": round(mean_mae, 4),
            "n_folds": len(fold_results),
            "folds": fold_results,
        })
        print(f"    HC Ridge: R²={mean_r2:.3f}, MAE={mean_mae:.4f} ({len(fold_results)} runs)")

    # CARL embeddings
    if carl_embeddings is not None:
        X_emb = carl_embeddings[mix_idx]
        X_emb_cond = np.hstack([X_emb, combo_oh])

        fold_results = []
        for test_run in unique_runs:
            test_mask = run_ids_mix == test_run
            train_mask = ~test_mask
            if test_mask.sum() < 3 or train_mask.sum() < 20:
                continue

            scaler = StandardScaler()
            X_tr = scaler.fit_transform(X_emb_cond[train_mask])
            X_te = scaler.transform(X_emb_cond[test_mask])

            model = Ridge(alpha=1.0)
            model.fit(X_tr, y_ratio[train_mask])
            y_pred = model.predict(X_te)
            r2 = r2_score(y_ratio[test_mask], y_pred)
            mae = mean_absolute_error(y_ratio[test_mask], y_pred)
            fold_results.append({
                "test_run": int(test_run),
                "n_test": int(test_mask.sum()),
                "r2": round(r2, 3),
                "mae": round(mae, 4),
            })

        if fold_results:
            mean_r2 = np.mean([r["r2"] for r in fold_results])
            mean_mae = np.mean([r["mae"] for r in fold_results])
            results.append({
                "feature": "CARL+combo (Ridge)",
                "mean_r2": round(mean_r2, 3),
                "mean_mae": round(mean_mae, 4),
                "n_folds": len(fold_results),
                "folds": fold_results,
            })
            print(f"    CARL Ridge: R²={mean_r2:.3f}, MAE={mean_mae:.4f} ({len(fold_results)} runs)")

    return results


def run(ds: PaperDataset, carl_embeddings: np.ndarray | None = None) -> dict:
    """运行 session-based 泛化评估。"""
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  Session-based 泛化评估")
    print("=" * 70)

    # Run distribution
    run_counts = Counter(ds.run_ids)
    print(f"  Run 分布:")
    for rid in sorted(run_counts):
        n = run_counts[rid]
        n_pure = sum(1 for i, r in enumerate(ds.run_ids)
                     if r == rid and ds.pure_mask[i])
        n_mix = sum(1 for i, r in enumerate(ds.run_ids)
                    if r == rid and ds.mix_mask[i])
        print(f"    Run {rid}: {n} 样本 (纯={n_pure}, 混合={n_mix})")

    results = {}

    # Classification
    clf_results = leave_one_run_out_classification(ds, carl_embeddings)
    results["classification"] = clf_results

    # Regression
    reg_results = leave_one_run_out_regression(ds, carl_embeddings)
    results["regression"] = reg_results

    # Save
    json_path = TABLES_DIR / "exp_session_generalization.json"
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n  JSON → {json_path.name}")

    # Summary table
    summary_rows = []
    for r in clf_results:
        summary_rows.append({
            "task": "Pure tea classification",
            "feature": r["feature"],
            "metric": f"{r['mean_accuracy']:.1f} ± {r['std_accuracy']:.1f}%",
            "n_folds": r["n_folds"],
        })
    for r in reg_results:
        summary_rows.append({
            "task": "Ratio prediction",
            "feature": r["feature"],
            "metric": f"R²={r['mean_r2']:.3f}, MAE={r['mean_mae']:.4f}",
            "n_folds": r["n_folds"],
        })

    if summary_rows:
        df = pd.DataFrame(summary_rows)
        csv_path = TABLES_DIR / "table_session_generalization.csv"
        df.to_csv(csv_path, index=False)
        print(f"  CSV → {csv_path.name}")

    # Plot: per-run accuracy bars
    if clf_results:
        _plot_per_run_accuracy(clf_results)

    print(f"\n  === Session-based 泛化结果摘要 ===")
    for r in clf_results:
        print(f"    {r['feature']}: {r['mean_accuracy']:.1f} ± {r['std_accuracy']:.1f}%")
    for r in reg_results:
        print(f"    {r['feature']}: R²={r['mean_r2']:.3f}")

    return results


def _plot_per_run_accuracy(clf_results: list[dict]):
    """Per-run accuracy bar chart."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    init_style()

    fig, ax = plt.subplots(figsize=(7, 4.5))

    for i, res in enumerate(clf_results):
        folds = res["folds"]
        runs = [f["test_run"] for f in folds]
        accs = [f["accuracy"] for f in folds]
        offset = (i - len(clf_results) / 2 + 0.5) * 0.35
        ax.bar(
            [r + offset for r in range(len(runs))],
            accs, width=0.3,
            label=res["feature"], alpha=0.8,
        )
        ax.set_xticks(range(len(runs)))
        ax.set_xticklabels([f"Run {r}" for r in runs], rotation=45, ha="right")

    ax.set_ylabel("Accuracy (%)")
    ax.set_title("Leave-one-run-out classification")
    ax.legend(fontsize=FONT_SIZE - 2)
    fig.tight_layout()
    save_fig(fig, "fig_session_generalization", subdir="exp_session")
