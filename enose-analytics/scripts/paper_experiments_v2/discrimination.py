"""实验1: 单茶辨识能力验证 (§3.1)

输出:
  - Fig.1a: PCA 散点图 (5 类, 前 2 主成分)
  - Fig.1b: 雷达图 (8 通道均值响应)
  - Table 2: SVM 5-fold CV 分类结果 + 混淆矩阵
  - fig1c_confusion_matrix.pdf
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix,
)
from sklearn.pipeline import Pipeline

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset

from .config import (
    SEED, N_CV_FOLDS, N_SENSORS, GOOD_SENSORS,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN,
    tea_label, tea_short,
    TABLES_DIR, ensure_dirs,
)
from .data import PaperDataset
from .viz import (
    init_style, save_fig,
    plot_pca_scatter, plot_radar, plot_confusion_matrix,
)
from .baselines import run_all_baselines, run_supervised_baselines


# ═══════════════════════════════════════════════════════════════
# 1D-CNN 分类器 (深度学习基线)
# ═══════════════════════════════════════════════════════════════

class _CNN1DClassifier(nn.Module):
    """轻量 1D-CNN 分类器, 结构与 CARL encoder 对齐便于公平对比。"""

    def __init__(self, in_channels: int = 8, n_classes: int = 5):
        super().__init__()
        self.conv_blocks = nn.Sequential(
            nn.Conv1d(in_channels, 32, kernel_size=7, padding=3),
            nn.BatchNorm1d(32), nn.ReLU(inplace=True), nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64), nn.ReLU(inplace=True), nn.MaxPool1d(2),
            nn.Conv1d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm1d(128), nn.ReLU(inplace=True),
        )
        self.gap = nn.AdaptiveAvgPool1d(1)
        self.classifier = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(64, n_classes),
        )

    def forward(self, x):
        """x: (B, C, T) → logits: (B, n_classes)"""
        h = self.conv_blocks(x)
        h = self.gap(h).squeeze(-1)
        return self.classifier(h)


def _train_cnn_fold(
    X_train: np.ndarray, y_train: np.ndarray,
    X_test: np.ndarray, y_test: np.ndarray,
    n_classes: int, epochs: int = 150, lr: float = 1e-3,
) -> np.ndarray:
    """训练 1D-CNN 分类器 (单个 fold)。

    Args:
        X_train/X_test: (N, T, 8) 原始时序
        y_train/y_test: (N,) 整数标签
    Returns:
        y_pred: (N_test,) 预测标签
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # baseline subtract then z-score (fit on train only)
    T = X_train.shape[1]
    bl = max(1, T // 10)
    base_tr = X_train[:, :bl, :].mean(axis=1, keepdims=True)
    X_tr_delta = (X_train - base_tr).astype(np.float32)
    scaler = StandardScaler()
    X_tr_norm = scaler.fit_transform(X_tr_delta.reshape(len(X_train), -1)).reshape(X_tr_delta.shape)

    base_te = X_test[:, :bl, :].mean(axis=1, keepdims=True)
    X_te_delta = (X_test - base_te).astype(np.float32)
    X_te_norm = scaler.transform(X_te_delta.reshape(len(X_test), -1)).reshape(X_te_delta.shape)

    # (N, T, 8) → (N, 8, T)
    X_tr_t = torch.tensor(X_tr_norm, dtype=torch.float32).permute(0, 2, 1).to(device)
    y_tr_t = torch.tensor(y_train, dtype=torch.long).to(device)
    X_te_t = torch.tensor(X_te_norm, dtype=torch.float32).permute(0, 2, 1).to(device)

    model = _CNN1DClassifier(in_channels=8, n_classes=n_classes).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    train_ds = TensorDataset(X_tr_t, y_tr_t)
    train_loader = DataLoader(train_ds, batch_size=32, shuffle=True, drop_last=False)

    model.train()
    for _ in range(epochs):
        for xb, yb in train_loader:
            logits = model(xb)
            loss = F.cross_entropy(logits, yb)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        scheduler.step()

    model.eval()
    with torch.no_grad():
        logits = model(X_te_t)
        y_pred = logits.argmax(dim=1).cpu().numpy()
    return y_pred


def _eval_cnn_cv(
    X_raw: np.ndarray, y: np.ndarray,
    n_classes: int, n_folds: int = N_CV_FOLDS,
) -> tuple[float, np.ndarray, list[dict[str, float]]]:
    """1D-CNN 分类器 Stratified K-Fold CV。

    Args:
        X_raw: (N, T, 8) 原始时序
        y: (N,) 整数标签
    Returns:
        (overall_accuracy, y_pred_all, per_fold_metrics)
    """
    from .baselines import _cls_metrics

    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=SEED)
    y_pred_all = np.empty_like(y)
    fold_metrics: list[dict[str, float]] = []

    for fold, (train_idx, test_idx) in enumerate(skf.split(X_raw, y)):
        y_pred = _train_cnn_fold(
            X_raw[train_idx], y[train_idx],
            X_raw[test_idx], y[test_idx],
            n_classes=n_classes,
        )
        y_pred_all[test_idx] = y_pred
        fold_metrics.append(_cls_metrics(y[test_idx], y_pred))

    return accuracy_score(y, y_pred_all), y_pred_all, fold_metrics


