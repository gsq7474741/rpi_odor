"""帧自动预热任务

混合方案：
1. PG LISTEN/NOTIFY：样本完成时实时响应，立即生成帧到 Redis 缓存
2. 定时轮询兜底：每隔 N 分钟扫描最近完成的样本，预热 Redis 缓存

注意：不再写入 normalized_frames / normalized_frames_meta 表，仅预热 Redis 缓存
默认帧配置：nSamples=100, methods=["linear", "pchip"]
"""

import json
import select
import threading
import time
from typing import Literal

import psycopg

from ..cache.frame_cache import FrameCache
from ..config import get_settings
from ..db.connection import get_cursor
from ..db.frame_normalizer import FrameNormalizer, InterpolationMethod
from ..logger import logger


class FrameBackfillTask:
    """帧 Redis 缓存预热后台任务

    启动两个守护线程：
    - listener_thread: PG LISTEN 实时监听 sample_completed 通知
    - poller_thread: 定时轮询预热最近完成样本的 Redis 缓存
    """

    def __init__(
        self,
        n_samples: int = 100,
        methods: list[InterpolationMethod] | None = None,
        poll_interval_s: int = 300,
        batch_size: int = 50,
    ):
        self.n_samples = n_samples
        self.methods: list[InterpolationMethod] = methods or ["linear", "pchip"]
        self.poll_interval_s = poll_interval_s
        self.batch_size = batch_size

        self._normalizer = FrameNormalizer()
        self._stop_event = threading.Event()
        self._listener_thread: threading.Thread | None = None
        self._poller_thread: threading.Thread | None = None
        self._stats = {
            "listener_generated": 0,
            "poller_generated": 0,
            "listener_errors": 0,
            "poller_errors": 0,
            "last_poll_time": None,
            "last_notify_time": None,
        }

    # ============================================================
    # 公共接口
    # ============================================================

    def start(self) -> None:
        """启动后台任务"""
        logger.info(
            f"FrameBackfillTask 启动: n_samples={self.n_samples}, "
            f"methods={self.methods}, poll_interval={self.poll_interval_s}s"
        )

        self._stop_event.clear()

        self._listener_thread = threading.Thread(
            target=self._listen_loop,
            name="frame-backfill-listener",
            daemon=True,
        )
        self._listener_thread.start()

        self._poller_thread = threading.Thread(
            target=self._poll_loop,
            name="frame-backfill-poller",
            daemon=True,
        )
        self._poller_thread.start()

    def stop(self) -> None:
        """停止后台任务"""
        logger.info("FrameBackfillTask 停止中...")
        self._stop_event.set()

        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=10)
        if self._poller_thread and self._poller_thread.is_alive():
            self._poller_thread.join(timeout=10)

        logger.info(f"FrameBackfillTask 已停止. 统计: {self._stats}")

    def get_stats(self) -> dict:
        """获取运行统计"""
        return dict(self._stats)

    # ============================================================
    # PG LISTEN 实时监听
    # ============================================================

    def _listen_loop(self) -> None:
        """PG LISTEN 循环，监听 sample_completed 通道"""
        settings = get_settings()
        dsn = settings.database.dsn

        while not self._stop_event.is_set():
            try:
                self._do_listen(dsn)
            except Exception as e:
                logger.error(f"LISTEN 连接异常: {e}, 5s 后重连...")
                self._stats["listener_errors"] += 1
                # 等待 5s 重连，但可被 stop 中断
                self._stop_event.wait(5)

    def _do_listen(self, dsn: str) -> None:
        """建立 LISTEN 连接并处理通知"""
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute("LISTEN sample_completed")
            logger.info("LISTEN sample_completed 已注册")

            # 获取底层 socket fd 用于 select
            fd = conn.fileno()

            while not self._stop_event.is_set():
                # 使用 select 等待通知，超时 1s（可被 stop 中断）
                if select.select([fd], [], [], 1.0)[0]:
                    # 有通知到达
                    for notify in conn.notifies():
                        self._handle_notify(notify)

    def _handle_notify(self, notify: psycopg.Notify) -> None:
        """处理 sample_completed 通知"""
        try:
            payload = json.loads(notify.payload) if notify.payload else {}
            sample_id = payload.get("sample_id")

            if not sample_id:
                logger.warning(f"NOTIFY payload 缺少 sample_id: {notify.payload}")
                return

            logger.info(f"收到 sample_completed 通知: sample_id={sample_id}")
            self._stats["last_notify_time"] = time.time()

            self._generate_frames_for_sample(sample_id, source="listener")

        except json.JSONDecodeError:
            logger.warning(f"NOTIFY payload 解析失败: {notify.payload}")
        except Exception as e:
            logger.error(f"处理 NOTIFY 异常: {e}")
            self._stats["listener_errors"] += 1

    # ============================================================
    # 定时轮询兜底
    # ============================================================

    def _poll_loop(self) -> None:
        """定时轮询循环"""
        # 启动后先等待 30s，给 LISTEN 线程时间建立连接
        # 同时也避免服务启动时立即产生大量计算
        self._stop_event.wait(30)

        while not self._stop_event.is_set():
            try:
                self._do_poll()
            except Exception as e:
                logger.error(f"轮询异常: {e}")
                self._stats["poller_errors"] += 1

            # 等待下一次轮询
            self._stop_event.wait(self.poll_interval_s)

    def _do_poll(self) -> None:
        """执行一次轮询：查找缺失帧的已完成样本并生成"""
        self._stats["last_poll_time"] = time.time()

        missing_samples = self._find_samples_missing_frames()
        if not missing_samples:
            logger.debug("轮询: 所有已完成样本的帧均已生成")
            return

        logger.info(f"轮询: 发现 {len(missing_samples)} 个样本缺失帧，开始生成...")

        success = 0
        failed = 0
        for sample_id in missing_samples[:self.batch_size]:
            if self._stop_event.is_set():
                break
            try:
                self._generate_frames_for_sample(sample_id, source="poller")
                success += 1
            except Exception as e:
                logger.warning(f"轮询生成帧失败: sample_id={sample_id}, error={e}")
                failed += 1

        logger.info(
            f"轮询完成: 成功={success}, 失败={failed}, "
            f"剩余={max(0, len(missing_samples) - self.batch_size)}"
        )

    def _find_samples_missing_frames(self) -> list[int]:
        """查找已完成但 Redis 缓存中缺失帧的样本

        条件：
        1. samples.end_time_ms IS NOT NULL（样本已完成采集）
        2. Redis 中不存在对应的帧缓存
        """
        # 先从 DB 获取最近完成的样本
        query = """
            SELECT s.id
            FROM samples s
            WHERE s.end_time_ms IS NOT NULL
            ORDER BY s.id DESC
            LIMIT %s
        """

        with get_cursor() as cur:
            cur.execute(query, [self.batch_size * 4])
            rows = cur.fetchall()

        if not rows:
            return []

        # 检查 Redis 缓存，过滤出缺失的
        try:
            cache = FrameCache()
            if not cache.health_check():
                logger.debug("轮询: Redis 不可用，跳过")
                return []
        except Exception:
            return []

        missing = []
        for row in rows:
            sample_id = row["id"]
            status = cache.get_status(sample_id)
            cached_variants = status.get("variants", [])
            # 检查是否所有 method 都已缓存
            cached_methods = {v.get("method") for v in cached_variants}
            for method in self.methods:
                if method not in cached_methods:
                    missing.append(sample_id)
                    break

        return missing

    # ============================================================
    # 帧生成
    # ============================================================

    def _generate_frames_for_sample(
        self,
        sample_id: int,
        source: Literal["listener", "poller"] = "listener",
    ) -> None:
        """为单个样本生成所有默认配置的帧"""
        start = time.perf_counter()

        for method in self.methods:
            # get_normalized_frames_by_sample 会自动检查 Redis 缓存，缺失时生成
            frames, from_cache = self._normalizer.get_normalized_frames_by_sample(
                sample_id=sample_id,
                method=method,
                n_samples=self.n_samples,
                use_cache=True,
            )

            if frames is not None:
                if not from_cache:
                    logger.info(
                        f"[{source}] 生成帧: sample_id={sample_id}, "
                        f"method={method}, shape={frames.shape}"
                    )
            else:
                logger.warning(
                    f"[{source}] 生成帧失败: sample_id={sample_id}, method={method}"
                )

        elapsed = time.perf_counter() - start
        self._stats[f"{source}_generated"] += 1
        logger.debug(
            f"[{source}] sample_id={sample_id} 帧生成完成, 耗时 {elapsed:.2f}s"
        )
