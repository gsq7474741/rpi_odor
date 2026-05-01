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
from sklearn.svm import SVC
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from sklearn.pipeline import Pipeline

from .config import SEED, N_CV_FOLDS, CARL_EMBED_DIM

torch.manual_seed(SEED)
np.random.seed(SEED)

EMBED_DIM = CARL_EMBED_DIM  # 128


def _cls_metrics(y_true, y_pred) -> dict[str, float]:
    """Compute 4 classification metrics (all macro-averaged, %)."""
    return {
        "acc": round(accuracy_score(y_true, y_pred) * 100, 1),
        "prec": round(precision_score(y_true, y_pred, average="macro", zero_division=0) * 100, 1),
        "rec": round(recall_score(y_true, y_pred, average="macro", zero_division=0) * 100, 1),
        "f1": round(f1_score(y_true, y_pred, average="macro", zero_division=0) * 100, 1),
    }


_METRIC_KEYS = ("acc", "prec", "rec", "f1")


def _summarize_cv_metrics(
    fold_metrics: list[dict[str, float]],
) -> dict[str, str | float]:
    """Summarize per-fold metric dicts into 'mean±std' strings.

    Returns dict with:
      - 'acc', 'prec', 'rec', 'f1': formatted "mean±std" strings (e.g. "94.1±2.3")
      - 'acc_mean': numeric mean accuracy for comparison / sorting
    """
    result: dict[str, str | float] = {}
    for k in _METRIC_KEYS:
        vals = [m[k] for m in fold_metrics]
        mean = float(np.mean(vals))
        std = float(np.std(vals))
        result[k] = f"{mean:.1f}±{std:.1f}"
    result["acc_mean"] = float(np.mean([m["acc"] for m in fold_metrics]))
    return result


# ═══════════════════════════════════════════════════════════════
# E2E 强增强迁移 (对齐 exp_e2e_cls_tuned.AugmentedClassificationDataset._augment)
# 用于对比学习两视图生成, 不含 mixup / oversample / label_smoothing (对对比损失无意义)
# 也不含 TTA (TTA 是推理时增强, 这里是训练时)
# ═══════════════════════════════════════════════════════════════

