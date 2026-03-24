"""Run 105 混合实验探索性分析 v2

与 study_run93.py 使用一致的数据管线:
- PCHIP 对齐序列 (N, 100, 32) — 8 传感器 × 4 通道
- 多特征工程: value/norm/log/smooth/diff/stats/segment (14 种)
- 多分类器: LDA/SVM/RF/GBM/KNN/LR + StandardScaler pipeline
- 完整时序 NLDI (逐时间步计算而非均值)
"""

import numpy as np
import psycopg
from psycopg.rows import dict_row
import yaml
from pathlib import Path
from collections import defaultdict
from scipy import interpolate
from scipy.ndimage import uniform_filter1d
import warnings
warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════════════
# 常量
# ═══════════════════════════════════════════════════════════════
GOOD_SENSORS = [0, 1, 2, 4, 5, 6]
RUN_ID = 105
N_SAMPLES = 100  # PCHIP 对齐后时间步数
METHOD = "pchip"
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
# 0. 数据加载 — PCHIP 对齐 (复用 study_run93)
# ═══════════════════════════════════════════════════════════════

def extract_full_series(dsn, sample_id, n_samples=100, method="pchip"):
    """提取完整 32 通道对齐序列 (T, 32)"""
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT run_id, start_time_ms, end_time_ms FROM samples WHERE id = %s",
                [sample_id],
            )
            s = cur.fetchone()
            if not s:
                return None
            end_ms = s["end_time_ms"] or 9999999999999
            cur.execute(
                """SELECT time_ms, sensor_idx, value, temperature, humidity, pressure
                   FROM sensor_readings_v2
                   WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                   ORDER BY sensor_idx, time_ms""",
                [s["run_id"], s["start_time_ms"], end_ms],
            )
            rows = cur.fetchall()
    if not rows:
        return None

    grid = np.linspace(0, 1, n_samples)
    channels_names = ["value", "temperature", "humidity", "pressure"]
    resampled = {ch: {} for ch in channels_names}

    for si in range(8):
        sr = [r for r in rows if r["sensor_idx"] == si]
        if len(sr) < 2:
            for ch in channels_names:
                resampled[ch][si] = np.full(n_samples, np.nan)
            continue
        t = np.array([r["time_ms"] for r in sr], dtype=np.float64)
        _, ui = np.unique(t, return_index=True)
        t = t[ui]
        d = t.max() - t.min()
        if d == 0:
            for ch in channels_names:
                vals = [sr[i][ch] for i in ui]
                resampled[ch][si] = np.full(n_samples, vals[0] if vals else np.nan)
            continue
        nt = (t - t.min()) / d
        for ch in channels_names:
            vals = np.array([sr[i][ch] for i in ui], dtype=np.float64)
            try:
                if method == "pchip":
                    f = interpolate.PchipInterpolator(nt, vals, extrapolate=True)
                else:
                    f = interpolate.interp1d(nt, vals, kind="linear", fill_value="extrapolate")
                resampled[ch][si] = f(grid)
            except Exception:
                resampled[ch][si] = np.full(n_samples, np.nan)

    # 组装 (n_samples, 32): [8×value, 8×temp, 8×humidity, 8×pressure]
    all_columns = []
    for ch in channels_names:
        for i in range(8):
            all_columns.append(resampled[ch].get(i, np.full(n_samples, np.nan)))
    series = np.column_stack(all_columns)  # (T, 32)
    np.nan_to_num(series, copy=False, nan=0.0)
    return series


# ═══════════════════════════════════════════════════════════════
# 1. 特征工程 (复用 study_run93)
# ═══════════════════════════════════════════════════════════════

