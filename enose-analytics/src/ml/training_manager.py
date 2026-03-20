"""训练任务管理器 - 异步训练、进度回调、结果持久化"""

import json
import threading
import traceback
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import math

import numpy as np

from .base_model import (
    BaseModel,
    TrainProgress,
    get_model_class,
    DEFAULT_HYPERPARAMS,
    MODEL_TASK_SUPPORT,
)
from .evaluator import Evaluator
from .dataset_builder import DatasetBuilder
from .label_generator import LabelGenerator
from ..db.connection import get_connection, get_cursor
from ..db.model_repository import ModelRepository
from ..storage.minio_client import MinioClient
from ..logger import logger


# 需要 flatten 输入的传统模型（非时序）
FLAT_MODELS = {"mlp", "svm", "xgboost", "kmeans", "rf", "lr", "lda", "knn"}


def _prepare_X(X: np.ndarray, model_type: str) -> np.ndarray:
    """根据模型类型准备输入数据形状

    数据集返回 (N, T, 8, 4)，传统模型需要 flatten 为 (N, T*8*4)，
    时序模型（tcn, cnn1d, transformer）保持原始形状。
    """
    if model_type in FLAT_MODELS and X.ndim > 2:
        flat_dim = 1
        for d in X.shape[1:]:
            flat_dim *= d
        return X.reshape(X.shape[0], flat_dim)
    return X


def _sanitize_for_json(obj: Any) -> Any:
    """递归清洗 NaN/Inf，替换为 None，确保 json.dumps 输出合法 JSON"""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    return obj


