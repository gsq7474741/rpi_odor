"""端到端运行器 — 一键生成论文所有图表。

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments.run_all          # 全部实验
    uv run python -m scripts.paper_experiments.run_all --exp 1  # 仅实验1
    uv run python -m scripts.paper_experiments.run_all --exp 1 2  # 实验1+2
    uv run python -m scripts.paper_experiments.run_all --reload  # 强制重新加载数据
"""

from __future__ import annotations

import sys
import time
import argparse
import warnings
import numpy as np
from pathlib import Path

warnings.filterwarnings("ignore")


def main():
    parser = argparse.ArgumentParser(description="茶叶拼配论文实验 — 端到端运行器")
    parser.add_argument("--exp", nargs="*", type=int, default=None,
                        help="要运行的实验编号 (1-5), 不指定则全部运行")
    parser.add_argument("--reload", action="store_true",
                        help="强制从 DB 重新加载数据 (忽略缓存)")
    parser.add_argument("--cutoff", type=float, default=80.0,
                        help="截断秒数 (默认 80)")
    args = parser.parse_args()

    # 确定要运行的实验
    if args.exp:
        exp_list = sorted(set(args.exp))
    else:
        exp_list = [1, 2, 3, 4, 5]

    print("=" * 70)
    print("  茶叶拼配电子鼻论文 — 实验管线")
    print(f"  实验: {exp_list}")
    print(f"  截断: {args.cutoff}s")
    print(f"  重载: {args.reload}")
    print("=" * 70)

    t_start = time.time()

    # ── 数据加载 (所有实验共享) ──
    from .data import build_dataset
    print(f"\n{'─'*70}")
    print(f"  数据加载")
    print(f"{'─'*70}")
    ds = build_dataset(cutoff_s=args.cutoff, force_reload=args.reload)

    all_results = {}
    carl_embeddings = None

    # 尝试从缓存加载 CARL 嵌入 (供非 exp3 实验使用)
    from .config import CACHE_DIR
    emb_path = CACHE_DIR / "carl_embeddings.npy"
    if emb_path.exists() and 3 not in exp_list:
        carl_embeddings = np.load(emb_path)
        print(f"\n  从缓存加载 CARL 嵌入: {carl_embeddings.shape}")

    # ── 实验执行顺序: 2→3→1→4→5 ──
    # 先训练 CARL (exp3), 再做分类对比 (exp1), 使 CARL embedding 可用于所有实验

    # ── 实验 2: NLDI 可加性分析 ──
    if 2 in exp_list:
        from . import exp2_nldi
        all_results["exp2"] = exp2_nldi.run(ds)

    # ── 实验 3: CARL 对比表征学习 ──
    if 3 in exp_list:
        from . import exp3_carl
        nldi_res = all_results.get("exp2")
        all_results["exp3"] = exp3_carl.run(ds, nldi_results=nldi_res)

        # 提取嵌入供后续实验使用
        if emb_path.exists():
            carl_embeddings = np.load(emb_path)
            print(f"  CARL 嵌入就绪: {carl_embeddings.shape}")

    # ── 实验 1: 单茶辨识 (含传统ML + 1D-CNN + CARL对比) ──
    if 1 in exp_list:
        from . import exp1_discrimination
        all_results["exp1"] = exp1_discrimination.run(ds, carl_embeddings=carl_embeddings)

    # ── 实验 4: 比例预测 ──
    if 4 in exp_list:
        from . import exp4_prediction
        all_results["exp4"] = exp4_prediction.run(ds, carl_embeddings=carl_embeddings)

    # ── 实验 5: 茶叶香气地图 ──
    if 5 in exp_list:
        from . import exp5_aroma_map
        all_results["exp5"] = exp5_aroma_map.run(ds, carl_embeddings=carl_embeddings)

    # ── 汇总 ──
    elapsed = time.time() - t_start
    print(f"\n{'='*70}")
    print(f"  全部完成! 总耗时: {elapsed:.1f}s ({elapsed/60:.1f}min)")
    print(f"{'='*70}")

    from .config import RESULTS_DIR, FIGURES_DIR, TABLES_DIR

    # 统计输出文件
    n_figs = sum(1 for _ in FIGURES_DIR.rglob("*") if _.is_file())
    n_tables = sum(1 for _ in TABLES_DIR.rglob("*") if _.is_file())
    print(f"  图表: {n_figs} 个 → {FIGURES_DIR}")
    print(f"  数据: {n_tables} 个 → {TABLES_DIR}")

    # 实验结果概要
    for exp_name, res in all_results.items():
        print(f"\n  {exp_name}:")
        if exp_name == "exp1" and "best_accuracy" in res:
            print(f"    最佳分类准确率: {res['best_accuracy']}%")
        elif exp_name == "exp2" and "nldi_overall_mean" in res:
            print(f"    总体 NLDI: {res['nldi_overall_mean']} ± {res['nldi_overall_std']}")
        elif exp_name == "exp3" and "downstream" in res:
            d = res["downstream"]
            print(f"    k-NN 茶: {d.get('knn_tea_accuracy', 'N/A')}%")
            print(f"    线性探针 R²: {d.get('linear_probe_r2', 'N/A')}")
        elif exp_name == "exp4" and "best_r2" in res:
            print(f"    最佳 R²: {res['best_r2']} ({res['best_model']})")
        elif exp_name == "exp5" and "handcrafted_metrics" in res:
            hc = res["handcrafted_metrics"]
            print(f"    手工特征 Silhouette: {hc['silhouette']}")

    return all_results


if __name__ == "__main__":
    main()
