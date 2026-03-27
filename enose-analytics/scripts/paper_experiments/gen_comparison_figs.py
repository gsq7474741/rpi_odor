"""生成模型对比可视化图表 — 读取已有 CSV 结果, 无需重跑实验。

用法:
    cd enose-analytics
    uv run python -m scripts.paper_experiments.gen_comparison_figs

生成:
    fig_clf_comparison.pdf   — 分类精度水平柱状图
    fig_params_vs_acc.pdf    — 参数量 vs 精度散点图
    fig_pred_comparison.pdf  — 预测性能柱状图
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

from .config import (
    FIGURES_DIR, TABLES_DIR, FIGURE_DPI, FONT_SIZE, FONT_FAMILY, SCALE,
    ensure_dirs, CARL_EMBED_DIM,
)
from .viz import init_style, save_fig

# ═══════════════════════════════════════════════════════════════
# 模型参数量计算
# ═══════════════════════════════════════════════════════════════

def _count_params(model) -> int:
    return sum(p.numel() for p in model.parameters())


def _get_dl_param_counts() -> dict[str, int]:
    """计算各深度学习模型的参数量。"""
    import torch.nn as nn

    # 1D-CNN classifier
    from .exp1_discrimination import _CNN1DClassifier
    cnn = _CNN1DClassifier(in_channels=8, n_classes=5)

    # TS2Vec encoder
    from .baselines import TS2VecEncoder
    ts2vec = TS2VecEncoder(in_channels=8, hidden=64, embed_dim=CARL_EMBED_DIM)

    # Autoencoder (encoder only, since that's what produces embeddings)
    from .baselines import _AEEncoder
    ae_enc = _AEEncoder(in_channels=8, embed_dim=CARL_EMBED_DIM)

    # Vanilla Contrastive (SimCLR)
    from .baselines import _VanillaEncoder
    simclr = _VanillaEncoder(in_channels=8, embed_dim=CARL_EMBED_DIM)

    # CARL encoder
    from .exp3_carl import CARLEncoder
    carl = CARLEncoder(in_channels=8, embed_dim=CARL_EMBED_DIM)

    return {
        "1D-CNN": _count_params(cnn),
        "TS2Vec": _count_params(ts2vec),
        "AE": _count_params(ae_enc),
        "SimCLR": _count_params(simclr),
        "CARL": _count_params(carl),
    }


# ═══════════════════════════════════════════════════════════════
# 图1: 分类精度水平柱状图 (grouped by tier)
# ═══════════════════════════════════════════════════════════════

# Tier 配色
TIER_COLORS = {
    "Hand-crafted + ML": "#7f8c8d",   # 灰色
    "End-to-end DL":     "#3498db",   # 蓝色
    "Self-supervised":   "#e67e22",   # 橙色
    "CARL (ours)":       "#e74c3c",   # 红色
}


def _build_clf_data() -> pd.DataFrame:
    """从 CSV 构建分类结果 DataFrame, 每个方法取最佳 normalization variant。"""
    df = pd.read_csv(TABLES_DIR / "table2_classification.csv")

    rows = []

    # HC: 每个 classifier 取最佳 feature variant
    hc_features = ["norm_stats", "stats", "log_norm_stats"]
    hc_df = df[df["feature"].isin(hc_features)]
    for clf_name in ["k-NN", "LDA", "SVM-RBF", "RF", "GBM"]:
        sub = hc_df[hc_df["classifier"] == clf_name]
        if len(sub) > 0:
            best = sub.loc[sub["accuracy"].idxmax()]
            rows.append({
                "tier": "Hand-crafted + ML",
                "method": f"HC + {clf_name}",
                "accuracy": best["accuracy"],
            })

    # 1D-CNN
    cnn_row = df[df["classifier"] == "1D-CNN"].iloc[0]
    rows.append({
        "tier": "End-to-end DL",
        "method": "1D-CNN",
        "accuracy": cnn_row["accuracy"],
    })

    # Self-supervised baselines
    ssl_map = {
        "TS2Vec_embedding": "TS2Vec + k-NN",
        "AE_embedding": "AE + k-NN",
        "VanillaContrastive_embedding": "SimCLR + k-NN",
    }
    for feat, label in ssl_map.items():
        row = df[df["feature"] == feat].iloc[0]
        rows.append({
            "tier": "Self-supervised",
            "method": label,
            "accuracy": row["accuracy"],
        })

    # CARL
    carl_df = df[df["feature"] == "CARL_embedding"]
    for _, row in carl_df.iterrows():
        rows.append({
            "tier": "CARL (ours)",
            "method": f"CARL + {row['classifier']}",
            "accuracy": row["accuracy"],
        })

    return pd.DataFrame(rows)


def plot_classification_comparison() -> plt.Figure:
    """水平柱状图: 分类精度对比。"""
    data = _build_clf_data()

    # 按 tier 分组, 组内按 accuracy 排序
    tier_order = ["Hand-crafted + ML", "End-to-end DL", "Self-supervised", "CARL (ours)"]
    data["tier"] = pd.Categorical(data["tier"], categories=tier_order, ordered=True)
    data = data.sort_values(["tier", "accuracy"], ascending=[True, True])

    fig, ax = plt.subplots(figsize=(8, 6.5))

    y_pos = []
    y_labels = []
    colors = []
    values = []
    tier_sep_positions = []  # (y_position, tier_name) for separator labels
    gap = 1.0  # tier 间间距
    y = 0

    for i, tier in enumerate(tier_order):
        tier_data = data[data["tier"] == tier]
        if len(tier_data) == 0:
            continue
        if i > 0:
            y += gap * 0.4  # 半间距给 tier 标签
        tier_sep_positions.append((y - 0.15, tier))
        y += gap * 0.3  # 另半间距
        for _, row in tier_data.iterrows():
            y_pos.append(y)
            y_labels.append(row["method"])
            colors.append(TIER_COLORS[tier])
            values.append(row["accuracy"])
            y += 1

    bars = ax.barh(y_pos, values, color=colors, height=0.7, edgecolor="white", linewidth=0.5 * SCALE)

    # 数值标签
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 0.8, bar.get_y() + bar.get_height() / 2,
                f"{val:.1f}", va="center", ha="left", fontsize=FONT_SIZE - 2,
                fontweight="bold" if val > 89 else "normal")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(y_labels, fontsize=FONT_SIZE - 2)
    ax.set_xlabel("Classification Accuracy (%)", fontsize=FONT_SIZE)
    ax.set_xlim(0, 105)
    ax.invert_yaxis()

    # Tier 分隔标签 (嵌入 y 轴, 用颜色区分)
    for sep_y, tier_name in tier_sep_positions:
        ax.text(-1, sep_y, f"— {tier_name} —",
                fontsize=FONT_SIZE - 2, fontweight="bold",
                color=TIER_COLORS[tier_name], ha="left", va="center",
                transform=ax.get_yaxis_transform())

    # CARL 的虚线参考
    carl_vals = [v for v, c in zip(values, colors) if c == TIER_COLORS["CARL (ours)"]]
    if carl_vals:
        ax.axvline(x=max(carl_vals), color=TIER_COLORS["CARL (ours)"],
                   linestyle="--", alpha=0.3, linewidth=1)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_title("Pure-tea Classification (5-class, 5-fold CV)", fontsize=FONT_SIZE + 2, pad=10)

    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════════
# 图2: 参数量 vs 精度散点图
# ═══════════════════════════════════════════════════════════════

def plot_params_vs_accuracy() -> plt.Figure:
    """散点图: 模型参数量 vs 分类精度。"""
    param_counts = _get_dl_param_counts()
    clf_data = _build_clf_data()

    # DL 方法映射
    dl_methods = {
        "1D-CNN":         ("1D-CNN",        "End-to-end DL"),
        "TS2Vec":         ("TS2Vec + k-NN", "Self-supervised"),
        "AE":             ("AE + k-NN",     "Self-supervised"),
        "SimCLR":         ("SimCLR + k-NN", "Self-supervised"),
        "CARL":           ("CARL + k-NN",   "CARL (ours)"),
    }

    fig, ax = plt.subplots(figsize=(7, 5.5))

    # HC baseline 区域 (无参数, 用灰色水平带)
    hc_accs = clf_data[clf_data["tier"] == "Hand-crafted + ML"]["accuracy"]
    if len(hc_accs) > 0:
        ax.axhspan(hc_accs.min(), hc_accs.max(), alpha=0.12, color=TIER_COLORS["Hand-crafted + ML"],
                   label=f"HC range ({hc_accs.min():.1f}–{hc_accs.max():.1f}%)")
        ax.axhline(y=hc_accs.max(), color=TIER_COLORS["Hand-crafted + ML"],
                   linestyle=":", alpha=0.5, linewidth=1)

    markers = {"End-to-end DL": "s", "Self-supervised": "^", "CARL (ours)": "*"}
    sizes = {"End-to-end DL": 120, "Self-supervised": 120, "CARL (ours)": 250}

    offsets = {
        "1D-CNN": (8, -6),
        "TS2Vec": (8, 2),
        "AE": (8, 2),
        "SimCLR": (8, 2),
        "CARL": (8, -5),
    }

    for model_key, (method_name, tier) in dl_methods.items():
        params = param_counts[model_key]
        row = clf_data[clf_data["method"] == method_name]
        if len(row) == 0:
            continue
        acc = row.iloc[0]["accuracy"]
        color = TIER_COLORS[tier]
        ax.scatter(params, acc, color=color, marker=markers.get(tier, "o"),
                   s=sizes.get(tier, 100), edgecolors="white", linewidths=0.8,
                   zorder=5, label=f"{model_key} ({params/1000:.1f}K)")
        # 标注
        oxy = offsets.get(model_key, (8, 2))
        ax.annotate(model_key, (params, acc),
                    textcoords="offset points", xytext=oxy,
                    fontsize=FONT_SIZE - 1, fontweight="bold" if "CARL" in model_key else "normal")

    ax.set_xlabel("Trainable Parameters", fontsize=FONT_SIZE)
    ax.set_ylabel("Classification Accuracy (%)", fontsize=FONT_SIZE)
    ax.set_title("Model Efficiency: Parameters vs. Accuracy", fontsize=FONT_SIZE + 2, pad=10)

    # X 轴格式化为 K
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x/1000:.0f}K"))

    ax.legend(fontsize=FONT_SIZE - 3, loc="center left", framealpha=0.9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════════
# 图3: 预测性能对比柱状图
# ═══════════════════════════════════════════════════════════════

def plot_prediction_comparison() -> plt.Figure:
    """水平柱状图: 预测 R² 对比。"""
    df = pd.read_csv(TABLES_DIR / "table5_prediction.csv")

    # 按 R² 降序排列
    df = df.sort_values("r2", ascending=True)

    # 分配颜色
    def _tier_color(model_name: str) -> str:
        if "CARL" in model_name or "fused" in model_name:
            return TIER_COLORS["CARL (ours)"]
        elif "CNN" in model_name:
            return TIER_COLORS["End-to-end DL"]
        else:
            return TIER_COLORS["Hand-crafted + ML"]

    colors = [_tier_color(m) for m in df["model"]]

    fig, ax = plt.subplots(figsize=(8, 5.5))

    y_pos = range(len(df))
    bars = ax.barh(y_pos, df["r2"], color=colors, height=0.7, edgecolor="white", linewidth=0.5 * SCALE)

    # 数值标签
    for bar, val in zip(bars, df["r2"]):
        if val >= 0:
            ax.text(bar.get_width() + 0.02, bar.get_y() + bar.get_height() / 2,
                    f"{val:.3f}", va="center", ha="left", fontsize=FONT_SIZE - 2,
                    fontweight="bold" if val > 0.5 else "normal")
        else:
            ax.text(0.02, bar.get_y() + bar.get_height() / 2,
                    f"{val:.3f}", va="center", ha="left", fontsize=FONT_SIZE - 2,
                    color="#666")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(df["model"], fontsize=FONT_SIZE - 2)
    ax.set_xlabel("$R^2$", fontsize=FONT_SIZE)
    ax.axvline(x=0, color="black", linewidth=0.8 * SCALE)
    ax.set_title("Blend Ratio Prediction ($R^2$, 5-fold CV)", fontsize=FONT_SIZE + 2, pad=10)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════════

def main():
    ensure_dirs()
    init_style()

    print("生成模型对比可视化...")

    # 参数量
    param_counts = _get_dl_param_counts()
    print("\n  模型参数量:")
    for name, p in param_counts.items():
        print(f"    {name}: {p:,} ({p/1000:.1f}K)")

    # 图1: 分类精度对比
    fig1 = plot_classification_comparison()
    save_fig(fig1, "fig_clf_comparison")

    # 图2: 参数量 vs 精度
    fig2 = plot_params_vs_accuracy()
    save_fig(fig2, "fig_params_vs_acc")

    # 图3: 预测性能对比
    fig3 = plot_prediction_comparison()
    save_fig(fig3, "fig_pred_comparison")

    print("\n  完成!")


if __name__ == "__main__":
    main()