class TrainingManager:
    """管理训练任务生命周期"""

    def __init__(self):
        self._model_repo = ModelRepository()
        self._minio = MinioClient()
        self._dataset_builder = DatasetBuilder()
        self._active_jobs: dict[str, threading.Thread] = {}
        self._cancel_flags: dict[str, threading.Event] = {}

    def start_training(
        self,
        name: str,
        description: str,
        model_type: str,
        task_type: str,
        label_config_name: str,
        sample_ids: list[int] | None = None,
        run_ids: list[int] | None = None,
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        series_n_samples: int = 100,
        series_method: str = "linear",
        seed: int = 42,
        hyperparams: dict[str, Any] | None = None,
        split_method: str = "stratified_holdout",
        k_folds: int = 5,
    ) -> str:
        """启动异步训练，返回 job_id"""

        # 验证模型类型
        supported = MODEL_TASK_SUPPORT.get(model_type, [])
        if task_type not in supported:
            raise ValueError(
                f"Model '{model_type}' does not support task '{task_type}'. "
                f"Supported: {supported}"
            )

        # 合并超参数
        merged_params = dict(DEFAULT_HYPERPARAMS.get(model_type, {}))
        if hyperparams:
            merged_params.update(hyperparams)

        dataset_config = {
            "label_config_name": label_config_name,
            "sample_ids": sample_ids,
            "run_ids": run_ids,
            "train_ratio": train_ratio,
            "val_ratio": val_ratio,
            "series_n_samples": series_n_samples,
            "series_method": series_method,
            "seed": seed,
            "split_method": split_method,
            "k_folds": k_folds,
        }

        # 创建 training_job 记录
        total_epochs = merged_params.get("epochs", merged_params.get("n_estimators", 1))

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO training_jobs 
                        (model_name, model_config, label_ids, total_epochs, status,
                         model_type, task_type, dataset_config, hyperparams)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    name,
                    json.dumps(merged_params),
                    [],  # label_ids (legacy field)
                    total_epochs,
                    "PENDING",
                    model_type,
                    task_type,
                    json.dumps(dataset_config),
                    json.dumps(merged_params),
                ))
                job_id = str(cur.fetchone()["id"])
            conn.commit()

        logger.info(f"Created training job {job_id}: {model_type}/{task_type} name={name}")

        # 启动后台训练线程
        cancel_event = threading.Event()
        self._cancel_flags[job_id] = cancel_event

        thread = threading.Thread(
            target=self._train_worker,
            args=(job_id, name, description, model_type, task_type,
                  dataset_config, merged_params, cancel_event),
            daemon=True,
        )
        self._active_jobs[job_id] = thread
        thread.start()

        return job_id

    def _train_worker(
        self,
        job_id: str,
        name: str,
        description: str,
        model_type: str,
        task_type: str,
        dataset_config: dict[str, Any],
        hyperparams: dict[str, Any],
        cancel_event: threading.Event,
    ):
        """后台训练线程"""
        try:
            # 1. 更新状态 RUNNING
            self._update_job_status(job_id, "RUNNING", started_at=datetime.now(timezone.utc))
            logger.info(f"Job {job_id}: RUNNING")

            # 2. 自动生成标签（训练前确保所有选中样本都有标签）
            label_config_name = dataset_config.get("label_config_name", "")
            sample_ids = dataset_config.get("sample_ids")
            run_ids = dataset_config.get("run_ids")
            if label_config_name:
                self._write_progress(job_id, TrainProgress(
                    epoch=0, total_epochs=0,
                    extra_metrics={"stage": "building_dataset", "detail": "自动生成标签..."},
                ))
                label_gen = LabelGenerator()
                label_count = label_gen.generate_for_config(
                    config_name=label_config_name,
                    sample_ids=sample_ids,
                    run_ids=run_ids,
                )
                requested = len(sample_ids) if sample_ids else "all"
                logger.info(
                    f"Job {job_id}: Auto-generated {label_count} labels "
                    f"for '{label_config_name}' (requested: {requested})"
                )
                if sample_ids and label_count < len(sample_ids):
                    logger.warning(
                        f"Job {job_id}: Only {label_count}/{len(sample_ids)} samples "
                        f"received labels — some samples may lack required data for "
                        f"strategy '{label_config_name}'"
                    )

            # 3. 构建数据集（写入阶段进度供 SSE 读取）
            self._write_progress(job_id, TrainProgress(
                epoch=0, total_epochs=0,
                extra_metrics={"stage": "building_dataset", "detail": "构建数据集..."},
            ))
            logger.info(f"Job {job_id}: Building dataset...")
            dataset = self._build_dataset(task_type, dataset_config)
            if dataset is None:
                raise ValueError("Failed to build dataset - no data available")

            X_train_raw = dataset["X_train"]
            y_train = dataset["y_train"]
            X_val_raw = dataset.get("X_val")
            y_val = dataset.get("y_val")
            X_test_raw = dataset.get("X_test")
            y_test = dataset.get("y_test")
            class_names = dataset.get("class_names", [])
            folds = dataset.get("folds")  # K-Fold 时有值
            series_shape = dataset.get("series_shape", X_train_raw.shape[1:])

            n_classes = dataset.get("n_classes", 0)
            is_kfold = folds is not None and len(folds) > 1

            # 根据模型类型准备数据形状：传统模型 flatten，时序模型保持 (T, 8, 4)
            # 空数组 (shape[0]==0) 统一转为 None，避免下游模型处理空数组
            X_train = _prepare_X(X_train_raw, model_type)
            X_val = _prepare_X(X_val_raw, model_type) if X_val_raw is not None and len(X_val_raw) > 0 else None
            y_val = y_val if X_val is not None else None
            X_test = _prepare_X(X_test_raw, model_type) if X_test_raw is not None and len(X_test_raw) > 0 else None
            y_test = y_test if X_test is not None else None

            logger.info(
                f"Job {job_id}: Dataset built - "
                f"series_shape={series_shape}, X_shape={X_train.shape}, "
                f"train={len(X_train)}, val={len(X_val) if X_val is not None else 0}, "
                f"test={len(X_test) if X_test is not None else 0}, "
                f"n_classes={n_classes}, class_names={class_names}"
                f"{f', folds={len(folds)}' if is_kfold else ''}"
            )

            # 3. 检查取消
            if cancel_event.is_set():
                self._update_job_status(job_id, "CANCELLED")
                return

            # 4. 自动检测 GPU
            device = "cpu"
            try:
                import torch
                if torch.cuda.is_available():
                    device = "cuda"
                    logger.info(f"Job {job_id}: Using GPU ({torch.cuda.get_device_name(0)})")
                else:
                    logger.info(f"Job {job_id}: No CUDA GPU detected, using CPU")
            except ImportError:
                pass

            # 5-6. K-Fold 训练循环 或 单次训练
            if is_kfold:
                evaluations = self._train_kfold(
                    job_id, model_type, task_type, hyperparams, device,
                    folds, class_names, n_classes, cancel_event,
                )
                # K-Fold 没有单独的 train_result，用聚合指标
                train_result = {}
                # 用所有数据训练最终模型
                logger.info(f"Job {job_id}: Training final model on all data...")
                X_all_raw = np.concatenate([f["X_train"] for f in folds] + [f["X_test"] for f in folds])
                y_all = np.concatenate([f["y_train"] for f in folds] + [f["y_test"] for f in folds])
                X_all = _prepare_X(X_all_raw, model_type)
                model_cls = get_model_class(model_type)
                model: BaseModel = model_cls(task_type=task_type, device=device, **hyperparams)
                total_ep = model.get_total_epochs()

                def final_progress_callback(progress: TrainProgress):
                    if cancel_event.is_set():
                        raise InterruptedError("Training cancelled")
                    progress.extra_metrics["stage"] = "training"
                    progress.extra_metrics["detail"] = f"最终模型 - Epoch {progress.epoch}/{total_ep}"
                    self._write_progress(job_id, progress)
                    self._update_job_progress(job_id, progress)

                self._write_progress(job_id, TrainProgress(
                    epoch=0, total_epochs=total_ep,
                    extra_metrics={"stage": "training", "detail": "训练最终模型（全部数据）..."},
                ))
                model.fit(
                    X_all, y_all,
                    progress_callback=final_progress_callback,
                    n_classes=n_classes if n_classes > 0 else None,
                )
            else:
                # 单次训练
                model_cls = get_model_class(model_type)
                model: BaseModel = model_cls(task_type=task_type, device=device, **hyperparams)

                def progress_callback(progress: TrainProgress):
                    if cancel_event.is_set():
                        raise InterruptedError("Training cancelled")
                    self._write_progress(job_id, progress)
                    self._update_job_progress(job_id, progress)

                logger.info(f"Job {job_id}: Training {model_type} (n_classes={n_classes})...")
                train_result = model.fit(
                    X_train, y_train,
                    X_val, y_val,
                    progress_callback=progress_callback,
                    n_classes=n_classes if n_classes > 0 else None,
                )

                if cancel_event.is_set():
                    self._update_job_status(job_id, "CANCELLED")
                    return

                # 评估
                logger.info(f"Job {job_id}: Evaluating...")
                evaluations = {}

                if task_type in ("classification", "regression"):
                    train_eval = Evaluator.evaluate(model, X_train, y_train, task_type, class_names)
                    evaluations["train"] = train_eval

                    if X_val is not None and len(X_val) > 0:
                        val_eval = Evaluator.evaluate(model, X_val, y_val, task_type, class_names)
                        evaluations["val"] = val_eval

                    if X_test is not None and len(X_test) > 0:
                        test_eval = Evaluator.evaluate(model, X_test, y_test, task_type, class_names)
                        evaluations["test"] = test_eval

            # 7. 保存模型到 MinIO
            logger.info(f"Job {job_id}: Saving model to MinIO...")
            model_bytes = model.save_bytes()
            minio_path = self._minio.upload_model(name, model_bytes)

            # 8. 保存到 ml_models
            test_eval = evaluations.get("test", {})
            train_eval_data = evaluations.get("train", {})
            val_eval_data = evaluations.get("val", {})

            model_record = self._model_repo.create(
                name=name,
                config=model.get_config(),
                input_dim=X_train.shape[1],
                output_dim=len(class_names) if class_names else (1 if task_type == "regression" else 0),
                class_names=class_names,
                minio_path=minio_path,
                description=description,
                train_accuracy=train_eval_data.get("accuracy"),
                val_accuracy=val_eval_data.get("accuracy"),
                train_loss=train_eval_data.get("loss"),
                val_loss=val_eval_data.get("loss"),
                file_size=len(model_bytes),
            )
            model_id = str(model_record["id"])

            # 更新 ml_models 扩展字段
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE ml_models SET
                            model_type = %s,
                            task_type = %s,
                            framework = %s,
                            training_job_id = %s,
                            test_accuracy = %s,
                            test_loss = %s,
                            confusion_matrix = %s,
                            extra_metrics = %s
                        WHERE id = %s
                    """, (
                        model_type,
                        task_type,
                        model.framework,
                        job_id,
                        test_eval.get("accuracy"),
                        test_eval.get("loss"),
                        json.dumps(_sanitize_for_json(test_eval.get("confusion_matrix"))) if test_eval.get("confusion_matrix") else None,
                        json.dumps(_sanitize_for_json({
                            k: v for k, v in test_eval.items()
                            if k not in ("confusion_matrix", "classification_report", "predictions")
                        })),
                        model_id,
                    ))
                conn.commit()

            # 9. 保存评估记录
            for split_name, eval_data in evaluations.items():
                self._save_evaluation(job_id, model_id, split_name, eval_data)

            # 10. 更新 job 状态
            extra_metrics = {}
            if test_eval:
                extra_metrics = {
                    k: v for k, v in test_eval.items()
                    if k not in ("confusion_matrix", "classification_report", "predictions")
                }

            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE training_jobs SET
                            status = 'COMPLETED',
                            completed_at = NOW(),
                            model_id = %s,
                            test_accuracy = %s,
                            test_loss = %s,
                            extra_metrics = %s,
                            train_loss = %s,
                            val_loss = %s,
                            train_accuracy = %s,
                            val_accuracy = %s
                        WHERE id = %s
                    """, (
                        model_id,
                        test_eval.get("accuracy"),
                        test_eval.get("loss"),
                        json.dumps(_sanitize_for_json(extra_metrics)),
                        train_result.get("train_loss"),
                        train_result.get("val_loss"),
                        train_result.get("train_accuracy"),
                        train_result.get("val_accuracy"),
                        job_id,
                    ))
                conn.commit()

            logger.info(f"Job {job_id}: COMPLETED, model_id={model_id}")

        except InterruptedError:
            self._update_job_status(job_id, "CANCELLED")
            logger.info(f"Job {job_id}: CANCELLED")
        except Exception as e:
            logger.exception(f"Job {job_id}: FAILED - {e}")
            self._update_job_status(job_id, "FAILED", error_message=str(e))
        finally:
            self._active_jobs.pop(job_id, None)
            self._cancel_flags.pop(job_id, None)

    def _train_kfold(
        self,
        job_id: str,
        model_type: str,
        task_type: str,
        hyperparams: dict[str, Any],
        device: str,
        folds: list[dict],
        class_names: list[str],
        n_classes: int,
        cancel_event: threading.Event,
    ) -> dict[str, dict[str, Any]]:
        """K-Fold 训练循环，返回聚合评估结果"""
        fold_evals: list[dict[str, Any]] = []
        n_folds = len(folds)

        for i, fold in enumerate(folds):
            if cancel_event.is_set():
                raise InterruptedError("Training cancelled")

            # 从 fold 的训练集中切分一部分作为验证集（用于 early stopping）
            X_fold_train_raw = fold["X_train"]
            y_fold_train = fold["y_train"]
            X_fold_val_raw = None
            y_fold_val = None

            if len(X_fold_train_raw) > 4:
                val_size = max(1, int(len(X_fold_train_raw) * 0.15))
                rng = np.random.RandomState(42 + i)
                indices = rng.permutation(len(X_fold_train_raw))
                val_idx = indices[:val_size]
                train_idx = indices[val_size:]
                X_fold_val_raw = X_fold_train_raw[val_idx]
                y_fold_val = y_fold_train[val_idx]
                X_fold_train_raw = X_fold_train_raw[train_idx]
                y_fold_train = y_fold_train[train_idx]

            # 根据模型类型 reshape
            X_fold_train = _prepare_X(X_fold_train_raw, model_type)
            X_fold_val = _prepare_X(X_fold_val_raw, model_type) if X_fold_val_raw is not None else None
            X_fold_test = _prepare_X(fold["X_test"], model_type)

            model_cls = get_model_class(model_type)
            fold_model: BaseModel = model_cls(task_type=task_type, device=device, **hyperparams)
            total_epochs = fold_model.get_total_epochs()

            def make_fold_progress_callback(fold_idx: int, n_folds: int, total_ep: int):
                def callback(progress: TrainProgress):
                    if cancel_event.is_set():
                        raise InterruptedError("Training cancelled")
                    progress.extra_metrics["fold"] = fold_idx + 1
                    progress.extra_metrics["n_folds"] = n_folds
                    progress.extra_metrics["stage"] = "training"
                    progress.extra_metrics["detail"] = f"Fold {fold_idx+1}/{n_folds} - Epoch {progress.epoch}/{total_ep}"
                    self._write_progress(job_id, progress)
                    self._update_job_progress(job_id, progress)
                return callback

            self._write_progress(job_id, TrainProgress(
                epoch=0, total_epochs=total_epochs,
                extra_metrics={"stage": "training", "detail": f"Fold {i+1}/{n_folds} 训练中...", "fold": i+1, "n_folds": n_folds},
            ))

            fold_model.fit(
                X_fold_train, y_fold_train,
                X_val=X_fold_val, y_val=y_fold_val,
                progress_callback=make_fold_progress_callback(i, n_folds, total_epochs),
                n_classes=n_classes if n_classes > 0 else None,
            )

            fold_eval = Evaluator.evaluate(
                fold_model, X_fold_test, fold["y_test"], task_type, class_names
            )
            fold_evals.append(fold_eval)
            logger.info(
                f"Job {job_id}: Fold {i+1}/{n_folds} - "
                f"acc={fold_eval.get('accuracy', 'N/A')}"
            )

        # 聚合指标 (mean ± std)
        aggregated: dict[str, Any] = {}
        metric_keys = ["accuracy", "f1_macro", "f1_weighted", "precision_macro", "recall_macro",
                       "loss", "mse", "mae", "r2_score"]
        for key in metric_keys:
            values = [e[key] for e in fold_evals if key in e and e[key] is not None]
            if values:
                aggregated[key] = float(np.mean(values))
                aggregated[f"{key}_std"] = float(np.std(values))

        # 使用最后一个 fold 的 CM 和 class_names（示意）
        last_eval = fold_evals[-1] if fold_evals else {}
        aggregated["confusion_matrix"] = last_eval.get("confusion_matrix")
        aggregated["classification_report"] = last_eval.get("classification_report")
        aggregated["class_names"] = last_eval.get("class_names", class_names)
        aggregated["k_fold_details"] = [
            {k: v for k, v in e.items() if k not in ("predictions", "confusion_matrix", "classification_report")}
            for e in fold_evals
        ]

        return {"test": aggregated}

    def _build_dataset(
        self,
        task_type: str,
        config: dict[str, Any],
    ) -> dict[str, Any] | None:
        """构建训练数据集"""
        label_config_name = config["label_config_name"]
        sample_ids = config.get("sample_ids")
        run_ids = config.get("run_ids")
        train_ratio = config.get("train_ratio", 0.7)
        val_ratio = config.get("val_ratio", 0.15)
        n_samples = config.get("series_n_samples") or config.get("frame_n_samples", 100)
        method = config.get("series_method") or config.get("frame_method", "linear")
        seed = config.get("seed", 42)
        split_method = config.get("split_method", "stratified_holdout")
        k_folds = config.get("k_folds", 5)

        if task_type == "classification":
            return self._dataset_builder.build_classification_dataset(
                config_name=label_config_name,
                run_ids=run_ids,
                sample_ids=sample_ids,
                n_samples=n_samples,
                method=method,
                train_ratio=train_ratio,
                val_ratio=val_ratio,
                seed=seed,
                split_method=split_method,
                k_folds=k_folds,
            )
        elif task_type == "regression":
            return self._dataset_builder.build_regression_dataset(
                config_name=label_config_name,
                run_ids=run_ids,
                sample_ids=sample_ids,
                n_samples=n_samples,
                method=method,
                train_ratio=train_ratio,
                val_ratio=val_ratio,
                seed=seed,
                split_method=split_method,
                k_folds=k_folds,
            )
        else:
            logger.warning(f"Unsupported task_type for dataset: {task_type}")
            return None

    def _update_job_status(
        self,
        job_id: str,
        status: str,
        started_at: datetime | None = None,
        error_message: str | None = None,
    ):
        """更新 training_job 状态"""
        with get_connection() as conn:
            with conn.cursor() as cur:
                if started_at:
                    cur.execute(
                        "UPDATE training_jobs SET status = %s, started_at = %s WHERE id = %s",
                        (status, started_at, job_id),
                    )
                elif error_message:
                    cur.execute(
                        "UPDATE training_jobs SET status = %s, error_message = %s, completed_at = NOW() WHERE id = %s",
                        (status, error_message, job_id),
                    )
                else:
                    cur.execute(
                        "UPDATE training_jobs SET status = %s WHERE id = %s",
                        (status, job_id),
                    )
            conn.commit()

    def _update_job_progress(self, job_id: str, progress: TrainProgress):
        """更新 training_job 的当前进度"""
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE training_jobs SET
                        current_epoch = %s,
                        train_loss = %s,
                        val_loss = %s,
                        train_accuracy = %s,
                        val_accuracy = %s
                    WHERE id = %s
                """, (
                    progress.epoch,
                    progress.train_loss,
                    progress.val_loss,
                    progress.train_accuracy,
                    progress.val_accuracy,
                    job_id,
                ))
            conn.commit()

    def _write_progress(self, job_id: str, progress: TrainProgress):
        """写入 training_progress 表"""
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO training_progress
                        (job_id, epoch, train_loss, val_loss, train_accuracy, val_accuracy, metrics)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    job_id,
                    progress.epoch,
                    progress.train_loss,
                    progress.val_loss,
                    progress.train_accuracy,
                    progress.val_accuracy,
                    json.dumps(progress.extra_metrics) if progress.extra_metrics else None,
                ))
            conn.commit()

    def _save_evaluation(
        self,
        job_id: str,
        model_id: str,
        split: str,
        eval_data: dict[str, Any],
    ):
        """保存评估结果到 training_evaluations 表"""
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO training_evaluations
                        (job_id, model_id, split,
                         accuracy, loss, f1_macro, f1_weighted,
                         precision_macro, recall_macro,
                         r2_score, mse, mae,
                         confusion_matrix, classification_report, predictions)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    job_id,
                    model_id,
                    split,
                    eval_data.get("accuracy"),
                    eval_data.get("loss"),
                    eval_data.get("f1_macro"),
                    eval_data.get("f1_weighted"),
                    eval_data.get("precision_macro"),
                    eval_data.get("recall_macro"),
                    eval_data.get("r2_score"),
                    eval_data.get("mse"),
                    eval_data.get("mae"),
                    json.dumps(_sanitize_for_json(eval_data.get("confusion_matrix"))) if eval_data.get("confusion_matrix") else None,
                    json.dumps(_sanitize_for_json(eval_data.get("classification_report"))) if eval_data.get("classification_report") else None,
                    json.dumps(_sanitize_for_json(eval_data.get("predictions"))) if eval_data.get("predictions") else None,
                ))
            conn.commit()

    # ── 查询接口 ──

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        """获取训练任务详情"""
        with get_cursor() as cur:
            cur.execute("SELECT * FROM training_jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
        return dict(row) if row else None

    def list_jobs(
        self,
        limit: int = 20,
        offset: int = 0,
        status: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """列出训练任务"""
        where = ""
        params: list[Any] = []
        if status:
            where = "WHERE status = %s"
            params.append(status)

        with get_cursor() as cur:
            cur.execute(f"SELECT COUNT(*) as total FROM training_jobs {where}", params)
            total = cur.fetchone()["total"]

            cur.execute(
                f"SELECT * FROM training_jobs {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
                params + [limit, offset],
            )
            rows = cur.fetchall()

        return [dict(r) for r in rows], total

    def get_job_progress(self, job_id: str) -> list[dict[str, Any]]:
        """获取训练进度历史"""
        with get_cursor() as cur:
            cur.execute(
                "SELECT * FROM training_progress WHERE job_id = %s ORDER BY epoch",
                (job_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    def get_evaluation(self, job_id: str) -> list[dict[str, Any]]:
        """获取训练评估结果"""
        with get_cursor() as cur:
            cur.execute(
                "SELECT * FROM training_evaluations WHERE job_id = %s ORDER BY split",
                (job_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    def cancel_training(self, job_id: str) -> bool:
        """取消训练任务"""
        cancel_event = self._cancel_flags.get(job_id)
        if cancel_event:
            cancel_event.set()
            logger.info(f"Cancel signal sent to job {job_id}")
            return True

        # 如果任务不在活跃列表但状态为 PENDING/RUNNING，直接更新
        job = self.get_job(job_id)
        if job and job["status"] in ("PENDING", "RUNNING"):
            self._update_job_status(job_id, "CANCELLED")
            return True

        return False

    def delete_job(self, job_id: str) -> bool:
        """删除训练任务及其关联数据"""
        # 如果任务还在运行，先取消
        self.cancel_training(job_id)

        with get_connection() as conn:
            with conn.cursor() as cur:
                # 删除评估记录
                cur.execute("DELETE FROM training_evaluations WHERE job_id = %s", (job_id,))
                # 删除进度记录
                cur.execute("DELETE FROM training_progress WHERE job_id = %s", (job_id,))
                # 删除任务本身
                cur.execute("DELETE FROM training_jobs WHERE id = %s", (job_id,))
                deleted = cur.rowcount > 0
            conn.commit()

        if deleted:
            logger.info(f"Deleted training job {job_id}")
        return deleted
