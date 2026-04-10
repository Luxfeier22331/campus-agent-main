from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any, Protocol, TextIO

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings


class AuthenticatedNoticeAttachmentKeyCopyObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None: ...


class AuthenticatedNoticeAttachmentKeyCopyS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._factory = S3ObjectStoreClientFactory(settings)
        self._client = self._factory.create()

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

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


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentKeyCopyRequest:
    mapping_path: Path
    output_dir: Path
    notice_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "mapping_path", Path(self.mapping_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(
            self,
            "notice_ids",
            tuple(sorted({str(item).strip() for item in self.notice_ids if str(item).strip()})),
        )


@dataclass(slots=True)
class _CandidateDraft:
    legacy_object_key: str
    canonical_object_key: str
    content_sha256: str
    original_filename: str | None
    notice_ids: set[str] = field(default_factory=set)
    attachment_ref_ids: set[str] = field(default_factory=set)


@dataclass(frozen=True, slots=True)
class _AttachmentCopyCandidate:
    legacy_object_key: str
    canonical_object_key: str
    content_sha256: str
    original_filename: str | None
    notice_ids: tuple[str, ...]
    attachment_ref_ids: tuple[str, ...]


def copy_authenticated_notice_source_attachment_keys(
    *,
    request: AuthenticatedNoticeAttachmentKeyCopyRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeAttachmentKeyCopyObjectStore | None = None,
    max_concurrency: int = 8,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    if max_concurrency <= 0:
        raise ValueError("max_concurrency must be positive")
    source = env if env is not None else dict(os.environ)
    settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or AuthenticatedNoticeAttachmentKeyCopyS3ObjectStore(
        settings
    )
    log_output = stderr if stderr is not None else sys.stderr
    candidates, selected_notice_ids, mapping_row_count = _load_candidates(request)
    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    copied_path = output_dir / "copied-objects.jsonl"
    existing_verified_path = output_dir / "existing-verified-objects.jsonl"
    summary_path = output_dir / "summary.json"

    if not candidates:
        summary = {
            "mapping_path": str(request.mapping_path),
            "output_dir": str(output_dir),
            "selected_notice_count": len(selected_notice_ids),
            "selected_notice_ids": list(selected_notice_ids),
            "mapping_row_count": mapping_row_count,
            "candidate_count": 0,
            "copied_count": 0,
            "existing_verified_count": 0,
            "copied_inventory_path": str(copied_path),
            "existing_verified_inventory_path": str(existing_verified_path),
        }
        _write_jsonl(copied_path, ())
        _write_jsonl(existing_verified_path, ())
        summary_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return summary

    copied_rows: list[dict[str, Any]] = []
    existing_verified_rows: list[dict[str, Any]] = []
    completed = 0
    total = len(candidates)
    with ThreadPoolExecutor(
        max_workers=max_concurrency,
        thread_name_prefix="authenticated-notice-attachment-key-copy",
    ) as executor:
        futures = {
            executor.submit(
                _process_candidate,
                candidate=candidate,
                bucket=settings.bucket_source,
                object_store=runtime_object_store,
            ): candidate.canonical_object_key
            for candidate in candidates
        }
        for future in as_completed(futures):
            result = future.result()
            completed += 1
            if result["status"] == "copied":
                copied_rows.append(result)
            elif result["status"] == "existing_verified":
                existing_verified_rows.append(result)
            else:  # pragma: no cover
                raise ValueError(f"unsupported copy result status: {result['status']}")
            if completed == total or completed % 25 == 0:
                print(
                    (
                        "[authenticated-notice-attachment-key-copy] "
                        f"completed={completed}/{total} copied={len(copied_rows)} "
                        f"existing_verified={len(existing_verified_rows)}"
                    ),
                    file=log_output,
                )

    copied_rows_sorted = sorted(copied_rows, key=lambda row: str(row["canonical_object_key"]))
    existing_verified_rows_sorted = sorted(
        existing_verified_rows,
        key=lambda row: str(row["canonical_object_key"]),
    )
    _write_jsonl(copied_path, copied_rows_sorted)
    _write_jsonl(existing_verified_path, existing_verified_rows_sorted)
    summary = {
        "mapping_path": str(request.mapping_path),
        "output_dir": str(output_dir),
        "selected_notice_count": len(selected_notice_ids),
        "selected_notice_ids": list(selected_notice_ids),
        "mapping_row_count": mapping_row_count,
        "candidate_count": len(candidates),
        "copied_count": len(copied_rows_sorted),
        "existing_verified_count": len(existing_verified_rows_sorted),
        "copied_inventory_path": str(copied_path),
        "existing_verified_inventory_path": str(existing_verified_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def _load_candidates(
    request: AuthenticatedNoticeAttachmentKeyCopyRequest,
) -> tuple[tuple[_AttachmentCopyCandidate, ...], tuple[str, ...], int]:
    filter_notice_ids = set(request.notice_ids)
    drafts_by_canonical_key: dict[str, _CandidateDraft] = {}
    selected_notice_ids: set[str] = set()
    mapping_row_count = 0
    for row in _load_jsonl_rows(request.mapping_path):
        notice_id = _normalize_optional_text(row.get("notice_id"))
        if filter_notice_ids and notice_id not in filter_notice_ids:
            continue
        mapping_row_count += 1
        if notice_id is not None:
            selected_notice_ids.add(notice_id)
        legacy_object_key = _required_text(
            row.get("legacy_object_key"),
            label="legacy_object_key",
        )
        canonical_object_key = _required_text(
            row.get("canonical_object_key"),
            label="canonical_object_key",
        )
        content_sha256 = _required_text(
            row.get("content_sha256"),
            label="content_sha256",
        )
        original_filename = _normalize_optional_text(row.get("original_filename"))
        draft = drafts_by_canonical_key.get(canonical_object_key)
        if draft is None:
            draft = _CandidateDraft(
                legacy_object_key=legacy_object_key,
                canonical_object_key=canonical_object_key,
                content_sha256=content_sha256,
                original_filename=original_filename,
            )
            drafts_by_canonical_key[canonical_object_key] = draft
        else:
            if draft.legacy_object_key != legacy_object_key:
                raise ValueError(
                    f"{canonical_object_key} legacy key conflict: "
                    f"{draft.legacy_object_key} != {legacy_object_key}"
                )
            if draft.content_sha256 != content_sha256:
                raise ValueError(
                    f"{canonical_object_key} content_sha256 conflict: "
                    f"{draft.content_sha256} != {content_sha256}"
                )
        if notice_id is not None:
            draft.notice_ids.add(notice_id)
        attachment_ref_id = _normalize_optional_text(row.get("attachment_ref_id"))
        if attachment_ref_id is not None:
            draft.attachment_ref_ids.add(attachment_ref_id)
    candidates = tuple(
        sorted(
            (
                _AttachmentCopyCandidate(
                    legacy_object_key=draft.legacy_object_key,
                    canonical_object_key=draft.canonical_object_key,
                    content_sha256=draft.content_sha256,
                    original_filename=draft.original_filename,
                    notice_ids=tuple(sorted(draft.notice_ids)),
                    attachment_ref_ids=tuple(sorted(draft.attachment_ref_ids)),
                )
                for draft in drafts_by_canonical_key.values()
            ),
            key=lambda item: item.canonical_object_key,
        )
    )
    return candidates, tuple(sorted(selected_notice_ids)), mapping_row_count


def _process_candidate(
    *,
    candidate: _AttachmentCopyCandidate,
    bucket: str,
    object_store: AuthenticatedNoticeAttachmentKeyCopyObjectStore,
) -> dict[str, Any]:
    source_bytes = object_store.get_bytes(bucket=bucket, key=candidate.legacy_object_key)
    source_byte_size = _validate_bytes(
        payload=source_bytes,
        expected_sha256=candidate.content_sha256,
        label=candidate.legacy_object_key,
        source_label="legacy object",
    )
    try:
        target_bytes = object_store.get_bytes(bucket=bucket, key=candidate.canonical_object_key)
    except Exception as exc:
        if not _is_missing_object_error(exc):
            raise
        object_store.copy_object(
            source_bucket=bucket,
            source_key=candidate.legacy_object_key,
            target_bucket=bucket,
            target_key=candidate.canonical_object_key,
        )
        target_bytes = object_store.get_bytes(bucket=bucket, key=candidate.canonical_object_key)
        target_byte_size = _validate_bytes(
            payload=target_bytes,
            expected_sha256=candidate.content_sha256,
            label=candidate.canonical_object_key,
            source_label="copied object",
        )
        if target_byte_size != source_byte_size:
            raise ValueError(
                f"{candidate.canonical_object_key} byte_size mismatch after copy: "
                f"source={source_byte_size}, target={target_byte_size}"
            )
        return _candidate_result(
            candidate=candidate,
            status="copied",
            byte_size=target_byte_size,
        )
    target_byte_size = _validate_bytes(
        payload=target_bytes,
        expected_sha256=candidate.content_sha256,
        label=candidate.canonical_object_key,
        source_label="existing canonical object",
    )
    if target_byte_size != source_byte_size:
        raise ValueError(
            f"{candidate.canonical_object_key} byte_size mismatch against source: "
            f"source={source_byte_size}, target={target_byte_size}"
        )
    return _candidate_result(
        candidate=candidate,
        status="existing_verified",
        byte_size=target_byte_size,
    )


def _candidate_result(
    *,
    candidate: _AttachmentCopyCandidate,
    status: str,
    byte_size: int,
) -> dict[str, Any]:
    return {
        "status": status,
        "legacy_object_key": candidate.legacy_object_key,
        "canonical_object_key": candidate.canonical_object_key,
        "content_sha256": candidate.content_sha256,
        "byte_size": byte_size,
        "original_filename": candidate.original_filename,
        "notice_ids": list(candidate.notice_ids),
        "attachment_ref_ids": list(candidate.attachment_ref_ids),
    }


def _validate_bytes(
    *,
    payload: bytes,
    expected_sha256: str,
    label: str,
    source_label: str,
) -> int:
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError(
            f"{source_label} {label} content_sha256 mismatch: "
            f"expected {expected_sha256}, got {actual_sha256}"
        )
    return len(payload)


def _load_jsonl_rows(path: Path) -> tuple[dict[str, Any], ...]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return ()
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if not isinstance(payload, dict):
            raise ValueError(f"mapping row must be an object: {normalized}")
        rows.append(dict(payload))
    return tuple(rows)


def _write_jsonl(path: Path, rows: tuple[dict[str, Any], ...] | list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _required_text(value: object, *, label: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, KeyError):
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
    "AuthenticatedNoticeAttachmentKeyCopyRequest",
    "AuthenticatedNoticeAttachmentKeyCopyS3ObjectStore",
    "copy_authenticated_notice_source_attachment_keys",
]
