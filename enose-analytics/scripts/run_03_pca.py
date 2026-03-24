"""Step 3: PCA 降维分析 + 混合轨迹可视化。

依赖: Step 1 的缓存数据
用法: uv run python scripts/run_03_pca.py
"""

from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from mix_analysis.config import DEFAULT_CONFIG
from mix_analysis.data_loader import load_dataset
from mix_analysis.visualization import pca_analysis
from mix_analysis.utils import log, StepTimer


def main():
    exp = DEFAULT_CONFIG

    with StepTimer("加载缓存数据"):
        X_raw, meta = load_dataset(exp)

    with StepTimer("PCA 分析"):
        pca_analysis(X_raw, meta, exp, feature_name="log_norm")

    log.info("Step 3 完成 ✓")


if __name__ == "__main__":
    main()
