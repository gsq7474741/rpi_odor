"""多 Run 液体分类全面研究

目标: 验证东方树叶 5 类液体分类在当前传感器配置下是否可行
数据: Run 93/97/99 (同配置)

研究内容:
1. 数据探索 + per-run 分布对比
2. 多种特征表示方法 (去 Sensor 3/7, log, 平滑, 归一化等)
3. 传统 ML 分类器 (RF, SVM, KNN, LR, GBM, LDA)
4. 深度学习模型 (MLP, 1D-CNN, TCN, Transformer)
5. 综合结论
"""

import numpy as np
import yaml
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from scipy import interpolate
from collections import Counter
from itertools import combinations
import torch
import torch.nn as nn
import warnings
warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════════════
# 0. 数据加载
# ═══════════════════════════════════════════════════════════════

def load_dsn():
    cfg_path = Path(__file__).parent.parent / "config" / "analytics.yaml"
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    db = cfg["database"]
    return f"postgresql://{db['user']}:{db['password']}@{db['host']}:{db['port']}/{db['database']}"


def load_multi_run_data(dsn, run_ids, n_samples=100, method="pchip"):
    """加载多个 Run 的全部样本对齐序列和标签"""
    placeholders = ",".join(["%s"] * len(run_ids))
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT s.id AS sample_id, s.sample_idx, s.run_id, sml.label_str
                FROM samples s
                JOIN sample_ml_labels sml ON s.id = sml.sample_id
                JOIN ml_label_configs mlc ON sml.config_id = mlc.id
                WHERE mlc.name = 'primary_liquid' AND s.run_id IN ({placeholders})
                  AND sml.label_str IS NOT NULL
                ORDER BY s.run_id, s.sample_idx
            """, run_ids)
            labels = cur.fetchall()

    class_names = sorted(set(l["label_str"] for l in labels))
    label_to_idx = {name: i for i, name in enumerate(class_names)}

    X_raw = []  # (N, T, 32) 原始 32 通道
    y_list = []
    sample_ids = []
    run_id_list = []  # 记录每个样本属于哪个 run

    for l in labels:
        series = extract_full_series(dsn, l["sample_id"], n_samples, method)
        if series is not None:
            X_raw.append(series)
            y_list.append(label_to_idx[l["label_str"]])
            sample_ids.append(l["sample_id"])
            run_id_list.append(l["run_id"])

    X_raw = np.array(X_raw)  # (N, T, 32)
    y = np.array(y_list)
    run_ids_arr = np.array(run_id_list)
    return X_raw, y, class_names, sample_ids, run_ids_arr


def extract_full_series(dsn, sample_id, n_samples, method):
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
# 1. 特征工程：多种特征表示
# ═══════════════════════════════════════════════════════════════

GOOD_SENSORS = [0, 1, 2, 4, 5, 6]  # 排除 HP354 动态加热的 Sensor 3/7


def _extract_stats(data_3d, sensor_indices, T):
    """从 (N, T, S) 数据提取统计特征 → (N, S*12)"""
    N = data_3d.shape[0]
    stats_list = []
    for i in range(N):
        sample_stats = []
        for si_pos, si in enumerate(sensor_indices):
            ch = data_3d[i, :, si_pos] if si_pos < data_3d.shape[2] else data_3d[i, :, si]
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


def _baseline_normalize(X, T):
    """基线归一化：用前 10% 时间步均值做除法"""
    bl = max(1, T // 10)
    baseline = X[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    return X / baseline


def _moving_average(X, window=5):
    """时间轴移动平均平滑"""
    from scipy.ndimage import uniform_filter1d
    return uniform_filter1d(X, size=window, axis=1)


def make_features(X_raw, class_names):
    """从原始 (N, T, 32) 数据构建多种特征表示"""
    N, T, C = X_raw.shape
    features = {}

    X_value = X_raw[:, :, :8]  # (N, T, 8) 全部 value 通道
    X_no37 = X_value[:, :, GOOD_SENSORS]  # (N, T, 6) 去除 Sensor 3/7
    n_good = len(GOOD_SENSORS)

    # ── 基线归一化 ──
    X_norm = _baseline_normalize(X_value, T)
    X_norm_no37 = _baseline_normalize(X_no37, T)

    # ── Log 变换 (log(1 + x)) ──
    X_log = np.log1p(np.abs(X_value))
    X_log_no37 = np.log1p(np.abs(X_no37))
    X_log_norm = _baseline_normalize(X_log, T)
    X_log_norm_no37 = _baseline_normalize(X_log_no37, T)

    # ── 移动平均平滑 ──
    X_smooth = _moving_average(X_value, window=5)
    X_smooth_no37 = _moving_average(X_no37, window=5)
    X_smooth_norm = _baseline_normalize(X_smooth, T)
    X_smooth_norm_no37 = _baseline_normalize(X_smooth_no37, T)

    # ── 差分 ──
    X_diff = np.diff(X_value, axis=1)
    X_diff_no37 = np.diff(X_no37, axis=1)

    # ═══════ Flatten 特征 ═══════
    features["value_8ch"] = {
        "X": X_value.reshape(N, -1),
        "desc": f"原始 value 8ch ({T}×8={T*8})",
    }
    features["value_no37"] = {
        "X": X_no37.reshape(N, -1),
        "desc": f"value 去3/7 ({T}×{n_good}={T*n_good})",
    }
    features["norm_8ch"] = {
        "X": X_norm.reshape(N, -1),
        "desc": f"基线归一化 8ch ({T}×8={T*8})",
    }
    features["norm_no37"] = {
        "X": X_norm_no37.reshape(N, -1),
        "desc": f"基线归一化 去3/7 ({T}×{n_good}={T*n_good})",
    }
    features["log_no37"] = {
        "X": X_log_no37.reshape(N, -1),
        "desc": f"log(1+|x|) 去3/7 ({T}×{n_good}={T*n_good})",
    }
    features["log_norm_no37"] = {
        "X": X_log_norm_no37.reshape(N, -1),
        "desc": f"log 基线归一化 去3/7 ({T}×{n_good}={T*n_good})",
    }
    features["smooth_norm_no37"] = {
        "X": X_smooth_norm_no37.reshape(N, -1),
        "desc": f"平滑+归一化 去3/7 ({T}×{n_good}={T*n_good})",
    }
    features["diff_no37"] = {
        "X": X_diff_no37.reshape(N, -1),
        "desc": f"一阶差分 去3/7 ({T-1}×{n_good}={(T-1)*n_good})",
    }

    # ═══════ 统计特征 ═══════
    features["stats_8ch"] = {
        "X": _extract_stats(X_value, list(range(8)), T),
        "desc": f"统计 8ch (8×12=96)",
    }
    features["stats_no37"] = {
        "X": _extract_stats(X_no37, list(range(n_good)), T),
        "desc": f"统计 去3/7 ({n_good}×12={n_good*12})",
    }
    features["norm_stats_no37"] = {
        "X": _extract_stats(X_norm_no37, list(range(n_good)), T),
        "desc": f"归一化统计 去3/7 ({n_good}×12={n_good*12})",
    }
    features["log_norm_stats_no37"] = {
        "X": _extract_stats(X_log_norm_no37, list(range(n_good)), T),
        "desc": f"log归一化统计 去3/7 ({n_good}×12={n_good*12})",
    }

    # ═══════ 分段统计 ═══════
    n_segments = 5
    seg_len = T // n_segments
    for tag, data, s_idx in [
        ("seg_norm_no37", X_norm_no37, list(range(n_good))),
        ("seg_smooth_norm_no37", X_smooth_norm_no37, list(range(n_good))),
    ]:
        seg_features = []
        ns = len(s_idx)
        for i in range(N):
            sample_feats = []
            for seg in range(n_segments):
                start = seg * seg_len
                end = start + seg_len if seg < n_segments - 1 else T
                for si in range(ns):
                    ch_seg = data[i, start:end, si]
                    sample_feats.extend([ch_seg.mean(), ch_seg.std()])
            seg_features.append(sample_feats)
        features[tag] = {
            "X": np.array(seg_features),
            "desc": f"分段统计 ({n_segments}seg×{ns}×2={n_segments*ns*2})",
        }

    return features


# ═══════════════════════════════════════════════════════════════
# 2. 传统 ML 分类器
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

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    results = {}

    for feat_name, feat_data in features_dict.items():
        X = feat_data["X"]
        desc = feat_data["desc"]
        results[feat_name] = {"desc": desc, "scores": {}}

        for clf_name, clf in classifiers.items():
            pipe = Pipeline([
                ("scaler", StandardScaler()),
                ("clf", clf),
            ])
            try:
                scores = cross_val_score(pipe, X, y, cv=skf, scoring="accuracy")
                results[feat_name]["scores"][clf_name] = {
                    "mean": scores.mean(),
                    "std": scores.std(),
                    "folds": scores,
                }
            except Exception as e:
                results[feat_name]["scores"][clf_name] = {
                    "mean": 0.0, "std": 0.0, "folds": [], "error": str(e),
                }

    return results


# ═══════════════════════════════════════════════════════════════
# 3. 深度学习模型
# ═══════════════════════════════════════════════════════════════

def run_dl_models(X_raw, y, class_names, seed=42):
    """运行深度学习模型的 5-fold CV"""
    from sklearn.model_selection import StratifiedKFold
    from sklearn.preprocessing import StandardScaler

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    n_classes = len(class_names)
    N, T, C = X_raw.shape  # (50, 100, 32)
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)

    results = {}

    # --- 准备不同输入 ---
    X_value = X_raw[:, :, :8].astype(np.float32)
    X_no37 = X_value[:, :, GOOD_SENSORS].astype(np.float32)
    n_good = len(GOOD_SENSORS)

    bl = max(1, T // 10)

    def _norm(X):
        baseline = X[:, :bl, :].mean(axis=1, keepdims=True)
        baseline = np.where(baseline == 0, 1.0, baseline)
        return (X / baseline).astype(np.float32)

    X_norm = _norm(X_value)
    X_norm_no37 = _norm(X_no37)
    X_log_norm_no37 = _norm(np.log1p(np.abs(X_no37)).astype(np.float32))

    # 所有 DL 配置: (name, model_type, X_input_3d_or_2d)
    # seq models 输入 (N, T, C), mlp 输入 (N, T*C)
    dl_configs = [
        # MLP 变体
        ("MLP-norm-8ch",       "mlp", X_norm.reshape(N, -1)),
        ("MLP-norm-no37",      "mlp", X_norm_no37.reshape(N, -1)),
        ("MLP-logn-no37",      "mlp", X_log_norm_no37.reshape(N, -1)),
        # CNN1D 变体
        ("CNN1D-norm-8ch",     "cnn1d", X_norm),
        ("CNN1D-norm-no37",    "cnn1d", X_norm_no37),
        ("CNN1D-logn-no37",    "cnn1d", X_log_norm_no37),
        # TCN 变体
        ("TCN-norm-8ch",       "tcn", X_norm),
        ("TCN-norm-no37",      "tcn", X_norm_no37),
        ("TCN-logn-no37",      "tcn", X_log_norm_no37),
        # Transformer 变体
        ("TF-norm-8ch",        "transformer", X_norm),
        ("TF-norm-no37",       "transformer", X_norm_no37),
        ("TF-logn-no37",       "transformer", X_log_norm_no37),
    ]

    for name, model_type, X_input in dl_configs:
        fold_accs = []
        is_seq = model_type in ("cnn1d", "tcn", "transformer")

        for fold_idx, (train_idx, test_idx) in enumerate(skf.split(np.zeros(N), y)):
            Xtr, Xte = X_input[train_idx], X_input[test_idx]
            ytr, yte = y[train_idx], y[test_idx]

            # Normalize per-feature
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

            # Build model
            in_ch = Xtr.shape[2] if is_seq else Xtr.shape[1]
            model = _build_model(model_type, in_ch, n_classes, T).to(device)

            # Train
            optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=200)
            criterion = nn.CrossEntropyLoss()

            model.train()
            best_acc = 0.0
            patience_counter = 0
            for epoch in range(300):
                optimizer.zero_grad()
                if is_seq:
                    out = model(Xtr_t.permute(0, 2, 1))  # (B, C, T)
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
                            patience_counter = 0
                        else:
                            patience_counter += 1
                    model.train()
                    if patience_counter >= 5:
                        break

            fold_accs.append(best_acc)

        results[name] = {
            "mean": np.mean(fold_accs),
            "std": np.std(fold_accs),
            "folds": fold_accs,
        }
        folds_str = ", ".join(f"{s:.0%}" for s in fold_accs)
        print(f"  {name:<22} {results[name]['mean']:.1%} ±{results[name]['std']:.1%}  [{folds_str}]")

    return results


def _build_model(model_type, in_channels, n_classes, seq_len):
    """工厂函数：构建指定类型的模型"""
    if model_type == "mlp":
        return nn.Sequential(
            nn.Linear(in_channels, 256), nn.BatchNorm1d(256), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(256, 128), nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, n_classes),
        )
    elif model_type == "cnn1d":
        return CNN1DClassifier(in_channels, n_classes)
    elif model_type == "tcn":
        return TCNClassifier(in_channels, n_classes)
    elif model_type == "transformer":
        return TransformerClassifier(in_channels, n_classes, seq_len)
    else:
        raise ValueError(f"Unknown model type: {model_type}")


# ─── 模型定义 ───

class CNN1DClassifier(nn.Module):
    def __init__(self, in_channels, n_classes):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_channels, 32, kernel_size=7, padding=3),
            nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm1d(128), nn.ReLU(), nn.AdaptiveAvgPool1d(1),
        )
        self.fc = nn.Sequential(
            nn.Flatten(), nn.Dropout(0.3),
            nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, n_classes),
        )

    def forward(self, x):  # x: (B, C, T)
        return self.fc(self.conv(x))


class _TCNBlock(nn.Module):
    """单个 TCN 残差块：膨胀因果卷积 + 残差连接"""
    def __init__(self, in_ch, out_ch, kernel_size, dilation):
        super().__init__()
        padding = (kernel_size - 1) * dilation
        self.conv1 = nn.Conv1d(in_ch, out_ch, kernel_size, padding=padding, dilation=dilation)
        self.bn1 = nn.BatchNorm1d(out_ch)
        self.conv2 = nn.Conv1d(out_ch, out_ch, kernel_size, padding=padding, dilation=dilation)
        self.bn2 = nn.BatchNorm1d(out_ch)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.2)
        self.downsample = nn.Conv1d(in_ch, out_ch, 1) if in_ch != out_ch else nn.Identity()
        self.padding = padding

    def forward(self, x):
        residual = self.downsample(x)
        out = self.relu(self.bn1(self.conv1(x)[:, :, :x.size(2)]))
        out = self.dropout(out)
        out = self.relu(self.bn2(self.conv2(out)[:, :, :x.size(2)]))
        out = self.dropout(out)
        return self.relu(out + residual)


class TCNClassifier(nn.Module):
    """Temporal Convolutional Network"""
    def __init__(self, in_channels, n_classes, n_hidden=64, n_layers=4, kernel_size=3):
        super().__init__()
        layers = []
        channels = [in_channels] + [n_hidden] * n_layers
        for i in range(n_layers):
            dilation = 2 ** i
            layers.append(_TCNBlock(channels[i], channels[i + 1], kernel_size, dilation))
        self.tcn = nn.Sequential(*layers)
        self.fc = nn.Sequential(
            nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Dropout(0.3),
            nn.Linear(n_hidden, 32), nn.ReLU(), nn.Linear(32, n_classes),
        )

    def forward(self, x):  # x: (B, C, T)
        out = self.tcn(x)
        return self.fc(out)


class TransformerClassifier(nn.Module):
    """Transformer encoder for time-series classification"""
    def __init__(self, in_channels, n_classes, seq_len, d_model=64, nhead=4, n_layers=2, dropout=0.2):
        super().__init__()
        self.input_proj = nn.Linear(in_channels, d_model)
        self.pos_embed = nn.Parameter(torch.randn(1, seq_len, d_model) * 0.02)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=128,
            dropout=dropout, batch_first=True, activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.norm = nn.LayerNorm(d_model)
        self.fc = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(d_model, 32), nn.ReLU(), nn.Linear(32, n_classes),
        )

    def forward(self, x):  # x: (B, C, T)
        x = x.permute(0, 2, 1)  # → (B, T, C)
        x = self.input_proj(x) + self.pos_embed[:, :x.size(1), :]
        x = self.encoder(x)
        x = self.norm(x.mean(dim=1))  # global average pooling over time
        return self.fc(x)


# ═══════════════════════════════════════════════════════════════
# 4. 数据探索
# ═══════════════════════════════════════════════════════════════

def data_exploration(X_raw, y, class_names, run_ids_arr):
    """打印数据探索信息，含 per-run 分布对比"""
    N, T, C = X_raw.shape
    X_value = X_raw[:, :, :8]
    unique_runs = sorted(set(run_ids_arr))

    print("=" * 70)
    print(f"  多 Run 数据探索 (Runs: {unique_runs})")
    print("=" * 70)
    print(f"  总样本数: {N}, 时间步: {T}, 通道数: {C}")
    print(f"  类别数: {len(class_names)}")

    # Per-run 类别分布
    print(f"\n  Per-Run 类别分布:")
    header = f"  {'类别':<20}" + "".join(f"Run{r:<6}" for r in unique_runs) + "  Total"
    print(header)
    print(f"  {'-'*len(header)}")
    for i, name in enumerate(class_names):
        counts = []
        for r in unique_runs:
            cnt = ((y == i) & (run_ids_arr == r)).sum()
            counts.append(f"{cnt:<8}")
        total = (y == i).sum()
        print(f"  {name:<20}" + "".join(counts) + f"  {total}")
    # run totals
    run_totals = []
    for r in unique_runs:
        run_totals.append(f"{(run_ids_arr == r).sum():<8}")
    print(f"  {'合计':<20}" + "".join(run_totals) + f"  {N}")

    # Per-run 传感器统计 (仅 good sensors)
    print(f"\n  Per-Run 传感器均值对比 (good sensors: {GOOD_SENSORS}):")
    for si in GOOD_SENSORS:
        vals = []
        for r in unique_runs:
            mask = run_ids_arr == r
            vals.append(X_value[mask, :, si].mean())
        vals_str = ", ".join(f"R{r}={v:.0f}" for r, v in zip(unique_runs, vals))
        overall = X_value[:, :, si].mean()
        print(f"    Sensor {si}: {vals_str}  (overall={overall:.0f})")

    # Per-run 分布偏移检测 (基线归一化后的均值向量距离)
    print(f"\n  Run 间分布偏移分析 (基线归一化 good sensors 均值向量):")
    X_good = X_value[:, :, GOOD_SENSORS]
    bl = max(1, T // 10)
    baseline = X_good[:, :bl, :].mean(axis=1, keepdims=True)
    baseline = np.where(baseline == 0, 1.0, baseline)
    X_norm_good = X_good / baseline

    run_means = {}
    for r in unique_runs:
        mask = run_ids_arr == r
        run_means[r] = X_norm_good[mask].mean(axis=(0, 1))  # (n_good,)

    for i, r1 in enumerate(unique_runs):
        for r2 in unique_runs[i+1:]:
            dist = np.linalg.norm(run_means[r1] - run_means[r2])
            print(f"    Run {r1} ↔ Run {r2}: L2 distance = {dist:.4f}")

    # Per-run per-class 均值对比
    print(f"\n  Run 间 per-class 分布偏移 (归一化 good sensors):")
    for ci, cname in enumerate(class_names):
        dists = []
        for i, r1 in enumerate(unique_runs):
            for r2 in unique_runs[i+1:]:
                m1_mask = (y == ci) & (run_ids_arr == r1)
                m2_mask = (y == ci) & (run_ids_arr == r2)
                if m1_mask.sum() == 0 or m2_mask.sum() == 0:
                    continue
                m1 = X_norm_good[m1_mask].mean(axis=(0, 1))
                m2 = X_norm_good[m2_mask].mean(axis=(0, 1))
                d = np.linalg.norm(m1 - m2)
                dists.append(f"R{r1}↔R{r2}={d:.4f}")
        if dists:
            print(f"    {cname:<20} {', '.join(dists)}")
        else:
            print(f"    {cname:<20} (数据不足)")

    # 类间距离
    print(f"\n  类间距离分析 (归一化 good sensors 均值向量):")
    class_means = []
    for i in range(len(class_names)):
        mask = y == i
        class_mean = X_norm_good[mask].mean(axis=(0, 1))
        class_means.append(class_mean)
    class_means_arr = np.array(class_means)

    for i in range(len(class_names)):
        dists = []
        for j in range(len(class_names)):
            if i != j:
                d = np.linalg.norm(class_means_arr[i] - class_means_arr[j])
                dists.append(d)
        print(f"    {class_names[i]}: avg dist = {np.mean(dists):.4f}")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def run_pipeline(X_raw, y, class_names, run_ids_arr, combo_label):
    """对给定数据子集运行完整 ML/DL 流水线，返回摘要 dict。"""

    n_samples = X_raw.shape[0]
    n_classes = len(class_names)

    print(f"\n{'#' * 74}")
    print(f"#  组合: {combo_label}  (样本数={n_samples}, 类别数={n_classes})")
    print(f"{'#' * 74}")

    # ── 数据探索 (简略) ──
    unique_runs = np.unique(run_ids_arr)
    print(f"\n  Per-Run 类别分布:")
    run_cols = "".join(f"{'R'+str(r):>8}" for r in unique_runs)
    print(f"  {'类别':<20}{run_cols}{'Total':>8}")
    print(f"  {'-'*52}")
    for i, name in enumerate(class_names):
        counts = []
        for r in unique_runs:
            cnt = int(((y == i) & (run_ids_arr == r)).sum())
            counts.append(f"{cnt:>8}")
        total = int((y == i).sum())
        print(f"  {name:<20}{''.join(counts)}{total:>8}")

    # ── 特征工程 ──
    features = make_features(X_raw, class_names)

    # ── 传统 ML ──
    ml_results = run_ml_classifiers(features, y)
    clf_names = list(next(iter(ml_results.values()))["scores"].keys())

    all_combos = []
    for feat_name in features:
        res = ml_results[feat_name]
        for clf_name in clf_names:
            score = res["scores"][clf_name]
            all_combos.append((score["mean"], score["std"], feat_name, clf_name))
    all_combos.sort(key=lambda x: -x[0])

    best_ml = all_combos[0]
    print(f"\n  ML Top-5:")
    for rank, (mean, std, feat, clf) in enumerate(all_combos[:5], 1):
        print(f"    {rank}. {feat:<25} {clf:<15} {mean:.1%} ±{std:.1%}")

    # ── 深度学习 ──
    dl_results = run_dl_models(X_raw, y, class_names)
    dl_sorted = sorted(dl_results.items(), key=lambda kv: -kv[1]["mean"])
    best_dl_name, best_dl_res = dl_sorted[0]

    print(f"\n  DL Top-5:")
    for rank, (name, res) in enumerate(dl_sorted[:5], 1):
        print(f"    {rank}. {name:<22} {res['mean']:.1%} ±{res['std']:.1%}")

    best_overall = max(best_ml[0], best_dl_res["mean"])
    random_baseline = 1.0 / n_classes

    print(f"\n  >>> 最佳 ML: {best_ml[0]:.1%} ({best_ml[2]}+{best_ml[3]})  |  "
          f"最佳 DL: {best_dl_res['mean']:.1%} ({best_dl_name})  |  "
          f"最佳: {best_overall:.1%}  (基线={random_baseline:.1%})")

    return {
        "label": combo_label,
        "n_samples": n_samples,
        "n_classes": n_classes,
        "best_ml_acc": best_ml[0],
        "best_ml_std": best_ml[1],
        "best_ml_desc": f"{best_ml[2]}+{best_ml[3]}",
        "best_dl_acc": best_dl_res["mean"],
        "best_dl_std": best_dl_res["std"],
        "best_dl_desc": best_dl_name,
        "best_overall": best_overall,
    }


def main():
    ALL_RUNS = [93, 99, 101, 102]

    dsn = load_dsn()

    # ── 一次性加载全部数据 ──
    print(f"加载 Runs {ALL_RUNS} 全部数据...")
    X_all, y_all, class_names, sample_ids_all, run_ids_all = load_multi_run_data(
        dsn, ALL_RUNS, n_samples=100, method="pchip"
    )
    print(f"  加载完成: {X_all.shape}, {len(class_names)} 类\n")

    # ── 全量数据探索 (含 per-run 分布偏移) ──
    data_exploration(X_all, y_all, class_names, run_ids_all)

    # ── 生成所有非空子集组合 ──
    run_combos = []
    for r in range(1, len(ALL_RUNS) + 1):
        for combo in combinations(ALL_RUNS, r):
            run_combos.append(list(combo))
    print(f"\n  共 {len(run_combos)} 种组合: {run_combos}")

    # ── 逐组合运行流水线 ──
    summary_rows = []
    for combo in run_combos:
        mask = np.isin(run_ids_all, combo)
        X_sub = X_all[mask]
        y_sub = y_all[mask]
        run_sub = run_ids_all[mask]
        combo_label = "+".join(str(r) for r in combo)

        result = run_pipeline(X_sub, y_sub, class_names, run_sub, combo_label)
        summary_rows.append(result)

    # ── 汇总对比表 ──
    print("\n" + "=" * 90)
    print("  所有组合汇总对比")
    print("=" * 90)
    print(f"  {'组合':<18} {'样本':>5} {'最佳ML':>8} {'ML模型':<28} {'最佳DL':>8} {'DL模型':<22} {'最佳':>8}")
    print(f"  {'-'*86}")
    for row in summary_rows:
        print(f"  {row['label']:<18} {row['n_samples']:>5} "
              f"{row['best_ml_acc']:>7.1%} {row['best_ml_desc']:<28} "
              f"{row['best_dl_acc']:>7.1%} {row['best_dl_desc']:<22} "
              f"{row['best_overall']:>7.1%}")

    # 找最优组合
    best_row = max(summary_rows, key=lambda r: r["best_overall"])
    print(f"\n  🏆 最优组合: {best_row['label']} — {best_row['best_overall']:.1%}")
    random_baseline = 1.0 / summary_rows[0]["n_classes"]
    print(f"     随机基线: {random_baseline:.1%}")
    print()


if __name__ == "__main__":
    main()
