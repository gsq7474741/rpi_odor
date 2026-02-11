"""ML 数据集构建器

从样本帧数据 + ML 标签构建训练/验证/测试数据集，支持：
- 分类任务：特征矩阵 + 离散标签
- 回归任务：特征矩阵 + 连续标签
- 对比学习：正负样本对
"""

import math
import random
from collections import Counter
from typing import Any

import numpy as np
from sklearn.model_selection import (
    StratifiedShuffleSplit,
    KFold,
    StratifiedKFold,
    LeaveOneOut,
)

from ..db.frame_normalizer import FrameNormalizer
from ..db.ml_label_repository import MLLabelRepository
from ..logger import logger


class DatasetBuilder:
    """从样本数据构建 ML 数据集"""

    # 8 传感器 × 4 物理量 (value, temperature, humidity, pressure)
    N_SENSORS = 8
    N_CHANNELS_PER_SENSOR = 4

    def __init__(self):
        self.label_repo = MLLabelRepository()
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
        split_method: str = "stratified_holdout",
        k_folds: int = 5,
    ) -> dict[str, Any]:
        """构建分类数据集

        返回:
            {
                "X_train": np.ndarray,  "y_train": np.ndarray,
                "X_val": np.ndarray,    "y_val": np.ndarray,
                "X_test": np.ndarray,   "y_test": np.ndarray,
                "class_names": list[str],
                "frame_shape": tuple,  # (T, 8, 4)
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

        # 提取归一化帧 (T, 8, 4)
        X_list: list[np.ndarray] = []
        y_list: list[int] = []
        skipped_ids: list[int] = []

        for lbl in labels:
            if not lbl.get("label_str"):
                continue
            sample_id = lbl["sample_id"]
            frames = self._extract_sample_frames(sample_id, n_samples, method)
            if frames is not None:
                X_list.append(frames)
                y_list.append(label_to_idx[lbl["label_str"]])
            else:
                skipped_ids.append(sample_id)

        if skipped_ids:
            logger.warning(
                f"Skipped {len(skipped_ids)}/{len(skipped_ids)+len(X_list)} samples "
                f"(no frame data): {skipped_ids[:10]}{'...' if len(skipped_ids) > 10 else ''}"
            )

        if not X_list:
            return {}

        X = np.array(X_list)  # (N, T, 8, 4)
        y = np.array(y_list)

        # 分割
        splits = self._split_dataset(
            X, y, train_ratio, val_ratio, seed,
            split_method=split_method, k_folds=k_folds,
            is_classification=True,
        )

        return {
            **splits,
            "class_names": unique_labels,
            "frame_shape": X.shape[1:],  # (T, 8, 4)
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
        split_method: str = "holdout",
        k_folds: int = 5,
    ) -> dict[str, Any]:
        """构建回归数据集

        返回:
            {
                "X_train": np.ndarray,  "y_train": np.ndarray,
                "X_val": np.ndarray,    "y_val": np.ndarray,
                "X_test": np.ndarray,   "y_test": np.ndarray,
                "frame_shape": tuple,  # (T, 8, 4)
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
            frames = self._extract_sample_frames(sample_id, n_samples, method)
            if frames is not None:
                X_list.append(frames)
                y_list.append(float(lbl["label_num"]))

        if not X_list:
            return {}

        X = np.array(X_list)  # (N, T, 8, 4)
        y = np.array(y_list)

        splits = self._split_dataset(
            X, y, train_ratio, val_ratio, seed,
            split_method=split_method, k_folds=k_folds,
            is_classification=False,
        )

        return {
            **splits,
            "frame_shape": X.shape[1:],  # (T, 8, 4)
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
                "anchor_features": np.ndarray,   # (N, T, 8, 4)
                "other_features": np.ndarray,    # (N, T, 8, 4)
                "is_positive": np.ndarray,       # (N,) bool
                "frame_shape": tuple,  # (T, 8, 4)
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
                feat = self._extract_sample_frames(a_id, n_samples, method)
                if feat is not None:
                    feature_cache[a_id] = feat
            if b_id not in feature_cache:
                feat = self._extract_sample_frames(b_id, n_samples, method)
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
            "frame_shape": anchor_features[0].shape,  # (T, 8, 4)
            "n_positive": sum(is_positive),
            "n_negative": sum(not p for p in is_positive),
        }

    def _extract_sample_frames(
        self, sample_id: int, n_samples: int, method: str
    ) -> np.ndarray | None:
        """提取单个样本的归一化帧

        使用 FrameNormalizer 的三级缓存（Redis → DB → 重新生成）

        Returns:
            (T, 8, 4) 形状的 numpy 数组，8 传感器 × 4 物理量
            (value, temperature, humidity, pressure)
        """
        try:
            frames, _from_cache = self.frame_normalizer.get_normalized_frames_by_sample(
                sample_id=sample_id,
                method=method,
                n_samples=n_samples,
            )
            if frames is not None and frames.size > 0:
                # FrameNormalizer 返回 (T, 32) → reshape 为 (T, 8, 4)
                # 列顺序: [8×value, 8×temp, 8×humidity, 8×pressure]
                # reshape 为 (T, 4, 8) 然后 transpose 为 (T, 8, 4)
                T = frames.shape[0]
                reshaped = frames.reshape(T, self.N_CHANNELS_PER_SENSOR, self.N_SENSORS)  # (T, 4, 8)
                result = reshaped.transpose(0, 2, 1).astype(np.float32)  # (T, 8, 4)
                # 处理 NaN（传感器数据缺失时 FrameNormalizer 会填 NaN）
                nan_count = np.isnan(result).sum()
                if nan_count > 0:
                    logger.debug(f"Sample {sample_id}: {nan_count} NaN values replaced with 0")
                    np.nan_to_num(result, copy=False, nan=0.0)
                return result
        except Exception as e:
            logger.warning(f"FrameNormalizer failed for sample {sample_id}: {e}")

        return None

    def _split_dataset(
        self,
        X: np.ndarray,
        y: np.ndarray,
        train_ratio: float,
        val_ratio: float,
        seed: int,
        split_method: str = "stratified_holdout",
        k_folds: int = 5,
        is_classification: bool = True,
    ) -> dict[str, Any]:
        """分割数据集为 train/val/test

        split_method:
            - holdout: 纯随机分割
            - stratified_holdout: 分层抽样分割 (分类默认)
            - kfold: K折交叉验证
            - stratified_kfold: 分层K折交叉验证
            - leave_one_out: 留一法
        """
        n = len(X)

        # K-Fold 系列：返回 folds 列表
        if split_method in ("kfold", "stratified_kfold", "leave_one_out"):
            return self._split_kfold(X, y, seed, split_method, k_folds, is_classification)

        # Holdout 系列
        if split_method == "stratified_holdout" and is_classification:
            return self._split_stratified_holdout(X, y, train_ratio, val_ratio, seed)

        # 普通 holdout（回退）
        return self._split_random_holdout(X, y, train_ratio, val_ratio, seed)

    def _split_random_holdout(
        self,
        X: np.ndarray,
        y: np.ndarray,
        train_ratio: float,
        val_ratio: float,
        seed: int,
    ) -> dict[str, np.ndarray]:
        """纯随机 holdout 分割"""
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
            "X_val": X[val_idx] if val_idx else np.empty((0,) + X.shape[1:]),
            "y_val": y[val_idx] if val_idx else np.empty(0),
            "X_test": X[test_idx] if test_idx else np.empty((0,) + X.shape[1:]),
            "y_test": y[test_idx] if test_idx else np.empty(0),
        }

    def _split_stratified_holdout(
        self,
        X: np.ndarray,
        y: np.ndarray,
        train_ratio: float,
        val_ratio: float,
        seed: int,
    ) -> dict[str, Any]:
        """分层抽样 holdout 分割，确保每个 split 中类别比例一致"""
        n = len(X)
        class_counts = Counter(y.tolist())
        min_class_count = min(class_counts.values())

        # 如果最小类别样本数 < 2，回退到随机分割
        if min_class_count < 2:
            logger.warning(
                f"Stratified split: min class has {min_class_count} sample(s), "
                f"falling back to random holdout"
            )
            return self._split_random_holdout(X, y, train_ratio, val_ratio, seed)

        test_ratio = 1.0 - train_ratio - val_ratio
        if test_ratio < 0.01:
            test_ratio = 0.0

        try:
            # 第一步: 分出 test
            if test_ratio > 0 and n >= 3:
                # 检查每个类在 test 中至少能分到 1 个
                test_size = max(test_ratio, len(class_counts) / n + 0.01)
                test_size = min(test_size, 0.5)  # 上限
                sss1 = StratifiedShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
                trainval_idx, test_idx = next(sss1.split(X, y))
            else:
                trainval_idx = np.arange(n)
                test_idx = np.array([], dtype=int)

            # 第二步: 从 trainval 中分出 val
            X_tv, y_tv = X[trainval_idx], y[trainval_idx]
            if val_ratio > 0 and len(X_tv) >= 2:
                # val 在 trainval 中的比例
                val_in_tv = val_ratio / (train_ratio + val_ratio)
                val_in_tv = max(val_in_tv, 0.05)
                val_in_tv = min(val_in_tv, 0.5)

                tv_class_counts = Counter(y_tv.tolist())
                tv_min_count = min(tv_class_counts.values())

                if tv_min_count >= 2:
                    sss2 = StratifiedShuffleSplit(n_splits=1, test_size=val_in_tv, random_state=seed)
                    train_sub_idx, val_sub_idx = next(sss2.split(X_tv, y_tv))
                else:
                    # 回退随机
                    rng = random.Random(seed)
                    tv_indices = list(range(len(X_tv)))
                    rng.shuffle(tv_indices)
                    split_at = max(1, int(len(tv_indices) * (1 - val_in_tv)))
                    train_sub_idx = np.array(tv_indices[:split_at])
                    val_sub_idx = np.array(tv_indices[split_at:])

                train_idx = trainval_idx[train_sub_idx]
                val_idx = trainval_idx[val_sub_idx]
            else:
                train_idx = trainval_idx
                val_idx = np.array([], dtype=int)

            return {
                "X_train": X[train_idx],
                "y_train": y[train_idx],
                "X_val": X[val_idx] if len(val_idx) > 0 else np.empty((0,) + X.shape[1:]),
                "y_val": y[val_idx] if len(val_idx) > 0 else np.empty(0),
                "X_test": X[test_idx] if len(test_idx) > 0 else np.empty((0,) + X.shape[1:]),
                "y_test": y[test_idx] if len(test_idx) > 0 else np.empty(0),
            }
        except Exception as e:
            logger.warning(f"Stratified split failed ({e}), falling back to random")
            return self._split_random_holdout(X, y, train_ratio, val_ratio, seed)

    def _split_kfold(
        self,
        X: np.ndarray,
        y: np.ndarray,
        seed: int,
        split_method: str,
        k_folds: int,
        is_classification: bool,
    ) -> dict[str, Any]:
        """K-Fold / Stratified K-Fold / LOO 分割，返回 folds 列表"""
        n = len(X)

        if split_method == "leave_one_out":
            splitter = LeaveOneOut()
            k_folds = n
        elif split_method == "stratified_kfold" and is_classification:
            k_actual = min(k_folds, n)
            # 确保 k 不超过最小类样本数
            class_counts = Counter(y.tolist())
            min_class_count = min(class_counts.values())
            k_actual = min(k_actual, min_class_count) if min_class_count >= 2 else k_actual
            k_actual = max(k_actual, 2)
            splitter = StratifiedKFold(n_splits=k_actual, shuffle=True, random_state=seed)
        else:
            k_actual = min(k_folds, n)
            k_actual = max(k_actual, 2)
            splitter = KFold(n_splits=k_actual, shuffle=True, random_state=seed)

        folds = []
        for train_idx, test_idx in splitter.split(X, y):
            folds.append({
                "X_train": X[train_idx],
                "y_train": y[train_idx],
                "X_test": X[test_idx],
                "y_test": y[test_idx],
            })

        # 返回第一个 fold 作为主 split（兼容现有代码），同时附带完整 folds
        first = folds[0]
        return {
            "X_train": first["X_train"],
            "y_train": first["y_train"],
            "X_val": np.empty((0,) + X.shape[1:]),
            "y_val": np.empty(0),
            "X_test": first["X_test"],
            "y_test": first["y_test"],
            "folds": folds,
            "k_folds": len(folds),
        }

    @staticmethod
    def compute_dataset_summary(
        labels: list[dict],
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        split_method: str = "stratified_holdout",
        k_folds: int = 5,
        label_type: str = "classification",
    ) -> dict[str, Any]:
        """计算数据集摘要，用于训练前预览

        不需要提取特征，只基于标签信息做统计分析。
        """
        total = len(labels)
        warnings: list[str] = []

        if total == 0:
            return {
                "total_samples": 0,
                "n_classes": 0,
                "class_distribution": [],
                "imbalance_ratio": 0,
                "random_baseline": 0,
                "majority_class": "",
                "majority_ratio": 0,
                "recommended_split": "none",
                "split_preview": {},
                "warnings": ["没有可用标签数据"],
            }

        # 分类任务
        if label_type == "classification":
            label_strs = [lbl.get("label_str", "") for lbl in labels if lbl.get("label_str")]
            counter = Counter(label_strs)
        else:
            # 回归任务：按区间分桶显示
            nums = [float(lbl["label_num"]) for lbl in labels if lbl.get("label_num") is not None]
            if not nums:
                return {
                    "total_samples": total,
                    "n_classes": 0,
                    "class_distribution": [],
                    "imbalance_ratio": 0,
                    "random_baseline": 0,
                    "majority_class": "",
                    "majority_ratio": 0,
                    "recommended_split": "holdout",
                    "split_preview": {},
                    "warnings": [],
                }
            counter = Counter([f"{v:.3f}" for v in nums])

        n_classes = len(counter)
        total_with_labels = sum(counter.values())
        sorted_dist = sorted(counter.items(), key=lambda x: -x[1])

        class_distribution = [{"label": label, "count": count} for label, count in sorted_dist]

        max_count = max(counter.values())
        min_count = min(counter.values())
        imbalance_ratio = max_count / min_count if min_count > 0 else float("inf")

        majority_class = sorted_dist[0][0]
        majority_ratio = max_count / total_with_labels if total_with_labels > 0 else 0
        random_baseline = 1.0 / n_classes if n_classes > 0 else 0

        # 推荐分割方式
        if total_with_labels <= 10:
            recommended = "leave_one_out"
        elif total_with_labels <= 30:
            recommended = "stratified_kfold" if label_type == "classification" else "kfold"
        elif total_with_labels <= 100:
            recommended = "stratified_kfold" if label_type == "classification" else "kfold"
        else:
            recommended = "stratified_holdout" if label_type == "classification" else "holdout"

        # 模拟分割预览（分层 holdout 模拟）
        split_preview: dict[str, dict[str, int]] = {}
        if label_type == "classification" and split_method in ("holdout", "stratified_holdout"):
            test_ratio = 1.0 - train_ratio - val_ratio
            train_preview: dict[str, int] = {}
            val_preview: dict[str, int] = {}
            test_preview: dict[str, int] = {}

            for label, count in counter.items():
                if split_method == "stratified_holdout":
                    t_train = max(1, round(count * train_ratio))
                    t_val = max(0, round(count * val_ratio)) if count > 1 else 0
                    t_test = count - t_train - t_val
                    if t_test < 0:
                        t_test = 0
                        t_val = count - t_train
                else:
                    t_train = round(count * train_ratio)
                    t_val = round(count * val_ratio)
                    t_test = count - t_train - t_val

                train_preview[label] = t_train
                val_preview[label] = max(0, t_val)
                test_preview[label] = max(0, t_test)

                if t_test <= 0:
                    warnings.append(f"类别 '{label}' 在 test 集中可能无样本")
                if t_val <= 0 and val_ratio > 0:
                    warnings.append(f"类别 '{label}' 在 val 集中可能无样本")

            split_preview = {"train": train_preview, "val": val_preview, "test": test_preview}

        # 通用警告
        if n_classes == 1 and label_type == "classification":
            warnings.append("只有 1 个类别，无法进行分类任务")
        if total_with_labels < 5:
            warnings.append(f"样本量极少 ({total_with_labels})，建议使用留一法 (LOO)")
        if imbalance_ratio > 10 and label_type == "classification":
            warnings.append(f"类别严重不平衡 (比例 {imbalance_ratio:.1f}:1)，建议使用 class_weight 或过采样")
        if min_count < 2 and label_type == "classification":
            warnings.append(f"最小类别仅 {min_count} 个样本，分层抽样可能回退为随机分割")

        return {
            "total_samples": total_with_labels,
            "n_classes": n_classes,
            "class_distribution": class_distribution,
            "imbalance_ratio": round(imbalance_ratio, 2) if imbalance_ratio != float("inf") else 999,
            "random_baseline": round(random_baseline, 4),
            "majority_class": majority_class,
            "majority_ratio": round(majority_ratio, 4),
            "recommended_split": recommended,
            "split_preview": split_preview,
            "warnings": warnings,
        }
