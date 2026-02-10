"""模型抽象基类与注册表"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np


@dataclass
class TrainProgress:
    """训练进度回调数据"""
    epoch: int
    total_epochs: int
    train_loss: float = 0.0
    val_loss: float = 0.0
    train_accuracy: float = 0.0
    val_accuracy: float = 0.0
    extra_metrics: dict[str, float] = field(default_factory=dict)


ProgressCallback = Callable[[TrainProgress], None]


class BaseModel(ABC):
    """所有 ML 模型的统一接口"""

    model_type: str = "base"
    framework: str = "unknown"

    @abstractmethod
    def fit(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray | None = None,
        y_val: np.ndarray | None = None,
        progress_callback: ProgressCallback | None = None,
        n_classes: int | None = None,
    ) -> dict[str, Any]:
        """训练模型

        Args:
            n_classes: 分类任务的真实类别总数（来自完整数据集，避免训练集缺失类别）

        Returns:
            训练结果字典，包含 train_loss, val_loss, train_accuracy, val_accuracy 等
        """

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """预测"""

    def predict_proba(self, X: np.ndarray) -> np.ndarray | None:
        """预测概率 (分类模型)，不支持则返回 None"""
        return None

    @abstractmethod
    def save_bytes(self) -> bytes:
        """序列化模型为 bytes"""

    @classmethod
    @abstractmethod
    def load_bytes(cls, data: bytes, **kwargs: Any) -> "BaseModel":
        """从 bytes 反序列化模型"""

    @abstractmethod
    def get_config(self) -> dict[str, Any]:
        """获取模型配置（用于持久化和展示）"""

    def get_total_epochs(self) -> int:
        """获取总训练轮数（非迭代模型返回 1）"""
        return 1


# ── 模型注册表 ──

MODEL_REGISTRY: dict[str, type[BaseModel]] = {}


def register_model(name: str):
    """装饰器：注册模型到全局注册表"""
    def decorator(cls: type[BaseModel]):
        MODEL_REGISTRY[name] = cls
        cls.model_type = name
        return cls
    return decorator


def get_model_class(model_type: str) -> type[BaseModel]:
    """根据类型名获取模型类"""
    if model_type not in MODEL_REGISTRY:
        available = ", ".join(sorted(MODEL_REGISTRY.keys()))
        raise ValueError(f"Unknown model type: {model_type}. Available: {available}")
    return MODEL_REGISTRY[model_type]


def list_model_types() -> list[str]:
    """列出所有已注册的模型类型"""
    return sorted(MODEL_REGISTRY.keys())


# ── 模型与任务匹配表 ──

MODEL_TASK_SUPPORT: dict[str, list[str]] = {
    "mlp": ["classification", "regression", "contrastive"],
    "cnn1d": ["classification", "regression", "contrastive"],
    "tcn": ["classification", "regression", "contrastive"],
    "transformer": ["classification", "regression", "contrastive"],
    "svm": ["classification", "regression"],
    "xgboost": ["classification", "regression"],
    "kmeans": ["clustering"],
}


# ── 默认超参数 ──

DEFAULT_HYPERPARAMS: dict[str, dict[str, Any]] = {
    "mlp": {
        "hidden_layers": [128, 64],
        "activation": "relu",
        "dropout": 0.3,
        "epochs": 100,
        "learning_rate": 0.001,
        "batch_size": 32,
        "early_stopping_patience": 10,
    },
    "cnn1d": {
        "n_filters": [32, 64],
        "kernel_sizes": [5, 3],
        "pool_size": 2,
        "fc_dims": [64],
        "dropout": 0.3,
        "epochs": 100,
        "learning_rate": 0.001,
        "batch_size": 32,
        "early_stopping_patience": 10,
    },
    "tcn": {
        "n_channels": [32, 64, 64],
        "kernel_size": 3,
        "dropout": 0.2,
        "epochs": 100,
        "learning_rate": 0.001,
        "batch_size": 32,
        "early_stopping_patience": 10,
    },
    "transformer": {
        "d_model": 64,
        "nhead": 4,
        "n_layers": 2,
        "dim_ff": 128,
        "dropout": 0.1,
        "epochs": 100,
        "learning_rate": 0.001,
        "batch_size": 32,
        "early_stopping_patience": 10,
    },
    "svm": {
        "C": 1.0,
        "kernel": "rbf",
        "gamma": "scale",
        "degree": 3,
    },
    "xgboost": {
        "n_estimators": 100,
        "max_depth": 6,
        "learning_rate": 0.1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
    },
    "kmeans": {
        "n_clusters": 5,
        "init": "k-means++",
        "n_init": 10,
        "max_iter": 300,
    },
}
