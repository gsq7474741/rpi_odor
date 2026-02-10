"""模型评估模块 - 混淆矩阵/F1/R²/classification_report"""

from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)

from .base_model import BaseModel
from ..logger import logger


class Evaluator:
    """模型评估器"""

    @staticmethod
    def evaluate_classification(
        model: BaseModel,
        X: np.ndarray,
        y_true: np.ndarray,
        class_names: list[str] | None = None,
    ) -> dict[str, Any]:
        """评估分类模型

        Returns:
            包含 accuracy, f1_macro, f1_weighted, precision_macro, recall_macro,
            confusion_matrix, classification_report 的字典
        """
        y_pred = model.predict(X)

        acc = accuracy_score(y_true, y_pred)
        f1_m = f1_score(y_true, y_pred, average="macro", zero_division=0)
        f1_w = f1_score(y_true, y_pred, average="weighted", zero_division=0)
        prec = precision_score(y_true, y_pred, average="macro", zero_division=0)
        rec = recall_score(y_true, y_pred, average="macro", zero_division=0)
        cm = confusion_matrix(y_true, y_pred)

        target_names = class_names or [str(i) for i in sorted(np.unique(np.concatenate([y_true, y_pred])))]
        report = classification_report(
            y_true, y_pred,
            target_names=target_names[:len(np.unique(np.concatenate([y_true, y_pred])))],
            output_dict=True,
            zero_division=0,
        )

        # 计算 loss (1 - accuracy 作为简单 loss)
        loss = 1.0 - acc

        # 概率预测的交叉熵 loss
        proba = model.predict_proba(X)
        if proba is not None:
            eps = 1e-15
            # 确定真实类别数：取 class_names、proba 列数、y_true 最大值 三者的最大值
            n_classes_needed = max(
                len(class_names) if class_names else 0,
                proba.shape[1],
                int(y_true.max()) + 1,
            )
            # 如果 proba 列数不够，扩展到 n_classes_needed（缺失类别概率设为 eps）
            if proba.shape[1] < n_classes_needed:
                padded = np.full((proba.shape[0], n_classes_needed), eps)
                padded[:, :proba.shape[1]] = proba
                proba = padded
            proba = np.clip(proba, eps, 1 - eps)
            one_hot = np.zeros_like(proba)
            one_hot[np.arange(len(y_true)), y_true.astype(int)] = 1
            loss = -np.mean(np.sum(one_hot * np.log(proba), axis=1))

        logger.info(f"Classification eval: acc={acc:.4f}, f1_macro={f1_m:.4f}")

        return {
            "accuracy": float(acc),
            "loss": float(loss),
            "f1_macro": float(f1_m),
            "f1_weighted": float(f1_w),
            "precision_macro": float(prec),
            "recall_macro": float(rec),
            "confusion_matrix": cm.tolist(),
            "classification_report": report,
            "predictions": y_pred.tolist(),
        }

    @staticmethod
    def evaluate_regression(
        model: BaseModel,
        X: np.ndarray,
        y_true: np.ndarray,
    ) -> dict[str, Any]:
        """评估回归模型

        Returns:
            包含 mse, mae, r2_score, loss 的字典
        """
        y_pred = model.predict(X)

        mse = mean_squared_error(y_true, y_pred)
        mae = mean_absolute_error(y_true, y_pred)
        r2 = r2_score(y_true, y_pred)

        logger.info(f"Regression eval: mse={mse:.4f}, r2={r2:.4f}")

        return {
            "mse": float(mse),
            "mae": float(mae),
            "r2_score": float(r2),
            "loss": float(mse),
            "predictions": y_pred.tolist(),
        }

    @staticmethod
    def evaluate(
        model: BaseModel,
        X: np.ndarray,
        y_true: np.ndarray,
        task_type: str,
        class_names: list[str] | None = None,
    ) -> dict[str, Any]:
        """根据任务类型自动选择评估方法"""
        if task_type == "classification":
            return Evaluator.evaluate_classification(model, X, y_true, class_names)
        elif task_type == "regression":
            return Evaluator.evaluate_regression(model, X, y_true)
        else:
            logger.warning(f"Unsupported task_type for evaluation: {task_type}")
            return {}
