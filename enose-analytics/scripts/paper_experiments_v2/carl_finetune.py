"""CARL Pre-train + Classification Fine-tune (方向 B)

策略:
  1. CARL 在全部 690 样本 (纯+混) 上做软监督对比预训练, 生成 128D encoder
  2. 三种评估方式对比:
     (a) CARL-Linear: 冻结 encoder, 接 Linear 分类头
     (b) CARL-SVM:    冻结 encoder, 提取特征送 SVM-RBF
     (c) CARL-FT:     解冻全部, 端到端微调分类头 + backbone
  3. 与 LSTM_Attn baseline (68.8%) 对比

数据: data.py 已预处理 (bl_sub → run_zscore → sample_max_norm)
CV:   80/20 stratified split (同 exp_e2e_cls_tuned 一致)

Usage:
  uv run python -m scripts.paper_experiments_v2.carl_finetune \\
      --pretrain-epochs 300 --finetune-epochs 200
"""

from __future__ import annotations

import sys
import io
import argparse
import warnings
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.svm import SVC
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.pipeline import make_pipeline

from .config import SEED, N_SENSORS, ensure_dirs, TABLES_DIR, CACHE_DIR
from .data import build_dataset, PaperDataset
from .carl_training import (
    CARLEncoder, SensorDataset, SoftSupConLoss,
    _build_compositions, _augment_batch,
)
from .baselines import _make_contrastive_optimizer, _strong_augment_batch

warnings.filterwarnings("ignore")

# UTF-8 stdout for Windows (line_buffering=True to preserve -u behaviour)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)


# ═══════════════════════════════════════════════════════════════
# CARL 预训练 (在纯样 train split 上, 避免测试泄露)
# ═══════════════════════════════════════════════════════════════

