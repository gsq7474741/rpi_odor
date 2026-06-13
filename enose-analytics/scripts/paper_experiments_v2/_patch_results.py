"""一次性脚本: 将最新 CARL 调优结果合并到完整 regression 结果文件中."""
import json
import csv
import numpy as np
from pathlib import Path
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

TABLES = Path(__file__).parent / "results" / "v2" / "tables"
BACKUP = Path(__file__).parent / "results" / "v2_20260504_194649" / "tables"

# ── 1. 读取备份的完整 table3 (所有模型) ──
raw = (BACKUP / "exp_regression_v2.json").read_bytes()
# 替换可能的 GBK 破折号 (0xa1 0xaa → "—")
text = raw.decode("utf-8", errors="replace").replace("\ufffd\ufffd", "\u2014")
backup = json.loads(text)

full_table = backup["table3"]

# ── 2. 最新 CARL 结果 (来自 WarmRestarts T_0=200, 800ep 运行) ──
new_carl_rows = [
    {
        "category": "CARL (ours)", "representation": "CARL-GAP", "params": "78.5K",
        "SVR_r2": 0.457, "SVR_mae": 0.1493, "SVR_rmse": 0.1817,
        "DeepMLP_r2": "\u2014", "DeepMLP_mae": "\u2014", "DeepMLP_rmse": "\u2014",
    },
    {
        "category": "CARL (ours)", "representation": "CARL-Proj", "params": "78.5K",
        "SVR_r2": 0.719, "SVR_mae": 0.0988, "SVR_rmse": 0.1308,
        "DeepMLP_r2": 0.672, "DeepMLP_mae": 0.1062, "DeepMLP_rmse": 0.1412,
    },
]

# ── 3. 替换 CARL 行 ──
merged = [r for r in full_table if r["category"] != "CARL (ours)"]
merged.extend(new_carl_rows)

# ── 4. 计算 best ──
best_r2, best_label = -999, ""
for row in merged:
    for head in ("SVR", "DeepMLP"):
        val = row[f"{head}_r2"]
        if isinstance(val, (int, float)) and val > best_r2:
            best_r2 = val
            best_label = f"{row['representation']} + {head}"

result = {"table3": merged, "best_model": best_label, "best_r2": best_r2}

# ── 5. 写入 JSON ──
json_path = TABLES / "exp_regression_v2.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
print(f"✓ {json_path}")

# ── 6. 写入 CSV ──
csv_path = TABLES / "table3_regression_v2.csv"
fields = ["category", "representation", "params",
          "SVR_r2", "SVR_mae", "SVR_rmse",
          "DeepMLP_r2", "DeepMLP_mae", "DeepMLP_rmse"]
with open(csv_path, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(merged)
print(f"✓ {csv_path}")

# ── 7. 从 npz 重算 per-combo regression (table_s8a) ──
npz_path = TABLES / "reg_predictions_v2.npz"
if npz_path.exists():
    data = np.load(npz_path, allow_pickle=True)
    y_ratio = data["y_ratio"]
    y_combo = data["y_combo"]
    y_pred = data["y_pred_svr"]  # best model: CARL-Proj + SVR

    combos = sorted(set(y_combo))
    per_combo = {}
    for c in combos:
        mask = y_combo == c
        r2 = round(r2_score(y_ratio[mask], y_pred[mask]), 3)
        mae = round(mean_absolute_error(y_ratio[mask], y_pred[mask]), 3)
        rmse = round(np.sqrt(mean_squared_error(y_ratio[mask], y_pred[mask])), 3)
        per_combo[c] = {"n": int(mask.sum()), "r2": r2, "mae": mae, "rmse": rmse}

    r2_all = round(r2_score(y_ratio, y_pred), 3)
    mae_all = round(mean_absolute_error(y_ratio, y_pred), 3)
    rmse_all = round(np.sqrt(mean_squared_error(y_ratio, y_pred)), 3)
    per_combo["Overall"] = {"n": len(y_ratio), "r2": r2_all, "mae": mae_all, "rmse": rmse_all}

    s8a_path = TABLES / "table_s8a_per_combo_regression.json"
    with open(s8a_path, "w", encoding="utf-8") as f:
        json.dump(per_combo, f, indent=2, ensure_ascii=False)
    print(f"✓ {s8a_path}")
    print(f"  Overall: R²={r2_all}, MAE={mae_all}, RMSE={rmse_all}")
    for c in combos:
        print(f"  {c}: R²={per_combo[c]['r2']}")
else:
    print(f"⚠ {npz_path} 不存在, 跳过 per-combo 计算")

print("\n✓ 结果文件更新完成!")
print(f"  best: {best_label} → R²={best_r2}")
