"""在线可视化模块 - PCA/t-SNE/聚类"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
from sklearn.preprocessing import StandardScaler

from ..config import VisualizationConfig, get_settings

logger = logging.getLogger(__name__)


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
