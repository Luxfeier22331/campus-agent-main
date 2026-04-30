from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_file_release_import import (
    FILE_RELEASE_SOURCE_SURFACE,
)
from campus_ingestion_core.collected_notice_reimport_preview_models import (
    CollectedNoticeCapturedRunRef,
)
from campus_ingestion_core.settings import (
    DEFAULT_BUCKET_DERIVED,
    DEFAULT_BUCKET_SOURCE,
    resolve_object_store_bucket_names,
)


def _content_blocks_body_text(content_blocks: Sequence[Mapping[str, Any]]) -> str:
    lines = []
    for block in content_blocks:
        role = str(block.get("block_role") or "").strip().lower()
        text = str(block.get("text_normalized") or block.get("text_raw") or "").strip()
        if not text or role == "title":
            continue
        lines.append(text)
    return "\n".join(lines).strip()


def _source_object_refs(
    *,
    run_ref: CollectedNoticeCapturedRunRef,
    source_artifact_keys: Mapping[str, str],
    attachment_refs: Sequence[Mapping[str, Any]],
    bucket_source: str,
) -> tuple[dict[str, Any], ...]:
    refs: list[dict[str, Any]] = [
        _object_ref(
            bucket=run_ref.source_bucket,
            key=run_ref.bundle_object_key,
            role="collector_bundle",
            sha256=run_ref.bundle_content_sha256,
            byte_size=run_ref.bundle_byte_size,
        ),
        _object_ref(
            bucket=run_ref.source_bucket,
            key=run_ref.manifest_object_key,
            role="collector_manifest",
            sha256=run_ref.manifest_content_sha256,
            byte_size=run_ref.manifest_byte_size,
        ),
    ]
    refs.extend(
        _object_ref(bucket=bucket_source, key=key, role=role)
        for role, key in sorted(source_artifact_keys.items())
    )
    for index, attachment_ref in enumerate(attachment_refs, start=1):
        if "required_source_object" in attachment_ref and not bool(
            attachment_ref.get("required_source_object")
        ):
            continue
        object_key = _optional_text(attachment_ref.get("object_key"))
        if not object_key:
            continue
        refs.append(
            _object_ref(
                bucket=_optional_text(attachment_ref.get("bucket")) or bucket_source,
                key=object_key,
                role=str(
                    attachment_ref.get("source_object_role")
                    or attachment_ref.get("resource_role")
                    or f"attachment:{index}"
                ),
                sha256=_optional_text(
                    attachment_ref.get("content_sha256") or attachment_ref.get("sha256")
                ),
                byte_size=_optional_int(attachment_ref.get("byte_size")),
                extra={
                    "mime_type": _optional_text(attachment_ref.get("mime_type")),
                    "source_url": _optional_text(attachment_ref.get("source_url")),
                    "final_url": _optional_text(attachment_ref.get("final_url")),
                },
            )
        )
    return tuple(_dedupe_object_refs(refs))


def _file_release_required_attachment_ref(
    *,
    file_release_id: str,
    released_file_ref: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": "file_release_source_ref_preview.v1",
        "attachment_ref_id": f"file_release:{file_release_id}",
        "resource_role": "released_file",
        "source_url": released_file_ref.get("source_url"),
        "final_url": released_file_ref.get("final_url"),
        "original_filename": released_file_ref.get("original_filename"),
        "mime_type": released_file_ref.get("mime_type"),
        "byte_size": released_file_ref.get("byte_size"),
        "object_key": released_file_ref.get("object_key"),
        "content_sha256": released_file_ref.get("content_sha256"),
        "bucket": released_file_ref.get("bucket"),
        "notice_capture_route": "candidate_document_owner",
        "attachment_capture_policy": "fetch_required_for_source_truth",
        "attachment_capture_state": "uploaded_required",
        "byte_fetch_required": True,
        "byte_fetch_required_reason": "file_release_source_truth",
        "required_source_object": True,
        "source_object_role": "file_release_released_source_bytes",
        "retention_class": "permanent_source_truth",
        "retention_expires_at": None,
        "promotion_owner": None,
        "attachment_promotion_state": "not_applicable",
        "promotion_decision_id": None,
        "promotion_reason_codes": [],
        "skip_reason": None,
        "terminal_reason": None,
        "last_error_class": None,
    }


