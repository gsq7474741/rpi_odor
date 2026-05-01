"""实验3: CARL 对比表征学习 (§3.4) — 创新点

Contrastive Aroma Representation Learning: 训练对比编码器, 构建结构化香气嵌入空间。

模型架构:
  输入 (8, T) → 1D-CNN ×3 层 + SE 通道注意力 + GAP → MLP 投影头 → 128D 嵌入

输出:
  - Fig.4: CARL 嵌入 UMAP 可视化
  - Fig.5: NLDI vs 嵌入偏差相关性散点图
  - Fig.6: SE 通道注意力热力图
  - Table 4: 消融实验结果
  - 保存训练好的 encoder 权重
"""

from __future__ import annotations

import json
import hashlib
import numpy as np
import pickle
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import Ridge
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error

from .config import (
    SEED, N_SENSORS,
    TEA_IDS, TEA_NAME_EN, TEA_ORDER,
    CARL_EMBED_DIM, CARL_LR, CARL_EPOCHS, CARL_BATCH_SIZE, CARL_TEMPERATURE,
    CARL_RATIO_TOLERANCE,
    TABLES_DIR, FIGURES_DIR, CACHE_DIR, ensure_dirs,
)
from .data import PaperDataset
from .viz import init_style, save_fig, plot_heatmap

# 复用 baselines.py 中迁移自 E2E 的强增强与 SOAP 优化器工厂,
# 确保 CL baseline 与 CARL 预训练共享同一套增强/优化协议.
from .baselines import _strong_augment_batch, _make_contrastive_optimizer

# 固定随机种子
torch.manual_seed(SEED)
np.random.seed(SEED)


# ═══════════════════════════════════════════════════════════════
# 数据集
# ═══════════════════════════════════════════════════════════════

class SensorDataset(Dataset):
    """传感器时间序列数据集, 用于对比学习。"""

    def __init__(
        self,
        X: np.ndarray,               # (N, T, 8) baseline-normalized
        compositions: np.ndarray,    # (N, 5) 组成向量
        augment: bool = False,
    ):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.compositions = torch.tensor(compositions, dtype=torch.float32)
        self.augment = augment

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        x = self.X[idx]  # (T, 8)
        if self.augment:
            x = self._augment(x)
        # 转为 (8, T) — Conv1d 输入格式
        x = x.T
        return x, self.compositions[idx], idx

    def _augment(self, x: torch.Tensor) -> torch.Tensor:
        """数据增强: 对齐 E2E 全家桶 (shift / warp / noise / amp / ch_dropout / cutout).

        通过调用共享的 _strong_augment_batch 实现, 兼容旧接口 ((T, C) -> (T, C)).
        """
        # (T, C) -> (1, C, T) -> _strong_augment_batch -> (1, C, T) -> (T, C)
        x_b = x.T.unsqueeze(0)                              # (1, C, T)
        x_b = _strong_augment_batch(x_b)
        return x_b.squeeze(0).T                              # (T, C)


# ═══════════════════════════════════════════════════════════════
# 模型架构
# ═══════════════════════════════════════════════════════════════

