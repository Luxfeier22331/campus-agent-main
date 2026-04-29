from __future__ import annotations

import hashlib
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, TextIO

from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    infer_authenticated_notice_year,
    resolve_authenticated_notice_attachment_object_key,
)
from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings


class AuthenticatedNoticeAttachmentObjectStore(Protocol):
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


class AuthenticatedNoticeAttachmentObjectBackfillS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
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


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentObjectBackfillRequest:
    bundle_path: Path
    blob_root: Path
    notice_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        object.__setattr__(self, "blob_root", Path(self.blob_root))
        object.__setattr__(
            self,
            "notice_ids",
            tuple(sorted({str(item).strip() for item in self.notice_ids if str(item).strip()})),
        )


@dataclass(slots=True)
class _CandidateDraft:
    target_object_key: str
    expected_sha256: str
    mime_type: str | None
    expected_byte_size: int | None
    source_object_keys: set[str] = field(default_factory=set)
    local_blob_paths: set[Path] = field(default_factory=set)
    notice_ids: set[str] = field(default_factory=set)
    attachment_ids: set[str] = field(default_factory=set)


@dataclass(frozen=True, slots=True)
class _AttachmentObjectCandidate:
    target_object_key: str
    expected_sha256: str
    mime_type: str | None
    expected_byte_size: int | None
    source_object_keys: tuple[str, ...]
    local_blob_paths: tuple[Path, ...]
    notice_ids: tuple[str, ...]
    attachment_ids: tuple[str, ...]


