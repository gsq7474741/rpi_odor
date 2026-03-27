"""受控基线实验 — 审稿意见第5点。

审稿人要求: 提供 composition-aware 但使用简单损失 (MSE) 的基线,
以证明 CARL 的对比损失设计的优势。

实验设计:
  1. Composition-MSE: 同一 CARLEncoder backbone, MSE 回归组成向量
  2. Composition-CE: 同一 backbone, 交叉熵分类 (离散标签)
  3. CARL (对照): Soft SupCon Loss

三者共享相同 backbone、数据增强、训练 epoch, 仅损失函数不同。
通过 k-NN 分类和线性探针回归评估嵌入质量。
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import Ridge
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error
from sklearn.model_selection import StratifiedShuffleSplit

from .config import (
    SEED, N_SENSORS, CARL_EMBED_DIM, CARL_EPOCHS, CARL_LR, CARL_BATCH_SIZE,
    FONT_SIZE, TABLES_DIR, FIGURES_DIR, CACHE_DIR, ensure_dirs,
)
from .data import PaperDataset
from .exp3_carl import (
    CARLEncoder, SensorDataset, _build_compositions,
    extract_embeddings, evaluate_downstream,
)
from .viz import init_style, save_fig

torch.manual_seed(SEED)
np.random.seed(SEED)


# ═══════════════════════════════════════════════════════════════
# 基线 1: Composition-MSE (回归组成向量)
# ═══════════════════════════════════════════════════════════════

class CompositionMSEModel(nn.Module):
    """CARLEncoder backbone + 线性回归头 → 预测 5D 组成向量。"""

    def __init__(self, in_channels: int = 8, embed_dim: int = CARL_EMBED_DIM, n_teas: int = 5):
        super().__init__()
        self.encoder = CARLEncoder(in_channels, embed_dim)
        self.regressor = nn.Linear(embed_dim, n_teas)

    def forward(self, x):
        z = self.encoder(x)  # (B, embed_dim), L2-normalized
        comp_pred = self.regressor(z)  # (B, 5)
        return z, comp_pred


def train_composition_mse(
    ds: PaperDataset,
    epochs: int = CARL_EPOCHS,
    lr: float = CARL_LR,
    batch_size: int = CARL_BATCH_SIZE,
    use_se: bool = True,
    use_augment: bool = True,
) -> CARLEncoder:
    """训练 Composition-MSE 基线, 返回 encoder 部分。"""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # 数据准备 (与 CARL 完全一致)
    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    X_delta = (ds.X_value - baseline).astype(np.float32)
    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)
    _scaler = StandardScaler()
    X_flat = _scaler.fit_transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, 8)

    compositions = _build_compositions(ds)

    # 分层划分
    strat_labels = []
    for i in range(N_total):
        if ds.pure_mask[i]:
            strat_labels.append(ds.tea_ids[i])
        else:
            strat_labels.append(ds.combo_ids[i])
    strat_labels = np.array(strat_labels)

    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_idx, _ = next(sss.split(X_norm, strat_labels))

    train_ds = SensorDataset(X_norm[train_idx], compositions[train_idx], augment=use_augment)
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)

    model = CompositionMSEModel(in_channels=N_SENSORS, embed_dim=CARL_EMBED_DIM).to(device)
    if not use_se:
        model.encoder.se = nn.Identity()

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        for x_batch, comps, _ in train_loader:
            x_batch = x_batch.to(device)
            comps = comps.to(device)

            _, comp_pred = model(x_batch)
            loss = F.mse_loss(comp_pred, comps)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

        scheduler.step()
        if (epoch + 1) % 50 == 0:
            print(f"      Epoch {epoch+1}/{epochs}: MSE loss={loss.item():.4f}")

    return model.encoder


# ═══════════════════════════════════════════════════════════════
# 基线 2: Composition-CE (交叉熵分类)
# ═══════════════════════════════════════════════════════════════

class CompositionCEModel(nn.Module):
    """CARLEncoder backbone + 分类头 → 预测离散样本类别。

    标签: 纯茶用 tea_id, 混合样用 combo_id, 共 15 类。
    """

    def __init__(self, in_channels: int = 8, embed_dim: int = CARL_EMBED_DIM, n_classes: int = 15):
        super().__init__()
        self.encoder = CARLEncoder(in_channels, embed_dim)
        self.classifier = nn.Linear(embed_dim, n_classes)

    def forward(self, x):
        z = self.encoder(x)
        logits = self.classifier(z)
        return z, logits


def train_composition_ce(
    ds: PaperDataset,
    epochs: int = CARL_EPOCHS,
    lr: float = CARL_LR,
    batch_size: int = CARL_BATCH_SIZE,
    use_se: bool = True,
    use_augment: bool = True,
) -> CARLEncoder:
    """训练 Composition-CE 基线, 返回 encoder 部分。"""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    T = ds.X_value.shape[1]
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    X_delta = (ds.X_value - baseline).astype(np.float32)
    N_total = X_delta.shape[0]
    X_flat = X_delta.reshape(N_total, -1)
    _scaler = StandardScaler()
    X_flat = _scaler.fit_transform(X_flat).astype(np.float32)
    X_norm = X_flat.reshape(N_total, T, 8)

    compositions = _build_compositions(ds)

    # 构建离散标签
    labels_str = []
    for i in range(N_total):
        if ds.pure_mask[i]:
            labels_str.append(ds.tea_ids[i])
        else:
            labels_str.append(ds.combo_ids[i])
    le = LabelEncoder()
    labels_enc = le.fit_transform(labels_str)
    n_classes = len(le.classes_)

    strat_labels = np.array(labels_str)
    sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_idx, _ = next(sss.split(X_norm, strat_labels))

    train_ds = SensorDataset(X_norm[train_idx], compositions[train_idx], augment=use_augment)
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)

    # 需要额外携带 labels
    train_labels = torch.tensor(labels_enc[train_idx], dtype=torch.long)

    model = CompositionCEModel(
        in_channels=N_SENSORS, embed_dim=CARL_EMBED_DIM, n_classes=n_classes,
    ).to(device)
    if not use_se:
        model.encoder.se = nn.Identity()

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    model.train()
    for epoch in range(epochs):
        for x_batch, _, batch_idx in train_loader:
            x_batch = x_batch.to(device)
            # 获取对应标签
            y_batch = train_labels[batch_idx].to(device)

            _, logits = model(x_batch)
            loss = F.cross_entropy(logits, y_batch)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

        scheduler.step()
        if (epoch + 1) % 50 == 0:
            print(f"      Epoch {epoch+1}/{epochs}: CE loss={loss.item():.4f}")

    return model.encoder


# ═══════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════

def run(ds: PaperDataset, carl_embeddings: np.ndarray | None = None) -> dict:
    """运行受控基线实验。"""
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  受控基线实验 (损失函数对比)")
    print("=" * 70)

    results = {}
    comparison = []

    # ── CARL (对照, 从缓存加载) ──
    if carl_embeddings is not None:
        print(f"  CARL (Soft SupCon): 从缓存加载嵌入...")
        carl_down = evaluate_downstream(carl_embeddings, ds)
        comparison.append({"method": "CARL (Soft SupCon)", **carl_down})
    else:
        print(f"  CARL 嵌入不可用, 跳过对照")

    # ── Composition-MSE ──
    print(f"  训练 Composition-MSE 基线...")
    enc_mse = train_composition_mse(ds)
    emb_mse = extract_embeddings(enc_mse, ds)
    down_mse = evaluate_downstream(emb_mse, ds)
    comparison.append({"method": "Composition-MSE", **down_mse})

    # ── Composition-CE ──
    print(f"  训练 Composition-CE 基线...")
    enc_ce = train_composition_ce(ds)
    emb_ce = extract_embeddings(enc_ce, ds)
    down_ce = evaluate_downstream(emb_ce, ds)
    comparison.append({"method": "Composition-CE", **down_ce})

    results["comparison"] = comparison

    # 保存表格
    df = pd.DataFrame(comparison)
    csv_path = TABLES_DIR / "table_controlled_baseline.csv"
    df.to_csv(csv_path, index=False)
    print(f"\n  CSV → {csv_path.name}")

    # 保存 JSON
    json_path = TABLES_DIR / "exp_controlled_baseline.json"
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"  JSON → {json_path.name}")

    # 生成对比条形图
    _plot_comparison(comparison)

    # 摘要
    print(f"\n  === 受控基线实验结果 ===")
    for r in comparison:
        tea_acc = r.get("knn_tea_accuracy", "N/A")
        combo_acc = r.get("knn_combo_accuracy", "N/A")
        r2 = r.get("linear_probe_r2", "N/A")
        print(f"    {r['method']}: tea_kNN={tea_acc}%, combo_kNN={combo_acc}%, R²={r2}")

    return results


def _plot_comparison(comparison: list[dict]):
    """受控基线对比条形图。"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    init_style()

    metrics = ["knn_tea_accuracy", "knn_combo_accuracy", "linear_probe_r2"]
    metric_labels = ["Pure Tea k-NN (%)", "Combo k-NN (%)", "Linear Probe R²"]
    methods = [r["method"] for r in comparison]

    fig, axes = plt.subplots(1, 3, figsize=(12, 4.5))

    colors = ["#0072B2", "#D55E00", "#009E73", "#CC79A7"]

    for ax, metric, label in zip(axes, metrics, metric_labels):
        vals = [r.get(metric, 0) for r in comparison]
        bars = ax.bar(range(len(methods)), vals, color=colors[:len(methods)], alpha=0.85)
        ax.set_xticks(range(len(methods)))
        ax.set_xticklabels(methods, rotation=25, ha="right", fontsize=FONT_SIZE - 4)
        ax.set_ylabel(label)
        ax.set_title(label)

        # 标注数值
        for bar, val in zip(bars, vals):
            if val != 0:
                fmt = f"{val:.1f}" if "R²" not in label else f"{val:.3f}"
                ax.text(
                    bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                    fmt, ha="center", va="bottom", fontsize=FONT_SIZE - 4,
                )

    fig.tight_layout()
    save_fig(fig, "fig_controlled_baseline", subdir="exp_baseline")
