"""ML/DL 分类器模块 — joblib 并行 ML + GPU 加速 DL。

输出: list[ModelResult] — 每个 (模型, 特征) 组合的 CV 结果
"""

from __future__ import annotations

import numpy as np
import time
from dataclasses import dataclass
from tqdm import tqdm

from .config import GOOD_SENSORS, SEED


@dataclass
class ModelResult:
    """单个 (模型, 特征) 组合的结果"""
    model_name: str
    feature_name: str
    accuracy: float
    std: float
    fold_scores: list[float]
    train_time_s: float
    model_type: str  # "ml" or "dl"


# ═══════════════════════════════════════════════════════════════
# ML 分类器 (sklearn + joblib 并行)
# ═══════════════════════════════════════════════════════════════

def _run_single_ml(X, y, clf_name, clf, skf):
    """单个 (特征, 分类器) 组合的 CV — 供 joblib 调用"""
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import cross_val_score

    pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
    try:
        scores = cross_val_score(pipe, X, y, cv=skf, scoring="accuracy")
        return scores.mean(), scores.std(), scores.tolist()
    except Exception as e:
        return 0.0, 0.0, []


def run_ml(
    features: dict[str, tuple[np.ndarray, str]],
    y: np.ndarray,
    n_folds: int = 5,
    seed: int = SEED,
) -> list[ModelResult]:
    """对每种特征 × 分类器组合做 Stratified K-Fold CV (joblib 并行)。"""
    from sklearn.model_selection import StratifiedKFold
    from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
    from sklearn.svm import SVC
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from joblib import Parallel, delayed

    unique_classes = np.unique(y)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    actual_folds = min(n_folds, min_class_count)
    if actual_folds < 2:
        return []

    classifiers = {
        "LDA": LinearDiscriminantAnalysis(),
        "SVM-rbf": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=seed),
        "RF-100": RandomForestClassifier(n_estimators=100, random_state=seed, n_jobs=1),
        "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=seed),
    }

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=seed)

    # 构建所有任务
    tasks = []
    for feat_name, (X, desc) in features.items():
        for clf_name, clf in classifiers.items():
            tasks.append((feat_name, clf_name, X, clf))

    t0 = time.time()

    # joblib 并行 — 每个 (特征, 分类器) 跑一个 CV
    raw_results = Parallel(n_jobs=-1, prefer="processes")(
        delayed(_run_single_ml)(X, y, clf_name, clf, skf)
        for feat_name, clf_name, X, clf in tqdm(tasks, desc="    ML CV", leave=False)
    )

    elapsed = time.time() - t0
    results = []
    for (feat_name, clf_name, _, _), (acc, std, folds) in zip(tasks, raw_results):
        results.append(ModelResult(
            model_name=clf_name, feature_name=feat_name,
            accuracy=acc, std=std, fold_scores=folds,
            train_time_s=elapsed / len(tasks),
            model_type="ml",
        ))

    results.sort(key=lambda r: -r.accuracy)
    return results


# ═══════════════════════════════════════════════════════════════
# DL 分类器 (PyTorch + GPU)
# ═══════════════════════════════════════════════════════════════

def _get_device():
    import torch
    if torch.cuda.is_available():
        dev = torch.device("cuda")
        print(f"    🚀 GPU: {torch.cuda.get_device_name(0)}")
    else:
        dev = torch.device("cpu")
        print(f"    💻 CPU mode")
    return dev


def _build_cnn1d(in_ch: int, n_classes: int):
    import torch.nn as nn
    return nn.Sequential(
        nn.Conv1d(in_ch, 32, kernel_size=7, padding=3),
        nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
        nn.Conv1d(32, 64, kernel_size=5, padding=2),
        nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
        nn.Conv1d(64, 128, kernel_size=3, padding=1),
        nn.BatchNorm1d(128), nn.ReLU(), nn.AdaptiveAvgPool1d(1),
        nn.Flatten(), nn.Dropout(0.3),
        nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, n_classes),
    )


def _build_mlp(in_dim: int, n_classes: int):
    import torch.nn as nn
    return nn.Sequential(
        nn.Linear(in_dim, 128), nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(0.3),
        nn.Linear(128, 64), nn.BatchNorm1d(64), nn.ReLU(), nn.Dropout(0.2),
        nn.Linear(64, n_classes),
    )


