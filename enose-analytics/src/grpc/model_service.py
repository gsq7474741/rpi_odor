"""ModelService gRPC 服务实现"""

import logging
from typing import Iterator

import grpc
from google.protobuf import empty_pb2, timestamp_pb2

from ..db.model_repository import ModelRepository
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc

logger = logging.getLogger(__name__)


class ModelServiceImpl(pb_grpc.ModelServiceServicer):
    """ModelService gRPC 实现"""

    def __init__(self):
        self._model_repo = ModelRepository()
        self._loaded_model_id: str | None = None

    def TrainModel(
        self,
        request: pb.TrainModelRequest,
        context: grpc.ServicerContext,
    ) -> Iterator[pb.TrainProgress]:
        """训练模型 (流式返回进度)"""
        logger.info(f"TrainModel: name={request.name}")
        
        # TODO: 实现模型训练
        yield pb.TrainProgress(
            epoch=0,
            total_epochs=request.epochs or 100,
            status=pb.TRAIN_STARTED,
            message="Training not implemented yet",
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
        
        # TODO: 实现模型加载
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
        
        # TODO: 实现推理
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

    def _to_proto(self, model: dict) -> pb.ModelInfo:
        """转换为 proto 消息"""
        config = model.get("config") or {}
        
        proto_model = pb.ModelInfo(
            id=str(model["id"]),
            name=model["name"],
            description=model.get("description") or "",
            input_dim=model.get("input_dim", 0),
            output_dim=model.get("output_dim", 0),
            train_accuracy=model.get("train_accuracy", 0.0),
            val_accuracy=model.get("val_accuracy", 0.0),
            train_loss=model.get("train_loss", 0.0),
            val_loss=model.get("val_loss", 0.0),
            minio_path=model.get("minio_path") or "",
            file_size=model.get("file_size", 0),
            is_loaded=(str(model["id"]) == self._loaded_model_id),
        )

        # 设置 MLP 配置
        if config:
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


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_ModelServiceServicer_to_server(ModelServiceImpl(), server)
    logger.info("ModelService registered")
