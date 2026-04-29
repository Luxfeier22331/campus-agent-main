from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

NOTICE_INGEST_JOB_SCHEMA_VERSION = "notice_ingest_job.v1"
NOTICE_INGEST_JOB_KIND = "notice_ingest"
NOTICE_INGEST_QUEUE_STATUSES = (
    "queued",
    "leased",
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "dead_letter",
)
NOTICE_INGEST_ENQUEUE_SOURCES = (
    "historical_backfill",
    "live_discovery",
    "manual_replay",
)
NOTICE_INGEST_FORBIDDEN_PAYLOAD_FIELDS = frozenset(
    (
        "body_text",
        "raw_html",
        "html",
        "attachments",
        "attachment_bytes",
        "ocr_payload",
        "content_blocks",
    )
)


@dataclass(frozen=True, slots=True)
class NoticeIngestObjectRef:
    bucket: str
    key: str
    role: str
    content_sha256: str = ""
    byte_size: int | None = None

    def __post_init__(self) -> None:
        for field_name in ("bucket", "key", "role", "content_sha256"):
            value = getattr(self, field_name)
            object.__setattr__(self, field_name, str(value or "").strip())
        for field_name in ("bucket", "key", "role"):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} is required for object ref")
        if self.byte_size is not None and int(self.byte_size) < 0:
            raise ValueError("byte_size must be non-negative")

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "bucket": self.bucket,
            "key": self.key,
            "role": self.role,
        }
        if self.content_sha256:
            payload["content_sha256"] = self.content_sha256
        if self.byte_size is not None:
            payload["byte_size"] = int(self.byte_size)
        return payload


@dataclass(frozen=True, slots=True)
class NoticeIngestJob:
    job_id: str
    job_kind: str
    source_channel: str
    source_surface: str
    source_identity: str
    capture_id: str
    capture_manifest_object_ref: NoticeIngestObjectRef
    source_object_refs: tuple[NoticeIngestObjectRef, ...]
    content_hash: str
    run_id: str
    enqueue_source: str
    replay_batch_id: str
    priority: int
    idempotency_key: str

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema_version": NOTICE_INGEST_JOB_SCHEMA_VERSION,
            "job_id": self.job_id,
            "job_kind": self.job_kind,
            "source_channel": self.source_channel,
            "source_surface": self.source_surface,
            "source_identity": self.source_identity,
            "capture_id": self.capture_id,
            "capture_manifest_object_ref": self.capture_manifest_object_ref.to_payload(),
            "source_object_refs": [ref.to_payload() for ref in self.source_object_refs],
            "content_hash": self.content_hash,
            "run_id": self.run_id,
            "enqueue_source": self.enqueue_source,
            "replay_batch_id": self.replay_batch_id,
            "priority": self.priority,
            "idempotency_key": self.idempotency_key,
        }


def build_internal_notice_source_identity(*, site_id: str, source_notice_id: str) -> str:
    normalized_site_id = _required_text(site_id, "site_id")
    normalized_notice_id = _required_text(source_notice_id, "source_notice_id")
    return f"{normalized_site_id}:{normalized_notice_id}"


def build_file_release_source_identity(*, file_release_id: str) -> str:
    normalized_file_release_id = _required_text(file_release_id, "file_release_id")
    return f"file_release:{normalized_file_release_id}"


def build_notice_ingest_job(
    *,
    source_channel: str,
    source_surface: str,
    source_identity: str,
    capture_id: str,
    capture_manifest_object_ref: NoticeIngestObjectRef | Mapping[str, Any],
    source_object_refs: Sequence[NoticeIngestObjectRef | Mapping[str, Any]],
    content_hash: str,
    run_id: str,
    enqueue_source: str,
    replay_batch_id: str,
    priority: int = 100,
) -> NoticeIngestJob:
    normalized_source_channel = _required_text(source_channel, "source_channel")
    normalized_source_surface = _required_text(source_surface, "source_surface")
    normalized_source_identity = _required_text(source_identity, "source_identity")
    normalized_capture_id = _required_text(capture_id, "capture_id")
    normalized_content_hash = _required_text(content_hash, "content_hash")
    normalized_run_id = _required_text(run_id, "run_id")
    normalized_replay_batch_id = _required_text(replay_batch_id, "replay_batch_id")
    normalized_enqueue_source = _required_text(enqueue_source, "enqueue_source")
    if normalized_enqueue_source not in NOTICE_INGEST_ENQUEUE_SOURCES:
        raise ValueError(f"unsupported enqueue_source: {normalized_enqueue_source}")
    normalized_priority = int(priority)
    if normalized_priority < 0:
        raise ValueError("priority must be non-negative")
    manifest_ref = _object_ref_from_value(
        capture_manifest_object_ref,
        field_name="capture_manifest_object_ref",
    )
    object_refs = tuple(
        _object_ref_from_value(item, field_name="source_object_refs") for item in source_object_refs
    )
    if not object_refs:
        raise ValueError("source_object_refs is required")
    idempotency_key = build_notice_ingest_idempotency_key(
        source_channel=normalized_source_channel,
        source_surface=normalized_source_surface,
        source_identity=normalized_source_identity,
        content_hash=normalized_content_hash,
    )
    return NoticeIngestJob(
        job_id=f"notice_ingest_job:{_digest_text(idempotency_key)[:24]}",
        job_kind=NOTICE_INGEST_JOB_KIND,
        source_channel=normalized_source_channel,
        source_surface=normalized_source_surface,
        source_identity=normalized_source_identity,
        capture_id=normalized_capture_id,
        capture_manifest_object_ref=manifest_ref,
        source_object_refs=object_refs,
        content_hash=normalized_content_hash,
        run_id=normalized_run_id,
        enqueue_source=normalized_enqueue_source,
        replay_batch_id=normalized_replay_batch_id,
        priority=normalized_priority,
        idempotency_key=idempotency_key,
    )


