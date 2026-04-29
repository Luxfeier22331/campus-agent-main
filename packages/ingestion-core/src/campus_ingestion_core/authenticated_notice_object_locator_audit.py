from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
    DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
)


class AuthenticatedNoticeObjectLocatorAuditStore(Protocol):
    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeObjectLocatorAuditRequest:
    source_bucket: str
    notice_ids: tuple[str, ...] = ()
    file_release_ids: tuple[int | str, ...] = ()
    include_notice: bool = True
    include_file_release_capture: bool = True
    include_file_release_source: bool = True
    output_path: Path | None = None

    def __post_init__(self) -> None:
        source_bucket = self.source_bucket.strip()
        if not source_bucket:
            raise ValueError("source_bucket is required")
        object.__setattr__(self, "source_bucket", source_bucket)
        object.__setattr__(
            self,
            "notice_ids",
            tuple(str(item).strip() for item in self.notice_ids if str(item).strip()),
        )
        object.__setattr__(
            self,
            "file_release_ids",
            tuple(str(item).strip() for item in self.file_release_ids if str(item).strip()),
        )
        if self.output_path is not None:
            object.__setattr__(self, "output_path", Path(self.output_path))


def audit_authenticated_notice_object_locators(
    *,
    request: AuthenticatedNoticeObjectLocatorAuditRequest,
    object_store: AuthenticatedNoticeObjectLocatorAuditStore,
    source_truth_inventory_store: Any,
    file_release_inventory_store: Any,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    if request.include_notice:
        rows.extend(
            _audit_notice_source_truth_locators(
                request=request,
                object_store=object_store,
                source_truth_inventory_store=source_truth_inventory_store,
            )
        )
    if request.include_file_release_capture:
        rows.extend(
            _audit_file_release_locators(
                corpus=DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
                collection=DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
                request=request,
                object_store=object_store,
                file_release_inventory_store=file_release_inventory_store,
            )
        )
    if request.include_file_release_source:
        rows.extend(
            _audit_file_release_locators(
                corpus="authenticated_documents",
                collection="file_release_source",
                request=request,
                object_store=object_store,
                file_release_inventory_store=file_release_inventory_store,
            )
        )
    rows = sorted(
        rows,
        key=lambda row: (
            str(row["source_surface"]),
            str(row["scope"]),
            str(row["unit_id"]),
            str(row["object_role"]),
            str(row["object_key"]),
        ),
    )
    report = {
        "schema_version": "authenticated_notice_object_locator_audit.v1",
        "source_bucket": request.source_bucket,
        "notice_ids": list(request.notice_ids),
        "file_release_ids": list(request.file_release_ids),
        "include_notice": request.include_notice,
        "include_file_release_capture": request.include_file_release_capture,
        "include_file_release_source": request.include_file_release_source,
        "total_locator_count": len(rows),
        "verified_object_count": sum(1 for row in rows if row["status"] == "verified"),
        "missing_object_count": sum(1 for row in rows if row["status"] == "missing_object"),
        "checksum_mismatch_count": sum(1 for row in rows if row["status"] == "checksum_mismatch"),
        "size_mismatch_count": sum(1 for row in rows if row["status"] == "size_mismatch"),
        "incomplete_locator_count": sum(1 for row in rows if row["status"] == "incomplete_locator"),
        "write_performed": False,
        "rows": rows,
    }
    if request.output_path is not None:
        request.output_path.parent.mkdir(parents=True, exist_ok=True)
        request.output_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return report


def _audit_notice_source_truth_locators(
    *,
    request: AuthenticatedNoticeObjectLocatorAuditRequest,
    object_store: AuthenticatedNoticeObjectLocatorAuditStore,
    source_truth_inventory_store: Any,
) -> tuple[dict[str, Any], ...]:
    inventory_rows = tuple(
        source_truth_inventory_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=request.notice_ids,
        )
    )
    rows: list[dict[str, Any]] = []
    for inventory_row in inventory_rows:
        notice_id = str(getattr(inventory_row, "notice_id", "") or "").strip()
        for object_role, object_key in _notice_source_truth_keys(inventory_row).items():
            rows.append(
                _audit_head_locator(
                    object_store=object_store,
                    bucket=request.source_bucket,
                    object_key=object_key,
                    source_surface="notice",
                    scope="campus_notices/internal_notice",
                    unit_id=notice_id,
                    object_role=object_role,
                    missing_reason_code="missing_source_artifact",
                )
            )
    return tuple(rows)


def _audit_file_release_locators(
    *,
    corpus: str,
    collection: str,
    request: AuthenticatedNoticeObjectLocatorAuditRequest,
    object_store: AuthenticatedNoticeObjectLocatorAuditStore,
    file_release_inventory_store: Any,
) -> tuple[dict[str, Any], ...]:
    inventory_rows = tuple(
        file_release_inventory_store.list_by_scope(
            corpus,
            collection,
            file_release_ids=request.file_release_ids,
        )
    )
    rows: list[dict[str, Any]] = []
    for inventory_row in inventory_rows:
        unit_id = str(getattr(inventory_row, "file_release_id", "") or "").strip()
        rows.append(
            _audit_file_release_source_bytes(
                object_store=object_store,
                inventory_row=inventory_row,
                scope=f"{corpus}/{collection}",
                unit_id=unit_id,
            )
        )
        if (corpus, collection) == ("authenticated_documents", "file_release_source"):
            for object_role, object_key in _file_release_source_artifact_keys(
                inventory_row
            ).items():
                rows.append(
                    _audit_head_locator(
                        object_store=object_store,
                        bucket=request.source_bucket,
                        object_key=object_key,
                        source_surface="file_release",
                        scope=f"{corpus}/{collection}",
                        unit_id=unit_id,
                        object_role=object_role,
                        missing_reason_code="missing_source_artifact",
                    )
                )
    return tuple(rows)


