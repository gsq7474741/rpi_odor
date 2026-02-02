"""特征提取模块"""

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class FeatureExtractor:
    """传感器数据特征提取器"""

    def __init__(self, n_channels: int = 8):
        self.n_channels = n_channels

    def extract_from_frame(
        self,
        mox_readings: list[float] | np.ndarray,
        temp_c: float | None = None,
        rh: float | None = None,
    ) -> np.ndarray:
        """从单帧数据提取特征"""
        features = list(mox_readings)

        # 添加统计特征
        mox = np.array(mox_readings)
        features.extend([
            np.mean(mox),      # 均值
            np.std(mox),       # 标准差
            np.max(mox),       # 最大值
            np.min(mox),       # 最小值
            np.max(mox) - np.min(mox),  # 极差
        ])

        # 添加环境特征
        if temp_c is not None:
            features.append(temp_c)
        if rh is not None:
            features.append(rh)

        return np.array(features, dtype=np.float32)

    def extract_from_window(
        self,
        data: pd.DataFrame | np.ndarray,
        include_temporal: bool = True,
    ) -> np.ndarray:
        """从时间窗口数据提取特征"""
        if isinstance(data, pd.DataFrame):
            if "mox_readings" in data.columns:
                mox_data = np.array(data["mox_readings"].tolist())
            else:
                mox_cols = [c for c in data.columns if c.startswith("mox") or c.startswith("ch")]
                mox_data = data[mox_cols].values
        else:
            mox_data = data

        features = []

        # 每通道统计
        for i in range(mox_data.shape[1]):
            channel = mox_data[:, i]
            features.extend([
                np.mean(channel),
                np.std(channel),
                np.min(channel),
                np.max(channel),
                np.percentile(channel, 25),
                np.percentile(channel, 75),
            ])

        # 全局统计
        features.extend([
            np.mean(mox_data),
            np.std(mox_data),
        ])

        # 时序特征
        if include_temporal and len(mox_data) > 1:
            for i in range(mox_data.shape[1]):
                channel = mox_data[:, i]
                # 斜率
                x = np.arange(len(channel))
                slope, _ = np.polyfit(x, channel, 1)
                features.append(slope)

                # 曲线下面积 (归一化)
                auc = np.trapz(channel) / len(channel)
                features.append(auc)

        return np.array(features, dtype=np.float32)

    def extract_batch(
        self,
        df: pd.DataFrame,
        window_size: int | None = None,
    ) -> tuple[np.ndarray, list[int]]:
        """批量提取特征

        Args:
            df: 包含 mox_readings, temp_c, rh, label_index 列的 DataFrame
            window_size: 窗口大小，None 表示单帧提取

        Returns:
            features: (N, D) 特征矩阵
            labels: 标签列表
        """
        features_list = []
        labels_list = []

        if window_size is None:
            # 单帧提取
            for _, row in df.iterrows():
                mox = row["mox_readings"]
                temp = row.get("temp_c")
                rh = row.get("rh")
                feat = self.extract_from_frame(mox, temp, rh)
                features_list.append(feat)
                if "label_index" in row:
                    labels_list.append(int(row["label_index"]))
        else:
            # 窗口提取
            for i in range(0, len(df) - window_size + 1, window_size // 2):
                window = df.iloc[i : i + window_size]
                feat = self.extract_from_window(window)
                features_list.append(feat)
                if "label_index" in df.columns:
                    # 取窗口中最常见的标签
                    label = int(window["label_index"].mode().iloc[0])
                    labels_list.append(label)

        return np.array(features_list), labels_list

    @property
    def single_frame_dim(self) -> int:
        """单帧特征维度 (8 通道 + 5 统计 + 2 环境)"""
        return self.n_channels + 5 + 2

    def get_feature_names(self, include_env: bool = True) -> list[str]:
        """获取特征名称"""
        names = [f"ch{i}" for i in range(self.n_channels)]
        names.extend(["mean", "std", "max", "min", "range"])
        if include_env:
            names.extend(["temp_c", "rh"])
        return names