def _strong_augment_batch(
    x: torch.Tensor,
    shift_ratio: float = 0.15,
    warp_prob: float = 0.3,
    warp_range: tuple[float, float] = (0.8, 1.2),
    noise_std_max: float = 0.05,
    amp_scale_range: tuple[float, float] = (0.75, 1.25),
    ch_dropout_prob: float = 0.2,
    cutout_prob: float = 0.3,
    cutout_frac_range: tuple[float, float] = (0.1, 0.2),
) -> torch.Tensor:
    """E2E-aligned strong augmentation. 接收 (B, C, T), 返回 (B, C, T).

    组合: 时间平移 + 时间 warp + 高斯噪声 + 逐通道幅度缩放 + 通道 dropout + temporal cutout.
    每次调用的随机量独立采样, 可直接用于对比学习的两视图生成.
    """
    B, C, T = x.shape
    device = x.device
    x = x.clone()

    # 1. 时间平移 (±shift_ratio)
    shift = int(np.random.uniform(-shift_ratio, shift_ratio) * T)
    if shift > 0:
        x = torch.cat([x[:, :, shift:], x[:, :, -1:].expand(B, C, shift)], dim=2)
    elif shift < 0:
        x = torch.cat([x[:, :, :1].expand(B, C, -shift), x[:, :, :shift]], dim=2)

    # 2. 时间局部拉伸 (batch 内共享, 各视图 warp 参数独立)
    if np.random.random() < warp_prob:
        anchor = np.random.randint(T // 4, 3 * T // 4)
        warp = np.random.uniform(*warp_range)
        t_src = np.arange(T, dtype=np.float32)
        t_dst = np.copy(t_src)
        t_dst[:anchor] = t_src[:anchor] * warp
        t_dst[anchor:] = t_dst[anchor - 1] + (t_src[anchor:] - t_src[anchor - 1])
        t_dst = t_dst / max(t_dst[-1], 1e-8) * (T - 1)
        t_dst = np.clip(t_dst, 0, T - 1).astype(np.float32)
        idx_arange = np.arange(T, dtype=np.float32)
        x_np = x.detach().cpu().numpy()
        x_warped = np.empty_like(x_np)
        for b in range(B):
            for c in range(C):
                x_warped[b, c] = np.interp(idx_arange, t_dst, x_np[b, c])
        x = torch.from_numpy(x_warped).to(device)

    # 3. 高斯噪声 (std ~ U[0, noise_std_max])
    noise_std = float(np.random.uniform(0.0, noise_std_max))
    if noise_std > 0:
        x = x + torch.randn_like(x) * noise_std

    # 4. 幅度缩放 (每个 (sample, channel) 独立)
    scales = torch.empty(B, C, 1, device=device).uniform_(*amp_scale_range)
    x = x * scales

    # 5. 通道 dropout
    if np.random.random() < ch_dropout_prob:
        ch = np.random.randint(0, C)
        x[:, ch, :] = 0.0

    # 6. Temporal cutout
    if np.random.random() < cutout_prob:
        lo = max(1, int(cutout_frac_range[0] * T))
        hi = max(lo + 1, int(cutout_frac_range[1] * T) + 1)
        cut_len = np.random.randint(lo, hi)
        start = np.random.randint(0, max(1, T - cut_len))
        x[:, :, start:start + cut_len] = 0.0

    return x


def _weak_augment_batch(x: torch.Tensor) -> torch.Tensor:
    """§13 基线 CL 增强 (shift ±5% + Gaussian noise σ≤0.02 + 10% ch dropout).

    保留此弱版本以让 CL baseline (SimCLR/TS2Vec/AE) 保持"as originally proposed"
    的标准 time-series 对比学习增强配置, 与 CArl 的 "Aroma-Aware Augmentation"
    (强增强) 形成明确的模块归属区分.
    """
    B, C, T = x.shape
    # shift ±5%
    shift = np.random.randint(-max(1, T // 20), max(1, T // 20) + 1)
    if shift > 0:
        x = torch.cat([x[:, :, shift:], x[:, :, -1:].expand(B, C, shift)], dim=2)
    elif shift < 0:
        x = torch.cat([x[:, :, :1].expand(B, C, -shift), x[:, :, :shift]], dim=2)
    # Gaussian noise σ ∈ [0, 0.02]
    sigma = float(np.random.uniform(0.0, 0.02))
    if sigma > 0:
        x = x + torch.randn_like(x) * sigma
    # 通道 dropout (10% 概率)
    if np.random.random() < 0.1:
        ch = np.random.randint(0, C)
        x = x.clone()
        x[:, ch, :] = 0.0
    return x


def _make_contrastive_optimizer(
    params,
    lr: float,
    weight_decay: float = 1e-4,
    use_soap: bool = True,
) -> torch.optim.Optimizer:
    """对比/预训练阶段统一优化器工厂: 优先 SOAP (二阶预条件), 回退 AdamW.

    SOAP 与 E2E (exp_e2e_cls_tuned) 保持一致 (precondition_frequency=2).
    若 pytorch_optimizer 未安装或初始化失败, 回退 AdamW.
    """
    if use_soap:
        try:
            from pytorch_optimizer import SOAP
            return SOAP(
                params, lr=lr, weight_decay=weight_decay,
                precondition_frequency=2,
            )
        except Exception:
            pass
    return torch.optim.AdamW(params, lr=lr, weight_decay=weight_decay)


# ═══════════════════════════════════════════════════════════════
# 共享工具
# ═══════════════════════════════════════════════════════════════

def _prepare_timeseries(X_value: np.ndarray) -> np.ndarray:
    """Z-score normalise sensor data → (N, T, 8) float32.

    注: data.py 管线已做 bl_sub + run_zscore + sample_max_norm, 这里不再重复
    基线减法 (原先会削弱前 0-20% 时段的 class boost signature, 如 T1 S0).
    仅保留全局 StandardScaler 以稳定训练.
    """
    X_delta = X_value.astype(np.float32)
    N = X_delta.shape[0]
    X_flat = X_delta.reshape(N, -1)
    scaler = StandardScaler()
    X_flat_scaled = scaler.fit_transform(X_flat)
    return X_flat_scaled.reshape(X_delta.shape)


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


def _eval_embedding_multi_clf(
    embeddings: np.ndarray, y: np.ndarray, n_folds: int = N_CV_FOLDS,
) -> dict[str, dict[str, str | float]]:
    """Evaluate embeddings with both k-NN and SVM-RBF (5-fold CV).

    Returns {"k-NN": {"acc": "mean±std", ..., "acc_mean": float}, "SVM-RBF": {...}}.
    """
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=SEED)
    results = {}
    for name, clf_factory in [
        ("k-NN", lambda: KNeighborsClassifier(n_neighbors=5)),
        ("SVM-RBF", lambda: SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED)),
    ]:
        fold_metrics = []
        for tr_idx, te_idx in skf.split(embeddings, y):
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf_factory())])
            pipe.fit(embeddings[tr_idx], y[tr_idx])
            yp = pipe.predict(embeddings[te_idx])
            fold_metrics.append(_cls_metrics(y[te_idx], yp))
        results[name] = _summarize_cv_metrics(fold_metrics)
    return results


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
    # CL baseline: 保持 "as originally proposed" 优化器 (Adam)
    # SOAP / Aroma-Aware Augmentation 作为 CArl 的组件, 不共享给 CL baseline
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
    # CL baseline: 保持 "as originally proposed" 优化器 (Adam)
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
    """CL baseline (SimCLR) 的标准弱增强, 对齐 §13 "as originally proposed".

    刻意不使用 _strong_augment_batch (Aroma-Aware Augmentation),
    后者作为 CArl 的模块保留.
    """
    return _weak_augment_batch(x)


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
    # CL baseline (SimCLR): 保持 "as originally proposed" 优化器 (Adam) + 弱增强
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        for (xb,) in loader:
            xb = xb.to(device)
            v1 = _random_augment(xb)  # 弱增强 (_weak_augment_batch)
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
# Soft SupCon Loss + CARL-style augmentation (shared)
# ═══════════════════════════════════════════════════════════════

