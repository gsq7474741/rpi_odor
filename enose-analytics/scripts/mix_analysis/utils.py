"""工具模块 — 进度显示、日志、缓存、格式化输出。"""

from __future__ import annotations

import time
import logging
import numpy as np
from pathlib import Path
from dataclasses import dataclass, field
from tqdm import tqdm


# ═══════════════════════════════════════════════════════════════
# 日志
# ═══════════════════════════════════════════════════════════════

def setup_logging(name: str = "mix_analysis", level: int = logging.INFO) -> logging.Logger:
    """配置带时间戳的 logger"""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        fmt = logging.Formatter(
            "[%(asctime)s] %(levelname)-7s %(message)s",
            datefmt="%H:%M:%S",
        )
        handler.setFormatter(fmt)
        logger.addHandler(handler)
    logger.setLevel(level)
    return logger


log = setup_logging()


# ═══════════════════════════════════════════════════════════════
# 缓存
# ═══════════════════════════════════════════════════════════════

def save_cache(cache_dir: Path, name: str, **arrays) -> Path:
    """保存 numpy 数组到 .npz 缓存文件"""
    path = cache_dir / f"{name}.npz"
    np.savez_compressed(path, **arrays)
    size_mb = path.stat().st_size / 1024 / 1024
    log.info(f"缓存已保存: {path.name} ({size_mb:.1f} MB)")
    return path


def load_cache(cache_dir: Path, name: str) -> dict[str, np.ndarray] | None:
    """加载 .npz 缓存，不存在则返回 None"""
    path = cache_dir / f"{name}.npz"
    if not path.exists():
        return None
    data = dict(np.load(path, allow_pickle=True))
    size_mb = path.stat().st_size / 1024 / 1024
    log.info(f"缓存已加载: {path.name} ({size_mb:.1f} MB)")
    return data


def save_meta(cache_dir: Path, name: str, meta: list[dict]) -> Path:
    """保存元数据列表 (pickle-safe numpy)"""
    path = cache_dir / f"{name}_meta.npy"
    np.save(path, meta, allow_pickle=True)
    log.info(f"元数据已保存: {path.name} ({len(meta)} 条)")
    return path


def load_meta(cache_dir: Path, name: str) -> list[dict] | None:
    """加载元数据"""
    path = cache_dir / f"{name}_meta.npy"
    if not path.exists():
        return None
    meta = np.load(path, allow_pickle=True).tolist()
    log.info(f"元数据已加载: {path.name} ({len(meta)} 条)")
    return meta


# ═══════════════════════════════════════════════════════════════
# 进度显示
# ═══════════════════════════════════════════════════════════════

class StepTimer:
    """计时上下文管理器，用于跟踪每个分析步骤"""

    def __init__(self, description: str):
        self.description = description
        self.start_time = 0.0
        self.elapsed = 0.0

    def __enter__(self):
        log.info(f"▶ {self.description}")
        self.start_time = time.time()
        return self

    def __exit__(self, *args):
        self.elapsed = time.time() - self.start_time
        log.info(f"✓ {self.description} ({self.elapsed:.1f}s)")


def progress_bar(iterable, desc: str, **kwargs):
    """带描述的 tqdm 进度条"""
    return tqdm(iterable, desc=desc, ncols=80, **kwargs)


# ═══════════════════════════════════════════════════════════════
# 格式化输出
# ═══════════════════════════════════════════════════════════════

def print_header(title: str, width: int = 70):
    """打印带分隔线的标题"""
    print(f"\n{'=' * width}")
    print(f"  {title}")
    print(f"{'=' * width}")


def print_subheader(title: str, char: str = "─", width: int = 50):
    """打印子标题"""
    print(f"\n  {char * 3} {title} {char * 3}")


def print_table(headers: list[str], rows: list[list], col_widths: list[int] | None = None):
    """打印简单表格"""
    if col_widths is None:
        col_widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0)) + 2
                      for i, h in enumerate(headers)]

    header_str = "  " + "".join(f"{h:<{w}}" if i == 0 else f"{h:>{w}}"
                                for i, (h, w) in enumerate(zip(headers, col_widths)))
    print(header_str)
    print("  " + "-" * sum(col_widths))
    for row in rows:
        row_str = "  " + "".join(f"{str(v):<{w}}" if i == 0 else f"{str(v):>{w}}"
                                 for i, (v, w) in enumerate(zip(row, col_widths)))
        print(row_str)
