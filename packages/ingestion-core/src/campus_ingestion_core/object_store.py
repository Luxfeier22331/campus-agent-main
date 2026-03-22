from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_ingestion_core.settings import ObjectStoreSettings


ObjectLayer = Literal["raw", "processed"]


def build_object_key(
    *,
    corpus: str,
    document_id: str,
    version_id: str,
    layer: ObjectLayer,
    filename: str,
) -> str:
    if corpus != "student_handbook":
        raise ValueError(f"unsupported corpus: {corpus}")
    if layer not in {"raw", "processed"}:
        raise ValueError(f"unsupported object layer: {layer}")
    if not filename or "/" in filename.strip("/"):
        raise ValueError("filename must be a single path segment")
    return f"{corpus}/{document_id}/{version_id}/{layer}/{filename}"


@dataclass(frozen=True, slots=True)
class S3ObjectStoreClientFactory:
    settings: ObjectStoreSettings

    def client_config(self) -> dict[str, object]:
        return {
            "endpoint_url": self.settings.endpoint,
            "region_name": self.settings.region,
            "aws_access_key_id": self.settings.access_key,
            "aws_secret_access_key": self.settings.secret_key,
            "use_ssl": self.settings.secure,
        }

    def create(self):  # pragma: no cover - exercised only when boto3 is installed
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - dependent on environment
            raise RuntimeError(
                "boto3 is required to create the S3-compatible object store client"
            ) from exc
        return boto3.client("s3", **self.client_config())
