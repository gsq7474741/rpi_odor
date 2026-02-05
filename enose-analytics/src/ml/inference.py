"""模型推理模块"""

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch

from .mlp_model import MLPClassifier
from ..logger import logger
from .feature_extractor import FeatureExtractor
from ..storage.minio_client import MinioClient
from ..db.model_repository import ModelRepository



@dataclass
class PredictResult:
    """预测结果"""

    predicted_class: str
    predicted_index: int
    confidence: float
    probabilities: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "predicted_class": self.predicted_class,
            "predicted_index": self.predicted_index,
            "confidence": self.confidence,
            "probabilities": self.probabilities,
        }


class InferenceEngine:
    """推理引擎"""

    def __init__(
        self,
        minio_client: MinioClient | None = None,
        model_repo: ModelRepository | None = None,
        device: str = "cpu",
    ):
        self.minio_client = minio_client or MinioClient()
        self.model_repo = model_repo or ModelRepository()
        self.device = device

        self._model: MLPClassifier | None = None
        self._model_info: dict[str, Any] | None = None
        self._class_names: list[str] = []
        self._feature_extractor = FeatureExtractor()

    @property
    def is_loaded(self) -> bool:
        """是否已加载模型"""
        return self._model is not None

    @property
    def loaded_model_id(self) -> str | None:
        """已加载模型 ID"""
        return self._model_info.get("id") if self._model_info else None

    def load_model(self, model_id: str) -> None:
        """加载模型"""
        # 从数据库获取模型信息
        model_info = self.model_repo.get_by_id(model_id)
        if not model_info:
            raise ValueError(f"Model not found: {model_id}")

        # 从 MinIO 下载模型
        minio_path = model_info["minio_path"]
        model_data = self.minio_client.download_model(minio_path)

        # 加载模型
        self._model = MLPClassifier.from_bytes(model_data, map_location=self.device)
        self._model.eval()
        self._model_info = model_info
        self._class_names = model_info.get("class_names", [])

        logger.info(f"Model loaded: {model_info['name']} (id={model_id})")

    def unload_model(self) -> None:
        """卸载模型"""
        if self._model is not None:
            model_name = self._model_info.get("name") if self._model_info else "unknown"
            self._model = None
            self._model_info = None
            self._class_names = []
            logger.info(f"Model unloaded: {model_name}")

    def predict(
        self,
        features: np.ndarray | list[float] | None = None,
        mox_readings: list[float] | None = None,
        temp_c: float | None = None,
        rh: float | None = None,
    ) -> PredictResult:
        """执行预测

        可以直接提供特征向量，或者提供原始传感器数据由引擎提取特征
        """
        if not self.is_loaded:
            raise RuntimeError("No model loaded")

        # 提取特征
        if features is None:
            if mox_readings is None:
                raise ValueError("Either features or mox_readings must be provided")
            features = self._feature_extractor.extract_from_frame(mox_readings, temp_c, rh)

        features = np.array(features, dtype=np.float32)

        # 确保是 2D
        if features.ndim == 1:
            features = features.reshape(1, -1)

        # 推理
        x = torch.tensor(features, dtype=torch.float32).to(self.device)
        probs = self._model.predict_proba(x)[0].cpu().numpy()

        predicted_idx = int(np.argmax(probs))
        confidence = float(probs[predicted_idx])

        # 类别名称
        if self._class_names and predicted_idx < len(self._class_names):
            predicted_class = self._class_names[predicted_idx]
        else:
            predicted_class = str(predicted_idx)

        # 概率字典
        probabilities = {}
        for i, prob in enumerate(probs):
            class_name = self._class_names[i] if i < len(self._class_names) else str(i)
            probabilities[class_name] = float(prob)

        return PredictResult(
            predicted_class=predicted_class,
            predicted_index=predicted_idx,
            confidence=confidence,
            probabilities=probabilities,
        )

    def predict_batch(
        self,
        features: np.ndarray,
    ) -> list[PredictResult]:
        """批量预测"""
        if not self.is_loaded:
            raise RuntimeError("No model loaded")

        features = np.array(features, dtype=np.float32)
        x = torch.tensor(features, dtype=torch.float32).to(self.device)
        probs = self._model.predict_proba(x).cpu().numpy()

        results = []
        for i, prob in enumerate(probs):
            predicted_idx = int(np.argmax(prob))
            confidence = float(prob[predicted_idx])

            if self._class_names and predicted_idx < len(self._class_names):
                predicted_class = self._class_names[predicted_idx]
            else:
                predicted_class = str(predicted_idx)

            probabilities = {}
            for j, p in enumerate(prob):
                class_name = self._class_names[j] if j < len(self._class_names) else str(j)
                probabilities[class_name] = float(p)

            results.append(
                PredictResult(
                    predicted_class=predicted_class,
                    predicted_index=predicted_idx,
                    confidence=confidence,
                    probabilities=probabilities,
                )
            )

        return results

    def get_model_info(self) -> dict[str, Any] | None:
        """获取当前加载的模型信息"""
        return self._model_info