class _SoftSupConLoss(nn.Module):
    """Composition-vector-weighted supervised contrastive loss (mirrors CARL)."""

    def __init__(self, temperature: float = 0.5, sigma: float = 0.5):
        super().__init__()
        self.tau = temperature
        self.sigma = sigma

    def forward(self, features: torch.Tensor, compositions: torch.Tensor) -> torch.Tensor:
        B = features.shape[0]
        device = features.device
        mask = ~torch.eye(B, device=device).bool()
        comp_diff = compositions.unsqueeze(0) - compositions.unsqueeze(1)  # (B, B, K)
        dist_sq = (comp_diff ** 2).sum(dim=2)
        w = torch.exp(-dist_sq / (2 * self.sigma ** 2)) * mask.float()
        w_norm = w / w.sum(dim=1, keepdim=True).clamp(min=1e-10)
        sim = torch.mm(features, features.T) / self.tau
        sim = sim.masked_fill(~mask, float("-inf"))
        log_prob = sim - torch.logsumexp(sim, dim=1, keepdim=True)
        return -(w_norm * log_prob).sum(dim=1).mean()


def _carl_augment(x: torch.Tensor) -> torch.Tensor:
    """CARL-style augmentation (Soft-SupCon view generator).

    已对齐 E2E 增强全家桶 (与 _random_augment 共享同一实现).
    """
    return _strong_augment_batch(x)


