from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from qdrant_client import QdrantClient

from campus_ingestion_core.campusrag_ingestion_support import ObjectStoreWriter, PersistImportStats
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    CurriculumProgramSemesterFactsMaterializationReport,
    materialize_curriculum_program_semester_facts_from_canonical_scope,
)
from campus_ingestion_core.index_release import reset_index_binding
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.scope_catalog import QdrantIndexBinding
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifestDocument

DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF = "学生手册_2018.pdf"
DEFAULT_CURRICULUM_PLAN_REPLAY_SOURCE_PDF = "curriculum-plan.pdf"
ALLOWED_REBUILD_IMPORT_MODES = ("raw_online_ocr", "provider_response_replay")
DEFAULT_QDRANT_UPSERT_BATCH_SIZE = 128
DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS = 60.0


class ObjectStoreAdmin(Protocol):
    def delete_prefix(
        self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()
    ) -> None: ...


class ReplayObjectStore(ObjectStoreWriter, Protocol):
    def delete_prefix(
        self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()
    ) -> None: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class QdrantAdmin(Protocol):
    def reset_index_binding(self, binding: QdrantIndexBinding) -> tuple[str, ...]: ...


@dataclass(frozen=True, slots=True)
class LocalDataRebuildReport:
    import_context: dict[str, str]
    import_result: object


@dataclass(frozen=True, slots=True)
class RebuildRequest:
    corpus: str
    collection: str
    import_mode: str
    raw_version_id: str | None = None
    raw_asset_id: str | None = None
    source_pdf: str | None = None
    reset_qdrant: bool = False
    index_qdrant: bool = False
    publish_qdrant_alias: bool = True


@dataclass(frozen=True, slots=True)
class _RebuildTraceRecorder:
    jsonl_path: Path | None
    stderr_enabled: bool

    def emit(self, *, stage: str, event: str, **fields: object) -> None:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "stage": stage,
            "event": event,
            **fields,
        }
        line = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        if self.jsonl_path is not None:
            self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            with self.jsonl_path.open("a", encoding="utf-8") as handle:
                handle.write(line)
                handle.write("\n")
        if self.stderr_enabled:
            print(line, file=sys.stderr, flush=True)


def rematerialize_curriculum_program_semester_facts_from_local_rebuild(
    *,
    env: dict[str, str] | None = None,
    source_document_ids: tuple[str, ...],
    object_store: ReplayObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    split_manifest_documents: Sequence[SplitManifestDocument] | None = None,
    raw_asset_record: RawAssetRecord | None = None,
    source_document_units_keys: dict[str, str] | None = None,
) -> CurriculumProgramSemesterFactsMaterializationReport:
    return materialize_curriculum_program_semester_facts_from_canonical_scope(
        env=env,
        object_store=object_store,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        split_manifest_documents=split_manifest_documents,
        raw_asset_record=raw_asset_record,
        source_document_units_keys=source_document_units_keys,
        source_document_ids=source_document_ids,
    )


class S3ObjectStoreAdmin:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def healthcheck(self, *, bucket: str) -> None:
        self._client.list_objects_v2(Bucket=bucket, MaxKeys=1)

    def delete_prefix(
        self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()
    ) -> None:
        excluded = set(exclude_keys)
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys = [
                {"Key": item["Key"]}
                for item in response.get("Contents") or ()
                if item["Key"] not in excluded
            ]
            for start in range(0, len(keys), 1000):
                batch = keys[start : start + 1000]
                if batch:
                    self._client.delete_objects(
                        Bucket=bucket,
                        Delete={"Objects": batch, "Quiet": True},
                    )
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def upload_file(
        self,
        *,
        bucket: str,
        key: str,
        file_path: str,
        content_type: str,
    ) -> None:
        self._client.upload_file(
            Filename=file_path,
            Bucket=bucket,
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )

    def download_file(self, *, bucket: str, key: str, file_path: str) -> None:
        self._client.download_file(
            Bucket=bucket,
            Key=key,
            Filename=file_path,
        )

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        return self._client.head_object(Bucket=bucket, Key=key)

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        keys: list[str] = []
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys.extend(str(item["Key"]) for item in response.get("Contents") or ())
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        return tuple(keys)

    def copy_bytes(
        self,
        *,
        bucket: str,
        source_key: str,
        target_key: str,
        content_type: str,
    ) -> None:
        data = self.get_bytes(bucket=bucket, key=source_key)
        self.put_bytes(bucket=bucket, key=target_key, data=data, content_type=content_type)


