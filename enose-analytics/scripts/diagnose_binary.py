"""二分类测试 - 仅取最大的两个类别，排除类别过多的干扰"""
import numpy as np
import yaml
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import Counter
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

# DB config
cfg_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
with open(cfg_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f)
db = cfg["database"]
dsn = f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"

# Get labels for primary_liquid
with psycopg.connect(dsn, row_factory=dict_row) as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT s.id AS sample_id, s.run_id, sml.label_str
            FROM samples s
            JOIN sample_ml_labels sml ON s.id = sml.sample_id
            JOIN ml_label_configs mlc ON sml.config_id = mlc.id
            WHERE mlc.name = 'primary_liquid' AND sml.label_str IS NOT NULL
            ORDER BY s.run_id, s.id
        """)
        labels = cur.fetchall()

# Find top 2 classes
counter = Counter(l["label_str"] for l in labels)
top2 = [c[0] for c in counter.most_common(2)]
print(f"Top 2 classes: {top2}")
print(f"Counts: {counter[top2[0]]}, {counter[top2[1]]}")

# Filter to top 2
filtered = [l for l in labels if l["label_str"] in top2]
label_to_idx = {top2[0]: 0, top2[1]: 1}

# Check run distribution
run_dist: dict = {}
for l in filtered:
    key = (l["run_id"], l["label_str"])
    run_dist[key] = run_dist.get(key, 0) + 1
print(f"\nRun distribution:")
for (rid, lbl), cnt in sorted(run_dist.items()):
    print(f"  Run {rid}: {lbl} x{cnt}")

# Extract series (value channel only, 800 features)
X_list, y_list = [], []
for l in filtered:
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT run_id, start_time_ms, end_time_ms FROM samples WHERE id = %s",
                [l["sample_id"]],
            )
            s = cur.fetchone()
            if not s:
                continue
            end_ms = s["end_time_ms"] or 9999999999999
            cur.execute(
                """SELECT time_ms, sensor_idx, value FROM sensor_readings_v2
                   WHERE run_id = %s AND time_ms >= %s AND time_ms <= %s
                   ORDER BY sensor_idx, time_ms""",
                [s["run_id"], s["start_time_ms"], end_ms],
            )
            rows = cur.fetchall()
    if not rows:
        continue
    grid = np.linspace(0, 1, 100)
    channels = []
    for si in range(8):
        sr = [r for r in rows if r["sensor_idx"] == si]
        if len(sr) < 2:
            channels.append(np.zeros(100))
            continue
        t = np.array([r["time_ms"] for r in sr], dtype=np.float64)
        _, ui = np.unique(t, return_index=True)
        t = t[ui]
        v = np.array([sr[i]["value"] for i in ui], dtype=np.float64)
        d = t.max() - t.min()
        if d == 0:
            channels.append(np.full(100, v[0]))
            continue
        nt = (t - t.min()) / d
        f = interpolate.PchipInterpolator(nt, v, extrapolate=True)
        channels.append(f(grid))
    X_list.append(np.column_stack(channels).flatten())
    y_list.append(label_to_idx[l["label_str"]])

X = np.array(X_list)
y = np.array(y_list)
print(f"\nBinary dataset: {X.shape}, classes: {Counter(y.tolist())}")

# Split
sss = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
tr, te = next(sss.split(X, y))
sc = StandardScaler()
Xtr = sc.fit_transform(X[tr])
Xte = sc.transform(X[te])
Xtr = np.nan_to_num(Xtr)
Xte = np.nan_to_num(Xte)

print(f"Train: {len(tr)}, Test: {len(te)}")
print(f"Train class dist: {Counter(y[tr].tolist())}")
print(f"Test class dist:  {Counter(y[te].tolist())}")

# Test multiple classifiers
rf = RandomForestClassifier(100, random_state=42, n_jobs=-1)
rf.fit(Xtr, y[tr])
print(f"\nRF Train: {accuracy_score(y[tr], rf.predict(Xtr)):.1%}")
print(f"RF Test:  {accuracy_score(y[te], rf.predict(Xte)):.1%}")

lr = LogisticRegression(max_iter=2000, random_state=42)
lr.fit(Xtr, y[tr])
print(f"LR Train: {accuracy_score(y[tr], lr.predict(Xtr)):.1%}")
print(f"LR Test:  {accuracy_score(y[te], lr.predict(Xte)):.1%}")

# Also try with run-aware split (all samples from same run in same set)
print("\n--- Run-aware split (防止同 run 泄漏) ---")
run_ids_in_data = list(set(l["run_id"] for l in filtered))
run_ids_in_data.sort()
print(f"Total runs: {len(run_ids_in_data)}: {run_ids_in_data}")

# Simple: first 80% runs for train, last 20% for test
split_at = max(1, int(len(run_ids_in_data) * 0.8))
train_runs = set(run_ids_in_data[:split_at])
test_runs = set(run_ids_in_data[split_at:])
print(f"Train runs: {sorted(train_runs)}")
print(f"Test runs: {sorted(test_runs)}")

# Build run-aware indices
sample_to_run = {l["sample_id"]: l["run_id"] for l in filtered}
# Match X_list order with filtered order
run_aware_tr = []
run_aware_te = []
for i, l in enumerate(filtered):
    if i >= len(X_list):
        break
    if l["run_id"] in train_runs:
        run_aware_tr.append(i)
    else:
        run_aware_te.append(i)

if run_aware_te:
    Xtr2 = sc.fit_transform(X[run_aware_tr])
    Xte2 = sc.transform(X[run_aware_te])
    Xtr2 = np.nan_to_num(Xtr2)
    Xte2 = np.nan_to_num(Xte2)
    print(f"Train: {len(run_aware_tr)}, Test: {len(run_aware_te)}")
    print(f"Train class dist: {Counter(y[run_aware_tr].tolist())}")
    print(f"Test class dist:  {Counter(y[run_aware_te].tolist())}")

    rf2 = RandomForestClassifier(100, random_state=42, n_jobs=-1)
    rf2.fit(Xtr2, y[run_aware_tr])
    print(f"RF Train: {accuracy_score(y[run_aware_tr], rf2.predict(Xtr2)):.1%}")
    print(f"RF Test:  {accuracy_score(y[run_aware_te], rf2.predict(Xte2)):.1%}")

    lr2 = LogisticRegression(max_iter=2000, random_state=42)
    lr2.fit(Xtr2, y[run_aware_tr])
    print(f"LR Train: {accuracy_score(y[run_aware_tr], lr2.predict(Xtr2)):.1%}")
    print(f"LR Test:  {accuracy_score(y[run_aware_te], lr2.predict(Xte2)):.1%}")
else:
    print("No test runs available!")
