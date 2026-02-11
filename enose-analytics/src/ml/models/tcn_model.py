"""TCN (Temporal Convolutional Network) 模型 - 支持分类和回归任务

输入数据形状: (N, T, n_sensors, n_phys) = (N, 50, 8, 4)
内部转换为:    (N, C, T) = (N, 32, 50) 用于因果卷积

数据处理流程:
  1. reshape (N, T, 8, 4) → (N, 32, T)
  2. 逐通道 z-score 标准化 (fit on train, transform on val/test/predict)
  3. Kaiming 权重初始化
  4. 梯度裁剪 + ReduceLROnPlateau 学习率调度
"""

import io
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

import logging

from ..base_model import BaseModel, ProgressCallback, TrainProgress, register_model

logger = logging.getLogger(__name__)


# ─── 通道归一化器 ───────────────────────────────────────────────

class ChannelNormalizer:
    """逐通道 z-score 标准化，适用于 (N, C, T) 格式的时序数据

    对每个通道 C 独立计算 mean/std（跨所有样本和时间步）。
    """

    def __init__(self):
        self.mean_: np.ndarray | None = None  # (C,)
        self.std_: np.ndarray | None = None   # (C,)
        self._fitted = False

    def fit(self, X: np.ndarray) -> "ChannelNormalizer":
        """X: (N, C, T)"""
        # (N, C, T) → 对 N 和 T 维度取统计量
        self.mean_ = X.mean(axis=(0, 2))  # (C,)
        self.std_ = X.std(axis=(0, 2))    # (C,)
        # 防止除零
        self.std_ = np.where(self.std_ < 1e-8, 1.0, self.std_)
        self._fitted = True
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        """X: (N, C, T) → 归一化后的 (N, C, T)"""
        if not self._fitted:
            raise RuntimeError("ChannelNormalizer not fitted")
        # broadcast: mean_ (C,) → (1, C, 1)
        return (X - self.mean_[None, :, None]) / self.std_[None, :, None]

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        return self.fit(X).transform(X)

    def to_dict(self) -> dict:
        return {"mean": self.mean_.tolist(), "std": self.std_.tolist()}

    @classmethod
    def from_dict(cls, d: dict) -> "ChannelNormalizer":
        obj = cls()
        obj.mean_ = np.array(d["mean"], dtype=np.float32)
        obj.std_ = np.array(d["std"], dtype=np.float32)
        obj._fitted = True
        return obj


# ─── TCN 网络组件 ────────────────────────────────────────────────

class _CausalConv1d(nn.Module):
    """因果卷积：只看过去，不看未来"""

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int = 1):
        super().__init__()
        self.padding = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(
            in_channels, out_channels, kernel_size,
            padding=self.padding, dilation=dilation,
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.conv(x)
        if self.padding > 0:
            out = out[:, :, :-self.padding]
        return out


class _TemporalBlock(nn.Module):
    """TCN 残差块：两层因果卷积 + 残差连接"""

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int, dropout: float):
        super().__init__()
        self.conv1 = _CausalConv1d(in_channels, out_channels, kernel_size, dilation)
        self.bn1 = nn.BatchNorm1d(out_channels)
        self.conv2 = _CausalConv1d(out_channels, out_channels, kernel_size, dilation)
        self.bn2 = nn.BatchNorm1d(out_channels)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)

        # 残差连接：通道数不同时用 1x1 卷积
        self.downsample = nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = self.downsample(x)
        out = self.dropout(self.relu(self.bn1(self.conv1(x))))
        out = self.dropout(self.relu(self.bn2(self.conv2(out))))
        return self.relu(out + residual)