def _source_retention_summary_from_manifest(
    *,
    notice_manifest: Mapping[str, Any],
    attachment_refs: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    notice_capture_route = str(
        notice_manifest.get("notice_capture_route") or "capture_only_no_adoption"
    )
    summary = {
        "notice_capture_route": notice_capture_route,
        "attachment_capture_policy_counts": dict(
            notice_manifest.get("attachment_capture_policy_counts") or {}
        ),
        "attachment_capture_state_counts": dict(
            notice_manifest.get("attachment_capture_state_counts") or {}
        ),
        "retention_class_counts": dict(notice_manifest.get("retention_class_counts") or {}),
        "required_source_object_count": int(
            notice_manifest.get("required_source_object_count") or 0
        ),
        "metadata_only_attachment_ref_count": int(
            notice_manifest.get("metadata_only_attachment_ref_count") or 0
        ),
        "quarantine_attachment_ref_count": int(
            notice_manifest.get("quarantine_attachment_ref_count") or 0
        ),
        "admitted_source_byte_ref_count": int(
            notice_manifest.get("admitted_source_byte_ref_count") or 0
        ),
    }
    if attachment_refs and not summary["attachment_capture_policy_counts"]:
        return _source_retention_summary_from_attachment_refs(
            notice_capture_route=notice_capture_route,
            attachment_refs=attachment_refs,
        )
    return summary


def _source_retention_summary_from_attachment_refs(
    *,
    notice_capture_route: str,
    attachment_refs: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    policy_counts = Counter(
        str(ref.get("attachment_capture_policy") or "")
        for ref in attachment_refs
        if str(ref.get("attachment_capture_policy") or "")
    )
    state_counts = Counter(
        str(ref.get("attachment_capture_state") or "")
        for ref in attachment_refs
        if str(ref.get("attachment_capture_state") or "")
    )
    retention_counts = Counter(
        str(ref.get("retention_class") or "")
        for ref in attachment_refs
        if str(ref.get("retention_class") or "")
    )
    return {
        "notice_capture_route": notice_capture_route,
        "attachment_capture_policy_counts": dict(sorted(policy_counts.items())),
        "attachment_capture_state_counts": dict(sorted(state_counts.items())),
        "retention_class_counts": dict(sorted(retention_counts.items())),
        "required_source_object_count": sum(
            1 for ref in attachment_refs if bool(ref.get("required_source_object"))
        ),
        "metadata_only_attachment_ref_count": policy_counts.get("metadata_only", 0),
        "quarantine_attachment_ref_count": policy_counts.get("fetch_to_quarantine", 0),
        "admitted_source_byte_ref_count": retention_counts.get("admitted_source_bytes", 0),
    }


def _object_ref(
    *,
    bucket: str,
    key: str,
    role: str,
    sha256: str | None = None,
    byte_size: int | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "bucket": bucket,
        "key": key,
        "role": role,
    }
    if sha256:
        payload["sha256"] = sha256
    if byte_size is not None:
        payload["byte_size"] = byte_size
    for extra_key, value in (extra or {}).items():
        if value not in {None, ""}:
            payload[extra_key] = value
    return payload


def _dedupe_object_refs(refs: Sequence[dict[str, Any]]) -> tuple[dict[str, Any], ...]:
    seen: set[tuple[str, str, str]] = set()
    deduped = []
    for ref in refs:
        key = (str(ref.get("bucket")), str(ref.get("key")), str(ref.get("role")))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ref)
    return tuple(deduped)


def _resolve_multimodal_status(
    *,
    source_surface: str,
    body_text: str,
    attachment_refs: Sequence[Mapping[str, Any]],
) -> tuple[str, tuple[str, ...]]:
    reason_codes: list[str] = []
    if not body_text.strip():
        reason_codes.append("empty_body_text")
    if source_surface == FILE_RELEASE_SOURCE_SURFACE:
        reason_codes.append("released_file_text_extraction_pending")
    for attachment in attachment_refs:
        if _is_metadata_only_attachment_ref(attachment):
            continue
        object_key = _optional_text(attachment.get("object_key"))
        mime_type = str(attachment.get("mime_type") or "").strip().lower()
        filename = str(
            attachment.get("original_filename") or attachment.get("source_url") or ""
        ).strip()
        role = str(attachment.get("resource_role") or "").strip().lower()
        if not object_key:
            reason_codes.append("attachment_object_missing")
        if (
            role == "inline_image"
            or mime_type.startswith("image/")
            or _has_suffix(
                filename,
                (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"),
            )
        ):
            reason_codes.append("image_attachment_pending_text_extraction")
        elif mime_type == "application/pdf" or _has_suffix(filename, (".pdf",)):
            reason_codes.append("pdf_attachment_pending_text_extraction")
        elif _is_office_like(mime_type=mime_type, filename=filename):
            reason_codes.append("office_attachment_pending_text_extraction")
    normalized_reason_codes = tuple(dict.fromkeys(reason_codes))
    if normalized_reason_codes:
        return "pending", normalized_reason_codes
    return "not_required", ()


def _is_metadata_only_attachment_ref(attachment: Mapping[str, Any]) -> bool:
    policy = str(attachment.get("attachment_capture_policy") or "").strip()
    if policy == "metadata_only":
        return True
    return (
        attachment.get("byte_fetch_required") is False
        and not bool(attachment.get("required_source_object"))
        and str(attachment.get("retention_class") or "").strip() == "metadata_only"
    )


def _resolved_site_id(
    run_ref: CollectedNoticeCapturedRunRef,
    export_manifest: Mapping[str, Any],
    default_site_id: str,
) -> str:
    return (
        run_ref.site_id
        or _optional_text(export_manifest.get("site_id"))
        or _optional_text(export_manifest.get("site"))
        or default_site_id
    )


def _resolved_source_home_url(
    run_ref: CollectedNoticeCapturedRunRef,
    export_manifest: Mapping[str, Any],
    default_source_home_url: str,
) -> str:
    return (
        run_ref.source_home_url
        or _optional_text(export_manifest.get("source_home_url"))
        or default_source_home_url
    )


def _bucket_names(env: Mapping[str, str]) -> tuple[str, str]:
    try:
        return resolve_object_store_bucket_names(dict(env))
    except Exception:
        return DEFAULT_BUCKET_SOURCE, DEFAULT_BUCKET_DERIVED


def _visibility_level(metadata: Mapping[str, Any]) -> str:
    value = _optional_text(metadata.get("visibility_level"))
    if value:
        return value
    return "restricted" if _text_tuple(metadata.get("entitlement_groups")) else "public"


def _text_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        values = (value,)
    else:
        values = tuple(value) if isinstance(value, Sequence) else ()
    return tuple(str(item).strip() for item in values if str(item).strip())


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _has_suffix(value: str, suffixes: Sequence[str]) -> bool:
    normalized = value.lower()
    return any(normalized.endswith(suffix) for suffix in suffixes)


def _is_office_like(*, mime_type: str, filename: str) -> bool:
    if _has_suffix(filename, (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")):
        return True
    return any(
        token in mime_type
        for token in (
            "msword",
            "officedocument",
            "ms-excel",
            "ms-powerpoint",
            "spreadsheet",
            "presentation",
            "wordprocessing",
        )
    )


__all__ = [
    "_bucket_names",
    "_content_blocks_body_text",
    "_file_release_required_attachment_ref",
    "_optional_int",
    "_optional_text",
    "_resolve_multimodal_status",
    "_resolved_site_id",
    "_resolved_source_home_url",
    "_source_object_refs",
    "_source_retention_summary_from_attachment_refs",
    "_source_retention_summary_from_manifest",
    "_text_tuple",
    "_visibility_level",
]
