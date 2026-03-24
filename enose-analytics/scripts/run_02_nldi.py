"""Step 2: NLDI (Nonlinear Deviation Index) 分析。

依赖: Step 1 的缓存数据
用法: uv run python scripts/run_02_nldi.py
"""

from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from mix_analysis.config import DEFAULT_CONFIG
from mix_analysis.data_loader import load_dataset
from mix_analysis.nldi import compute_nldi, print_nldi_results
from mix_analysis.utils import log, StepTimer


def main():
    exp = DEFAULT_CONFIG

    with StepTimer("加载缓存数据"):
        X_raw, meta = load_dataset(exp)

    with StepTimer("NLDI 计算"):
        results = compute_nldi(X_raw, meta, exp)

    print_nldi_results(results, meta, X_raw, exp)

    log.info(f"共 {len(results)} 个组合分析完成")
    log.info("Step 2 完成 ✓")


if __name__ == "__main__":
    main()