def build_notice_ingest_idempotency_key(
    *,
    source_channel: str,
    source_surface: str,
    source_identity: str,
    content_hash: str,
) -> str:
    canonical_parts = (
        _required_text(source_channel, "source_channel"),
        _required_text(source_surface, "source_surface"),
        _required_text(source_identity, "source_identity"),
        _required_text(content_hash, "content_hash"),
    )
    digest = _digest_text("\n".join(canonical_parts))
    return f"notice_ingest:{digest}"


def validate_notice_ingest_job_payload(payload: Mapping[str, Any]) -> None:
    if not isinstance(payload, Mapping):
        raise ValueError("notice ingest job payload must be an object")
    for field_name in NOTICE_INGEST_FORBIDDEN_PAYLOAD_FIELDS:
        if field_name in payload:
            raise ValueError(f"notice ingest job payload must not include {field_name}")
    required_fields = (
        "schema_version",
        "job_id",
        "job_kind",
        "source_channel",
        "source_surface",
        "source_identity",
        "capture_id",
        "capture_manifest_object_ref",
        "source_object_refs",
        "content_hash",
        "run_id",
        "enqueue_source",
        "replay_batch_id",
        "priority",
        "idempotency_key",
    )
    for field_name in required_fields:
        if field_name not in payload:
            raise ValueError(f"notice ingest job payload missing {field_name}")
    if payload["schema_version"] != NOTICE_INGEST_JOB_SCHEMA_VERSION:
        raise ValueError("unsupported schema_version")
    if payload["job_kind"] != NOTICE_INGEST_JOB_KIND:
        raise ValueError("unsupported job_kind")
    if str(payload["enqueue_source"] or "").strip() not in NOTICE_INGEST_ENQUEUE_SOURCES:
        raise ValueError("unsupported enqueue_source")
    _object_ref_from_value(
        payload["capture_manifest_object_ref"],
        field_name="capture_manifest_object_ref",
    )
    source_object_refs = payload["source_object_refs"]
    if not isinstance(source_object_refs, Sequence) or isinstance(source_object_refs, str | bytes):
        raise ValueError("source_object_refs must be a non-empty list")
    if not source_object_refs:
        raise ValueError("source_object_refs is required")
    for ref in source_object_refs:
        _object_ref_from_value(ref, field_name="source_object_refs")
    for field_name in (
        "job_id",
        "source_channel",
        "source_surface",
        "source_identity",
        "capture_id",
        "content_hash",
        "run_id",
        "replay_batch_id",
        "idempotency_key",
    ):
        _required_text(payload[field_name], field_name)
    priority = int(payload["priority"])
    if priority < 0:
        raise ValueError("priority must be non-negative")
    expected_idempotency_key = build_notice_ingest_idempotency_key(
        source_channel=str(payload["source_channel"]),
        source_surface=str(payload["source_surface"]),
        source_identity=str(payload["source_identity"]),
        content_hash=str(payload["content_hash"]),
    )
    if str(payload["idempotency_key"]) != expected_idempotency_key:
        raise ValueError("idempotency_key does not match source identity and content hash")
    expected_job_id = f"notice_ingest_job:{_digest_text(expected_idempotency_key)[:24]}"
    if str(payload["job_id"]) != expected_job_id:
        raise ValueError("job_id does not match idempotency_key")


def _object_ref_from_value(
    value: NoticeIngestObjectRef | Mapping[str, Any],
    *,
    field_name: str,
) -> NoticeIngestObjectRef:
    if isinstance(value, NoticeIngestObjectRef):
        return value
    if not isinstance(value, Mapping) or not value:
        raise ValueError(f"{field_name} is required")
    try:
        return NoticeIngestObjectRef(
            bucket=value.get("bucket", ""),
            key=value.get("key", ""),
            role=value.get("role", ""),
            content_sha256=str(value.get("content_sha256") or ""),
            byte_size=value.get("byte_size"),
        )
    except ValueError as exc:
        raise ValueError(f"{field_name}: {exc}") from exc


def _required_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


def _digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


__all__ = [
    "NOTICE_INGEST_ENQUEUE_SOURCES",
    "NOTICE_INGEST_FORBIDDEN_PAYLOAD_FIELDS",
    "NOTICE_INGEST_JOB_KIND",
    "NOTICE_INGEST_JOB_SCHEMA_VERSION",
    "NOTICE_INGEST_QUEUE_STATUSES",
    "NoticeIngestJob",
    "NoticeIngestObjectRef",
    "build_file_release_source_identity",
    "build_internal_notice_source_identity",
    "build_notice_ingest_idempotency_key",
    "build_notice_ingest_job",
    "validate_notice_ingest_job_payload",
]
