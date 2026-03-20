"""按 run 分组调查标签分布，并在同组 run 内做可分性验证"""
import numpy as np
import yaml
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import Counter, defaultdict
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score


def load_dsn():
    cfg_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


def get_all_labels(dsn, config_name):
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id AS sample_id, s.run_id, s.sample_idx, s.phase_name,
                       sml.label_str, sml.label_index,
                       s.run_id AS run_name
                FROM samples s
                JOIN sample_ml_labels sml ON s.id = sml.sample_id
                JOIN ml_label_configs mlc ON sml.config_id = mlc.id
                WHERE mlc.name = %s AND sml.label_str IS NOT NULL
                ORDER BY s.run_id, s.sample_idx
            """, [config_name])
            return cur.fetchall()


def extract_value_series(dsn, sample_id, n_samples=100):
    """提取 value 通道对齐序列 (100, 8) → flatten (800,)"""
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
                """SELECT time_ms, sensor_idx, value FROM sensor_readings_v2
                   WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                   ORDER BY sensor_idx, time_ms""",
                [s["run_id"], s["start_time_ms"], end_ms],
            )
            rows = cur.fetchall()
    if not rows:
        return None

    grid = np.linspace(0, 1, n_samples)
    channels = []
    for si in range(8):
        sr = [r for r in rows if r["sensor_idx"] == si]
        if len(sr) < 2:
            channels.append(np.zeros(n_samples))
            continue
        t = np.array([r["time_ms"] for r in sr], dtype=np.float64)
        _, ui = np.unique(t, return_index=True)
        t = t[ui]
        v = np.array([sr[i]["value"] for i in ui], dtype=np.float64)
        d = t.max() - t.min()
        if d == 0:
            channels.append(np.full(n_samples, v[0]))
            continue
        nt = (t - t.min()) / d
        try:
            f = interpolate.PchipInterpolator(nt, v, extrapolate=True)
            channels.append(f(grid))
        except Exception:
            channels.append(np.zeros(n_samples))
    return np.column_stack(channels).flatten()  # (800,)


def test_group(dsn, group_labels, group_name):
    """在一组 run 内做分类可分性测试"""
    # 构建 label mapping
    unique_labels = sorted(set(l["label_str"] for l in group_labels))
    if len(unique_labels) < 2:
        print(f"    ⚠️ 只有 {len(unique_labels)} 个类别，跳过")
        return
    label_to_idx = {name: i for i, name in enumerate(unique_labels)}

    X_list, y_list = [], []
    for l in group_labels:
        series = extract_value_series(dsn, l["sample_id"])
        if series is not None:
            X_list.append(series)
            y_list.append(label_to_idx[l["label_str"]])

    if len(X_list) < 5:
        print(f"    ⚠️ 有效样本数只有 {len(X_list)}，跳过")
        return

    X = np.array(X_list)
    y = np.array(y_list)

    print(f"    样本数: {len(X)}, 类别数: {len(unique_labels)}, 特征维度: {X.shape[1]}")
    for cls_idx, name in enumerate(unique_labels):
        cnt = (y == cls_idx).sum()
        print(f"      [{cls_idx}] {name}: {cnt}")

    # StandardScaler
    sc = StandardScaler()
    X_scaled = sc.fit_transform(X)
    X_scaled = np.nan_to_num(X_scaled, nan=0.0, posinf=0.0, neginf=0.0)

    # 检查最小类样本数
    min_class_count = min(Counter(y.tolist()).values())
    n_splits = min(5, min_class_count)
    if n_splits < 2:
        print(f"    ⚠️ 最小类样本数={min_class_count}，无法交叉验证")
        # 只做 train accuracy
        rf = RandomForestClassifier(100, random_state=42, n_jobs=-1)
        rf.fit(X_scaled, y)
        print(f"    RF Train Acc: {accuracy_score(y, rf.predict(X_scaled)):.1%}")
        return

    # K-fold cross-validation
    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

    rf_scores = cross_val_score(
        RandomForestClassifier(100, random_state=42, n_jobs=-1),
        X_scaled, y, cv=skf, scoring="accuracy",
    )
    lr_scores = cross_val_score(
        LogisticRegression(max_iter=2000, random_state=42),
        X_scaled, y, cv=skf, scoring="accuracy",
    )

    random_baseline = max(Counter(y.tolist()).values()) / len(y)
    print(f"    随机基线: {random_baseline:.1%}")
    print(f"    RF {n_splits}-fold CV: {rf_scores.mean():.1%} ± {rf_scores.std():.1%}  (folds: {', '.join(f'{s:.1%}' for s in rf_scores)})")
    print(f"    LR {n_splits}-fold CV: {lr_scores.mean():.1%} ± {lr_scores.std():.1%}  (folds: {', '.join(f'{s:.1%}' for s in lr_scores)})")


def main():
    dsn = load_dsn()

    for config_name in ["primary_liquid", "liquid_identity"]:
        print("=" * 70)
        print(f"  标签策略: {config_name}")
        print("=" * 70)

        labels = get_all_labels(dsn, config_name)
        if not labels:
            print("  无标签")
            continue

        # 按 run 分组
        run_groups: dict[int, list] = defaultdict(list)
        for l in labels:
            run_groups[l["run_id"]].append(l)

        print(f"\n  共 {len(labels)} 个标签, {len(run_groups)} 个 run\n")

        # 打印每个 run 的信息
        print("  Run 概览:")
        for rid in sorted(run_groups.keys()):
            group = run_groups[rid]
            run_name = group[0].get("run_name", "?")
            label_dist = Counter(l["label_str"] for l in group)
            labels_str = ", ".join(f"{name}×{cnt}" for name, cnt in sorted(label_dist.items()))
            print(f"    Run {rid} ({run_name}): {len(group)} samples → {labels_str}")

        # 用户指定的分组测试
        print("\n" + "-" * 70)
        print("  按实验组测试可分性 (同传感器配置)")
        print("-" * 70)

        # 东方树叶组: run 90, 91, 93
        dongfang_runs = {90, 91, 93}
        dongfang_labels = [l for l in labels if l["run_id"] in dongfang_runs]
        if dongfang_labels:
            print(f"\n  [东方树叶组] Runs {sorted(dongfang_runs)}:")
            test_group(dsn, dongfang_labels, "东方树叶")

        # 茶汤组: run 87
        chatang_runs = {87}
        chatang_labels = [l for l in labels if l["run_id"] in chatang_runs]
        if chatang_labels:
            print(f"\n  [茶汤组] Run {sorted(chatang_runs)}:")
            test_group(dsn, chatang_labels, "茶汤")

        # 伯爵茶+水混合组: run 65, 68, 69, 70
        earl_runs = {65, 68, 69, 70}
        earl_labels = [l for l in labels if l["run_id"] in earl_runs]
        if earl_labels:
            print(f"\n  [伯爵茶混合组] Runs {sorted(earl_runs)}:")
            test_group(dsn, earl_labels, "伯爵茶")

        # 自动发现：每个 run 独立测试（只测样本 >= 5 且类别 >= 2 的 run）
        print(f"\n  [各 run 独立测试]:")
        for rid in sorted(run_groups.keys()):
            group = run_groups[rid]
            unique_in_run = set(l["label_str"] for l in group)
            if len(group) >= 5 and len(unique_in_run) >= 2:
                run_name = group[0].get("run_name", "?")
                print(f"\n  Run {rid} ({run_name}):")
                test_group(dsn, group, f"run_{rid}")

        print()


if __name__ == "__main__":
    main()