def _audit_file_release_source_bytes(
    *,
    object_store: AuthenticatedNoticeObjectLocatorAuditStore,
    inventory_row: Any,
    scope: str,
    unit_id: str,
) -> dict[str, Any]:
    bucket = str(getattr(inventory_row, "released_file_bucket", "") or "").strip()
    object_key = str(getattr(inventory_row, "released_file_object_key", "") or "").strip()
    expected_sha256 = str(getattr(inventory_row, "released_file_sha256", "") or "").strip()
    expected_byte_size = getattr(inventory_row, "released_file_byte_size", None)
    base = _base_row(
        source_surface="file_release",
        scope=scope,
        unit_id=unit_id,
        object_role="file_release_released_source_bytes",
        bucket=bucket,
        object_key=object_key,
    )
    if not bucket or not object_key or not expected_sha256 or expected_byte_size is None:
        return {
            **base,
            "status": "incomplete_locator",
            "reason_code": "captured_only_without_source_bytes",
        }
    try:
        payload = object_store.get_bytes(bucket=bucket, key=object_key)
    except Exception:
        return {
            **base,
            "status": "missing_object",
            "reason_code": "missing_source_bytes",
        }
    try:
        byte_size = int(expected_byte_size)
    except (TypeError, ValueError):
        return {
            **base,
            "status": "incomplete_locator",
            "reason_code": "captured_only_without_source_bytes",
        }
    if len(payload) != byte_size:
        return {
            **base,
            "status": "size_mismatch",
            "reason_code": "size_mismatch",
            "expected_byte_size": byte_size,
            "actual_byte_size": len(payload),
        }
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != expected_sha256:
        return {
            **base,
            "status": "checksum_mismatch",
            "reason_code": "checksum_mismatch",
            "expected_sha256": expected_sha256,
            "actual_sha256": actual_sha256,
        }
    return {
        **base,
        "status": "verified",
        "reason_code": "",
        "expected_byte_size": byte_size,
        "actual_byte_size": len(payload),
        "expected_sha256": expected_sha256,
        "actual_sha256": actual_sha256,
    }


def _audit_head_locator(
    *,
    object_store: AuthenticatedNoticeObjectLocatorAuditStore,
    bucket: str,
    object_key: str,
    source_surface: str,
    scope: str,
    unit_id: str,
    object_role: str,
    missing_reason_code: str,
) -> dict[str, Any]:
    base = _base_row(
        source_surface=source_surface,
        scope=scope,
        unit_id=unit_id,
        object_role=object_role,
        bucket=bucket,
        object_key=object_key,
    )
    if not object_key:
        return {**base, "status": "incomplete_locator", "reason_code": "locator_incomplete"}
    try:
        head = object_store.head_object(bucket=bucket, key=object_key)
    except Exception:
        return {**base, "status": "missing_object", "reason_code": missing_reason_code}
    return {
        **base,
        "status": "verified",
        "reason_code": "",
        "content_length": head.get("content_length") or head.get("ContentLength"),
    }


def _notice_source_truth_keys(row: Any) -> dict[str, str]:
    parent_snapshot = dict(getattr(row, "parent_snapshot", {}) or {})
    source_artifact_keys = parent_snapshot.get("source_artifact_keys")
    if isinstance(source_artifact_keys, list):
        return {
            f"source_artifact_{index:03d}": str(item).strip()
            for index, item in enumerate(source_artifact_keys, start=1)
            if str(item).strip()
        }
    return {
        key: value
        for key, value in {
            "notice_manifest": str(getattr(row, "notice_manifest_key", "") or "").strip(),
            "content_blocks": str(getattr(row, "content_blocks_key", "") or "").strip(),
            "attachment_refs": str(getattr(row, "attachment_refs_key", "") or "").strip(),
        }.items()
        if value
    }


def _file_release_source_artifact_keys(row: Any) -> dict[str, str]:
    record = dict(getattr(row, "record", {}) or {})
    source_artifact_keys = record.get("source_artifact_keys")
    if not isinstance(source_artifact_keys, dict):
        return {}
    return {
        str(role): str(object_key).strip()
        for role, object_key in source_artifact_keys.items()
        if str(object_key).strip()
    }


def _base_row(
    *,
    source_surface: str,
    scope: str,
    unit_id: str,
    object_role: str,
    bucket: str,
    object_key: str,
) -> dict[str, Any]:
    return {
        "source_surface": source_surface,
        "scope": scope,
        "unit_id": unit_id,
        "object_role": object_role,
        "bucket": bucket,
        "object_key": object_key,
    }


__all__ = [
    "AuthenticatedNoticeObjectLocatorAuditRequest",
    "audit_authenticated_notice_object_locators",
]
