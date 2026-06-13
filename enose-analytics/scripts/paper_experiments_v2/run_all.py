"""v2 端到端运行器 — 对齐论文 results_section_v2.md 的实验框架。

实验结构:
  §3.1  Pure-tea sensor response characterisation (描述性, 含在 classification 中)
  §3.2  NLDI 非线性可加性分析 → Table 1
  §3.3  茶类分类对比 → Table 2
  §3.4  比例回归对比 → Table 3
  §3.5  消融实验 → Table 4
  §3.6  茶叶香气地图 → Table 5

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.run_all
    uv run python -m scripts.paper_experiments_v2.run_all --exp nldi cls reg abl map
    uv run python -m scripts.paper_experiments_v2.run_all --cutoff 60
"""

from __future__ import annotations

import sys
import time
import argparse
import warnings
import numpy as np
from datetime import datetime
from pathlib import Path

warnings.filterwarnings("ignore")

# v2 结果目录 (默认; 可被 --tag 覆盖)
_RESULTS_BASE = Path(__file__).resolve().parent / "results"
V2_RESULTS_DIR = _RESULTS_BASE / "v2"
V2_TABLES_DIR = V2_RESULTS_DIR / "tables"
V2_FIGURES_DIR = V2_RESULTS_DIR / "figures"


