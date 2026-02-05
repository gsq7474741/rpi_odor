"""可视化结果 Redis 缓存"""

import hashlib
import json
from typing import Any

import redis

from ..config import get_settings
from ..logger import logger



class VisualizationCache:
    """降维可视化结果 Redis 缓存
    
    缓存 key 格式: vis:{hash(sample_ids + params)}
    缓存 value: JSON 序列化的可视化结果
    """

    def __init__(self, redis_url: str | None = None):
        settings = get_settings()
        url = redis_url or settings.redis.url
        self.redis = redis.from_url(url, decode_responses=True)
        self.default_ttl = settings.redis.default_ttl
        logger.info(f"VisualizationCache 初始化: {url}")

    def _cache_key(
        self,
        sample_ids: list[int],
        vis_type: str,
        n_components: int,
        n_clusters: int,
        perplexity: int,
    ) -> str:
        """生成缓存 key"""
        # 排序 sample_ids 确保顺序无关
        sorted_ids = sorted(sample_ids)
        key_data = {
            "sample_ids": sorted_ids,
            "vis_type": vis_type,
            "n_components": n_components,
            "n_clusters": n_clusters,
            "perplexity": perplexity,
        }
        key_json = json.dumps(key_data, sort_keys=True)
        key_hash = hashlib.md5(key_json.encode()).hexdigest()[:16]
        return f"vis:{key_hash}"

    def get(
        self,
        sample_ids: list[int],
        vis_type: str,
        n_components: int,
        n_clusters: int,
        perplexity: int,
    ) -> dict[str, Any] | None:
        """获取缓存的可视化结果
        
        Returns:
            可视化结果字典或 None
        """
        key = self._cache_key(sample_ids, vis_type, n_components, n_clusters, perplexity)
        data = self.redis.get(key)
        if data:
            try:
                result = json.loads(data)
                logger.debug(f"VisualizationCache HIT: {key}")
                return result
            except Exception as e:
                logger.warning(f"VisualizationCache 解析失败: {key}, {e}")
                self.redis.delete(key)
        return None

    def set(
        self,
        sample_ids: list[int],
        vis_type: str,
        n_components: int,
        n_clusters: int,
        perplexity: int,
        result: dict[str, Any],
        ttl: int | None = None,
    ) -> bool:
        """缓存可视化结果
        
        Returns:
            是否成功
        """
        key = self._cache_key(sample_ids, vis_type, n_components, n_clusters, perplexity)
        try:
            data = json.dumps(result, default=str)
            self.redis.setex(key, ttl or self.default_ttl, data)
            logger.debug(f"VisualizationCache SET: {key}")
            return True
        except Exception as e:
            logger.error(f"VisualizationCache SET 失败: {key}, {e}")
            return False

    def invalidate_by_sample(self, sample_id: int) -> int:
        """使包含指定 sample 的缓存失效（需要全量扫描，慎用）"""
        # 由于 key 是哈希的，无法直接根据 sample_id 查找
        # 实际使用中，可以通过设置较短的 TTL 来实现自动失效
        logger.warning(f"VisualizationCache: invalidate_by_sample({sample_id}) 不支持精确失效")
        return 0

    def clear_all(self) -> int:
        """清除所有可视化缓存"""
        pattern = "vis:*"
        count = 0
        for key in self.redis.scan_iter(pattern):
            self.redis.delete(key)
            count += 1
        logger.info(f"VisualizationCache 清除所有缓存: {count} 个")
        return count

    def health_check(self) -> bool:
        """健康检查"""
        try:
            return self.redis.ping()
        except Exception:
            return False
