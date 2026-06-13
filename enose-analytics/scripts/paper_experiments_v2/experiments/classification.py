"""§3.3 Tea Identity Classification (v2) — 叉乘实验设计。

Cross-product:  Representation × Downstream-Head {k-NN, SVM-RBF}

  Representations:
    - HC (norm_stats)            手工特征
    - 1D-CNN                     端到端 (无冻结嵌入)
    - TS2Vec                     自监督
    - Autoencoder                自监督
    - SimCLR                     自监督
    - TS2Vec+SoftSupCon          配方监督
    - AE+SoftSupCon              配方监督
    - SimCLR+SoftSupCon          配方监督
    - CARL (ours)                配方监督 (Conv1D+SE+SoftSupCon+域增强)

  补充: HC 额外报告 LDA / RF / GBM 分类器。

同时生成 §3.1 描述性图表 (PCA, radar)。

输出:
  - Table 2: table2_classification_v2.csv   (wide: k-NN & SVM-RBF columns)
  - fig_pca_pure_v2, fig_radar_pure_v2, fig_confusion_v2
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from pathlib import Path

from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score, f1_score
from sklearn.pipeline import Pipeline

from ..config import (
    SEED, N_CV_FOLDS, N_SENSORS,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN,
    TABLES_DIR, ensure_dirs,
)
from ..data import PaperDataset
from ..viz import init_style, save_fig, plot_pca_scatter, plot_radar, plot_confusion_matrix
from ..baselines import run_all_baselines_v2, run_supervised_baselines_v2, _cls_metrics, _summarize_cv_metrics, _eval_cnn_cv

import torch

np.random.seed(SEED)


# ═══════════════════════════════════════════════════════════════
# §3.1 描述性分析 (PCA + radar)
# ═══════════════════════════════════════════════════════════════

def _run_descriptive(ds, pure_idx, X_feat, tea_ids_pure, figures_dir):
    """§3.1: PCA scatter + radar chart。"""
    print("  §3.1 描述性分析 (PCA + radar)...")
    results = {}

    # PCA
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_feat)
    pca = PCA(n_components=2, random_state=SEED)
    X_pca = pca.fit_transform(X_scaled)
    var1 = pca.explained_variance_ratio_[0] * 100
    var2 = pca.explained_variance_ratio_[1] * 100
    results["pca_var_pc1"] = round(var1, 1)
    results["pca_var_pc2"] = round(var2, 1)
    print(f"    PCA: {var1:.1f}% + {var2:.1f}% = {var1 + var2:.1f}%")

    fig_pca = plot_pca_scatter(
        X_pca[:, 0], X_pca[:, 1], tea_ids_pure, (var1, var2),
        title="PCA of single-tea sensor responses",
    )
    _save(fig_pca, "fig_pca_pure_v2", figures_dir)

    # Radar
    X_value_pure = ds.X_value[pure_idx]
    T = X_value_pure.shape[1]
    bl = max(1, T // 10)
    baseline = X_value_pure[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm = X_value_pure / baseline
    half = T // 2
    radar_means = {}
    for tid in sorted(set(tea_ids_pure)):
        mask = tea_ids_pure == tid
        radar_means[tid] = X_norm[mask][:, half:, :].mean(axis=(0, 1))
    fig_radar = plot_radar(radar_means, title="Mean normalised sensor responses per tea")
    _save(fig_radar, "fig_radar_pure_v2", figures_dir)

    return results


# ═══════════════════════════════════════════════════════════════
# §3.3 分类对比 (Table 2)
# ═══════════════════════════════════════════════════════════════

def run(
    ds: PaperDataset,
    tables_dir: Path,
    figures_dir: Path,
    only_models: list[str] | None = None,
    carl_epochs: int | None = None,
) -> dict:
    """运行 §3.3: 叉乘分类对比 (Representation × {k-NN, SVM-RBF})."""
    print("\n" + "=" * 70)
    print("  §3.3 Tea Identity Classification (v2 — cross-product)")
    print("=" * 70)

    results = {}

    # ── 准备纯样数据 ──
    pure_idx = ds.pure_indices
    X_value_pure = ds.X_value[pure_idx]
    tea_ids_pure = np.array([ds.tea_ids[i] for i in pure_idx])
    le = LabelEncoder()
    y = le.fit_transform(tea_ids_pure)
    n_classes = len(le.classes_)

    n_pure = len(pure_idx)
    print(f"  纯样: {n_pure}, 类别: {n_classes}")
    results["n_pure"] = n_pure

    feat_name = "norm_stats"
    X_feat = ds.features[feat_name][0][pure_idx]

    # §3.1 描述性
    desc = _run_descriptive(ds, pure_idx, X_feat, tea_ids_pure, figures_dir)
    results.update(desc)

    # ── Table 2: wide format (representation × downstream) ──
    # columns: category, representation, params, k-NN, SVM-RBF
    table_rows: list[dict] = []
    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)

    # ─────────────────────────────────────────────────
    # Handcrafted features — k-NN, SVM-RBF, LDA, RF
    # ─────────────────────────────────────────────────
    print("  HC (norm_stats) × {LDA, RF, SVM-RBF, k-NN}...")
    hc_clf_factories = {
        "LDA": lambda: LinearDiscriminantAnalysis(),
        "RF": lambda: RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1),
        "SVM-RBF": lambda: SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED),
        "k-NN": lambda: KNeighborsClassifier(n_neighbors=5),
    }
    hc_metrics: dict[str, dict[str, str | float]] = {}
    hc_preds: dict[str, np.ndarray] = {}  # per-sample predictions for SM
    for cname, clf_factory in hc_clf_factories.items():
        y_pred_hc = np.zeros_like(y, dtype=int)
        fold_ms: list[dict[str, float]] = []
        for tr_idx, te_idx in skf.split(X_feat, y):
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf_factory())])
            pipe.fit(X_feat[tr_idx], y[tr_idx])
            yp = pipe.predict(X_feat[te_idx])
            y_pred_hc[te_idx] = yp
            fold_ms.append(_cls_metrics(y[te_idx], yp))
        hc_preds[cname] = y_pred_hc
        m = _summarize_cv_metrics(fold_ms)
        hc_metrics[cname] = m
        print(f"    HC + {cname}: acc={m['acc']}, f1={m['f1']}")
        table_rows.append({
            "category": "Handcrafted", "representation": f"HC + {cname}",
            "params": "—", **m,
        })
    results["hc_metrics"] = hc_metrics
    best_hc_name = max(hc_metrics, key=lambda k: hc_metrics[k]["acc_mean"])
    best_hc_acc = hc_metrics[best_hc_name]["acc"]

    # ───────────────────────────────────────────────────
    # End-to-end DL (1D-CNN)
    # ───────────────────────────────────────────────────
    print("  1D-CNN (end-to-end)...")
    cnn_acc, cnn_preds, cnn_fold_ms = _eval_cnn_cv(X_value_pure, y, n_classes)
    cnn_m = _summarize_cv_metrics(cnn_fold_ms)
    from ..baselines import _CNN1DClassifier
    _dummy = _CNN1DClassifier(in_channels=8, n_classes=n_classes)
    cnn_params = sum(p.numel() for p in _dummy.parameters()) / 1000
    print(f"    1D-CNN: acc={cnn_m['acc']}, f1={cnn_m['f1']} ({cnn_params:.1f}K params)")
    table_rows.append({
        "category": "End-to-end", "representation": "1D-CNN",
        "params": f"{cnn_params:.1f}K", **cnn_m,
    })

    # ───────────────────────────────────────────────────
    # Self-supervised × {k-NN, SVM-RBF}
    # ───────────────────────────────────────────────────
    print("  Self-supervised × {SVM-RBF}...")
    ss_results = run_all_baselines_v2(ds.X_value, pure_idx, y, epochs=200)
    ss_name_map = {
        "TS2Vec_embedding": ("TS2Vec", f"{_count_params_ts2vec():.1f}K"),
        "Autoencoder_embedding": ("Autoencoder", f"{_count_params_ae():.1f}K"),
        "SimCLR_embedding": ("SimCLR", f"{_count_params_vanilla():.1f}K"),
    }
    for r in ss_results:
        name, params = ss_name_map.get(r["feature"], (r["feature"], "—"))
        svm_m = r["SVM-RBF"]  # dict with mean±std strings + acc_mean
        table_rows.append({
            "category": "Self-supervised", "representation": f"{name} + SVM-RBF",
            "params": params, **svm_m,
        })
    results["ss_full"] = ss_results

    # ───────────────────────────────────────────────────
    # Composition-supervised × {k-NN, SVM-RBF}
    # ───────────────────────────────────────────────────
    print("  Composition-supervised × {SVM-RBF}...")
    compositions = _build_compositions(ds)
    sup_results = run_supervised_baselines_v2(
        ds.X_value, compositions, pure_idx, y, epochs=200)
    sup_param_map = {
        "TS2Vec+SoftSupCon": f"{_count_params_ts2vec():.1f}K",
        "AE+SoftSupCon": f"{_count_params_ae():.1f}K",
        "SimCLR+SoftSupCon": f"{_count_params_vanilla():.1f}K",
    }
    for r in sup_results:
        name = r["feature"]
        svm_m = r["SVM-RBF"]  # dict with mean±std strings + acc_mean
        table_rows.append({
            "category": "Comp-supervised", "representation": f"{name} + SVM-RBF",
            "params": sup_param_map.get(name, "—"),
            **svm_m,
        })
    results["sup_full"] = sup_results

    # ───────────────────────────────────────────────────
    # CARL (this work) — nested CV × {k-NN, SVM-RBF} + fine-tuning
    # ───────────────────────────────────────────────────
    print("  CARL (nested 5-fold CV) × {k-NN, SVM-RBF} + fine-tuning...")
    from ..carl_training import (
        CARLEncoder, train_carl_on_subset, extract_embeddings_with_scaler,
    )
    from ..carl_finetune import finetune_classifier

    y_pred_knn = np.zeros_like(y, dtype=int)
    y_pred_svm = np.zeros_like(y, dtype=int)
    y_pred_ft = np.zeros_like(y, dtype=int)
    carl_fold_svm: list[dict[str, float]] = []
    carl_fold_ft: list[dict[str, float]] = []
    for fold, (tr_idx, te_idx) in enumerate(skf.split(X_feat, y)):
        global_test = pure_idx[te_idx]
        carl_mask = np.ones(ds.n_total, dtype=bool)
        carl_mask[global_test] = False

        encoder, scaler = train_carl_on_subset(
            ds, carl_mask, verbose=(fold == 0))
        emb = extract_embeddings_with_scaler(encoder, ds, scaler)

        # k-NN
        pipe_knn = Pipeline([
            ("sc", StandardScaler()),
            ("clf", KNeighborsClassifier(n_neighbors=5)),
        ])
        pipe_knn.fit(emb[pure_idx[tr_idx]], y[tr_idx])
        yp_knn_fold = pipe_knn.predict(emb[global_test])
        y_pred_knn[te_idx] = yp_knn_fold

        # SVM-RBF
        pipe_svm = Pipeline([
            ("sc", StandardScaler()),
            ("clf", SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED)),
        ])
        pipe_svm.fit(emb[pure_idx[tr_idx]], y[tr_idx])
        yp_svm_fold = pipe_svm.predict(emb[global_test])
        y_pred_svm[te_idx] = yp_svm_fold
        carl_fold_svm.append(_cls_metrics(y[te_idx], yp_svm_fold))

        # Fine-tuning (task-adaptive: oversampling + mixup + label smoothing + TTA)
        preds_ft, acc_ft = finetune_classifier(
            encoder, scaler, ds,
            tr=tr_idx, te=te_idx,
            n_classes=n_classes,
            epochs=200, lr=1e-3,
            freeze_backbone=False,
            tta_augments=20,
            print_every=100,
        )
        y_pred_ft[te_idx] = preds_ft
        carl_fold_ft.append(_cls_metrics(y[te_idx], preds_ft))

        del encoder
        torch.cuda.empty_cache()
        print(f"    fold {fold+1}/{N_CV_FOLDS} done (FT acc={acc_ft:.1f}%)")

    carl_svm_m = _summarize_cv_metrics(carl_fold_svm)
    carl_ft_m = _summarize_cv_metrics(carl_fold_ft)
    print(f"    CARL frozen SVM: acc={carl_svm_m['acc']}, f1={carl_svm_m['f1']}")
    print(f"    CARL fine-tune:  acc={carl_ft_m['acc']}, f1={carl_ft_m['f1']}")

    _dummy_carl = CARLEncoder(in_channels=8)
    carl_params = sum(p.numel() for p in _dummy_carl.parameters()) / 1000
    table_rows.append({
        "category": "CARL (ours)", "representation": "CARL + SVM-RBF (frozen)",
        "params": f"{carl_params:.1f}K", **carl_svm_m,
    })
    table_rows.append({
        "category": "CARL (ours)", "representation": "CARL (fine-tuning)",
        "params": f"{carl_params:.1f}K", **carl_ft_m,
    })
    results["carl_ft_metrics"] = carl_ft_m

    # ── 保存 Table 2 (4-metric format) ──
    df = pd.DataFrame(table_rows)
    csv_path = tables_dir / "table2_classification_v2.csv"
    df.to_csv(csv_path, index=False)
    print(f"  Table 2 -> {csv_path.name}")

    results["table2"] = table_rows

    # 找全局最佳 (by acc_mean)
    best_acc, best_label = 0.0, ""
    for row in table_rows:
        val = row.get("acc_mean", 0)
        if isinstance(val, (int, float)) and val > best_acc:
            best_acc = val
            best_label = row["representation"]
    results["best_accuracy"] = best_acc
    results["best_method"] = best_label

    # ── 混淆矩阵 (CARL SVM-RBF) ──
    cm = confusion_matrix(y, y_pred_svm)
    fig_cm = plot_confusion_matrix(
        cm, list(le.classes_),
        title=f"Confusion (CARL + SVM-RBF, {carl_svm_m['acc']})",
    )
    _save(fig_cm, "fig_confusion_v2", figures_dir)

    # ── 保存 per-sample 预测 (SM 使用) ──
    npz_path = tables_dir / "cls_predictions_v2.npz"
    npz_data = {
        "y_true": y,                        # (n_pure,) int — encoded labels
        "labels": le.classes_,               # ['T1','T2',...]
        "y_pred_carl_svm": y_pred_svm,      # (n_pure,) int — nested CV
        "y_pred_carl_ft": y_pred_ft,        # (n_pure,) int — nested CV
    }
    for cname, preds in hc_preds.items():
        npz_data[f"y_pred_hc_{cname.lower().replace('-', '_')}"] = preds
    np.savez(npz_path, **npz_data)
    print(f"  Per-sample predictions -> {npz_path.name}")

    # ── 保存 JSON ──
    _save_json(results, tables_dir / "exp_classification_v2.json")

    print(f"\n  === §3.3 结果摘要 ===")
    print(f"  全局最佳: {best_label} → {best_acc:.1f}%")
    print(f"  HC best: HC + {best_hc_name} → {best_hc_acc}")
    print(f"  CARL frozen SVM: {carl_svm_m['acc']}")
    print(f"  CARL fine-tune:  {carl_ft_m['acc']}")

    return results


# ── helpers ──

_TEA_INDEX = {"T1": 0, "T2": 1, "T3": 2, "T4": 3, "T5": 4}


def _build_compositions(ds: PaperDataset) -> np.ndarray:
    N = ds.n_total
    compositions = np.zeros((N, 5), dtype=np.float32)
    for i in range(N):
        if ds.pure_mask[i]:
            compositions[i, _TEA_INDEX[ds.tea_ids[i]]] = 1.0
        else:
            parts = ds.combo_ids[i].split("-")
            if len(parts) == 2:
                r = ds.ratios[i]
                compositions[i, _TEA_INDEX[parts[0]]] = r
                compositions[i, _TEA_INDEX[parts[1]]] = 1.0 - r
    return compositions


def _count_params_ts2vec():
    from ..baselines import TS2VecEncoder, EMBED_DIM
    m = TS2VecEncoder(in_channels=8, embed_dim=EMBED_DIM)
    return sum(p.numel() for p in m.parameters()) / 1000


def _count_params_vanilla():
    from ..baselines import _VanillaEncoder, EMBED_DIM
    m = _VanillaEncoder(in_channels=8, embed_dim=EMBED_DIM)
    return sum(p.numel() for p in m.parameters()) / 1000


def _count_params_ae():
    from ..baselines import _AEEncoder, EMBED_DIM
    m = _AEEncoder(in_channels=8, embed_dim=EMBED_DIM)
    return sum(p.numel() for p in m.parameters()) / 1000


def _save(fig, name, figures_dir):
    import matplotlib.pyplot as plt
    for fmt in ["pdf", "png"]:
        fig.savefig(figures_dir / f"{name}.{fmt}", dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"    -> {name}")


def _save_json(obj, path):
    def _conv(o):
        if isinstance(o, (np.floating, np.float64, np.float32)):
            return float(o)
        if isinstance(o, (np.integer, np.int64, np.int32)):
            return int(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        return o
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(obj, default=_conv)), f, indent=2, ensure_ascii=False)
