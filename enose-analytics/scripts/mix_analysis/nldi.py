"""NLDI (Nonlinear Deviation Index) 计算模块。

NLDI 量化混合物传感器响应偏离线性可加性假设的程度：
  NLDI = mean_over(t,s) |R_actual(t,s) - R_predicted(t,s)| / |R_predicted(t,s)|
  其中 R_predicted = α·R_A + (1-α)·R_B
"""

from __future__ import annotations

import numpy as np
from collections import defaultdict
from dataclasses import dataclass, field

from .config import ExperimentConfig
from .data_loader import SampleMeta
from .features import baseline_normalize
from .utils import print_header, print_subheader, print_table


@dataclass
class NLDIResult:
    """单个组合的 NLDI 结果"""
    combo: tuple[str, str]
    overall_nldi: float
    interaction_type: str  # "近似可加" | "弱非线性" | "强非线性"
    per_alpha: dict[float, float] = field(default_factory=dict)  # alpha -> nldi

    @staticmethod
    def classify(nldi: float) -> str:
        if nldi < 0.05:
            return "近似可加"
        elif nldi < 0.15:
            return "弱非线性"
        else:
            return "强非线性"


def compute_nldi(
    X_raw: np.ndarray,
    meta: list[SampleMeta],
    exp: ExperimentConfig,
) -> list[NLDIResult]:
    """使用完整对齐序列计算所有二元组合的 NLDI。

    Args:
        X_raw: (N, T, 32) 对齐序列
        meta: 样本元数据
        exp: 实验配置

    Returns:
        按 NLDI 降序排列的结果列表
    """
    T = X_raw.shape[1]
    sensors = exp.sensor.active_sensors
    bl_ratio = exp.alignment.baseline_ratio

    # 提取 value 通道中活跃传感器，基线归一化
    X_val = X_raw[:, :, sensors]  # (N, T, n_s)
    X_norm = baseline_normalize(X_val, bl_ratio)

    # 索引纯样和混合样
    pure_indices: dict[str, list[int]] = defaultdict(list)
    binary_data: dict[tuple, dict[float, list[int]]] = defaultdict(lambda: defaultdict(list))

    for i, m in enumerate(meta):
        if m.is_pure and len(m.names) == 1:
            pure_indices[m.names[0]].append(i)
        elif len(m.names) == 2:
            combo = tuple(sorted(m.names))
            liq_a = combo[0]
            alpha = m.ratios[0] if m.names[0] == liq_a else m.ratios[1]
            binary_data[combo][alpha].append(i)

    # 计算纯样均值序列
    pure_series: dict[str, np.ndarray] = {}
    for liq, idxs in pure_indices.items():
        pure_series[liq] = X_norm[idxs].mean(axis=0)  # (T, n_s)

    # 计算每个组合的 NLDI
    results: list[NLDIResult] = []

    for combo in sorted(binary_data.keys()):
        liq_a, liq_b = combo
        if liq_a not in pure_series or liq_b not in pure_series:
            continue

        r_a = pure_series[liq_a]
        r_b = pure_series[liq_b]
        ratio_data = binary_data[combo]

        per_alpha: dict[float, float] = {}
        for alpha in sorted(ratio_data.keys()):
            idxs = ratio_data[alpha]
            r_actual = X_norm[idxs].mean(axis=0)
            r_pred = alpha * r_a + (1 - alpha) * r_b
            rel_dev = np.abs(r_actual - r_pred) / (np.abs(r_pred) + 1e-8)
            per_alpha[alpha] = float(rel_dev.mean())

        overall = float(np.mean(list(per_alpha.values())))
        results.append(NLDIResult(
            combo=combo,
            overall_nldi=overall,
            interaction_type=NLDIResult.classify(overall),
            per_alpha=per_alpha,
        ))

    results.sort(key=lambda r: -r.overall_nldi)
    return results


def print_nldi_results(
    results: list[NLDIResult],
    meta: list[SampleMeta],
    X_raw: np.ndarray,
    exp: ExperimentConfig,
):
    """打印 NLDI 分析结果"""
    sensors = exp.sensor.active_sensors
    bl_ratio = exp.alignment.baseline_ratio
    X_val = X_raw[:, :, sensors]
    X_norm = baseline_normalize(X_val, bl_ratio)

    # 纯样均值
    pure_indices: dict[str, list[int]] = defaultdict(list)
    for i, m in enumerate(meta):
        if m.is_pure:
            pure_indices[m.names[0]].append(i)

    print_header(f"NLDI 分析 (Run {exp.run_id}, {len(sensors)} 传感器)")

    print("\n  纯样均值 (归一化, 整个序列均值):")
    for liq in sorted(pure_indices.keys()):
        idxs = pure_indices[liq]
        mean_val = X_norm[idxs].mean(axis=0).mean(axis=0)  # (n_s,)
        vals = ", ".join([f"S{sensors[j]}={mean_val[j]:.4f}" for j in range(len(sensors))])
        print(f"    {exp.short(liq)}: [{vals}] (n={len(idxs)})")

    # 逐组合详情
    binary_data: dict[tuple, dict[float, list[int]]] = defaultdict(lambda: defaultdict(list))
    for i, m in enumerate(meta):
        if len(m.names) == 2:
            combo = tuple(sorted(m.names))
            liq_a = combo[0]
            alpha = m.ratios[0] if m.names[0] == liq_a else m.ratios[1]
            binary_data[combo][alpha].append(i)

    for res in sorted(results, key=lambda r: r.combo):
        sa = exp.short(res.combo[0])
        sb = exp.short(res.combo[1])
        print_subheader(f"{sa} + {sb}")

        for alpha in sorted(res.per_alpha.keys()):
            n = len(binary_data[res.combo].get(alpha, []))
            # 交互方向
            idxs = binary_data[res.combo][alpha]
            r_actual = X_norm[idxs].mean(axis=0).mean(axis=0)
            pure_a = X_norm[pure_indices[res.combo[0]]].mean(axis=0).mean(axis=0)
            pure_b = X_norm[pure_indices[res.combo[1]]].mean(axis=0).mean(axis=0)
            r_pred = alpha * pure_a + (1 - alpha) * pure_b
            ir = r_actual / (r_pred + 1e-8)
            types = ["↑" if v > 1.1 else "↓" if v < 0.9 else "≈" for v in ir]
            print(f"    α={alpha:.0%}: NLDI={res.per_alpha[alpha]:.4f} "
                  f"[{' '.join(types)}] (n={n})")

        print(f"    → 整体NLDI={res.overall_nldi:.4f} ({res.interaction_type})")

    # 汇总表
    print(f"\n  {'='*55}")
    rows = [[f"{exp.short(r.combo[0])}+{exp.short(r.combo[1])}",
             f"{r.overall_nldi:.4f}", r.interaction_type]
            for r in results]
    print_table(["组合", "NLDI", "类型"], rows, [30, 10, 15])