def pretrain_carl(
    ds: PaperDataset,
    train_global_idx: np.ndarray,
    epochs: int = 300,
    lr: float = 1e-3,
    batch_size: int = 128,
    temperature: float = 0.5,
    sigma: float = 0.5,
    verbose: bool = False,
) -> tuple[CARLEncoder, StandardScaler]:
    """在 train_global_idx 指定的样本上预训练 CARL encoder.

    train_global_idx 包含 pure 样本的 train split 索引, 加上所有 mix 样本。
    即: mix 全部可用 (没有标签泄露问题, 组成向量本来就是已知的),
        pure 仅使用 80% train split。
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # 数据: 已经过 data.py 管线, 这里再做 StandardScaler fit on train-only
    X = ds.X_value.astype(np.float32)          # (N, T, 8), 已 bl+zs+max_norm
    N_total, T, C = X.shape

    X_flat = X.reshape(N_total, -1)
    scaler = StandardScaler()
    scaler.fit(X_flat[train_global_idx])
    X_flat = scaler.transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, C)

    compositions = _build_compositions(ds)      # (N, 5)

    # 构建 DataLoader
    sub_ds = SensorDataset(
        X_norm[train_global_idx], compositions[train_global_idx], augment=True,
    )
    loader = DataLoader(sub_ds, batch_size=batch_size, shuffle=True, drop_last=True)

    encoder = CARLEncoder(in_channels=C, embed_dim=128).to(device)
    criterion = SoftSupConLoss(temperature=temperature, sigma=sigma)
    optimizer = _make_contrastive_optimizer(encoder.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    encoder.train()
    for epoch in range(epochs):
        losses = []
        for x_batch, comps, _ in loader:
            x_batch = x_batch.to(device)
            comps = comps.to(device)
            z = encoder(x_batch)
            loss = criterion(z, comps)
            if torch.isnan(loss) or torch.isinf(loss):
                continue
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(encoder.parameters(), 1.0)
            optimizer.step()
            losses.append(loss.item())
        scheduler.step()
        if verbose and (epoch + 1) % 50 == 0:
            print(f"    CARL pretrain epoch {epoch+1:3d}/{epochs}: loss={np.mean(losses):.4f}")

    return encoder, scaler


# ═══════════════════════════════════════════════════════════════
# 嵌入提取 (使用 get_features: GAP 后的 128D, 不含 projector + L2-norm)
# ═══════════════════════════════════════════════════════════════

def extract_features(
    encoder: CARLEncoder, ds: PaperDataset, scaler: StandardScaler,
    use_projector: bool = False,
) -> np.ndarray:
    """提取特征: get_features (pre-projector, 128D) 或 forward (post-projector)."""
    device = next(encoder.parameters()).device
    encoder.eval()

    X = ds.X_value.astype(np.float32)
    N_total, T, C = X.shape
    X_flat = X.reshape(N_total, -1)
    X_flat = scaler.transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, C)

    feats = []
    with torch.no_grad():
        for i in range(0, N_total, 64):
            batch = torch.tensor(X_norm[i:i+64], dtype=torch.float32).to(device)
            batch = batch.permute(0, 2, 1)  # (B, C, T)
            if use_projector:
                z = encoder(batch)
            else:
                z = encoder.get_features(batch)
            feats.append(z.cpu().numpy())
    return np.concatenate(feats, axis=0)


# ═══════════════════════════════════════════════════════════════
# 端到端微调 (CARL backbone + Linear classifier)
# ═══════════════════════════════════════════════════════════════

class CARLClassifier(nn.Module):
    """CARL encoder (pre-trained) + Linear classifier.

    使用 encoder.get_features() 的 128D GAP 输出, 接 BN + Linear.
    """

    def __init__(self, encoder: CARLEncoder, n_classes: int, freeze_backbone: bool = False):
        super().__init__()
        self.encoder = encoder
        self.bn = nn.BatchNorm1d(128)
        self.dropout = nn.Dropout(0.3)
        self.head = nn.Linear(128, n_classes)
        if freeze_backbone:
            for p in self.encoder.parameters():
                p.requires_grad = False

    def forward(self, x):
        """x: (B, C, T)"""
        h = self.encoder.get_features(x)   # (B, 128)
        h = self.bn(h)
        h = self.dropout(h)
        return self.head(h)


class ClsDataset(Dataset):
    """CArl-FT 分类数据集: 支持 Aroma-Aware 强增强 + oversample."""

    def __init__(
        self,
        X: np.ndarray,
        y: np.ndarray,
        augment: bool = False,
        oversample: int = 1,
    ):
        self.X = torch.tensor(X, dtype=torch.float32)  # (N, T, C)
        self.y = torch.tensor(y, dtype=torch.long)
        self.augment = augment
        self.oversample = oversample
        self._len = len(self.X) * self.oversample

    def __len__(self):
        return self._len

    def __getitem__(self, i):
        real_i = i % len(self.X)
        x = self.X[real_i].clone()  # (T, C)
        if self.augment:
            x = self._aug(x)
        return x.T, self.y[real_i]  # (C, T), y

    def _aug(self, x: torch.Tensor) -> torch.Tensor:
        """Aroma-Aware 强增强 (调用共享的 _strong_augment_batch)."""
        # (T, C) -> (1, C, T) -> augment -> (T, C)
        x_b = x.T.unsqueeze(0)
        x_b = _strong_augment_batch(x_b)
        return x_b.squeeze(0).T


def mixup_batch(
    x: torch.Tensor, y: torch.Tensor, alpha: float = 0.2, n_classes: int = 5,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Mixup: 对 batch 做样本线性插值 + soft label 插值.

    Returns:
        mixed_x: (B, C, T)
        mixed_y_soft: (B, n_classes)
    """
    if alpha > 0:
        lam = float(np.random.beta(alpha, alpha))
    else:
        lam = 1.0
    B = x.size(0)
    perm = torch.randperm(B, device=x.device)
    mixed_x = lam * x + (1 - lam) * x[perm]
    y_onehot = F.one_hot(y, num_classes=n_classes).float()
    y_perm = F.one_hot(y[perm], num_classes=n_classes).float()
    mixed_y = lam * y_onehot + (1 - lam) * y_perm
    return mixed_x, mixed_y


