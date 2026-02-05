"""MinIO 客户端模块"""

import io
from pathlib import Path
from typing import Any, BinaryIO

from minio import Minio
from minio.error import S3Error

from ..config import MinioConfig, get_settings
from ..logger import logger



class MinioClient:
    """MinIO 客户端封装"""

    def __init__(self, config: MinioConfig | None = None):
        self.config = config or get_settings().minio
        self._client: Minio | None = None

    @property
    def client(self) -> Minio:
        """获取 MinIO 客户端 (懒加载)"""
        if self._client is None:
            self._client = Minio(
                self.config.endpoint,
                access_key=self.config.access_key,
                secret_key=self.config.secret_key,
                secure=self.config.secure,
            )
            logger.info(f"MinIO client initialized: {self.config.endpoint}")
        return self._client

    def ensure_buckets(self) -> None:
        """确保所需的 bucket 存在"""
        for bucket_name in [self.config.buckets.models, self.config.buckets.datasets]:
            try:
                if not self.client.bucket_exists(bucket_name):
                    self.client.make_bucket(bucket_name)
                    logger.info(f"Created bucket: {bucket_name}")
            except S3Error as e:
                logger.error(f"Failed to ensure bucket {bucket_name}: {e}")

    def upload_model(
        self,
        model_name: str,
        data: bytes | BinaryIO,
        metadata: dict[str, str] | None = None,
    ) -> str:
        """上传模型文件"""
        bucket = self.config.buckets.models
        object_name = f"{model_name}.pt"

        if isinstance(data, bytes):
            data_stream = io.BytesIO(data)
            length = len(data)
        else:
            data_stream = data
            data.seek(0, 2)
            length = data.tell()
            data.seek(0)

        try:
            self.client.put_object(
                bucket,
                object_name,
                data_stream,
                length,
                content_type="application/octet-stream",
                metadata=metadata,
            )
            logger.info(f"Uploaded model: {bucket}/{object_name}")
            return f"{bucket}/{object_name}"
        except S3Error as e:
            logger.error(f"Failed to upload model: {e}")
            raise

    def download_model(self, model_path: str) -> bytes:
        """下载模型文件"""
        parts = model_path.split("/", 1)
        if len(parts) == 2:
            bucket, object_name = parts
        else:
            bucket = self.config.buckets.models
            object_name = model_path

        try:
            response = self.client.get_object(bucket, object_name)
            data = response.read()
            response.close()
            response.release_conn()
            logger.info(f"Downloaded model: {bucket}/{object_name}")
            return data
        except S3Error as e:
            logger.error(f"Failed to download model: {e}")
            raise

    def delete_model(self, model_path: str) -> bool:
        """删除模型文件"""
        parts = model_path.split("/", 1)
        if len(parts) == 2:
            bucket, object_name = parts
        else:
            bucket = self.config.buckets.models
            object_name = model_path

        try:
            self.client.remove_object(bucket, object_name)
            logger.info(f"Deleted model: {bucket}/{object_name}")
            return True
        except S3Error as e:
            logger.error(f"Failed to delete model: {e}")
            return False

    def upload_dataset(
        self,
        name: str,
        data: bytes | BinaryIO,
        format: str = "csv",
        metadata: dict[str, str] | None = None,
    ) -> str:
        """上传数据集"""
        bucket = self.config.buckets.datasets
        object_name = f"{name}.{format}"

        if isinstance(data, bytes):
            data_stream = io.BytesIO(data)
            length = len(data)
        else:
            data_stream = data
            data.seek(0, 2)
            length = data.tell()
            data.seek(0)

        content_type = "text/csv" if format == "csv" else "application/octet-stream"

        try:
            self.client.put_object(
                bucket,
                object_name,
                data_stream,
                length,
                content_type=content_type,
                metadata=metadata,
            )
            logger.info(f"Uploaded dataset: {bucket}/{object_name}")
            return f"{bucket}/{object_name}"
        except S3Error as e:
            logger.error(f"Failed to upload dataset: {e}")
            raise

    def list_models(self) -> list[dict[str, Any]]:
        """列出所有模型"""
        bucket = self.config.buckets.models
        try:
            objects = self.client.list_objects(bucket)
            return [
                {
                    "name": obj.object_name,
                    "size": obj.size,
                    "last_modified": obj.last_modified,
                }
                for obj in objects
            ]
        except S3Error as e:
            logger.error(f"Failed to list models: {e}")
            return []

    def get_model_info(self, model_path: str) -> dict[str, Any] | None:
        """获取模型信息"""
        parts = model_path.split("/", 1)
        if len(parts) == 2:
            bucket, object_name = parts
        else:
            bucket = self.config.buckets.models
            object_name = model_path

        try:
            stat = self.client.stat_object(bucket, object_name)
            return {
                "name": stat.object_name,
                "size": stat.size,
                "last_modified": stat.last_modified,
                "content_type": stat.content_type,
                "metadata": stat.metadata,
            }
        except S3Error as e:
            logger.error(f"Failed to get model info: {e}")
            return None