class _TCNNetwork(nn.Module):
    """完整 TCN 网络"""

    def __init__(
        self,
        input_channels: int,
        output_dim: int,
        n_channels: list[int],
        kernel_size: int = 3,
        dropout: float = 0.2,
    ):
        super().__init__()
        layers: list[nn.Module] = []
        n_levels = len(n_channels)
        for i in range(n_levels):
            in_ch = input_channels if i == 0 else n_channels[i - 1]
            out_ch = n_channels[i]
            dilation = 2 ** i
            layers.append(_TemporalBlock(in_ch, out_ch, kernel_size, dilation, dropout))

        self.tcn = nn.Sequential(*layers)
        self.fc = nn.Linear(n_channels[-1], output_dim)

        # Kaiming 初始化
        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.BatchNorm1d):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Linear):
                nn.init.xavier_normal_(m.weight)
                nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, channels, seq_len)
        out = self.tcn(x)            # (batch, n_channels[-1], seq_len)
        out = out[:, :, -1]          # 取最后时间步 (batch, n_channels[-1])
        return self.fc(out)          # (batch, output_dim)


# ─── 训练超参数默认值 ──────────────────────────────────────────
_GRAD_CLIP_NORM = 1.0          # 梯度裁剪阈值
_LR_SCHEDULER_PATIENCE = 5     # ReduceLROnPlateau patience
_LR_SCHEDULER_FACTOR = 0.5     # 学习率衰减因子
_LABEL_SMOOTHING = 0.1         # 分类标签平滑


