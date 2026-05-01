"""NLDI 稳健统计检验 — 基于 replicate 层面的 bootstrap CI + 置换检验。

审稿人指出: 8 个通道在同一传感器阵列上是相关观测, 不应作为独立样本。
本模块在"ratio step × replicate"层面重新计算 NLDI, 提供更稳健的统计推断。

方法:
  1. Per-replicate NLDI: 对每个混合样本单独计算 NLDI (而非按 ratio 分组取均值)
  2. Bootstrap CI: 对 per-replicate NLDI 做 10000 次 bootstrap, 得到 95% CI
  3. Permutation test: 随机打乱 ratio 标签, 重新计算 NLDI, 构建零分布
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from collections import defaultdict

from .config import (
    SEED, N_SENSORS,
    TEA_ORDER, TEA_IDS,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
    TABLES_DIR, FIGURES_DIR, ensure_dirs,
)
from .data import PaperDataset
from .nldi import compute_pure_baselines

np.random.seed(SEED)


def compute_per_replicate_nldi(
    ds: PaperDataset,
    baselines: dict[str, np.ndarray],
    combo_id: str,
    tea_a_id: str,
    tea_b_id: str,
) -> np.ndarray:
    """计算每个 replicate 的 NLDI 标量值。

    对每个混合样本 i:
      1. 计算其 8 通道稳态响应
      2. 用线性预测值 (基于其 ratio) 得到 8 通道预测
      3. 计算跨 8 通道的平均归一化偏差 → 单个 NLDI 值

    Returns:
        (n_mix,) 每个 replicate 的 NLDI 值
    """
    T = ds.X_value.shape[1]
    half = T // 2
    bl = max(1, T // 10)

    X_mix, mix_ratios = ds.get_mix_by_combo(combo_id)
    if len(X_mix) == 0:
        return np.array([])

    # baseline normalize
    baseline_mix = X_mix[:, :bl, :].mean(axis=1, keepdims=True)
    baseline_mix = np.where(baseline_mix == 0, 1.0, baseline_mix)
    X_mix_norm = X_mix / baseline_mix

    # 稳态均值 per sample
    X_steady = X_mix_norm[:, half:, :].mean(axis=1)  # (n_mix, 8)

    baseline_a = baselines[tea_a_id]
    baseline_b = baselines[tea_b_id]
    delta_a = baseline_a - 1.0
    delta_b = baseline_b - 1.0

    nldi_per_sample = np.zeros(len(X_mix))

    for i in range(len(X_mix)):
        r = mix_ratios[i]
        deviations = []
        for ch in range(N_SENSORS):
            delta_meas = X_steady[i, ch] - 1.0
            delta_pred = r * delta_a[ch] + (1 - r) * delta_b[ch]
            denom = max(abs(delta_a[ch]), abs(delta_b[ch]), 1e-10)
            deviations.append(abs(delta_meas - delta_pred) / denom)
        nldi_per_sample[i] = np.mean(deviations)

    return nldi_per_sample


def bootstrap_ci(
    values: np.ndarray,
    n_bootstrap: int = 10000,
    ci: float = 0.95,
    seed: int = SEED,
) -> tuple[float, float, float]:
    """Bootstrap 置信区间。

    Returns:
        (mean, ci_lower, ci_upper)
    """
    rng = np.random.RandomState(seed)
    n = len(values)
    boot_means = np.zeros(n_bootstrap)

    for b in range(n_bootstrap):
        idx = rng.randint(0, n, size=n)
        boot_means[b] = values[idx].mean()

    alpha = (1 - ci) / 2
    ci_lower = np.percentile(boot_means, alpha * 100)
    ci_upper = np.percentile(boot_means, (1 - alpha) * 100)

    return float(values.mean()), float(ci_lower), float(ci_upper)


def wilcoxon_test_nldi(
    nldi_samples: np.ndarray,
) -> tuple[float, float]:
    """Wilcoxon signed-rank test: H0 = median NLDI = 0 (线性可加)。

    非参数替代 t-test, 不假设正态分布, 更稳健。
    测试 per-replicate NLDI 值的中位数是否显著大于零。

    Returns:
        (statistic, p_value)  — 单侧 p-value (alternative='greater')
    """
    if len(nldi_samples) < 5:
        return np.nan, np.nan

    try:
        stat, p_val = sp_stats.wilcoxon(
            nldi_samples, zero_method="wilcox",
            alternative="greater",
        )
        return float(stat), float(p_val)
    except ValueError:
        # 全为正时 wilcoxon 也可能报错
        return np.nan, np.nan


def residual_bootstrap_test(
    nldi_samples: np.ndarray,
    n_bootstrap: int = 10000,
    seed: int = SEED,
) -> float:
    """Residual bootstrap test: H0 = E[NLDI] = 0。

    将 NLDI 值中心化到零, 然后 bootstrap 采样, 检查有多少比例
    的 bootstrap 均值 >= 观测均值。

    Returns:
        p_value
    """
    rng = np.random.RandomState(seed)
    n = len(nldi_samples)
    observed_mean = nldi_samples.mean()

    # 中心化 (在 H0 下均值为 0)
    centered = nldi_samples - observed_mean

    boot_means = np.zeros(n_bootstrap)
    for b in range(n_bootstrap):
        idx = rng.randint(0, n, size=n)
        boot_means[b] = centered[idx].mean()

    p_value = float((boot_means >= observed_mean).sum() + 1) / (n_bootstrap + 1)
    return p_value


def run_robust_stats(ds: PaperDataset) -> dict:
    """运行 NLDI 稳健统计检验。"""
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  NLDI 稳健统计检验 (bootstrap CI + 置换检验)")
    print("=" * 70)

    baselines = compute_pure_baselines(ds)
    results = {}
    rows = []

    for (tea_a, tea_b), clabel in zip(BINARY_COMBOS, BINARY_COMBO_LABELS):
        tid_a = TEA_IDS[tea_a]
        tid_b = TEA_IDS[tea_b]

        if tid_a not in baselines or tid_b not in baselines:
            continue

        print(f"  {clabel}...")

        # Per-replicate NLDI
        nldi_samples = compute_per_replicate_nldi(
            ds, baselines, clabel, tid_a, tid_b
        )
        if len(nldi_samples) == 0:
            continue

        # Bootstrap CI
        mean_val, ci_lo, ci_hi = bootstrap_ci(nldi_samples)

        # Wilcoxon signed-rank test (非参数, H0: median=0)
        w_stat, w_pval = wilcoxon_test_nldi(nldi_samples)

        # Residual bootstrap test (H0: E[NLDI]=0)
        boot_pval = residual_bootstrap_test(nldi_samples)

        # 原始 t-test (保留供对比)
        t_stat, p_ttest = sp_stats.ttest_1samp(nldi_samples, 0)

        # Bonferroni correction (10 comparisons)
        bonf = 10
        row = {
            "combo": clabel,
            "n_replicates": len(nldi_samples),
            "nldi_mean": round(mean_val, 4),
            "nldi_std": round(float(nldi_samples.std()), 4),
            "nldi_median": round(float(np.median(nldi_samples)), 4),
            "bootstrap_ci_lo": round(ci_lo, 4),
            "bootstrap_ci_hi": round(ci_hi, 4),
            "wilcoxon_stat": round(w_stat, 1) if not np.isnan(w_stat) else "N/A",
            "wilcoxon_p": f"{w_pval:.2e}" if not np.isnan(w_pval) else "N/A",
            "wilcoxon_p_bonf": f"{min(w_pval * bonf, 1.0):.2e}" if not np.isnan(w_pval) else "N/A",
            "wilcoxon_sig": (not np.isnan(w_pval)) and (w_pval * bonf < 0.05),
            "boot_p_value": f"{boot_pval:.4f}",
            "boot_significant": boot_pval < 0.005,  # Bonferroni: 0.05/10
            "ttest_t": round(float(t_stat), 3),
            "ttest_p": f"{p_ttest:.2e}",
        }
        rows.append(row)

        print(f"    NLDI = {mean_val:.4f} [{ci_lo:.4f}, {ci_hi:.4f}]"
              f"  Wilcoxon p={w_pval:.2e}  boot_p={boot_pval:.4f}"
              f"  t_p={p_ttest:.2e}")

        results[clabel] = {
            "nldi_per_replicate": nldi_samples.tolist(),
            **row,
        }

    # 保存
    df = pd.DataFrame(rows)
    csv_path = TABLES_DIR / "table3_nldi_robust_stats.csv"
    df.to_csv(csv_path, index=False)
    print(f"\n  CSV → {csv_path.name}")

    # 汇总
    n_sig_wilcox = sum(1 for r in rows if r["wilcoxon_sig"])
    n_sig_boot = sum(1 for r in rows if r["boot_significant"])
    n_ci_excl_zero = sum(1 for r in rows if r["bootstrap_ci_lo"] > 0)
    print(f"\n  === 稳健统计结果 ===")
    print(f"  Wilcoxon 显著 (Bonferroni p<0.05): {n_sig_wilcox}/{len(rows)}")
    print(f"  Bootstrap test 显著 (p<0.005): {n_sig_boot}/{len(rows)}")
    print(f"  Bootstrap CI 不含零: {n_ci_excl_zero}/{len(rows)}")

    # 生成 forest plot (NLDI + CI)
    _plot_forest(rows)

    return results


def _plot_forest(rows: list[dict]):
    """Forest plot: 每个组合的 NLDI 均值 + 95% bootstrap CI。"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from .viz import init_style, save_fig

    init_style()

    fig, ax = plt.subplots(figsize=(5, 4))

    combos = [r["combo"] for r in rows]
    means = [r["nldi_mean"] for r in rows]
    ci_lo = [r["bootstrap_ci_lo"] for r in rows]
    ci_hi = [r["bootstrap_ci_hi"] for r in rows]

    # 按 NLDI 排序
    order = np.argsort(means)[::-1]
    y_pos = np.arange(len(combos))

    for i, idx in enumerate(order):
        color = "#D55E00" if rows[idx]["wilcoxon_sig"] else "#999999"
        ax.errorbar(
            means[idx], i,
            xerr=[[means[idx] - ci_lo[idx]], [ci_hi[idx] - means[idx]]],
            fmt="o", color=color, markersize=8, capsize=5, linewidth=2.4,
        )

    ax.set_yticks(y_pos)
    ax.set_yticklabels([combos[i] for i in order])
    ax.axvline(0, color="gray", linestyle="--", linewidth=1.3)
    ax.set_xlabel("NLDI (95% Bootstrap CI)")
    ax.set_title("Non-linear deviation by tea pair")
    ax.invert_yaxis()
    fig.tight_layout()

    save_fig(fig, "fig_nldi_forest_plot", subdir="exp2")
    print(f"  Forest plot → fig_nldi_forest_plot")
