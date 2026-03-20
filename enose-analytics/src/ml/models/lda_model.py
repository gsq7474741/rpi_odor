"""Linear Discriminant Analysis 模型 - 支持分类任务"""

import io
from typing import Any

import joblib
import numpy as np
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.preprocessing import StandardScaler

from ..base_model import BaseModel, ProgressCallback, TrainProgress, register_model


@register_model("lda")
class LDAModel(BaseModel):
    """LDA 分类模型"""

    framework = "sklearn"

    def __init__(
        self,
        task_type: str = "classification",
        solver: str = "svd",
        shrinkage: str | float | None = None,
        n_components: int | None = None,
        **kwargs: Any,
    ):
        self.task_type = task_type
        self.solver = solver
        self.shrinkage = shrinkage
        self.n_components = n_components

        self._scaler = StandardScaler()
        self._model: LinearDiscriminantAnalysis | None = None
        self._class_names: list[str] = []
        self._input_dim: int = 0
        self._output_dim: int = 0

    def get_total_epochs(self) -> int:
        return 1

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
        self._output_dim = n_classes if n_classes is not None else int(y_train.max()) + 1

        X_scaled = self._scaler.fit_transform(X_train)

        self._model = LinearDiscriminantAnalysis(
            solver=self.solver,
            shrinkage=self.shrinkage if self.solver == "lsqr" else None,
            n_components=self.n_components,
        )

        if progress_callback:
            progress_callback(TrainProgress(
                epoch=0, total_epochs=1,
                extra_metrics={"status": "fitting"},
            ))

        self._model.fit(X_scaled, y_train)

        train_pred = self._model.predict(X_scaled)
        train_acc = float(np.mean(train_pred == y_train))
        result: dict[str, Any] = {
            "epochs_trained": 1,
            "train_accuracy": train_acc,
            "train_loss": 1.0 - train_acc,
        }

        if X_val is not None and y_val is not None:
            X_val_scaled = self._scaler.transform(X_val)
            val_pred = self._model.predict(X_val_scaled)
            val_acc = float(np.mean(val_pred == y_val))
            result["val_accuracy"] = val_acc
            result["val_loss"] = 1.0 - val_acc

        if progress_callback:
            progress_callback(TrainProgress(
                epoch=1, total_epochs=1,
                train_loss=result.get("train_loss", 0.0),
                val_loss=result.get("val_loss", 0.0),
                train_accuracy=result.get("train_accuracy", 0.0),
                val_accuracy=result.get("val_accuracy", 0.0),
            ))

        return result

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._model is None:
            raise RuntimeError("Model not trained")
        X_scaled = self._scaler.transform(X)
        return self._model.predict(X_scaled)

    def predict_proba(self, X: np.ndarray) -> np.ndarray | None:
        if self._model is None:
            return None
        X_scaled = self._scaler.transform(X)
        proba = self._model.predict_proba(X_scaled)
        if self._output_dim > proba.shape[1]:
            full_proba = np.zeros((len(X), self._output_dim))
            for i, cls in enumerate(self._model.classes_):
                full_proba[:, int(cls)] = proba[:, i]
            return full_proba
        return proba

    def save_bytes(self) -> bytes:
        if self._model is None:
            raise RuntimeError("Model not trained")
        buf = io.BytesIO()
        joblib.dump({
            "model": self._model,
            "scaler": self._scaler,
            "config": self.get_config(),
        }, buf)
        return buf.getvalue()

    @classmethod
    def load_bytes(cls, data: bytes, **kwargs: Any) -> "LDAModel":
        buf = io.BytesIO(data)
        checkpoint = joblib.load(buf)
        config = checkpoint["config"]

        model = cls(
            task_type=config.get("task_type", "classification"),
            solver=config.get("solver", "svd"),
            shrinkage=config.get("shrinkage"),
            n_components=config.get("n_components"),
        )
        model._model = checkpoint["model"]
        model._scaler = checkpoint["scaler"]
        model._input_dim = config.get("input_dim", 0)
        model._output_dim = config.get("output_dim", 0)
        model._class_names = config.get("class_names", [])
        return model

    def get_config(self) -> dict[str, Any]:
        return {
            "model_type": "lda",
            "task_type": self.task_type,
            "framework": "sklearn",
            "input_dim": self._input_dim,
            "output_dim": self._output_dim,
            "solver": self.solver,
            "shrinkage": self.shrinkage,
            "n_components": self.n_components,
            "class_names": self._class_names,
        }
