"""统一入口: 一键生成全部 matplotlib 数据图。

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments_v2.figure          # 全部
    uv run python -m scripts.paper_experiments_v2.figure fig3     # 单张
    uv run python -m scripts.paper_experiments_v2.figure fig4 fig5

图编号与手稿一致:
    fig2  — 平台与实验设计
    fig3  — CARL 框架
    fig4  — 纯茶表征 + 非线性叠加
    fig5  — 香气图谱
    fig6  — 定量对比
    sm    — 补充材料
"""

from __future__ import annotations

import sys


def main(targets: list[str] | None = None):
    all_targets = {"fig2", "fig3", "fig4", "fig5", "fig6", "sm"}

    if targets is None:
        targets = list(all_targets)

    for t in targets:
        if t not in all_targets:
            print(f"⚠ 未知目标: {t}  (可用: {', '.join(sorted(all_targets))})")
            continue

        if t == "fig2":
            from .gen_fig2_platform import generate_fig2
            generate_fig2()

        elif t == "fig3":
            from .gen_fig3_carl import generate_fig3
            generate_fig3()

        elif t == "fig4":
            from .gen_fig4_merged import generate_fig4
            generate_fig4()

        elif t == "fig5":
            from .gen_fig5_aroma_map import generate_fig5
            generate_fig5()

        elif t == "fig6":
            from .gen_fig6_comparison import generate_fig6
            generate_fig6()

        elif t == "sm":
            from .gen_sm_figs_v2 import main as sm_main
            sm_main()


if __name__ == "__main__":
    args = sys.argv[1:] if len(sys.argv) > 1 else None
    main(args)