# ═══════════════════════════════════════════════════════════════
# Supervised variants (same backbone, Soft SupCon loss)
# ═══════════════════════════════════════════════════════════════

def train_ts2vec_supervised(
    X_value: np.ndarray,
    compositions: np.ndarray,
    epochs: int = 200,
    lr: float = 1e-3,
    batch_size: int = 64,
) -> np.ndarray:
    """TS2Vec backbone + Soft SupCon loss using composition vectors."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X_norm = _prepare_timeseries(X_value)
    N, T, C = X_norm.shape
    X_t = torch.tensor(X_norm, dtype=torch.float32).permute(0, 2, 1)
    comp_t = torch.tensor(compositions, dtype=torch.float32)
    dataset = TensorDataset(X_t, comp_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)

    model = TS2VecEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
    criterion = _SoftSupConLoss()
    optimizer = _make_contrastive_optimizer(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for _ in range(epochs):
        for xb, cb in loader:
            xb, cb = xb.to(device), cb.to(device)
            v1, v2 = _carl_augment(xb), _carl_augment(xb)
            z1 = F.normalize(model.encode(v1), dim=1)
            z2 = F.normalize(model.encode(v2), dim=1)
            loss = criterion(torch.cat([z1, z2], 0), torch.cat([cb, cb], 0))
            optimizer.zero_grad(); loss.backward(); optimizer.step()
        scheduler.step()

    model.eval()
    all_emb = []
    with torch.no_grad():
        for i in range(0, N, batch_size):
            emb = F.normalize(model.encode(X_t[i:i + batch_size].to(device)), dim=1)
            all_emb.append(emb.cpu().numpy())
    return np.concatenate(all_emb, axis=0)


def train_autoencoder_supervised(
    X_value: np.ndarray,
    compositions: np.ndarray,
    epochs: int = 200,
    lr: float = 1e-3,
    batch_size: int = 64,
) -> np.ndarray:
    """AE encoder backbone + Soft SupCon loss (no reconstruction)."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X_norm = _prepare_timeseries(X_value)
    N, T, C = X_norm.shape
    X_t = torch.tensor(X_norm, dtype=torch.float32).permute(0, 2, 1)
    comp_t = torch.tensor(compositions, dtype=torch.float32)
    dataset = TensorDataset(X_t, comp_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)

    model = _AEEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
    criterion = _SoftSupConLoss()
    optimizer = _make_contrastive_optimizer(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for _ in range(epochs):
        for xb, cb in loader:
            xb, cb = xb.to(device), cb.to(device)
            v1, v2 = _carl_augment(xb), _carl_augment(xb)
            z1 = F.normalize(model(v1), dim=1)
            z2 = F.normalize(model(v2), dim=1)
            loss = criterion(torch.cat([z1, z2], 0), torch.cat([cb, cb], 0))
            optimizer.zero_grad(); loss.backward(); optimizer.step()
        scheduler.step()

    model.eval()
    all_emb = []
    with torch.no_grad():
        for i in range(0, N, batch_size):
            emb = F.normalize(model(X_t[i:i + batch_size].to(device)), dim=1)
            all_emb.append(emb.cpu().numpy())
    return np.concatenate(all_emb, axis=0)


def train_vanilla_contrastive_supervised(
    X_value: np.ndarray,
    compositions: np.ndarray,
    epochs: int = 200,
    lr: float = 1e-3,
    batch_size: int = 64,
) -> np.ndarray:
    """VanillaEncoder backbone (no SE) + Soft SupCon loss."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    X_norm = _prepare_timeseries(X_value)
    N, T, C = X_norm.shape
    X_t = torch.tensor(X_norm, dtype=torch.float32).permute(0, 2, 1)
    comp_t = torch.tensor(compositions, dtype=torch.float32)
    dataset = TensorDataset(X_t, comp_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)

    model = _VanillaEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
    criterion = _SoftSupConLoss()
    optimizer = _make_contrastive_optimizer(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for _ in range(epochs):
        for xb, cb in loader:
            xb, cb = xb.to(device), cb.to(device)
            v1, v2 = _carl_augment(xb), _carl_augment(xb)
            z1, z2 = model(v1), model(v2)  # _VanillaEncoder already L2-normalises
            loss = criterion(torch.cat([z1, z2], 0), torch.cat([cb, cb], 0))
            optimizer.zero_grad(); loss.backward(); optimizer.step()
        scheduler.step()

    model.eval()
    all_emb = []
    with torch.no_grad():
        for i in range(0, N, batch_size):
            emb = model(X_t[i:i + batch_size].to(device))
            all_emb.append(emb.cpu().numpy())
    return np.concatenate(all_emb, axis=0)


def _supervised_cv_accuracy(
    arch: str,
    X_value_all: np.ndarray,
    compositions: np.ndarray,
    pure_idx: np.ndarray,
    y: np.ndarray,
    epochs: int = 200,
    batch_size: int = 64,
    lr: float = 1e-3,
) -> float:
    """Proper k-fold CV for composition-supervised baselines.

    Each fold trains WITHOUT the held-out pure-tea test samples, then evaluates
    k-NN accuracy on those held-out samples only — no leakage from label supervision.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Blend sample indices (always used for training)
    pure_set = set(pure_idx.tolist())
    mix_idx = np.array([i for i in range(len(X_value_all)) if i not in pure_set])

    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
    y_pred_all = np.empty(len(pure_idx), dtype=y.dtype)

    for tr_local, te_local in skf.split(pure_idx, y):
        # Global training indices: all blends + pure train split
        tr_global = np.concatenate([mix_idx, pure_idx[tr_local]])

        # ── Preprocessing: fit on train, transform test ────────────────
        X_tr_raw = X_value_all[tr_global]
        X_te_raw = X_value_all[pure_idx[te_local]]
        T = X_tr_raw.shape[1]
        bl = max(1, T // 10)

        base_tr = X_tr_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_tr_d = (X_tr_raw - base_tr).astype(np.float32)
        scaler = StandardScaler()
        X_tr_n = scaler.fit_transform(X_tr_d.reshape(len(X_tr_d), -1)).reshape(X_tr_d.shape)

        base_te = X_te_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_te_d = (X_te_raw - base_te).astype(np.float32)
        X_te_n = scaler.transform(X_te_d.reshape(len(X_te_d), -1)).reshape(X_te_d.shape)

        comp_tr = compositions[tr_global]
        C = X_tr_n.shape[2]

        X_tr_t = torch.tensor(X_tr_n).permute(0, 2, 1)
        X_te_t = torch.tensor(X_te_n).permute(0, 2, 1)
        comp_tr_t = torch.tensor(comp_tr)

        # ── Build model ─────────────────────────────────────────────────
        if arch == "ts2vec":
            model = TS2VecEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return F.normalize(model.encode(x), dim=1)
        elif arch == "ae":
            model = _AEEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return F.normalize(model(x), dim=1)
        else:  # vanilla
            model = _VanillaEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return model(x)  # _VanillaEncoder already L2-normalises

        criterion = _SoftSupConLoss()
        optimizer = _make_contrastive_optimizer(model.parameters(), lr=lr, weight_decay=1e-4)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
        loader = DataLoader(TensorDataset(X_tr_t, comp_tr_t),
                            batch_size=batch_size, shuffle=True, drop_last=True)

        # ── Train ───────────────────────────────────────────────────────
        model.train()
        for _ in range(epochs):
            for xb, cb in loader:
                xb, cb = xb.to(device), cb.to(device)
                v1, v2 = _carl_augment(xb), _carl_augment(xb)
                z1, z2 = get_emb(v1), get_emb(v2)
                loss = criterion(torch.cat([z1, z2]), torch.cat([cb, cb]))
                optimizer.zero_grad(); loss.backward(); optimizer.step()
            scheduler.step()

        # ── Extract embeddings: pure_train + pure_test ──────────────────
        model.eval()
        # pure-train reference embeddings (for k-NN fit)
        pure_tr_t = X_tr_t[len(mix_idx):].to(device)   # last len(tr_local) rows are pure train
        with torch.no_grad():
            emb_tr = get_emb(pure_tr_t).cpu().numpy()
            emb_te = get_emb(X_te_t.to(device)).cpu().numpy()

        # ── k-NN predict on this fold ────────────────────────────────────
        pipe = Pipeline([("sc", StandardScaler()), ("knn", KNeighborsClassifier(n_neighbors=5))])
        pipe.fit(emb_tr, y[tr_local])
        y_pred_all[te_local] = pipe.predict(emb_te)

    return accuracy_score(y, y_pred_all)


def run_supervised_baselines(
    X_value_all: np.ndarray,
    compositions: np.ndarray,
    pure_idx: np.ndarray,
    y: np.ndarray,
    epochs: int = 200,
) -> list[dict]:
    """Train composition-supervised variants with proper k-fold CV.

    Pure test samples are excluded from each fold's training set to prevent
    label-supervision leakage.
    """
    results = []
    for name, arch in [
        ("TS2Vec+SoftSupCon",             "ts2vec"),
        ("AE+SoftSupCon",                 "ae"),
        ("VanillaContrastive+SoftSupCon", "vanilla"),
    ]:
        print(f"    训练 {name} ({N_CV_FOLDS}-fold CV, {epochs} epochs/fold)...")
        acc = _supervised_cv_accuracy(arch, X_value_all, compositions, pure_idx, y, epochs=epochs)
        results.append({"feature": name, "classifier": "k-NN", "accuracy": round(acc * 100, 1)})
        print(f"      {name} + k-NN: {acc:.1%}")
    return results


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


# ═══════════════════════════════════════════════════════════════
# v2 多分类器评估 (叉乘: 表征 × {k-NN, SVM-RBF})
# ═══════════════════════════════════════════════════════════════

def run_all_baselines_v2(
    X_value_all: np.ndarray,
    pure_idx: np.ndarray,
    y: np.ndarray,
    epochs: int = 200,
) -> list[dict]:
    """训练所有自监督基线, 同时用 k-NN 和 SVM-RBF 评估。

    Returns:
        [{"feature": str, "k-NN": float, "SVM-RBF": float}, ...]
    """
    results = []
    for name, train_fn in [
        ("TS2Vec", train_ts2vec),
        ("Autoencoder", train_autoencoder),
        ("SimCLR", train_vanilla_contrastive),
    ]:
        print(f"    训练 {name} ({epochs} epochs)...")
        emb = train_fn(X_value_all, epochs=epochs)
        accs = _eval_embedding_multi_clf(emb[pure_idx], y)
        results.append({"feature": f"{name}_embedding", **accs})
        print(f"      {name}: k-NN={accs['k-NN']['acc']}, SVM-RBF={accs['SVM-RBF']['acc']}")
    return results


def _supervised_cv_eval(
    arch: str,
    X_value_all: np.ndarray,
    compositions: np.ndarray,
    pure_idx: np.ndarray,
    y: np.ndarray,
    epochs: int = 200,
    batch_size: int = 64,
    lr: float = 1e-3,
) -> dict[str, dict[str, str | float]]:
    """Per-fold composition-supervised training, eval with k-NN AND SVM-RBF.

    Returns {"k-NN": {"acc": "mean±std", ..., "acc_mean": float}, "SVM-RBF": {...}}.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    pure_set = set(pure_idx.tolist())
    mix_idx = np.array([i for i in range(len(X_value_all)) if i not in pure_set])

    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
    fold_metrics_knn: list[dict[str, float]] = []
    fold_metrics_svm: list[dict[str, float]] = []

    for tr_local, te_local in skf.split(pure_idx, y):
        tr_global = np.concatenate([mix_idx, pure_idx[tr_local]])

        # Preprocessing
        X_tr_raw = X_value_all[tr_global]
        X_te_raw = X_value_all[pure_idx[te_local]]
        T = X_tr_raw.shape[1]
        bl = max(1, T // 10)

        base_tr = X_tr_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_tr_d = (X_tr_raw - base_tr).astype(np.float32)
        scaler = StandardScaler()
        X_tr_n = scaler.fit_transform(X_tr_d.reshape(len(X_tr_d), -1)).reshape(X_tr_d.shape)

        base_te = X_te_raw[:, :bl, :].mean(axis=1, keepdims=True)
        X_te_d = (X_te_raw - base_te).astype(np.float32)
        X_te_n = scaler.transform(X_te_d.reshape(len(X_te_d), -1)).reshape(X_te_d.shape)

        comp_tr = compositions[tr_global]
        C = X_tr_n.shape[2]

        X_tr_t = torch.tensor(X_tr_n).permute(0, 2, 1)
        X_te_t = torch.tensor(X_te_n).permute(0, 2, 1)
        comp_tr_t = torch.tensor(comp_tr)

        # Build model
        if arch == "ts2vec":
            model = TS2VecEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return F.normalize(model.encode(x), dim=1)
        elif arch == "ae":
            model = _AEEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return F.normalize(model(x), dim=1)
        else:  # vanilla
            model = _VanillaEncoder(in_channels=C, embed_dim=EMBED_DIM).to(device)
            def get_emb(x): return model(x)

        criterion = _SoftSupConLoss()
        optimizer = _make_contrastive_optimizer(model.parameters(), lr=lr, weight_decay=1e-4)
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

        # Extract embeddings
        model.eval()
        pure_tr_t = X_tr_t[len(mix_idx):].to(device)
        with torch.no_grad():
            emb_tr = get_emb(pure_tr_t).cpu().numpy()
            emb_te = get_emb(X_te_t.to(device)).cpu().numpy()

        # k-NN
        pipe_knn = Pipeline([
            ("sc", StandardScaler()),
            ("knn", KNeighborsClassifier(n_neighbors=5)),
        ])
        pipe_knn.fit(emb_tr, y[tr_local])
        yp_knn = pipe_knn.predict(emb_te)
        fold_metrics_knn.append(_cls_metrics(y[te_local], yp_knn))

        # SVM-RBF
        pipe_svm = Pipeline([
            ("sc", StandardScaler()),
            ("svm", SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED)),
        ])
        pipe_svm.fit(emb_tr, y[tr_local])
        yp_svm = pipe_svm.predict(emb_te)
        fold_metrics_svm.append(_cls_metrics(y[te_local], yp_svm))

    return {
        "k-NN": _summarize_cv_metrics(fold_metrics_knn),
        "SVM-RBF": _summarize_cv_metrics(fold_metrics_svm),
    }


def run_supervised_baselines_v2(
    X_value_all: np.ndarray,
    compositions: np.ndarray,
    pure_idx: np.ndarray,
    y: np.ndarray,
    epochs: int = 200,
) -> list[dict]:
    """Composition-supervised baselines with k-NN AND SVM-RBF evaluation.

    Returns [{"feature": str, "k-NN": float, "SVM-RBF": float}, ...]
    """
    results = []
    for name, arch in [
        ("TS2Vec+SoftSupCon",             "ts2vec"),
        ("AE+SoftSupCon",                 "ae"),
        ("SimCLR+SoftSupCon",             "vanilla"),
    ]:
        print(f"    训练 {name} ({N_CV_FOLDS}-fold CV, {epochs} epochs/fold)...")
        accs = _supervised_cv_eval(arch, X_value_all, compositions, pure_idx, y, epochs=epochs)
        results.append({"feature": name, **accs})
        print(f"      {name}: k-NN={accs['k-NN']['acc']}, SVM-RBF={accs['SVM-RBF']['acc']}")
    return results
