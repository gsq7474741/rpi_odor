"""ModelService gRPC 服务实现"""

import json
import time
from typing import Iterator

import grpc
from google.protobuf import empty_pb2, timestamp_pb2

from ..db.model_repository import ModelRepository
from ..ml.training_manager import TrainingManager
from ..logger import logger
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc


# 全局训练管理器单例
_training_manager: TrainingManager | None = None


def get_training_manager() -> TrainingManager:
    global _training_manager
    if _training_manager is None:
        _training_manager = TrainingManager()
    return _training_manager


class ModelServiceImpl(pb_grpc.ModelServiceServicer):
    """ModelService gRPC 实现"""

    def __init__(self):
        self._model_repo = ModelRepository()
        self._loaded_model_id: str | None = None
        self._manager = get_training_manager()

    # ── 训练平台 RPC ──

    def StartTraining(
        self,
        request: pb.StartTrainingRequest,
        context: grpc.ServicerContext,
    ) -> pb.StartTrainingResponse:
        """启动训练任务"""
        logger.info(f"StartTraining: name={request.name}, model={request.model_type}, task={request.task_type}")

        try:
            hyperparams = {}
            if request.hyperparams_json:
                hyperparams = json.loads(request.hyperparams_json)

            # split_method/k_folds 暂时从 hyperparams 中提取（proto 更新后改用专属字段）
            split_method = hyperparams.pop("split_method", "stratified_holdout")
            k_folds = int(hyperparams.pop("k_folds", 5))

            job_id = self._manager.start_training(
                name=request.name,
                description=request.description,
                model_type=request.model_type,
                task_type=request.task_type,
                label_config_name=request.label_config_name,
                sample_ids=list(request.sample_ids) if request.sample_ids else None,
                run_ids=list(request.run_ids) if request.run_ids else None,
                train_ratio=request.train_ratio or 0.7,
                val_ratio=request.val_ratio or 0.15,
                series_n_samples=request.series_n_samples or 100,
                series_method=request.series_method or "linear",
                seed=request.seed or 42,
                hyperparams=hyperparams,
                split_method=split_method,
                k_folds=k_folds,
            )

            return pb.StartTrainingResponse(
                job_id=job_id,
                message=f"Training job {job_id} started",
            )

        except Exception as e:
            logger.exception(f"StartTraining failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.StartTrainingResponse()

    def GetTrainingJob(
        self,
        request: pb.GetTrainingJobRequest,
        context: grpc.ServicerContext,
    ) -> pb.TrainingJobInfo:
        """获取训练任务状态"""
        try:
            job = self._manager.get_job(request.job_id)
            if not job:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Job {request.job_id} not found")
                return pb.TrainingJobInfo()
            return self._job_to_proto(job)
        except Exception as e:
            logger.exception(f"GetTrainingJob failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.TrainingJobInfo()

    def ListTrainingJobs(
        self,
        request: pb.ListTrainingJobsRequest,
        context: grpc.ServicerContext,
    ) -> pb.ListTrainingJobsResponse:
        """列出训练任务"""
        try:
            limit = request.limit if request.limit > 0 else 20
            offset = request.offset if request.offset >= 0 else 0
            status = request.status_filter if request.status_filter else None

            jobs, total = self._manager.list_jobs(limit=limit, offset=offset, status=status)

            response = pb.ListTrainingJobsResponse(total=total)
            for job in jobs:
                response.jobs.append(self._job_to_proto(job))
            return response

        except Exception as e:
            logger.exception(f"ListTrainingJobs failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.ListTrainingJobsResponse()

    def CancelTraining(
        self,
        request: pb.CancelTrainingRequest,
        context: grpc.ServicerContext,
    ) -> empty_pb2.Empty:
        """取消训练任务"""
        logger.info(f"CancelTraining: job_id={request.job_id}")
        try:
            cancelled = self._manager.cancel_training(request.job_id)
            if not cancelled:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Job {request.job_id} not found or already finished")
            return empty_pb2.Empty()
        except Exception as e:
            logger.exception(f"CancelTraining failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return empty_pb2.Empty()

    def DeleteTrainingJob(
        self,
        request: pb.DeleteTrainingJobRequest,
        context: grpc.ServicerContext,
    ) -> empty_pb2.Empty:
        """删除训练任务及其关联数据"""
        logger.info(f"DeleteTrainingJob: job_id={request.job_id}")
        try:
            deleted = self._manager.delete_job(request.job_id)
            if not deleted:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Job {request.job_id} not found")
            return empty_pb2.Empty()
        except Exception as e:
            logger.exception(f"DeleteTrainingJob failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return empty_pb2.Empty()

    def StreamTrainingProgress(
        self,
        request: pb.StreamTrainingProgressRequest,
        context: grpc.ServicerContext,
    ) -> Iterator[pb.TrainingProgressUpdate]:
        """流式获取训练进度"""
        job_id = request.job_id
        logger.info(f"StreamTrainingProgress: job_id={job_id}")

        last_epoch = -1
        last_status = ""
        while context.is_active():
            job = self._manager.get_job(job_id)
            if not job:
                return

            current_epoch = job.get("current_epoch", 0) or 0
            status = job.get("status", "")

            # 发送进度更新（epoch 变化或状态变化时）
            if current_epoch > last_epoch or status != last_status:
                yield pb.TrainingProgressUpdate(
                    epoch=current_epoch,
                    total_epochs=job.get("total_epochs", 0) or 0,
                    train_loss=job.get("train_loss", 0.0) or 0.0,
                    val_loss=job.get("val_loss", 0.0) or 0.0,
                    train_accuracy=job.get("train_accuracy", 0.0) or 0.0,
                    val_accuracy=job.get("val_accuracy", 0.0) or 0.0,
                    extra_metrics_json=json.dumps({
                        "jobStatus": status,
                        "errorMessage": job.get("error_message") or "",
                    }),
                )
                last_epoch = current_epoch
                last_status = status

            if status in ("COMPLETED", "FAILED", "CANCELLED"):
                return

            time.sleep(1)

    def GetTrainingJobProgress(
        self,
        request: pb.GetTrainingJobProgressRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetTrainingJobProgressResponse:
        """获取训练进度历史（用于查看已完成任务的训练曲线）"""
        try:
            entries = self._manager.get_job_progress(request.job_id)
            response = pb.GetTrainingJobProgressResponse()
            for entry in entries:
                response.entries.append(pb.TrainingProgressUpdate(
                    epoch=entry.get("epoch", 0) or 0,
                    total_epochs=0,
                    train_loss=entry.get("train_loss", 0.0) or 0.0,
                    val_loss=entry.get("val_loss", 0.0) or 0.0,
                    train_accuracy=entry.get("train_accuracy", 0.0) or 0.0,
                    val_accuracy=entry.get("val_accuracy", 0.0) or 0.0,
                    extra_metrics_json=json.dumps(entry["metrics"]) if entry.get("metrics") else "",
                ))
            return response
        except Exception as e:
            logger.exception(f"GetTrainingJobProgress failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetTrainingJobProgressResponse()

    def GetTrainingEvaluation(
        self,
        request: pb.GetTrainingEvaluationRequest,
        context: grpc.ServicerContext,
    ) -> pb.GetTrainingEvaluationResponse:
        """获取训练评估详情"""
        try:
            evals = self._manager.get_evaluation(request.job_id)
            response = pb.GetTrainingEvaluationResponse()
            for ev in evals:
                response.evaluations.append(pb.TrainingEvaluation(
                    id=str(ev.get("id", "")),
                    job_id=str(ev.get("job_id", "")),
                    model_id=str(ev.get("model_id", "")) if ev.get("model_id") else "",
                    split=ev.get("split", ""),
                    accuracy=ev.get("accuracy") or 0.0,
                    loss=ev.get("loss") or 0.0,
                    f1_macro=ev.get("f1_macro") or 0.0,
                    f1_weighted=ev.get("f1_weighted") or 0.0,
                    precision_macro=ev.get("precision_macro") or 0.0,
                    recall_macro=ev.get("recall_macro") or 0.0,
                    r2_score=ev.get("r2_score") or 0.0,
                    mse=ev.get("mse") or 0.0,
                    mae=ev.get("mae") or 0.0,
                    silhouette_score=ev.get("silhouette_score") or 0.0,
                    confusion_matrix_json=json.dumps(ev["confusion_matrix"]) if ev.get("confusion_matrix") else "",
                    classification_report_json=json.dumps(ev["classification_report"]) if ev.get("classification_report") else "",
                ))
            return response
        except Exception as e:
            logger.exception(f"GetTrainingEvaluation failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetTrainingEvaluationResponse()

    # ── Legacy / 已有 RPC ──

    def TrainModel(
        self,
        request: pb.TrainModelRequest,
        context: grpc.ServicerContext,
    ) -> Iterator[pb.TrainProgress]:
        """训练模型 (legacy, 请使用 StartTraining)"""
        logger.info(f"TrainModel (legacy): name={request.name}")
        yield pb.TrainProgress(
            epoch=0,
            total_epochs=request.epochs or 100,
            status=pb.TRAIN_STARTED,
            message="Please use StartTraining RPC instead",
        )

    def ListModels(
        self,
        request: pb.ListModelsRequest,
        context: grpc.ServicerContext,
    ) -> pb.ListModelsResponse:
        """列出模型"""
        logger.info(f"ListModels: limit={request.limit}, offset={request.offset}")

        try:
            limit = request.limit if request.limit > 0 else 100
            offset = request.offset if request.offset >= 0 else 0

            models, total = self._model_repo.list_models(limit=limit, offset=offset)

            response = pb.ListModelsResponse(total=total)
            for model in models:
                response.models.append(self._to_proto(model))

            return response

        except Exception as e:
            logger.exception(f"ListModels failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.ListModelsResponse()

    def GetModel(
        self,
        request: pb.GetModelRequest,
        context: grpc.ServicerContext,
    ) -> pb.ModelInfo:
        """获取模型详情"""
        logger.info(f"GetModel: id={request.model_id}")

        try:
            model = self._model_repo.get_by_id(request.model_id)
            if not model:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Model {request.model_id} not found")
                return pb.ModelInfo()

            return self._to_proto(model)

        except Exception as e:
            logger.exception(f"GetModel failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.ModelInfo()

    def LoadModel(
        self,
        request: pb.LoadModelRequest,
        context: grpc.ServicerContext,
    ) -> empty_pb2.Empty:
        """加载模型"""
        logger.info(f"LoadModel: id={request.model_id}")
        self._loaded_model_id = request.model_id
        return empty_pb2.Empty()

    def UnloadModel(
        self,
        request: empty_pb2.Empty,
        context: grpc.ServicerContext,
    ) -> empty_pb2.Empty:
        """卸载模型"""
        logger.info("UnloadModel")
        self._loaded_model_id = None
        return empty_pb2.Empty()

    def Predict(
        self,
        request: pb.PredictRequest,
        context: grpc.ServicerContext,
    ) -> pb.PredictResponse:
        """推理"""
        logger.info("Predict")
        
        if not self._loaded_model_id:
            context.set_code(grpc.StatusCode.FAILED_PRECONDITION)
            context.set_details("No model loaded")
            return pb.PredictResponse()

        return pb.PredictResponse(
            result=pb.PredictResult(
                predicted_class="unknown",
                predicted_index=0,
                confidence=0.0,
            )
        )

    def DeleteModel(
        self,
        request: pb.DeleteModelRequest,
        context: grpc.ServicerContext,
    ) -> empty_pb2.Empty:
        """删除模型"""
        logger.info(f"DeleteModel: id={request.model_id}")

        try:
            deleted = self._model_repo.delete(request.model_id)
            if not deleted:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Model {request.model_id} not found")

            return empty_pb2.Empty()

        except Exception as e:
            logger.exception(f"DeleteModel failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return empty_pb2.Empty()

    # ── 转换辅助 ──

    def _to_proto(self, model: dict) -> pb.ModelInfo:
        """转换为 proto 消息"""
        config = model.get("config") or {}
        
        proto_model = pb.ModelInfo(
            id=str(model["id"]),
            name=model["name"],
            description=model.get("description") or "",
            input_dim=model.get("input_dim", 0),
            output_dim=model.get("output_dim", 0),
            train_accuracy=model.get("train_accuracy") or 0.0,
            val_accuracy=model.get("val_accuracy") or 0.0,
            train_loss=model.get("train_loss") or 0.0,
            val_loss=model.get("val_loss") or 0.0,
            minio_path=model.get("minio_path") or "",
            file_size=model.get("file_size") or 0,
            is_loaded=(str(model["id"]) == self._loaded_model_id),
            model_type=model.get("model_type") or "mlp",
            task_type=model.get("task_type") or "classification",
            framework=model.get("framework") or "pytorch",
            test_accuracy=model.get("test_accuracy") or 0.0,
            confusion_matrix_json=json.dumps(model["confusion_matrix"]) if model.get("confusion_matrix") else "",
            extra_metrics_json=json.dumps(model["extra_metrics"]) if model.get("extra_metrics") else "",
            training_job_id=str(model["training_job_id"]) if model.get("training_job_id") else "",
        )

        # 设置 MLP 配置 (legacy)
        if config and isinstance(config, dict):
            proto_model.config.CopyFrom(pb.MLPConfig(
                hidden_layers=config.get("hidden_layers", [64, 32]),
                activation=config.get("activation", "relu"),
                dropout=config.get("dropout", 0.2),
            ))

        # 设置类名
        if model.get("class_names"):
            proto_model.class_names.extend(model["class_names"])

        # 设置时间戳
        if model.get("created_at"):
            ts = timestamp_pb2.Timestamp()
            ts.FromDatetime(model["created_at"])
            proto_model.created_at.CopyFrom(ts)

        return proto_model

    def _job_to_proto(self, job: dict) -> pb.TrainingJobInfo:
        """训练任务转 proto"""
        info = pb.TrainingJobInfo(
            id=str(job["id"]),
            model_name=job.get("model_name") or "",
            model_type=job.get("model_type") or "mlp",
            task_type=job.get("task_type") or "classification",
            status=job.get("status") or "UNKNOWN",
            current_epoch=job.get("current_epoch") or 0,
            total_epochs=job.get("total_epochs") or 0,
            train_loss=job.get("train_loss") or 0.0,
            val_loss=job.get("val_loss") or 0.0,
            train_accuracy=job.get("train_accuracy") or 0.0,
            val_accuracy=job.get("val_accuracy") or 0.0,
            test_accuracy=job.get("test_accuracy") or 0.0,
            hyperparams_json=json.dumps(job["hyperparams"]) if job.get("hyperparams") else "",
            dataset_config_json=json.dumps(job["dataset_config"]) if job.get("dataset_config") else "",
            error_message=job.get("error_message") or "",
            model_id=str(job["model_id"]) if job.get("model_id") else "",
            extra_metrics_json=json.dumps(job["extra_metrics"]) if job.get("extra_metrics") else "",
        )

        for field_name in ("created_at", "started_at", "completed_at"):
            val = job.get(field_name)
            if val:
                ts = timestamp_pb2.Timestamp()
                ts.FromDatetime(val)
                getattr(info, field_name).CopyFrom(ts)

        return info


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_ModelServiceServicer_to_server(ModelServiceImpl(), server)
    logger.info("ModelService registered")
