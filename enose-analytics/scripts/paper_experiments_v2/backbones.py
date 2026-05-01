"""端到端深度学习基线 (PyTorch Lightning) — 分类 + 回归。

用多种架构直接从原始传感器时序 (N, T, 8) 做:
  - Task A: 5 类纯茶分类 (5-fold Stratified CV)
  - Task B: 二元混合比例回归 (combo-conditioned, 5-fold Stratified CV)

架构:
  1. CNN1D        — 3-block Conv1D + GAP
  2. LSTM         — 双向 LSTM + attention pooling
  3. ResNet1D     — 残差 1D-CNN
  4. InceptionTime — 多尺度卷积 (受 InceptionTime 启发)
  5. Transformer  — 位置编码 + Transformer Encoder

用法:
    uv run python -m scripts.paper_experiments_v2.backbones
"""

from __future__ import annotations

import json
import time
import warnings
import argparse
import numpy as np
import pandas as pd
from pathlib import Path
from collections import Counter

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

import pytorch_lightning as pl
from pytorch_lightning.callbacks import EarlyStopping, ModelCheckpoint, LearningRateMonitor
from pytorch_lightning.loggers import CSVLogger

from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error, mean_squared_error

from .config import SEED, N_CV_FOLDS, TABLES_DIR, FIGURES_DIR, CACHE_DIR, ensure_dirs
from .data import PaperDataset, build_dataset

warnings.filterwarnings("ignore")

pl.seed_everything(SEED, workers=True)

V2_RESULTS_DIR = Path(__file__).resolve().parent / "results" / "v2"
V2_TABLES_DIR = V2_RESULTS_DIR / "tables"
V2_FIGURES_DIR = V2_RESULTS_DIR / "figures"
LOGS_DIR = V2_RESULTS_DIR / "lightning_logs"


# ═══════════════════════════════════════════════════════════════
# 数据预处理
# ═══════════════════════════════════════════════════════════════

def preprocess_sensor_data(
    X_value: np.ndarray,
    fit_indices: np.ndarray | None = None,
) -> tuple[np.ndarray, StandardScaler]:
    """Baseline-subtract + channel-wise z-score.

    Args:
        X_value: (N, T, 8) raw sensor values
        fit_indices: indices to fit the scaler on (None = all)

    Returns:
        X_norm: (N, T, 8) preprocessed
        scaler: fitted StandardScaler
    """
    N, T, C = X_value.shape
    bl = max(1, T // 10)
    baseline = X_value[:, :bl, :].mean(axis=1, keepdims=True)  # (N, 1, 8)
    X_delta = (X_value - baseline).astype(np.float32)

    X_flat = X_delta.reshape(N, -1)
    scaler = StandardScaler()
    if fit_indices is not None:
        scaler.fit(X_flat[fit_indices])
    else:
        scaler.fit(X_flat)
    X_flat = scaler.transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N, T, C)
    return X_norm, scaler


# ═══════════════════════════════════════════════════════════════
# PyTorch Dataset
# ═══════════════════════════════════════════════════════════════

class SensorClassificationDataset(Dataset):
    """(N, T, 8) → classification target."""

    def __init__(self, X: np.ndarray, y: np.ndarray):
        self.X = torch.tensor(X, dtype=torch.float32)  # (N, T, 8)
        self.y = torch.tensor(y, dtype=torch.long)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx].T, self.y[idx]  # (8, T), label


class SensorRegressionDataset(Dataset):
    """(N, T, 8) + combo one-hot → ratio."""

    def __init__(self, X: np.ndarray, combo_oh: np.ndarray, y_ratio: np.ndarray):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.combo_oh = torch.tensor(combo_oh, dtype=torch.float32)
        self.y = torch.tensor(y_ratio, dtype=torch.float32)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx].T, self.combo_oh[idx], self.y[idx]


# ═══════════════════════════════════════════════════════════════
# Lightning DataModules
# ═══════════════════════════════════════════════════════════════