class SEBlock(nn.Module):
    """Squeeze-and-Excitation 通道注意力"""

    def __init__(self, channels: int, reduction: int = 4):
        super().__init__()
        self.squeeze = nn.AdaptiveAvgPool1d(1)
        self.excitation = nn.Sequential(
            nn.Linear(channels, channels // reduction, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(channels // reduction, channels, bias=False),
            nn.Sigmoid(),
        )

    def forward(self, x):
        # x: (B, C, T)
        b, c, _ = x.size()
        w = self.squeeze(x).view(b, c)      # (B, C)
        w = self.excitation(w).view(b, c, 1)  # (B, C, 1)
        return x * w


class CARLEncoder(nn.Module):
    """CARL 编码器: 1D-CNN + SE Attention + GAP + Projection Head"""

    def __init__(self, in_channels: int = 8, embed_dim: int = CARL_EMBED_DIM):
        super().__init__()
        self.conv_blocks = nn.Sequential(
            # Block 1
            nn.Conv1d(in_channels, 32, kernel_size=7, padding=3),
            nn.BatchNorm1d(32), nn.ReLU(inplace=True), nn.MaxPool1d(2),
            # Block 2
            nn.Conv1d(32, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64), nn.ReLU(inplace=True), nn.MaxPool1d(2),
            # Block 3
            nn.Conv1d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm1d(128), nn.ReLU(inplace=True),
        )
        self.se = SEBlock(128, reduction=4)
        self.gap = nn.AdaptiveAvgPool1d(1)

        self.projector = nn.Sequential(
            nn.Linear(128, 128),
            nn.ReLU(inplace=True),
            nn.Linear(128, embed_dim),
        )

        # 用于提取 SE 权重的 hook
        self._se_weights = None

    def forward(self, x):
        """x: (B, 8, T) → embedding: (B, embed_dim)"""
        h = self.conv_blocks(x)      # (B, 128, T')
        h = self.se(h)               # (B, 128, T')
        h = self.gap(h).squeeze(-1)  # (B, 128)
        z = self.projector(h)         # (B, embed_dim)
        return F.normalize(z, dim=1)  # L2 归一化

    def get_features(self, x):
        """提取 GAP 后的特征 (不经过 projector), 用于下游任务"""
        h = self.conv_blocks(x)
        h = self.se(h)
        h = self.gap(h).squeeze(-1)
        return h

    def get_se_weights(self, x):
        """获取 SE 注意力权重"""
        h = self.conv_blocks(x)
        # 手动计算 SE 权重
        b, c, _ = h.size()
        w = self.se.squeeze(h).view(b, c)
        w = self.se.excitation(w)  # (B, 128)
        return w


class CARLDecoder(nn.Module):
    """Lightweight decoder for reconstruction auxiliary loss.

    Reconstructs (B, 8, T) from GAP features (B, 128).
    Used only during training to force signal preservation.
    """

    def __init__(self, in_dim: int = 128, out_channels: int = 8, seq_len: int = 100):
        super().__init__()
        self._seq_len = seq_len
        # T' after 2 MaxPool = T // 4 = 25
        self._t_inner = seq_len // 4
        self.fc = nn.Linear(in_dim, 128 * self._t_inner)
        self.deconv = nn.Sequential(
            nn.ConvTranspose1d(128, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm1d(64), nn.ReLU(inplace=True),
            nn.ConvTranspose1d(64, out_channels, kernel_size=4, stride=2, padding=1),
        )

    def forward(self, h):
        """h: (B, 128) → x_recon: (B, 8, T)"""
        x = self.fc(h).view(-1, 128, self._t_inner)  # (B, 128, 25)
        x = self.deconv(x)                            # (B, 8, ~100)
        # Trim or pad to exact seq_len
        if x.size(-1) > self._seq_len:
            x = x[:, :, :self._seq_len]
        elif x.size(-1) < self._seq_len:
            x = F.pad(x, (0, self._seq_len - x.size(-1)))
        return x


# ═══════════════════════════════════════════════════════════════
# Soft SupCon Loss (连续组成向量)
# ═══════════════════════════════════════════════════════════════

class SoftSupConLoss(nn.Module):
    """Soft Supervised Contrastive Loss — 基于组成向量的连续对比学习。

    用组成向量 (e.g. [0.7, 0.3, 0, 0, 0]) 的 L2 距离通过高斯核
    计算软正样本权重, 替代硬标签的二值正/负判定。

    - 同一纯茶 → 距离=0 → 最强正样本
    - T1-T2(70:30) vs 纯T1 → 距离≈0.42 → 中等正样本
    - 纯T1 vs 纯T2 → 距离≈1.41 → 弱正样本 (近似负样本)
    """

    def __init__(self, temperature: float = CARL_TEMPERATURE, sigma: float = 0.5):
        super().__init__()
        self.temperature = temperature
        self.sigma = sigma

    def forward(self, features, compositions):
        """
        features: (B, D) L2-normalized embeddings
        compositions: (B, K) 组成向量 (K=5 茶种)
        """
        device = features.device
        B = features.shape[0]

        # 余弦相似度矩阵
        sim = torch.matmul(features, features.T) / self.temperature  # (B, B)

        # 组成距离 → 高斯核软权重
        comp_diff = compositions.unsqueeze(0) - compositions.unsqueeze(1)  # (B, B, K)
        dist_sq = (comp_diff ** 2).sum(dim=2)  # (B, B)
        weights = torch.exp(-dist_sq / (2 * self.sigma ** 2))  # (B, B)

        # 排除自身
        self_mask = torch.eye(B, device=device).bool()
        weights = weights.masked_fill(self_mask, 0)

        # 数值稳定
        sim_max, _ = sim.max(dim=1, keepdim=True)
        sim = sim - sim_max.detach()

        # log-softmax 分母 (排除自身)
        sim_for_denom = sim.clone()
        sim_for_denom.masked_fill_(self_mask, float("-inf"))
        log_sum_exp = torch.logsumexp(sim_for_denom, dim=1)  # (B,)

        # 归一化权重
        weight_sum = weights.sum(dim=1, keepdim=True).clamp(min=1e-8)
        weights_norm = weights / weight_sum

        # 加权 log 概率
        log_prob = sim - log_sum_exp.unsqueeze(1)  # (B, B)
        loss = -(weights_norm * log_prob).sum(dim=1)  # (B,)

        valid = weights.sum(dim=1) > 1e-8
        if valid.sum() == 0:
            return torch.tensor(0.0, device=device, requires_grad=True)

        return loss[valid].mean()


# ═══════════════════════════════════════════════════════════════
# 组成向量构建
# ═══════════════════════════════════════════════════════════════

_TEA_INDEX = {"T1": 0, "T2": 1, "T3": 2, "T4": 3, "T5": 4}


def _build_compositions(ds: PaperDataset) -> np.ndarray:
    """构建 5D 组成向量: 每个样本在茶叶单纯形上的坐标。

    纯 T1       → [1.0, 0.0, 0.0, 0.0, 0.0]
    T1-T2 70:30 → [0.7, 0.3, 0.0, 0.0, 0.0]
    T3-T5 50:50 → [0.0, 0.0, 0.5, 0.0, 0.5]
    """
    N = ds.n_total
    compositions = np.zeros((N, 5), dtype=np.float32)
    for i in range(N):
        if ds.pure_mask[i]:
            tid = ds.tea_ids[i]
            compositions[i, _TEA_INDEX[tid]] = 1.0
        else:
            cid = ds.combo_ids[i]
            parts = cid.split("-")
            if len(parts) == 2:
                r = ds.ratios[i]  # 第一茶占比
                compositions[i, _TEA_INDEX[parts[0]]] = r
                compositions[i, _TEA_INDEX[parts[1]]] = 1.0 - r
    return compositions


# ═══════════════════════════════════════════════════════════════
# 训练
# ═══════════════════════════════════════════════════════════════

def train_carl(
    ds: PaperDataset,
    epochs: int = CARL_EPOCHS,
    lr: float = CARL_LR,
    batch_size: int = CARL_BATCH_SIZE,
    use_se: bool = True,
    use_augment: bool = True,
) -> tuple[CARLEncoder, dict]:
    """训练 CARL 编码器。

    Returns:
        encoder: 训练好的编码器
        history: 训练历史 {epoch, loss, ...}
        test_idx: 编码器训练中未见过的样本索引 (全局)
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"    设备: {device}")

    # 准备数据: 减法归一化 + 通道级标准化 (比除法归一化信噪比更高)
    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)  # (N, 1, 8)
    X_delta = (ds.X_value - baseline).astype(np.float32)          # ΔR
    # 通道级标准化
    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)  # (N, T*8)
    from sklearn.preprocessing import StandardScaler as _SS
    _scaler = _SS()
    X_flat = _scaler.fit_transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, 8)

    # 构建 5D 组成向量用于连续对比学习
    compositions = _build_compositions(ds)

    # 分层划分仍需离散标签
    strat_labels = []
    for i in range(N_total):
        if ds.pure_mask[i]:
            strat_labels.append(ds.tea_ids[i])
        else:
            strat_labels.append(ds.combo_ids[i])
    strat_labels = np.array(strat_labels)

    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_idx, test_idx = next(sss.split(X_norm, strat_labels))

    train_ds = SensorDataset(
        X_norm[train_idx], compositions[train_idx], augment=use_augment,
    )
    test_ds = SensorDataset(
        X_norm[test_idx], compositions[test_idx], augment=False,
    )

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False)

    # 模型
    encoder = CARLEncoder(in_channels=N_SENSORS, embed_dim=CARL_EMBED_DIM).to(device)
    if not use_se:
        # 消融: 去掉 SE, 换成 identity
        encoder.se = nn.Identity()

    criterion = SoftSupConLoss(temperature=0.5, sigma=0.5)
    optimizer = _make_contrastive_optimizer(encoder.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    history = {"epoch": [], "train_loss": [], "test_loss": []}

    for epoch in range(epochs):
        # Train
        encoder.train()
        train_losses = []
        for x_batch, comps, _ in train_loader:
            x_batch = x_batch.to(device)
            comps = comps.to(device)

            z = encoder(x_batch)
            loss = criterion(z, comps)

            if torch.isnan(loss) or torch.isinf(loss):
                continue  # 跳过无效 batch

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(encoder.parameters(), 1.0)
            optimizer.step()
            train_losses.append(loss.item())

        scheduler.step()

        # Eval
        if (epoch + 1) % 20 == 0 or epoch == 0:
            encoder.eval()
            test_losses = []
            with torch.no_grad():
                for x_batch, comps, _ in test_loader:
                    x_batch = x_batch.to(device)
                    comps = comps.to(device)
                    z = encoder(x_batch)
                    loss = criterion(z, comps)
                    test_losses.append(loss.item())

            train_loss = np.mean(train_losses)
            test_loss = np.mean(test_losses) if test_losses else 0
            history["epoch"].append(epoch + 1)
            history["train_loss"].append(round(train_loss, 4))
            history["test_loss"].append(round(test_loss, 4))

            if (epoch + 1) % 50 == 0:
                print(f"    Epoch {epoch+1}/{epochs}: train={train_loss:.4f}, test={test_loss:.4f}")

    return encoder, history, test_idx


# ═══════════════════════════════════════════════════════════════
# 嵌入提取
# ═══════════════════════════════════════════════════════════════

def extract_embeddings(
    encoder: CARLEncoder,
    ds: PaperDataset,
) -> np.ndarray:
    """用训练好的编码器提取所有样本的嵌入。"""
    device = next(encoder.parameters()).device
    encoder.eval()

    # 与训练时一致: 减法归一化 + StandardScaler
    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    X_delta = (ds.X_value - baseline).astype(np.float32)
    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)
    from sklearn.preprocessing import StandardScaler as _SS
    _scaler = _SS()
    X_flat = _scaler.fit_transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, 8)

    embeddings = []
    with torch.no_grad():
        for i in range(0, len(X_norm), 64):
            batch = torch.tensor(X_norm[i:i+64], dtype=torch.float32).to(device)
            batch = batch.permute(0, 2, 1)  # (B, 8, T)
            z = encoder(batch)
            embeddings.append(z.cpu().numpy())

    return np.concatenate(embeddings, axis=0)


# ═══════════════════════════════════════════════════════════════
# Nested-CV helpers (data-leakage-free)
# ═══════════════════════════════════════════════════════════════

def _augment_batch(x: torch.Tensor) -> torch.Tensor:
    """Batch-level augmentation on (B, C, T), 供 nested-CV 下的 train_carl_on_subset 使用.

    已对齐 E2E 全家桶 (共享 _strong_augment_batch 实现).
    """
    return _strong_augment_batch(x)


def train_carl_on_subset(
    ds: PaperDataset,
    train_mask: np.ndarray,
    epochs: int = CARL_EPOCHS,
    lr: float = CARL_LR,
    batch_size: int = CARL_BATCH_SIZE,
    use_se: bool = True,
    use_augment: bool = True,
    use_soap: bool = True,
    verbose: bool = False,
) -> tuple[CARLEncoder, object]:
    """Train CARL using only samples where *train_mask[i]=True*.

    Returns (encoder, scaler) — scaler is fit on training data only
    so that ``extract_embeddings_with_scaler`` avoids information leak.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    X_delta = (ds.X_value - baseline).astype(np.float32)

    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)
    _scaler = StandardScaler()
    _scaler.fit(X_flat[train_mask])                       # fit on train only
    X_flat = _scaler.transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, 8)

    compositions = _build_compositions(ds)
    train_idx = np.where(train_mask)[0]

    # Fold-specific seed: same train_mask → same seed (reproducible across main eval & ablation)
    fold_seed = SEED + int(hashlib.md5(train_mask.tobytes()).hexdigest()[:8], 16) % (2**31)
    np.random.seed(fold_seed)
    torch.manual_seed(fold_seed)
    torch.set_num_threads(1)

    train_ds = SensorDataset(
        X_norm[train_idx], compositions[train_idx], augment=use_augment,
    )
    g = torch.Generator()
    g.manual_seed(fold_seed)
    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True, drop_last=True,
        generator=g,
    )

    encoder = CARLEncoder(in_channels=N_SENSORS, embed_dim=CARL_EMBED_DIM).to(device)
    if not use_se:
        encoder.se = nn.Identity()

    criterion = SoftSupConLoss(temperature=0.5, sigma=0.5)
    optimizer = _make_contrastive_optimizer(encoder.parameters(), lr=lr, weight_decay=1e-4, use_soap=use_soap)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    for epoch in range(epochs):
        encoder.train()
        for x_batch, comps, _ in train_loader:
            x_batch, comps = x_batch.to(device), comps.to(device)
            z = encoder(x_batch)
            loss = criterion(z, comps)
            if torch.isnan(loss) or torch.isinf(loss):
                continue
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(encoder.parameters(), 1.0)
            optimizer.step()
        scheduler.step()

        if verbose and (epoch + 1) % 50 == 0:
            print(f"      fold CARL {epoch+1}/{epochs}: loss={loss.item():.4f}")

    return encoder, _scaler


