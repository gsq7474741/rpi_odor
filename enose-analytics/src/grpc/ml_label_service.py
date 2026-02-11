"""MLLabelService gRPC 服务实现"""

import json
import math

import grpc
from google.protobuf import empty_pb2

from ..db.ml_label_repository import MLLabelRepository
from ..ml.label_generator import LabelGenerator
from ..ml.dataset_builder import DatasetBuilder
from ..logger import logger
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc


class MLLabelServiceImpl(pb_grpc.MLLabelServiceServicer):
    """MLLabelService gRPC 实现"""

    def __init__(self):
        self._repo = MLLabelRepository()
        self._generator = LabelGenerator()
        self._dataset_builder = DatasetBuilder()

    def ListMLLabelConfigs(self, request, context):
        logger.info(f"ListMLLabelConfigs: active_only={request.active_only}")
        try:
            configs = self._repo.list_configs(active_only=request.active_only)
            response = pb.ListMLLabelConfigsResponse()
            for c in configs:
                response.configs.append(self._config_to_proto(c))
            return response
        except Exception as e:
            logger.exception(f"ListMLLabelConfigs failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.ListMLLabelConfigsResponse()

    def GetMLLabelConfig(self, request, context):
        logger.info(f"GetMLLabelConfig: name={request.name}")
        try:
            config = self._repo.get_config_by_name(request.name)
            if not config:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Config '{request.name}' not found")
                return pb.MLLabelConfig()
            return self._config_to_proto(config)
        except Exception as e:
            logger.exception(f"GetMLLabelConfig failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.MLLabelConfig()

    def CreateMLLabelConfig(self, request, context):
        logger.info(f"CreateMLLabelConfig: name={request.name}")
        try:
            config_dict = json.loads(request.config_json) if request.config_json else {}
            config = self._repo.create_config(
                name=request.name,
                label_type=request.label_type,
                strategy=request.strategy,
                config=config_dict,
                description=request.description or None,
            )
            return self._config_to_proto(config)
        except Exception as e:
            logger.exception(f"CreateMLLabelConfig failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.MLLabelConfig()

    def UpdateMLLabelConfig(self, request, context):
        logger.info(f"UpdateMLLabelConfig: id={request.id}")
        try:
            updates = {}
            if request.HasField("name"):
                updates["name"] = request.name
            if request.HasField("description"):
                updates["description"] = request.description
            if request.HasField("config_json"):
                updates["config"] = json.loads(request.config_json)
            if request.HasField("is_active"):
                updates["is_active"] = request.is_active

            config = self._repo.update_config(request.id, updates)
            if not config:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                return pb.MLLabelConfig()
            return self._config_to_proto(config)
        except Exception as e:
            logger.exception(f"UpdateMLLabelConfig failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.MLLabelConfig()

    def DeleteMLLabelConfig(self, request, context):
        logger.info(f"DeleteMLLabelConfig: id={request.id}")
        try:
            deleted = self._repo.delete_config(request.id)
            if not deleted:
                context.set_code(grpc.StatusCode.NOT_FOUND)
            return empty_pb2.Empty()
        except Exception as e:
            logger.exception(f"DeleteMLLabelConfig failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return empty_pb2.Empty()

    def GenerateLabels(self, request, context):
        config_name = request.config_name or None
        run_ids = list(request.run_ids) if request.run_ids else None
        phase_names = list(request.phase_names) if request.phase_names else None
        sample_ids = list(request.sample_ids) if request.sample_ids else None
        logger.info(f"GenerateLabels: config={config_name}, runs={run_ids}, samples={sample_ids}, phases={phase_names}")

        try:
            if config_name:
                count = self._generator.generate_for_config(
                    config_name=config_name,
                    run_ids=run_ids,
                    phase_names=phase_names,
                    sample_ids=sample_ids,
                )
                counts = {config_name: count}
            else:
                counts = self._generator.generate_for_all_configs(
                    run_ids=run_ids,
                    phase_names=phase_names,
                    sample_ids=sample_ids,
                )

            response = pb.GenerateLabelsResponse()
            total = 0
            for name, count in counts.items():
                response.generated_counts[name] = count
                total += count
            response.message = f"Generated {total} labels across {len(counts)} configs"
            return response
        except Exception as e:
            logger.exception(f"GenerateLabels failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GenerateLabelsResponse()

    def GetLabelDistribution(self, request, context):
        run_ids = list(request.run_ids) if request.run_ids else None
        phase_names = list(request.phase_names) if request.phase_names else None
        sample_ids = list(request.sample_ids) if request.sample_ids else None
        logger.info(f"GetLabelDistribution: config={request.config_name}, samples={sample_ids}, runs={run_ids}")
        try:
            config = self._repo.get_config_by_name(request.config_name)
            if not config:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                return pb.GetLabelDistributionResponse()

            distribution = self._repo.get_label_distribution(
                request.config_name,
                run_ids=run_ids,
                phase_names=phase_names,
                sample_ids=sample_ids,
            )
            response = pb.GetLabelDistributionResponse(
                config_name=request.config_name,
                label_type=config["label_type"],
                total_samples=sum(distribution.values()),
            )

            for idx, (label, count) in enumerate(distribution.items()):
                response.buckets.append(pb.LabelBucket(
                    label=label,
                    count=count,
                    label_index=idx,
                ))
            return response
        except Exception as e:
            logger.exception(f"GetLabelDistribution failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetLabelDistributionResponse()

    def GetSampleMLLabels(self, request, context):
        logger.info(f"GetSampleMLLabels: sample_id={request.sample_id}")
        try:
            labels = self._repo.get_labels_for_sample(request.sample_id)
            response = pb.GetSampleMLLabelsResponse()
            for lbl in labels:
                response.labels.append(pb.SampleMLLabel(
                    config_name=lbl.get("config_name", ""),
                    label_type=lbl.get("label_type", ""),
                    label_str=lbl.get("label_str") or "",
                    label_num=lbl.get("label_num") or 0.0,
                    label_index=lbl.get("label_index") or 0,
                ))
            return response
        except Exception as e:
            logger.exception(f"GetSampleMLLabels failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.GetSampleMLLabelsResponse()

    def PreviewDataset(self, request, context):
        logger.info(f"PreviewDataset: config={request.config_name}")
        try:
            config = self._repo.get_config_by_name(request.config_name)
            if not config:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                return pb.PreviewDatasetResponse()

            run_ids = list(request.run_ids) if request.run_ids else None
            phase_names = list(request.phase_names) if request.phase_names else None
            sample_ids = list(request.sample_ids) if request.sample_ids else None

            labels = self._repo.get_labels_by_config(
                config_name=request.config_name,
                run_ids=run_ids,
                phase_names=phase_names,
                sample_ids=sample_ids,
            )

            total = len(labels)
            train_ratio = request.train_ratio if request.train_ratio > 0 else 0.7
            val_ratio = request.val_ratio if request.val_ratio > 0 else 0.15
            test_ratio = request.test_ratio if request.test_ratio > 0 else 0.15

            train_count = math.floor(total * train_ratio)
            val_count = math.floor(total * val_ratio)
            test_count = total - train_count - val_count

            # 计算分布
            dist: dict[str, int] = {}
            for lbl in labels:
                key = lbl.get("label_str") or f"num:{lbl.get('label_num', 0):.3f}"
                dist[key] = dist.get(key, 0) + 1

            response = pb.PreviewDatasetResponse(
                config_name=request.config_name,
                label_type=config["label_type"],
                total_samples=total,
                train_count=train_count,
                val_count=val_count,
                test_count=test_count,
            )
            for idx, (label, count) in enumerate(sorted(dist.items(), key=lambda x: -x[1])):
                response.label_distribution.append(pb.LabelBucket(
                    label=label,
                    count=count,
                    label_index=idx,
                ))
            return response
        except Exception as e:
            logger.exception(f"PreviewDataset failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.PreviewDatasetResponse()

    def get_dataset_summary(
        self,
        config_name: str,
        sample_ids: list[int] | None = None,
        run_ids: list[int] | None = None,
        phase_names: list[str] | None = None,
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        split_method: str = "stratified_holdout",
        k_folds: int = 5,
    ) -> dict:
        """获取数据集摘要（供 REST API 直接调用，不走 gRPC proto）"""
        config = self._repo.get_config_by_name(config_name)
        if not config:
            return {"error": f"Config '{config_name}' not found"}

        labels = self._repo.get_labels_by_config(
            config_name=config_name,
            run_ids=run_ids,
            phase_names=phase_names,
            sample_ids=sample_ids,
        )

        summary = DatasetBuilder.compute_dataset_summary(
            labels=labels,
            train_ratio=train_ratio,
            val_ratio=val_ratio,
            split_method=split_method,
            k_folds=k_folds,
            label_type=config["label_type"],
        )
        summary["config_name"] = config_name
        summary["label_type"] = config["label_type"]
        return summary

    def _config_to_proto(self, config: dict) -> pb.MLLabelConfig:
        label_count = self._repo.count_labels(config["id"])
        config_json = config.get("config", {})
        if isinstance(config_json, dict):
            config_json = json.dumps(config_json)
        return pb.MLLabelConfig(
            id=config["id"],
            name=config["name"],
            label_type=config["label_type"],
            strategy=config["strategy"],
            config_json=config_json,
            description=config.get("description") or "",
            is_active=config.get("is_active", True),
            label_count=label_count,
        )


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_MLLabelServiceServicer_to_server(MLLabelServiceImpl(), server)
    logger.info("MLLabelService registered")
