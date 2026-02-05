"""在线可视化模块 - PCA/t-SNE/聚类/UMAP"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
from sklearn.preprocessing import StandardScaler

from ..config import VisualizationConfig, get_settings
from ..logger import logger
from ..db.sample_reader import SampleReader



class VisualizationType(Enum):
    """可视化类型"""

    UNKNOWN = 0
    PCA = 1
    TSNE = 2
    CLUSTERING = 3
    PCA_CLUSTERING = 4


@dataclass
class VisPoint:
    """可视化点"""

    id: str
    coords: list[float]
    cluster: int = -1
    label: str | None = None
    ts: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "coords": self.coords,
            "cluster": self.cluster,
            "label": self.label,
            "ts": self.ts.isoformat() if self.ts else None,
        }


@dataclass
class VisualizationResult:
    """可视化结果"""

    type: VisualizationType
    points: list[VisPoint] = field(default_factory=list)
    centers: list[VisPoint] = field(default_factory=list)
    explained_variance_ratio: list[float] = field(default_factory=list)
    total_samples: int = 0
    n_clusters: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.name,
            "points": [p.to_dict() for p in self.points],
            "centers": [c.to_dict() for c in self.centers],
            "explained_variance_ratio": self.explained_variance_ratio,
            "total_samples": self.total_samples,
            "n_clusters": self.n_clusters,
        }


class VisualizationEngine:
    """可视化引擎"""

    def __init__(self, config: VisualizationConfig | None = None):
        self.config = config or get_settings().visualization
        self._scaler = StandardScaler()
        self._pca: PCA | None = None
        self._data_buffer: list[tuple[str, np.ndarray, str | None, datetime | None]] = []

    def add_sample(
        self,
        sample_id: str,
        features: np.ndarray | list[float],
        label: str | None = None,
        ts: datetime | None = None,
    ) -> None:
        """添加样本到缓冲区"""
        features = np.array(features)
        self._data_buffer.append((sample_id, features, label, ts))

        # 限制缓冲区大小
        if len(self._data_buffer) > self.config.default_max_points * 2:
            self._data_buffer = self._data_buffer[-self.config.default_max_points :]

    def compute(
        self,
        vis_type: VisualizationType,
        n_components: int | None = None,
        perplexity: int | None = None,
        n_clusters: int | None = None,
        max_points: int | None = None,
    ) -> VisualizationResult:
        """计算可视化"""
        n_components = n_components or self.config.default_n_components
        perplexity = perplexity or self.config.default_perplexity
        n_clusters = n_clusters or self.config.default_n_clusters
        max_points = max_points or self.config.default_max_points

        # 采样数据
        if len(self._data_buffer) > max_points:
            indices = np.random.choice(len(self._data_buffer), max_points, replace=False)
            samples = [self._data_buffer[i] for i in sorted(indices)]
        else:
            samples = self._data_buffer

        if len(samples) < 3:
            return VisualizationResult(type=vis_type, total_samples=len(samples))

        # 提取特征矩阵
        ids = [s[0] for s in samples]
        X = np.array([s[1] for s in samples])
        labels = [s[2] for s in samples]
        timestamps = [s[3] for s in samples]

        # 标准化
        X_scaled = self._scaler.fit_transform(X)

        result = VisualizationResult(type=vis_type, total_samples=len(samples))

        if vis_type == VisualizationType.PCA:
            result = self._compute_pca(X_scaled, ids, labels, timestamps, n_components, result)
        elif vis_type == VisualizationType.TSNE:
            result = self._compute_tsne(
                X_scaled, ids, labels, timestamps, n_components, perplexity, result
            )
        elif vis_type == VisualizationType.CLUSTERING:
            result = self._compute_clustering(X_scaled, ids, labels, timestamps, n_clusters, result)
        elif vis_type == VisualizationType.PCA_CLUSTERING:
            result = self._compute_pca_clustering(
                X_scaled, ids, labels, timestamps, n_components, n_clusters, result
            )

        return result

    def _compute_pca(
        self,
        X: np.ndarray,
        ids: list[str],
        labels: list[str | None],
        timestamps: list[datetime | None],
        n_components: int,
        result: VisualizationResult,
    ) -> VisualizationResult:
        """计算 PCA"""
        n_components = min(n_components, X.shape[1], X.shape[0])
        pca = PCA(n_components=n_components)
        X_pca = pca.fit_transform(X)

        self._pca = pca
        result.explained_variance_ratio = pca.explained_variance_ratio_.tolist()

        for i, (sample_id, coords) in enumerate(zip(ids, X_pca)):
            result.points.append(
                VisPoint(
                    id=sample_id,
                    coords=coords.tolist(),
                    label=labels[i],
                    ts=timestamps[i],
                )
            )

        return result

    def _compute_tsne(
        self,
        X: np.ndarray,
        ids: list[str],
        labels: list[str | None],
        timestamps: list[datetime | None],
        n_components: int,
        perplexity: int,
        result: VisualizationResult,
    ) -> VisualizationResult:
        """计算 t-SNE"""
        perplexity = min(perplexity, len(X) - 1)
        if perplexity < 5:
            perplexity = 5

        tsne = TSNE(n_components=n_components, perplexity=perplexity, random_state=42)
        X_tsne = tsne.fit_transform(X)

        for i, (sample_id, coords) in enumerate(zip(ids, X_tsne)):
            result.points.append(
                VisPoint(
                    id=sample_id,
                    coords=coords.tolist(),
                    label=labels[i],
                    ts=timestamps[i],
                )
            )

        return result

    def _compute_clustering(
        self,
        X: np.ndarray,
        ids: list[str],
        labels: list[str | None],
        timestamps: list[datetime | None],
        n_clusters: int,
        result: VisualizationResult,
    ) -> VisualizationResult:
        """计算 K-Means 聚类"""
        n_clusters = min(n_clusters, len(X))
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        cluster_labels = kmeans.fit_predict(X)

        result.n_clusters = n_clusters

        # 使用 PCA 降维用于可视化
        pca = PCA(n_components=2)
        X_pca = pca.fit_transform(X)
        centers_pca = pca.transform(kmeans.cluster_centers_)

        for i, (sample_id, coords) in enumerate(zip(ids, X_pca)):
            result.points.append(
                VisPoint(
                    id=sample_id,
                    coords=coords.tolist(),
                    cluster=int(cluster_labels[i]),
                    label=labels[i],
                    ts=timestamps[i],
                )
            )

        for i, center in enumerate(centers_pca):
            result.centers.append(
                VisPoint(
                    id=f"center_{i}",
                    coords=center.tolist(),
                    cluster=i,
                )
            )

        return result

    def _compute_pca_clustering(
        self,
        X: np.ndarray,
        ids: list[str],
        labels: list[str | None],
        timestamps: list[datetime | None],
        n_components: int,
        n_clusters: int,
        result: VisualizationResult,
    ) -> VisualizationResult:
        """计算 PCA + 聚类"""
        # 先 PCA 降维
        n_components = min(n_components, X.shape[1], X.shape[0])
        pca = PCA(n_components=n_components)
        X_pca = pca.fit_transform(X)

        result.explained_variance_ratio = pca.explained_variance_ratio_.tolist()

        # 在降维空间聚类
        n_clusters = min(n_clusters, len(X))
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        cluster_labels = kmeans.fit_predict(X_pca)

        result.n_clusters = n_clusters

        for i, (sample_id, coords) in enumerate(zip(ids, X_pca)):
            result.points.append(
                VisPoint(
                    id=sample_id,
                    coords=coords.tolist(),
                    cluster=int(cluster_labels[i]),
                    label=labels[i],
                    ts=timestamps[i],
                )
            )

        for i, center in enumerate(kmeans.cluster_centers_):
            result.centers.append(
                VisPoint(
                    id=f"center_{i}",
                    coords=center.tolist(),
                    cluster=i,
                )
            )

        return result

    def clear(self) -> None:
        """清空缓冲区"""
        self._data_buffer.clear()
        self._pca = None
        logger.info("Visualization buffer cleared")

    @property
    def sample_count(self) -> int:
        """当前样本数量"""
        return len(self._data_buffer)

    def load_samples_from_db(
        self,
        sample_ids: list[int] | None = None,
        params_hash: str | None = None,
        phase_name: str | None = None,
        liquid_ids: list[str] | None = None,
        limit: int = 1000,
    ) -> int:
        """从数据库加载样本数据到缓冲区
        
        Args:
            sample_ids: 指定的样本 ID 列表
            params_hash: 按参数哈希过滤（跨 run 聚合）
            phase_name: 按阶段过滤
            liquid_ids: 按液体过滤
            limit: 最大加载数量
            
        Returns:
            加载的样本数量
        """
        reader = SampleReader()
        
        # 获取聚合特征
        if sample_ids:
            df = reader.get_aggregated_features(sample_ids=sample_ids)
        elif params_hash:
            df = reader.get_aggregated_features(params_hash=params_hash)
        else:
            # 列出样本然后获取特征
            samples = reader.list_samples(
                phase_name=phase_name,
                liquid_ids=liquid_ids,
                limit=limit,
            )
            if not samples:
                return 0
            sample_ids = [s["id"] for s in samples]
            df = reader.get_aggregated_features(sample_ids=sample_ids)
        
        if df.empty:
            return 0
        
        # 将聚合特征转换为宽格式（每个样本一行，每个传感器的特征作为列）
        loaded_count = 0
        for sample_id in df["sample_id"].unique():
            sample_df = df[df["sample_id"] == sample_id]
            
            # 构建特征向量：[sensor_0_mean, sensor_0_std, ..., sensor_7_mean, sensor_7_std]
            features = []
            for sensor_idx in range(8):
                sensor_data = sample_df[sample_df["sensor_idx"] == sensor_idx]
                if not sensor_data.empty:
                    row = sensor_data.iloc[0]
                    features.extend([
                        row.get("mean_value", 0) or 0,
                        row.get("std_value", 0) or 0,
                        row.get("min_value", 0) or 0,
                        row.get("max_value", 0) or 0,
                    ])
                else:
                    features.extend([0, 0, 0, 0])
            
            # 获取标签（液体名称）
            label = None
            liquid_names = sample_df["liquid_names"].iloc[0] if "liquid_names" in sample_df.columns else None
            if liquid_names and isinstance(liquid_names, list):
                label = " + ".join(liquid_names)
            
            # 添加到缓冲区
            self.add_sample(
                sample_id=str(sample_id),
                features=np.array(features),
                label=label,
            )
            loaded_count += 1
        
        logger.info(f"Loaded {loaded_count} samples from database")
        return loaded_count

    def compute_from_sample_group(
        self,
        params_hash: str,
        vis_type: VisualizationType,
        n_components: int | None = None,
        perplexity: int | None = None,
        n_clusters: int | None = None,
    ) -> VisualizationResult:
        """计算特定参数组的可视化（跨 run 聚合）
        
        Args:
            params_hash: 参数哈希（用于跨 run 聚合相同参数的样本）
            vis_type: 可视化类型
            n_components: PCA/t-SNE 维度
            perplexity: t-SNE perplexity
            n_clusters: 聚类数量
            
        Returns:
            可视化结果
        """
        self.clear()
        loaded = self.load_samples_from_db(params_hash=params_hash)
        if loaded == 0:
            return VisualizationResult(type=vis_type, total_samples=0)
        
        return self.compute(
            vis_type=vis_type,
            n_components=n_components,
            perplexity=perplexity,
            n_clusters=n_clusters,
        )
