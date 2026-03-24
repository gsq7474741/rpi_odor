"""全局配置 — 数据库、传感器、Run、路径、截断参数等。"""

from __future__ import annotations

import yaml
from dataclasses import dataclass, field
from pathlib import Path


# ═══════════════════════════════════════════════════════════════
# 路径
# ═══════════════════════════════════════════════════════════════

SCRIPTS_DIR = Path(__file__).parent.parent          # enose-analytics/scripts/
PROJECT_DIR = SCRIPTS_DIR.parent                     # enose-analytics/
CONFIG_DIR  = PROJECT_DIR / "config"
CACHE_DIR   = SCRIPTS_DIR / "cache" / "truncation"   # 本地缓存目录
RESULTS_DIR = SCRIPTS_DIR / "results" / "truncation"  # 结果输出目录


# ═══════════════════════════════════════════════════════════════
# 传感器
# ═══════════════════════════════════════════════════════════════

GOOD_SENSORS = list(range(8))   # Run 105+ 所有 8 传感器均为常温配置
N_ALIGN_STEPS = 100             # PCHIP 对齐后时间步数
SEED = 42

# ═══════════════════════════════════════════════════════════════
# 截断参数
# ═══════════════════════════════════════════════════════════════

TRUNCATION_SECONDS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]

# ═══════════════════════════════════════════════════════════════
# Runs
# ═══════════════════════════════════════════════════════════════

PURE_RUNS = [99, 101, 102, 103, 104, 106]
MIX_RUNS  = [105, 108]
ALL_RUNS  = PURE_RUNS + MIX_RUNS

# ═══════════════════════════════════════════════════════════════
# 液体简称
# ═══════════════════════════════════════════════════════════════

SHORT_NAMES = {
    "东方树叶-乌龙茶": "乌龙",
    "东方树叶-红茶":   "红茶",
    "东方树叶-茉莉花茶": "茉莉",
    "东方树叶-青柑普洱": "普洱",
    "东方树叶-黑乌龙":  "黑乌龙",
}

def short(name: str) -> str:
    return SHORT_NAMES.get(name, name)


# ═══════════════════════════════════════════════════════════════
# 数据库
# ═══════════════════════════════════════════════════════════════

def load_db_dsn() -> str:
    """从 analytics.yaml 加载数据库 DSN"""
    cfg_path = CONFIG_DIR / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


# ═══════════════════════════════════════════════════════════════
# 确保目录存在
# ═══════════════════════════════════════════════════════════════

def ensure_dirs():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
