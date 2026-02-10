"""机器学习模块"""

from .feature_extractor import FeatureExtractor
from .mlp_model import MLPClassifier
from .trainer import Trainer
from .inference import InferenceEngine
from .base_model import BaseModel, MODEL_REGISTRY, get_model_class, list_model_types
from .evaluator import Evaluator
from .training_manager import TrainingManager

# 触发模型注册（导入 models 包会执行 @register_model 装饰器）
from . import models as _models  # noqa: F401

__all__ = [
    "FeatureExtractor",
    "MLPClassifier",
    "Trainer",
    "InferenceEngine",
    "BaseModel",
    "MODEL_REGISTRY",
    "get_model_class",
    "list_model_types",
    "Evaluator",
    "TrainingManager",
]
