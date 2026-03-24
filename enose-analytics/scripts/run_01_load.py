"""Step 1: 加载 Run 数据 → PCHIP 对齐 → 缓存。

用法: uv run python scripts/run_01_load.py [--force]
"""

from __future__ import annotations

import sys
import argparse

# 确保 scripts/ 在 path 中
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))

from mix_analysis.config import DEFAULT_CONFIG, get_cache_dir
from mix_analysis.data_loader import load_dataset, print_dataset_summary
from mix_analysis.utils import log, StepTimer


def main():
    parser = argparse.ArgumentParser(description="Step 1: 加载并缓存传感器对齐序列")
    parser.add_argument("--force", action="store_true", help="强制重新加载 (忽略缓存)")
    args = parser.parse_args()

    exp = DEFAULT_CONFIG
    log.info(f"实验: {exp.name} (Run {exp.run_id})")
    log.info(f"传感器: {exp.sensor.active_sensors} ({len(exp.sensor.active_sensors)} 个)")
    log.info(f"对齐: {exp.alignment.method}, {exp.alignment.n_samples} 步")
    log.info(f"缓存: {get_cache_dir(exp)}")

    with StepTimer("完整数据加载"):
        X_raw, meta = load_dataset(exp, force_reload=args.force)

    print_dataset_summary(exp, meta)

    log.info(f"数据形状: X_raw={X_raw.shape}")
    log.info(f"样本数: {len(meta)} (纯样: {sum(1 for m in meta if m.is_pure)}, "
             f"混合: {sum(1 for m in meta if not m.is_pure)})")
    log.info("Step 1 完成 ✓")


if __name__ == "__main__":
    main()
