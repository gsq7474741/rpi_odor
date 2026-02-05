"""LabelService gRPC 服务实现"""

from datetime import datetime

import grpc
from google.protobuf import empty_pb2, timestamp_pb2

from ..db.label_repository import LabelRepository
from ..logger import logger
from ..generated import enose_analytics_pb2 as pb
from ..generated import enose_analytics_pb2_grpc as pb_grpc



class LabelServiceImpl(pb_grpc.LabelServiceServicer):
    """LabelService gRPC 实现"""

    def __init__(self):
        self._label_repo = LabelRepository()

    def CreateLabel(
        self,
        request: pb.CreateLabelRequest,
        context: grpc.ServicerContext,
    ) -> pb.SampleLabel:
        """创建标签"""
        logger.info(f"CreateLabel: name={request.name}")

        try:
            label = self._label_repo.create(
                name=request.name,
                description=request.description if request.description else None,
            )

            # 添加标注范围
            for r in request.ranges:
                start_time = r.start_time.ToDatetime() if r.HasField("start_time") else None
                end_time = r.end_time.ToDatetime() if r.HasField("end_time") else None
                if start_time and end_time:
                    self._label_repo.add_range(
                        label_id=label["id"],
                        start_time=start_time,
                        end_time=end_time,
                        experiment_id=r.experiment_id if r.experiment_id else None,
                        phase=r.phase if r.phase else None,
                    )

            return self._to_proto(label)

        except Exception as e:
            logger.exception(f"CreateLabel failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.SampleLabel()

    def ListLabels(
        self,
        request: pb.ListLabelsRequest,
        context: grpc.ServicerContext,
    ) -> pb.ListLabelsResponse:
        """列出标签"""
        logger.info(f"ListLabels: limit={request.limit}, offset={request.offset}")

        try:
            experiment_id = request.experiment_id if request.HasField("experiment_id") else None
            limit = request.limit if request.limit > 0 else 100
            offset = request.offset if request.offset >= 0 else 0

            labels, total = self._label_repo.list_labels(
                experiment_id=experiment_id,
                limit=limit,
                offset=offset,
            )

            response = pb.ListLabelsResponse(total=total)
            for label in labels:
                response.labels.append(self._to_proto(label))

            return response

        except Exception as e:
            logger.exception(f"ListLabels failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.ListLabelsResponse()

    def UpdateLabel(
        self,
        request: pb.UpdateLabelRequest,
        context: grpc.ServicerContext,
    ) -> pb.SampleLabel:
        """更新标签"""
        logger.info(f"UpdateLabel: id={request.id}")

        try:
            name = request.name if request.HasField("name") else None
            description = request.description if request.HasField("description") else None

            label = self._label_repo.update(
                label_id=request.id,
                name=name,
                description=description,
            )

            if not label:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Label {request.id} not found")
                return pb.SampleLabel()

            # 处理范围
            if request.ranges:
                if request.replace_ranges:
                    self._label_repo.delete_ranges(request.id)
                for r in request.ranges:
                    start_time = r.start_time.ToDatetime() if r.HasField("start_time") else None
                    end_time = r.end_time.ToDatetime() if r.HasField("end_time") else None
                    if start_time and end_time:
                        self._label_repo.add_range(
                            label_id=request.id,
                            start_time=start_time,
                            end_time=end_time,
                            experiment_id=r.experiment_id if r.experiment_id else None,
                            phase=r.phase if r.phase else None,
                        )

            return self._to_proto(label)

        except Exception as e:
            logger.exception(f"UpdateLabel failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.SampleLabel()

    def DeleteLabel(
        self,
        request: pb.DeleteLabelRequest,
        context: grpc.ServicerContext,
    ) -> empty_pb2.Empty:
        """删除标签"""
        logger.info(f"DeleteLabel: id={request.id}")

        try:
            deleted = self._label_repo.delete(request.id)
            if not deleted:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Label {request.id} not found")

            return empty_pb2.Empty()

        except Exception as e:
            logger.exception(f"DeleteLabel failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return empty_pb2.Empty()

    def BatchLabel(
        self,
        request: pb.BatchLabelRequest,
        context: grpc.ServicerContext,
    ) -> pb.BatchLabelResponse:
        """批量标注"""
        logger.info(f"BatchLabel: label_id={request.label_id}, ranges={len(request.ranges)}")

        try:
            added_count = 0
            for r in request.ranges:
                start_time = r.start_time.ToDatetime() if r.HasField("start_time") else None
                end_time = r.end_time.ToDatetime() if r.HasField("end_time") else None
                if start_time and end_time:
                    self._label_repo.add_range(
                        label_id=request.label_id,
                        start_time=start_time,
                        end_time=end_time,
                        experiment_id=r.experiment_id if r.experiment_id else None,
                        phase=r.phase if r.phase else None,
                    )
                    added_count += 1

            return pb.BatchLabelResponse(added_count=added_count)

        except Exception as e:
            logger.exception(f"BatchLabel failed: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return pb.BatchLabelResponse()

    def _to_proto(self, label: dict) -> pb.SampleLabel:
        """转换为 proto 消息"""
        proto_label = pb.SampleLabel(
            id=str(label["id"]),
            name=label["name"],
            description=label.get("description") or "",
            sample_count=label.get("sample_count", 0),
        )

        # 设置时间戳
        if label.get("created_at"):
            ts = timestamp_pb2.Timestamp()
            created_at = label["created_at"]
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at)
            ts.FromDatetime(created_at)
            proto_label.created_at.CopyFrom(ts)

        if label.get("updated_at"):
            ts = timestamp_pb2.Timestamp()
            updated_at = label["updated_at"]
            if isinstance(updated_at, str):
                updated_at = datetime.fromisoformat(updated_at)
            ts.FromDatetime(updated_at)
            proto_label.updated_at.CopyFrom(ts)

        # 获取并添加范围
        ranges = self._label_repo.get_ranges(label["id"])
        for r in ranges:
            lr = pb.LabeledRange(
                experiment_id=r.get("experiment_id") or "",
                phase=r.get("phase") or "",
            )
            if r.get("start_time"):
                ts = timestamp_pb2.Timestamp()
                start_time = r["start_time"]
                if isinstance(start_time, str):
                    start_time = datetime.fromisoformat(start_time)
                ts.FromDatetime(start_time)
                lr.start_time.CopyFrom(ts)
            if r.get("end_time"):
                ts = timestamp_pb2.Timestamp()
                end_time = r["end_time"]
                if isinstance(end_time, str):
                    end_time = datetime.fromisoformat(end_time)
                ts.FromDatetime(end_time)
                lr.end_time.CopyFrom(ts)
            proto_label.ranges.append(lr)

        return proto_label


def add_to_server(server: grpc.Server) -> None:
    """注册服务到 gRPC server"""
    pb_grpc.add_LabelServiceServicer_to_server(LabelServiceImpl(), server)
    logger.info("LabelService registered")