def _init_output_dirs(tag: str | None = None):
    """设置输出目录。tag 非空时创建独立子目录，不覆盖旧结果。"""
    global V2_RESULTS_DIR, V2_TABLES_DIR, V2_FIGURES_DIR
    if tag:
        V2_RESULTS_DIR = _RESULTS_BASE / f"v2_{tag}"
    else:
        V2_RESULTS_DIR = _RESULTS_BASE / "v2"
    V2_TABLES_DIR = V2_RESULTS_DIR / "tables"
    V2_FIGURES_DIR = V2_RESULTS_DIR / "figures"
    for d in [V2_RESULTS_DIR, V2_TABLES_DIR, V2_FIGURES_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description="茶叶拼配论文 v2 实验 — 端到端运行器")
    parser.add_argument("--exp", nargs="*", type=str, default=None,
                        help="要运行的实验: nldi cls reg abl map (不指定则全部)")
    parser.add_argument("--cutoff", type=float, default=80.0,
                        help="截断秒数 (默认 80)")
    parser.add_argument("--tag", type=str, default=None,
                        help="结果目录后缀 (如 '20260504'); 不指定则自动加时间戳")
    parser.add_argument("--overwrite", action="store_true",
                        help="写入默认 results/v2 而非新建时间戳目录")
    parser.add_argument("--model", nargs="*", type=str, default=None,
                        help="只跑指定模型: hc e2e ssl comp carl (不指定则全部)")
    parser.add_argument("--carl-epochs", type=int, default=None,
                        help="覆盖 CARL 训练 epochs (默认 config.CARL_EPOCHS=300)")
    parser.add_argument("--carl-temp", type=float, default=None,
                        help="覆盖 SoftSupConLoss temperature (默认 0.5)")
    parser.add_argument("--carl-sigma", type=float, default=None,
                        help="覆盖 SoftSupConLoss sigma (默认 0.5)")
    parser.add_argument("--carl-lr", type=float, default=None,
                        help="覆盖 CARL 学习率 (默认 1e-3)")
    args = parser.parse_args()

    ALL_EXPS = ["nldi", "cls", "reg", "abl", "map"]
    exp_list = args.exp if args.exp else ALL_EXPS

    if args.overwrite:
        _init_output_dirs(tag=None)
    else:
        tag = args.tag or datetime.now().strftime("%Y%m%d_%H%M%S")
        _init_output_dirs(tag=tag)

    print("=" * 70)
    print("  茶叶拼配电子鼻论文 — v2 实验管线")
    print(f"  实验: {exp_list}")
    print(f"  截断: {args.cutoff}s")
    print(f"  结果: {V2_RESULTS_DIR}")
    print("=" * 70)

    t_start = time.time()

    # ── 数据加载 (所有实验共享) ──
    from .data import build_dataset
    print(f"\n{'─' * 70}\n  数据加载\n{'─' * 70}")
    ds = build_dataset(cutoff_s=args.cutoff)

    all_results = {}

    # ── §3.2 NLDI 非线性可加性分析 ──
    if "nldi" in exp_list:
        from .experiments import nldi as exp_nldi
        all_results["nldi"] = exp_nldi.run(ds, V2_TABLES_DIR, V2_FIGURES_DIR)

    # ── 全局 CARL 嵌入仅用于香气地图可视化 (§3.6) ──
    # cls / reg / abl 内部使用 nested CV 避免数据泄露
    carl_embeddings = None
    if "map" in exp_list:
        from .carl_training import train_carl, extract_embeddings
        from .config import CACHE_DIR, EXCLUDED_TEAS

        excl_suffix = f"_excl_{'_'.join(sorted(EXCLUDED_TEAS))}" if EXCLUDED_TEAS else ""
        emb_cache = CACHE_DIR / f"carl_embeddings_v2{excl_suffix}.npy"
        enc_cache = CACHE_DIR / f"carl_encoder_v2{excl_suffix}.pt"

        if emb_cache.exists() and enc_cache.exists():
            carl_embeddings = np.load(emb_cache)
            print(f"\n  从缓存加载 CARL 嵌入 (aroma map): {carl_embeddings.shape}")
        else:
            print(f"\n{'─' * 70}\n  训练 CARL (full) — for aroma map visualisation\n{'─' * 70}")
            import torch
            encoder, history, _ = train_carl(ds)
            carl_embeddings = extract_embeddings(encoder, ds)
            np.save(emb_cache, carl_embeddings)
            torch.save(encoder.state_dict(), enc_cache)
            print(f"  CARL 嵌入缓存 → {emb_cache.name} {carl_embeddings.shape}")

    # ── §3.3 茶类分类 (CARL nested CV inside) ──
    if "cls" in exp_list:
        from .experiments import classification as exp_cls
        all_results["cls"] = exp_cls.run(
            ds, V2_TABLES_DIR, V2_FIGURES_DIR,
            only_models=args.model, carl_epochs=args.carl_epochs)

    # ── §3.4 比例回归 (CARL nested CV inside) ──
    if "reg" in exp_list:
        from .experiments import regression as exp_reg
        all_results["reg"] = exp_reg.run(
            ds, V2_TABLES_DIR, V2_FIGURES_DIR,
            only_models=args.model, carl_epochs=args.carl_epochs,
            carl_temp=args.carl_temp, carl_sigma=args.carl_sigma,
            carl_lr=args.carl_lr)

    # ── §3.5 消融实验 (CARL nested CV inside) ──
    if "abl" in exp_list:
        from .experiments import ablation as exp_abl
        all_results["abl"] = exp_abl.run(
            ds, V2_TABLES_DIR, V2_FIGURES_DIR)

    # ── §3.6 茶叶香气地图 ──
    if "map" in exp_list:
        from .experiments import aroma_map as exp_map
        nldi_res = all_results.get("nldi")
        all_results["map"] = exp_map.run(
            ds, carl_embeddings, V2_TABLES_DIR, V2_FIGURES_DIR, nldi_res)

    # ── 汇总 ──
    elapsed = time.time() - t_start
    print(f"\n{'=' * 70}")
    print(f"  v2 全部完成! 总耗时: {elapsed:.1f}s ({elapsed / 60:.1f}min)")
    print(f"{'=' * 70}")

    n_figs = sum(1 for _ in V2_FIGURES_DIR.rglob("*") if _.is_file())
    n_tables = sum(1 for _ in V2_TABLES_DIR.rglob("*") if _.is_file())
    print(f"  图表: {n_figs} 个 → {V2_FIGURES_DIR}")
    print(f"  数据: {n_tables} 个 → {V2_TABLES_DIR}")

    for name, res in all_results.items():
        if isinstance(res, dict):
            print(f"\n  {name}: {list(res.keys())[:5]}...")

    return all_results


if __name__ == "__main__":
    main()
