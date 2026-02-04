"""依赖服务健康检查模块"""

import logging
import socket
from dataclasses import dataclass
from typing import Optional

from .config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class HealthCheckResult:
    """健康检查结果"""
    service: str
    healthy: bool
    latency_ms: Optional[float] = None
    error: Optional[str] = None

    def __str__(self) -> str:
        if self.healthy:
            latency = f" ({self.latency_ms:.1f}ms)" if self.latency_ms else ""
            return f"✓ {self.service}{latency}"
        else:
            return f"✗ {self.service}: {self.error}"


def check_tcp_connection(host: str, port: int, timeout: float = 5.0) -> tuple[bool, Optional[float], Optional[str]]:
    """检查 TCP 连接
    
    Returns:
        (connected, latency_ms, error_message)
    """
    import time
    
    start = time.perf_counter()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.close()
        latency = (time.perf_counter() - start) * 1000
        return True, latency, None
    except socket.timeout:
        return False, None, f"Connection timeout ({timeout}s)"
    except socket.gaierror as e:
        return False, None, f"DNS resolution failed: {e}"
    except ConnectionRefusedError:
        return False, None, "Connection refused"
    except OSError as e:
        return False, None, str(e)


def check_database() -> HealthCheckResult:
    """检查数据库连接"""
    settings = get_settings()
    db = settings.database
    
    # 先检查 TCP 连接
    connected, latency, error = check_tcp_connection(db.host, db.port)
    if not connected:
        return HealthCheckResult(
            service=f"PostgreSQL ({db.host}:{db.port})",
            healthy=False,
            error=error
        )
    
    # 尝试实际数据库连接
    import time
    start = time.perf_counter()
    try:
        import psycopg
        with psycopg.connect(
            host=db.host,
            port=db.port,
            dbname=db.database,
            user=db.user,
            password=db.password,
            connect_timeout=5
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        latency = (time.perf_counter() - start) * 1000
        return HealthCheckResult(
            service=f"PostgreSQL ({db.host}:{db.port}/{db.database})",
            healthy=True,
            latency_ms=latency
        )
    except Exception as e:
        return HealthCheckResult(
            service=f"PostgreSQL ({db.host}:{db.port}/{db.database})",
            healthy=False,
            error=str(e)
        )


def check_minio() -> HealthCheckResult:
    """检查 MinIO 连接"""
    settings = get_settings()
    minio = settings.minio
    
    # 解析 endpoint
    endpoint = minio.endpoint
    if ":" in endpoint:
        host, port_str = endpoint.rsplit(":", 1)
        port = int(port_str)
    else:
        host = endpoint
        port = 443 if minio.secure else 9000
    
    # TCP 连接检查
    connected, latency, error = check_tcp_connection(host, port)
    if not connected:
        return HealthCheckResult(
            service=f"MinIO ({endpoint})",
            healthy=False,
            error=error
        )
    
    # 尝试 MinIO API 连接
    import time
    start = time.perf_counter()
    try:
        from minio import Minio
        client = Minio(
            endpoint,
            access_key=minio.access_key,
            secret_key=minio.secret_key,
            secure=minio.secure
        )
        # 列出 buckets 验证连接
        list(client.list_buckets())
        latency = (time.perf_counter() - start) * 1000
        return HealthCheckResult(
            service=f"MinIO ({endpoint})",
            healthy=True,
            latency_ms=latency
        )
    except ImportError:
        # minio 库未安装，只返回 TCP 检查结果
        return HealthCheckResult(
            service=f"MinIO ({endpoint})",
            healthy=True,
            latency_ms=latency,
            error="(minio lib not installed, TCP only)"
        )
    except Exception as e:
        return HealthCheckResult(
            service=f"MinIO ({endpoint})",
            healthy=False,
            error=str(e)
        )


def check_control_service() -> HealthCheckResult:
    """检查 enose-control gRPC 服务"""
    settings = get_settings()
    ctrl = settings.control_service
    
    connected, latency, error = check_tcp_connection(ctrl.host, ctrl.port)
    return HealthCheckResult(
        service=f"enose-control ({ctrl.host}:{ctrl.port})",
        healthy=connected,
        latency_ms=latency,
        error=error
    )


def check_redis() -> HealthCheckResult:
    """检查 Redis 连接 (如果配置了)"""
    import os
    
    redis_host = os.environ.get("REDIS_HOST")
    if not redis_host:
        return HealthCheckResult(
            service="Redis",
            healthy=True,
            error="(not configured)"
        )
    
    redis_port = int(os.environ.get("REDIS_PORT", "6379"))
    
    connected, latency, error = check_tcp_connection(redis_host, redis_port)
    if not connected:
        return HealthCheckResult(
            service=f"Redis ({redis_host}:{redis_port})",
            healthy=False,
            error=error
        )
    
    # 尝试 Redis 连接
    import time
    start = time.perf_counter()
    try:
        import redis
        r = redis.Redis(host=redis_host, port=redis_port, socket_timeout=5)
        r.ping()
        latency = (time.perf_counter() - start) * 1000
        return HealthCheckResult(
            service=f"Redis ({redis_host}:{redis_port})",
            healthy=True,
            latency_ms=latency
        )
    except ImportError:
        return HealthCheckResult(
            service=f"Redis ({redis_host}:{redis_port})",
            healthy=True,
            latency_ms=latency,
            error="(redis lib not installed, TCP only)"
        )
    except Exception as e:
        return HealthCheckResult(
            service=f"Redis ({redis_host}:{redis_port})",
            healthy=False,
            error=str(e)
        )


def run_health_checks(required_only: bool = False) -> list[HealthCheckResult]:
    """运行所有健康检查
    
    Args:
        required_only: 只检查必需服务 (数据库)
    
    Returns:
        健康检查结果列表
    """
    results = []
    
    # 必需服务
    results.append(check_database())
    
    if not required_only:
        # 可选服务
        results.append(check_minio())
        results.append(check_control_service())
        results.append(check_redis())
    
    return results


def print_health_status(results: list[HealthCheckResult]) -> bool:
    """打印健康检查状态
    
    Returns:
        所有必需服务是否健康
    """
    logger.info("=" * 50)
    logger.info("Dependency Health Check")
    logger.info("=" * 50)
    
    all_required_healthy = True
    
    for result in results:
        if result.healthy:
            logger.info(str(result))
        else:
            # PostgreSQL 是必需的
            if "PostgreSQL" in result.service:
                logger.error(str(result))
                all_required_healthy = False
            else:
                logger.warning(str(result))
    
    logger.info("=" * 50)
    
    if all_required_healthy:
        logger.info("All required services are healthy")
    else:
        logger.error("Some required services are unhealthy!")
    
    return all_required_healthy
