"""样本截断时间 vs 分类精度研究

目标: 研究当样本被截断（只使用前 N 秒数据）时，分类精度如何变化，
      从而确定最短可接受的采集时长。

数据: Run 99-108 (东方树叶 5 种茶)
  - 纯样 Runs: 99, 101, 102, 103, 104, 106
  - 混合 Runs: 105, 108

截断策略: 对每个样本的原始传感器数据按绝对时间截取前 T 秒，
          然后 PCHIP 对齐到 100 步，再做特征工程 + 分类。

模型:
  ML: LDA, SVM-rbf, RF-100, GBM
  DL: 1D-CNN, MLP
"""

import numpy as np
import yaml
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from scipy.ndimage import uniform_filter1d
from collections import defaultdict
import time
import warnings
warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════════════
# 常量
# ═══════════════════════════════════════════════════════════════
GOOD_SENSORS = list(range(8))  # Run 105+ 所有传感器均为常温配置
N_ALIGN_STEPS = 100            # PCHIP 对齐后时间步数
SEED = 42

# 截断时间点 (秒) — 从 10s 到 120s
TRUNCATION_SECONDS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]

# Runs
PURE_RUNS = [99, 101, 102, 103, 104, 106]
MIX_RUNS = [105, 108]
ALL_RUNS = PURE_RUNS + MIX_RUNS

SHORT = {
    "东方树叶-乌龙茶": "乌龙",
    "东方树叶-红茶": "红茶",
    "东方树叶-茉莉花茶": "茉莉",
    "东方树叶-青柑普洱": "普洱",
    "东方树叶-黑乌龙": "黑乌龙",
}

def short(name):
    return SHORT.get(name, name)


def load_dsn():
    cfg_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


# ═══════════════════════════════════════════════════════════════
# 0. 数据加载 — 原始时间戳数据
# ═══════════════════════════════════════════════════════════════

def load_raw_sample_data_batch(dsn, run_ids):
    """批量加载指定 runs 的所有样本元信息和原始传感器数据 (单次连接)。

    Returns:
        list of (raw_data_dict, meta_dict)
        raw_data_dict: {run_id, start_time_ms, end_time_ms, duration_ms, rows}
        meta_dict: {sid, run_id, idx, names, ratios, is_pure, combo_key, duration_s}
    """
    placeholders = ",".join(["%s"] * len(run_ids))

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # 1) 查询所有样本元信息
            cur.execute(f"""
                SELECT id, run_id, sample_idx, liquid_names, liquid_ratios,
                       start_time_ms, end_time_ms
                FROM samples
                WHERE run_id IN ({placeholders})
                  AND end_time_ms IS NOT NULL
                ORDER BY run_id, sample_idx
            """, run_ids)
            samples = cur.fetchall()
            print(f"  查询到 {len(samples)} 个样本")

            # 2) 一次性加载所有 runs 的传感器数据
            print(f"  批量加载传感器数据 (runs={run_ids})...")
            cur.execute(f"""
                SELECT run_id, time_ms, sensor_idx, value, temperature, humidity, pressure
                FROM sensor_readings_v2
                WHERE run_id IN ({placeholders})
                ORDER BY run_id, sensor_idx, time_ms
            """, run_ids)
            all_readings = cur.fetchall()
            print(f"  传感器数据: {len(all_readings)} 行")

    # 3) 按 run_id 索引传感器数据
    readings_by_run = defaultdict(list)
    for r in all_readings:
        readings_by_run[r["run_id"]].append(r)
    del all_readings  # 释放内存

    # 4) 为每个样本匹配其时间范围内的传感器数据
    result = []
    skipped = 0
    for s in samples:
        start_ms = s["start_time_ms"]
        end_ms = s["end_time_ms"]
        rid = s["run_id"]

        # 从预加载数据中筛选
        run_readings = readings_by_run.get(rid, [])
        rows = [r for r in run_readings if start_ms <= r["time_ms"] <= end_ms]

        if not rows:
            skipped += 1
            continue

        names = list(s["liquid_names"]) if s["liquid_names"] else []
        ratios = list(s["liquid_ratios"]) if s["liquid_ratios"] else [1.0]

        raw_data = {
            "run_id": rid,
            "start_time_ms": start_ms,
            "end_time_ms": end_ms,
            "duration_ms": end_ms - start_ms,
            "rows": rows,
        }
        meta = {
            "sid": s["id"],
            "run_id": rid,
            "idx": s["sample_idx"],
            "names": names,
            "ratios": ratios,
            "is_pure": len(names) == 1,
            "combo_key": tuple(sorted(names)),
            "duration_s": (end_ms - start_ms) / 1000.0,
        }
        result.append((raw_data, meta))

    print(f"  组装完成: {len(result)} 个样本 (跳过 {skipped})")
    return result


