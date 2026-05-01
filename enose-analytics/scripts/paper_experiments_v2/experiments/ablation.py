"""§3.5 Ablation Study (v2) — 论文 Table 4 格式。

Ablation variants aligned with manuscript Table 4:
  1. CARL (task-best)                     — cls: fine-tuning, reg: Proj+SVR
  2. w/o SE attention                     — encoder ablation
  3. w/o Aroma-Aware augmentation         — augmentation ablation
  4. w/o SOAP (use Adam)                  — optimiser ablation
  5. w/o fine-tuning (frozen SVM probe)   — adaptation ablation (cls only)
  6. w/ fine-tuning (replaces SVR)        — adaptation ablation (reg only)
  7. w/o TTA                              — adaptation ablation (cls only)

Classification "task-best" = CARL + fine-tuning (oversampling+Mixup+TTA).
Regression "task-best"     = CARL-Proj + SVR (frozen encoder).

All via nested 5-fold CV to avoid data leakage.

Outputs:
  - table4_ablation_v2.csv  (Table 4 format)
  - exp_ablation_v2.json
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from pathlib import Path

import torch
import torch.nn as nn
from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.svm import SVC, SVR
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline

from ..config import SEED, N_CV_FOLDS
from ..data import PaperDataset
from ..carl_training import (
    train_carl_on_subset, extract_embeddings_with_scaler,
    extract_gap_features_with_scaler,
)
from ..carl_finetune import finetune_classifier

np.random.seed(SEED)


def _nested_cv_cls_ft(ds, carl_kwargs, tta_augments=20, label=""):
    """Nested 5-fold CV classification via fine-tuning + TTA."""
    pure_idx = ds.pure_indices
    le = LabelEncoder()
    y = le.fit_transform([ds.tea_ids[i] for i in pure_idx])
    n_classes = len(le.classes_)
    X_feat = ds.features["norm_stats"][0][pure_idx]

    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)
    y_pred_ft = np.zeros_like(y, dtype=int)
    y_pred_svm = np.zeros_like(y, dtype=int)

    for fold, (tr, te) in enumerate(skf.split(X_feat, y)):
        print(f"      fold {fold+1}/{N_CV_FOLDS} (cls)...")
        global_test = pure_idx[te]
        mask = np.ones(ds.n_total, dtype=bool)
        mask[global_test] = False

        encoder, scaler = train_carl_on_subset(ds, mask, verbose=True, **carl_kwargs)

        # Frozen SVM probe (for comparison)
        emb = extract_embeddings_with_scaler(encoder, ds, scaler)
        pipe_svm = Pipeline([
            ("sc", StandardScaler()),
            ("clf", SVC(kernel="rbf", C=10.0, gamma="scale", random_state=SEED)),
        ])
        pipe_svm.fit(emb[pure_idx[tr]], y[tr])
        y_pred_svm[te] = pipe_svm.predict(emb[global_test])

        # Fine-tuning
        preds_ft, _ = finetune_classifier(
            encoder, scaler, ds,
            tr=tr, te=te,
            n_classes=n_classes,
            epochs=200, lr=1e-3,
            freeze_backbone=False,
            tta_augments=tta_augments,
            print_every=50,
        )
        y_pred_ft[te] = preds_ft

        print(f"      fold {fold+1}/{N_CV_FOLDS} done: FT={accuracy_score(y[te], preds_ft)*100:.1f}%, SVM={accuracy_score(y[te], y_pred_svm[te])*100:.1f}%")
        del encoder
        torch.cuda.empty_cache()

    ft_acc = round(accuracy_score(y, y_pred_ft) * 100, 1)
    svm_acc = round(accuracy_score(y, y_pred_svm) * 100, 1)
    print(f"    {label} cls: FT={ft_acc}%, SVM={svm_acc}%")
    return {"ft_acc": ft_acc, "svm_acc": svm_acc}


def _nested_cv_reg_proj(ds, carl_kwargs, label=""):
    """Nested 5-fold CV regression: CARL-Proj + SVR (frozen encoder)."""
    mix_idx = ds.mix_indices
    y_ratio = np.array([ds.ratios[i] for i in mix_idx])
    y_combo = np.array([ds.combo_ids[i] for i in mix_idx])

    le_strat = LabelEncoder()
    y_strat = le_strat.fit_transform(y_combo)
    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=SEED)

    y_pred_svr = np.zeros_like(y_ratio, dtype=np.float32)

    for fold, (tr, te) in enumerate(skf.split(np.zeros(len(y_ratio)), y_strat)):
        print(f"      fold {fold+1}/{N_CV_FOLDS} (reg)...")
        global_test = mix_idx[te]
        mask = np.ones(ds.n_total, dtype=bool)
        mask[global_test] = False

        encoder, scaler = train_carl_on_subset(ds, mask, verbose=True, **carl_kwargs)
        emb = extract_embeddings_with_scaler(encoder, ds, scaler)

        le_c = LabelEncoder()
        ohe = OneHotEncoder(sparse_output=False)
        oh_tr = ohe.fit_transform(le_c.fit_transform(y_combo[tr]).reshape(-1, 1))
        oh_te = ohe.transform(le_c.transform(y_combo[te]).reshape(-1, 1))

        X_tr = np.hstack([emb[mix_idx[tr]], oh_tr])
        X_te = np.hstack([emb[mix_idx[te]], oh_te])

        svr_pipe = Pipeline([("sc", StandardScaler()), ("svr", SVR(kernel="rbf", C=10.0))])
        svr_pipe.fit(X_tr, y_ratio[tr])
        y_pred_svr[te] = svr_pipe.predict(X_te)

        print(f"      fold {fold+1}/{N_CV_FOLDS} done")
        del encoder
        torch.cuda.empty_cache()

    r2 = round(r2_score(y_ratio, y_pred_svr), 3)
    mae = round(mean_absolute_error(y_ratio, y_pred_svr), 4)
    rmse = round(np.sqrt(mean_squared_error(y_ratio, y_pred_svr)), 4)
    print(f"    {label} reg: SVR R²={r2:.3f}, MAE={mae:.4f}")
    return {"r2": r2, "mae": mae, "rmse": rmse}


def run(
    ds: PaperDataset,
    tables_dir: Path,
    figures_dir: Path,
) -> dict:
    """Run §3.5: CARL ablation (Table 4 format)."""
    print("\n" + "=" * 70)
    print("  §3.5 Ablation Study (v2 — Table 4)")
    print("=" * 70)

    rows = []

    # ── 1. Main CARL variants (cls: FT+TTA, reg: Proj+SVR) ──
    main_variants = [
        ("CARL (full)", {"use_se": True, "use_augment": True, "use_soap": True}),
        ("w/o SE", {"use_se": False, "use_augment": True, "use_soap": True}),
        ("w/o Aug", {"use_se": True, "use_augment": False, "use_soap": True}),
        ("w/o SOAP", {"use_se": True, "use_augment": True, "use_soap": False}),
    ]

    for name, kwargs in main_variants:
        print(f"\n  {name}...")
        cls = _nested_cv_cls_ft(ds, kwargs, tta_augments=20, label=name)
        reg = _nested_cv_reg_proj(ds, kwargs, label=name)
        rows.append({
            "variant": name,
            "cls_ft": cls["ft_acc"],
            "cls_svm": cls["svm_acc"],
            "reg_r2": reg["r2"],
            "reg_mae": reg["mae"],
            "reg_rmse": reg["rmse"],
        })

    # ── 2. TTA ablation (cls only): re-run full CARL with tta=0 ──
    print(f"\n  CARL (w/o TTA)...")
    full_kwargs = {"use_se": True, "use_augment": True, "use_soap": True}
    cls_no_tta = _nested_cv_cls_ft(ds, full_kwargs, tta_augments=0, label="w/o TTA")
    rows.append({
        "variant": "w/o TTA",
        "cls_ft": cls_no_tta["ft_acc"],
        "cls_svm": cls_no_tta["svm_acc"],
        "reg_r2": "—", "reg_mae": "—", "reg_rmse": "—",
    })

    # ── 3. Frozen-probe row (cls SVM from full variant) ──
    full_row = rows[0]
    rows.append({
        "variant": "frozen probe (no FT)",
        "cls_ft": full_row["cls_svm"],  # SVM acc = frozen probe
        "cls_svm": full_row["cls_svm"],
        "reg_r2": "—", "reg_mae": "—", "reg_rmse": "—",
    })

    # ── 保存 Table 4 ──
    df = pd.DataFrame(rows)
    csv_path = tables_dir / "table4_ablation_v2.csv"
    df.to_csv(csv_path, index=False)
    print(f"\n  Table 4 -> {csv_path.name}")

    results = {"table4": rows}
    _save_json(results, tables_dir / "exp_ablation_v2.json")

    # 摘要
    full = rows[0]
    print(f"\n  === §3.5 结果摘要 ===")
    print(f"  Full CARL: FT={full['cls_ft']}%, SVM={full['cls_svm']}%, "
          f"SVR R²={full['reg_r2']}, MAE={full['reg_mae']}")
    for r in rows[1:]:
        ft_delta = ""
        if isinstance(r["cls_ft"], (int, float)) and isinstance(full["cls_ft"], (int, float)):
            ft_delta = f"({r['cls_ft'] - full['cls_ft']:+.1f})"
        r2_delta = ""
        if isinstance(r["reg_r2"], (int, float)) and isinstance(full["reg_r2"], (int, float)):
            r2_delta = f"({r['reg_r2'] - full['reg_r2']:+.3f})"
        print(f"  {r['variant']:30s}: FT={r['cls_ft']}%{ft_delta}, "
              f"R²={r['reg_r2']}{r2_delta}")

    return results


def _save_json(obj, path):
    def _conv(o):
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, np.ndarray): return o.tolist()
        return o
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(obj, default=_conv)), f, indent=2, ensure_ascii=False)
