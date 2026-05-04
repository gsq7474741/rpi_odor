"""§3.2 NLDI 非线性可加性分析 (v2) — 合并 NLDI 计算 + 稳健统计检验。

输出:
  - Table 1: NLDI (mean ± SD), Bootstrap 95% CI, Wilcoxon p_Bonf, Sig.
  - fig_nldi_heatmap_v2.pdf
  - fig_nldi_forest_v2.pdf
  - fig_ratio_curve_*.pdf (per combo)
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from pathlib import Path
from scipy import stats as sp_stats

from ..config import (
    SEED, N_SENSORS,
    TEA_ORDER, TEA_IDS,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
    ensure_dirs,
)
from ..data import PaperDataset
from ..nldi import (
    compute_pure_baselines, compute_nldi_for_combo,
    compute_per_replicate_nldi, bootstrap_ci, wilcoxon_test_nldi,
)
from ..viz import init_style, save_fig, plot_heatmap, plot_response_ratio_curves

np.random.seed(SEED)


def run(
    ds: PaperDataset,
    tables_dir: Path,
    figures_dir: Path,
) -> dict:
    """运行 §3.2: NLDI + 稳健统计。"""
    print("\n" + "=" * 70)
    print("  §3.2 Non-linear Aroma Additivity (v2)")
    print("=" * 70)

    results = {}

    # ── 1. 纯茶基线 ──
    baselines = compute_pure_baselines(ds)
    results["baselines"] = {k: v.tolist() for k, v in baselines.items()}

    # ── 2. 逐组合计算 NLDI + 稳健统计 ──
    print("  计算 NLDI + 稳健统计 (10 组合)...")
    nldi_raw = {}   # 原始 NLDI (per channel) — 用于热力图
    rows = []       # Table 1 行

    for (tea_a, tea_b), clabel in zip(BINARY_COMBOS, BINARY_COMBO_LABELS):
        tid_a, tid_b = TEA_IDS[tea_a], TEA_IDS[tea_b]
        if tid_a not in baselines or tid_b not in baselines:
            continue

        # per-channel NLDI (用于热力图)
        res_ch = compute_nldi_for_combo(ds, baselines, clabel, tid_a, tid_b)
        if "nldi_per_channel" in res_ch:
            nldi_raw[clabel] = res_ch

        # per-replicate NLDI (用于统计检验)
        nldi_samples = compute_per_replicate_nldi(ds, baselines, clabel, tid_a, tid_b)
        if len(nldi_samples) == 0:
            continue

        mean_val, ci_lo, ci_hi = bootstrap_ci(nldi_samples)
        w_stat, w_pval = wilcoxon_test_nldi(nldi_samples)
        t_stat, p_ttest = sp_stats.ttest_1samp(nldi_samples, 0)

        bonf = 10
        w_pval_bonf = min(w_pval * bonf, 1.0) if not np.isnan(w_pval) else np.nan

        # 显著性星号
        if np.isnan(w_pval_bonf):
            sig = "n.s."
        elif w_pval_bonf < 0.001:
            sig = "***"
        elif w_pval_bonf < 0.01:
            sig = "**"
        elif w_pval_bonf < 0.05:
            sig = "*"
        else:
            sig = "n.s."

        row = {
            "combo": clabel,
            "n_replicates": len(nldi_samples),
            "nldi_mean": round(mean_val, 4),
            "nldi_std": round(float(nldi_samples.std()), 4),
            "nldi_mean_sd": f"{mean_val:.4f} ± {nldi_samples.std():.4f}",
            "bootstrap_ci": f"[{ci_lo:.4f}, {ci_hi:.4f}]",
            "bootstrap_ci_lo": round(ci_lo, 4),
            "bootstrap_ci_hi": round(ci_hi, 4),
            "wilcoxon_p_bonf": f"{w_pval_bonf:.2e}" if not np.isnan(w_pval_bonf) else "N/A",
            "ttest_p_bonf": f"{min(p_ttest * bonf, 1.0):.2e}",
            "sig": sig,
        }
        rows.append(row)
        print(f"    {clabel}: NLDI={mean_val:.4f} [{ci_lo:.4f}, {ci_hi:.4f}] "
              f"Wilcoxon_Bonf={w_pval_bonf:.2e} {sig}")

    # 按 NLDI 降序排列 (论文 Table 1 格式)
    rows.sort(key=lambda r: -r["nldi_mean"])

    # 整体统计
    all_means = [r["nldi_mean"] for r in rows]
    overall_mean = np.mean(all_means)
    overall_std = np.std(all_means)
    n_sig = sum(1 for r in rows if r["sig"] != "n.s.")

    rows.append({
        "combo": "Overall",
        "n_replicates": sum(r["n_replicates"] for r in rows),
        "nldi_mean": round(overall_mean, 4),
        "nldi_std": round(overall_std, 4),
        "nldi_mean_sd": f"{overall_mean:.4f} ± {overall_std:.4f}",
        "bootstrap_ci": "—",
        "bootstrap_ci_lo": None,
        "bootstrap_ci_hi": None,
        "wilcoxon_p_bonf": f"{n_sig}/10",
        "ttest_p_bonf": "—",
        "sig": "***" if n_sig == 10 else f"{n_sig}/10",
    })

    results["nldi_overall_mean"] = round(overall_mean, 4)
    results["nldi_overall_std"] = round(overall_std, 4)
    results["nldi_max_combo"] = rows[0]["combo"]
    results["nldi_min_combo"] = rows[-2]["combo"]  # -2 because -1 is "Overall"

    # ── 3. 保存 Table 1 ──
    df = pd.DataFrame(rows)
    csv_path = tables_dir / "table1_nldi_v2.csv"
    df.to_csv(csv_path, index=False)
    print(f"  Table 1 → {csv_path.name}")
    results["table1"] = rows

    # ── 4. NLDI 热力图 ──
    valid_combos = [c for c in BINARY_COMBO_LABELS if c in nldi_raw]
    if valid_combos:
        heatmap_data = np.array([nldi_raw[c]["nldi_per_channel"] for c in valid_combos])
        ch_labels = [f"CH{i}" for i in range(N_SENSORS)]
        fig_hm = plot_heatmap(
            heatmap_data, valid_combos, ch_labels,
            title="NLDI per combination and channel",
            cmap="YlOrRd", center=None, fmt=".3f",
        )
        _save(fig_hm, "fig_nldi_heatmap_v2", figures_dir)

    # ── 5. Forest plot ──
    _plot_forest([r for r in rows if r["combo"] != "Overall"], figures_dir)

    # ── 6. 响应-比例曲线 ──
    for clabel, res_ch in nldi_raw.items():
        if not res_ch.get("ratios"):
            continue
        ratios = np.array(res_ch["ratios"])
        # measured_by_ratio / predicted_by_ratio 的 key 是 float, value 是 list
        measured = np.array([res_ch["measured_by_ratio"][float(r)] for r in ratios])
        predicted = np.array([res_ch["predicted_by_ratio"][float(r)] for r in ratios])
        fig_curve = plot_response_ratio_curves(measured, predicted, ratios, clabel)
        safe = clabel.replace("-", "_")
        _save(fig_curve, f"fig_ratio_curve_{safe}_v2", figures_dir)

    # ── 7. 保存 JSON ──
    _save_json(results, tables_dir / "exp_nldi_v2.json")

    print(f"\n  === §3.2 结果摘要 ===")
    print(f"  总体 NLDI: {overall_mean:.4f} ± {overall_std:.4f}")
    print(f"  最高: {rows[0]['combo']} ({rows[0]['nldi_mean']:.4f})")
    print(f"  最低: {rows[-2]['combo']} ({rows[-2]['nldi_mean']:.4f})")
    print(f"  显著: {n_sig}/10")

    return results


# ── helpers ──

def _save(fig, name, figures_dir):
    import matplotlib.pyplot as plt
    for fmt in ["pdf", "png"]:
        p = figures_dir / f"{name}.{fmt}"
        fig.savefig(p, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"    → {name}")


def _save_json(obj, path):
    def _conv(o):
        if isinstance(o, (np.floating, np.float64, np.float32)):
            return float(o)
        if isinstance(o, (np.integer, np.int64, np.int32)):
            return int(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        return o
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(obj, default=_conv)), f, indent=2, ensure_ascii=False)


def _plot_forest(rows, figures_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    init_style()
    fig, ax = plt.subplots(figsize=(5, 4))

    combos = [r["combo"] for r in rows]
    means = [r["nldi_mean"] for r in rows]
    ci_lo = [r["bootstrap_ci_lo"] for r in rows]
    ci_hi = [r["bootstrap_ci_hi"] for r in rows]

    order = np.argsort(means)[::-1]
    for i, idx in enumerate(order):
        color = "#D55E00" if rows[idx]["sig"] != "n.s." else "#999999"
        ax.errorbar(
            means[idx], i,
            xerr=[[means[idx] - ci_lo[idx]], [ci_hi[idx] - means[idx]]],
            fmt="o", color=color, markersize=8, capsize=5, linewidth=2.4,
        )

    ax.set_yticks(range(len(combos)))
    ax.set_yticklabels([combos[i] for i in order])
    ax.axvline(0, color="gray", linestyle="--", linewidth=1.3)
    ax.set_xlabel("NLDI (95% Bootstrap CI)")
    ax.set_title("Non-linear deviation by tea pair")
    ax.invert_yaxis()
    fig.tight_layout()
    _save(fig, "fig_nldi_forest_v2", figures_dir)
