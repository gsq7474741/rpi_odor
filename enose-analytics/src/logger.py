"""统一日志模块 - 使用 loguru"""

import sys
from loguru import logger

from .config import get_settings


def setup_logger() -> None:
    """配置 loguru 日志"""
    settings = get_settings()
    
    # 移除默认 handler
    logger.remove()
    
    # 添加控制台输出
    logger.add(
        sys.stderr,
        level=settings.logging.level,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        colorize=True,
    )


# 导出 logger 供其他模块使用
__all__ = ["logger", "setup_logger"]
