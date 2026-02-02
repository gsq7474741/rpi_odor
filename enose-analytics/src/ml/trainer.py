"""模型训练模块"""

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from .mlp_model import MLPClassifier

logger = logging.getLogger(__name__)


@dataclass
class TrainProgress:
    """训练进度"""

    epoch: int
    total_epochs: int
    train_loss: float
    val_loss: float
    train_accuracy: float
    val_accuracy: float
    status: str = "in_progress"
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "epoch": self.epoch,
            "total_epochs": self.total_epochs,
            "train_loss": self.train_loss,
            "val_loss": self.val_loss,
            "train_accuracy": self.train_accuracy,
            "val_accuracy": self.val_accuracy,
            "status": self.status,
            "message": self.message,
        }


@dataclass
class TrainResult:
    """训练结果"""

    model: MLPClassifier
    train_accuracy: float
    val_accuracy: float
    train_loss: float
    val_loss: float
    history: list[TrainProgress] = field(default_factory=list)


class Trainer:
    """模型训练器"""

    def __init__(
        self,
        hidden_layers: list[int] | None = None,
        activation: str = "relu",
        dropout: float = 0.2,
        epochs: int = 100,
        batch_size: int = 32,
        learning_rate: float = 0.001,
        validation_split: float = 0.2,
        early_stopping_patience: int = 10,
        device: str = "cpu",
    ):
        self.hidden_layers = hidden_layers or [64, 32]
        self.activation = activation
        self.dropout = dropout
        self.epochs = epochs
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.validation_split = validation_split
        self.early_stopping_patience = early_stopping_patience
        self.device = device

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        class_names: list[str] | None = None,
        progress_callback: Callable[[TrainProgress], None] | None = None,
    ) -> TrainResult:
        """训练模型

        Args:
            X: (N, D) 特征矩阵
            y: (N,) 标签向量
            class_names: 类别名称列表
            progress_callback: 进度回调函数

        Returns:
            训练结果
        """
        # 数据准备
        n_samples = len(X)
        n_val = int(n_samples * self.validation_split)
        indices = np.random.permutation(n_samples)

        train_idx = indices[n_val:]
        val_idx = indices[:n_val]

        X_train = torch.tensor(X[train_idx], dtype=torch.float32)
        y_train = torch.tensor(y[train_idx], dtype=torch.long)
        X_val = torch.tensor(X[val_idx], dtype=torch.float32)
        y_val = torch.tensor(y[val_idx], dtype=torch.long)

        train_dataset = TensorDataset(X_train, y_train)
        train_loader = DataLoader(train_dataset, batch_size=self.batch_size, shuffle=True)

        # 创建模型
        input_dim = X.shape[1]
        output_dim = len(np.unique(y))

        model = MLPClassifier(
            input_dim=input_dim,
            output_dim=output_dim,
            hidden_layers=self.hidden_layers,
            activation=self.activation,
            dropout=self.dropout,
        ).to(self.device)

        # 优化器和损失函数
        optimizer = torch.optim.Adam(model.parameters(), lr=self.learning_rate)
        criterion = nn.CrossEntropyLoss()

        # 训练循环
        history: list[TrainProgress] = []
        best_val_loss = float("inf")
        patience_counter = 0

        for epoch in range(self.epochs):
            # 训练阶段
            model.train()
            train_loss = 0.0
            train_correct = 0
            train_total = 0

            for batch_X, batch_y in train_loader:
                batch_X = batch_X.to(self.device)
                batch_y = batch_y.to(self.device)

                optimizer.zero_grad()
                outputs = model(batch_X)
                loss = criterion(outputs, batch_y)
                loss.backward()
                optimizer.step()

                train_loss += loss.item() * len(batch_X)
                _, predicted = torch.max(outputs, 1)
                train_correct += (predicted == batch_y).sum().item()
                train_total += len(batch_y)

            train_loss /= train_total
            train_accuracy = train_correct / train_total

            # 验证阶段
            model.eval()
            with torch.no_grad():
                X_val_dev = X_val.to(self.device)
                y_val_dev = y_val.to(self.device)
                val_outputs = model(X_val_dev)
                val_loss = criterion(val_outputs, y_val_dev).item()
                _, val_predicted = torch.max(val_outputs, 1)
                val_accuracy = (val_predicted == y_val_dev).sum().item() / len(y_val)

            # 记录进度
            progress = TrainProgress(
                epoch=epoch + 1,
                total_epochs=self.epochs,
                train_loss=train_loss,
                val_loss=val_loss,
                train_accuracy=train_accuracy,
                val_accuracy=val_accuracy,
            )
            history.append(progress)

            if progress_callback:
                progress_callback(progress)

            # 早停
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= self.early_stopping_patience:
                    logger.info(f"Early stopping at epoch {epoch + 1}")
                    break

        # 最终结果
        final_progress = history[-1]
        return TrainResult(
            model=model,
            train_accuracy=final_progress.train_accuracy,
            val_accuracy=final_progress.val_accuracy,
            train_loss=final_progress.train_loss,
            val_loss=final_progress.val_loss,
            history=history,
        )

    def train_streaming(
        self,
        X: np.ndarray,
        y: np.ndarray,
        class_names: list[str] | None = None,
    ) -> Iterator[TrainProgress | TrainResult]:
        """流式训练 (生成器版本)"""
        results: list[TrainProgress | TrainResult] = []

        def collect_progress(progress: TrainProgress) -> None:
            results.append(progress)

        # 启动训练
        final_result = self.train(X, y, class_names, collect_progress)

        # 逐个返回进度
        for item in results:
            yield item

        # 返回最终结果
        yield final_result
