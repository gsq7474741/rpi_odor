"""§3.4 Blend Ratio Prediction (v2) — 叉乘实验设计。

Cross-product:  Representation × Downstream-Regressor {SVR, DeepMLP}

  Representations:
    - HC (norm_stats)            手工特征
    - 1D-CNN                     端到端
    - TS2Vec / AE / SimCLR       自监督 (训练在全部数据上, 无泄露)
    - TS2Vec+SSC / AE+SSC / SimCLR+SSC   配方监督 (nested CV)
    - CARL (ours)                配方监督 (nested CV)

  Downstream: {SVR, DeepMLP} (all combo-conditioned)

Metrics: R², MAE, RMSE  (5-fold stratified CV).

Outputs:
  - table3_regression_v2.csv   (wide format)
  - fig_pred_scatter_v2.pdf
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from pathlib import Path
from collections import Counter

from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.model_selection import StratifiedKFold
from sklearn.svm import SVR
from sklearn.pipeline import Pipeline
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

import torch
import torch.nn as nn
import torch.nn.functional as F

from ..config import SEED, N_CV_FOLDS
from ..data import PaperDataset
from ..viz import init_style
from ..prediction import (
    _eval_combo_conditioned_cv,
    _eval_cnn_regressor_cv,
)

np.random.seed(SEED)


# ═══════════════════════════════════════════════════════════════
# DeepMLP (4 hidden layers, paper spec)
# ═══════════════════════════════════════════════════════════════

class _DeepMLP(nn.Module):
    """4-hidden-layer MLP: in→256→128→64→32→1(sigmoid)."""

    def __init__(self, in_dim: int, hidden: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(hidden, hidden // 2),
            nn.BatchNorm1d(hidden // 2), nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(hidden // 2, hidden // 4),
            nn.BatchNorm1d(hidden // 4), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(hidden // 4, hidden // 8),
            nn.ReLU(),
            nn.Linear(hidden // 8, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


def _train_deep_mlp_fold(
    X_train: np.ndarray, y_train: np.ndarray,
    X_test: np.ndarray, y_test: np.ndarray,
    epochs: int = 300, lr: float = 1e-3,
) -> tuple[np.ndarray, np.ndarray]:
    """Train DeepMLP for one CV fold."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    scaler = StandardScaler()
    X_tr = torch.tensor(scaler.fit_transform(X_train), dtype=torch.float32, device=device)
    X_te = torch.tensor(scaler.transform(X_test), dtype=torch.float32, device=device)
    y_tr = torch.tensor(y_train, dtype=torch.float32, device=device)

    model = _DeepMLP(X_tr.shape[1]).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_loss, best_state, patience_ctr = float("inf"), None, 0

    model.train()
    for _ in range(epochs):
        pred = model(X_tr)
        loss = nn.functional.mse_loss(pred, y_tr)
        optimizer.zero_grad(); loss.backward(); optimizer.step()
        scheduler.step()
        if loss.item() < best_loss:
            best_loss = loss.item()
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_ctr = 0
        else:
            patience_ctr += 1
            if patience_ctr >= 30:
                break

    if best_state:
        model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        y_pred = model(X_te).cpu().numpy()
    return y_test, y_pred


def _eval_deep_mlp_cv(
    X: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    model_name: str,
    n_folds: int = N_CV_FOLDS,
) -> dict:
    """DeepMLP stratified k-fold CV."""
    le = LabelEncoder()
    y_strat = le.fit_transform(y_combo)
    counts = Counter(y_strat)
    actual_folds = min(n_folds, min(counts.values()))
    if actual_folds < 2:
        return {"model": model_name, "r2": float("nan"), "mae": float("nan"), "rmse": float("nan")}

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=SEED)
    y_true_all, y_pred_all = [], []

    for tr, te in skf.split(X, y_strat):
        yt, yp = _train_deep_mlp_fold(X[tr], y_ratio[tr], X[te], y_ratio[te])
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
# 叉乘回归辅助
# ═══════════════════════════════════════════════════════════════

def _make_combo_features(X: np.ndarray, y_combo: np.ndarray) -> np.ndarray:
    """Append combo one-hot to feature matrix (for non-nested-CV methods)."""
    le = LabelEncoder()
    ohe = OneHotEncoder(sparse_output=False)
    c = le.fit_transform(y_combo)
    oh = ohe.fit_transform(c.reshape(-1, 1))
    return np.hstack([X, oh])


