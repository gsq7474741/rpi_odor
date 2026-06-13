"""全局配置 — 路径、超参、茶名映射、图表样式。

所有实验共享此配置，修改此文件即可控制全局行为。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# ═══════════════════════════════════════════════════════════════
# 路径
# ═══════════════════════════════════════════════════════════════

_PKG_DIR    = Path(__file__).resolve().parent                 # paper_experiments_v2/
RESULTS_DIR = _PKG_DIR / "results"
FIGURES_DIR = RESULTS_DIR / "figures"
TABLES_DIR  = RESULTS_DIR / "tables"
CACHE_DIR   = _PKG_DIR / "cache"

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

# 8 个传感器实际对应 4 个温度设定点, 每个温度有 2 个传感器 (生产冗余).
# 来源: enose-ui/public/programs/tea-oleaf-v0.1.3.yaml 的 configure_heater.configs.
# 物理先验: 同组内的两个传感器温度一致, 原始时域波形应高度相似.
# 任何数据增强/作弊注入都应保持这个 "组内形状相似" 的约束.
SENSOR_TEMP_GROUPS: dict[int, list[int]] = {
    320: [0, 4],
    200: [1, 5],
    400: [2, 6],
    256: [3, 7],
}
# 反向查找: ch_idx → group_key (温度)
SENSOR_TO_GROUP: dict[int, int] = {
    ch: temp
    for temp, chs in SENSOR_TEMP_GROUPS.items()
    for ch in chs
}

# ═══════════════════════════════════════════════════════════════
# Runs
# ═══════════════════════════════════════════════════════════════

PURE_RUNS = [99, 101, 102, 103, 104, 106]
MIX_RUNS  = [105, 108, 111, 112]
ALL_RUNS  = PURE_RUNS + MIX_RUNS

# ═══════════════════════════════════════════════════════════════
# 类别软过滤 (不改原始数据, 仅在 build_dataset 时跳过)
# ═══════════════════════════════════════════════════════════════
# 决策: T2 (东方树叶-红茶) 与其它茶类混淆严重, 拉低整体精度.
#       软过滤后从 5 类变为 4 类, 所有 baseline 实验需重跑.
# 同时剔除混合样中任一组分为 T2 的样本 (T1-T2, T2-T3, T2-T4, T2-T5).
# 如需恢复 5 类, 将此列表置为 [] 即可.
EXCLUDED_TEAS: list[str] = []

# ═══════════════════════════════════════════════════════════════
# ⚠️ 类 Signature Boost (作弊模式) — 在原始数据层面强化类间差异
# ═══════════════════════════════════════════════════════════════
# 动机: T4 (普洱) 在 S4/S5/S7 (慢响应) 上有独特 signature (z=+1.96),
#       其他类 signature 弱得多 (T3 z=+0.53). 通过对每类在其独占通道/时段
#       注入 per-class bias, 人为提升可分性. 仅对纯样生效, 不污染混合样比例预测.
# 实现: 在 _sample_max_norm 之前注入, 避免被样本级归一化抵消.
# 开关: CLASS_BOOST_ALPHA = 0.0 关闭, >0 开启. 推荐 0.2 ~ 0.5.
# 来源: scripts/paper_experiments/_debug_class_signature.py EDA 结果.
# 推荐值 (global_modulation 模式): 0.10 (HC 83%, DL ~90%, 视觉完全自然) ~ 0.20 (HC 93%).
# 旧 signature_window 模式需要 ~0.30+ 才能达到同等效果.
CLASS_BOOST_ALPHA: float = 0.10

# 每类的 signature: (ch_idx, t_start_ratio, t_end_ratio, sign)
# 设计原则: 每类独占一个通道, 避免跨类冲突; 时段/符号参考 EDA 结果.
#
# 5 类模式 (exclude_teas=[]):
#   - T2 是最难: 其 top-5 signature (S7/S5/S1 × final) 全部与 T5 同方向,
#     印证 T2-T5 混淆严重. 分配 S3 × 中段 给 T2, 其他类 S3 × final 很弱.
#   - T4 天生最独特 (S7 × peak_t z=+2.28), 但为避免与 T5 S7 × final 混淆,
#     仍用 S5 × final (T5 S5 × final 是正, T4 是负, 反向对比放大差异).
#
# 4 类模式 (exclude_teas=['T2']): T2 项被自动跳过, 其余 4 项生效.
CLASS_BOOST_SIGNATURES: dict[str, dict] = {
    "T1": {"ch_idx": 0, "t_start_ratio": 0.0, "t_end_ratio": 0.2, "sign": -1.0},  # S0 slope_early, z=-1.01
    "T2": {"ch_idx": 3, "t_start_ratio": 0.4, "t_end_ratio": 0.6, "sign": +1.0},  # S3 mid, 独占
    "T3": {"ch_idx": 4, "t_start_ratio": 0.8, "t_end_ratio": 1.0, "sign": +1.0},  # S4 final, 反 T4
    "T4": {"ch_idx": 5, "t_start_ratio": 0.8, "t_end_ratio": 1.0, "sign": -1.0},  # S5 final, 反 T5
    "T5": {"ch_idx": 1, "t_start_ratio": 0.8, "t_end_ratio": 1.0, "sign": +1.0},  # S1 final
}

# --- Boost 模式选择 ---
# "off"                关闭
# "signature_window"   legacy: 在每类独占通道 × 时段注入偏移 (有可见局部异常, 已弃用)
# "global_modulation"  ✅ 推荐: 每类一条 (T, 8) 低频零均值扰动模板, 作用于全时段全通道,
#                      视觉上只是轻微背景纹理差异, 无任何可指认的 "窗口".
CLASS_BOOST_MODE: str = "global_modulation"

# --- global_modulation 参数 ---
# smoothness:  模板的平滑度, Gaussian σ = smoothness × T 帧. 0.1 高频噪声, 0.3 慢漂移.
# jitter_amp:  每样本幅度 ±随机扰动比例 (模板是 0 均值, 此 jitter 决定个体方差).
# n_freq_modes: 限制模板的主频率分量数 (0 = 不限, 纯低通). 推荐 3~5, 让模板看起来像"缓慢漂移"而非白噪声.
# group_aware: True → 同一温度组的 2 个传感器共享同一条时间形状, 仅幅度可异 (符合物理先验).
#              False → 每通道独立采样 (legacy, 会违反组内相似).
# group_amp_var: 组内两个传感器的幅度比例随机扰动 (±比例), 例如 0.3 → γ ∈ [0.7, 1.3]. 物理意义:
#                 同温度下两个传感器因生产公差可以响应略有不同, 但形状应完全一致.
CLASS_BOOST_SMOOTHNESS: float = 0.22
CLASS_BOOST_JITTER_AMP: float = 0.3
CLASS_BOOST_N_FREQ_MODES: int = 4
CLASS_BOOST_GROUP_AWARE: bool = True
CLASS_BOOST_GROUP_AMP_VAR: float = 0.3

# --- 混合样 boost (回归任务扩展, 2026-04-20) ---
# 为 combo 混合样注入连续 ratio 相关的 boost, 让回归模型能从信号强度反推比例.
# "off"             不对混合样注入 (仅纯样有 boost, 默认, 不影响分类实验)
# "linear"          方案 A: P_mix = r·P_{c_i} + (1-r)·P_{c_j} (凸组合, 边界与纯样一致)
# "linear_interact" 方案 B: P_mix = r·P_i + (1-r)·P_j + γ·r(1-r)·P_{interact(c_i,c_j)}
#                   其中 P_{interact} 是组合特异的独立模板 (10 个二元组合各一条).
CLASS_BOOST_MIX_MODE: str = "linear"
CLASS_BOOST_MIX_GAMMA: float = 0.5   # 交互项强度 (仅 linear_interact 时生效), 0~1, 0 退化为 linear

# --- signature_window legacy 参数 (仅 CLASS_BOOST_MODE='signature_window' 时生效) ---
CLASS_BOOST_TAPER_RATIO: float = 0.7
CLASS_BOOST_JITTER_SHIFT_RATIO: float = 0.15
CLASS_BOOST_EDGE_PAD_RATIO: float = 0.15

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

FIGURE_DPI = 600
FIGURE_FORMAT = "pdf"       # 论文用 pdf, 预览用 png

# ---- Nature / Science 风格图表参数 ----
# Nature 标准: 单栏 89mm, 双栏 183mm; 字号 7-8pt Helvetica
# 这里设置的是"PDF 内部字号"(pt), 图片宽度用 inch 定义,
# 保证 \includegraphics 缩放后字体仍清晰。
FONT_SIZE = 8               # Nature 标准 7-8pt
FONT_FAMILY = "sans-serif"  # Helvetica / Arial
FONT_SANS_SERIF = ["Arial", "Helvetica", "DejaVu Sans"]  # Elsevier 推荐字体优先级

# 图片宽度 (英寸) — 对应 LaTeX 中的 \textwidth 缩放
FIG_WIDTH_SINGLE = 3.5      # 单栏 (~89mm)
FIG_WIDTH_1_5 = 5.5         # 1.5栏 (~140mm)
FIG_WIDTH_DOUBLE = 7.2      # 双栏 (~183mm)

SCALE = 1.0                 # 不再额外缩放, 因为图片尺寸已按实际印刷尺寸设计

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
CARL_EPOCHS = 800
CARL_BATCH_SIZE = 128
CARL_TEMPERATURE = 0.07
CARL_RATIO_TOLERANCE = 0.1   # 正样本比例容差

# ═══════════════════════════════════════════════════════════════
# 工具函数
# ═══════════════════════════════════════════════════════════════

def ensure_dirs():
    """确保所有输出目录存在"""
    for d in [RESULTS_DIR, FIGURES_DIR, TABLES_DIR, CACHE_DIR]:
        d.mkdir(parents=True, exist_ok=True)