class ClassificationDataModule(pl.LightningDataModule):
    def __init__(self, X_train, y_train, X_val, y_val, batch_size=32):
        super().__init__()
        self.X_train, self.y_train = X_train, y_train
        self.X_val, self.y_val = X_val, y_val
        self.batch_size = batch_size

    def train_dataloader(self):
        ds = SensorClassificationDataset(self.X_train, self.y_train)
        return DataLoader(ds, batch_size=self.batch_size, shuffle=True,
                          drop_last=len(ds) > self.batch_size, num_workers=0)

    def val_dataloader(self):
        ds = SensorClassificationDataset(self.X_val, self.y_val)
        return DataLoader(ds, batch_size=self.batch_size, shuffle=False, num_workers=0)


class RegressionDataModule(pl.LightningDataModule):
    def __init__(self, X_train, oh_train, y_train, X_val, oh_val, y_val, batch_size=32):
        super().__init__()
        self.X_train, self.oh_train, self.y_train = X_train, oh_train, y_train
        self.X_val, self.oh_val, self.y_val = X_val, oh_val, y_val
        self.batch_size = batch_size

    def train_dataloader(self):
        ds = SensorRegressionDataset(self.X_train, self.oh_train, self.y_train)
        return DataLoader(ds, batch_size=self.batch_size, shuffle=True,
                          drop_last=len(ds) > self.batch_size, num_workers=0)

    def val_dataloader(self):
        ds = SensorRegressionDataset(self.X_val, self.oh_val, self.y_val)
        return DataLoader(ds, batch_size=self.batch_size, shuffle=False, num_workers=0)


# ═══════════════════════════════════════════════════════════════
# 模型架构: Backbone
# ═══════════════════════════════════════════════════════════════

class CNN1DBackbone(nn.Module):
    """3-block Conv1D + GAP → 128D."""

    def __init__(self, in_channels=8):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(in_channels, 32, 7, padding=3),
            nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(32, 64, 5, padding=2),
            nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(64, 128, 3, padding=1),
            nn.BatchNorm1d(128), nn.ReLU(),
        )
        self.gap = nn.AdaptiveAvgPool1d(1)
        self.out_dim = 128

    def forward(self, x):
        # x: (B, 8, T)
        h = self.net(x)
        return self.gap(h).squeeze(-1)  # (B, 128)


class LSTMBackbone(nn.Module):
    """Bidirectional LSTM + attention pooling → 128D."""

    def __init__(self, in_channels=8, hidden=64, n_layers=2):
        super().__init__()
        self.lstm = nn.LSTM(in_channels, hidden, n_layers,
                            batch_first=True, bidirectional=True, dropout=0.2)
        self.attn = nn.Linear(hidden * 2, 1)
        self.out_dim = hidden * 2  # 128

    def forward(self, x):
        # x: (B, C, T) → (B, T, C) for LSTM
        x = x.permute(0, 2, 1)
        h, _ = self.lstm(x)  # (B, T, 128)
        # attention pooling
        w = torch.softmax(self.attn(h), dim=1)  # (B, T, 1)
        return (h * w).sum(dim=1)  # (B, 128)


class ResBlock1D(nn.Module):
    """Residual block for 1D signals."""

    def __init__(self, channels, kernel_size=3):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv1d(channels, channels, kernel_size, padding=kernel_size // 2),
            nn.BatchNorm1d(channels), nn.ReLU(),
            nn.Conv1d(channels, channels, kernel_size, padding=kernel_size // 2),
            nn.BatchNorm1d(channels),
        )
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.block(x) + x)


class ResNet1DBackbone(nn.Module):
    """ResNet-style 1D CNN → 128D."""

    def __init__(self, in_channels=8):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(in_channels, 64, 7, padding=3),
            nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
        )
        self.layer1 = nn.Sequential(ResBlock1D(64), ResBlock1D(64))
        self.transition = nn.Sequential(
            nn.Conv1d(64, 128, 3, stride=2, padding=1),
            nn.BatchNorm1d(128), nn.ReLU(),
        )
        self.layer2 = nn.Sequential(ResBlock1D(128), ResBlock1D(128))
        self.gap = nn.AdaptiveAvgPool1d(1)
        self.out_dim = 128

    def forward(self, x):
        h = self.stem(x)
        h = self.layer1(h)
        h = self.transition(h)
        h = self.layer2(h)
        return self.gap(h).squeeze(-1)