def truncate_and_align(raw_data, cutoff_s, n_samples=100, method="pchip"):
    """对原始数据按绝对时间截取前 cutoff_s 秒，然后 PCHIP 对齐。

    Args:
        raw_data: load_raw_sample_data 返回的 dict
        cutoff_s: 截取的秒数
        n_samples: 对齐后的时间步数

    Returns:
        (n_samples, 32) ndarray 或 None
    """
    start_ms = raw_data["start_time_ms"]
    cutoff_ms = start_ms + cutoff_s * 1000
    rows = [r for r in raw_data["rows"] if r["time_ms"] <= cutoff_ms]

    if len(rows) < 16:  # 至少每个传感器 2 个点
        return None

    grid = np.linspace(0, 1, n_samples)
    ch_names = ["value", "temperature", "humidity", "pressure"]
    resampled = {ch: {} for ch in ch_names}

    for si in range(8):
        sr = [r for r in rows if r["sensor_idx"] == si]
        if len(sr) < 2:
            for ch in ch_names:
                resampled[ch][si] = np.full(n_samples, np.nan)
            continue

        t = np.array([r["time_ms"] for r in sr], dtype=np.float64)
        _, ui = np.unique(t, return_index=True)
        t = t[ui]
        span = t.max() - t.min()

        if span == 0:
            for ch in ch_names:
                vals = [sr[i][ch] for i in ui]
                resampled[ch][si] = np.full(n_samples, vals[0] if vals else np.nan)
            continue

        nt = (t - t.min()) / span
        for ch in ch_names:
            vals = np.array([sr[i][ch] for i in ui], dtype=np.float64)
            try:
                if method == "pchip":
                    f = interpolate.PchipInterpolator(nt, vals, extrapolate=True)
                else:
                    f = interpolate.interp1d(nt, vals, kind="linear", fill_value="extrapolate")
                resampled[ch][si] = f(grid)
            except Exception:
                resampled[ch][si] = np.full(n_samples, np.nan)

    columns = []
    for ch in ch_names:
        for i in range(8):
            columns.append(resampled[ch].get(i, np.full(n_samples, np.nan)))
    series = np.column_stack(columns)
    np.nan_to_num(series, copy=False, nan=0.0)
    return series


# ═══════════════════════════════════════════════════════════════
# 1. 批量加载所有样本的原始数据
# ═══════════════════════════════════════════════════════════════

def load_all_samples(dsn, run_ids):
    """一次性加载指定 runs 的所有样本原始数据 (批量高效版)。

    Returns:
        raw_samples: list of (raw_data_dict, meta_dict)
    """
    return load_raw_sample_data_batch(dsn, run_ids)


# ═══════════════════════════════════════════════════════════════
# 2. 特征工程 (精简版)
# ═══════════════════════════════════════════════════════════════

