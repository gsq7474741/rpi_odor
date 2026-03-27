"""实验2: NLDI 可加性分析 (§3.2) — 核心实验

量化10组二元拼配的传感器响应是否符合线性叠加。

输出:
  - Fig.2: 响应-比例曲线 (实测 vs 线性预测), 选 3-4 组代表性
  - Fig.3: NLDI 热力图 (10 组合 × 8 通道)
  - Table 3: NLDI 汇总 + 配对 t 检验 p 值 (Bonferroni 校正)
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from collections import defaultdict

from .config import (
    SEED, N_SENSORS, GOOD_SENSORS,
    TEA_ORDER, TEA_IDS, TEA_NAME_EN,
    BINARY_COMBOS, BINARY_COMBO_LABELS,
    tea_short, combo_label,
    TABLES_DIR, ensure_dirs,
)
from .data import PaperDataset
from .viz import (
    init_style, save_fig,
    plot_heatmap, plot_response_ratio_curves,
)


# ═══════════════════════════════════════════════════════════════
# NLDI 计算核心
# ═══════════════════════════════════════════════════════════════

def compute_pure_baselines(ds: PaperDataset) -> dict[str, np.ndarray]:
    """计算每种茶的纯样 8 通道稳态均值 (基线)。

    Returns:
        {tea_id: (8,) 均值}
    """
    T = ds.X_value.shape[1]
    half = T // 2

    # baseline normalize
    bl = max(1, T // 10)
    baseline = ds.X_value[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm = ds.X_value / baseline

    baselines = {}
    for tid in ["T1", "T2", "T3", "T4", "T5"]:
        mask = ds.pure_mask & np.array([t == tid for t in ds.tea_ids])
        if mask.sum() == 0:
            continue
        X_tea = X_norm[mask]  # (n_i, T, 8)
        baselines[tid] = X_tea[:, half:, :].mean(axis=(0, 1))  # (8,)

    return baselines


def compute_nldi_for_combo(
    ds: PaperDataset,
    baselines: dict[str, np.ndarray],
    combo_id: str,
    tea_a_id: str,
    tea_b_id: str,
) -> dict:
    """计算单个组合的 NLDI。

    Returns:
        dict with keys:
          nldi_per_channel: (8,) 每通道 NLDI
          nldi_mean: float 平均 NLDI
          measured_by_ratio: {ratio: (8,)} 实测均值
          predicted_by_ratio: {ratio: (8,)} 线性预测
          residuals_by_ratio: {ratio: (8,)} 残差
          n_samples: int
          ratios: list[float]
    """
    T = ds.X_value.shape[1]
    half = T // 2
    bl = max(1, T // 10)

    # 获取混合样
    X_mix, mix_ratios = ds.get_mix_by_combo(combo_id)

    if len(X_mix) == 0:
        return {"nldi_mean": np.nan, "n_samples": 0}

    # baseline normalize mix samples
    baseline_mix = X_mix[:, :bl, :].mean(axis=1, keepdims=True)
    baseline_mix = np.where(baseline_mix == 0, 1.0, baseline_mix)
    X_mix_norm = X_mix / baseline_mix

    # 稳态均值
    X_mix_steady = X_mix_norm[:, half:, :].mean(axis=1)  # (n_mix, 8)

    # 按 ratio 分组
    unique_ratios = sorted(set(np.round(mix_ratios, 1)))
    measured_by_ratio = {}
    predicted_by_ratio = {}
    residuals_by_ratio = {}

    baseline_a = baselines[tea_a_id]  # (8,)
    baseline_b = baselines[tea_b_id]  # (8,)

    for r in unique_ratios:
        mask_r = np.abs(mix_ratios - r) < 0.05
        if mask_r.sum() == 0:
            continue

        # 实测均值
        measured = X_mix_steady[mask_r].mean(axis=0)  # (8,)
        # 线性预测
        predicted = r * baseline_a + (1 - r) * baseline_b  # (8,)

        measured_by_ratio[r] = measured
        predicted_by_ratio[r] = predicted
        residuals_by_ratio[r] = measured - predicted

    if not measured_by_ratio:
        return {"nldi_mean": np.nan, "n_samples": len(X_mix)}

    # NLDI 计算: 基于响应变化量 (ΔR = response - 1.0)
    # 科学依据: 传感器对茶的“响应”是相对于清洁空气基线 (=1.0
    # 归一化后) 的变化量。非线性偏差应相对于响应幅度度量,
    # 而非相对于包含大基线值的绝对读数。
    ratios_sorted = sorted(measured_by_ratio.keys())
    nldi_per_channel = np.zeros(N_SENSORS)

    # 纯茶响应变化量
    delta_a = baseline_a - 1.0  # (8,) 茶A的响应幅度
    delta_b = baseline_b - 1.0  # (8,) 茶B的响应幅度

    for ch in range(N_SENSORS):
        deviations = []
        for r in ratios_sorted:
            # 实测响应变化
            delta_meas = measured_by_ratio[r][ch] - 1.0
            # 线性预测响应变化
            delta_pred = r * delta_a[ch] + (1 - r) * delta_b[ch]
            # 非线性偏差 相对于响应幅度
            denom = max(abs(delta_a[ch]), abs(delta_b[ch]), 1e-10)
            deviations.append(abs(delta_meas - delta_pred) / denom)
        nldi_per_channel[ch] = np.mean(deviations) if deviations else 0.0

    return {
        "nldi_per_channel": nldi_per_channel,
        "nldi_mean": float(np.mean(nldi_per_channel)),
        "measured_by_ratio": {float(k): v.tolist() for k, v in measured_by_ratio.items()},
        "predicted_by_ratio": {float(k): v.tolist() for k, v in predicted_by_ratio.items()},
        "residuals_by_ratio": {float(k): v.tolist() for k, v in residuals_by_ratio.items()},
        "n_samples": len(X_mix),
        "ratios": ratios_sorted,
    }


# ═══════════════════════════════════════════════════════════════
# 统计检验
# ═══════════════════════════════════════════════════════════════

def paired_t_test_nldi(nldi_results: dict[str, dict]) -> pd.DataFrame:
    """对所有组合的 NLDI 做配对 t 检验 (H0: NLDI=0)。

    对 8 通道的 NLDI 值做单样本 t 检验, 检验偏差是否显著非零。
    Bonferroni 校正: p_adj = p_raw × n_combos.
    """
    rows = []
    n_combos = len(nldi_results)

    for combo_id, res in nldi_results.items():
        if "nldi_per_channel" not in res:
            continue
        nldi_ch = res["nldi_per_channel"]

        # 单样本 t 检验 (H0: mean=0)
        t_stat, p_raw = sp_stats.ttest_1samp(nldi_ch, 0)
        p_adj = min(p_raw * n_combos, 1.0)  # Bonferroni

        rows.append({
            "combo": combo_id,
            "nldi_mean": round(res["nldi_mean"], 4),
            "nldi_std": round(float(np.std(nldi_ch)), 4),
            "t_stat": round(float(t_stat), 3),
            "p_raw": f"{p_raw:.2e}",
            "p_bonferroni": f"{p_adj:.2e}",
            "significant": p_adj < 0.05,
            "n_samples": res["n_samples"],
        })

    return pd.DataFrame(rows)


# ═══════════════════════════════════════════════════════════════
# 主运行
# ═══════════════════════════════════════════════════════════════

def run(ds: PaperDataset) -> dict:
    """运行实验2: NLDI 可加性分析。"""
    ensure_dirs()
    print("\n" + "=" * 70)
    print("  实验2: NLDI 可加性分析")
    print("=" * 70)

    results = {}

    # ── 1. 计算纯茶基线 ──
    print(f"  计算纯茶基线...")
    baselines = compute_pure_baselines(ds)
    for tid, bl in baselines.items():
        print(f"    {tid}: {bl[:4]}...")  # 打印前4通道
    results["baselines"] = {k: v.tolist() for k, v in baselines.items()}

    # ── 2. 逐组合计算 NLDI ──
    print(f"  计算 NLDI (10 组合)...")
    nldi_results = {}

    for (tea_a, tea_b), clabel in zip(BINARY_COMBOS, BINARY_COMBO_LABELS):
        tid_a = TEA_IDS[tea_a]
        tid_b = TEA_IDS[tea_b]

        if tid_a not in baselines or tid_b not in baselines:
            print(f"    {clabel}: 基线缺失, 跳过")
            continue

        res = compute_nldi_for_combo(ds, baselines, clabel, tid_a, tid_b)
        nldi_results[clabel] = res

        if "nldi_per_channel" in res:
            print(f"    {clabel}: NLDI={res['nldi_mean']:.4f}, n={res['n_samples']}")
        else:
            print(f"    {clabel}: 无混合样数据")

    results["nldi"] = {
        k: {kk: vv for kk, vv in v.items() if kk != "nldi_per_channel"}
        for k, v in nldi_results.items()
    }

    # ── 3. NLDI 热力图 ──
    print(f"  生成 NLDI 热力图...")
    valid_combos = [c for c in BINARY_COMBO_LABELS if c in nldi_results and "nldi_per_channel" in nldi_results[c]]

    if valid_combos:
        heatmap_data = np.array([nldi_results[c]["nldi_per_channel"] for c in valid_combos])
        ch_labels = [f"CH{i}" for i in range(N_SENSORS)]

        fig_heatmap = plot_heatmap(
            heatmap_data, valid_combos, ch_labels,
            title="NLDI per combination and channel",
            cmap="YlOrRd", center=None, fmt=".3f",
        )
        save_fig(fig_heatmap, "fig3_nldi_heatmap", subdir="exp2")

        # NLDI 汇总统计
        results["nldi_overall_mean"] = round(float(heatmap_data.mean()), 4)
        results["nldi_overall_std"] = round(float(heatmap_data.std()), 4)
        results["nldi_max_combo"] = valid_combos[int(heatmap_data.mean(axis=1).argmax())]
        results["nldi_min_combo"] = valid_combos[int(heatmap_data.mean(axis=1).argmin())]

    # ── 4. 响应-比例曲线 (全部组合) ──
    print(f"  生成响应-比例曲线...")
    for clabel in valid_combos:  # 所有有效组合
        res = nldi_results[clabel]
        if not res.get("ratios"):
            continue

        ratios = np.array(res["ratios"])
        measured = np.array([res["measured_by_ratio"][r] for r in res["ratios"]])
        predicted = np.array([res["predicted_by_ratio"][r] for r in res["ratios"]])

        fig_curve = plot_response_ratio_curves(
            measured, predicted, ratios, clabel,
        )
        safe_name = clabel.replace("-", "_")
        save_fig(fig_curve, f"fig2_ratio_curve_{safe_name}", subdir="exp2")

    # ── 5. 统计检验 ──
    print(f"  统计检验...")
    df_test = paired_t_test_nldi(nldi_results)
    if not df_test.empty:
        print(df_test.to_string(index=False))
        results["statistical_tests"] = df_test.to_dict(orient="records")

        csv_path = TABLES_DIR / "table3_nldi_summary.csv"
        df_test.to_csv(csv_path, index=False)
        print(f"  CSV → {csv_path.name}")

    # ── 6. 保存完整结果 ──
    json_path = TABLES_DIR / "exp2_nldi_results.json"
    # 转换 numpy 类型
    def _convert(obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.float64, np.float32)):
            return float(obj)
        if isinstance(obj, (np.int64, np.int32)):
            return int(obj)
        return obj

    serializable = json.loads(json.dumps(results, default=_convert))
    with open(json_path, "w") as f:
        json.dump(serializable, f, indent=2, ensure_ascii=False)
    print(f"  JSON → {json_path.name}")

    # ── 摘要 ──
    print(f"\n  === 实验2 结果摘要 ===")
    if valid_combos:
        print(f"  有效组合: {len(valid_combos)}/10")
        print(f"  总体 NLDI: {results.get('nldi_overall_mean', 'N/A')} ± {results.get('nldi_overall_std', 'N/A')}")
        print(f"  最大偏差组合: {results.get('nldi_max_combo', 'N/A')}")
        print(f"  最小偏差组合: {results.get('nldi_min_combo', 'N/A')}")
        n_sig = sum(1 for r in df_test.to_dict("records") if r.get("significant"))
        print(f"  显著非零 (Bonferroni p<0.05): {n_sig}/{len(valid_combos)}")
    print(f"  输出: fig2_ratio_curves, fig3_nldi_heatmap, table3")

    return results
