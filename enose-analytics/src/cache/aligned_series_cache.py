"""对齐序列 (Aligned Series) Redis 缓存"""

from typing import Literal

import numpy as np
import redis

from ..config import get_settings
from ..logger import logger


InterpolationMethod = Literal["linear", "pchip"]


class AlignedSeriesCache:
    """对齐序列 Redis 缓存
    
    缓存 key 格式: aligned_series:{sample_id}:{method}:{n_samples}
    缓存 value: numpy array 的 bytes 表示
    """

    def __init__(self, redis_url: str | None = None):
        settings = get_settings()
        url = redis_url or settings.redis.url
        self.redis = redis.from_url(url, decode_responses=False)
        self.default_ttl = settings.redis.default_ttl
        logger.info(f"AlignedSeriesCache 初始化: {url}")

    def _key(self, sample_id: int, method: str, n_samples: int) -> str:
        """生成缓存 key"""
        return f"aligned_series:{sample_id}:{method}:{n_samples}"

    def get(
        self,
        sample_id: int,
        method: InterpolationMethod,
        n_samples: int,
    ) -> np.ndarray | None:
        """获取缓存的对齐序列数据
        
        Args:
            sample_id: 样本 ID
            method: 插值方法
            n_samples: 采样点数
            
        Returns:
            numpy array (n_samples, n_channels) 或 None
        """
        key = self._key(sample_id, method, n_samples)
        data = self.redis.get(key)
        if data:
            try:
                flat = np.frombuffer(data, dtype=np.float64)
                n_channels = len(flat) // n_samples
                arr = flat.reshape(n_samples, n_channels)
                logger.debug(f"AlignedSeriesCache HIT: {key}, shape={arr.shape}")
                return arr
            except Exception as e:
                logger.warning(f"AlignedSeriesCache 解析失败: {key}, {e}")
                self.redis.delete(key)
        return None

    def set(
        self,
        sample_id: int,
        method: InterpolationMethod,
        n_samples: int,
        series_data: np.ndarray,
        ttl: int | None = None,
    ) -> bool:
        """缓存对齐序列数据
        
        Args:
            sample_id: 样本 ID
            method: 插值方法
            n_samples: 采样点数
            series_data: 对齐序列数据 (n_samples, n_channels)
            ttl: 过期时间（秒），None 使用默认值
            
        Returns:
            是否成功
        """
        key = self._key(sample_id, method, n_samples)
        try:
            if len(series_data.shape) != 2 or series_data.shape[0] != n_samples:
                logger.warning(f"AlignedSeriesCache 形状不匹配: {series_data.shape}, 期望 ({n_samples}, ?)")
                return False
            
            data = series_data.astype(np.float64).tobytes()
            self.redis.setex(key, ttl or self.default_ttl, data)
            logger.debug(f"AlignedSeriesCache SET: {key} shape={series_data.shape} ({len(data)} bytes)")
            return True
        except Exception as e:
            logger.error(f"AlignedSeriesCache SET 失败: {key}, {e}")
            return False

    def get_by_key(
        self,
        key: str,
        n_samples: int,
        n_channels: int,
    ) -> np.ndarray | None:
        """通过自定义 key 获取缓存（用于 phase_names 模式）"""
        full_key = f"aligned_series:{key}"
        data = self.redis.get(full_key)
        if data:
            try:
                flat = np.frombuffer(data, dtype=np.float64)
                if len(flat) == n_samples * n_channels:
                    arr = flat.reshape(n_samples, n_channels)
                    logger.debug(f"AlignedSeriesCache HIT (by_key): {full_key}, shape={arr.shape}")
                    return arr
                else:
                    logger.info(f"AlignedSeriesCache STALE (by_key): {full_key}, expected {n_samples*n_channels}, got {len(flat)}")
                    self.redis.delete(full_key)
            except Exception as e:
                logger.warning(f"AlignedSeriesCache 解析失败 (by_key): {full_key}, {e}")
                self.redis.delete(full_key)
        return None

    def set_by_key(
        self,
        key: str,
        series_data: np.ndarray,
        n_samples: int,
        ttl: int | None = None,
    ) -> bool:
        """通过自定义 key 缓存对齐序列数据（用于 phase_names 模式）"""
        full_key = f"aligned_series:{key}"
        try:
            if len(series_data.shape) != 2 or series_data.shape[0] != n_samples:
                logger.warning(f"AlignedSeriesCache 形状不匹配 (by_key): {series_data.shape}, 期望 ({n_samples}, ?)")
                return False
            data = series_data.astype(np.float64).tobytes()
            self.redis.setex(full_key, ttl or self.default_ttl, data)
            logger.debug(f"AlignedSeriesCache SET (by_key): {full_key} shape={series_data.shape}")
            return True
        except Exception as e:
            logger.error(f"AlignedSeriesCache SET 失败 (by_key): {full_key}, {e}")
            return False

    def delete(
        self,
        sample_id: int,
        method: InterpolationMethod,
        n_samples: int,
    ) -> bool:
        """删除指定缓存"""
        key = self._key(sample_id, method, n_samples)
        try:
            self.redis.delete(key)
            logger.debug(f"AlignedSeriesCache DELETE: {key}")
            return True
        except Exception:
            return False

    def invalidate(self, sample_id: int) -> int:
        """使 sample 的所有缓存失效
        
        Args:
            sample_id: 样本 ID
            
        Returns:
            删除的 key 数量
        """
        pattern = f"aligned_series:{sample_id}:*"
        count = 0
        for key in self.redis.scan_iter(pattern):
            self.redis.delete(key)
            count += 1
        if count > 0:
            logger.info(f"AlignedSeriesCache 失效: sample_id={sample_id}, 删除 {count} 个缓存")
        return count

    def get_status(self, sample_id: int) -> dict:
        """获取 sample 的对齐序列缓存状态
        
        Args:
            sample_id: 样本 ID
            
        Returns:
            状态字典，包含 cached 和 variants
        """
        pattern = f"aligned_series:{sample_id}:*"
        keys = list(self.redis.scan_iter(pattern))
        variants = []
        for key in keys:
            # key 格式: aligned_series:{sample_id}:{method}:{n_samples}
            parts = key.decode() if isinstance(key, bytes) else key
            parts = parts.split(":")
            if len(parts) == 4:
                variants.append({
                    "method": parts[2],
                    "nSamples": int(parts[3]),
                })
        return {
            "cached": len(keys) > 0,
            "variants": variants,
        }

    def get_status_batch(
        self,
        sample_ids: list[int],
        methods: list[str] = ("pchip", "linear"),
        n_samples_list: list[int] = (100, 50),
    ) -> dict[int, dict]:
        """批量检查多个 sample 的对齐序列缓存状态

        使用 Redis pipeline EXISTS 替代逐个 SCAN，O(1) per key。
        
        Args:
            sample_ids: 样本 ID 列表
            methods: 要检查的插值方法列表
            n_samples_list: 要检查的采样点数列表
            
        Returns:
            {sample_id: {"cached": bool, "variants": [{"method": str, "nSamples": int}]}}
        """
        if not sample_ids:
            return {}

        # 构建所有要检查的 key
        keys = []
        key_info = []  # (sample_id, method, n_samples)
        for sid in sample_ids:
            for method in methods:
                for ns in n_samples_list:
                    k = self._key(sid, method, ns)
                    keys.append(k)
                    key_info.append((sid, method, ns))

        # 单次 pipeline 批量 EXISTS
        pipe = self.redis.pipeline(transaction=False)
        for k in keys:
            pipe.exists(k)
        try:
            results = pipe.execute()
        except Exception as e:
            logger.warning(f"get_status_batch pipeline 失败: {e}")
            return {sid: {"cached": False, "variants": []} for sid in sample_ids}

        # 汇总结果
        status_map: dict[int, dict] = {sid: {"cached": False, "variants": []} for sid in sample_ids}
        for i, exists in enumerate(results):
            if exists:
                sid, method, ns = key_info[i]
                status_map[sid]["cached"] = True
                status_map[sid]["variants"].append({"method": method, "nSamples": ns})

        return status_map

    def get_all_sample_ids(self) -> list[int]:
        """获取所有有缓存的 sample_id"""
        pattern = "aligned_series:*"
        sample_ids = set()
        for key in self.redis.scan_iter(pattern):
            parts = (key.decode() if isinstance(key, bytes) else key).split(":")
            if len(parts) >= 2:
                try:
                    sample_ids.add(int(parts[1]))
                except ValueError:
                    pass
        return sorted(sample_ids)

    def clear_all(self) -> int:
        """清除所有对齐序列缓存"""
        pattern = "aligned_series:*"
        count = 0
        for key in self.redis.scan_iter(pattern):
            self.redis.delete(key)
            count += 1
        logger.info(f"AlignedSeriesCache 清除所有缓存: {count} 个")
        return count

    def health_check(self) -> bool:
        """健康检查"""
        try:
            return self.redis.ping()
        except Exception:
            return False
