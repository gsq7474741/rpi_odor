"""PyTorch 深度学习模型通用训练框架

参考 UCI experiment/cls 最佳实践:
- SOAP 优化器 (https://arxiv.org/abs/2409.11321)
- CosineAnnealingLR 学习率调度
- 梯度裁剪
- 标签平滑 (分类)
- Early stopping

子类只需实现:
    _build_network: 构建 nn.Module 网络
    _from_config: 从保存的配置恢复实例
    get_config: 返回完整模型配置

子类可覆盖:
    _prepare_input: 数据预处理 (归一化/reshape)
    _extra_save_state: 额外保存状态 (normalizer 等)
    _load_extra_state: 加载额外状态
"""

import io
import logging
from abc import abstractmethod
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from torch.nn.utils import clip_grad_norm_
from torch.utils.data import DataLoader, TensorDataset

from ..base_model import BaseModel, ProgressCallback, TrainProgress
from ..optimizer import SOAP

logger = logging.getLogger(__name__)


class BaseDeepModel(BaseModel):
    """所有 PyTorch 深度学习模型的通用基类

    提供统一的训练循环、SOAP 优化器、CosineAnnealingLR 学习率调度、
    梯度裁剪、early stopping 等。子类只需关注网络架构和数据预处理。
    """

    framework = "pytorch"

    def __init__(
        self,
        task_type: str = "classification",
        epochs: int = 100,
        learning_rate: float = 3e-3,
        batch_size: int = 32,
        dropout: float = 0.1,
        early_stopping_patience: int = 10,
        device: str = "cpu",
        label_smoothing: float = 0.1,
        weight_decay: float = 1e-4,
        grad_clip_norm: float = 1.0,
        **kwargs: Any,
    ):
        self.task_type = task_type
        self.epochs = epochs
        self.learning_rate = learning_rate
        self.batch_size = batch_size
        self.dropout = dropout
        self.early_stopping_patience = early_stopping_patience
        self.device = device
        self.label_smoothing = label_smoothing
        self.weight_decay = weight_decay
        self.grad_clip_norm = grad_clip_norm

        self._network: nn.Module | None = None
        self._input_shape: tuple[int, ...] = ()
        self._output_dim: int = 0
        self._class_names: list[str] = []

    # ── 子类必须实现 ──

    @abstractmethod
    def _build_network(self, input_shape: tuple[int, ...], output_dim: int) -> nn.Module:
        """构建网络架构

        Args:
            input_shape: 单个样本的形状 (不含 batch 维度)
            output_dim: 输出维度 (分类=类别数, 回归=1)
        """

    @classmethod
    @abstractmethod
    def _from_config(cls, config: dict[str, Any]) -> "BaseDeepModel":
        """从保存的配置创建实例 (不含网络权重)"""

    # ── 子类可覆盖的钩子 ──

    def _prepare_input(self, X: np.ndarray, fit: bool = False) -> np.ndarray:
        """数据预处理 (归一化/reshape 等)

        Args:
            X: 输入数据
            fit: True 表示训练阶段 (需要 fit normalizer), False 表示推理
        """
        return X.astype(np.float32)

    def _extra_save_state(self) -> dict[str, Any]:
        """返回需要额外保存的状态 (如 normalizer)"""
        return {}

    def _load_extra_state(self, checkpoint: dict[str, Any]) -> None:
        """从 checkpoint 加载额外状态"""
        pass

    # ── BaseModel 接口实现 ──

    def get_total_epochs(self) -> int:
        return self.epochs

    def fit(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray | None = None,
        y_val: np.ndarray | None = None,
        progress_callback: ProgressCallback | None = None,
        n_classes: int | None = None,
    ) -> dict[str, Any]:
        # 1. 数据预处理
        X_train_p = self._prepare_input(X_train, fit=True)
        X_val_p = self._prepare_input(X_val) if X_val is not None else None

        self._input_shape = X_train_p.shape[1:]

        # 2. 标签 & 损失函数
        if self.task_type == "classification":
            self._output_dim = n_classes if n_classes is not None else int(y_train.max()) + 1
            criterion = nn.CrossEntropyLoss(label_smoothing=self.label_smoothing)
            y_train_t = torch.tensor(y_train, dtype=torch.long)
            y_val_t = torch.tensor(y_val, dtype=torch.long) if y_val is not None else None
        else:
            self._output_dim = 1
            criterion = nn.MSELoss()
            y_train_t = torch.tensor(y_train, dtype=torch.float32).unsqueeze(1)
            y_val_t = (
                torch.tensor(y_val, dtype=torch.float32).unsqueeze(1)
                if y_val is not None
                else None
            )

        # 3. 构建网络
        self._network = self._build_network(self._input_shape, self._output_dim).to(
            self.device
        )
        n_params = sum(p.numel() for p in self._network.parameters())
        logger.info(
            f"{self.__class__.__name__}: input_shape={self._input_shape}, "
            f"output_dim={self._output_dim}, params={n_params:,}"
        )

        # 4. SOAP 优化器 + CosineAnnealingLR
        optimizer = SOAP(
            self._network.parameters(),
            lr=self.learning_rate,
            weight_decay=self.weight_decay,
        )
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer,
            T_max=self.epochs,
            eta_min=1e-6,
        )

        # 5. DataLoader
        X_train_t = torch.tensor(X_train_p, dtype=torch.float32)
        train_ds = TensorDataset(X_train_t, y_train_t)
        train_loader = DataLoader(train_ds, batch_size=self.batch_size, shuffle=True)

        # 6. 训练循环
        best_loss = float("inf")
        patience_counter = 0
        best_state = None
        train_loss = val_loss = train_acc = val_acc = 0.0
        epochs_trained = 0

        for epoch in range(self.epochs):
            # ── Train ──
            self._network.train()
            loss_sum = 0.0
            correct = 0
            total = 0

            for X_b, y_b in train_loader:
                X_b, y_b = X_b.to(self.device), y_b.to(self.device)
                optimizer.zero_grad()
                out = self._network(X_b)
                loss = criterion(out, y_b)
                loss.backward()
                clip_grad_norm_(self._network.parameters(), self.grad_clip_norm)
                optimizer.step()

                loss_sum += loss.item() * X_b.size(0)
                total += X_b.size(0)
                if self.task_type == "classification":
                    correct += (out.argmax(1) == y_b).sum().item()

            scheduler.step()

            train_loss = loss_sum / max(total, 1)
            train_acc = (
                correct / max(total, 1)
                if self.task_type == "classification"
                else 0.0
            )

            # ── Validate ──
            val_loss = 0.0
            val_acc = 0.0
            if X_val_p is not None and y_val_t is not None:
                self._network.eval()
                with torch.no_grad():
                    X_v = torch.tensor(X_val_p, dtype=torch.float32).to(self.device)
                    y_v = y_val_t.to(self.device)
                    val_out = self._network(X_v)
                    val_loss = criterion(val_out, y_v).item()
                    if self.task_type == "classification":
                        val_acc = (val_out.argmax(1) == y_v).float().mean().item()

            # ── Early stopping ──
            monitor = val_loss if X_val_p is not None else train_loss
            if monitor < best_loss:
                best_loss = monitor
                patience_counter = 0
                best_state = {
                    k: v.cpu().clone() for k, v in self._network.state_dict().items()
                }
            else:
                patience_counter += 1
                if patience_counter >= self.early_stopping_patience:
                    if best_state:
                        self._network.load_state_dict(best_state)
                    logger.info(f"Early stopping at epoch {epoch + 1}")
                    break

            epochs_trained = epoch + 1

            # ── Progress callback ──
            if progress_callback:
                current_lr = optimizer.param_groups[0]["lr"]
                progress_callback(
                    TrainProgress(
                        epoch=epoch + 1,
                        total_epochs=self.epochs,
                        train_loss=train_loss,
                        val_loss=val_loss,
                        train_accuracy=train_acc,
                        val_accuracy=val_acc,
                        extra_metrics={"lr": current_lr},
                    )
                )

        if best_state:
            self._network.load_state_dict(best_state)

        return {
            "train_loss": train_loss,
            "val_loss": val_loss,
            "train_accuracy": train_acc,
            "val_accuracy": val_acc,
            "epochs_trained": epochs_trained,
        }

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._network is None:
            raise RuntimeError("Model not trained")
        X_p = self._prepare_input(X)
        self._network.eval()
        with torch.no_grad():
            X_t = torch.tensor(X_p, dtype=torch.float32).to(self.device)
            out = self._network(X_t)
            if self.task_type == "classification":
                return out.argmax(dim=1).cpu().numpy()
            return out.squeeze(1).cpu().numpy()

    def predict_proba(self, X: np.ndarray) -> np.ndarray | None:
        if self._network is None or self.task_type != "classification":
            return None
        X_p = self._prepare_input(X)
        self._network.eval()
        with torch.no_grad():
            X_t = torch.tensor(X_p, dtype=torch.float32).to(self.device)
            out = self._network(X_t)
            return torch.softmax(out, dim=1).cpu().numpy()

    def save_bytes(self) -> bytes:
        if self._network is None:
            raise RuntimeError("Model not trained")
        buf = io.BytesIO()
        torch.save(
            {
                "state_dict": self._network.state_dict(),
                "config": self.get_config(),
                **self._extra_save_state(),
            },
            buf,
        )
        return buf.getvalue()

    @classmethod
    def load_bytes(cls, data: bytes, **kwargs: Any) -> "BaseDeepModel":
        buf = io.BytesIO(data)
        checkpoint = torch.load(buf, map_location="cpu", weights_only=False)
        config = checkpoint["config"]

        model = cls._from_config(config)
        model._load_extra_state(checkpoint)

        input_shape = tuple(config.get("input_shape", ()))
        output_dim = config.get("output_dim", 0)
        model._input_shape = input_shape
        model._output_dim = output_dim
        model._class_names = config.get("class_names", [])

        if input_shape and output_dim > 0:
            model._network = model._build_network(input_shape, output_dim)
            model._network.load_state_dict(checkpoint["state_dict"])
            model._network.eval()

        return model