def baseline_normalize(X, T):
    bl = max(1, T // 10)
    baseline = X[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    return X / baseline


def extract_stats(X):
    """(N, T, S) → (N, S*12) 统计特征"""
    N, T, S = X.shape
    stats = np.empty((N, S * 12))
    for i in range(N):
        for j in range(S):
            ch = X[i, :, j]
            offset = j * 12
            stats[i, offset:offset + 12] = [
                ch.mean(), ch.std(), ch.min(), ch.max(),
                ch.max() - ch.min(),
                np.percentile(ch, 25), np.percentile(ch, 75), np.median(ch),
                np.argmax(ch) / T, np.argmin(ch) / T,
                ch[-1] - ch[0],
                np.mean(np.abs(np.diff(ch))),
            ]
    return stats


def make_features_compact(X_raw):
    """精简版特征工程: 只生成几种最有效的特征。

    Returns: dict[name -> (X_2d, desc)]
    """
    N, T, C = X_raw.shape
    n_s = len(GOOD_SENSORS)
    X_val = X_raw[:, :, GOOD_SENSORS]  # (N, T, n_s)

    X_norm = baseline_normalize(X_val, T)
    X_log = np.log1p(np.abs(X_val))
    X_log_norm = baseline_normalize(X_log, T)
    X_smooth_norm = baseline_normalize(uniform_filter1d(X_val, size=5, axis=1), T)

    features = {}

    # 展平特征
    features["norm"] = (X_norm.reshape(N, -1), f"基线归一化 ({T}×{n_s})")
    features["log_norm"] = (X_log_norm.reshape(N, -1), f"log基线归一化 ({T}×{n_s})")

    # 统计特征
    features["stats"] = (extract_stats(X_val), f"统计 ({n_s}×12)")
    features["norm_stats"] = (extract_stats(X_norm), f"归一化统计 ({n_s}×12)")
    features["log_norm_stats"] = (extract_stats(X_log_norm), f"log归一化统计 ({n_s}×12)")

    # 分段统计
    n_seg = 5
    seg_len = T // n_seg
    seg_feats = []
    for i in range(N):
        sf = []
        for seg in range(n_seg):
            start = seg * seg_len
            end = start + seg_len if seg < n_seg - 1 else T
            for j in range(n_s):
                ch_seg = X_norm[i, start:end, j]
                sf.extend([ch_seg.mean(), ch_seg.std()])
        seg_feats.append(sf)
    features["seg_norm"] = (np.array(seg_feats), f"分段归一化 ({n_seg}seg×{n_s}×2)")

    return features


# ═══════════════════════════════════════════════════════════════
# 3. ML 分类器 (精简版)
# ═══════════════════════════════════════════════════════════════

def run_ml_classifiers(features_dict, y, n_folds=5, seed=SEED):
    """对每种特征 × 分类器组合做 Stratified K-Fold CV。

    Returns: list of (accuracy, std, feature_name, classifier_name)
    """
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import StratifiedKFold, cross_val_score
    from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
    from sklearn.svm import SVC
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.pipeline import Pipeline

    unique_classes = np.unique(y)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    actual_folds = min(n_folds, min_class_count)
    if actual_folds < 2:
        return []

    classifiers = {
        "LDA": LinearDiscriminantAnalysis(),
        "SVM-rbf": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=seed),
        "RF-100": RandomForestClassifier(n_estimators=100, random_state=seed, n_jobs=-1),
        "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=seed),
    }

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=seed)
    results = []

    for feat_name, (X, desc) in features_dict.items():
        for clf_name, clf in classifiers.items():
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
            try:
                scores = cross_val_score(pipe, X, y, cv=skf, scoring="accuracy")
                results.append((scores.mean(), scores.std(), feat_name, clf_name))
            except Exception:
                results.append((0.0, 0.0, feat_name, clf_name))

    results.sort(key=lambda x: -x[0])
    return results


# ═══════════════════════════════════════════════════════════════
# 4. DL 分类器 (精简版: MLP + 1D-CNN)
# ═══════════════════════════════════════════════════════════════