@register_model("tcn")
class TCNModel(BaseModel):
    """时序卷积网络 - 支持分类和回归

    输入: (N, T, 8, 4) 归一化帧
    数据处理: reshape → 逐通道 z-score → Conv1d
    训练优化: Kaiming 初始化 + 梯度裁剪 + LR 调度 + 标签平滑
    """

    framework = "pytorch"

    def __init__(
        self,
        task_type: str = "classification",
        n_channels: list[int] | None = None,
        kernel_size: int = 3,
        dropout: float = 0.2,
        epochs: int = 100,
        learning_rate: float = 0.001,
        batch_size: int = 32,
        early_stopping_patience: int = 10,
        device: str = "cpu",
        **kwargs: Any,
    ):
        self.task_type = task_type
        self.n_channels = n_channels or [32, 64, 64]
        self.kernel_size = kernel_size
        self.dropout = dropout
        self.epochs = epochs
        self.learning_rate = learning_rate
        self.batch_size = batch_size
        self.early_stopping_patience = early_stopping_patience
        self.device = device

        self._network: _TCNNetwork | None = None
        self._normalizer: ChannelNormalizer = ChannelNormalizer()
        self._input_channels: int = 0   # 32 = 8 sensors × 4 phys
        self._seq_len: int = 0          # T = 50
        self._output_dim: int = 0
        self._class_names: list[str] = []

    def get_total_epochs(self) -> int:
        return self.epochs

    @staticmethod
    def _reshape_input(X: np.ndarray) -> np.ndarray:
        """(N, T, 8, 4) → (N, 32, T) for Conv1d"""
        if X.ndim == 4:
            N, T, S, D = X.shape
            return X.reshape(N, T, S * D).transpose(0, 2, 1).astype(np.float32)
        elif X.ndim == 3:
            return X.transpose(0, 2, 1).astype(np.float32)
        else:
            raise ValueError(f"TCN expects 3D or 4D input, got shape {X.shape}")

    def fit(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray | None = None,
        y_val: np.ndarray | None = None,
        progress_callback: ProgressCallback | None = None,
        n_classes: int | None = None,
    ) -> dict[str, Any]:
        # 1. reshape (N, T, 8, 4) → (N, 32, T)
        X_train_3d = self._reshape_input(X_train)
        X_val_3d = self._reshape_input(X_val) if X_val is not None and len(X_val) > 0 else None

        self._input_channels = X_train_3d.shape[1]  # 32
        self._seq_len = X_train_3d.shape[2]          # T

        # 2. 逐通道标准化 (fit on train, transform both)
        X_train_3d = self._normalizer.fit_transform(X_train_3d)
        if X_val_3d is not None:
            X_val_3d = self._normalizer.transform(X_val_3d)

        logger.info(
            f"TCN input: ({self._input_channels} channels, {self._seq_len} steps), "
            f"normalizer mean range=[{self._normalizer.mean_.min():.1f}, {self._normalizer.mean_.max():.1f}], "
            f"std range=[{self._normalizer.std_.min():.4f}, {self._normalizer.std_.max():.1f}]"
        )

        # 3. 准备标签和损失函数
        if self.task_type == "classification":
            self._output_dim = n_classes if n_classes is not None else int(y_train.max()) + 1
            criterion = nn.CrossEntropyLoss(label_smoothing=_LABEL_SMOOTHING)
            y_train_t = torch.tensor(y_train, dtype=torch.long)
            y_val_t = torch.tensor(y_val, dtype=torch.long) if y_val is not None else None
        else:
            self._output_dim = 1
            criterion = nn.MSELoss()
            y_train_t = torch.tensor(y_train, dtype=torch.float32).unsqueeze(1)
            y_val_t = torch.tensor(y_val, dtype=torch.float32).unsqueeze(1) if y_val is not None else None

        # 4. 构建网络 (Kaiming 初始化在 _TCNNetwork.__init__ 中)
        self._network = _TCNNetwork(
            input_channels=self._input_channels,
            output_dim=self._output_dim,
            n_channels=self.n_channels,
            kernel_size=self.kernel_size,
            dropout=self.dropout,
        ).to(self.device)

        # 5. 优化器 + 学习率调度器
        optimizer = torch.optim.AdamW(
            self._network.parameters(),
            lr=self.learning_rate,
            weight_decay=1e-4,
        )
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode="min", factor=_LR_SCHEDULER_FACTOR,
            patience=_LR_SCHEDULER_PATIENCE, min_lr=1e-6,
        )

        # 6. DataLoader
        X_train_t = torch.tensor(X_train_3d, dtype=torch.float32)
        train_ds = TensorDataset(X_train_t, y_train_t)
        train_loader = DataLoader(train_ds, batch_size=self.batch_size, shuffle=True)

        best_val_loss = float("inf")
        patience_counter = 0
        best_state = None
        train_loss = 0.0
        train_acc = 0.0
        val_loss = 0.0
        val_acc = 0.0

        for epoch in range(self.epochs):
            # ── Train ──
            self._network.train()
            train_loss_sum = 0.0
            train_correct = 0
            train_total = 0

            for X_batch, y_batch in train_loader:
                X_batch = X_batch.to(self.device)
                y_batch = y_batch.to(self.device)

                optimizer.zero_grad()
                output = self._network(X_batch)
                loss = criterion(output, y_batch)
                loss.backward()

                # 梯度裁剪
                torch.nn.utils.clip_grad_norm_(self._network.parameters(), _GRAD_CLIP_NORM)

                optimizer.step()

                train_loss_sum += loss.item() * X_batch.size(0)
                train_total += X_batch.size(0)

                if self.task_type == "classification":
                    pred = output.argmax(dim=1)
                    train_correct += (pred == y_batch).sum().item()

            train_loss = train_loss_sum / max(train_total, 1)
            train_acc = train_correct / max(train_total, 1) if self.task_type == "classification" else 0.0

            # ── Validate ──
            val_loss = 0.0
            val_acc = 0.0
            if X_val_3d is not None and y_val_t is not None:
                self._network.eval()
                with torch.no_grad():
                    X_val_t = torch.tensor(X_val_3d, dtype=torch.float32).to(self.device)
                    y_val_dev = y_val_t.to(self.device)
                    val_output = self._network(X_val_t)
                    val_loss = criterion(val_output, y_val_dev).item()

                    if self.task_type == "classification":
                        val_pred = val_output.argmax(dim=1)
                        val_acc = (val_pred == y_val_dev).float().mean().item()

            # 学习率调度
            scheduler.step(val_loss if X_val_3d is not None else train_loss)

            # Early stopping
            if X_val_3d is not None:
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    patience_counter = 0
                    best_state = {k: v.cpu().clone() for k, v in self._network.state_dict().items()}
                else:
                    patience_counter += 1
                    if patience_counter >= self.early_stopping_patience:
                        if best_state:
                            self._network.load_state_dict(best_state)
                        logger.info(f"Early stopping at epoch {epoch+1}")
                        break

            # Progress callback
            if progress_callback:
                current_lr = optimizer.param_groups[0]["lr"]
                progress_callback(TrainProgress(
                    epoch=epoch + 1,
                    total_epochs=self.epochs,
                    train_loss=train_loss,
                    val_loss=val_loss,
                    train_accuracy=train_acc,
                    val_accuracy=val_acc,
                    extra_metrics={"lr": current_lr},
                ))

        if best_state and X_val_3d is not None:
            self._network.load_state_dict(best_state)

        return {
            "train_loss": train_loss,
            "val_loss": val_loss,
            "train_accuracy": train_acc,
            "val_accuracy": val_acc,
            "epochs_trained": epoch + 1,
        }

    def _prepare_for_inference(self, X: np.ndarray) -> torch.Tensor:
        """推理前的数据准备: reshape → normalize → tensor"""
        if self._network is None:
            raise RuntimeError("Model not trained")
        X_3d = self._reshape_input(X)
        X_3d = self._normalizer.transform(X_3d)
        return torch.tensor(X_3d, dtype=torch.float32).to(self.device)

    def predict(self, X: np.ndarray) -> np.ndarray:
        X_t = self._prepare_for_inference(X)
        self._network.eval()
        with torch.no_grad():
            output = self._network(X_t)
            if self.task_type == "classification":
                return output.argmax(dim=1).cpu().numpy()
            else:
                return output.squeeze(1).cpu().numpy()

    def predict_proba(self, X: np.ndarray) -> np.ndarray | None:
        if self._network is None or self.task_type != "classification":
            return None
        X_t = self._prepare_for_inference(X)
        self._network.eval()
        with torch.no_grad():
            output = self._network(X_t)
            proba = torch.softmax(output, dim=1)
            return proba.cpu().numpy()

    def save_bytes(self) -> bytes:
        if self._network is None:
            raise RuntimeError("Model not trained")
        buf = io.BytesIO()
        torch.save({
            "state_dict": self._network.state_dict(),
            "normalizer": self._normalizer.to_dict(),
            "config": self.get_config(),
        }, buf)
        return buf.getvalue()

    @classmethod
    def load_bytes(cls, data: bytes, **kwargs: Any) -> "TCNModel":
        buf = io.BytesIO(data)
        checkpoint = torch.load(buf, map_location="cpu", weights_only=False)
        config = checkpoint["config"]

        model = cls(
            task_type=config.get("task_type", "classification"),
            n_channels=config.get("n_channels", [32, 64, 64]),
            kernel_size=config.get("kernel_size", 3),
            dropout=config.get("dropout", 0.2),
        )
        model._input_channels = config.get("input_channels", 32)
        model._seq_len = config.get("seq_len", 50)
        model._output_dim = config.get("output_dim", 0)
        model._class_names = config.get("class_names", [])

        # 恢复通道归一化器
        if "normalizer" in checkpoint:
            model._normalizer = ChannelNormalizer.from_dict(checkpoint["normalizer"])

        if model._input_channels > 0 and model._output_dim > 0:
            model._network = _TCNNetwork(
                input_channels=model._input_channels,
                output_dim=model._output_dim,
                n_channels=model.n_channels,
                kernel_size=model.kernel_size,
                dropout=model.dropout,
            )
            model._network.load_state_dict(checkpoint["state_dict"])
            model._network.eval()

        return model

    def get_config(self) -> dict[str, Any]:
        return {
            "model_type": "tcn",
            "task_type": self.task_type,
            "framework": "pytorch",
            "input_channels": self._input_channels,
            "seq_len": self._seq_len,
            "output_dim": self._output_dim,
            "n_channels": self.n_channels,
            "kernel_size": self.kernel_size,
            "dropout": self.dropout,
            "epochs": self.epochs,
            "learning_rate": self.learning_rate,
            "batch_size": self.batch_size,
            "early_stopping_patience": self.early_stopping_patience,
            "class_names": self._class_names,
        }