def run(ds: PaperDataset, carl_embeddings: np.ndarray | None = None) -> dict:
    """运行实验1: 单茶辨识。

    Args:
        ds: PaperDataset

    Returns:
        结果字典, 包含所有数值结果供后续填入论文
    """
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  实验1: 单茶辨识能力验证")
    print("=" * 70)

    results = {}

    # ── 提取纯样数据 ──
    pure_idx = ds.pure_indices
    X_value_pure = ds.X_value[pure_idx]    # (n_pure, T, 8)
    tea_ids_pure = np.array([ds.tea_ids[i] for i in pure_idx])

    n_pure = len(pure_idx)
    print(f"  纯样数量: {n_pure}")
    for tid in sorted(set(tea_ids_pure)):
        n = (tea_ids_pure == tid).sum()
        print(f"    {tid}: {n}")

    results["n_pure"] = n_pure
    results["class_counts"] = {
        tid: int((tea_ids_pure == tid).sum())
        for tid in sorted(set(tea_ids_pure))
    }

    # ── 1. 手工特征 (用 norm_stats, 被 truncation study 验证为最佳) ──
    best_feat_name = "norm_stats"
    X_feat = ds.features[best_feat_name][0][pure_idx]  # (n_pure, D)
    print(f"  特征: {best_feat_name}, shape={X_feat.shape}")

    # 标签编码
    le = LabelEncoder()
    y = le.fit_transform(tea_ids_pure)
    class_names = list(le.classes_)

    # ── 2. PCA ──
    print(f"  PCA...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_feat)
    pca = PCA(n_components=2, random_state=SEED)
    X_pca = pca.fit_transform(X_scaled)

    var_explained = (
        pca.explained_variance_ratio_[0] * 100,
        pca.explained_variance_ratio_[1] * 100,
    )
    results["pca_var_pc1"] = round(var_explained[0], 1)
    results["pca_var_pc2"] = round(var_explained[1], 1)
    results["pca_var_total"] = round(sum(var_explained), 1)
    print(f"    PC1: {var_explained[0]:.1f}%, PC2: {var_explained[1]:.1f}%")

    fig_pca = plot_pca_scatter(
        X_pca[:, 0], X_pca[:, 1],
        tea_ids_pure, var_explained,
        title="PCA of single-tea sensor responses",
    )
    save_fig(fig_pca, "fig1a_pca_pure", subdir="exp1")

    # ── 3. 雷达图 (8 通道 ΔR/R₀ 均值) ──
    print(f"  雷达图...")
    # baseline normalize: X / mean(前10%)
    T = X_value_pure.shape[1]
    bl = max(1, T // 10)
    baseline = X_value_pure[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm_pure = X_value_pure / baseline

    # 每种茶的 8 通道稳态均值 (后 50% 时段)
    half = T // 2
    radar_means = {}
    for tid in sorted(set(tea_ids_pure)):
        mask = tea_ids_pure == tid
        X_tea = X_norm_pure[mask]  # (n_i, T, 8)
        steady = X_tea[:, half:, :].mean(axis=(0, 1))  # (8,)
        radar_means[tid] = steady

    results["radar_means"] = {k: v.tolist() for k, v in radar_means.items()}

    fig_radar = plot_radar(
        radar_means,
        title="Mean normalized sensor responses per tea",
    )
    save_fig(fig_radar, "fig1b_radar_pure", subdir="exp1")

    # ── 4. 多分类器对比 (5-fold CV) ──
    print(f"  分类器对比...")
    classifiers = {
        "k-NN": KNeighborsClassifier(n_neighbors=5),
        "LDA": LinearDiscriminantAnalysis(),
        "SVM-RBF": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED),
        "RF": RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1),
        "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=SEED),
    }

    # 在多种特征上测试
    feature_sets = {
        "norm_stats": ds.features["norm_stats"][0][pure_idx],
        "stats": ds.features["stats"][0][pure_idx],
        "log_norm_stats": ds.features["log_norm_stats"][0][pure_idx],
    }

    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
    clf_results = []

    for feat_name, X_f in feature_sets.items():
        for clf_name, clf in classifiers.items():
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
            y_pred = cross_val_predict(pipe, X_f, y, cv=skf)
            acc = accuracy_score(y, y_pred)
            clf_results.append({
                "feature": feat_name,
                "classifier": clf_name,
                "accuracy": round(acc * 100, 1),
            })
            print(f"    {feat_name:18s} + {clf_name:8s}: {acc:.1%}")

    # ── 4b. 1D-CNN 深度学习分类器 (原始时序输入) ──
    print(f"  1D-CNN 分类器 (端到端)...")
    n_classes = len(set(y))
    cnn_acc, cnn_preds, _ = _eval_cnn_cv(X_value_pure, y, n_classes)
    clf_results.append({
        "feature": "raw_timeseries",
        "classifier": "1D-CNN",
        "accuracy": round(cnn_acc * 100, 1),
    })
    print(f"    {'raw_timeseries':18s} + {'1D-CNN':8s}: {cnn_acc:.1%}")

    # ── 4c. 自监督/无监督基线 (TS2Vec, AE, Vanilla Contrastive) ──
    print(f"  自监督基线 (在全部数据上训练, 纯样上评估)...")
    baseline_results = run_all_baselines(ds.X_value, pure_idx, y, epochs=200)
    clf_results.extend(baseline_results)

    # ── 4c2. 监督基线 (同 backbone + Soft SupCon 组成向量监督) ──
    print(f"  监督基线 (Soft SupCon, 同 backbone)...")
    _TEA_IDX = {"T1": 0, "T2": 1, "T3": 2, "T4": 3, "T5": 4}
    N_all = ds.n_total
    compositions = np.zeros((N_all, 5), dtype=np.float32)
    for _i in range(N_all):
        if ds.pure_mask[_i]:
            compositions[_i, _TEA_IDX[ds.tea_ids[_i]]] = 1.0
        else:
            _parts = ds.combo_ids[_i].split("-")
            if len(_parts) == 2:
                _r = ds.ratios[_i]
                compositions[_i, _TEA_IDX[_parts[0]]] = _r
                compositions[_i, _TEA_IDX[_parts[1]]] = 1.0 - _r
    sup_results = run_supervised_baselines(ds.X_value, compositions, pure_idx, y, epochs=200)
    clf_results.extend(sup_results)

    # ── 4d. CARL embedding + k-NN / SVM (如果嵌入可用) ──
    if carl_embeddings is not None:
        print(f"  CARL 嵌入分类器...")
        X_carl_pure = carl_embeddings[pure_idx]
        for clf_name, clf in [
            ("k-NN", KNeighborsClassifier(n_neighbors=5)),
            ("SVM-RBF", SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED)),
        ]:
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
            y_pred_carl = cross_val_predict(pipe, X_carl_pure, y, cv=skf)
            acc_carl = accuracy_score(y, y_pred_carl)
            clf_results.append({
                "feature": "CARL_embedding",
                "classifier": clf_name,
                "accuracy": round(acc_carl * 100, 1),
            })
            print(f"    {'CARL_embedding':18s} + {clf_name:8s}: {acc_carl:.1%}")

    clf_results.sort(key=lambda x: -x["accuracy"])
    results["classifier_comparison"] = clf_results
    results["best_accuracy"] = clf_results[0]["accuracy"]
    results["best_model"] = f"{clf_results[0]['feature']} + {clf_results[0]['classifier']}"

    # ── 5. 最佳模型的详细结果 (混淆矩阵) ──
    # 找到最佳传统 ML 模型用于混淆矩阵绘制
    best_ml = next(
        (r for r in clf_results if r["feature"] in feature_sets and r["classifier"] in classifiers),
        clf_results[0],
    )
    if best_ml["feature"] in feature_sets and best_ml["classifier"] in classifiers:
        X_best = feature_sets[best_ml["feature"]]
        clf_best = classifiers[best_ml["classifier"]]
        pipe_best = Pipeline([("scaler", StandardScaler()), ("clf", clf_best)])
        y_pred_best = cross_val_predict(pipe_best, X_best, y, cv=skf)
    elif cnn_preds is not None and clf_results[0]["classifier"] == "1D-CNN":
        y_pred_best = cnn_preds
    else:
        y_pred_best = cross_val_predict(
            Pipeline([("scaler", StandardScaler()), ("clf", SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED))]),
            X_feat, y, cv=skf,
        )
    best = clf_results[0]
    cm = confusion_matrix(y, y_pred_best)
    report = classification_report(y, y_pred_best, target_names=class_names, output_dict=True)

    results["confusion_matrix"] = cm.tolist()
    results["classification_report"] = {
        k: {kk: round(vv, 3) for kk, vv in v.items()} if isinstance(v, dict) else round(v, 3)
        for k, v in report.items()
    }

    # 混淆矩阵图
    fig_cm = plot_confusion_matrix(
        cm, class_names,
        title=f"Confusion matrix ({best['classifier']}, {best['accuracy']}%)",
    )
    save_fig(fig_cm, "fig1c_confusion_matrix", subdir="exp1")

    # ── 6. 保存表格数据 ──
    table_path = TABLES_DIR / "table2_classification.json"
    with open(table_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"  表格数据 → {table_path.name}")

    # CSV 版本 (方便导入 LaTeX)
    df = pd.DataFrame(clf_results)
    csv_path = TABLES_DIR / "table2_classification.csv"
    df.to_csv(csv_path, index=False)
    print(f"  CSV → {csv_path.name}")

    # ── 摘要 ──
    print(f"\n  === 实验1 结果摘要 ===")
    print(f"  纯样: {n_pure}")
    print(f"  PCA: PC1={var_explained[0]:.1f}%, PC2={var_explained[1]:.1f}%")
    print(f"  最佳: {results['best_model']} → {results['best_accuracy']}%")
    print(f"  输出: fig1a_pca, fig1b_radar, fig1c_confusion, table2")

    return results