def run_dl_classifiers(X_raw, y, n_folds=5, seed=SEED):
    """运行 MLP 和 1D-CNN 的 K-Fold CV。

    Returns: list of (accuracy, std, model_name)
    """
    import torch
    import torch.nn as nn
    from sklearn.model_selection import StratifiedKFold
    from sklearn.preprocessing import StandardScaler

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    N, T, C = X_raw.shape
    n_classes = len(np.unique(y))
    n_s = len(GOOD_SENSORS)

    unique_classes = np.unique(y)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    actual_folds = min(n_folds, min_class_count)
    if actual_folds < 2:
        return []

    skf = StratifiedKFold(n_splits=actual_folds, shuffle=True, random_state=seed)

    # 准备数据
    X_val = X_raw[:, :, GOOD_SENSORS].astype(np.float32)  # (N, T, n_s)
    bl = max(1, T // 10)
    baseline = X_val[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm = (X_val / baseline).astype(np.float32)
    X_log_norm = (np.log1p(np.abs(X_val)) / np.where(
        np.log1p(np.abs(X_val[:, :bl, :])).mean(axis=1, keepdims=True) == 0, 1.0,
        np.log1p(np.abs(X_val[:, :bl, :])).mean(axis=1, keepdims=True)
    )).astype(np.float32)

    configs = [
        ("MLP-norm", "mlp", X_norm.reshape(N, -1)),
        ("CNN1D-norm", "cnn1d", X_norm),
    ]

    results = []
    for name, model_type, X_input in configs:
        fold_accs = []
        is_seq = model_type in ("cnn1d",)

        for fold_idx, (train_idx, test_idx) in enumerate(skf.split(np.zeros(N), y)):
            Xtr, Xte = X_input[train_idx], X_input[test_idx]
            ytr, yte = y[train_idx], y[test_idx]

            # Standardize
            if is_seq:
                orig_shape = Xtr.shape
                sc = StandardScaler()
                Xtr = sc.fit_transform(Xtr.reshape(Xtr.shape[0], -1)).astype(np.float32)
                Xte = sc.transform(Xte.reshape(Xte.shape[0], -1)).astype(np.float32)
                Xtr = np.nan_to_num(Xtr.reshape(orig_shape), nan=0.0)
                Xte = np.nan_to_num(Xte.reshape(Xte.shape[0], *orig_shape[1:]), nan=0.0)
            else:
                sc = StandardScaler()
                Xtr = np.nan_to_num(sc.fit_transform(Xtr), nan=0.0).astype(np.float32)
                Xte = np.nan_to_num(sc.transform(Xte), nan=0.0).astype(np.float32)

            Xtr_t = torch.tensor(Xtr, device=device)
            Xte_t = torch.tensor(Xte, device=device)
            ytr_t = torch.tensor(ytr, dtype=torch.long, device=device)
            yte_t = torch.tensor(yte, dtype=torch.long, device=device)

            in_ch = Xtr.shape[2] if is_seq else Xtr.shape[1]

            if model_type == "mlp":
                model = nn.Sequential(
                    nn.Linear(in_ch, 128), nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(0.3),
                    nn.Linear(128, 64), nn.BatchNorm1d(64), nn.ReLU(), nn.Dropout(0.2),
                    nn.Linear(64, n_classes),
                ).to(device)
            else:  # cnn1d
                model = nn.Sequential(
                    nn.Conv1d(in_ch, 32, kernel_size=7, padding=3),
                    nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
                    nn.Conv1d(32, 64, kernel_size=5, padding=2),
                    nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
                    nn.Conv1d(64, 128, kernel_size=3, padding=1),
                    nn.BatchNorm1d(128), nn.ReLU(), nn.AdaptiveAvgPool1d(1),
                    nn.Flatten(), nn.Dropout(0.3),
                    nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, n_classes),
                ).to(device)

            optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=150)
            criterion = nn.CrossEntropyLoss()

            model.train()
            best_acc = 0.0
            patience = 0
            for epoch in range(200):
                optimizer.zero_grad()
                if is_seq:
                    out = model(Xtr_t.permute(0, 2, 1))
                else:
                    out = model(Xtr_t)
                loss = criterion(out, ytr_t)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                scheduler.step()

                if (epoch + 1) % 20 == 0:
                    model.eval()
                    with torch.no_grad():
                        if is_seq:
                            test_out = model(Xte_t.permute(0, 2, 1))
                        else:
                            test_out = model(Xte_t)
                        acc = (test_out.argmax(1) == yte_t).float().mean().item()
                        if acc > best_acc:
                            best_acc = acc
                            patience = 0
                        else:
                            patience += 1
                    model.train()
                    if patience >= 5:
                        break

            fold_accs.append(best_acc)

        mean_acc = np.mean(fold_accs)
        std_acc = np.std(fold_accs)
        results.append((mean_acc, std_acc, name))

    results.sort(key=lambda x: -x[0])
    return results


