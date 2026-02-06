"""Normalized Frames Redis 缓存"""

from typing import Literal

import numpy as np
import redis

from ..config import get_settings
from ..logger import logger


InterpolationMethod = Literal["linear", "pchip"]


class FrameCache:
    """归一化帧 Redis 缓存
    
    缓存 key 格式: frames:{sample_id}:{method}:{n_samples}
    缓存 value: numpy array 的 bytes 表示
    """

    def __init__(self, redis_url: str | None = None):
        settings = get_settings()
        url = redis_url or settings.redis.url
        self.redis = redis.from_url(url, decode_responses=False)
        self.default_ttl = settings.redis.default_ttl
        logger.info(f"FrameCache 初始化: {url}")

    def _key(self, sample_id: int, method: str, n_samples: int) -> str:
        """生成缓存 key"""
        return f"frames:{sample_id}:{method}:{n_samples}"

    def get(
        self,
        sample_id: int,
        method: InterpolationMethod,
        n_samples: int,
    ) -> np.ndarray | None:
        """获取缓存的帧数据
        
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
                logger.debug(f"FrameCache HIT: {key}, shape={arr.shape}")
                return arr
            except Exception as e:
                logger.warning(f"FrameCache 解析失败: {key}, {e}")
                self.redis.delete(key)
        return None

    def set(
        self,
        sample_id: int,
        method: InterpolationMethod,
        n_samples: int,
        frames: np.ndarray,
        ttl: int | None = None,
    ) -> bool:
        """缓存帧数据
        
        Args:
            sample_id: 样本 ID
            method: 插值方法
            n_samples: 采样点数
            frames: 帧数据 (n_samples, n_channels)
            ttl: 过期时间（秒），None 使用默认值
            
        Returns:
            是否成功
        """
        key = self._key(sample_id, method, n_samples)
        try:
            if len(frames.shape) != 2 or frames.shape[0] != n_samples:
                logger.warning(f"FrameCache 形状不匹配: {frames.shape}, 期望 ({n_samples}, ?)")
                return False
            
            data = frames.astype(np.float64).tobytes()
            self.redis.setex(key, ttl or self.default_ttl, data)
            logger.debug(f"FrameCache SET: {key} shape={frames.shape} ({len(data)} bytes)")
            return True
        except Exception as e:
            logger.error(f"FrameCache SET 失败: {key}, {e}")
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
            logger.debug(f"FrameCache DELETE: {key}")
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
        pattern = f"frames:{sample_id}:*"
        count = 0
        for key in self.redis.scan_iter(pattern):
            self.redis.delete(key)
            count += 1
        if count > 0:
            logger.info(f"FrameCache 失效: sample_id={sample_id}, 删除 {count} 个缓存")
        return count

    def get_status(self, sample_id: int) -> dict:
        """获取 sample 的帧缓存状态
        
        Args:
            sample_id: 样本 ID
            
        Returns:
            状态字典，包含 cached 和 variants
        """
        pattern = f"frames:{sample_id}:*"
        keys = list(self.redis.scan_iter(pattern))
        variants = []
        for key in keys:
            # key 格式: frames:{sample_id}:{method}:{n_samples}
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

    def get_all_sample_ids(self) -> list[int]:
        """获取所有有缓存的 sample_id"""
        pattern = "frames:*"
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
        """清除所有帧缓存"""
        pattern = "frames:*"
        count = 0
        for key in self.redis.scan_iter(pattern):
            self.redis.delete(key)
            count += 1
        logger.info(f"FrameCache 清除所有缓存: {count} 个")
        return count

    def health_check(self) -> bool:
        """健康检查"""
        try:
            return self.redis.ping()
        except Exception:
            return False
