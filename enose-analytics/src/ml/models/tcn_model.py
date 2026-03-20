"""TCN (Temporal Convolutional Network) 模型 - 支持分类和回归任务

基于 BaseDeepModel 通用框架，使用 SOAP 优化器 + CosineAnnealingLR。

输入数据形状: (N, T, n_sensors, n_phys) = (N, 50, 8, 4)
内部转换为:    (N, C, T) = (N, 32, 50) 用于因果卷积

数据处理流程:
  1. reshape (N, T, 8, 4) → (N, 32, T)
  2. 逐通道 z-score 标准化 (fit on train, transform on val/test/predict)
  3. Kaiming 权重初始化
"""

import logging
from typing import Any

import numpy as np
import torch
import torch.nn as nn

from ..base_model import register_model
from .base_deep_model import BaseDeepModel

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
        self.mean_ = X.mean(axis=(0, 2))  # (C,)
        self.std_ = X.std(axis=(0, 2))    # (C,)
        self.std_ = np.where(self.std_ < 1e-8, 1.0, self.std_)
        self._fitted = True
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        """X: (N, C, T) → 归一化后的 (N, C, T)"""
        if not self._fitted:
            raise RuntimeError("ChannelNormalizer not fitted")
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


# ─── TCN 模型 ──────────────────────────────────────────────────

@register_model("tcn")
class TCNModel(BaseDeepModel):
    """时序卷积网络 - 支持分类和回归

    输入: (N, T, 8, 4) 对齐序列
    数据处理: reshape → 逐通道 z-score → Conv1d
    训练优化: SOAP + CosineAnnealingLR + Kaiming 初始化 + 梯度裁剪 + 标签平滑
    """

    def __init__(
        self,
        n_channels: list[int] | None = None,
        kernel_size: int = 3,
        **kwargs: Any,
    ):
        super().__init__(**kwargs)
        self.n_channels = n_channels or [32, 64, 64]
        self.kernel_size = kernel_size
        self._normalizer: ChannelNormalizer = ChannelNormalizer()

    @staticmethod
    def _reshape_to_nct(X: np.ndarray) -> np.ndarray:
        """(N, T, 8, 4) → (N, 32, T) for Conv1d"""
        if X.ndim == 4:
            N, T, S, D = X.shape
            return X.reshape(N, T, S * D).transpose(0, 2, 1).astype(np.float32)
        elif X.ndim == 3:
            return X.transpose(0, 2, 1).astype(np.float32)
        else:
            raise ValueError(f"TCN expects 3D or 4D input, got shape {X.shape}")

    def _build_network(self, input_shape: tuple[int, ...], output_dim: int) -> nn.Module:
        return _TCNNetwork(
            input_channels=input_shape[0],
            output_dim=output_dim,
            n_channels=self.n_channels,
            kernel_size=self.kernel_size,
            dropout=self.dropout,
        )

    def _prepare_input(self, X: np.ndarray, fit: bool = False) -> np.ndarray:
        X_3d = self._reshape_to_nct(X)
        if fit:
            X_3d = self._normalizer.fit_transform(X_3d)
            logger.info(
                f"TCN input: ({X_3d.shape[1]} channels, {X_3d.shape[2]} steps), "
                f"normalizer mean range=[{self._normalizer.mean_.min():.1f}, {self._normalizer.mean_.max():.1f}], "
                f"std range=[{self._normalizer.std_.min():.4f}, {self._normalizer.std_.max():.1f}]"
            )
            return X_3d
        return self._normalizer.transform(X_3d)

    def _extra_save_state(self) -> dict[str, Any]:
        return {"normalizer": self._normalizer.to_dict()}

    def _load_extra_state(self, checkpoint: dict[str, Any]) -> None:
        if "normalizer" in checkpoint:
            self._normalizer = ChannelNormalizer.from_dict(checkpoint["normalizer"])

    @classmethod
    def _from_config(cls, config: dict[str, Any]) -> "TCNModel":
        return cls(
            task_type=config.get("task_type", "classification"),
            n_channels=config.get("n_channels", [32, 64, 64]),
            kernel_size=config.get("kernel_size", 3),
            dropout=config.get("dropout", 0.1),
            epochs=config.get("epochs", 100),
            learning_rate=config.get("learning_rate", 3e-3),
            batch_size=config.get("batch_size", 32),
            early_stopping_patience=config.get("early_stopping_patience", 10),
        )

    def get_config(self) -> dict[str, Any]:
        return {
            "model_type": "tcn",
            "task_type": self.task_type,
            "framework": "pytorch",
            "input_shape": list(self._input_shape),
            "output_dim": self._output_dim,
            "n_channels": self.n_channels,
            "kernel_size": self.kernel_size,
            "dropout": self.dropout,
            "epochs": self.epochs,
            "learning_rate": self.learning_rate,
            "batch_size": self.batch_size,
            "early_stopping_patience": self.early_stopping_patience,
            "label_smoothing": self.label_smoothing,
            "weight_decay": self.weight_decay,
            "class_names": self._class_names,
        }