class InceptionBlock(nn.Module):
    """Multi-scale convolution (inspired by InceptionTime)."""

    def __init__(self, in_ch, out_ch):
        super().__init__()
        branch_ch = out_ch // 4
        self.b1 = nn.Sequential(nn.Conv1d(in_ch, branch_ch, 1), nn.BatchNorm1d(branch_ch), nn.ReLU())
        self.b3 = nn.Sequential(nn.Conv1d(in_ch, branch_ch, 3, padding=1), nn.BatchNorm1d(branch_ch), nn.ReLU())
        self.b5 = nn.Sequential(nn.Conv1d(in_ch, branch_ch, 5, padding=2), nn.BatchNorm1d(branch_ch), nn.ReLU())
        self.b7 = nn.Sequential(nn.Conv1d(in_ch, branch_ch, 7, padding=3), nn.BatchNorm1d(branch_ch), nn.ReLU())
        self.bn = nn.BatchNorm1d(out_ch)
        self.relu = nn.ReLU()

        # residual shortcut
        self.shortcut = nn.Conv1d(in_ch, out_ch, 1) if in_ch != out_ch else nn.Identity()

    def forward(self, x):
        out = torch.cat([self.b1(x), self.b3(x), self.b5(x), self.b7(x)], dim=1)
        return self.relu(self.bn(out) + self.shortcut(x))


class InceptionTimeBackbone(nn.Module):
    """InceptionTime-style backbone → 128D."""

    def __init__(self, in_channels=8):
        super().__init__()
        self.blocks = nn.Sequential(
            InceptionBlock(in_channels, 32),
            nn.MaxPool1d(2),
            InceptionBlock(32, 64),
            nn.MaxPool1d(2),
            InceptionBlock(64, 128),
        )
        self.gap = nn.AdaptiveAvgPool1d(1)
        self.out_dim = 128

    def forward(self, x):
        h = self.blocks(x)
        return self.gap(h).squeeze(-1)


class PositionalEncoding(nn.Module):
    def __init__(self, d_model, max_len=200):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len).unsqueeze(1).float()
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-np.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))  # (1, max_len, d_model)

    def forward(self, x):
        return x + self.pe[:, :x.size(1)]


class TransformerBackbone(nn.Module):
    """Transformer encoder → 128D."""

    def __init__(self, in_channels=8, d_model=64, nhead=4, n_layers=2):
        super().__init__()
        self.input_proj = nn.Linear(in_channels, d_model)
        self.pe = PositionalEncoding(d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=128,
            dropout=0.1, batch_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.fc = nn.Linear(d_model, 128)
        self.out_dim = 128

    def forward(self, x):
        # x: (B, C, T) → (B, T, C)
        x = x.permute(0, 2, 1)
        h = self.input_proj(x)
        h = self.pe(h)
        h = self.encoder(h)
        h = h.mean(dim=1)  # global average
        return self.fc(h)


BACKBONES = {
    "CNN1D": CNN1DBackbone,
    "LSTM": LSTMBackbone,
    "ResNet1D": ResNet1DBackbone,
    "InceptionTime": InceptionTimeBackbone,
    "Transformer": TransformerBackbone,
}


# ═══════════════════════════════════════════════════════════════
# Lightning Modules
# ═══════════════════════════════════════════════════════════════

class ClassificationModel(pl.LightningModule):
    """端到端分类模型: Backbone → FC → softmax."""

    def __init__(self, backbone_name: str, n_classes: int = 5, lr: float = 1e-3):
        super().__init__()
        self.save_hyperparameters()
        self.backbone = BACKBONES[backbone_name]()
        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(self.backbone.out_dim, n_classes),
        )
        self.lr = lr

    def forward(self, x):
        h = self.backbone(x)
        return self.head(h)

    def training_step(self, batch, batch_idx):
        x, y = batch
        logits = self(x)
        loss = F.cross_entropy(logits, y)
        acc = (logits.argmax(dim=1) == y).float().mean()
        self.log("train_loss", loss, prog_bar=False)
        self.log("train_acc", acc, prog_bar=False)
        return loss

    def validation_step(self, batch, batch_idx):
        x, y = batch
        logits = self(x)
        loss = F.cross_entropy(logits, y)
        acc = (logits.argmax(dim=1) == y).float().mean()
        self.log("val_loss", loss, prog_bar=True)
        self.log("val_acc", acc, prog_bar=True)
        return {"preds": logits.argmax(dim=1), "targets": y}

    def configure_optimizers(self):
        opt = torch.optim.AdamW(self.parameters(), lr=self.lr, weight_decay=1e-4)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=self.trainer.max_epochs)
        return [opt], [sch]