def _train_eval_fold(
    model, Xtr_t, ytr_t, Xte_t, yte_t, is_seq,
    n_epochs=200, lr=1e-3,
):
    """训练一个 fold, 返回 best test accuracy"""
    import torch
    import torch.nn as nn

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=n_epochs)
    criterion = nn.CrossEntropyLoss()

    best_acc = 0.0
    patience = 0

    model.train()
    for epoch in range(n_epochs):
        optimizer.zero_grad()
        out = model(Xtr_t.permute(0, 2, 1)) if is_seq else model(Xtr_t)
        loss = criterion(out, ytr_t)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        scheduler.step()

        if (epoch + 1) % 20 == 0:
            model.eval()
            with torch.no_grad():
                test_out = model(Xte_t.permute(0, 2, 1)) if is_seq else model(Xte_t)
                acc = (test_out.argmax(1) == yte_t).float().mean().item()
                if acc > best_acc:
                    best_acc = acc
                    patience = 0
                else:
                    patience += 1
            model.train()
            if patience >= 5:
                break

    return best_acc


def run_dl(
    X_raw: np.ndarray,
    y: np.ndarray,
    n_folds: int = 5,
    seed: int = SEED,
) -> list[ModelResult]:
    """运行 MLP + 1D-CNN 的 K-Fold CV (GPU 加速)。"""
    import torch
    from sklearn.model_selection import StratifiedKFold
    from sklearn.preprocessing import StandardScaler

    device = _get_device()
    N, T, C = X_raw.shape
    n_classes = len(np.unique(y))
    n_s = len(GOOD_SENSORS)

    unique_classes = np.unique(y)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    actual_folds = min(n_folds, min_class_count)
    if actual_folds < 2:
        return []

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=seed)

    # 准备输入数据
    X_val = X_raw[:, :, GOOD_SENSORS].astype(np.float32)
    bl = max(1, T // 10)
    baseline = X_val[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm = (X_val / baseline).astype(np.float32)

    configs = [
        ("MLP-norm",   "mlp",   X_norm.reshape(N, -1)),
        ("CNN1D-norm", "cnn1d", X_norm),
    ]

    results = []

    for name, model_type, X_input in configs:
        is_seq = model_type == "cnn1d"
        fold_accs = []
        t0 = time.time()

        pbar = tqdm(
            enumerate(skf.split(np.zeros(N), y)),
            total=actual_folds,
            desc=f"    DL {name}",
            leave=False,
        )

        for fold_idx, (train_idx, test_idx) in pbar:
            Xtr, Xte = X_input[train_idx], X_input[test_idx]
            ytr, yte = y[train_idx], y[test_idx]

            # Standardize
            sc = StandardScaler()
            if is_seq:
                orig_shape = Xtr.shape
                Xtr = sc.fit_transform(Xtr.reshape(Xtr.shape[0], -1)).astype(np.float32)
                Xte = sc.transform(Xte.reshape(Xte.shape[0], -1)).astype(np.float32)
                Xtr = np.nan_to_num(Xtr.reshape(orig_shape), nan=0.0)
                Xte = np.nan_to_num(Xte.reshape(Xte.shape[0], *orig_shape[1:]), nan=0.0)
            else:
                Xtr = np.nan_to_num(sc.fit_transform(Xtr), nan=0.0).astype(np.float32)
                Xte = np.nan_to_num(sc.transform(Xte), nan=0.0).astype(np.float32)

            Xtr_t = torch.tensor(Xtr, device=device)
            Xte_t = torch.tensor(Xte, device=device)
            ytr_t = torch.tensor(ytr, dtype=torch.long, device=device)
            yte_t = torch.tensor(yte, dtype=torch.long, device=device)

            in_ch = Xtr.shape[2] if is_seq else Xtr.shape[1]
            if model_type == "mlp":
                model = _build_mlp(in_ch, n_classes).to(device)
            else:
                model = _build_cnn1d(in_ch, n_classes).to(device)

            acc = _train_eval_fold(model, Xtr_t, ytr_t, Xte_t, yte_t, is_seq)
            fold_accs.append(acc)
            pbar.set_postfix(fold_acc=f"{acc:.1%}")

        elapsed = time.time() - t0
        results.append(ModelResult(
            model_name=name, feature_name="norm (内置)",
            accuracy=np.mean(fold_accs), std=np.std(fold_accs),
            fold_scores=fold_accs, train_time_s=elapsed,
            model_type="dl",
        ))

    results.sort(key=lambda r: -r.accuracy)
    return results
