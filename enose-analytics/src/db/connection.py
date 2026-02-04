"""数据库连接池管理"""

import logging
from contextlib import contextmanager
from typing import Generator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from ..config import get_settings

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    """获取数据库连接池"""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = ConnectionPool(
            conninfo=settings.database.dsn,
            min_size=1,
            max_size=settings.database.pool_size,
            kwargs={"row_factory": dict_row},
        )
        logger.info(f"Database pool created: {settings.database.host}:{settings.database.port}")
    return _pool


def close_pool() -> None:
    """关闭数据库连接池"""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
        logger.info("Database pool closed")


@contextmanager
def get_connection() -> Generator[psycopg.Connection, None, None]:
    """获取数据库连接 (上下文管理器)"""
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


@contextmanager
def get_cursor() -> Generator[psycopg.Cursor, None, None]:
    """获取数据库游标 (上下文管理器)，自动提交事务"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