class RegressionModel(pl.LightningModule):
    """端到端回归模型: Backbone + combo_oh → FC → sigmoid → ratio."""

    def __init__(self, backbone_name: str, n_combos: int = 10, lr: float = 1e-3):
        super().__init__()
        self.save_hyperparameters()
        self.backbone = BACKBONES[backbone_name]()
        in_dim = self.backbone.out_dim + n_combos
        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(in_dim, 64),
            nn.BatchNorm1d(64), nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )
        self.lr = lr

    def forward(self, x, combo_oh):
        h = self.backbone(x)
        h = torch.cat([h, combo_oh], dim=1)
        return self.head(h).squeeze(-1)

    def training_step(self, batch, batch_idx):
        x, oh, y = batch
        pred = self(x, oh)
        loss = F.mse_loss(pred, y)
        self.log("train_loss", loss, prog_bar=False)
        return loss

    def validation_step(self, batch, batch_idx):
        x, oh, y = batch
        pred = self(x, oh)
        loss = F.mse_loss(pred, y)
        mae = (pred - y).abs().mean()
        self.log("val_loss", loss, prog_bar=True)
        self.log("val_mae", mae, prog_bar=True)
        return {"preds": pred, "targets": y}

    def configure_optimizers(self):
        opt = torch.optim.AdamW(self.parameters(), lr=self.lr, weight_decay=1e-4)
        sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=self.trainer.max_epochs)
        return [opt], [sch]


# ═══════════════════════════════════════════════════════════════
# 评估函数
# ═══════════════════════════════════════════════════════════════

def run_classification_cv(
    ds: PaperDataset,
    backbone_name: str,
    max_epochs: int = 200,
    batch_size: int = 32,
    lr: float = 1e-3,
) -> dict:
    """5-fold stratified CV for classification."""
    pure_idx = ds.pure_indices
    tea_ids = np.array([ds.tea_ids[i] for i in pure_idx])
    le = LabelEncoder()
    y = le.fit_transform(tea_ids)
    n_classes = len(le.classes_)

    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
    y_pred_all = np.zeros_like(y, dtype=int)

    for fold, (tr, te) in enumerate(skf.split(pure_idx, y)):
        pl.seed_everything(SEED + fold, workers=True)

        # Preprocess: fit scaler on training indices only
        X_norm, _ = preprocess_sensor_data(ds.X_value[pure_idx], fit_indices=tr)
        X_tr, X_te = X_norm[tr], X_norm[te]
        y_tr, y_te = y[tr], y[te]

        dm = ClassificationDataModule(X_tr, y_tr, X_te, y_te, batch_size=batch_size)
        model = ClassificationModel(backbone_name, n_classes=n_classes, lr=lr)

        trainer = pl.Trainer(
            max_epochs=max_epochs,
            accelerator="auto",
            devices=1,
            callbacks=[
                EarlyStopping(monitor="val_loss", patience=30, mode="min"),
                LearningRateMonitor(logging_interval="epoch"),
            ],
            enable_checkpointing=False,
            enable_progress_bar=False,
            logger=CSVLogger(LOGS_DIR, name=f"cls_{backbone_name}", version=f"fold{fold}"),
            deterministic=True,
        )
        trainer.fit(model, dm)

        # Predict
        model.eval()
        with torch.no_grad():
            X_te_t = torch.tensor(X_te, dtype=torch.float32).permute(0, 2, 1)
            if torch.cuda.is_available():
                X_te_t = X_te_t.cuda()
                model = model.cuda()
            logits = model(X_te_t)
            y_pred_all[te] = logits.argmax(dim=1).cpu().numpy()

        del model, trainer
        torch.cuda.empty_cache()
        print(f"    {backbone_name} cls fold {fold+1}/{N_CV_FOLDS}: "
              f"acc={accuracy_score(y_te, y_pred_all[te]):.1%}")

    acc = round(accuracy_score(y, y_pred_all) * 100, 1)
    return {"backbone": backbone_name, "accuracy": acc}