class QdrantCollectionAdmin:
    def __init__(self, client: QdrantClient) -> None:
        self._client = client

    def reset_index_binding(self, binding: QdrantIndexBinding) -> tuple[str, ...]:
        return reset_index_binding(qdrant_client=self._client, binding=binding)


def _build_rebuild_trace_recorder(source: dict[str, str]) -> _RebuildTraceRecorder | None:
    jsonl_path = _normalize_optional_text(source.get("REBUILD_TRACE_JSONL_PATH"))
    stderr_enabled = _parse_bool(source.get("REBUILD_TRACE_STDERR"), default=False)
    if jsonl_path is None and not stderr_enabled:
        return None
    return _RebuildTraceRecorder(
        jsonl_path=Path(jsonl_path).resolve() if jsonl_path is not None else None,
        stderr_enabled=stderr_enabled,
    )


def _run_traced_stage(
    trace_recorder: _RebuildTraceRecorder | None,
    stage: str,
    func: Callable[[], Any],
    *,
    fields: dict[str, object] | None = None,
    result_fields: Callable[[Any], dict[str, object]] | None = None,
) -> Any:
    if trace_recorder is None:
        return func()
    payload = dict(fields or {})
    trace_recorder.emit(stage=stage, event="start", **payload)
    started = time.monotonic()
    try:
        result = func()
    except Exception as exc:
        trace_recorder.emit(
            stage=stage,
            event="error",
            duration_ms=round((time.monotonic() - started) * 1000, 3),
            error_type=type(exc).__name__,
            error_message=str(exc),
            **payload,
        )
        raise
    completed_payload = dict(payload)
    if result_fields is not None:
        completed_payload.update(result_fields(result))
    trace_recorder.emit(
        stage=stage,
        event="end",
        duration_ms=round((time.monotonic() - started) * 1000, 3),
        **completed_payload,
    )
    return result


def _summarize_rebuild_import_result(result: object) -> dict[str, object]:
    if is_dataclass(result):
        payload = asdict(result)
        return {
            key: payload[key]
            for key in ("success_count", "skipped_count", "failed_count", "document_ids")
            if key in payload
        }
    if isinstance(result, dict):
        return {
            key: result[key]
            for key in ("status", "success_count", "skipped_count", "failed_count")
            if key in result
        }
    return {}


def _summarize_persist_stats(result: PersistImportStats) -> dict[str, object]:
    return {
        "success_count": result.success_count,
        "skipped_count": result.skipped_count,
        "failed_count": result.failed_count,
        "created_count": len(result.created_document_ids),
        "updated_count": len(result.updated_document_ids),
    }


def _delete_object_keys(
    *,
    object_store_admin: ObjectStoreAdmin,
    bucket: str,
    object_keys: tuple[str, ...],
    exclude_keys: tuple[str, ...] = (),
) -> None:
    excluded = set(exclude_keys)
    for object_key in dict.fromkeys(key for key in object_keys if key and key not in excluded):
        object_store_admin.delete_prefix(bucket=bucket, prefix=object_key)


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")


def _read_required_env(source: dict[str, str], field_name: str) -> str:
    value = (source.get(field_name) or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _read_required_scope_part(source: dict[str, str], field_name: str) -> str:
    value = (source.get(field_name) or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _read_default_visibility_scope(source: dict[str, str]) -> str | None:
    return (
        source.get("INGESTION_DEFAULT_VISIBILITY_SCOPE")
        or source.get("INGESTION_DEFAULT_CAMPUS_SCOPE")
        or ""
    ).strip() or None


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
