"""MLP 模型 - 支持分类和回归任务

基于 BaseDeepModel 通用框架，使用 SOAP 优化器 + CosineAnnealingLR。
"""

from typing import Any

import numpy as np
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler

from ..base_model import register_model
from .base_deep_model import BaseDeepModel


class _MLPNetwork(nn.Module):
    """MLP 网络结构"""

    def __init__(
        self,
        input_dim: int,
        output_dim: int,
        hidden_layers: list[int],
        activation: str = "relu",
        dropout: float = 0.1,
    ):
        super().__init__()

        act_map = {
            "relu": nn.ReLU,
            "gelu": nn.GELU,
            "silu": nn.SiLU,
            "tanh": nn.Tanh,
            "leaky_relu": nn.LeakyReLU,
        }
        act_cls = act_map.get(activation, nn.ReLU)

        layers: list[nn.Module] = []
        prev_dim = input_dim
        for h_dim in hidden_layers:
            layers.append(nn.Linear(prev_dim, h_dim))
            layers.append(act_cls())
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev_dim = h_dim
        layers.append(nn.Linear(prev_dim, output_dim))

        self.network = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.network(x)


@register_model("mlp")
class MLPModel(BaseDeepModel):
    """多层感知机 - 支持分类和回归

    输入: (N, D) 扁平特征向量
    数据处理: StandardScaler 标准化
    """

    def __init__(
        self,
        hidden_layers: list[int] | None = None,
        activation: str = "relu",
        **kwargs: Any,
    ):
        super().__init__(**kwargs)
        self.hidden_layers = hidden_layers or [128, 64]
        self.activation = activation
        self._scaler = StandardScaler()

    def _build_network(self, input_shape: tuple[int, ...], output_dim: int) -> nn.Module:
        return _MLPNetwork(
            input_shape[0], output_dim,
            self.hidden_layers, self.activation, self.dropout,
        )

    def _prepare_input(self, X: np.ndarray, fit: bool = False) -> np.ndarray:
        if fit:
            return self._scaler.fit_transform(X).astype(np.float32)
        return self._scaler.transform(X).astype(np.float32)

    def _extra_save_state(self) -> dict[str, Any]:
        return {"scaler": self._scaler}

    def _load_extra_state(self, checkpoint: dict[str, Any]) -> None:
        if "scaler" in checkpoint:
            self._scaler = checkpoint["scaler"]

    @classmethod
    def _from_config(cls, config: dict[str, Any]) -> "MLPModel":
        return cls(
            task_type=config.get("task_type", "classification"),
            hidden_layers=config.get("hidden_layers", [128, 64]),
            activation=config.get("activation", "relu"),
            dropout=config.get("dropout", 0.1),
            epochs=config.get("epochs", 100),
            learning_rate=config.get("learning_rate", 3e-3),
            batch_size=config.get("batch_size", 32),
            early_stopping_patience=config.get("early_stopping_patience", 10),
        )

    def get_config(self) -> dict[str, Any]:
        return {
            "model_type": "mlp",
            "task_type": self.task_type,
            "framework": "pytorch",
            "input_shape": list(self._input_shape),
            "output_dim": self._output_dim,
            "hidden_layers": self.hidden_layers,
            "activation": self.activation,
            "dropout": self.dropout,
            "epochs": self.epochs,
            "learning_rate": self.learning_rate,
            "batch_size": self.batch_size,
            "early_stopping_patience": self.early_stopping_patience,
            "label_smoothing": self.label_smoothing,
            "weight_decay": self.weight_decay,
            "class_names": self._class_names,
        }