# ═══════════════════════════════════════════════════════════════
# 5. 截断实验主逻辑
# ═══════════════════════════════════════════════════════════════

def build_truncated_dataset(raw_samples, cutoff_s, indices=None):
    """对选定样本按 cutoff_s 截断并对齐。

    Args:
        raw_samples: load_all_samples 返回的列表
        cutoff_s: 截断秒数
        indices: 选定的样本索引（None=全部）

    Returns:
        X_raw: (N, 100, 32) ndarray
        valid_indices: 成功对齐的原始索引
    """
    if indices is None:
        indices = list(range(len(raw_samples)))

    series_list = []
    valid_indices = []

    for i in indices:
        raw, meta = raw_samples[i]
        ser = truncate_and_align(raw, cutoff_s, N_ALIGN_STEPS)
        if ser is not None:
            series_list.append(ser)
            valid_indices.append(i)

    if not series_list:
        return None, []

    return np.array(series_list), valid_indices


def run_truncation_experiment(raw_samples, task_name, indices, label_fn, cutoff_list):
    """对一个分类任务在不同截断时间下运行 ML/DL 分类。

    Args:
        raw_samples: 全部原始样本
        task_name: 任务名称
        indices: 该任务使用的样本索引
        label_fn: 从 meta 生成标签字符串的函数
        cutoff_list: 截断时间列表

    Returns:
        results_table: list of dicts
    """
    print(f"\n{'='*70}")
    print(f"  任务: {task_name}")
    print(f"  样本: {len(indices)}")
    print(f"{'='*70}")

    # 检查标签分布
    y_names = [label_fn(raw_samples[i][1]) for i in indices]
    classes = sorted(set(y_names))
    label_map = {name: i for i, name in enumerate(classes)}
    n_classes = len(classes)
    print(f"  类别数: {n_classes}")
    for c in classes:
        cnt = sum(1 for n in y_names if n == c)
        print(f"    {c}: {cnt}")

    results_table = []

    for cutoff_s in cutoff_list:
        t0 = time.time()
        print(f"\n  --- 截断: {cutoff_s}s ---")

        # 构建截断数据集
        X_trunc, valid_idx = build_truncated_dataset(raw_samples, cutoff_s, indices)
        if X_trunc is None or len(valid_idx) < 10:
            print(f"    有效样本不足 ({len(valid_idx) if valid_idx else 0})，跳过")
            continue

        # 重建标签 (只保留 valid 的)
        y_valid = np.array([label_map[label_fn(raw_samples[i][1])] for i in valid_idx])

        # 检查所有类是否都有样本
        if len(np.unique(y_valid)) < n_classes:
            print(f"    某些类丢失样本，跳过")
            continue

        # 特征工程
        features = make_features_compact(X_trunc)

        # ML 分类
        ml_results = run_ml_classifiers(features, y_valid)
        best_ml = ml_results[0] if ml_results else (0.0, 0.0, "N/A", "N/A")

        # DL 分类
        dl_results = run_dl_classifiers(X_trunc, y_valid)
        best_dl = dl_results[0] if dl_results else (0.0, 0.0, "N/A")

        elapsed = time.time() - t0

        # 记录结果
        row = {
            "cutoff_s": cutoff_s,
            "n_samples": len(valid_idx),
            "best_ml_acc": best_ml[0],
            "best_ml_std": best_ml[1],
            "best_ml_desc": f"{best_ml[2]}+{best_ml[3]}",
            "best_dl_acc": best_dl[0],
            "best_dl_std": best_dl[1],
            "best_dl_desc": best_dl[2],
            "best_overall": max(best_ml[0], best_dl[0]),
            "elapsed_s": elapsed,
        }
        results_table.append(row)

        # 打印 ML Top-3
        print(f"    ML Top-3:")
        for rank, (acc, std, feat, clf) in enumerate(ml_results[:3], 1):
            print(f"      {rank}. {feat:<18} {clf:<10} {acc:.1%} ±{std:.1%}")

        # 打印 DL
        print(f"    DL:")
        for acc, std, name in dl_results:
            print(f"      {name:<18} {acc:.1%} ±{std:.1%}")

        print(f"    最佳: ML={best_ml[0]:.1%} DL={best_dl[0]:.1%} ({elapsed:.1f}s)")

    return results_table