def extract_embeddings_with_scaler(
    encoder: CARLEncoder,
    ds: PaperDataset,
    scaler,
) -> np.ndarray:
    """Extract backbone features using a **pre-fit** scaler (no data leakage).

    Uses get_features() (pre-projector, 128D GAP output) rather than forward()
    (post-projector + L2-norm). SimCLR literature shows backbone features
    outperform projected features for downstream tasks.
    """
    device = next(encoder.parameters()).device
    encoder.eval()

    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    X_delta = (ds.X_value - baseline).astype(np.float32)
    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)
    X_flat = scaler.transform(X_flat).astype(np.float32)  # transform only
    X_norm = X_flat.reshape(N_total, T, 8)

    embeddings = []
    with torch.no_grad():
        for i in range(0, len(X_norm), 64):
            batch = torch.tensor(X_norm[i:i+64], dtype=torch.float32).to(device)
            batch = batch.permute(0, 2, 1)
            z = encoder(batch)
            embeddings.append(z.cpu().numpy())

    return np.concatenate(embeddings, axis=0)


def extract_gap_features_with_scaler(
    encoder: CARLEncoder,
    ds: PaperDataset,
    scaler,
) -> np.ndarray:
    """Extract pre-projector GAP features (128D) using a **pre-fit** scaler.

    Unlike extract_embeddings_with_scaler (which uses encoder.forward → projector),
    this uses encoder.get_features() → GAP output before projection head.
    """
    device = next(encoder.parameters()).device
    encoder.eval()

    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    X_delta = (ds.X_value - baseline).astype(np.float32)
    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)
    X_flat = scaler.transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, 8)

    features = []
    with torch.no_grad():
        for i in range(0, len(X_norm), 64):
            batch = torch.tensor(X_norm[i:i+64], dtype=torch.float32).to(device)
            batch = batch.permute(0, 2, 1)
            h = encoder.get_features(batch)
            features.append(h.cpu().numpy())

    return np.concatenate(features, axis=0)


