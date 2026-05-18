from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

NOTICE_INGEST_JOB_SCHEMA_VERSION = "notice_ingest_job.v1"
NOTICE_INGEST_JOB_KIND = "notice_ingest"
AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION = "authenticated_notice_ingest_job.v1"
AUTHENTICATED_NOTICE_INGEST_JOB_KIND = "authenticated_notice_ingest"
NOTICE_INGEST_QUEUE_STATUSES = (
    "queued",
    "leased",
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "dead_letter",
    "manual_review",
    "blocked",
    "cancelled",
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
        "local_path",
        "bundle_path",
        "manifest_path",
        "source_file_path",
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
    schema_version: str = NOTICE_INGEST_JOB_SCHEMA_VERSION
    site_id: str = ""
    source_bucket: str = ""
    bundle_object_key: str = ""
    bundle_content_sha256: str = ""
    bundle_byte_size: int | None = None
    manifest_object_key: str = ""
    manifest_content_sha256: str = ""
    manifest_byte_size: int | None = None
    retry_policy: Mapping[str, Any] | None = None
    provenance: Mapping[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "schema_version": self.schema_version,
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
        if self.schema_version == AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION:
            payload.update(
                {
                    "site_id": self.site_id,
                    "source_bucket": self.source_bucket,
                    "bundle_object_key": self.bundle_object_key,
                    "bundle_content_sha256": self.bundle_content_sha256,
                    "bundle_byte_size": self.bundle_byte_size,
                    "manifest_object_key": self.manifest_object_key,
                    "manifest_content_sha256": self.manifest_content_sha256,
                    "manifest_byte_size": self.manifest_byte_size,
                    "retry_policy": dict(self.retry_policy or {"max_attempts": 3}),
                    "provenance": dict(self.provenance or {}),
                }
            )
        return payload


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


def build_authenticated_notice_run_ingest_job(
    *,
    source_surface: str,
    site_id: str,
    run_id: str,
    source_bucket: str,
    bundle_object_key: str,
    bundle_content_sha256: str,
    bundle_byte_size: int,
    manifest_object_key: str,
    manifest_content_sha256: str,
    manifest_byte_size: int,
    enqueue_source: str,
    replay_batch_id: str,
    priority: int = 100,
    source_channel: str = "authenticated_notice_portal",
    retry_policy: Mapping[str, Any] | None = None,
    provenance: Mapping[str, Any] | None = None,
) -> NoticeIngestJob:
    normalized_source_channel = _required_text(source_channel, "source_channel")
    normalized_source_surface = _required_text(source_surface, "source_surface")
    normalized_site_id = _required_text(site_id, "site_id")
    normalized_run_id = _required_text(run_id, "run_id")
    normalized_source_bucket = _required_text(source_bucket, "source_bucket")
    normalized_bundle_object_key = _required_text(bundle_object_key, "bundle_object_key")
    normalized_manifest_object_key = _required_text(manifest_object_key, "manifest_object_key")
    normalized_bundle_sha = _required_sha256(
        bundle_content_sha256,
        "bundle_content_sha256",
    )
    normalized_manifest_sha = _required_sha256(
        manifest_content_sha256,
        "manifest_content_sha256",
    )
    normalized_bundle_size = _non_negative_int(bundle_byte_size, "bundle_byte_size")
    normalized_manifest_size = _non_negative_int(manifest_byte_size, "manifest_byte_size")
    normalized_enqueue_source = _required_text(enqueue_source, "enqueue_source")
    if normalized_enqueue_source not in NOTICE_INGEST_ENQUEUE_SOURCES:
        raise ValueError(f"unsupported enqueue_source: {normalized_enqueue_source}")
    normalized_replay_batch_id = _required_text(replay_batch_id, "replay_batch_id")
    normalized_priority = int(priority)
    if normalized_priority < 0:
        raise ValueError("priority must be non-negative")
    effective_retry_policy = dict(retry_policy or {"max_attempts": 3})
    source_identity = f"{normalized_site_id}:{normalized_run_id}"
    bundle_ref = NoticeIngestObjectRef(
        bucket=normalized_source_bucket,
        key=normalized_bundle_object_key,
        role="collector-run/bundle.json",
        content_sha256=normalized_bundle_sha,
        byte_size=normalized_bundle_size,
    )
    manifest_ref = NoticeIngestObjectRef(
        bucket=normalized_source_bucket,
        key=normalized_manifest_object_key,
        role="collector-run/manifest.json",
        content_sha256=normalized_manifest_sha,
        byte_size=normalized_manifest_size,
    )
    content_hash = _digest_text("\n".join((normalized_bundle_sha, normalized_manifest_sha)))
    idempotency_key = build_authenticated_notice_run_ingest_idempotency_key(
        source_channel=normalized_source_channel,
        source_surface=normalized_source_surface,
        site_id=normalized_site_id,
        run_id=normalized_run_id,
        bundle_content_sha256=normalized_bundle_sha,
        manifest_content_sha256=normalized_manifest_sha,
    )
    return NoticeIngestJob(
        job_id=f"authenticated_notice_ingest_job:{_digest_text(idempotency_key)[:24]}",
        job_kind=AUTHENTICATED_NOTICE_INGEST_JOB_KIND,
        source_channel=normalized_source_channel,
        source_surface=normalized_source_surface,
        source_identity=source_identity,
        capture_id=f"collector_run:{normalized_site_id}:{normalized_source_surface}:{normalized_run_id}",
        capture_manifest_object_ref=manifest_ref,
        source_object_refs=(bundle_ref, manifest_ref),
        content_hash=content_hash,
        run_id=normalized_run_id,
        enqueue_source=normalized_enqueue_source,
        replay_batch_id=normalized_replay_batch_id,
        priority=normalized_priority,
        idempotency_key=idempotency_key,
        schema_version=AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION,
        site_id=normalized_site_id,
        source_bucket=normalized_source_bucket,
        bundle_object_key=normalized_bundle_object_key,
        bundle_content_sha256=normalized_bundle_sha,
        bundle_byte_size=normalized_bundle_size,
        manifest_object_key=normalized_manifest_object_key,
        manifest_content_sha256=normalized_manifest_sha,
        manifest_byte_size=normalized_manifest_size,
        retry_policy=effective_retry_policy,
        provenance=dict(provenance or {}),
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


def build_authenticated_notice_run_ingest_idempotency_key(
    *,
    source_channel: str,
    source_surface: str,
    site_id: str,
    run_id: str,
    bundle_content_sha256: str,
    manifest_content_sha256: str,
) -> str:
    canonical_parts = (
        _required_text(source_channel, "source_channel"),
        _required_text(source_surface, "source_surface"),
        _required_text(site_id, "site_id"),
        _required_text(run_id, "run_id"),
        _required_sha256(bundle_content_sha256, "bundle_content_sha256"),
        _required_sha256(manifest_content_sha256, "manifest_content_sha256"),
    )
    digest = _digest_text("\n".join(canonical_parts))
    return f"authenticated_notice_ingest:{digest}"


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
    schema_version = str(payload["schema_version"] or "").strip()
    if schema_version not in {
        NOTICE_INGEST_JOB_SCHEMA_VERSION,
        AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION,
    }:
        raise ValueError("unsupported schema_version")
    expected_job_kind = (
        AUTHENTICATED_NOTICE_INGEST_JOB_KIND
        if schema_version == AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION
        else NOTICE_INGEST_JOB_KIND
    )
    if payload["job_kind"] != expected_job_kind:
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
    if schema_version == AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION:
        _validate_authenticated_notice_run_fields(payload)
        expected_idempotency_key = build_authenticated_notice_run_ingest_idempotency_key(
            source_channel=str(payload["source_channel"]),
            source_surface=str(payload["source_surface"]),
            site_id=str(payload["site_id"]),
            run_id=str(payload["run_id"]),
            bundle_content_sha256=str(payload["bundle_content_sha256"]),
            manifest_content_sha256=str(payload["manifest_content_sha256"]),
        )
        expected_job_id = (
            f"authenticated_notice_ingest_job:{_digest_text(expected_idempotency_key)[:24]}"
        )
    else:
        expected_idempotency_key = build_notice_ingest_idempotency_key(
            source_channel=str(payload["source_channel"]),
            source_surface=str(payload["source_surface"]),
            source_identity=str(payload["source_identity"]),
            content_hash=str(payload["content_hash"]),
        )
        expected_job_id = f"notice_ingest_job:{_digest_text(expected_idempotency_key)[:24]}"
    if str(payload["idempotency_key"]) != expected_idempotency_key:
        raise ValueError("idempotency_key does not match source identity and content hash")
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


def _validate_authenticated_notice_run_fields(payload: Mapping[str, Any]) -> None:
    for field_name in (
        "site_id",
        "source_bucket",
        "bundle_object_key",
        "bundle_content_sha256",
        "bundle_byte_size",
        "manifest_object_key",
        "manifest_content_sha256",
        "manifest_byte_size",
        "retry_policy",
        "provenance",
    ):
        if field_name not in payload:
            raise ValueError(f"notice ingest job payload missing {field_name}")
    _required_text(payload["site_id"], "site_id")
    _required_text(payload["source_bucket"], "source_bucket")
    _required_text(payload["bundle_object_key"], "bundle_object_key")
    _required_text(payload["manifest_object_key"], "manifest_object_key")
    _required_sha256(payload["bundle_content_sha256"], "bundle_content_sha256")
    _required_sha256(payload["manifest_content_sha256"], "manifest_content_sha256")
    _non_negative_int(payload["bundle_byte_size"], "bundle_byte_size")
    _non_negative_int(payload["manifest_byte_size"], "manifest_byte_size")
    if not isinstance(payload["retry_policy"], Mapping):
        raise ValueError("retry_policy must be an object")
    if not isinstance(payload["provenance"], Mapping):
        raise ValueError("provenance must be an object")
    expected_source_identity = f"{str(payload['site_id']).strip()}:{str(payload['run_id']).strip()}"
    if str(payload["source_identity"]) != expected_source_identity:
        raise ValueError("source_identity must match site_id and run_id")


def _required_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


def _required_sha256(value: object, field_name: str) -> str:
    text = _required_text(value, field_name)
    if len(text) != 64 or any(character not in "0123456789abcdef" for character in text):
        raise ValueError(f"{field_name} must be a lowercase sha256 hex digest")
    return text


def _non_negative_int(value: object, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a non-negative integer")
    parsed = int(value)  # type: ignore[arg-type]
    if parsed < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return parsed


def _digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


__all__ = [
    "AUTHENTICATED_NOTICE_INGEST_JOB_KIND",
    "AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION",
    "NOTICE_INGEST_ENQUEUE_SOURCES",
    "NOTICE_INGEST_FORBIDDEN_PAYLOAD_FIELDS",
    "NOTICE_INGEST_JOB_KIND",
    "NOTICE_INGEST_JOB_SCHEMA_VERSION",
    "NOTICE_INGEST_QUEUE_STATUSES",
    "NoticeIngestJob",
    "NoticeIngestObjectRef",
    "build_authenticated_notice_run_ingest_idempotency_key",
    "build_authenticated_notice_run_ingest_job",
    "build_file_release_source_identity",
    "build_internal_notice_source_identity",
    "build_notice_ingest_idempotency_key",
    "build_notice_ingest_job",
    "validate_notice_ingest_job_payload",
]
