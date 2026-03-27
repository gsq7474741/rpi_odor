"""自监督/无监督表征学习基线 — 用于与 CARL 对比。

实现:
  1. TS2Vec (简化版): 时序层级对比学习
  2. Autoencoder (AE): 重构式表征
  3. Vanilla Contrastive (SimCLR-style): 通用对比学习, 无领域特定设计

所有基线输出 128D 嵌入, 与 CARL 保持一致。
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KNeighborsClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import accuracy_score
from sklearn.pipeline import Pipeline

from .config import SEED, N_CV_FOLDS, CARL_EMBED_DIM

torch.manual_seed(SEED)
np.random.seed(SEED)

EMBED_DIM = CARL_EMBED_DIM  # 128


# ═══════════════════════════════════════════════════════════════
# 共享工具
# ═══════════════════════════════════════════════════════════════

def _prepare_timeseries(X_value: np.ndarray) -> np.ndarray:
    """Baseline-normalize raw sensor data → (N, T, 8) float32."""
    T = X_value.shape[1]
    bl = max(1, T // 10)
    baseline = X_value[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    return ((X_value - baseline) / baseline).astype(np.float32)


def _eval_embedding_knn(
    embeddings: np.ndarray, y: np.ndarray, n_folds: int = N_CV_FOLDS
) -> float:
    """Evaluate embeddings via k-NN classification accuracy (5-fold CV)."""
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=SEED)
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", KNeighborsClassifier(n_neighbors=5)),
    ])
    y_pred = cross_val_predict(pipe, embeddings, y, cv=skf)
    return accuracy_score(y, y_pred)


# ═══════════════════════════════════════════════════════════════
# 1. TS2Vec (简化版)
# ═══════════════════════════════════════════════════════════════

class _DilatedConvBlock(nn.Module):
    """单层膨胀因果卷积块。"""

    def __init__(self, in_ch: int, out_ch: int, dilation: int):
        super().__init__()
        self.conv = nn.Conv1d(
            in_ch, out_ch, kernel_size=3,
            padding=dilation, dilation=dilation,
        )
        self.bn = nn.BatchNorm1d(out_ch)

    def forward(self, x):
        return F.relu(self.bn(self.conv(x)))


class TS2VecEncoder(nn.Module):
    """简化 TS2Vec 编码器: 多层膨胀卷积 + 投影头。"""

    def __init__(self, in_channels: int = 8, hidden: int = 64, embed_dim: int = EMBED_DIM):
        super().__init__()
        self.input_proj = nn.Conv1d(in_channels, hidden, 1)
        self.blocks = nn.ModuleList([
            _DilatedConvBlock(hidden, hidden, dilation=2 ** i)
            for i in range(4)  # 膨胀率 1, 2, 4, 8
        ])
        self.projector = nn.Sequential(
            nn.Linear(hidden, embed_dim),
        )

    def forward(self, x):
        """x: (B, C, T) → (B, T, hidden)"""
        h = self.input_proj(x)  # (B, hidden, T)
        for block in self.blocks:
            h = h + block(h)  # 残差
        return h  # (B, hidden, T)

    def encode(self, x):
        """提取全局表示 (max-pool over time)。"""
        h = self.forward(x)  # (B, hidden, T)
        h = h.max(dim=2).values  # (B, hidden)
        return self.projector(h)


def _ts2vec_contrastive_loss(z1, z2, temporal: bool = True):
    """TS2Vec 的 instance + temporal 对比损失 (简化版)。

    z1, z2: (B, hidden, T) 两个裁剪视图的表示 (重叠区域已对齐)
    """
    B, D, T = z1.shape

    # Instance-level: 对时间维度 max-pool, 然后做 instance 对比
    r1 = z1.max(dim=2).values  # (B, D)
    r2 = z2.max(dim=2).values  # (B, D)
    r1 = F.normalize(r1, dim=1)
    r2 = F.normalize(r2, dim=1)
    sim = torch.mm(r1, r2.T) / 0.1  # (B, B)
    labels = torch.arange(B, device=z1.device)
    loss_inst = (F.cross_entropy(sim, labels) + F.cross_entropy(sim.T, labels)) / 2

    if not temporal or T < 2:
        return loss_inst

    # Temporal-level: 对每个时间步做对比 (简化: 随机选 K 个时间步)
    K = min(T, 16)
    tidx = torch.randperm(T)[:K]
    t1 = F.normalize(z1[:, :, tidx].permute(0, 2, 1).reshape(-1, D), dim=1)  # (B*K, D)
    t2 = F.normalize(z2[:, :, tidx].permute(0, 2, 1).reshape(-1, D), dim=1)
    sim_t = torch.mm(t1, t2.T) / 0.1
    labels_t = torch.arange(B * K, device=z1.device)
    loss_temp = (F.cross_entropy(sim_t, labels_t) + F.cross_entropy(sim_t.T, labels_t)) / 2

    return loss_inst + 0.5 * loss_temp


def train_ts2vec(
    X_value: np.ndarray,
    epochs: int = 200,
    lr: float = 1e-3,
    batch_size: int = 64,
) -> np.ndarray:
    """训练 TS2Vec 并返回所有样本的嵌入。"""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X_norm = _prepare_timeseries(X_value)
    N, T, C = X_norm.shape

    # (N, C, T) for Conv1d
    X_t = torch.tensor(X_norm, dtype=torch.float32).permute(0, 2, 1)
    dataset = TensorDataset(X_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)

    model = TS2VecEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        total_loss = 0
        for (xb,) in loader:
            xb = xb.to(device)  # (B, C, T)
            B_cur, _, T_cur = xb.shape

            # 随机裁剪两个重叠视图
            crop_len = max(T_cur // 2, 4)
            start1 = np.random.randint(0, T_cur - crop_len + 1)
            start2 = np.random.randint(0, T_cur - crop_len + 1)
            # 确保有重叠
            overlap_start = max(start1, start2)
            overlap_end = min(start1 + crop_len, start2 + crop_len)
            if overlap_end <= overlap_start:
                start2 = start1  # fallback: 相同裁剪
                overlap_start, overlap_end = start1, start1 + crop_len

            v1 = xb[:, :, start1:start1 + crop_len]
            v2 = xb[:, :, start2:start2 + crop_len]

            z1 = model(v1)
            z2 = model(v2)

            # 对齐到重叠区域
            o1_start = overlap_start - start1
            o2_start = overlap_start - start2
            o_len = overlap_end - overlap_start
            if o_len > 0:
                z1_o = z1[:, :, o1_start:o1_start + o_len]
                z2_o = z2[:, :, o2_start:o2_start + o_len]
                loss = _ts2vec_contrastive_loss(z1_o, z2_o)
            else:
                # fallback: instance-level only
                loss = _ts2vec_contrastive_loss(z1, z2, temporal=False)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        scheduler.step()

    # 提取全部嵌入
    model.eval()
    all_emb = []
    with torch.no_grad():
        for i in range(0, N, batch_size):
            xb = X_t[i:i + batch_size].to(device)
            emb = model.encode(xb)
            all_emb.append(emb.cpu().numpy())
    return np.concatenate(all_emb, axis=0)


# ═══════════════════════════════════════════════════════════════
# 2. Autoencoder
# ═══════════════════════════════════════════════════════════════

class _AEEncoder(nn.Module):
    """Conv1D encoder (same backbone as CARL, no SE)."""

    def __init__(self, in_channels: int = 8, embed_dim: int = EMBED_DIM):
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
        self.proj = nn.Linear(128, embed_dim)

    def forward(self, x):
        h = self.conv_blocks(x)
        h = self.gap(h).squeeze(-1)
        return self.proj(h)


class _AEDecoder(nn.Module):
    """Transposed-conv decoder to reconstruct time series."""

    def __init__(self, embed_dim: int = EMBED_DIM, out_channels: int = 8, out_len: int = 100):
        super().__init__()
        self.out_len = out_len
        self.fc = nn.Linear(embed_dim, 128 * (out_len // 4))
        self.deconv = nn.Sequential(
            nn.ConvTranspose1d(128, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm1d(64), nn.ReLU(inplace=True),
            nn.ConvTranspose1d(64, 32, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm1d(32), nn.ReLU(inplace=True),
            nn.Conv1d(32, out_channels, kernel_size=3, padding=1),
        )

    def forward(self, z):
        B = z.shape[0]
        h = self.fc(z).view(B, 128, self.out_len // 4)
        return self.deconv(h)  # (B, out_channels, out_len)


class TimeSeriesAE(nn.Module):
    def __init__(self, in_channels=8, embed_dim=EMBED_DIM, seq_len=100):
        super().__init__()
        self.encoder = _AEEncoder(in_channels, embed_dim)
        self.decoder = _AEDecoder(embed_dim, in_channels, seq_len)

    def forward(self, x):
        z = self.encoder(x)
        x_hat = self.decoder(z)
        return x_hat, z


def train_autoencoder(
    X_value: np.ndarray,
    epochs: int = 200,
    lr: float = 1e-3,
    batch_size: int = 64,
) -> np.ndarray:
    """训练 AE 并返回所有样本的嵌入。"""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X_norm = _prepare_timeseries(X_value)
    N, T, C = X_norm.shape

    X_t = torch.tensor(X_norm, dtype=torch.float32).permute(0, 2, 1)  # (N, C, T)
    dataset = TensorDataset(X_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=False)

    model = TimeSeriesAE(in_channels=C, embed_dim=EMBED_DIM, seq_len=T).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        for (xb,) in loader:
            xb = xb.to(device)
            x_hat, z = model(xb)
            loss = F.mse_loss(x_hat, xb)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        scheduler.step()

    # 提取全部嵌入
    model.eval()
    all_emb = []
    with torch.no_grad():
        for i in range(0, N, batch_size):
            xb = X_t[i:i + batch_size].to(device)
            emb = model.encoder(xb)
            all_emb.append(emb.cpu().numpy())
    return np.concatenate(all_emb, axis=0)


# ═══════════════════════════════════════════════════════════════
# 3. Vanilla Contrastive (SimCLR-style, 无领域特定设计)
# ═══════════════════════════════════════════════════════════════

class _VanillaEncoder(nn.Module):
    """Same CNN backbone as CARL but NO SE attention, NO domain-specific projector."""

    def __init__(self, in_channels: int = 8, embed_dim: int = EMBED_DIM):
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
        self.projector = nn.Sequential(
            nn.Linear(128, 128),
            nn.ReLU(inplace=True),
            nn.Linear(128, embed_dim),
        )

    def forward(self, x):
        h = self.conv_blocks(x)
        h = self.gap(h).squeeze(-1)
        z = self.projector(h)
        return F.normalize(z, dim=1)


def _random_augment(x: torch.Tensor) -> torch.Tensor:
    """通用随机增强 (非领域特定): 高斯噪声 + 时间平移。

    x: (B, C, T)
    """
    B, C, T = x.shape
    # Gaussian noise
    noise_std = 0.02
    x = x + torch.randn_like(x) * noise_std
    # Random time shift (±5%)
    shift = np.random.randint(-max(1, T // 20), max(1, T // 20) + 1)
    if shift > 0:
        x = torch.cat([x[:, :, shift:], x[:, :, -1:].expand(B, C, shift)], dim=2)
    elif shift < 0:
        x = torch.cat([x[:, :, :1].expand(B, C, -shift), x[:, :, :shift]], dim=2)
    return x


def _nt_xent_loss(z1, z2, temperature=0.1):
    """Standard NT-Xent (SimCLR) loss.

    z1, z2: (B, D) L2-normalized embeddings of two augmented views.
    """
    B = z1.shape[0]
    z = torch.cat([z1, z2], dim=0)  # (2B, D)
    sim = torch.mm(z, z.T) / temperature  # (2B, 2B)
    # Mask out self-similarity
    mask = torch.eye(2 * B, device=z.device).bool()
    sim.masked_fill_(mask, float("-inf"))
    # Positive pairs: (i, i+B) and (i+B, i)
    labels = torch.cat([
        torch.arange(B, 2 * B, device=z.device),
        torch.arange(0, B, device=z.device),
    ])
    return F.cross_entropy(sim, labels)


def train_vanilla_contrastive(
    X_value: np.ndarray,
    epochs: int = 200,
    lr: float = 1e-3,
    batch_size: int = 64,
) -> np.ndarray:
    """训练 Vanilla Contrastive (SimCLR-style) 并返回嵌入。"""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X_norm = _prepare_timeseries(X_value)
    N, T, C = X_norm.shape

    X_t = torch.tensor(X_norm, dtype=torch.float32).permute(0, 2, 1)
    dataset = TensorDataset(X_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)

    model = _VanillaEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        for (xb,) in loader:
            xb = xb.to(device)
            v1 = _random_augment(xb)
            v2 = _random_augment(xb)
            z1 = model(v1)
            z2 = model(v2)
            loss = _nt_xent_loss(z1, z2)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        scheduler.step()

    # 提取全部嵌入
    model.eval()
    all_emb = []
    with torch.no_grad():
        for i in range(0, N, batch_size):
            xb = X_t[i:i + batch_size].to(device)
            emb = model(xb)
            all_emb.append(emb.cpu().numpy())
    return np.concatenate(all_emb, axis=0)


# ═══════════════════════════════════════════════════════════════
# 统一评估入口
# ═══════════════════════════════════════════════════════════════

def run_all_baselines(
    X_value_all: np.ndarray,
    pure_idx: np.ndarray,
    y: np.ndarray,
    epochs: int = 200,
) -> list[dict]:
    """训练所有自监督基线并评估分类性能。

    Args:
        X_value_all: (N_total, T, 8) 全部样本的原始时序 (训练在全部数据上)
        pure_idx: 纯样索引
        y: (n_pure,) 纯样标签
        epochs: 训练轮数

    Returns:
        [{method, accuracy}, ...]
    """
    results = []

    # 1. TS2Vec
    print(f"    训练 TS2Vec ({epochs} epochs)...")
    emb_ts2vec = train_ts2vec(X_value_all, epochs=epochs)
    acc = _eval_embedding_knn(emb_ts2vec[pure_idx], y)
    results.append({"feature": "TS2Vec_embedding", "classifier": "k-NN", "accuracy": round(acc * 100, 1)})
    print(f"      TS2Vec + k-NN: {acc:.1%}")

    # 2. Autoencoder
    print(f"    训练 Autoencoder ({epochs} epochs)...")
    emb_ae = train_autoencoder(X_value_all, epochs=epochs)
    acc = _eval_embedding_knn(emb_ae[pure_idx], y)
    results.append({"feature": "AE_embedding", "classifier": "k-NN", "accuracy": round(acc * 100, 1)})
    print(f"      AE + k-NN: {acc:.1%}")

    # 3. Vanilla Contrastive
    print(f"    训练 Vanilla Contrastive ({epochs} epochs)...")
    emb_vc = train_vanilla_contrastive(X_value_all, epochs=epochs)
    acc = _eval_embedding_knn(emb_vc[pure_idx], y)
    results.append({"feature": "VanillaContrastive_embedding", "classifier": "k-NN", "accuracy": round(acc * 100, 1)})
    print(f"      Vanilla Contrastive + k-NN: {acc:.1%}")

    return results