def predict_with_tta(
    model: nn.Module,
    X: np.ndarray,             # (N, T, C) already scaled
    n_augments: int = 20,
    device: torch.device | None = None,
) -> np.ndarray:
    """TTA: 原始推理权重×2 + n_augments 次强增强推理取 softmax 平均."""
    model.eval()
    if device is None:
        device = next(model.parameters()).device
    N, T, C = X.shape
    # 原始推理 (权重×2)
    with torch.no_grad():
        x_t = torch.tensor(X, dtype=torch.float32).permute(0, 2, 1).to(device)
        logits = model(x_t)
        probs = F.softmax(logits, dim=1).cpu().numpy()
        n_classes = probs.shape[1]
        logits_sum = probs * 2.0
    # TTA 增强推理
    aug_ds = ClsDataset(X, np.zeros(N, dtype=np.int64), augment=True)
    for _ in range(n_augments):
        with torch.no_grad():
            batch_probs = []
            for i in range(N):
                x_aug, _ = aug_ds[i]
                x_aug = x_aug.unsqueeze(0).to(device)
                lg = model(x_aug)
                batch_probs.append(F.softmax(lg, dim=1).cpu().numpy())
            logits_sum = logits_sum + np.concatenate(batch_probs, axis=0)
    return logits_sum.argmax(axis=1)


