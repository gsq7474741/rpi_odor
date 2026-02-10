"""XGBoost 模型 - 支持分类和回归任务"""

import io
from typing import Any

import joblib
import numpy as np
from sklearn.preprocessing import StandardScaler

from ..base_model import BaseModel, ProgressCallback, TrainProgress, register_model


@register_model("xgboost")
class XGBoostModel(BaseModel):
    """XGBoost 分类/回归模型"""

    framework = "xgboost"

    def __init__(
        self,
        task_type: str = "classification",
        n_estimators: int = 100,
        max_depth: int = 6,
        learning_rate: float = 0.1,
        subsample: float = 0.8,
        colsample_bytree: float = 0.8,
        **kwargs: Any,
    ):
        self.task_type = task_type
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.learning_rate = learning_rate
        self.subsample = subsample
        self.colsample_bytree = colsample_bytree

        self._scaler = StandardScaler()
        self._model: Any = None
        self._class_names: list[str] = []
        self._input_dim: int = 0
        self._output_dim: int = 0

    def get_total_epochs(self) -> int:
        return self.n_estimators

    def fit(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray | None = None,
        y_val: np.ndarray | None = None,
        progress_callback: ProgressCallback | None = None,
        n_classes: int | None = None,
    ) -> dict[str, Any]:
        import xgboost as xgb

        self._input_dim = X_train.shape[1]

        X_scaled = self._scaler.fit_transform(X_train)
        X_val_scaled = self._scaler.transform(X_val) if X_val is not None else None

        params: dict[str, Any] = {
            "max_depth": self.max_depth,
            "learning_rate": self.learning_rate,
            "subsample": self.subsample,
            "colsample_bytree": self.colsample_bytree,
            "verbosity": 0,
        }

        if self.task_type == "classification":
            actual_n_classes = n_classes if n_classes is not None else int(y_train.max()) + 1
            self._output_dim = actual_n_classes
            if actual_n_classes == 2:
                params["objective"] = "binary:logistic"
                params["eval_metric"] = "logloss"
            else:
                params["objective"] = "multi:softprob"
                params["num_class"] = actual_n_classes
                params["eval_metric"] = "mlogloss"
        else:
            self._output_dim = 1
            params["objective"] = "reg:squarederror"
            params["eval_metric"] = "rmse"

        dtrain = xgb.DMatrix(X_scaled, label=y_train)
        evals = [(dtrain, "train")]
        if X_val_scaled is not None and y_val is not None:
            dval = xgb.DMatrix(X_val_scaled, label=y_val)
            evals.append((dval, "val"))

        # 自定义回调用于进度报告
        progress_data: dict[str, list[float]] = {"train_loss": [], "val_loss": []}

        class _ProgressCallback(xgb.callback.TrainingCallback):
            def after_iteration(self, model, epoch, evals_log):
                train_metric = list(evals_log.get("train", {}).values())
                val_metric = list(evals_log.get("val", {}).values())
                t_loss = train_metric[0][-1] if train_metric else 0.0
                v_loss = val_metric[0][-1] if val_metric else 0.0
                progress_data["train_loss"].append(t_loss)
                progress_data["val_loss"].append(v_loss)

                if progress_callback and (epoch + 1) % max(1, self.n_estimators // 20) == 0:
                    progress_callback(TrainProgress(
                        epoch=epoch + 1,
                        total_epochs=self.n_estimators,
                        train_loss=t_loss,
                        val_loss=v_loss,
                    ))
                return False

            def __init__(self_inner, n_est):
                self_inner.n_estimators = n_est

        callbacks = [_ProgressCallback(self.n_estimators)]

        self._model = xgb.train(
            params,
            dtrain,
            num_boost_round=self.n_estimators,
            evals=evals,
            callbacks=callbacks,
            verbose_eval=False,
        )

        # 计算最终指标
        result: dict[str, Any] = {"epochs_trained": self.n_estimators}

        train_pred = self._model.predict(dtrain)
        if self.task_type == "classification":
            if actual_n_classes == 2:
                train_pred_cls = (train_pred > 0.5).astype(int)
            else:
                train_pred_cls = np.argmax(train_pred, axis=1)
            result["train_accuracy"] = float(np.mean(train_pred_cls == y_train))
            result["train_loss"] = progress_data["train_loss"][-1] if progress_data["train_loss"] else 0.0
        else:
            from sklearn.metrics import mean_squared_error
            result["train_loss"] = mean_squared_error(y_train, train_pred)

        if X_val_scaled is not None and y_val is not None:
            val_pred = self._model.predict(dval)
            if self.task_type == "classification":
                if actual_n_classes == 2:
                    val_pred_cls = (val_pred > 0.5).astype(int)
                else:
                    val_pred_cls = np.argmax(val_pred, axis=1)
                result["val_accuracy"] = float(np.mean(val_pred_cls == y_val))
                result["val_loss"] = progress_data["val_loss"][-1] if progress_data["val_loss"] else 0.0
            else:
                from sklearn.metrics import mean_squared_error
                result["val_loss"] = mean_squared_error(y_val, val_pred)

        if progress_callback:
            progress_callback(TrainProgress(
                epoch=self.n_estimators,
                total_epochs=self.n_estimators,
                train_loss=result.get("train_loss", 0.0),
                val_loss=result.get("val_loss", 0.0),
                train_accuracy=result.get("train_accuracy", 0.0),
                val_accuracy=result.get("val_accuracy", 0.0),
            ))

        return result

    def predict(self, X: np.ndarray) -> np.ndarray:
        import xgboost as xgb
        if self._model is None:
            raise RuntimeError("Model not trained")
        X_scaled = self._scaler.transform(X)
        dmatrix = xgb.DMatrix(X_scaled)
        pred = self._model.predict(dmatrix)
        if self.task_type == "classification":
            if pred.ndim == 1:
                return (pred > 0.5).astype(int)
            else:
                return np.argmax(pred, axis=1)
        return pred

    def predict_proba(self, X: np.ndarray) -> np.ndarray | None:
        import xgboost as xgb
        if self._model is None or self.task_type != "classification":
            return None
        X_scaled = self._scaler.transform(X)
        dmatrix = xgb.DMatrix(X_scaled)
        pred = self._model.predict(dmatrix)
        if pred.ndim == 1:
            return np.column_stack([1 - pred, pred])
        return pred

    def save_bytes(self) -> bytes:
        if self._model is None:
            raise RuntimeError("Model not trained")
        buf = io.BytesIO()
        joblib.dump({
            "model": self._model.save_raw(),
            "scaler": self._scaler,
            "config": self.get_config(),
        }, buf)
        return buf.getvalue()

    @classmethod
    def load_bytes(cls, data: bytes, **kwargs: Any) -> "XGBoostModel":
        import xgboost as xgb
        buf = io.BytesIO(data)
        checkpoint = joblib.load(buf)
        config = checkpoint["config"]

        model = cls(
            task_type=config.get("task_type", "classification"),
            n_estimators=config.get("n_estimators", 100),
            max_depth=config.get("max_depth", 6),
            learning_rate=config.get("learning_rate", 0.1),
            subsample=config.get("subsample", 0.8),
            colsample_bytree=config.get("colsample_bytree", 0.8),
        )
        model._scaler = checkpoint["scaler"]
        model._input_dim = config.get("input_dim", 0)
        model._output_dim = config.get("output_dim", 0)
        model._class_names = config.get("class_names", [])

        booster = xgb.Booster()
        booster.load_model(bytearray(checkpoint["model"]))
        model._model = booster

        return model

    def get_config(self) -> dict[str, Any]:
        return {
            "model_type": "xgboost",
            "task_type": self.task_type,
            "framework": "xgboost",
            "input_dim": self._input_dim,
            "output_dim": self._output_dim,
            "n_estimators": self.n_estimators,
            "max_depth": self.max_depth,
            "learning_rate": self.learning_rate,
            "subsample": self.subsample,
            "colsample_bytree": self.colsample_bytree,
            "class_names": self._class_names,
        }
