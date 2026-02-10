"""ML 数据集构建器

从样本帧数据 + ML 标签构建训练/验证/测试数据集，支持：
- 分类任务：特征矩阵 + 离散标签
- 回归任务：特征矩阵 + 连续标签
- 对比学习：正负样本对
"""

import math
import random
from typing import Any

import numpy as np

from ..db.frame_normalizer import FrameNormalizer
from ..db.ml_label_repository import MLLabelRepository
from ..db.sample_reader import SampleReader
from ..logger import logger
from .feature_extractor import FeatureExtractor


class DatasetBuilder:
    """从样本数据构建 ML 数据集"""

    def __init__(self):
        self.label_repo = MLLabelRepository()
        self.sample_reader = SampleReader()
        self.feature_extractor = FeatureExtractor()
        self.frame_normalizer = FrameNormalizer()

    def build_classification_dataset(
        self,
        config_name: str,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
        n_samples: int = 100,
        method: str = "linear",
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        seed: int = 42,
    ) -> dict[str, Any]:
        """构建分类数据集

        返回:
            {
                "X_train": np.ndarray,  "y_train": np.ndarray,
                "X_val": np.ndarray,    "y_val": np.ndarray,
                "X_test": np.ndarray,   "y_test": np.ndarray,
                "class_names": list[str],
                "feature_dim": int,
                "n_classes": int,
            }
        """
        labels = self.label_repo.get_labels_by_config(
            config_name=config_name,
            run_ids=run_ids,
            phase_names=phase_names,
            sample_ids=sample_ids,
        )
        if not labels:
            logger.warning(f"No labels found for config '{config_name}'")
            return {}

        # 构建 class_names 映射
        unique_labels = sorted(set(lbl["label_str"] for lbl in labels if lbl.get("label_str")))
        label_to_idx = {name: i for i, name in enumerate(unique_labels)}

        # 提取特征
        X_list: list[np.ndarray] = []
        y_list: list[int] = []

        for lbl in labels:
            if not lbl.get("label_str"):
                continue
            sample_id = lbl["sample_id"]
            features = self._extract_sample_features(sample_id, n_samples, method)
            if features is not None:
                X_list.append(features)
                y_list.append(label_to_idx[lbl["label_str"]])

        if not X_list:
            return {}

        X = np.array(X_list)
        y = np.array(y_list)

        # 分割
        splits = self._split_dataset(X, y, train_ratio, val_ratio, seed)

        return {
            **splits,
            "class_names": unique_labels,
            "feature_dim": X.shape[1],
            "n_classes": len(unique_labels),
        }

    def build_regression_dataset(
        self,
        config_name: str,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        sample_ids: list[int] | None = None,
        n_samples: int = 100,
        method: str = "linear",
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        seed: int = 42,
    ) -> dict[str, Any]:
        """构建回归数据集

        返回:
            {
                "X_train": np.ndarray,  "y_train": np.ndarray,
                "X_val": np.ndarray,    "y_val": np.ndarray,
                "X_test": np.ndarray,   "y_test": np.ndarray,
                "feature_dim": int,
                "y_min": float, "y_max": float, "y_mean": float,
            }
        """
        labels = self.label_repo.get_labels_by_config(
            config_name=config_name,
            run_ids=run_ids,
            phase_names=phase_names,
            sample_ids=sample_ids,
        )
        if not labels:
            return {}

        X_list: list[np.ndarray] = []
        y_list: list[float] = []

        for lbl in labels:
            if lbl.get("label_num") is None:
                continue
            sample_id = lbl["sample_id"]
            features = self._extract_sample_features(sample_id, n_samples, method)
            if features is not None:
                X_list.append(features)
                y_list.append(float(lbl["label_num"]))

        if not X_list:
            return {}

        X = np.array(X_list)
        y = np.array(y_list)

        splits = self._split_dataset(X, y, train_ratio, val_ratio, seed)

        return {
            **splits,
            "feature_dim": X.shape[1],
            "y_min": float(y.min()),
            "y_max": float(y.max()),
            "y_mean": float(y.mean()),
        }

    def build_contrastive_pairs(
        self,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        n_samples: int = 100,
        method: str = "linear",
        max_pairs: int = 500,
        seed: int = 42,
    ) -> dict[str, Any]:
        """构建对比学习样本对

        返回:
            {
                "anchor_features": np.ndarray,   # (N, feat_dim)
                "other_features": np.ndarray,    # (N, feat_dim)
                "is_positive": np.ndarray,       # (N,) bool
                "feature_dim": int,
                "n_positive": int,
                "n_negative": int,
            }
        """
        labels = self.label_repo.get_labels_by_config(
            config_name="params_group",
            run_ids=run_ids,
            phase_names=phase_names,
        )
        if not labels:
            return {}

        # 按 params_hash 分组
        groups: dict[str, list[dict]] = {}
        for lbl in labels:
            h = lbl.get("label_str") or lbl.get("params_hash", "")
            if h:
                groups.setdefault(h, []).append(lbl)

        # 构建正样本对 (同 hash)
        rng = random.Random(seed)
        positive_pairs: list[tuple[int, int]] = []
        negative_pairs: list[tuple[int, int]] = []

        group_keys = list(groups.keys())
        for gk in group_keys:
            members = groups[gk]
            if len(members) < 2:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    positive_pairs.append((members[i]["sample_id"], members[j]["sample_id"]))

        # 构建负样本对 (不同 hash)
        if len(group_keys) >= 2:
            for _ in range(len(positive_pairs) * 2):
                g1, g2 = rng.sample(group_keys, 2)
                s1 = rng.choice(groups[g1])
                s2 = rng.choice(groups[g2])
                negative_pairs.append((s1["sample_id"], s2["sample_id"]))

        # 平衡正负对
        half = max_pairs // 2
        if len(positive_pairs) > half:
            positive_pairs = rng.sample(positive_pairs, half)
        if len(negative_pairs) > half:
            negative_pairs = rng.sample(negative_pairs, half)

        # 提取特征
        feature_cache: dict[int, np.ndarray] = {}
        anchor_features: list[np.ndarray] = []
        other_features: list[np.ndarray] = []
        is_positive: list[bool] = []

        all_pairs = [(a, b, True) for a, b in positive_pairs] + \
                    [(a, b, False) for a, b in negative_pairs]

        for a_id, b_id, positive in all_pairs:
            if a_id not in feature_cache:
                feat = self._extract_sample_features(a_id, n_samples, method)
                if feat is not None:
                    feature_cache[a_id] = feat
            if b_id not in feature_cache:
                feat = self._extract_sample_features(b_id, n_samples, method)
                if feat is not None:
                    feature_cache[b_id] = feat

            if a_id in feature_cache and b_id in feature_cache:
                anchor_features.append(feature_cache[a_id])
                other_features.append(feature_cache[b_id])
                is_positive.append(positive)

        if not anchor_features:
            return {}

        return {
            "anchor_features": np.array(anchor_features),
            "other_features": np.array(other_features),
            "is_positive": np.array(is_positive),
            "feature_dim": anchor_features[0].shape[0],
            "n_positive": sum(is_positive),
            "n_negative": sum(not p for p in is_positive),
        }

    def _extract_sample_features(
        self, sample_id: int, n_samples: int, method: str
    ) -> np.ndarray | None:
        """提取单个样本的聚合特征向量

        使用 FrameNormalizer 的三级缓存（Redis → DB → 重新生成）
        """
        try:
            frames, _from_cache = self.frame_normalizer.get_normalized_frames_by_sample(
                sample_id=sample_id,
                method=method,
                n_samples=n_samples,
            )
            if frames is not None:
                return self._aggregate_frames(frames)
        except Exception as e:
            logger.warning(f"FrameNormalizer failed for sample {sample_id}: {e}")

        # 回退: 从数据库获取传感器原始数据
        try:
            df = self.sample_reader.get_sample_sensor_data(sample_id)
            if df.empty:
                return None
            features = []
            for sensor_idx in range(8):
                sensor_data = df[df["sensor_idx"] == sensor_idx]["value"]
                if len(sensor_data) == 0:
                    features.extend([0, 0, 0, 0, 0, 0])
                else:
                    col = sensor_data.values
                    features.extend([
                        float(col.mean()), float(col.std()),
                        float(col.min()), float(col.max()),
                        float(col[-1] - col[0]),
                        float(np.trapezoid(col)),
                    ])
            return np.array(features, dtype=np.float32)
        except Exception as e:
            logger.debug(f"Feature extraction failed for sample {sample_id}: {e}")
            return None

    def _aggregate_frames(self, frames: np.ndarray) -> np.ndarray:
        """从归一化帧中聚合特征

        Args:
            frames: (n_samples, n_channels) — 支持 8ch（旧）和 32ch（新）
        """
        n_channels = frames.shape[1]
        features = []
        for ch in range(n_channels):
            col = frames[:, ch].astype(np.float32)
            features.extend([
                col.mean(), col.std(), col.min(), col.max(),
                col[-1] - col[0],  # 斜率近似
                np.trapezoid(col),     # 曲线下面积
            ])
        return np.array(features, dtype=np.float32)

    def _split_dataset(
        self,
        X: np.ndarray,
        y: np.ndarray,
        train_ratio: float,
        val_ratio: float,
        seed: int,
    ) -> dict[str, np.ndarray]:
        """分割数据集为 train/val/test"""
        n = len(X)
        indices = list(range(n))
        rng = random.Random(seed)
        rng.shuffle(indices)

        train_end = math.floor(n * train_ratio)
        val_end = train_end + math.floor(n * val_ratio)

        train_idx = indices[:train_end]
        val_idx = indices[train_end:val_end]
        test_idx = indices[val_end:]

        return {
            "X_train": X[train_idx],
            "y_train": y[train_idx],
            "X_val": X[val_idx],
            "y_val": y[val_idx],
            "X_test": X[test_idx],
            "y_test": y[test_idx],
        }