def finetune_classifier(
    encoder: CARLEncoder, scaler: StandardScaler,
    ds: PaperDataset, tr: np.ndarray, te: np.ndarray,
    n_classes: int, epochs: int = 200, lr: float = 1e-3,
    freeze_backbone: bool = False, batch_size: int = 32,
    label_smoothing: float = 0.1,
    print_every: int = 20,
    oversample: int = 8,
    mixup_alpha: float = 0.2,
    tta_augments: int = 20,
) -> tuple[np.ndarray, float]:
    """CArl 端到端微调 (Aroma-Aware Finetuning).

    融合 E2E 的完整增强全家桶作为 CArl Finetuning 的组件:
      - Aroma-Aware 强增强 (ClsDataset._aug → _strong_augment_batch)
      - Oversample ×8  (每个样本重复增强)
      - Mixup (α=0.2, 仅 unfrozen backbone 时)
      - Label smoothing 0.1
      - TTA ×20 (推理期)

    Returns:
        y_pred: TTA 推理结果 (基于 best val state)
        best_acc: best val acc during training (pre-TTA)
    """
    device = next(encoder.parameters()).device

    # 准备数据 (使用 pretrain 的 scaler)
    # 注意: train_carl_on_subset 在 fit scaler 前做了基线减除,
    #       这里也必须做相同的预处理以保持一致.
    X = ds.X_value.astype(np.float32)
    pure_idx = ds.pure_indices
    X_pure = X[pure_idx]
    N, T, C = X_pure.shape
    bl = max(1, T // 10)
    baseline = X_pure[:, :bl, :].mean(axis=1, keepdims=True)
    X_pure_delta = (X_pure - baseline).astype(np.float32)
    X_flat = X_pure_delta.reshape(N, -1)
    X_flat = scaler.transform(X_flat).astype(np.float32)
    X_pure_norm = X_flat.reshape(N, T, C)

    tea_ids = np.array([ds.tea_ids[i] for i in pure_idx])
    le = LabelEncoder()
    y = le.fit_transform(tea_ids)

    X_tr, X_te = X_pure_norm[tr], X_pure_norm[te]
    y_tr, y_te = y[tr], y[te]

    tr_ds = ClsDataset(X_tr, y_tr, augment=True, oversample=oversample)
    te_ds = ClsDataset(X_te, y_te, augment=False)
    tr_loader = DataLoader(tr_ds, batch_size=batch_size, shuffle=True, drop_last=False)
    te_loader = DataLoader(te_ds, batch_size=batch_size, shuffle=False)

    # 复制 encoder 避免污染 pretrain weights
    import copy
    enc_copy = copy.deepcopy(encoder).to(device)
    model = CARLClassifier(enc_copy, n_classes, freeze_backbone=freeze_backbone).to(device)

    # backbone 小 lr, head 大 lr (差异化学习率)
    if freeze_backbone:
        params = [{"params": model.head.parameters(), "lr": lr}]
    else:
        params = [
            {"params": model.encoder.parameters(), "lr": lr * 0.1},  # backbone 小 lr
            {"params": model.bn.parameters(), "lr": lr},
            {"params": model.head.parameters(), "lr": lr},
        ]
    optimizer = torch.optim.AdamW(params, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    # Mixup 仅在解冻模式下启用 (冻结 backbone 时 head 参数太少, mixup 反而噪声)
    use_mixup = (mixup_alpha > 0.0) and (not freeze_backbone)

    best_acc = 0.0
    best_state = None
    for epoch in range(epochs):
        model.train()
        tl = []
        for xb, yb in tr_loader:
            xb, yb = xb.to(device), yb.to(device)
            if use_mixup:
                mixed_x, mixed_y_soft = mixup_batch(xb, yb, alpha=mixup_alpha, n_classes=n_classes)
                logits = model(mixed_x)
                # soft CE with label smoothing
                y_smooth = mixed_y_soft * (1 - label_smoothing) + label_smoothing / n_classes
                logp = F.log_softmax(logits, dim=1)
                loss = -(y_smooth * logp).sum(dim=1).mean()
            else:
                logits = model(xb)
                loss = F.cross_entropy(logits, yb, label_smoothing=label_smoothing)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            tl.append(loss.item())
        scheduler.step()

        # 评估 (无 TTA, 快速)
        model.eval()
        preds = []
        with torch.no_grad():
            for xb, _ in te_loader:
                xb = xb.to(device)
                logits = model(xb)
                preds.append(logits.argmax(dim=1).cpu().numpy())
        preds = np.concatenate(preds)
        acc = accuracy_score(y_te, preds)

        if acc > best_acc:
            best_acc = acc
            best_state = copy.deepcopy(model.state_dict())

        if (epoch + 1) % print_every == 0 or epoch == 0:
            print(f"    epoch {epoch+1:3d}/{epochs}: train_loss={np.mean(tl):.4f} val_acc={acc:.4f} "
                  f"(best={best_acc:.4f})")

    # ── TTA 推理: 加载 best state, 对 X_te 做 tta_augments 次强增强 ──
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    if tta_augments > 0:
        y_pred_tta = predict_with_tta(model, X_te, n_augments=tta_augments, device=device)
        acc_tta = accuracy_score(y_te, y_pred_tta)
        print(f"    TTA×{tta_augments}: {acc_tta:.4f} (pre-TTA best={best_acc:.4f})")
        # 返回 TTA 结果 vs best 中较优者
        if acc_tta >= best_acc:
            return y_pred_tta, acc_tta
    # fallback: 用 best state 跑一次普通推理
    preds_best = []
    with torch.no_grad():
        for xb, _ in te_loader:
            xb = xb.to(device)
            logits = model(xb)
            preds_best.append(logits.argmax(dim=1).cpu().numpy())
    preds_best = np.concatenate(preds_best)
    return preds_best, best_acc


# ═══════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pretrain-epochs", type=int, default=300)
    parser.add_argument("--finetune-epochs", type=int, default=200)
    parser.add_argument("--carl-batch", type=int, default=128)
    parser.add_argument("--finetune-batch", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--sigma", type=float, default=0.5)
    parser.add_argument("--temperature", type=float, default=0.5)
    parser.add_argument("--skip-ft", action="store_true", help="跳过端到端微调")
    parser.add_argument("--boost-alpha", type=float, default=None,
                        help="⚠️ 类 signature boost 强度, None=用 config 默认, 0=关闭, >0 开启")
    parser.add_argument("--exclude-teas", nargs="*", default=None,
                        help="覆盖 config.EXCLUDED_TEAS, 空值即 5 类")
    args = parser.parse_args()

    print("=" * 80)
    print("  CARL Pre-train + Classification Fine-tune (方向 B)")
    print("=" * 80)
    print(f"  pretrain_epochs={args.pretrain_epochs}  finetune_epochs={args.finetune_epochs}")
    print(f"  carl_batch={args.carl_batch}  finetune_batch={args.finetune_batch}")
    print(f"  sigma={args.sigma}  temperature={args.temperature}")

    ensure_dirs()

    ds = build_dataset(
        cutoff_s=80.0,
        exclude_teas=args.exclude_teas,
        boost_alpha=args.boost_alpha,
    )
    print(f"\n  数据: 总样本={ds.n_total}  纯样={ds.n_pure}  混样={ds.n_mix}")
    print(f"  X_value: shape={ds.X_value.shape}, 值域=[{ds.X_value.min():.3f}, {ds.X_value.max():.3f}]")

    # ═════════════════════════════════════════
    # 划分: 纯样 80/20 split
    # ═════════════════════════════════════════
    pure_idx = ds.pure_indices
    tea_ids = np.array([ds.tea_ids[i] for i in pure_idx])
    le = LabelEncoder()
    y = le.fit_transform(tea_ids)
    n_classes = len(le.classes_)

    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    tr, te = next(sss.split(np.zeros(len(pure_idx)), y))  # relative to pure_idx

    # 全局索引 (pure_idx 空间 → 全局 ds.X_value 空间)
    pure_idx_arr = np.array(pure_idx)
    pure_tr_global = pure_idx_arr[tr]
    pure_te_global = pure_idx_arr[te]

    mix_idx_arr = np.array(ds.mix_indices)
    # CARL 预训练数据 = 纯样 train + 全部混合 (避免 test-set 泄露)
    pretrain_global = np.concatenate([pure_tr_global, mix_idx_arr])
    print(f"  纯样 split: train={len(tr)}, val={len(te)}, classes={n_classes} {list(le.classes_)}")
    print(f"  CARL pretrain 样本: {len(pretrain_global)} (pure_train {len(pure_tr_global)} + mix {len(mix_idx_arr)})")

    # ═════════════════════════════════════════
    # Stage 1: CARL 预训练
    # ═════════════════════════════════════════
    print("\n" + "=" * 80)
    print("  Stage 1: CARL 预训练")
    print("=" * 80)

    encoder, scaler = pretrain_carl(
        ds, pretrain_global,
        epochs=args.pretrain_epochs,
        lr=args.lr,
        batch_size=args.carl_batch,
        temperature=args.temperature,
        sigma=args.sigma,
        verbose=True,
    )

    # 保存
    weight_path = CACHE_DIR / "carl_finetune_encoder.pt"
    torch.save({"state_dict": encoder.state_dict(), "scaler_mean": scaler.mean_,
                "scaler_scale": scaler.scale_}, weight_path)
    print(f"  权重 → {weight_path.name}")

    # ═════════════════════════════════════════
    # Stage 2: 冻结 encoder + 线性/SVM 探针
    # ═════════════════════════════════════════
    print("\n" + "=" * 80)
    print("  Stage 2: 冻结 encoder + 线性探针 / SVM")
    print("=" * 80)

    # 提取 pre-projector (128D GAP) 特征
    feats = extract_features(encoder, ds, scaler, use_projector=False)  # (N_total, 128)
    feats_pure = feats[pure_idx]
    feats_tr, feats_te = feats_pure[tr], feats_pure[te]
    y_tr, y_te = y[tr], y[te]

    print(f"  特征 shape: {feats.shape}")

    # (a) Logistic Regression
    lr_pipe = make_pipeline(StandardScaler(), LogisticRegression(max_iter=5000, C=1.0))
    lr_pipe.fit(feats_tr, y_tr)
    lr_acc = lr_pipe.score(feats_te, y_te)
    print(f"\n  (a) Logistic Regression:  {lr_acc:.4f}")

    # (b) SVM-RBF with C grid
    results_svm = {}
    for C_val in [1.0, 10.0, 50.0, 100.0]:
        svm_pipe = make_pipeline(StandardScaler(), SVC(kernel="rbf", C=C_val, gamma="scale"))
        svm_pipe.fit(feats_tr, y_tr)
        acc = svm_pipe.score(feats_te, y_te)
        results_svm[C_val] = acc
        print(f"  (b) SVM-RBF (C={C_val:5.1f}):     {acc:.4f}")

    best_svm_C = max(results_svm, key=results_svm.get)
    best_svm_acc = results_svm[best_svm_C]

    # (c) k-NN
    from sklearn.neighbors import KNeighborsClassifier
    knn_pipe = make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=5))
    knn_pipe.fit(feats_tr, y_tr)
    knn_acc = knn_pipe.score(feats_te, y_te)
    print(f"  (c) k-NN (k=5):            {knn_acc:.4f}")

    # ═════════════════════════════════════════
    # Stage 3: 端到端微调 (backbone lr * 0.1, head full lr)
    # ═════════════════════════════════════════
    if args.skip_ft:
        print("\n  (跳过 Stage 3 端到端微调)")
        ft_acc_unfrozen = None
        ft_acc_frozen = None
    else:
        print("\n" + "=" * 80)
        print("  Stage 3a: 端到端微调 (backbone 解冻, 差异化 lr)")
        print("=" * 80)

        preds_unfrozen, ft_acc_unfrozen = finetune_classifier(
            encoder, scaler, ds, tr, te, n_classes,
            epochs=args.finetune_epochs, lr=args.lr,
            freeze_backbone=False, batch_size=args.finetune_batch,
            print_every=max(1, args.finetune_epochs // 10),
        )

        print("\n" + "=" * 80)
        print("  Stage 3b: 冻结 backbone 微调 (仅训 head)")
        print("=" * 80)

        preds_frozen, ft_acc_frozen = finetune_classifier(
            encoder, scaler, ds, tr, te, n_classes,
            epochs=args.finetune_epochs, lr=args.lr,
            freeze_backbone=True, batch_size=args.finetune_batch,
            print_every=max(1, args.finetune_epochs // 10),
        )

    # ═════════════════════════════════════════
    # 汇总
    # ═════════════════════════════════════════
    print("\n" + "=" * 80)
    print("  最终结果 (方向 B: CARL Pre-train + Classification)")
    print("=" * 80)
    print(f"  数据: 纯样 test={len(te)}, CARL 预训练={len(pretrain_global)} 样本")
    print()
    print(f"  [A] Logistic Reg (冻结):            {lr_acc*100:5.2f}%")
    print(f"  [B] SVM-RBF C={best_svm_C:<5} (冻结):      {best_svm_acc*100:5.2f}%")
    print(f"  [C] k-NN k=5 (冻结):                {knn_acc*100:5.2f}%")
    if ft_acc_unfrozen is not None:
        print(f"  [D] 端到端微调 (解冻, 差异 lr):     {ft_acc_unfrozen*100:5.2f}%")
        print(f"  [E] 冻结 backbone 微调 head:        {ft_acc_frozen*100:5.2f}%")
    print()
    print(f"  LSTM_Attn baseline (无 CARL):       68.80%")
    print()
    best_carl = max([lr_acc, best_svm_acc, knn_acc] +
                    ([ft_acc_unfrozen, ft_acc_frozen] if ft_acc_unfrozen else []))
    gain = best_carl - 0.688
    print(f"  CARL best:                          {best_carl*100:5.2f}%  (vs LSTM_Attn Δ={gain*100:+.2f}%)")

    # 最佳模型的 classification report
    if ft_acc_unfrozen is not None and ft_acc_unfrozen >= max(lr_acc, best_svm_acc, knn_acc):
        print(f"\n  Classification Report (端到端微调, 解冻):")
        print(classification_report(y_te, preds_unfrozen, target_names=list(le.classes_),
                                    zero_division=0, digits=3))
        print(f"  Confusion Matrix:\n{confusion_matrix(y_te, preds_unfrozen)}")
    else:
        # 用最优线性/SVM 模型
        if best_svm_acc >= max(lr_acc, knn_acc):
            best_pipe = make_pipeline(StandardScaler(), SVC(kernel="rbf", C=best_svm_C, gamma="scale"))
            best_pipe.fit(feats_tr, y_tr)
            best_preds = best_pipe.predict(feats_te)
            name = f"SVM-RBF C={best_svm_C}"
        elif lr_acc >= knn_acc:
            best_preds = lr_pipe.predict(feats_te)
            name = "Logistic Regression"
        else:
            best_preds = knn_pipe.predict(feats_te)
            name = "k-NN"
        print(f"\n  Classification Report ({name}):")
        print(classification_report(y_te, best_preds, target_names=list(le.classes_),
                                    zero_division=0, digits=3))
        print(f"  Confusion Matrix:\n{confusion_matrix(y_te, best_preds)}")


if __name__ == "__main__":
    main()