# ═══════════════════════════════════════════════════════════════
# 下游任务评估
# ═══════════════════════════════════════════════════════════════

def evaluate_downstream(
    embeddings: np.ndarray,
    ds: PaperDataset,
    encoder_test_idx: np.ndarray | None = None,
) -> dict:
    """下游任务评估: k-NN 分类 + 线性探针回归。

    encoder_test_idx: 若提供, 仅在编码器未见过的样本上评估 (防止数据泄露).
    """
    results = {}

    # 确定可用于评估的样本范围
    # 若提供 encoder_test_idx, 只在编码器未见过的样本上评估
    def _split_train_test(global_idx: np.ndarray, labels: np.ndarray):
        """从 global_idx 中取训练/测试子集。"""
        if encoder_test_idx is not None:
            test_mask = np.isin(global_idx, encoder_test_idx)
            train_mask = ~test_mask
            tr = np.where(train_mask)[0]
            te = np.where(test_mask)[0]
            if len(te) < 5 or len(tr) < 5:
                # 回退: 在 test 子集内部做随机划分
                te_global = global_idx[test_mask]
                sss = StratifiedShuffleSplit(n_splits=1, test_size=0.5, random_state=SEED)
                sub_tr, sub_te = next(sss.split(np.zeros(len(te_global)), labels[test_mask]))
                return np.where(test_mask)[0][sub_tr], np.where(test_mask)[0][sub_te]
            return tr, te
        else:
            sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
            return next(sss.split(np.zeros(len(global_idx)), labels))

    # k-NN 茶对分类 (混合样)
    mix_idx = ds.mix_indices
    if len(mix_idx) > 10:
        X_mix_emb = embeddings[mix_idx]
        y_combo = np.array([ds.combo_ids[i] for i in mix_idx])
        le = LabelEncoder()
        y_combo_enc = le.fit_transform(y_combo)

        tr, te = _split_train_test(mix_idx, y_combo_enc)

        knn = KNeighborsClassifier(n_neighbors=5)
        knn.fit(X_mix_emb[tr], y_combo_enc[tr])
        y_pred = knn.predict(X_mix_emb[te])
        knn_acc = accuracy_score(y_combo_enc[te], y_pred)
        results["knn_combo_accuracy"] = round(knn_acc * 100, 1)
        print(f"    k-NN combo 分类: {knn_acc:.1%}")

    # 线性探针回归 (比例预测, 混合样)
    if len(mix_idx) > 10:
        y_ratio = np.array([ds.ratios[i] for i in mix_idx])
        X_mix_emb = embeddings[mix_idx]

        tr, te = _split_train_test(mix_idx, y_combo_enc)

        ridge = Ridge(alpha=1.0)
        ridge.fit(X_mix_emb[tr], y_ratio[tr])
        y_pred = ridge.predict(X_mix_emb[te])
        r2 = r2_score(y_ratio[te], y_pred)
        mae = mean_absolute_error(y_ratio[te], y_pred)
        results["linear_probe_r2"] = round(r2, 3)
        results["linear_probe_mae"] = round(mae, 4)
        print(f"    线性探针回归: R²={r2:.3f}, MAE={mae:.4f}")

    # 纯茶 k-NN 分类
    pure_idx = ds.pure_indices
    if len(pure_idx) > 10:
        X_pure_emb = embeddings[pure_idx]
        y_tea = np.array([ds.tea_ids[i] for i in pure_idx])
        le = LabelEncoder()
        y_tea_enc = le.fit_transform(y_tea)

        tr, te = _split_train_test(pure_idx, y_tea_enc)

        knn = KNeighborsClassifier(n_neighbors=5)
        knn.fit(X_pure_emb[tr], y_tea_enc[tr])
        y_pred = knn.predict(X_pure_emb[te])
        tea_acc = accuracy_score(y_tea_enc[te], y_pred)
        results["knn_tea_accuracy"] = round(tea_acc * 100, 1)
        print(f"    k-NN 纯茶分类: {tea_acc:.1%}")

    return results


