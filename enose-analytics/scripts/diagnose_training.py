"""训练数据诊断脚本

直接连接数据库拉取数据，检查：
1. 数据统计（样本数、类别分布、特征维度、NaN 比例）
2. 特征质量（方差、相关性、信息熵）
3. 用 sklearn 简单分类器验证可分性

用法:
  cd enose-analytics
  uv run python scripts/diagnose_training.py --config liquid_identity
  uv run python scripts/diagnose_training.py --config primary_liquid --method pchip --n-samples 100
"""

import argparse
import sys
import os
from pathlib import Path

import numpy as np
import yaml
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import Counter
from sklearn.model_selection import StratifiedShuffleSplit


def load_db_config():
    """从 analytics.yaml 加载数据库配置"""
    config_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    with open(config_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


def get_labels(dsn: str, config_name: str):
    """获取指定标签策略的所有标签（复刻 MLLabelRepository.get_labels_by_config）"""
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT
                       s.id AS sample_id,
                       s.run_id,
                       sml.label_str,
                       sml.label_num,
                       sml.label_index
                   FROM samples s
                   JOIN sample_ml_labels sml ON s.id = sml.sample_id
                   JOIN ml_label_configs mlc ON sml.config_id = mlc.id
                   WHERE mlc.name = %s AND sml.label_str IS NOT NULL
                   ORDER BY s.run_id, s.id""",
                [config_name],
            )
            return cur.fetchall()


def get_aligned_series(dsn: str, sample_id: int, n_samples: int, method: str):
    """从数据库获取原始传感器数据并生成对齐序列 (复刻 SeriesAligner 逻辑)"""
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT run_id, start_time_ms, end_time_ms FROM samples WHERE id = %s",
                [sample_id],
            )
            sample_row = cur.fetchone()
            if not sample_row:
                return None

            run_id = sample_row["run_id"]
            start_ms = sample_row["start_time_ms"]
            end_ms = sample_row["end_time_ms"]

            if end_ms:
                cur.execute(
                    """SELECT time_ms, sensor_idx, value, temperature, humidity, pressure
                       FROM sensor_readings_v2
                       WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                       ORDER BY sensor_idx, time_ms""",
                    [run_id, start_ms, end_ms],
                )
            else:
                cur.execute(
                    """SELECT time_ms, sensor_idx, value, temperature, humidity, pressure
                       FROM sensor_readings_v2
                       WHERE run_id = %s AND time_ms >= %s
                       ORDER BY sensor_idx, time_ms""",
                    [run_id, start_ms],
                )
            rows = cur.fetchall()

    if not rows:
        return None

    grid = np.linspace(0, 1, n_samples)
    channels = ["value", "temperature", "humidity", "pressure"]
    resampled = {ch: {} for ch in channels}

    for sensor_idx in range(8):
        sensor_rows = [r for r in rows if r["sensor_idx"] == sensor_idx]
        if len(sensor_rows) < 2:
            for ch in channels:
                resampled[ch][sensor_idx] = np.full(n_samples, np.nan)
            continue

        times = np.array([r["time_ms"] for r in sensor_rows], dtype=np.float64)
        # 去重
        _, unique_idx = np.unique(times, return_index=True)
        times = times[unique_idx]
        t_min, t_max = times.min(), times.max()
        duration = t_max - t_min
        if duration == 0:
            for ch in channels:
                vals = [sensor_rows[i][ch] for i in unique_idx]
                resampled[ch][sensor_idx] = np.full(n_samples, vals[0] if vals else np.nan)
            continue

        normalized_t = (times - t_min) / duration

        for ch in channels:
            vals = np.array([sensor_rows[i][ch] for i in unique_idx], dtype=np.float64)
            try:
                if method == "pchip":
                    f = interpolate.PchipInterpolator(normalized_t, vals, extrapolate=True)
                else:
                    f = interpolate.interp1d(normalized_t, vals, kind="linear", fill_value="extrapolate")
                resampled[ch][sensor_idx] = f(grid)
            except Exception:
                resampled[ch][sensor_idx] = np.full(n_samples, np.nan)

    # 组装 (n_samples, 32): [8×value, 8×temp, 8×humidity, 8×pressure]
    all_columns = []
    for ch in channels:
        for i in range(8):
            all_columns.append(resampled[ch].get(i, np.full(n_samples, np.nan)))
    series = np.column_stack(all_columns)

    # reshape 为 (T, 8, 4) 同 DatasetBuilder
    T = series.shape[0]
    reshaped = series.reshape(T, 4, 8)  # (T, 4, 8)
    result = reshaped.transpose(0, 2, 1).astype(np.float32)  # (T, 8, 4)
    np.nan_to_num(result, copy=False, nan=0.0)
    return result


def main():
    parser = argparse.ArgumentParser(description="训练数据诊断")
    parser.add_argument("--config", required=True, help="标签策略名称 (如 liquid_identity, primary_liquid)")
    parser.add_argument("--method", default="pchip", help="插值方法 (default: pchip)")
    parser.add_argument("--n-samples", type=int, default=100, help="序列长度 (default: 100)")
    parser.add_argument("--seed", type=int, default=42, help="随机种子")
    args = parser.parse_args()

    print("=" * 70)
    print(f"  训练数据诊断: config={args.config}, method={args.method}, n_samples={args.n_samples}")
    print("=" * 70)

    dsn = load_db_config()
    print(f"  DSN: {dsn.split('@')[1]}")

    # ─── 1. 构建数据集 ───
    print("\n[1/5] 构建数据集...")
    labels = get_labels(dsn, args.config)
    if not labels:
        print("❌ 没有找到标签！检查标签配置名称。")
        return
    print(f"  找到 {len(labels)} 个标签")

    # 构建 class_names 映射
    unique_labels = sorted(set(lbl["label_str"] for lbl in labels))
    label_to_idx = {name: i for i, name in enumerate(unique_labels)}

    X_list = []
    y_list = []
    skipped = 0
    for i, lbl in enumerate(labels):
        if (i + 1) % 10 == 0 or i == 0:
            print(f"  提取对齐序列: {i+1}/{len(labels)}...", end="\r")
        series = get_aligned_series(dsn, lbl["sample_id"], args.n_samples, args.method)
        if series is not None:
            X_list.append(series)
            y_list.append(label_to_idx[lbl["label_str"]])
        else:
            skipped += 1
    print(f"  提取完成: {len(X_list)} 成功, {skipped} 跳过          ")

    if not X_list:
        print("❌ 没有有效的对齐序列数据！")
        return

    X_all = np.array(X_list)  # (N, T, 8, 4)
    y_all = np.array(y_list)
    class_names = unique_labels
    n_classes = len(unique_labels)

    # 分割数据集
    sss1 = StratifiedShuffleSplit(n_splits=1, test_size=0.15, random_state=args.seed)
    trainval_idx, test_idx = next(sss1.split(X_all, y_all))
    X_tv, y_tv = X_all[trainval_idx], y_all[trainval_idx]
    X_test, y_test = X_all[test_idx], y_all[test_idx]

    val_in_tv = 0.15 / 0.85
    sss2 = StratifiedShuffleSplit(n_splits=1, test_size=val_in_tv, random_state=args.seed)
    try:
        train_sub, val_sub = next(sss2.split(X_tv, y_tv))
        X_train, y_train = X_tv[train_sub], y_tv[train_sub]
        X_val, y_val = X_tv[val_sub], y_tv[val_sub]
    except ValueError:
        X_train, y_train = X_tv, y_tv
        X_val, y_val = np.empty((0,) + X_all.shape[1:]), np.empty(0)

    dataset = {
        "X_train": X_train, "y_train": y_train,
        "X_val": X_val, "y_val": y_val,
        "X_test": X_test, "y_test": y_test,
        "class_names": class_names, "n_classes": n_classes,
    }

    # 合并全部数据用于分析（已经有 X_all, y_all）

    # ─── 2. 基本统计 ───
    print("\n[2/5] 数据统计")
    print(f"  总样本数: {len(X_all)}")
    print(f"  训练集: {len(X_train)}, 验证集: {len(X_val)}, 测试集: {len(X_test)}")
    print(f"  类别数: {n_classes}")
    print(f"  类别名: {class_names}")
    print(f"  原始形状: {X_all.shape}  (N, T, 8, 4)")

    # 类别分布
    print(f"\n  类别分布 (全集):")
    counter = Counter(y_all.tolist())
    for cls_idx in sorted(counter.keys()):
        name = class_names[cls_idx] if cls_idx < len(class_names) else f"class_{cls_idx}"
        count = counter[cls_idx]
        pct = count / len(y_all) * 100
        print(f"    [{cls_idx}] {name}: {count} ({pct:.1f}%)")

    print(f"\n  类别分布 (训练集):")
    train_counter = Counter(y_train.tolist())
    for cls_idx in sorted(train_counter.keys()):
        name = class_names[cls_idx] if cls_idx < len(class_names) else f"class_{cls_idx}"
        count = train_counter[cls_idx]
        print(f"    [{cls_idx}] {name}: {count}")

    # ─── 3. 特征质量 ───
    print("\n[3/5] 特征质量分析")

    # Flatten 为 2D: (N, T*8*4)
    X_flat = X_all.reshape(X_all.shape[0], -1)
    print(f"  扁平特征维度: {X_flat.shape[1]}")

    # NaN 检查
    nan_count = np.isnan(X_flat).sum()
    nan_pct = nan_count / X_flat.size * 100
    print(f"  NaN 数量: {nan_count} ({nan_pct:.2f}%)")

    # Inf 检查
    inf_count = np.isinf(X_flat).sum()
    print(f"  Inf 数量: {inf_count}")

    # 零值检查
    zero_count = (X_flat == 0).sum()
    zero_pct = zero_count / X_flat.size * 100
    print(f"  零值数量: {zero_count} ({zero_pct:.2f}%)")

    # 值域
    finite_vals = X_flat[np.isfinite(X_flat)]
    if len(finite_vals) > 0:
        print(f"  值域: [{finite_vals.min():.4f}, {finite_vals.max():.4f}]")
        print(f"  均值: {finite_vals.mean():.4f}, 标准差: {finite_vals.std():.4f}")

    # 逐通道统计 (value, temp, humidity, pressure)
    channel_names = ["value", "temperature", "humidity", "pressure"]
    print(f"\n  逐通道统计 (对 8 传感器取均值):")
    for ch_idx, ch_name in enumerate(channel_names):
        # X_all shape: (N, T, 8, 4), channel is dim 3
        ch_data = X_all[:, :, :, ch_idx]  # (N, T, 8)
        ch_flat = ch_data.flatten()
        finite = ch_flat[np.isfinite(ch_flat)]
        if len(finite) > 0:
            print(f"    {ch_name:12s}: mean={finite.mean():.4f}, std={finite.std():.4f}, "
                  f"range=[{finite.min():.4f}, {finite.max():.4f}], "
                  f"nan={np.isnan(ch_flat).sum()}, zero={int((ch_flat == 0).sum())}")
        else:
            print(f"    {ch_name:12s}: 全部为 NaN!")

    # 特征方差分析
    col_var = np.nanvar(X_flat, axis=0)
    zero_var_count = (col_var < 1e-10).sum()
    print(f"\n  零方差特征数: {zero_var_count}/{X_flat.shape[1]} ({zero_var_count/X_flat.shape[1]*100:.1f}%)")
    if zero_var_count < X_flat.shape[1]:
        nonzero_var = col_var[col_var >= 1e-10]
        print(f"  非零方差特征: mean_var={nonzero_var.mean():.6f}, median_var={np.median(nonzero_var):.6f}")

    # ─── 4. sklearn 可分性验证 ───
    print("\n[4/5] sklearn 可分性验证")

    # 用 NaN → 0 清洗
    X_flat_clean = np.nan_to_num(X_flat, nan=0.0, posinf=0.0, neginf=0.0)

    # 分割 (同 DatasetBuilder 的分割)
    X_train_flat = X_flat_clean[:len(X_train)]
    X_val_flat = X_flat_clean[len(X_train):len(X_train)+len(X_val)]
    X_test_flat = X_flat_clean[len(X_train)+len(X_val):]

    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import accuracy_score, classification_report

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_flat)
    X_test_scaled = scaler.transform(X_test_flat) if len(X_test_flat) > 0 else None
    X_val_scaled = scaler.transform(X_val_flat) if len(X_val_flat) > 0 else None

    # 检查 scale 后是否有问题
    train_nan = np.isnan(X_train_scaled).sum()
    train_inf = np.isinf(X_train_scaled).sum()
    if train_nan > 0 or train_inf > 0:
        print(f"  ⚠️ StandardScaler 后仍有 NaN={train_nan}, Inf={train_inf}")
        X_train_scaled = np.nan_to_num(X_train_scaled, nan=0.0, posinf=0.0, neginf=0.0)
        if X_test_scaled is not None:
            X_test_scaled = np.nan_to_num(X_test_scaled, nan=0.0, posinf=0.0, neginf=0.0)
        if X_val_scaled is not None:
            X_val_scaled = np.nan_to_num(X_val_scaled, nan=0.0, posinf=0.0, neginf=0.0)

    eval_X = X_test_scaled if X_test_scaled is not None and len(X_test_scaled) > 0 else X_val_scaled
    eval_y = y_test if len(y_test) > 0 else y_val
    eval_name = "test" if len(y_test) > 0 else "val"

    # 4a. 随机基线
    random_acc = max(Counter(y_train.tolist()).values()) / len(y_train)
    print(f"\n  随机基线 (多数类): {random_acc:.4f} ({random_acc*100:.1f}%)")

    # 4b. Logistic Regression
    try:
        from sklearn.linear_model import LogisticRegression
        lr = LogisticRegression(max_iter=1000, random_state=args.seed, C=1.0)
        lr.fit(X_train_scaled, y_train)
        lr_train_acc = accuracy_score(y_train, lr.predict(X_train_scaled))
        print(f"\n  LogisticRegression:")
        print(f"    Train Acc: {lr_train_acc:.4f} ({lr_train_acc*100:.1f}%)")
        if eval_X is not None and len(eval_X) > 0:
            lr_eval_acc = accuracy_score(eval_y, lr.predict(eval_X))
            print(f"    {eval_name.capitalize()} Acc: {lr_eval_acc:.4f} ({lr_eval_acc*100:.1f}%)")
    except Exception as e:
        print(f"  LogisticRegression 失败: {e}")

    # 4c. Random Forest
    try:
        from sklearn.ensemble import RandomForestClassifier
        rf = RandomForestClassifier(n_estimators=100, random_state=args.seed, n_jobs=-1)
        rf.fit(X_train_scaled, y_train)
        rf_train_acc = accuracy_score(y_train, rf.predict(X_train_scaled))
        print(f"\n  RandomForest:")
        print(f"    Train Acc: {rf_train_acc:.4f} ({rf_train_acc*100:.1f}%)")
        if eval_X is not None and len(eval_X) > 0:
            rf_eval_acc = accuracy_score(eval_y, rf.predict(eval_X))
            print(f"    {eval_name.capitalize()} Acc: {rf_eval_acc:.4f} ({rf_eval_acc*100:.1f}%)")
    except Exception as e:
        print(f"  RandomForest 失败: {e}")

    # 4d. KNN
    try:
        from sklearn.neighbors import KNeighborsClassifier
        knn = KNeighborsClassifier(n_neighbors=min(5, len(X_train_scaled) - 1))
        knn.fit(X_train_scaled, y_train)
        knn_train_acc = accuracy_score(y_train, knn.predict(X_train_scaled))
        print(f"\n  KNN (k={knn.n_neighbors}):")
        print(f"    Train Acc: {knn_train_acc:.4f} ({knn_train_acc*100:.1f}%)")
        if eval_X is not None and len(eval_X) > 0:
            knn_eval_acc = accuracy_score(eval_y, knn.predict(eval_X))
            print(f"    {eval_name.capitalize()} Acc: {knn_eval_acc:.4f} ({knn_eval_acc*100:.1f}%)")
    except Exception as e:
        print(f"  KNN 失败: {e}")

    # 4e. SVM (linear)
    try:
        from sklearn.svm import LinearSVC
        svm = LinearSVC(max_iter=2000, random_state=args.seed, dual="auto")
        svm.fit(X_train_scaled, y_train)
        svm_train_acc = accuracy_score(y_train, svm.predict(X_train_scaled))
        print(f"\n  LinearSVM:")
        print(f"    Train Acc: {svm_train_acc:.4f} ({svm_train_acc*100:.1f}%)")
        if eval_X is not None and len(eval_X) > 0:
            svm_eval_acc = accuracy_score(eval_y, svm.predict(eval_X))
            print(f"    {eval_name.capitalize()} Acc: {svm_eval_acc:.4f} ({svm_eval_acc*100:.1f}%)")
    except Exception as e:
        print(f"  LinearSVM 失败: {e}")

    # ─── 5. 仅用 value 通道测试 ───
    print("\n[5/5] 仅用 value 通道 (传感器电阻值) 测试")
    X_value_only = X_all[:, :, :, 0]  # (N, T, 8) - 仅 value 通道
    X_value_flat = X_value_only.reshape(X_all.shape[0], -1)  # (N, T*8)
    X_value_flat = np.nan_to_num(X_value_flat, nan=0.0)
    print(f"  Value-only 特征维度: {X_value_flat.shape[1]}")

    X_vtrain = X_value_flat[:len(X_train)]
    X_vtest = X_value_flat[len(X_train)+len(X_val):]

    scaler_v = StandardScaler()
    X_vtrain_s = scaler_v.fit_transform(X_vtrain)
    X_vtest_s = scaler_v.transform(X_vtest) if len(X_vtest) > 0 else None

    X_vtrain_s = np.nan_to_num(X_vtrain_s, nan=0.0, posinf=0.0, neginf=0.0)
    if X_vtest_s is not None:
        X_vtest_s = np.nan_to_num(X_vtest_s, nan=0.0, posinf=0.0, neginf=0.0)

    try:
        from sklearn.ensemble import RandomForestClassifier
        rf2 = RandomForestClassifier(n_estimators=100, random_state=args.seed, n_jobs=-1)
        rf2.fit(X_vtrain_s, y_train)
        rf2_train_acc = accuracy_score(y_train, rf2.predict(X_vtrain_s))
        print(f"\n  RandomForest (value-only):")
        print(f"    Train Acc: {rf2_train_acc:.4f} ({rf2_train_acc*100:.1f}%)")
        if X_vtest_s is not None and len(X_vtest_s) > 0:
            rf2_test_acc = accuracy_score(y_test, rf2.predict(X_vtest_s))
            print(f"    Test Acc: {rf2_test_acc:.4f} ({rf2_test_acc*100:.1f}%)")
    except Exception as e:
        print(f"  RandomForest (value-only) 失败: {e}")

    # ─── 最终总结 ───
    print("\n" + "=" * 70)
    print("  诊断总结")
    print("=" * 70)
    print(f"  样本数={len(X_all)}, 类别数={n_classes}, 特征维度={X_flat.shape[1]}")
    print(f"  NaN={nan_pct:.1f}%, 零值={zero_pct:.1f}%, 零方差特征={zero_var_count}")
    print(f"  如果 sklearn 分类器 Train Acc 接近 100% 但 MLP 不行 → MLP 训练代码/超参问题")
    print(f"  如果 sklearn 分类器也很差 → 数据本身不可分，需要更多/更好的数据")
    print(f"  如果 sklearn Train Acc 高但 Test Acc 低 → 过拟合，样本太少")
    print()


if __name__ == "__main__":
    main()