def _baseline_normalize(X, T):
    """基线归一化：用前 10% 时间步均值做除法"""
    bl = max(1, T // 10)
    baseline = X[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    return X / baseline


def _extract_stats(data_3d, sensor_indices, T):
    """从 (N, T, S) 数据提取统计特征 → (N, S*12)"""
    N = data_3d.shape[0]
    stats_list = []
    for i in range(N):
        sample_stats = []
        for si_pos in range(len(sensor_indices)):
            ch = data_3d[i, :, si_pos]
            sample_stats.extend([
                ch.mean(), ch.std(), ch.min(), ch.max(),
                ch.max() - ch.min(),
                np.percentile(ch, 25), np.percentile(ch, 75), np.median(ch),
                np.argmax(ch) / T, np.argmin(ch) / T,
                ch[-1] - ch[0],
                np.mean(np.abs(np.diff(ch))),
            ])
        stats_list.append(sample_stats)
    return np.array(stats_list)


def make_features(X_raw):
    """从原始 (N, T, 32) 数据构建多种特征表示"""
    N, T, C = X_raw.shape
    features = {}
    n_good = len(GOOD_SENSORS)

    X_value = X_raw[:, :, :8]
    X_no37 = X_value[:, :, GOOD_SENSORS]

    X_norm = _baseline_normalize(X_value, T)
    X_norm_no37 = _baseline_normalize(X_no37, T)

    X_log_no37 = np.log1p(np.abs(X_no37))
    X_log_norm_no37 = _baseline_normalize(X_log_no37, T)

    X_smooth_no37 = uniform_filter1d(X_no37, size=5, axis=1)
    X_smooth_norm_no37 = _baseline_normalize(X_smooth_no37, T)

    # ── Flatten 特征 ──
    features["value_8ch"] = {"X": X_value.reshape(N, -1), "desc": f"原始 value 8ch ({T}×8={T*8})"}
    features["value_no37"] = {"X": X_no37.reshape(N, -1), "desc": f"value 去3/7 ({T}×{n_good}={T*n_good})"}
    features["norm_8ch"] = {"X": X_norm.reshape(N, -1), "desc": f"基线归一化 8ch ({T}×8={T*8})"}
    features["norm_no37"] = {"X": X_norm_no37.reshape(N, -1), "desc": f"基线归一化 去3/7 ({T}×{n_good}={T*n_good})"}
    features["log_no37"] = {"X": X_log_no37.reshape(N, -1), "desc": f"log(1+|x|) 去3/7 ({T}×{n_good}={T*n_good})"}
    features["log_norm_no37"] = {"X": X_log_norm_no37.reshape(N, -1), "desc": f"log 基线归一化 去3/7 ({T}×{n_good}={T*n_good})"}
    features["smooth_norm_no37"] = {"X": X_smooth_norm_no37.reshape(N, -1), "desc": f"平滑+归一化 去3/7 ({T}×{n_good}={T*n_good})"}
    features["diff_no37"] = {"X": np.diff(X_no37, axis=1).reshape(N, -1), "desc": f"一阶差分 去3/7 ({T-1}×{n_good}={(T-1)*n_good})"}

    # ── 统计特征 ──
    features["stats_no37"] = {"X": _extract_stats(X_no37, GOOD_SENSORS, T), "desc": f"统计 去3/7 ({n_good}×12={n_good*12})"}
    features["norm_stats_no37"] = {"X": _extract_stats(X_norm_no37, GOOD_SENSORS, T), "desc": f"归一化统计 去3/7 ({n_good}×12={n_good*12})"}
    features["log_norm_stats_no37"] = {"X": _extract_stats(X_log_norm_no37, GOOD_SENSORS, T), "desc": f"log归一化统计 去3/7 ({n_good}×12={n_good*12})"}

    # ── 分段统计 ──
    n_segments = 5
    seg_len = T // n_segments
    for tag, data in [("seg_norm_no37", X_norm_no37), ("seg_smooth_norm_no37", X_smooth_norm_no37)]:
        seg_features = []
        for i in range(N):
            sample_feats = []
            for seg in range(n_segments):
                start = seg * seg_len
                end = start + seg_len if seg < n_segments - 1 else T
                for si in range(n_good):
                    ch_seg = data[i, start:end, si]
                    sample_feats.extend([ch_seg.mean(), ch_seg.std()])
            seg_features.append(sample_feats)
        features[tag] = {"X": np.array(seg_features), "desc": f"分段统计 ({n_segments}seg×{n_good}×2={n_segments*n_good*2})"}

    return features


# ═══════════════════════════════════════════════════════════════
# 2. 传统 ML 分类器 (复用 study_run93)
# ═══════════════════════════════════════════════════════════════

def run_ml_classifiers(features_dict, y, seed=42):
    """对每种特征表示，运行多种分类器的 5-fold CV"""
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import StratifiedKFold, cross_val_score
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.svm import SVC
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
    from sklearn.pipeline import Pipeline

    classifiers = {
        "LR": LogisticRegression(max_iter=5000, random_state=seed, C=1.0, solver="lbfgs"),
        "LDA": LinearDiscriminantAnalysis(),
        "KNN-3": KNeighborsClassifier(n_neighbors=3),
        "KNN-5": KNeighborsClassifier(n_neighbors=5),
        "SVM-linear": SVC(kernel="linear", C=1.0, random_state=seed),
        "SVM-rbf": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=seed),
        "RF-100": RandomForestClassifier(n_estimators=100, random_state=seed, n_jobs=-1),
        "RF-300": RandomForestClassifier(n_estimators=300, max_depth=10, random_state=seed, n_jobs=-1),
        "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=seed),
    }

    # 动态调整 n_splits
    unique_classes = np.unique(y)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    n_splits = min(5, min_class_count)
    if n_splits < 2:
        print(f"    最小类样本数={min_class_count}，无法做 CV")
        return {}

    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    results = {}

    for feat_name, feat_data in features_dict.items():
        X = feat_data["X"]
        desc = feat_data["desc"]
        results[feat_name] = {"desc": desc, "scores": {}}

        for clf_name, clf in classifiers.items():
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
            try:
                scores = cross_val_score(pipe, X, y, cv=skf, scoring="accuracy")
                results[feat_name]["scores"][clf_name] = {
                    "mean": scores.mean(), "std": scores.std(), "folds": scores,
                }
            except Exception as e:
                results[feat_name]["scores"][clf_name] = {
                    "mean": 0.0, "std": 0.0, "folds": [], "error": str(e),
                }

    return results


# ═══════════════════════════════════════════════════════════════
# 3. 查询样本信息 + 加载对齐序列
# ═══════════════════════════════════════════════════════════════

def query_and_load(dsn):
    """查询 Run 105 所有样本，用 PCHIP 对齐加载为 (N, T, 32)"""
    print("=" * 70)
    print(f"  Run {RUN_ID} 数据加载 (PCHIP 对齐, {N_SAMPLES} 时间步, 32 通道)")
    print("=" * 70)

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, program_name, created_at FROM runs WHERE id = %s", (RUN_ID,))
            run = cur.fetchone()
            if not run:
                print(f"  Run {RUN_ID} 不存在！")
                return None
            print(f"  程序: {run['program_name']}  创建: {run['created_at']}")

            cur.execute("""
                SELECT id, sample_idx, liquid_names, liquid_ratios,
                       start_time_ms, end_time_ms
                FROM samples WHERE run_id = %s ORDER BY sample_idx
            """, (RUN_ID,))
            samples = cur.fetchall()
            print(f"  总样本数: {len(samples)}")

    # 为每个样本加载对齐序列
    series_list = []
    meta_list = []
    skipped = 0
    for i, s in enumerate(samples):
        if (i + 1) % 20 == 0:
            print(f"  加载进度: {i+1}/{len(samples)}...")
        ser = extract_full_series(dsn, s["id"], N_SAMPLES, METHOD)
        if ser is None:
            skipped += 1
            continue
        series_list.append(ser)

        names = list(s["liquid_names"]) if s["liquid_names"] else []
        ratios = list(s["liquid_ratios"]) if s["liquid_ratios"] else [1.0]
        is_pure = len(names) == 1
        combo_key = tuple(sorted(names))

        meta_list.append({
            "sid": s["id"], "idx": s["sample_idx"],
            "names": names, "ratios": ratios,
            "is_pure": is_pure, "combo_key": combo_key,
        })

    X_raw = np.array(series_list)  # (N, T, 32)
    print(f"  加载完成: {X_raw.shape} (跳过 {skipped} 个)")

    # 打印概况
    combo_counts = defaultdict(list)
    for i, m in enumerate(meta_list):
        combo_counts[m["combo_key"]].append(i)

    print(f"\n  {'组合':<40} {'样本':>4}")
    print("  " + "-" * 50)
    for combo, indices in sorted(combo_counts.items(), key=lambda x: -len(x[1])):
        label = " + ".join([short(c) for c in combo])
        print(f"  {label:<40} {len(indices):>4}")

    # 比例分布
    print(f"\n  比例分布:")
    ratio_dist = defaultdict(int)
    for m in meta_list:
        rkey = tuple([f"{r:.0%}" for r in m["ratios"]])
        ratio_dist[rkey] += 1
    for rkey, cnt in sorted(ratio_dist.items()):
        print(f"    {':'.join(rkey)} → {cnt}")

    return X_raw, meta_list, combo_counts


# ═══════════════════════════════════════════════════════════════
# 4. NLDI 分析 (使用完整时序)
# ═══════════════════════════════════════════════════════════════

def analyze_nldi(X_raw, meta_list, combo_counts):
    """使用完整对齐序列计算 NLDI"""
    print("\n" + "=" * 70)
    print("  NLDI 分析 (基于完整时序, good sensors)")
    print("=" * 70)

    T = X_raw.shape[1]
    n_good = len(GOOD_SENSORS)

    # 提取 good sensors 的 value 通道 + 基线归一化
    X_good = X_raw[:, :, GOOD_SENSORS]  # (N, T, 6) value channels of good sensors
    X_norm = _baseline_normalize(X_good[np.newaxis] if X_good.ndim == 2 else X_good, T)

    # 收集纯样和混合样
    pure_indices = defaultdict(list)  # liq -> [sample_indices]
    binary_data = defaultdict(lambda: defaultdict(list))  # (liq_a, liq_b) -> alpha -> [indices]

    for i, m in enumerate(meta_list):
        if m["is_pure"] and len(m["names"]) == 1:
            pure_indices[m["names"][0]].append(i)
        elif len(m["names"]) == 2:
            combo = tuple(sorted(m["names"]))
            liq_a, liq_b = combo
            # 确定 alpha (liq_a 的比例)
            if m["names"][0] == liq_a:
                alpha = m["ratios"][0]
            else:
                alpha = m["ratios"][1]
            binary_data[combo][alpha].append(i)

    # 纯样统计
    print(f"\n  纯样均值 (归一化 good sensors, 整个序列均值):")
    pure_series = {}  # liq -> mean series (T, 6)
    for liq in sorted(pure_indices.keys()):
        idxs = pure_indices[liq]
        mean_series = X_norm[idxs].mean(axis=0)  # (T, 6)
        pure_series[liq] = mean_series
        overall_mean = mean_series.mean(axis=0)  # (6,)
        vals = ", ".join([f"S{GOOD_SENSORS[j]}={overall_mean[j]:.4f}" for j in range(n_good)])
        print(f"    {short(liq)}: [{vals}] (n={len(idxs)})")

    # 对每个二元组合计算 NLDI
    nldi_results = {}
    for combo in sorted(binary_data.keys()):
        liq_a, liq_b = combo
        if liq_a not in pure_series or liq_b not in pure_series:
            continue

        r_a = pure_series[liq_a]  # (T, 6)
        r_b = pure_series[liq_b]  # (T, 6)
        ratio_data = binary_data[combo]

        sa, sb = short(liq_a), short(liq_b)
        print(f"\n  ─── {sa} + {sb} ───")

        nldi_per_alpha = []
        for alpha in sorted(ratio_data.keys()):
            idxs = ratio_data[alpha]
            r_actual = X_norm[idxs].mean(axis=0)  # (T, 6)
            r_pred = alpha * r_a + (1 - alpha) * r_b  # (T, 6)

            # 逐时间步逐通道 NLDI
            rel_dev = np.abs(r_actual - r_pred) / (np.abs(r_pred) + 1e-8)  # (T, 6)
            nldi_val = rel_dev.mean()
            nldi_per_alpha.append(nldi_val)

            # 交互比
            ir = r_actual.mean(axis=0) / (r_pred.mean(axis=0) + 1e-8)  # (6,)
            types = ["↑" if v > 1.1 else "↓" if v < 0.9 else "≈" for v in ir]
            print(f"    α={alpha:.0%}: NLDI={nldi_val:.4f} [{' '.join(types)}] (n={len(idxs)})")

        overall = np.mean(nldi_per_alpha)
        itype = "近似可加" if overall < 0.05 else "弱非线性" if overall < 0.15 else "强非线性"
        print(f"    → 整体NLDI={overall:.4f} ({itype})")
        nldi_results[combo] = {"nldi": overall, "type": itype}

    # 汇总
    if nldi_results:
        print(f"\n  {'='*50}")
        print(f"  NLDI 汇总 (降序)")
        print(f"  {'组合':<30} {'NLDI':>8} {'类型':<12}")
        print(f"  {'-'*50}")
        for combo, res in sorted(nldi_results.items(), key=lambda x: -x[1]["nldi"]):
            label = f"{short(combo[0])}+{short(combo[1])}"
            print(f"  {label:<30} {res['nldi']:>8.4f} {res['type']:<12}")

    return nldi_results


# ═══════════════════════════════════════════════════════════════
# 5. PCA 分析 (使用完整特征)
# ═══════════════════════════════════════════════════════════════

def pca_analysis(X_raw, meta_list):
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler

    print("\n" + "=" * 70)
    print("  PCA 分析 (log_norm_no37 特征)")
    print("=" * 70)

    T = X_raw.shape[1]
    n_good = len(GOOD_SENSORS)

    # 使用 log_norm_no37 特征 (与分类最佳特征一致)
    X_no37 = X_raw[:, :, GOOD_SENSORS]
    X_log = np.log1p(np.abs(X_no37))
    X_log_norm = _baseline_normalize(X_log, T)
    X_flat = X_log_norm.reshape(X_raw.shape[0], -1)  # (N, 600)

    sc = StandardScaler()
    X_scaled = sc.fit_transform(X_flat)

    pca = PCA(n_components=10)
    X_pca = pca.fit_transform(X_scaled)
    evr = pca.explained_variance_ratio_
    cumsum = np.cumsum(evr)
    print(f"  特征维度: {X_flat.shape}")
    print(f"  前 10 PC 方差解释: {', '.join([f'{v:.1%}' for v in evr])}")
    print(f"  累计: {', '.join([f'{v:.1%}' for v in cumsum])}")

    # 纯样 PC 空间距离
    pure_indices = defaultdict(list)
    for i, m in enumerate(meta_list):
        if m["is_pure"]:
            pure_indices[m["names"][0]].append(i)

    if pure_indices:
        print(f"\n  纯样 PC 空间 (3D) 距离矩阵:")
        pure_pcs = {}
        for liq, idxs in sorted(pure_indices.items()):
            pure_pcs[liq] = X_pca[idxs, :3].mean(axis=0)

        names = sorted(pure_pcs.keys())
        header = "           " + "  ".join([f"{short(n):>8}" for n in names])
        print(f"  {header}")
        for n1 in names:
            row = f"  {short(n1):>10}"
            for n2 in names:
                d = np.linalg.norm(pure_pcs[n1] - pure_pcs[n2])
                row += f"  {d:>8.4f}"
            print(row)

    # 混合轨迹
    binary_data = defaultdict(lambda: defaultdict(list))
    for i, m in enumerate(meta_list):
        if len(m["names"]) == 2:
            combo = tuple(sorted(m["names"]))
            liq_a = combo[0]
            alpha = m["ratios"][0] if m["names"][0] == liq_a else m["ratios"][1]
            binary_data[combo][alpha].append(i)
        elif m["is_pure"]:
            # 纯样也加入
            for combo_key in binary_data.keys():
                pass  # 后面统一处理

    print(f"\n  混合轨迹 (PC1 vs PC2):")
    for combo in sorted(binary_data.keys()):
        liq_a, liq_b = combo
        sa, sb = short(liq_a), short(liq_b)
        print(f"  ─── {sa} + {sb} ───")

        # 纯样端点
        if liq_a in pure_indices:
            pc = X_pca[pure_indices[liq_a], :3].mean(axis=0)
            print(f"    {sa}=100%: PC1={pc[0]:>7.3f}  PC2={pc[1]:>7.3f}  PC3={pc[2]:>7.3f} (n={len(pure_indices[liq_a])})")
        for alpha in sorted(binary_data[combo].keys()):
            idxs = binary_data[combo][alpha]
            pc = X_pca[idxs, :3].mean(axis=0)
            print(f"    {sa}={alpha:.0%}: PC1={pc[0]:>7.3f}  PC2={pc[1]:>7.3f}  PC3={pc[2]:>7.3f} (n={len(idxs)})")
        if liq_b in pure_indices:
            pc = X_pca[pure_indices[liq_b], :3].mean(axis=0)
            print(f"    {sb}=100%: PC1={pc[0]:>7.3f}  PC2={pc[1]:>7.3f}  PC3={pc[2]:>7.3f} (n={len(pure_indices[liq_b])})")


# ═══════════════════════════════════════════════════════════════
# 6. 分类测试
# ═══════════════════════════════════════════════════════════════

def classification_tasks(X_raw, meta_list):
    print("\n" + "=" * 70)
    print("  分类测试 (多特征 + 多分类器)")
    print("=" * 70)

    # ── 任务 A: 纯样 5 类分类 (对照组 — 应与 study_run93 结果一致) ──
    pure_mask = [m["is_pure"] for m in meta_list]
    pure_indices = [i for i, p in enumerate(pure_mask) if p]

    if len(pure_indices) >= 10:
        X_pure = X_raw[pure_indices]
        y_pure = np.array([meta_list[i]["names"][0] for i in pure_indices])
        unique_pure = sorted(set(y_pure))
        label_map = {name: idx for idx, name in enumerate(unique_pure)}
        y_pure_idx = np.array([label_map[y] for y in y_pure])

        print(f"\n  === 任务 A: 纯样 5 类分类 (对照, {len(pure_indices)} 样本) ===")
        for name in unique_pure:
            print(f"    {short(name)}: {np.sum(y_pure == name)}")

        features = make_features(X_pure)
        print(f"\n  特征工程:")
        for name, fdata in features.items():
            print(f"    {name}: {fdata['X'].shape} — {fdata['desc']}")

        ml_results = run_ml_classifiers(features, y_pure_idx)
        _print_ml_top(ml_results, "纯样 5 类", len(unique_pure))

    # ── 任务 B: 10 组合分类 (仅混合样) ──
    mix_indices = [i for i in range(len(meta_list)) if not meta_list[i]["is_pure"]]
    if len(mix_indices) >= 10:
        X_mix = X_raw[mix_indices]
        y_combo = []
        for i in mix_indices:
            m = meta_list[i]
            combo = tuple(sorted(m["names"]))
            y_combo.append(f"{short(combo[0])}+{short(combo[1])}")
        y_combo = np.array(y_combo)
        unique_combos = sorted(set(y_combo))
        label_map = {name: idx for idx, name in enumerate(unique_combos)}
        y_combo_idx = np.array([label_map[y] for y in y_combo])

        print(f"\n  === 任务 B: 10 组合分类 (仅混合样, {len(mix_indices)} 样本, {len(unique_combos)} 类) ===")
        for name in unique_combos:
            print(f"    {name}: {np.sum(y_combo == name)}")

        features = make_features(X_mix)
        ml_results = run_ml_classifiers(features, y_combo_idx)
        _print_ml_top(ml_results, "10 组合分类", len(unique_combos))

    # ── 任务 C: 比例区间分类 (仅混合样, 3类: 25%/50%/75%) ──
    if len(mix_indices) >= 10:
        y_ratio_bin = []
        for i in mix_indices:
            m = meta_list[i]
            r = max(m["ratios"])  # 主成分比例
            if r >= 0.7:
                y_ratio_bin.append("75%")
            elif r >= 0.4:
                y_ratio_bin.append("50%")
            else:
                y_ratio_bin.append("25%")
        y_ratio_bin = np.array(y_ratio_bin)
        unique_bins = sorted(set(y_ratio_bin))
        label_map = {name: idx for idx, name in enumerate(unique_bins)}
        y_ratio_idx = np.array([label_map[y] for y in y_ratio_bin])

        print(f"\n  === 任务 C: 比例区间分类 (仅混合样, {len(unique_bins)} 类) ===")
        for b in unique_bins:
            print(f"    {b}: {np.sum(y_ratio_bin == b)}")

        ml_results = run_ml_classifiers(features, y_ratio_idx)
        _print_ml_top(ml_results, "比例区间分类", len(unique_bins))

    # ── 任务 D: 全样本 15 类分类 (5 纯 + 10 混合组合) ──
    y_all = []
    for m in meta_list:
        if m["is_pure"]:
            y_all.append(f"纯-{short(m['names'][0])}")
        else:
            combo = tuple(sorted(m["names"]))
            y_all.append(f"{short(combo[0])}+{short(combo[1])}")
    y_all = np.array(y_all)
    unique_all = sorted(set(y_all))
    label_map = {name: idx for idx, name in enumerate(unique_all)}
    y_all_idx = np.array([label_map[y] for y in y_all])

    print(f"\n  === 任务 D: 全样本 {len(unique_all)} 类分类 ({len(meta_list)} 样本) ===")
    for name in unique_all:
        print(f"    {name}: {np.sum(y_all == name)}")

    features = make_features(X_raw)
    ml_results = run_ml_classifiers(features, y_all_idx)
    _print_ml_top(ml_results, f"全样本 {len(unique_all)} 类", len(unique_all))


def _print_ml_top(ml_results, task_name, n_classes, top_k=10):
    """打印 ML 分类器 Top-K 结果"""
    if not ml_results:
        print(f"  {task_name}: 无结果")
        return

    all_combos = []
    for feat_name, res in ml_results.items():
        for clf_name, score in res["scores"].items():
            if score.get("error"):
                continue
            all_combos.append((score["mean"], score["std"], feat_name, clf_name, score.get("folds", [])))
    all_combos.sort(key=lambda x: -x[0])

    random_baseline = 1.0 / n_classes
    print(f"\n  {task_name} Top-{min(top_k, len(all_combos))} (随机基线={random_baseline:.1%}):")
    print(f"  {'Rank':<5} {'Feature':<25} {'Classifier':<15} {'Acc':>8} {'Std':>8}")
    print(f"  {'-'*65}")
    for rank, (mean, std, feat, clf, folds) in enumerate(all_combos[:top_k], 1):
        folds_str = ""
        if len(folds) > 0:
            folds_str = f"  [{', '.join(f'{s:.0%}' for s in folds)}]"
        print(f"  {rank:<5} {feat:<25} {clf:<15} {mean:>7.1%} ±{std:>5.1%}{folds_str}")

    if all_combos:
        best = all_combos[0]
        print(f"\n  >>> 最佳: {best[0]:.1%} ({best[2]}+{best[3]})  随机基线: {random_baseline:.1%}")


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

def main():
    dsn = load_dsn()

    result = query_and_load(dsn)
    if result is None:
        return
    X_raw, meta_list, combo_counts = result

    # NLDI
    analyze_nldi(X_raw, meta_list, combo_counts)

    # PCA
    pca_analysis(X_raw, meta_list)

    # 分类
    classification_tasks(X_raw, meta_list)


if __name__ == "__main__":
    main()