# ═══════════════════════════════════════════════════════════════
# 主运行
# ═══════════════════════════════════════════════════════════════

def run(ds: PaperDataset, nldi_results: dict | None = None) -> dict:
    """运行实验3: CARL 对比表征学习。

    Args:
        ds: PaperDataset
        nldi_results: 实验2 的 NLDI 结果 (用于相关性分析)
    """
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  实验3: CARL 对比表征学习")
    print("=" * 70)

    results = {}

    # ── 1. 训练完整模型 ──
    print(f"  训练 CARL 编码器 (full)...")
    encoder, history, test_idx = train_carl(ds)
    results["training_history"] = history

    # 保存权重
    weight_path = CACHE_DIR / "carl_encoder.pt"
    torch.save(encoder.state_dict(), weight_path)
    print(f"    权重 → {weight_path.name}")

    # ── 2. 提取嵌入 ──
    print(f"  提取嵌入...")
    embeddings = extract_embeddings(encoder, ds)
    results["embedding_shape"] = list(embeddings.shape)
    print(f"    嵌入 shape: {embeddings.shape}")

    # 缓存嵌入
    emb_path = CACHE_DIR / "carl_embeddings.npy"
    np.save(emb_path, embeddings)

    # ── 3. Training loss 曲线图 ──
    print(f"  训练曲线图...")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    init_style()

    fig, ax = plt.subplots(figsize=(6, 4.5))
    epochs = history["epoch"]
    ax.plot(epochs, history["train_loss"], "o-", markersize=5, label="Train", color="#0072B2")
    ax.plot(epochs, history["test_loss"], "s--", markersize=5, label="Test", color="#D55E00")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Soft SupCon Loss")
    ax.set_title("CARL Training Convergence")
    ax.legend()
    fig.tight_layout()
    save_fig(fig, "fig4_carl_training_curve", subdir="exp3")

    # ── 4. 下游任务评估 ──
    print(f"  下游任务评估...")
    downstream = evaluate_downstream(embeddings, ds, encoder_test_idx=test_idx)
    results["downstream"] = downstream

    # ── 5. 消融实验 ──
    print(f"  消融实验...")
    ablation_results = []

    # Full model
    ablation_results.append({
        "variant": "CARL (full)",
        **downstream,
    })

    # No SE
    print(f"    消融: No SE...")
    encoder_no_se, _, test_idx_no_se = train_carl(ds, epochs=CARL_EPOCHS, use_se=False)
    emb_no_se = extract_embeddings(encoder_no_se, ds)
    down_no_se = evaluate_downstream(emb_no_se, ds, encoder_test_idx=test_idx_no_se)
    ablation_results.append({"variant": "CARL (no SE)", **down_no_se})

    # No augmentation
    print(f"    消融: No augment...")
    encoder_no_aug, _, test_idx_no_aug = train_carl(ds, epochs=CARL_EPOCHS, use_augment=False)
    emb_no_aug = extract_embeddings(encoder_no_aug, ds)
    down_no_aug = evaluate_downstream(emb_no_aug, ds, encoder_test_idx=test_idx_no_aug)
    ablation_results.append({"variant": "CARL (no augment)", **down_no_aug})

    results["ablation"] = ablation_results

    # 保存消融结果表
    import pandas as pd
    df_abl = pd.DataFrame(ablation_results)
    csv_path = TABLES_DIR / "table4_carl_ablation.csv"
    df_abl.to_csv(csv_path, index=False)
    print(f"  消融结果 → {csv_path.name}")

    # ── 6. NLDI vs 嵌入偏差相关性 ──
    if nldi_results:
        print(f"  NLDI vs 嵌入偏差相关性...")
        _compute_nldi_correlation(ds, embeddings, nldi_results, results)

    # ── 保存完整结果 ──
    json_path = TABLES_DIR / "exp3_carl_results.json"
    def _convert(obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.float64, np.float32)):
            return float(obj)
        if isinstance(obj, (np.int64, np.int32)):
            return int(obj)
        return obj

    with open(json_path, "w") as f:
        json.dump(json.loads(json.dumps(results, default=_convert)), f, indent=2, ensure_ascii=False)
    print(f"  JSON → {json_path.name}")

    # ── 摘要 ──
    print(f"\n  === 实验3 结果摘要 ===")
    print(f"  嵌入维度: {embeddings.shape[1]}")
    for k, v in downstream.items():
        print(f"    {k}: {v}")
    print(f"  消融变体: {len(ablation_results)}")
    print(f"  输出: fig4_carl_umap, table4_carl_ablation")

    return results