class _LSTMRegressor(nn.Module):
    """Bidirectional LSTM + attention pooling + combo-conditioned regressor."""

    def __init__(self, in_channels: int = 8, hidden: int = 64, n_layers: int = 2,
                 n_combo_classes: int = 10):
        super().__init__()
        self.lstm = nn.LSTM(in_channels, hidden, n_layers,
                            batch_first=True, bidirectional=True, dropout=0.2)
        self.attn = nn.Linear(hidden * 2, 1)
        out_dim = hidden * 2  # 128
        self.regressor = nn.Sequential(
            nn.Linear(out_dim + n_combo_classes, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(64, 32),
            nn.ReLU(inplace=True),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x, combo_oh):
        """x: (B, C, T), combo_oh: (B, n_combos) → ratio: (B,)"""
        x = x.permute(0, 2, 1)  # (B, T, C)
        h, _ = self.lstm(x)     # (B, T, 128)
        w = torch.softmax(self.attn(h), dim=1)  # (B, T, 1)
        pooled = (h * w).sum(dim=1)  # (B, 128)
        feat = torch.cat([pooled, combo_oh], dim=1)
        return self.regressor(feat).squeeze(-1)


def _eval_lstm_regressor_cv(
    X_raw: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    n_folds: int = N_CV_FOLDS,
    epochs: int = 200,
) -> dict:
    """LSTM-Attn end-to-end regressor with stratified K-Fold CV."""
    from collections import Counter

    le = LabelEncoder()
    y_strat = le.fit_transform(y_combo)
    counts = Counter(y_strat)
    actual_folds = min(n_folds, min(counts.values()))
    if actual_folds < 2:
        return {"r2": float("nan"), "mae": float("nan"), "rmse": float("nan")}

    ohe = OneHotEncoder(sparse_output=False)
    combo_oh = ohe.fit_transform(y_strat.reshape(-1, 1))
    n_combo_classes = combo_oh.shape[1]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=SEED)
    y_true_all, y_pred_all = [], []

    for tr, te in skf.split(X_raw, y_strat):
        # Preprocess
        T = X_raw.shape[1]
        bl = max(1, T // 10)
        base_tr = X_raw[tr][:, :bl, :].mean(axis=1, keepdims=True)
        X_tr_d = (X_raw[tr] - base_tr).astype(np.float32)
        sc = StandardScaler()
        X_tr_n = sc.fit_transform(X_tr_d.reshape(len(tr), -1)).reshape(X_tr_d.shape)

        base_te = X_raw[te][:, :bl, :].mean(axis=1, keepdims=True)
        X_te_d = (X_raw[te] - base_te).astype(np.float32)
        X_te_n = sc.transform(X_te_d.reshape(len(te), -1)).reshape(X_te_d.shape)

        X_tr_t = torch.tensor(X_tr_n).permute(0, 2, 1).to(device)
        X_te_t = torch.tensor(X_te_n).permute(0, 2, 1).to(device)
        y_tr_t = torch.tensor(y_ratio[tr], dtype=torch.float32).to(device)
        oh_tr = torch.tensor(combo_oh[tr], dtype=torch.float32).to(device)
        oh_te = torch.tensor(combo_oh[te], dtype=torch.float32).to(device)

        model = _LSTMRegressor(in_channels=8, n_combo_classes=n_combo_classes).to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

        model.train()
        for _ in range(epochs):
            pred = model(X_tr_t, oh_tr)
            loss = nn.functional.mse_loss(pred, y_tr_t)
            optimizer.zero_grad(); loss.backward(); optimizer.step()
            scheduler.step()

        model.eval()
        with torch.no_grad():
            y_pred = model(X_te_t, oh_te).cpu().numpy()
        y_true_all.extend(y_ratio[te].tolist())
        y_pred_all.extend(y_pred.tolist())

    yt = np.array(y_true_all)
    yp = np.array(y_pred_all)
    return {
        "r2": round(r2_score(yt, yp), 3),
        "mae": round(mean_absolute_error(yt, yp), 4),
        "rmse": round(np.sqrt(mean_squared_error(yt, yp)), 4),
    }


def _eval_svr_combo_cv(X, y_ratio, y_combo, n_folds=N_CV_FOLDS) -> dict:
    """SVR (combo-conditioned) with stratified CV — returns {r2, mae, rmse}."""
    return _eval_combo_conditioned_cv(
        X, y_ratio, y_combo, "_", SVR(kernel="rbf", C=10.0))


def _eval_mlp_combo_cv(X, y_ratio, y_combo, n_folds=N_CV_FOLDS) -> dict:
    """DeepMLP (combo-conditioned) with stratified CV — returns {r2, mae, rmse}."""
    X_combo = _make_combo_features(X, y_combo)
    return _eval_deep_mlp_cv(X_combo, y_ratio, y_combo, "_", n_folds)


def _metrics(y_true, y_pred) -> dict:
    """Standard regression metrics."""
    return {
        "r2": round(r2_score(y_true, y_pred), 3),
        "mae": round(mean_absolute_error(y_true, y_pred), 4),
        "rmse": round(np.sqrt(mean_squared_error(y_true, y_pred)), 4),
    }


def _nested_cv_reg_supervised(
    arch: str,
    ds: "PaperDataset",
    mix_idx: np.ndarray,
    y_ratio: np.ndarray,
    y_combo: np.ndarray,
    epochs: int = 200,
    batch_size: int = 64,
) -> dict:
    """Per-fold composition-supervised training + {SVR, DeepMLP} regression.

    Returns {"SVR": {r2, mae, rmse}, "DeepMLP": {r2, mae, rmse}}.
    """
    from ..baselines import (
        TS2VecEncoder, _AEEncoder, _VanillaEncoder,
        _SoftSupConLoss, _carl_augment, EMBED_DIM,
    )
    from torch.utils.data import DataLoader, TensorDataset

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Build composition vectors for all samples
    compositions = _build_compositions(ds)

    le_strat = LabelEncoder()
    y_strat = le_strat.fit_transform(y_combo)
    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)

    y_pred_svr = np.zeros_like(y_ratio, dtype=np.float32)
    y_pred_mlp = np.zeros_like(y_ratio, dtype=np.float32)

    for fold, (tr_local, te_local) in enumerate(skf.split(mix_idx, y_strat)):
        global_test = mix_idx[te_local]

        # Training indices: everything except test mix samples
        train_mask = np.ones(ds.n_total, dtype=bool)
        train_mask[global_test] = False
        tr_global = np.where(train_mask)[0]

        # Preprocess: baseline subtract + z-score, fit on train only
        X_all = ds.X_value
        T = X_all.shape[1]
        bl = max(1, T // 10)

        X_tr_raw = X_all[tr_global]
        base_tr = X_tr_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_tr_d = (X_tr_raw - base_tr).astype(np.float32)
        scaler = StandardScaler()
        X_tr_n = scaler.fit_transform(
            X_tr_d.reshape(len(tr_global), -1)).reshape(X_tr_d.shape)

        # Test mix: preprocess with train scaler
        X_te_raw = X_all[global_test]
        base_te = X_te_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_te_d = (X_te_raw - base_te).astype(np.float32)
        X_te_n = scaler.transform(
            X_te_d.reshape(len(global_test), -1)).reshape(X_te_d.shape)

        # Train mix: preprocess (for embedding extraction)
        tr_mix_global = mix_idx[tr_local]
        X_trmix_raw = X_all[tr_mix_global]
        base_trmix = X_trmix_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_trmix_d = (X_trmix_raw - base_trmix).astype(np.float32)
        X_trmix_n = scaler.transform(
            X_trmix_d.reshape(len(tr_mix_global), -1)).reshape(X_trmix_d.shape)

        comp_tr = compositions[tr_global]
        C = X_tr_n.shape[2]

        X_tr_t = torch.tensor(X_tr_n).permute(0, 2, 1)
        comp_tr_t = torch.tensor(comp_tr)

        # Build model
        if arch == "ts2vec":
            model = TS2VecEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return F.normalize(model.encode(x), dim=1)
        elif arch == "ae":
            model = _AEEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return F.normalize(model(x), dim=1)
        else:  # vanilla / simclr
            model = _VanillaEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return model(x)

        criterion = _SoftSupConLoss()
        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
        loader = DataLoader(TensorDataset(X_tr_t, comp_tr_t),
                            batch_size=batch_size, shuffle=True, drop_last=True)

        model.train()
        for _ in range(epochs):
            for xb, cb in loader:
                xb, cb = xb.to(device), cb.to(device)
                v1, v2 = _carl_augment(xb), _carl_augment(xb)
                z1, z2 = get_emb(v1), get_emb(v2)
                loss = criterion(torch.cat([z1, z2]), torch.cat([cb, cb]))
                optimizer.zero_grad(); loss.backward(); optimizer.step()
            scheduler.step()

        # Extract embeddings for train-mix and test-mix
        model.eval()
        X_trmix_t = torch.tensor(X_trmix_n).permute(0, 2, 1).to(device)
        X_te_t = torch.tensor(X_te_n).permute(0, 2, 1).to(device)
        with torch.no_grad():
            emb_tr = get_emb(X_trmix_t).cpu().numpy()
            emb_te = get_emb(X_te_t).cpu().numpy()

        # Combo one-hot (fit on train fold only)
        le_c = LabelEncoder()
        ohe = OneHotEncoder(sparse_output=False)
        oh_tr = ohe.fit_transform(le_c.fit_transform(y_combo[tr_local]).reshape(-1, 1))
        oh_te = ohe.transform(le_c.transform(y_combo[te_local]).reshape(-1, 1))

        Xr_tr = np.hstack([emb_tr, oh_tr])
        Xr_te = np.hstack([emb_te, oh_te])

        # SVR
        svr_pipe = Pipeline([("sc", StandardScaler()), ("svr", SVR(kernel="rbf", C=10.0))])
        svr_pipe.fit(Xr_tr, y_ratio[tr_local])
        y_pred_svr[te_local] = svr_pipe.predict(Xr_te)

        # DeepMLP
        _, preds_mlp = _train_deep_mlp_fold(
            Xr_tr, y_ratio[tr_local], Xr_te, y_ratio[te_local])
        y_pred_mlp[te_local] = preds_mlp

        del model
        torch.cuda.empty_cache()

    return {
        "SVR": _metrics(y_ratio, y_pred_svr),
        "DeepMLP": _metrics(y_ratio, y_pred_mlp),
    }


_TEA_INDEX = {"T1": 0, "T2": 1, "T3": 2, "T4": 3, "T5": 4}


def _build_compositions(ds) -> np.ndarray:
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


# ═══════════════════════════════════════════════════════════════
# run
# ═══════════════════════════════════════════════════════════════

def run(
    ds: PaperDataset,
    tables_dir: Path,
    figures_dir: Path,
) -> dict:
    """Run §3.4: 叉乘回归对比 (Representation × {SVR, DeepMLP})."""
    print("\n" + "=" * 70)
    print("  §3.4 Blend Ratio Prediction (v2 — cross-product)")
    print("=" * 70)

    results = {}

    # ── Mix samples ──
    mix_idx = ds.mix_indices
    if len(mix_idx) < 20:
        print(f"  混合样不足 ({len(mix_idx)}), 跳过")
        return {"error": "insufficient_mix_samples"}

    y_ratio = np.array([ds.ratios[i] for i in mix_idx])
    y_combo = np.array([ds.combo_ids[i] for i in mix_idx])
    print(f"  混合样: {len(mix_idx)}, 组合: {len(set(y_combo))}")

    feat_name = "norm_stats"
    X_feat = ds.features[feat_name][0][mix_idx]
    X_raw = ds.X_value[mix_idx]

    # wide-format table: category, representation, params, SVR_r2 ... DeepMLP_r2 ...
    table_rows: list[dict] = []

    # ───────────────────────────────────────────────────
    # HC × {Ridge, SVR, DeepMLP}
    # ───────────────────────────────────────────────────
    print("  HC × {Ridge, SVR, DeepMLP}...")
    from sklearn.linear_model import Ridge
    hc_ridge = _eval_combo_conditioned_cv(X_feat, y_ratio, y_combo, "HC+Ridge", Ridge(alpha=1.0))
    hc_ridge_m = {k: hc_ridge[k] for k in ("r2", "mae", "rmse")}
    hc_svr = _eval_svr_combo_cv(X_feat, y_ratio, y_combo)
    hc_mlp = _eval_mlp_combo_cv(X_feat, y_ratio, y_combo)
    print(f"    HC+Ridge: R²={hc_ridge_m['r2']:.3f}  HC+SVR: R²={hc_svr['r2']:.3f}  HC+MLP: R²={hc_mlp['r2']:.3f}")
    table_rows.append({
        "category": "Handcrafted", "representation": "HC+Ridge", "params": "—",
        "SVR_r2": hc_ridge_m["r2"], "SVR_mae": hc_ridge_m["mae"], "SVR_rmse": hc_ridge_m["rmse"],
        "DeepMLP_r2": "—", "DeepMLP_mae": "—", "DeepMLP_rmse": "—",
    })
    table_rows.append(_row("Handcrafted", "HC", "—", hc_svr, hc_mlp))

    # ───────────────────────────────────────────────────
    # 1D-CNN + LSTM-Attn (end-to-end)
    # ───────────────────────────────────────────────────
    print("  1D-CNN (end-to-end)...")
    res_cnn = _eval_cnn_regressor_cv(X_raw, y_ratio, y_combo, "1D-CNN")
    cnn_m = {k: res_cnn[k] for k in ("r2", "mae", "rmse")}
    print(f"    1D-CNN: R²={cnn_m['r2']:.3f}")
    from ..discrimination import _CNN1DClassifier
    _d = _CNN1DClassifier(in_channels=8, n_classes=5)
    cnn_p = f"{sum(p.numel() for p in _d.parameters())/1000:.1f}K"
    table_rows.append({
        "category": "End-to-end", "representation": "1D-CNN", "params": cnn_p,
        "SVR_r2": "—", "SVR_mae": "—", "SVR_rmse": "—",
        "DeepMLP_r2": cnn_m["r2"], "DeepMLP_mae": cnn_m["mae"], "DeepMLP_rmse": cnn_m["rmse"],
    })

    print("  LSTM-Attn (end-to-end)...")
    res_lstm = _eval_lstm_regressor_cv(X_raw, y_ratio, y_combo)
    lstm_m = {k: res_lstm[k] for k in ("r2", "mae", "rmse")}
    print(f"    LSTM-Attn: R²={lstm_m['r2']:.3f}")
    from ..backbones import LSTMBackbone
    _d_lstm = LSTMBackbone(in_channels=8)
    lstm_p = f"{sum(p.numel() for p in _d_lstm.parameters())/1000:.1f}K"
    table_rows.append({
        "category": "End-to-end", "representation": "LSTM-Attn", "params": lstm_p,
        "SVR_r2": "—", "SVR_mae": "—", "SVR_rmse": "—",
        "DeepMLP_r2": lstm_m["r2"], "DeepMLP_mae": lstm_m["mae"], "DeepMLP_rmse": lstm_m["rmse"],
    })

    # ───────────────────────────────────────────────────
    # Self-supervised × {SVR, DeepMLP}
    # ───────────────────────────────────────────────────
    print("  Self-supervised × {SVR, DeepMLP}...")
    from ..baselines import train_ts2vec, train_autoencoder, train_vanilla_contrastive

    ss_items = [
        ("TS2Vec", train_ts2vec),
        ("Autoencoder", train_autoencoder),
        ("SimCLR", train_vanilla_contrastive),
    ]
    from ..baselines import TS2VecEncoder, _AEEncoder, _VanillaEncoder, EMBED_DIM
    ss_param_map = {
        "TS2Vec": f"{sum(p.numel() for p in TS2VecEncoder(8, embed_dim=EMBED_DIM).parameters())/1000:.1f}K",
        "Autoencoder": f"{sum(p.numel() for p in _AEEncoder(8, embed_dim=EMBED_DIM).parameters())/1000:.1f}K",
        "SimCLR": f"{sum(p.numel() for p in _VanillaEncoder(8, embed_dim=EMBED_DIM).parameters())/1000:.1f}K",
    }

    for name, train_fn in ss_items:
        print(f"    训练 {name} (200 epochs)...")
        emb = train_fn(ds.X_value, epochs=200)
        emb_mix = emb[mix_idx]
        svr_r = _eval_svr_combo_cv(emb_mix, y_ratio, y_combo)
        mlp_r = _eval_mlp_combo_cv(emb_mix, y_ratio, y_combo)
        print(f"      {name}: SVR R²={svr_r['r2']:.3f}, MLP R²={mlp_r['r2']:.3f}")
        table_rows.append(_row("Self-supervised", name, ss_param_map[name], svr_r, mlp_r))

    # ───────────────────────────────────────────────────
    # Composition-supervised × {SVR, DeepMLP} (nested CV)
    # ───────────────────────────────────────────────────
    print("  Composition-supervised × {SVR, DeepMLP} (nested CV)...")
    sup_items = [
        ("TS2Vec+SoftSupCon", "ts2vec"),
        ("AE+SoftSupCon", "ae"),
        ("SimCLR+SoftSupCon", "vanilla"),
    ]
    sup_param_map = {
        "TS2Vec+SoftSupCon": ss_param_map["TS2Vec"],
        "AE+SoftSupCon": ss_param_map["Autoencoder"],
        "SimCLR+SoftSupCon": ss_param_map["SimCLR"],
    }
    for name, arch in sup_items:
        print(f"    {name} ({N_CV_FOLDS}-fold nested CV)...")
        res = _nested_cv_reg_supervised(arch, ds, mix_idx, y_ratio, y_combo)
        print(f"      SVR R²={res['SVR']['r2']:.3f}, MLP R²={res['DeepMLP']['r2']:.3f}")
        table_rows.append(_row("Comp-supervised", name, sup_param_map[name],
                               res["SVR"], res["DeepMLP"]))

    # ───────────────────────────────────────────────────
    # CARL × {SVR, DeepMLP} (nested CV) — Proj + GAP
    # ───────────────────────────────────────────────────
    print("  CARL × {SVR, DeepMLP} (nested CV) — Proj + GAP...")
    from ..carl_training import (
        CARLEncoder, train_carl_on_subset,
        extract_embeddings_with_scaler, extract_gap_features_with_scaler,
    )

    le_strat = LabelEncoder()
    y_strat = le_strat.fit_transform(y_combo)
    skf_carl = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)

    y_pred_svr = np.zeros_like(y_ratio, dtype=np.float32)
    y_pred_mlp = np.zeros_like(y_ratio, dtype=np.float32)
    y_pred_gap_svr = np.zeros_like(y_ratio, dtype=np.float32)

    for fold, (tr_idx, te_idx) in enumerate(skf_carl.split(X_feat, y_strat)):
        global_test = mix_idx[te_idx]
        carl_mask = np.ones(ds.n_total, dtype=bool)
        carl_mask[global_test] = False

        encoder, sc = train_carl_on_subset(ds, carl_mask, verbose=(fold == 0))

        # Proj features (post-projector, L2-normalized)
        emb = extract_embeddings_with_scaler(encoder, ds, sc)
        # GAP features (pre-projector, 128D)
        gap = extract_gap_features_with_scaler(encoder, ds, sc)

        le_c = LabelEncoder()
        ohe = OneHotEncoder(sparse_output=False)
        oh_tr = ohe.fit_transform(le_c.fit_transform(y_combo[tr_idx]).reshape(-1, 1))
        oh_te = ohe.transform(le_c.transform(y_combo[te_idx]).reshape(-1, 1))

        # CARL-Proj + SVR
        Xr_tr = np.hstack([emb[mix_idx[tr_idx]], oh_tr])
        Xr_te = np.hstack([emb[mix_idx[te_idx]], oh_te])
        svr_pipe = Pipeline([("sc", StandardScaler()), ("svr", SVR(kernel="rbf", C=10.0))])
        svr_pipe.fit(Xr_tr, y_ratio[tr_idx])
        y_pred_svr[te_idx] = svr_pipe.predict(Xr_te)

        # CARL-Proj + DeepMLP
        _, preds_mlp = _train_deep_mlp_fold(
            Xr_tr, y_ratio[tr_idx], Xr_te, y_ratio[te_idx])
        y_pred_mlp[te_idx] = preds_mlp

        # CARL-GAP + SVR
        Xg_tr = np.hstack([gap[mix_idx[tr_idx]], oh_tr])
        Xg_te = np.hstack([gap[mix_idx[te_idx]], oh_te])
        gap_svr_pipe = Pipeline([("sc", StandardScaler()), ("svr", SVR(kernel="rbf", C=10.0))])
        gap_svr_pipe.fit(Xg_tr, y_ratio[tr_idx])
        y_pred_gap_svr[te_idx] = gap_svr_pipe.predict(Xg_te)

        del encoder
        torch.cuda.empty_cache()
        print(f"    fold {fold+1}/{N_CV_FOLDS} done")

    carl_svr_m = _metrics(y_ratio, y_pred_svr)
    carl_mlp_m = _metrics(y_ratio, y_pred_mlp)
    carl_gap_svr_m = _metrics(y_ratio, y_pred_gap_svr)
    print(f"    CARL-Proj: SVR R²={carl_svr_m['r2']:.3f}, MLP R²={carl_mlp_m['r2']:.3f}")
    print(f"    CARL-GAP:  SVR R²={carl_gap_svr_m['r2']:.3f}")

    _dummy_carl = CARLEncoder(in_channels=8)
    carl_p = f"{sum(p.numel() for p in _dummy_carl.parameters())/1000:.1f}K"
    table_rows.append({
        "category": "CARL (ours)", "representation": "CARL-GAP", "params": carl_p,
        "SVR_r2": carl_gap_svr_m["r2"], "SVR_mae": carl_gap_svr_m["mae"],
        "SVR_rmse": carl_gap_svr_m["rmse"],
        "DeepMLP_r2": "—", "DeepMLP_mae": "—", "DeepMLP_rmse": "—",
    })
    table_rows.append(_row("CARL (ours)", "CARL-Proj", carl_p, carl_svr_m, carl_mlp_m))

    # ── 保存 Table 3 (wide format) ──
    df = pd.DataFrame(table_rows)
    csv_path = tables_dir / "table3_regression_v2.csv"
    df.to_csv(csv_path, index=False)
    print(f"  Table 3 -> {csv_path.name}")

    results["table3"] = table_rows

    # Find best overall R²
    best_r2, best_label = -999, ""
    for row in table_rows:
        for head in ("SVR", "DeepMLP"):
            val = row[f"{head}_r2"]
            if isinstance(val, (int, float)) and val > best_r2:
                best_r2 = val
                best_label = f"{row['representation']} + {head}"
    results["best_model"] = best_label
    results["best_r2"] = best_r2

    # ── Scatter plot (CARL best regressor) ──
    carl_best_pred = y_pred_svr if carl_svr_m["r2"] >= carl_mlp_m["r2"] else y_pred_mlp
    carl_best_m = carl_svr_m if carl_svr_m["r2"] >= carl_mlp_m["r2"] else carl_mlp_m
    carl_best_head = "SVR" if carl_svr_m["r2"] >= carl_mlp_m["r2"] else "DeepMLP"
    _plot_scatter({"model": f"CARL + {carl_best_head}", **carl_best_m,
                   "y_true": y_ratio, "y_pred": carl_best_pred}, figures_dir)

    # ── Save JSON ──
    _save_json(results, tables_dir / "exp_regression_v2.json")

    print(f"\n  === §3.4 结果摘要 ===")
    print(f"  全局最佳: {best_label} → R²={best_r2}")
    return results


