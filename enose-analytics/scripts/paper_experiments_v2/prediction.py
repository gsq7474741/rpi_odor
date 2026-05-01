"""实验4: 比例预测模型对比 (§3.7)

从传感器响应反推拼配比例。对比手工特征 vs CARL 嵌入。

输出:
  - Table 5: 模型对比 (R², MAE, RMSE)
  - Fig.8: 预测 vs 实际比例散点图 (最佳模型)
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd

from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.model_selection import StratifiedKFold, LeaveOneGroupOut
from sklearn.neighbors import KNeighborsRegressor
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.svm import SVR
from sklearn.neural_network import MLPRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

import torch
import torch.nn as nn

from .config import (
    SEED, N_CV_FOLDS,
    TABLES_DIR, ensure_dirs,
)
from .data import PaperDataset
from .viz import init_style, save_fig

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ═══════════════════════════════════════════════════════════════
# 回归评估
# ═══════════════════════════════════════════════════════════════

def _eval_regression_cv(
    X: np.ndarray,
    y: np.ndarray,
    y_combo: np.ndarray,
    model_name: str,
    model,
    n_folds: int = N_CV_FOLDS,
) -> dict:
    """Stratified K-Fold 回归评估 (按组合分层)。"""
    le = LabelEncoder()
    y_strat = le.fit_transform(y_combo)

    # 确保每类有足够样本
    from collections import Counter
    counts = Counter(y_strat)
    min_count = min(counts.values())
    actual_folds = min(n_folds, min_count)
    if actual_folds < 2:
        return {"model": model_name, "r2": float("nan"), "mae": float("nan"), "rmse": float("nan")}

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=SEED)

    y_true_all = []
    y_pred_all = []

    for train_idx, test_idx in skf.split(X, y_strat):
        X_tr, X_te = X[train_idx], X[test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]

        pipe = Pipeline([("scaler", StandardScaler()), ("model", model)])
        try:
            pipe.fit(X_tr, y_tr)
            y_pred = pipe.predict(X_te)
        except Exception:
            y_pred = np.full(len(y_te), y_tr.mean())

        y_true_all.extend(y_te.tolist())
        y_pred_all.extend(y_pred.tolist())

    y_true_all = np.array(y_true_all)
    y_pred_all = np.array(y_pred_all)

    return {
        "model": model_name,
        "r2": round(r2_score(y_true_all, y_pred_all), 3),
        "mae": round(mean_absolute_error(y_true_all, y_pred_all), 4),
        "rmse": round(np.sqrt(mean_squared_error(y_true_all, y_pred_all)), 4),
        "y_true": y_true_all,
        "y_pred": y_pred_all,
    }


# ═══════════════════════════════════════════════════════════════
# 主运行
# ═══════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════
# 端到端 1D-CNN 回归器 (深度学习基线)
# ═══════════════════════════════════════════════════════════════

class _CNN1DRegressor(nn.Module):
    """端到端 1D-CNN 比例回归器, 结构与 CARL encoder 对齐。"""

    def __init__(self, in_channels: int = 8, n_combo_classes: int = 10):
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
        self.regressor = nn.Sequential(
            nn.Linear(128 + n_combo_classes, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(64, 32),
            nn.ReLU(inplace=True),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x, combo_oh):
        """x: (B, C, T), combo_oh: (B, n_combos) → ratio: (B,)"""
        h = self.conv_blocks(x)
        h = self.gap(h).squeeze(-1)  # (B, 128)
        h = torch.cat([h, combo_oh], dim=1)  # (B, 128+n_combos)
        return self.regressor(h).squeeze(-1)


def _train_cnn_regressor_fold(
    X_train: np.ndarray, y_train: np.ndarray, combo_oh_train: np.ndarray,
    X_test: np.ndarray, y_test: np.ndarray, combo_oh_test: np.ndarray,
    n_combo_classes: int, epochs: int = 200, lr: float = 1e-3,
) -> tuple[np.ndarray, np.ndarray]:
    """训练端到端 1D-CNN 回归器 (单个 fold)。"""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # baseline subtract then z-score (fit on train only)
    T = X_train.shape[1]
    bl = max(1, T // 10)
    base_tr = X_train[:, :bl, :].mean(axis=1, keepdims=True)
    X_tr_delta = (X_train - base_tr).astype(np.float32)
    from sklearn.preprocessing import StandardScaler as _SS
    _scaler = _SS()
    X_tr_n = _scaler.fit_transform(X_tr_delta.reshape(len(X_train), -1)).reshape(X_tr_delta.shape)

    base_te = X_test[:, :bl, :].mean(axis=1, keepdims=True)
    X_te_delta = (X_test - base_te).astype(np.float32)
    X_te_n = _scaler.transform(X_te_delta.reshape(len(X_test), -1)).reshape(X_te_delta.shape)

    X_tr_t = torch.tensor(X_tr_n).permute(0, 2, 1).to(device)
    X_te_t = torch.tensor(X_te_n).permute(0, 2, 1).to(device)
    y_tr_t = torch.tensor(y_train, dtype=torch.float32).to(device)
    oh_tr = torch.tensor(combo_oh_train, dtype=torch.float32).to(device)
    oh_te = torch.tensor(combo_oh_test, dtype=torch.float32).to(device)

    model = _CNN1DRegressor(in_channels=8, n_combo_classes=n_combo_classes).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for _ in range(epochs):
        pred = model(X_tr_t, oh_tr)
        loss = nn.functional.mse_loss(pred, y_tr_t)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        scheduler.step()

    model.eval()
    with torch.no_grad():
        y_pred = model(X_te_t, oh_te).cpu().numpy()
    return y_test, y_pred


def _eval_cnn_regressor_cv(
    X_raw: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    model_name: str,
    n_folds: int = N_CV_FOLDS,
) -> dict:
    """端到端 1D-CNN 回归器 Stratified K-Fold CV。"""
    le = LabelEncoder()
    y_strat = le.fit_transform(y_combo)
    from collections import Counter
    counts = Counter(y_strat)
    actual_folds = min(n_folds, min(counts.values()))
    if actual_folds < 2:
        return {"model": model_name, "r2": float("nan"), "mae": float("nan"), "rmse": float("nan")}

    ohe = OneHotEncoder(sparse_output=False)
    combo_oh = ohe.fit_transform(y_strat.reshape(-1, 1))
    n_combo_classes = combo_oh.shape[1]

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=SEED)
    y_true_all, y_pred_all = [], []
    for tr, te in skf.split(X_raw, y_strat):
        yt, yp = _train_cnn_regressor_fold(
            X_raw[tr], y_ratio[tr], combo_oh[tr],
            X_raw[te], y_ratio[te], combo_oh[te],
            n_combo_classes=n_combo_classes,
        )
        y_true_all.extend(yt.tolist())
        y_pred_all.extend(yp.tolist())

    y_true_all = np.array(y_true_all)
    y_pred_all = np.array(y_pred_all)
    return {
        "model": model_name,
        "r2": round(r2_score(y_true_all, y_pred_all), 3),
        "mae": round(mean_absolute_error(y_true_all, y_pred_all), 4),
        "rmse": round(np.sqrt(mean_squared_error(y_true_all, y_pred_all)), 4),
        "y_true": y_true_all,
        "y_pred": y_pred_all,
    }


# ═══════════════════════════════════════════════════════════════
# Per-combo 回归 (正确的问题建模)
# ═══════════════════════════════════════════════════════════════

def _eval_per_combo_regression(
    X: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    model_factory,
    model_name: str,
    n_folds: int = N_CV_FOLDS,
) -> dict:
    """按组合分别训练回归器, 汇总结果。

    每个 combo 内部做 CV; 汇总所有 combo 的预测结果计算整体 R²/MAE/RMSE。
    """
    y_true_all, y_pred_all = [], []
    combos = sorted(set(y_combo))

    for cid in combos:
        mask = y_combo == cid
        X_c, y_c = X[mask], y_ratio[mask]
        if len(y_c) < 4:
            continue

        actual_folds = min(n_folds, len(y_c))
        if actual_folds < 2:
            continue

        # 每个 combo 内 LOOCV 或 KFold
        from sklearn.model_selection import KFold
        kf = KFold(n_splits=actual_folds, shuffle=True, random_state=SEED)
        for tr, te in kf.split(X_c):
            pipe = Pipeline([("scaler", StandardScaler()), ("model", model_factory())])
            try:
                pipe.fit(X_c[tr], y_c[tr])
                preds = pipe.predict(X_c[te])
            except Exception:
                preds = np.full(len(te), y_c[tr].mean())
            y_true_all.extend(y_c[te].tolist())
            y_pred_all.extend(preds.tolist())

    y_true_all = np.array(y_true_all)
    y_pred_all = np.array(y_pred_all)

    if len(y_true_all) == 0:
        return {"model": model_name, "r2": float("nan"), "mae": float("nan"), "rmse": float("nan")}

    return {
        "model": model_name,
        "r2": round(r2_score(y_true_all, y_pred_all), 3),
        "mae": round(mean_absolute_error(y_true_all, y_pred_all), 4),
        "rmse": round(np.sqrt(mean_squared_error(y_true_all, y_pred_all)), 4),
        "y_true": y_true_all,
        "y_pred": y_pred_all,
    }


# ═══════════════════════════════════════════════════════════════
# Combo-conditioned 回归 (one-hot combo + 特征)
# ═══════════════════════════════════════════════════════════════

def _eval_combo_conditioned_cv(
    X: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    model_name: str,
    model,
    n_folds: int = N_CV_FOLDS,
) -> dict:
    """将 combo one-hot 拼接到特征, 做全局回归。"""
    le = LabelEncoder()
    combo_enc = le.fit_transform(y_combo)
    ohe = OneHotEncoder(sparse_output=False)
    combo_onehot = ohe.fit_transform(combo_enc.reshape(-1, 1))
    X_cond = np.hstack([X, combo_onehot])

    return _eval_regression_cv(X_cond, y_ratio, y_combo, model_name, model, n_folds)


# ═══════════════════════════════════════════════════════════════
# PyTorch MLP 回归器
# ═══════════════════════════════════════════════════════════════

class _RatioMLP(nn.Module):
    def __init__(self, in_dim: int, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden // 2, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


def _train_pytorch_mlp(
    X_train: np.ndarray, y_train: np.ndarray,
    X_test: np.ndarray, y_test: np.ndarray,
    epochs: int = 200, lr: float = 1e-3,
) -> tuple[np.ndarray, np.ndarray]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    scaler = StandardScaler()
    X_tr = torch.tensor(scaler.fit_transform(X_train), dtype=torch.float32, device=device)
    X_te = torch.tensor(scaler.transform(X_test), dtype=torch.float32, device=device)
    y_tr = torch.tensor(y_train, dtype=torch.float32, device=device)

    model = _RatioMLP(X_tr.shape[1]).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for _ in range(epochs):
        pred = model(X_tr)
        loss = nn.functional.mse_loss(pred, y_tr)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        scheduler.step()

    model.eval()
    with torch.no_grad():
        y_pred = model(X_te).cpu().numpy()
    return y_test, y_pred


def _eval_pytorch_cv(
    X: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    model_name: str,
    n_folds: int = N_CV_FOLDS,
) -> dict:
    le = LabelEncoder()
    y_strat = le.fit_transform(y_combo)
    from collections import Counter
    counts = Counter(y_strat)
    actual_folds = min(n_folds, min(counts.values()))
    if actual_folds < 2:
        return {"model": model_name, "r2": float("nan"), "mae": float("nan"), "rmse": float("nan")}

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=SEED)
    y_true_all, y_pred_all = [], []
    for tr, te in skf.split(X, y_strat):
        yt, yp = _train_pytorch_mlp(X[tr], y_ratio[tr], X[te], y_ratio[te])
        y_true_all.extend(yt.tolist())
        y_pred_all.extend(yp.tolist())

    y_true_all = np.array(y_true_all)
    y_pred_all = np.array(y_pred_all)
    return {
        "model": model_name,
        "r2": round(r2_score(y_true_all, y_pred_all), 3),
        "mae": round(mean_absolute_error(y_true_all, y_pred_all), 4),
        "rmse": round(np.sqrt(mean_squared_error(y_true_all, y_pred_all)), 4),
        "y_true": y_true_all,
        "y_pred": y_pred_all,
    }


# ═══════════════════════════════════════════════════════════════
# 主运行
# ═══════════════════════════════════════════════════════════════

def run(ds: PaperDataset, carl_embeddings: np.ndarray | None = None) -> dict:
    """运行实验4: 比例预测模型对比。"""
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  实验4: 比例预测模型对比")
    print("=" * 70)

    results = {}

    # ── 准备混合样数据 ──
    mix_idx = ds.mix_indices
    if len(mix_idx) < 20:
        print(f"  混合样不足 ({len(mix_idx)}), 跳过")
        return {"error": "insufficient_mix_samples"}

    y_ratio = np.array([ds.ratios[i] for i in mix_idx])
    y_combo = np.array([ds.combo_ids[i] for i in mix_idx])
    print(f"  混合样: {len(mix_idx)}, 组合: {len(set(y_combo))}")

    feat_name = "norm_stats"
    X_feat = ds.features[feat_name][0][mix_idx]
    all_results = []

    # ════════════════════════════════════════════════════
    # A. Per-combo 回归 (每个组合独立训练, 正确的问题建模)
    # ════════════════════════════════════════════════════
    print(f"  Per-combo 回归 (手工特征)...")
    for name, factory in [
        ("Ridge", lambda: Ridge(alpha=1.0)),
        ("SVR", lambda: SVR(kernel="rbf", C=10.0)),
        ("GBR", lambda: GradientBoostingRegressor(n_estimators=100, max_depth=3, random_state=SEED)),
    ]:
        res = _eval_per_combo_regression(X_feat, y_ratio, y_combo, factory, f"{name} (per-combo, HC)")
        all_results.append(res)
        print(f"    {name:12s}: R²={res['r2']:.3f}, MAE={res['mae']:.4f}, RMSE={res['rmse']:.4f}")

    # ════════════════════════════════════════════════════
    # B. Combo-conditioned 回归 (拼接 one-hot combo)
    # ════════════════════════════════════════════════════
    print(f"  Combo-conditioned 回归 (手工特征)...")
    for name, model in [
        ("Ridge+OH", Ridge(alpha=1.0)),
        ("GBR+OH", GradientBoostingRegressor(n_estimators=100, max_depth=3, random_state=SEED)),
        ("MLP+OH", MLPRegressor(hidden_layer_sizes=(128, 64), max_iter=500, random_state=SEED)),
    ]:
        res = _eval_combo_conditioned_cv(X_feat, y_ratio, y_combo, f"{name} (HC)", model)
        all_results.append(res)
        print(f"    {name:12s}: R²={res['r2']:.3f}, MAE={res['mae']:.4f}, RMSE={res['rmse']:.4f}")

    # ════════════════════════════════════════════════════
    # B2. 端到端 1D-CNN 回归 (DL 基线, 原始时序输入)
    # ════════════════════════════════════════════════════
    print(f"  端到端 1D-CNN 回归 (原始时序)...")
    X_raw_mix = ds.X_value[mix_idx]  # (n_mix, T, 8)
    res = _eval_cnn_regressor_cv(X_raw_mix, y_ratio, y_combo, "1D-CNN (end-to-end)")
    all_results.append(res)
    print(f"    1D-CNN:      R²={res['r2']:.3f}, MAE={res['mae']:.4f}, RMSE={res['rmse']:.4f}")

    # ════════════════════════════════════════════════════
    # C. CARL 嵌入回归
    # ════════════════════════════════════════════════════
    if carl_embeddings is not None:
        X_emb = carl_embeddings[mix_idx]

        # C1. Combo-conditioned on CARL
        print(f"  Combo-conditioned 回归 (CARL)...")
        le_c = LabelEncoder()
        combo_enc = le_c.fit_transform(y_combo)
        ohe = OneHotEncoder(sparse_output=False)
        combo_oh = ohe.fit_transform(combo_enc.reshape(-1, 1))

        res = _eval_combo_conditioned_cv(X_emb, y_ratio, y_combo, "MLP+OH (CARL)",
            MLPRegressor(hidden_layer_sizes=(128, 64), max_iter=500, random_state=SEED))
        all_results.append(res)
        print(f"    MLP+OH:      R²={res['r2']:.3f}, MAE={res['mae']:.4f}, RMSE={res['rmse']:.4f}")

        # C2. PyTorch MLP on CARL (combo-conditioned)
        print(f"  PyTorch MLP 回归 (CARL+combo)...")
        X_emb_cond = np.hstack([X_emb, combo_oh])
        res = _eval_pytorch_cv(X_emb_cond, y_ratio, y_combo, "DeepMLP (CARL+combo)")
        all_results.append(res)
        print(f"    DeepMLP:     R²={res['r2']:.3f}, MAE={res['mae']:.4f}, RMSE={res['rmse']:.4f}")

        # C3. 特征融合: CARL + 手工 + combo
        print(f"  PyTorch MLP 融合 (HC+CARL+combo)...")
        X_fused_cond = np.hstack([X_feat, X_emb, combo_oh])
        res = _eval_pytorch_cv(X_fused_cond, y_ratio, y_combo, "DeepMLP (fused+combo)")
        all_results.append(res)
        print(f"    Fused:       R²={res['r2']:.3f}, MAE={res['mae']:.4f}, RMSE={res['rmse']:.4f}")
    else:
        print(f"  CARL 嵌入不可用, 跳过基于嵌入的回归")

    # ── 结果汇总 ──
    all_results.sort(key=lambda x: -x["r2"] if not np.isnan(x["r2"]) else -999)
    results["model_comparison"] = [
        {k: v for k, v in r.items() if k not in ("y_true", "y_pred")}
        for r in all_results
    ]
    results["best_model"] = results["model_comparison"][0]["model"]
    results["best_r2"] = results["model_comparison"][0]["r2"]

    # CSV
    df = pd.DataFrame(results["model_comparison"])
    csv_path = TABLES_DIR / "table5_prediction.csv"
    df.to_csv(csv_path, index=False)
    print(f"  CSV → {csv_path.name}")

    # ── 预测 vs 实际散点图 (最佳模型) ──
    best_res = all_results[0]
    if "y_true" in best_res:
        init_style()
        fig, ax = plt.subplots(figsize=(5.5, 5.5))
        yt, yp = best_res["y_true"], best_res["y_pred"]
        ax.scatter(yt, yp, s=30, alpha=0.6, c="#0072B2", edgecolors="white", linewidth=0.5)
        lims = [0, 1]
        ax.plot(lims, lims, "k--", alpha=0.5, linewidth=1.6)
        ax.set_xlabel("True ratio")
        ax.set_ylabel("Predicted ratio")
        ax.set_title(f"{best_res['model']}\nR²={best_res['r2']:.3f}, MAE={best_res['mae']:.4f}")
        ax.set_xlim(-0.05, 1.05)
        ax.set_ylim(-0.05, 1.05)
        ax.set_aspect("equal")
        fig.tight_layout()
        save_fig(fig, "fig8_prediction_scatter", subdir="exp4")

    # ── 保存 ──
    json_path = TABLES_DIR / "exp4_prediction_results.json"
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"  JSON → {json_path.name}")

    # 摘要
    print(f"\n  === 实验4 结果摘要 ===")
    print(f"  最佳模型: {results['best_model']}, R²={results['best_r2']}")
    print(f"  模型数量: {len(all_results)}")
    print(f"  输出: table5_prediction, fig8_prediction_scatter")

    return results