def run_regression_cv(
    ds: PaperDataset,
    backbone_name: str,
    max_epochs: int = 300,
    batch_size: int = 32,
    lr: float = 1e-3,
) -> dict:
    """5-fold stratified CV for regression (combo-conditioned)."""
    mix_idx = ds.mix_indices
    y_ratio = np.array([ds.ratios[i] for i in mix_idx], dtype=np.float32)
    y_combo = np.array([ds.combo_ids[i] for i in mix_idx])

    le_strat = LabelEncoder()
    y_strat = le_strat.fit_transform(y_combo)

    # Prepare combo one-hot
    ohe = OneHotEncoder(sparse_output=False)
    combo_oh_all = ohe.fit_transform(y_strat.reshape(-1, 1)).astype(np.float32)
    n_combos = combo_oh_all.shape[1]

    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
    y_pred_all = np.zeros_like(y_ratio, dtype=np.float32)

    for fold, (tr, te) in enumerate(skf.split(mix_idx, y_strat)):
        pl.seed_everything(SEED + fold, workers=True)

        # Preprocess: fit scaler on training mix indices only (global indices)
        X_norm, _ = preprocess_sensor_data(ds.X_value[mix_idx], fit_indices=tr)
        X_tr, X_te = X_norm[tr], X_norm[te]
        oh_tr, oh_te = combo_oh_all[tr], combo_oh_all[te]
        yr_tr, yr_te = y_ratio[tr], y_ratio[te]

        dm = RegressionDataModule(X_tr, oh_tr, yr_tr, X_te, oh_te, yr_te,
                                  batch_size=batch_size)
        model = RegressionModel(backbone_name, n_combos=n_combos, lr=lr)

        trainer = pl.Trainer(
            max_epochs=max_epochs,
            accelerator="auto",
            devices=1,
            callbacks=[
                EarlyStopping(monitor="val_loss", patience=40, mode="min"),
                LearningRateMonitor(logging_interval="epoch"),
            ],
            enable_checkpointing=False,
            enable_progress_bar=False,
            logger=CSVLogger(LOGS_DIR, name=f"reg_{backbone_name}", version=f"fold{fold}"),
            deterministic=True,
        )
        trainer.fit(model, dm)

        # Predict
        model.eval()
        with torch.no_grad():
            X_te_t = torch.tensor(X_te, dtype=torch.float32).permute(0, 2, 1)
            oh_te_t = torch.tensor(oh_te, dtype=torch.float32)
            if torch.cuda.is_available():
                X_te_t = X_te_t.cuda()
                oh_te_t = oh_te_t.cuda()
                model = model.cuda()
            y_pred_all[te] = model(X_te_t, oh_te_t).cpu().numpy()

        del model, trainer
        torch.cuda.empty_cache()

        fold_r2 = r2_score(yr_te, y_pred_all[te])
        fold_mae = mean_absolute_error(yr_te, y_pred_all[te])
        print(f"    {backbone_name} reg fold {fold+1}/{N_CV_FOLDS}: "
              f"R²={fold_r2:.3f}, MAE={fold_mae:.4f}")

    r2 = round(r2_score(y_ratio, y_pred_all), 3)
    mae = round(mean_absolute_error(y_ratio, y_pred_all), 4)
    rmse = round(np.sqrt(mean_squared_error(y_ratio, y_pred_all)), 4)
    return {
        "backbone": backbone_name, "r2": r2, "mae": mae, "rmse": rmse,
        "y_true": y_ratio, "y_pred": y_pred_all,
    }


# ═══════════════════════════════════════════════════════════════
# 主运行
# ═══════════════════════════════════════════════════════════════