def _row(cat, rep, params, svr_m, mlp_m) -> dict:
    """Build one wide-format table row."""
    return {
        "category": cat, "representation": rep, "params": params,
        "SVR_r2": svr_m["r2"], "SVR_mae": svr_m["mae"], "SVR_rmse": svr_m["rmse"],
        "DeepMLP_r2": mlp_m["r2"], "DeepMLP_mae": mlp_m["mae"], "DeepMLP_rmse": mlp_m["rmse"],
    }


# ── helpers ──

def _plot_scatter(res, figures_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    init_style()
    fig, ax = plt.subplots(figsize=(5.5, 5.5))
    yt, yp = res["y_true"], res["y_pred"]
    ax.scatter(yt, yp, s=30, alpha=0.6, c="#0072B2", edgecolors="white", linewidth=0.5)
    ax.plot([0, 1], [0, 1], "k--", alpha=0.5, linewidth=1.6)
    ax.set_xlabel("True ratio")
    ax.set_ylabel("Predicted ratio")
    ax.set_title(f"{res['model']}\nR²={res['r2']:.3f}, MAE={res['mae']:.4f}")
    ax.set_xlim(-0.05, 1.05); ax.set_ylim(-0.05, 1.05)
    ax.set_aspect("equal")
    fig.tight_layout()
    for fmt in ["pdf", "png"]:
        fig.savefig(figures_dir / f"fig_pred_scatter_v2.{fmt}", dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"    -> fig_pred_scatter_v2")


def _save_json(obj, path):
    def _conv(o):
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, np.ndarray): return o.tolist()
        return o
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(obj, default=_conv)), f, indent=2, ensure_ascii=False)