def print_summary_table(task_name, results, n_classes):
    """打印截断时间 vs 精度汇总表"""
    baseline = 1.0 / n_classes
    print(f"\n{'='*90}")
    print(f"  {task_name} — 截断时间 vs 分类精度汇总 (随机基线={baseline:.1%})")
    print(f"{'='*90}")
    print(f"  {'截断(s)':<10} {'样本':<6} {'最佳ML':>8} {'ML模型':<25} "
          f"{'最佳DL':>8} {'DL模型':<15} {'最佳':>8} {'Δ基线':>8}")
    print(f"  {'-'*85}")

    for row in results:
        best = row["best_overall"]
        delta = best - baseline
        print(f"  {row['cutoff_s']:<10} {row['n_samples']:<6} "
              f"{row['best_ml_acc']:>7.1%} {row['best_ml_desc']:<25} "
              f"{row['best_dl_acc']:>7.1%} {row['best_dl_desc']:<15} "
              f"{best:>7.1%} {delta:>+7.1%}")

    # 分析拐点
    if len(results) >= 3:
        full_acc = results[-1]["best_overall"]
        print(f"\n  完整数据精度: {full_acc:.1%}")
        for row in results:
            drop = full_acc - row["best_overall"]
            pct = drop / full_acc * 100 if full_acc > 0 else 0
            marker = ""
            if pct > 10:
                marker = " ← 精度下降 >10%"
            elif pct > 5:
                marker = " ← 精度下降 >5%"
            elif pct > 2:
                marker = " ← 精度下降 >2%"
            print(f"    {row['cutoff_s']:>4}s: {row['best_overall']:.1%} "
                  f"(损失 {drop:.1%}, -{pct:.1f}%){marker}")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    dsn = load_dsn()

    print("=" * 70)
    print("  样本截断时间 vs 分类精度研究")
    print("  目标: 确定最短可接受采集时长")
    print("=" * 70)

    # 加载所有 run 的原始数据
    print(f"\n加载 Runs {ALL_RUNS} 全部样本的原始数据...")
    t0 = time.time()
    raw_samples = load_all_samples(dsn, ALL_RUNS)
    print(f"  总耗时: {time.time()-t0:.1f}s")

    # 打印概况
    run_counts = defaultdict(int)
    pure_count = 0
    mix_count = 0
    for raw, meta in raw_samples:
        run_counts[meta["run_id"]] += 1
        if meta["is_pure"]:
            pure_count += 1
        else:
            mix_count += 1

    print(f"\n  Per-Run 分布:")
    for rid in sorted(run_counts.keys()):
        print(f"    Run {rid}: {run_counts[rid]} 样本")
    print(f"  纯样: {pure_count}, 混合: {mix_count}")

    # ── 任务 A: 纯样 5 类分类 ──
    pure_indices = [i for i, (_, m) in enumerate(raw_samples) if m["is_pure"]]
    pure_label_fn = lambda m: short(m["names"][0])

    task_a_results = run_truncation_experiment(
        raw_samples, "A: 纯样 5 类分类",
        pure_indices, pure_label_fn, TRUNCATION_SECONDS,
    )

    pure_classes = sorted(set(pure_label_fn(raw_samples[i][1]) for i in pure_indices))
    print_summary_table("A: 纯样 5 类分类", task_a_results, len(pure_classes))

    # ── 任务 B: 混合样组合分类 ──
    mix_indices = [i for i, (_, m) in enumerate(raw_samples) if not m["is_pure"]]
    def mix_label_fn(m):
        combo = tuple(sorted(m["names"]))
        return f"{short(combo[0])}+{short(combo[1])}"

    if len(mix_indices) >= 20:
        task_b_results = run_truncation_experiment(
            raw_samples, "B: 混合样组合分类",
            mix_indices, mix_label_fn, TRUNCATION_SECONDS,
        )
        mix_classes = sorted(set(mix_label_fn(raw_samples[i][1]) for i in mix_indices))
        print_summary_table("B: 混合样组合分类", task_b_results, len(mix_classes))
    else:
        print(f"\n  混合样不足 ({len(mix_indices)})，跳过任务 B")
        task_b_results = []

    # ── 任务 C: 全样本 primary_liquid 5 类分类 ──
    all_indices = list(range(len(raw_samples)))
    primary_label_fn = lambda m: short(m["names"][0]) if m["is_pure"] else short(sorted(m["names"])[0])

    # 对混合样，用主成分（比例最大的）作为标签
    def primary_liquid_fn(m):
        if m["is_pure"]:
            return short(m["names"][0])
        else:
            # 找比例最大的液体
            max_idx = m["ratios"].index(max(m["ratios"]))
            return short(m["names"][max_idx])

    task_c_results = run_truncation_experiment(
        raw_samples, "C: 全样本主成分分类 (5类)",
        all_indices, primary_liquid_fn, TRUNCATION_SECONDS,
    )
    all_classes = sorted(set(primary_liquid_fn(raw_samples[i][1]) for i in all_indices))
    print_summary_table("C: 全样本主成分分类", task_c_results, len(all_classes))

    # ── 最终汇总 ──
    print(f"\n\n{'#'*90}")
    print(f"#  最终结论汇总")
    print(f"{'#'*90}")

    for task_name, results in [
        ("A: 纯样 5 类", task_a_results),
        ("B: 混合组合", task_b_results),
        ("C: 主成分 5 类", task_c_results),
    ]:
        if not results:
            continue
        full_acc = results[-1]["best_overall"]
        # 找到精度下降 <5% 的最短时间
        min_time = None
        for row in results:
            drop_pct = (full_acc - row["best_overall"]) / full_acc * 100 if full_acc > 0 else 0
            if drop_pct <= 5:
                min_time = row["cutoff_s"]
                min_acc = row["best_overall"]
                break

        if min_time:
            print(f"\n  {task_name}:")
            print(f"    完整 120s 精度: {full_acc:.1%}")
            print(f"    最短可接受时长 (精度损失≤5%): {min_time}s → {min_acc:.1%}")
            print(f"    可压缩: {120 - min_time}s ({(120-min_time)/120*100:.0f}%)")
        else:
            print(f"\n  {task_name}: 所有截断时间精度损失均 >5%")


if __name__ == "__main__":
    main()
