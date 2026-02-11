"""MLP 模型 - 支持分类和回归任务"""

import io
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from ..base_model import BaseModel, ProgressCallback, TrainProgress, register_model


class _MLPNetwork(nn.Module):
    """MLP 网络结构"""

    def __init__(
        self,
        input_dim: int,
        output_dim: int,
        hidden_layers: list[int],
        activation: str = "relu",
        dropout: float = 0.3,
    ):
        super().__init__()
        self.input_dim = input_dim
        self.output_dim = output_dim

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
class MLPModel(BaseModel):
    """多层感知机 - 支持分类和回归"""

    framework = "pytorch"

    def __init__(
        self,
        task_type: str = "classification",
        hidden_layers: list[int] | None = None,
        activation: str = "relu",
        dropout: float = 0.3,
        epochs: int = 100,
        learning_rate: float = 0.001,
        batch_size: int = 32,
        early_stopping_patience: int = 10,
        device: str = "cpu",
        **kwargs: Any,
    ):
        self.task_type = task_type
        self.hidden_layers = hidden_layers or [128, 64]
        self.activation = activation
        self.dropout = dropout
        self.epochs = epochs
        self.learning_rate = learning_rate
        self.batch_size = batch_size
        self.early_stopping_patience = early_stopping_patience
        self.device = device

        self._network: _MLPNetwork | None = None
        self._scaler = StandardScaler()
        self._input_dim: int = 0
        self._output_dim: int = 0
        self._class_names: list[str] = []

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
        self._input_dim = X_train.shape[1]

        # 标准化特征
        X_train = self._scaler.fit_transform(X_train)
        if X_val is not None:
            X_val = self._scaler.transform(X_val)

        if self.task_type == "classification":
            self._output_dim = n_classes if n_classes is not None else int(y_train.max()) + 1
            criterion = nn.CrossEntropyLoss()
            y_train_t = torch.tensor(y_train, dtype=torch.long)
            y_val_t = torch.tensor(y_val, dtype=torch.long) if y_val is not None else None
        else:
            self._output_dim = 1
            criterion = nn.MSELoss()
            y_train_t = torch.tensor(y_train, dtype=torch.float32).unsqueeze(1)
            y_val_t = torch.tensor(y_val, dtype=torch.float32).unsqueeze(1) if y_val is not None else None

        self._network = _MLPNetwork(
            self._input_dim, self._output_dim,
            self.hidden_layers, self.activation, self.dropout,
        ).to(self.device)

        optimizer = torch.optim.Adam(self._network.parameters(), lr=self.learning_rate)

        X_train_t = torch.tensor(X_train, dtype=torch.float32)
        train_ds = TensorDataset(X_train_t, y_train_t)
        train_loader = DataLoader(train_ds, batch_size=self.batch_size, shuffle=True)

        best_val_loss = float("inf")
        patience_counter = 0
        best_state = None
        result: dict[str, Any] = {}

        for epoch in range(self.epochs):
            # Train
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
                optimizer.step()

                train_loss_sum += loss.item() * X_batch.size(0)
                train_total += X_batch.size(0)

                if self.task_type == "classification":
                    pred = output.argmax(dim=1)
                    train_correct += (pred == y_batch).sum().item()

            train_loss = train_loss_sum / max(train_total, 1)
            train_acc = train_correct / max(train_total, 1) if self.task_type == "classification" else 0.0

            # Validate
            val_loss = 0.0
            val_acc = 0.0
            if X_val is not None and y_val_t is not None:
                self._network.eval()
                with torch.no_grad():
                    X_val_t = torch.tensor(X_val, dtype=torch.float32).to(self.device)
                    y_val_dev = y_val_t.to(self.device)
                    val_output = self._network(X_val_t)
                    val_loss = criterion(val_output, y_val_dev).item()

                    if self.task_type == "classification":
                        val_pred = val_output.argmax(dim=1)
                        val_acc = (val_pred == y_val_dev).float().mean().item()

            # Early stopping
            if X_val is not None:
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    patience_counter = 0
                    best_state = {k: v.cpu().clone() for k, v in self._network.state_dict().items()}
                else:
                    patience_counter += 1
                    if patience_counter >= self.early_stopping_patience:
                        if best_state:
                            self._network.load_state_dict(best_state)
                        break

            # Progress callback
            if progress_callback:
                progress_callback(TrainProgress(
                    epoch=epoch + 1,
                    total_epochs=self.epochs,
                    train_loss=train_loss,
                    val_loss=val_loss,
                    train_accuracy=train_acc,
                    val_accuracy=val_acc,
                ))

        if best_state and X_val is not None:
            self._network.load_state_dict(best_state)

        result = {
            "train_loss": train_loss,
            "val_loss": val_loss,
            "train_accuracy": train_acc,
            "val_accuracy": val_acc,
            "epochs_trained": epoch + 1,
        }
        return result

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._network is None:
            raise RuntimeError("Model not trained")
        X_scaled = self._scaler.transform(X)
        self._network.eval()
        with torch.no_grad():
            X_t = torch.tensor(X_scaled, dtype=torch.float32).to(self.device)
            output = self._network(X_t)
            if self.task_type == "classification":
                return output.argmax(dim=1).cpu().numpy()
            else:
                return output.squeeze(1).cpu().numpy()

    def predict_proba(self, X: np.ndarray) -> np.ndarray | None:
        if self._network is None or self.task_type != "classification":
            return None
        X_scaled = self._scaler.transform(X)
        self._network.eval()
        with torch.no_grad():
            X_t = torch.tensor(X_scaled, dtype=torch.float32).to(self.device)
            output = self._network(X_t)
            proba = torch.softmax(output, dim=1)
            return proba.cpu().numpy()

    def save_bytes(self) -> bytes:
        if self._network is None:
            raise RuntimeError("Model not trained")
        buf = io.BytesIO()
        torch.save({
            "state_dict": self._network.state_dict(),
            "scaler": self._scaler,
            "config": self.get_config(),
        }, buf)
        return buf.getvalue()

    @classmethod
    def load_bytes(cls, data: bytes, **kwargs: Any) -> "MLPModel":
        buf = io.BytesIO(data)
        checkpoint = torch.load(buf, map_location="cpu", weights_only=False)
        config = checkpoint["config"]

        model = cls(
            task_type=config.get("task_type", "classification"),
            hidden_layers=config.get("hidden_layers", [128, 64]),
            activation=config.get("activation", "relu"),
            dropout=config.get("dropout", 0.3),
        )
        model._input_dim = config.get("input_dim", 0)
        model._output_dim = config.get("output_dim", 0)
        model._class_names = config.get("class_names", [])
        if "scaler" in checkpoint:
            model._scaler = checkpoint["scaler"]

        if model._input_dim > 0 and model._output_dim > 0:
            model._network = _MLPNetwork(
                model._input_dim, model._output_dim,
                model.hidden_layers, model.activation, model.dropout,
            )
            model._network.load_state_dict(checkpoint["state_dict"])
            model._network.eval()

        return model

    def get_config(self) -> dict[str, Any]:
        return {
            "model_type": "mlp",
            "task_type": self.task_type,
            "framework": "pytorch",
            "input_dim": self._input_dim,
            "output_dim": self._output_dim,
            "hidden_layers": self.hidden_layers,
            "activation": self.activation,
            "dropout": self.dropout,
            "epochs": self.epochs,
            "learning_rate": self.learning_rate,
            "batch_size": self.batch_size,
            "early_stopping_patience": self.early_stopping_patience,
            "class_names": self._class_names,
        }