def run(ds: PaperDataset | None = None, backbones: list[str] | None = None) -> dict:
    """运行端到端基线实验。"""
    ensure_dirs()
    for d in [V2_RESULTS_DIR, V2_TABLES_DIR, V2_FIGURES_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    if ds is None:
        ds = build_dataset(cutoff_s=80.0)

    if backbones is None:
        backbones = list(BACKBONES.keys())

    t0 = time.time()
    all_results = {"classification": [], "regression": []}

    print(f"\n{'═'*70}")
    print(f"  端到端 DL 基线 (Lightning) — {len(backbones)} 架构")
    print(f"  纯样: {ds.n_pure}, 混合样: {ds.n_mix}")
    print(f"{'═'*70}")

    # ── Task A: Classification ──
    print(f"\n{'─'*60}")
    print(f"  Task A: 5-class 纯茶分类 (5-fold Stratified CV)")
    print(f"{'─'*60}")

    cls_rows = []
    for bb in backbones:
        print(f"\n  [{bb}] 分类...")
        res = run_classification_cv(ds, bb, max_epochs=200, batch_size=32, lr=1e-3)
        cls_rows.append(res)
        print(f"  → {bb}: Accuracy={res['accuracy']}%")

    all_results["classification"] = cls_rows
    df_cls = pd.DataFrame(cls_rows)
    csv_cls = V2_TABLES_DIR / "table_e2e_classification.csv"
    df_cls.to_csv(csv_cls, index=False)
    print(f"\n  Classification CSV → {csv_cls.name}")

    # ── Task B: Regression ──
    print(f"\n{'─'*60}")
    print(f"  Task B: 二元混合比例回归 (combo-conditioned, 5-fold CV)")
    print(f"{'─'*60}")

    reg_rows = []
    for bb in backbones:
        print(f"\n  [{bb}] 回归...")
        res = run_regression_cv(ds, bb, max_epochs=300, batch_size=32, lr=1e-3)
        reg_rows.append({k: v for k, v in res.items() if k not in ("y_true", "y_pred")})
        print(f"  → {bb}: R²={res['r2']}, MAE={res['mae']}, RMSE={res['rmse']}")

    all_results["regression"] = reg_rows
    df_reg = pd.DataFrame(reg_rows)
    csv_reg = V2_TABLES_DIR / "table_e2e_regression.csv"
    df_reg.to_csv(csv_reg, index=False)
    print(f"\n  Regression CSV → {csv_reg.name}")

    # ── Summary ──
    elapsed = time.time() - t0
    print(f"\n{'═'*70}")
    print(f"  端到端基线完成! 耗时: {elapsed:.1f}s ({elapsed/60:.1f}min)")
    print(f"{'═'*70}")

    print(f"\n  === Classification ===")
    for r in cls_rows:
        print(f"    {r['backbone']:20s}: {r['accuracy']}%")
    best_cls = max(cls_rows, key=lambda x: x["accuracy"])
    print(f"  Best: {best_cls['backbone']} → {best_cls['accuracy']}%")

    print(f"\n  === Regression ===")
    for r in reg_rows:
        print(f"    {r['backbone']:20s}: R²={r['r2']}, MAE={r['mae']}")
    best_reg = max(reg_rows, key=lambda x: x["r2"])
    print(f"  Best: {best_reg['backbone']} → R²={best_reg['r2']}")

    all_results["elapsed_s"] = round(elapsed, 1)
    all_results["best_cls"] = best_cls
    all_results["best_reg"] = best_reg

    # Save JSON
    json_path = V2_TABLES_DIR / "exp_e2e_baseline.json"
    _save_json(all_results, json_path)
    print(f"  JSON → {json_path.name}")

    return all_results


def _save_json(obj, path):
    def _conv(o):
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, np.ndarray): return o.tolist()
        return o
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(obj, default=_conv)), f, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description="E2E DL Baseline (Lightning)")
    parser.add_argument("--backbones", nargs="+", default=None,
                        choices=list(BACKBONES.keys()),
                        help="要运行的架构 (默认全部)")
    parser.add_argument("--cutoff", type=float, default=80.0)
    parser.add_argument("--cls-only", action="store_true", help="只跑分类")
    parser.add_argument("--reg-only", action="store_true", help="只跑回归")
    args = parser.parse_args()

    for d in [V2_RESULTS_DIR, V2_TABLES_DIR, V2_FIGURES_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    ds = build_dataset(cutoff_s=args.cutoff)
    bbs = args.backbones or list(BACKBONES.keys())

    if args.cls_only:
        print(f"\n  只运行分类 (backbones: {bbs})")
        for bb in bbs:
            res = run_classification_cv(ds, bb)
            print(f"  {bb}: {res['accuracy']}%")
    elif args.reg_only:
        print(f"\n  只运行回归 (backbones: {bbs})")
        for bb in bbs:
            res = run_regression_cv(ds, bb)
            print(f"  {bb}: R²={res['r2']}, MAE={res['mae']}")
    else:
        run(ds, bbs)


if __name__ == "__main__":
    main()