def backfill_authenticated_notice_attachment_objects(
    *,
    request: AuthenticatedNoticeAttachmentObjectBackfillRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeAttachmentObjectStore | None = None,
    max_concurrency: int = 8,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    if max_concurrency <= 0:
        raise ValueError("max_concurrency must be positive")
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or AuthenticatedNoticeAttachmentObjectBackfillS3ObjectStore(
        settings
    )
    log_output = stderr if stderr is not None else sys.stderr
    candidates, selected_notice_ids = _load_candidates(request)
    total = len(candidates)
    if total == 0:
        return {
            "bundle_path": str(request.bundle_path),
            "blob_root": str(request.blob_root),
            "selected_notice_count": len(selected_notice_ids),
            "selected_notice_ids": list(selected_notice_ids),
            "candidate_count": 0,
            "uploaded_count": 0,
            "existing_verified_count": 0,
        }

    uploaded_object_keys: list[str] = []
    existing_verified_object_keys: list[str] = []
    completed = 0
    with ThreadPoolExecutor(
        max_workers=max_concurrency,
        thread_name_prefix="authenticated-notice-attachment-backfill",
    ) as executor:
        futures = {
            executor.submit(
                _process_candidate,
                candidate=candidate,
                bucket=settings.bucket_source,
                object_store=runtime_object_store,
            ): candidate.target_object_key
            for candidate in candidates
        }
        for future in as_completed(futures):
            result = future.result()
            completed += 1
            if result["status"] == "uploaded":
                uploaded_object_keys.append(str(result["object_key"]))
            elif result["status"] == "existing_verified":
                existing_verified_object_keys.append(str(result["object_key"]))
            else:  # pragma: no cover
                raise ValueError(f"unsupported backfill result status: {result['status']}")
            if completed == total or completed % 25 == 0:
                print(
                    (
                        "[authenticated-notice-attachment-backfill] "
                        f"completed={completed}/{total} uploaded={len(uploaded_object_keys)} "
                        f"existing_verified={len(existing_verified_object_keys)}"
                    ),
                    file=log_output,
                )

    return {
        "bundle_path": str(request.bundle_path),
        "blob_root": str(request.blob_root),
        "selected_notice_count": len(selected_notice_ids),
        "selected_notice_ids": list(selected_notice_ids),
        "candidate_count": total,
        "uploaded_count": len(uploaded_object_keys),
        "existing_verified_count": len(existing_verified_object_keys),
        "uploaded_object_keys": sorted(uploaded_object_keys),
        "existing_verified_object_keys": sorted(existing_verified_object_keys),
    }


def _load_candidates(
    request: AuthenticatedNoticeAttachmentObjectBackfillRequest,
) -> tuple[tuple[_AttachmentObjectCandidate, ...], tuple[str, ...]]:
    records = load_authenticated_notice_bundle_payload(request.bundle_path)
    filter_notice_ids = set(request.notice_ids)
    drafts_by_object_key: dict[str, _CandidateDraft] = {}
    selected_notice_ids: set[str] = set()
    for record in records:
        notice_id = _resolve_notice_id(record)
        if filter_notice_ids and notice_id not in filter_notice_ids:
            continue
        selected_notice_ids.add(notice_id)
        notice = record.get("notice")
        year = infer_authenticated_notice_year(notice=notice) if isinstance(notice, dict) else None
        attachments_by_id = {
            item.get("attachment_id"): item
            for item in _attachments_payload(record)
            if item.get("attachment_id") is not None
        }
        for relation in _notice_attachments_payload(record):
            attachment = attachments_by_id.get(relation.get("attachment_id"))
            if attachment is None:
                continue
            source_object_key = _normalize_optional_text(attachment.get("object_key"))
            if source_object_key is None:
                continue
            expected_sha256 = _required_text(
                attachment.get("sha256"),
                label=f"{notice_id}#{relation.get('attachment_id')} sha256",
            )
            target_object_key = resolve_authenticated_notice_attachment_object_key(
                attachment=attachment,
                year=year,
            )
            if target_object_key is None:
                continue
            mime_type = _normalize_optional_text(attachment.get("mime_type"))
            expected_byte_size = _normalize_optional_int(attachment.get("byte_size"))
            local_blob_path = _resolve_local_blob_path(
                blob_root=request.blob_root,
                object_key=source_object_key,
            )
            draft = drafts_by_object_key.get(target_object_key)
            if draft is None:
                draft = _CandidateDraft(
                    target_object_key=target_object_key,
                    expected_sha256=expected_sha256,
                    mime_type=mime_type,
                    expected_byte_size=expected_byte_size,
                )
                drafts_by_object_key[target_object_key] = draft
            else:
                if draft.expected_sha256 != expected_sha256:
                    raise ValueError(
                        f"{target_object_key} sha256 conflict: {draft.expected_sha256} != {expected_sha256}"
                    )
                if draft.expected_byte_size != expected_byte_size:
                    raise ValueError(
                        f"{target_object_key} byte_size conflict: {draft.expected_byte_size} != {expected_byte_size}"
                    )
                if draft.mime_type != mime_type:
                    raise ValueError(
                        f"{target_object_key} mime_type conflict: {draft.mime_type!r} != {mime_type!r}"
                    )
            draft.source_object_keys.add(source_object_key)
            draft.local_blob_paths.add(local_blob_path)
            draft.notice_ids.add(notice_id)
            attachment_id = relation.get("attachment_id")
            if attachment_id is not None:
                draft.attachment_ids.add(str(attachment_id))
    candidates = tuple(
        sorted(
            (
                _AttachmentObjectCandidate(
                    target_object_key=draft.target_object_key,
                    expected_sha256=draft.expected_sha256,
                    mime_type=draft.mime_type,
                    expected_byte_size=draft.expected_byte_size,
                    source_object_keys=tuple(sorted(draft.source_object_keys)),
                    local_blob_paths=tuple(sorted(draft.local_blob_paths, key=str)),
                    notice_ids=tuple(sorted(draft.notice_ids)),
                    attachment_ids=tuple(sorted(draft.attachment_ids)),
                )
                for draft in drafts_by_object_key.values()
            ),
            key=lambda item: item.target_object_key,
        )
    )
    return candidates, tuple(sorted(selected_notice_ids))


def _process_candidate(
    *,
    candidate: _AttachmentObjectCandidate,
    bucket: str,
    object_store: AuthenticatedNoticeAttachmentObjectStore,
) -> dict[str, str]:
    try:
        existing_bytes = object_store.get_bytes(bucket=bucket, key=candidate.target_object_key)
    except Exception as exc:
        if not _is_missing_object_error(exc):
            raise
        if candidate.mime_type is None:
            raise ValueError(
                f"{candidate.target_object_key} mime_type is required for upload"
            ) from exc
        local_blob_path = _select_local_blob_path(candidate)
        if local_blob_path is None:
            raise FileNotFoundError(
                f"{candidate.target_object_key} local blob not found under sources: "
                + ", ".join(candidate.source_object_keys)
            ) from exc
        local_bytes = local_blob_path.read_bytes()
        _validate_candidate_bytes(
            candidate,
            payload=local_bytes,
            source_label="local blob",
        )
        object_store.put_bytes(
            bucket=bucket,
            key=candidate.target_object_key,
            data=local_bytes,
            content_type=candidate.mime_type,
        )
        uploaded_bytes = object_store.get_bytes(bucket=bucket, key=candidate.target_object_key)
        _validate_candidate_bytes(
            candidate,
            payload=uploaded_bytes,
            source_label="uploaded object",
        )
        return {"status": "uploaded", "object_key": candidate.target_object_key}
    _validate_candidate_bytes(
        candidate,
        payload=existing_bytes,
        source_label="existing object",
    )
    return {"status": "existing_verified", "object_key": candidate.target_object_key}


def _validate_candidate_bytes(
    candidate: _AttachmentObjectCandidate,
    *,
    payload: bytes,
    source_label: str,
) -> None:
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != candidate.expected_sha256:
        raise ValueError(
            f"{source_label} {candidate.target_object_key} content_sha256 mismatch: "
            f"expected {candidate.expected_sha256}, got {actual_sha256}"
        )
    if candidate.expected_byte_size is not None and len(payload) != candidate.expected_byte_size:
        raise ValueError(
            f"{source_label} {candidate.target_object_key} byte_size mismatch: "
            f"expected {candidate.expected_byte_size}, got {len(payload)}"
        )


def _select_local_blob_path(candidate: _AttachmentObjectCandidate) -> Path | None:
    for path in candidate.local_blob_paths:
        if path.is_file():
            return path
    return None


def _resolve_notice_id(record: dict[str, Any]) -> str:
    notice = record.get("notice")
    if isinstance(notice, dict):
        notice_id = _normalize_scalar_text(notice.get("notice_id"))
        if notice_id is not None:
            return notice_id
    notice_id = _normalize_scalar_text(record.get("notice_id"))
    if notice_id is None:
        raise ValueError("bundle record notice_id is required")
    return notice_id


def _attachments_payload(record: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    attachments = record.get("attachments") or ()
    return tuple(item for item in attachments if isinstance(item, dict))


def _notice_attachments_payload(record: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    relations = record.get("notice_attachments") or ()
    return tuple(item for item in relations if isinstance(item, dict))


def _resolve_local_blob_path(*, blob_root: Path, object_key: str) -> Path:
    root = blob_root.resolve()
    candidate = (root / object_key).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"object_key escapes blob_root: {object_key}")
    return candidate


def _required_text(value: object, *, label: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_optional_int(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _normalize_scalar_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, (FileNotFoundError, KeyError)):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error")
    if not isinstance(error, dict):
        return False
    code = str(error.get("Code") or "").strip()
    return code in {"404", "NoSuchKey", "NotFound"}


__all__ = [
    "AuthenticatedNoticeAttachmentObjectBackfillRequest",
    "AuthenticatedNoticeAttachmentObjectBackfillS3ObjectStore",
    "backfill_authenticated_notice_attachment_objects",
]
