"""全局配置 — 路径、超参、茶名映射、图表样式。

所有实验共享此配置，修改此文件即可控制全局行为。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# ═══════════════════════════════════════════════════════════════
# 路径
# ═══════════════════════════════════════════════════════════════

SCRIPTS_DIR = Path(__file__).resolve().parent.parent        # enose-analytics/scripts/
PROJECT_DIR = SCRIPTS_DIR.parent                             # enose-analytics/
CONFIG_DIR  = PROJECT_DIR / "config"

RESULTS_DIR = SCRIPTS_DIR / "paper_experiments" / "results"
FIGURES_DIR = RESULTS_DIR / "figures"
TABLES_DIR  = RESULTS_DIR / "tables"
CACHE_DIR   = SCRIPTS_DIR / "cache" / "paper"

# ═══════════════════════════════════════════════════════════════
# 随机种子
# ═══════════════════════════════════════════════════════════════

SEED = 42

# ═══════════════════════════════════════════════════════════════
# 传感器 & 对齐
# ═══════════════════════════════════════════════════════════════

N_SENSORS = 8
GOOD_SENSORS = list(range(N_SENSORS))   # value 通道在 aligned (N,T,32) 的 col 0-7
N_ALIGN_STEPS = 100                     # PCHIP 对齐后时间步数
DEFAULT_CUTOFF_S = 80.0                 # 默认截断秒数 (匹配 80s acquire)

# ═══════════════════════════════════════════════════════════════
# Runs
# ═══════════════════════════════════════════════════════════════

PURE_RUNS = [99, 101, 102, 103, 104, 106]
MIX_RUNS  = [105, 108, 111, 112]
ALL_RUNS  = PURE_RUNS + MIX_RUNS

# ═══════════════════════════════════════════════════════════════
# 茶名映射
# ═══════════════════════════════════════════════════════════════

# DB 中的原始名称 → 论文简称 (英文)
TEA_NAME_EN: dict[str, str] = {
    "东方树叶-乌龙茶":   "Oolong",
    "东方树叶-红茶":     "Black",
    "东方树叶-茉莉花茶": "Jasmine",
    "东方树叶-青柑普洱":  "XQG Pu-erh",
    "东方树叶-黑乌龙":   "Dark",
}

# DB 中的原始名称 → 论文简称 (中文)
TEA_NAME_CN: dict[str, str] = {
    "东方树叶-乌龙茶":   "乌龙",
    "东方树叶-红茶":     "红茶",
    "东方树叶-茉莉花茶": "茉莉",
    "东方树叶-青柑普洱":  "普洱",
    "东方树叶-黑乌龙":   "黑乌龙",
}

# 论文中的标准编号
TEA_IDS: dict[str, str] = {
    "东方树叶-乌龙茶":   "T1",
    "东方树叶-红茶":     "T2",
    "东方树叶-茉莉花茶": "T3",
    "东方树叶-青柑普洱":  "T4",
    "东方树叶-黑乌龙":   "T5",
}

# 有序茶名列表 (按 T1-T5 排列)
TEA_ORDER = [
    "东方树叶-乌龙茶",
    "东方树叶-红茶",
    "东方树叶-茉莉花茶",
    "东方树叶-青柑普洱",
    "东方树叶-黑乌龙",
]


def tea_label(raw_name: str) -> str:
    """DB 原始名 → 论文标签, e.g. 'T1 Oolong'"""
    tid = TEA_IDS.get(raw_name, "T?")
    en = TEA_NAME_EN.get(raw_name, raw_name)
    return f"{tid} {en}"


def tea_short(raw_name: str) -> str:
    """DB 原始名 → 英文简称"""
    return TEA_NAME_EN.get(raw_name, raw_name)


def combo_label(names: list[str]) -> str:
    """二元组合标签, e.g. 'T1-T3'"""
    ids = sorted(TEA_IDS.get(n, "T?") for n in names)
    return "-".join(ids)


# ═══════════════════════════════════════════════════════════════
# 二元组合定义 (C(5,2)=10)
# ═══════════════════════════════════════════════════════════════

from itertools import combinations
BINARY_COMBOS: list[tuple[str, str]] = list(combinations(TEA_ORDER, 2))
BINARY_COMBO_LABELS: list[str] = [
    f"{TEA_IDS[a]}-{TEA_IDS[b]}" for a, b in BINARY_COMBOS
]

# 混合比例步 (论文定义: 11 步, 0.0 到 1.0)
RATIO_STEPS = [round(r / 10, 1) for r in range(11)]  # [0.0, 0.1, ..., 1.0]

# ═══════════════════════════════════════════════════════════════
# 图表样式
# ═══════════════════════════════════════════════════════════════

FIGURE_DPI = 300
FIGURE_FORMAT = "pdf"       # 论文用 pdf, 预览用 png
FONT_SIZE = 10
FONT_FAMILY = "serif"

# 每种茶的颜色 (适合色觉障碍的配色)
TEA_COLORS: dict[str, str] = {
    "T1": "#E69F00",  # 橙黄 (Oolong)
    "T2": "#D55E00",  # 朱红 (Black)
    "T3": "#009E73",  # 青绿 (Jasmine)
    "T4": "#0072B2",  # 蓝色 (XQG Pu-erh)
    "T5": "#CC79A7",  # 粉紫 (Dark)
}

TEA_MARKERS: dict[str, str] = {
    "T1": "o",
    "T2": "s",
    "T3": "^",
    "T4": "D",
    "T5": "v",
}

# ═══════════════════════════════════════════════════════════════
# ML/DL 超参
# ═══════════════════════════════════════════════════════════════

N_CV_FOLDS = 5
SVM_C = 10.0
RF_N_ESTIMATORS = 100
GBM_N_ESTIMATORS = 100
GBM_MAX_DEPTH = 3

# CARL 超参
CARL_EMBED_DIM = 128
CARL_LR = 1e-3
CARL_EPOCHS = 200
CARL_BATCH_SIZE = 64
CARL_TEMPERATURE = 0.07
CARL_RATIO_TOLERANCE = 0.1   # 正样本比例容差

# ═══════════════════════════════════════════════════════════════
# 工具函数
# ═══════════════════════════════════════════════════════════════

def ensure_dirs():
    """确保所有输出目录存在"""
    for d in [RESULTS_DIR, FIGURES_DIR, TABLES_DIR, CACHE_DIR]:
        d.mkdir(parents=True, exist_ok=True)