def _compute_nldi_correlation(
    ds: PaperDataset,
    embeddings: np.ndarray,
    nldi_results: dict,
    results: dict,
):
    """计算 NLDI 与嵌入偏差的相关性。"""
    from scipy import stats as sp_stats

    # 对每个组合, 计算嵌入空间中实测 vs 线性预测的偏差
    combo_nldi = []
    combo_emb_dev = []

    for combo_id, nldi_res in nldi_results.get("nldi", {}).items():
        if not isinstance(nldi_res, dict) or "nldi_mean" not in nldi_res:
            continue
        nldi_val = nldi_res["nldi_mean"]
        if np.isnan(nldi_val):
            continue

        # 获取该组合的混合样嵌入
        mix_mask = ds.mix_mask & np.array([c == combo_id for c in ds.combo_ids])
        if mix_mask.sum() < 3:
            continue

        # 获取对应纯茶嵌入均值
        parts = combo_id.split("-")
        if len(parts) != 2:
            continue

        pure_a_mask = ds.pure_mask & np.array([t == parts[0] for t in ds.tea_ids])
        pure_b_mask = ds.pure_mask & np.array([t == parts[1] for t in ds.tea_ids])

        if pure_a_mask.sum() == 0 or pure_b_mask.sum() == 0:
            continue

        emb_a = embeddings[pure_a_mask].mean(axis=0)
        emb_b = embeddings[pure_b_mask].mean(axis=0)
        emb_mix = embeddings[mix_mask]
        mix_r = np.array(ds.ratios)[mix_mask]

        # 线性预测嵌入 vs 实际嵌入的偏差
        deviations = []
        for emb, r in zip(emb_mix, mix_r):
            pred = r * emb_a + (1 - r) * emb_b
            dev = np.linalg.norm(emb - pred)
            deviations.append(dev)

        combo_nldi.append(nldi_val)
        combo_emb_dev.append(np.mean(deviations))

    if len(combo_nldi) >= 3:
        r_pearson, p_pearson = sp_stats.pearsonr(combo_nldi, combo_emb_dev)
        r_spearman, p_spearman = sp_stats.spearmanr(combo_nldi, combo_emb_dev)

        results["nldi_emb_correlation"] = {
            "pearson_r": round(r_pearson, 3),
            "pearson_p": round(p_pearson, 4),
            "spearman_r": round(r_spearman, 3),
            "spearman_p": round(p_spearman, 4),
            "n_combos": len(combo_nldi),
        }
        print(f"    NLDI vs 嵌入偏差: Pearson r={r_pearson:.3f} (p={p_pearson:.4f})")
        print(f"                     Spearman ρ={r_spearman:.3f} (p={p_spearman:.4f})")

        # 散点图
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        init_style()
        fig, ax = plt.subplots(figsize=(5, 4.5))
        ax.scatter(combo_nldi, combo_emb_dev, s=70, c="#0072B2", edgecolors="white", linewidth=0.8)
        ax.set_xlabel("NLDI")
        ax.set_ylabel("Embedding deviation")
        ax.set_title(f"Pearson r={r_pearson:.3f}")
        fig.tight_layout()
        save_fig(fig, "fig5_nldi_vs_embedding", subdir="exp3")
