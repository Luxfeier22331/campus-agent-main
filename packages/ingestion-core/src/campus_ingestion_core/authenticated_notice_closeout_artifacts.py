from __future__ import annotations

import asyncio
from concurrent.futures import Executor
from dataclasses import asdict
from functools import partial
import json
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_OPERATION,
    CloseoutRun,
    CloseoutWorker,
)
from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest
from campus_ingestion_core.object_store import (
    S3ObjectStoreClientFactory,
    build_operations_artifact_key,
)
from campus_ingestion_core.settings import ObjectStoreSettings


class CloseoutObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None: ...


class CloseoutS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._settings = settings
        self._factory = S3ObjectStoreClientFactory(settings)
        self._client = self._factory.create()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        kwargs: dict[str, object] = {
            "Bucket": bucket,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
        }
        if metadata:
            kwargs["Metadata"] = dict(metadata)
        self._client.put_object(**kwargs)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        response = self._client.head_object(Bucket=bucket, Key=key)
        return {
            "content_length": int(response.get("ContentLength") or 0),
            "metadata": dict(response.get("Metadata") or {}),
            "etag": response.get("ETag"),
        }

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None:
        self._client.copy_object(
            Bucket=target_bucket,
            Key=target_key,
            CopySource={"Bucket": source_bucket, "Key": source_key},
            MetadataDirective="COPY",
        )


class CloseoutArtifactManager:
    def __init__(
        self,
        *,
        object_store: CloseoutObjectStore,
        object_store_settings: ObjectStoreSettings,
    ) -> None:
        self.object_store = object_store
        self.object_store_settings = object_store_settings

    def load_export_manifest(self, run: CloseoutRun) -> dict[str, Any] | None:
        if not run.export_manifest_object_key:
            return None
        return json.loads(
            self.object_store.get_bytes(
                bucket=self.object_store_settings.bucket_derived,
                key=run.export_manifest_object_key,
            ).decode("utf-8")
        )

    def write_json_artifact(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        filename: str,
        payload: dict[str, Any],
        segments: tuple[str, ...] = (),
    ) -> None:
        key = build_operations_artifact_key(
            corpus=request.corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run_id,
            filename=filename,
            segments=segments,
        )
        self.object_store.put_bytes(
            bucket=self.object_store_settings.bucket_derived,
            key=key,
            data=self._json_bytes(payload),
            content_type="application/json",
        )

    async def write_json_artifact_limited(
        self,
        *,
        semaphore: asyncio.Semaphore,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        filename: str,
        payload: dict[str, Any],
        segments: tuple[str, ...] = (),
        executor: Executor | None = None,
    ) -> None:
        key = build_operations_artifact_key(
            corpus=request.corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run_id,
            filename=filename,
            segments=segments,
        )
        await self.put_bytes_limited(
            semaphore=semaphore,
            bucket=self.object_store_settings.bucket_derived,
            key=key,
            data=self._json_bytes(payload),
            content_type="application/json",
            executor=executor,
        )

    def write_worker_artifact(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        worker: CloseoutWorker,
    ) -> None:
        self.write_json_artifact(
            request=request,
            run_id=run_id,
            filename=f"{worker.worker_id}.json",
            payload=asdict(worker),
            segments=("workers",),
        )

    async def put_bytes_limited(
        self,
        *,
        semaphore: asyncio.Semaphore,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
        executor: Executor | None = None,
    ) -> None:
        async with semaphore:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                executor,
                partial(
                    self.object_store.put_bytes,
                    bucket=bucket,
                    key=key,
                    data=data,
                    content_type=content_type,
                    metadata=metadata,
                ),
            )

    async def copy_object_limited(
        self,
        *,
        semaphore: asyncio.Semaphore,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
        executor: Executor | None = None,
    ) -> None:
        async with semaphore:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                executor,
                partial(
                    self.object_store.copy_object,
                    source_bucket=source_bucket,
                    source_key=source_key,
                    target_bucket=target_bucket,
                    target_key=target_key,
                ),
            )

    def object_head_or_none(self, *, bucket: str, key: str) -> dict[str, object] | None:
        try:
            return self.object_store.head_object(bucket=bucket, key=key)
        except Exception:
            return None

    def _json_bytes(self, payload: dict[str, Any]) -> bytes:
        return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode(
            "utf-8"
        )


__all__ = [
    "CloseoutArtifactManager",
    "CloseoutObjectStore",
    "CloseoutS3ObjectStore",
]
