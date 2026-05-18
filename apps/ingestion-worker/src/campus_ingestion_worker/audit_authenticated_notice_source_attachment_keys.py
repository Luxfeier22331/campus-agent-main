from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_attachment_object_keys import (
    CANONICAL_ATTACHMENT_OBJECT_KEY_RE,
    LEGACY_ATTACHMENT_OBJECT_KEY_RE,
    is_canonical_attachment_object_key,
    is_legacy_attachment_object_key,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_attachment_capture_key,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import parse_source_object_key
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit authenticated notice source attachment legacy object keys"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-projections-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument(
        "--now",
        help=(
            "ISO timestamp used to classify expired quarantine attachments; "
            "omitting it keeps expiration-dependent objects in review_required"
        ),
    )
    return parser


def audit_authenticated_notice_source_attachment_keys(
    *,
    corpus: str,
    collection: str,
    output_dir: Path,
    source_projections_path: Path | None = None,
    notice_ids: Sequence[str] = (),
    now: str | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    source = env if env is not None else {}
    object_store_settings = ObjectStoreSettings.from_env(source or None)
    object_store = S3ObjectStoreAdmin(object_store_settings)
    selected_notice_ids = set(_normalize_notice_ids(notice_ids))
    attachment_refs_keys = tuple(
        sorted(
            key
            for key in object_store.list_keys(
                bucket=object_store_settings.bucket_source,
                prefix="authenticated_notice_portal/",
            )
            if key.endswith("/source-truth/attachment-refs.jsonl")
        )
    )

    referenced_rows: list[dict[str, Any]] = []
    mapping_rows: list[dict[str, Any]] = []
    referenced_keys: set[str] = set()
    canonical_attachment_ref_rows_by_key: dict[str, list[dict[str, Any]]] = {}
    audited_notice_ids: set[str] = set()
    for attachment_refs_key in attachment_refs_keys:
        parent_key = parse_source_object_key(attachment_refs_key)
        parent_year = str(parent_key["year"]) if parent_key is not None else "undated"
        attachment_refs = _load_jsonl_rows(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=attachment_refs_key,
            )
        )
        for row in attachment_refs:
            notice_id = str(row.get("notice_id") or "").strip()
            if selected_notice_ids and notice_id not in selected_notice_ids:
                continue
            if notice_id:
                audited_notice_ids.add(notice_id)
            object_key = str(row.get("object_key") or "").strip()
            if is_canonical_attachment_object_key(object_key):
                canonical_attachment_ref_rows_by_key.setdefault(object_key, []).append(
                    {
                        "notice_id": notice_id or None,
                        "attachment_refs_key": attachment_refs_key,
                        "attachment_ref_id": row.get("attachment_ref_id"),
                        "object_key": object_key,
                        "content_sha256": _normalize_optional_text(
                            row.get("content_sha256") or row.get("sha256")
                        ),
                        "retention_class": _normalize_optional_text(row.get("retention_class")),
                        "retention_expires_at": _normalize_optional_text(
                            row.get("retention_expires_at")
                        ),
                        "required_source_object": row.get("required_source_object"),
                        "attachment_promotion_state": _normalize_optional_text(
                            row.get("attachment_promotion_state")
                        ),
                        "mime_type": row.get("mime_type"),
                        "byte_size": row.get("byte_size"),
                    }
                )
            if not is_legacy_attachment_object_key(object_key):
                continue
            referenced_keys.add(object_key)
            content_sha256 = str(row.get("content_sha256") or "").strip()
            original_filename = _normalize_attachment_filename(
                original_filename=row.get("original_filename"),
                source_object_key=object_key,
            )
            canonical_key = (
                _build_canonical_attachment_capture_key(
                    corpus=corpus,
                    content_sha256=content_sha256,
                    filename=original_filename,
                    year=parent_year,
                )
                if content_sha256
                else None
            )
            payload = {
                "notice_id": notice_id or None,
                "attachment_refs_key": attachment_refs_key,
                "attachment_ref_id": row.get("attachment_ref_id"),
                "legacy_object_key": object_key,
                "content_sha256": content_sha256 or None,
                "mime_type": row.get("mime_type"),
                "byte_size": row.get("byte_size"),
                "original_filename": original_filename,
                "canonical_object_key": canonical_key,
            }
            referenced_rows.append(payload)
            if canonical_key is not None:
                mapping_rows.append(
                    {
                        "legacy_object_key": object_key,
                        "canonical_object_key": canonical_key,
                        "content_sha256": content_sha256,
                        "original_filename": original_filename,
                        "notice_id": notice_id or None,
                        "attachment_ref_id": row.get("attachment_ref_id"),
                    }
                )

    all_source_keys = object_store.list_keys(bucket=object_store_settings.bucket_source, prefix="")
    all_legacy_keys = sorted(key for key in all_source_keys if is_legacy_attachment_object_key(key))
    unreferenced_rows = [
        {"legacy_object_key": key} for key in all_legacy_keys if key not in referenced_keys
    ]
    all_canonical_attachment_keys = sorted(
        key for key in all_source_keys if is_canonical_attachment_object_key(key)
    )
    canonical_classification = _classify_canonical_attachment_keys(
        bucket=object_store_settings.bucket_source,
        keys=all_canonical_attachment_keys,
        refs_by_key=canonical_attachment_ref_rows_by_key,
        object_store=object_store,
        now=now,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    referenced_path = output_dir / "referenced-legacy-keys.jsonl"
    unreferenced_path = output_dir / "unreferenced-legacy-keys.jsonl"
    mapping_path = output_dir / "legacy-to-canonical-mapping.jsonl"
    canonical_keep_path = output_dir / "canonical-attachment-keep.jsonl"
    canonical_cleanup_candidate_path = output_dir / (
        "canonical-attachment-cleanup-candidates.jsonl"
    )
    canonical_unreferenced_candidate_path = output_dir / (
        "canonical-attachment-unreferenced-candidates.jsonl"
    )
    canonical_review_required_path = output_dir / "canonical-attachment-review-required.jsonl"
    summary_path = output_dir / "summary.json"
    _write_jsonl(referenced_path, referenced_rows)
    _write_jsonl(unreferenced_path, unreferenced_rows)
    _write_jsonl(mapping_path, mapping_rows)
    _write_jsonl(canonical_keep_path, canonical_classification["keep"])
    _write_jsonl(
        canonical_cleanup_candidate_path,
        canonical_classification["cleanup_candidates"],
    )
    _write_jsonl(
        canonical_unreferenced_candidate_path,
        canonical_classification["unreferenced_candidates"],
    )
    _write_jsonl(canonical_review_required_path, canonical_classification["review_required"])

    summary = {
        "corpus": corpus,
        "collection": collection,
        "selected_notice_ids": list(_normalize_notice_ids(notice_ids)),
        "now": now or "",
        "audited_notice_count": len(audited_notice_ids),
        "attachment_refs_object_count": len(attachment_refs_keys),
        "legacy_key_count": len(all_legacy_keys),
        "referenced_legacy_row_count": len(referenced_rows),
        "referenced_legacy_key_count": len(referenced_keys),
        "unreferenced_legacy_key_count": len(unreferenced_rows),
        "canonicalizable_referenced_row_count": len(mapping_rows),
        "canonicalizable_referenced_key_count": len(
            {row["legacy_object_key"] for row in mapping_rows}
        ),
        "canonical_attachment_key_count": len(all_canonical_attachment_keys),
        "canonical_attachment_keep_count": len(canonical_classification["keep"]),
        "canonical_attachment_cleanup_candidate_count": len(
            canonical_classification["cleanup_candidates"]
        ),
        "canonical_attachment_unreferenced_count": len(
            canonical_classification["unreferenced_candidates"]
        ),
        "canonical_attachment_review_required_count": len(
            canonical_classification["review_required"]
        ),
        "canonical_attachment_keep_byte_size": _sum_byte_size(canonical_classification["keep"]),
        "canonical_attachment_cleanup_candidate_byte_size": _sum_byte_size(
            canonical_classification["cleanup_candidates"]
        ),
        "canonical_attachment_unreferenced_byte_size": _sum_byte_size(
            canonical_classification["unreferenced_candidates"]
        ),
        "canonical_attachment_review_required_byte_size": _sum_byte_size(
            canonical_classification["review_required"]
        ),
        "output_dir": str(output_dir),
        "referenced_inventory_path": str(referenced_path),
        "unreferenced_inventory_path": str(unreferenced_path),
        "mapping_inventory_path": str(mapping_path),
        "canonical_attachment_keep_inventory_path": str(canonical_keep_path),
        "canonical_attachment_cleanup_candidate_inventory_path": str(
            canonical_cleanup_candidate_path
        ),
        "canonical_attachment_unreferenced_candidate_inventory_path": str(
            canonical_unreferenced_candidate_path
        ),
        "canonical_attachment_review_required_inventory_path": str(canonical_review_required_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def _normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _classify_canonical_attachment_keys(
    *,
    bucket: str,
    keys: Sequence[str],
    refs_by_key: dict[str, list[dict[str, Any]]],
    object_store: Any,
    now: str | None,
) -> dict[str, list[dict[str, Any]]]:
    now_dt = _parse_optional_timestamp(now, label="now")
    keep: list[dict[str, Any]] = []
    cleanup_candidates: list[dict[str, Any]] = []
    unreferenced_candidates: list[dict[str, Any]] = []
    review_required: list[dict[str, Any]] = []
    for key in keys:
        metadata = object_store.head_object(bucket=bucket, key=key)
        object_row = _object_row_from_head(bucket=bucket, key=key, metadata=metadata)
        ref_rows = refs_by_key.get(key, [])
        if not ref_rows:
            unreferenced_candidates.append(
                {
                    **object_row,
                    "cleanup_reason": "unreferenced_attachment_object",
                }
            )
            continue
        classification = _classify_referenced_canonical_attachment(
            object_row=object_row,
            ref_rows=ref_rows,
            now_dt=now_dt,
            now_required=now is None,
        )
        if classification["classification"] == "keep":
            keep.append(classification)
        elif classification["classification"] == "cleanup_candidate":
            cleanup_candidates.append(classification)
        elif classification["classification"] == "review_required":
            review_required.append(classification)
        else:  # pragma: no cover
            raise ValueError(f"unsupported canonical attachment classification: {classification}")
    return {
        "keep": sorted(keep, key=lambda row: str(row["object_key"])),
        "cleanup_candidates": sorted(
            cleanup_candidates,
            key=lambda row: str(row["object_key"]),
        ),
        "unreferenced_candidates": sorted(
            unreferenced_candidates,
            key=lambda row: str(row["object_key"]),
        ),
        "review_required": sorted(review_required, key=lambda row: str(row["object_key"])),
    }


def _classify_referenced_canonical_attachment(
    *,
    object_row: dict[str, Any],
    ref_rows: list[dict[str, Any]],
    now_dt: datetime | None,
    now_required: bool,
) -> dict[str, Any]:
    ref_summary = _summarize_ref_rows(ref_rows)
    required_values = {_strict_optional_bool(row.get("required_source_object")) for row in ref_rows}
    if None in required_values:
        return {
            **object_row,
            **ref_summary,
            "classification": "review_required",
            "review_reason": "invalid_required_source_object",
        }
    if True in required_values:
        return {
            **object_row,
            **ref_summary,
            "classification": "keep",
            "keep_reason": "required_source_object",
        }
    promotion_states = {
        _normalize_optional_text(row.get("attachment_promotion_state")) for row in ref_rows
    }
    retention_classes = {_normalize_optional_text(row.get("retention_class")) for row in ref_rows}
    if "promoted" in promotion_states or "admitted_source_bytes" in retention_classes:
        return {
            **object_row,
            **ref_summary,
            "classification": "keep",
            "keep_reason": "promoted_or_admitted_source_bytes",
        }
    if retention_classes != {"quarantine_candidate"}:
        return {
            **object_row,
            **ref_summary,
            "classification": "review_required",
            "review_reason": "non_quarantine_retention_contract",
        }
    if any(state in {"promoted", "deleted"} for state in promotion_states):
        return {
            **object_row,
            **ref_summary,
            "classification": "review_required",
            "review_reason": "conflicting_promotion_state",
        }
    expires_values = [_normalize_optional_text(row.get("retention_expires_at")) for row in ref_rows]
    if any(value is None for value in expires_values):
        return {
            **object_row,
            **ref_summary,
            "classification": "review_required",
            "review_reason": "missing_retention_expires_at",
        }
    if now_required:
        return {
            **object_row,
            **ref_summary,
            "classification": "review_required",
            "review_reason": "audit_now_required",
        }
    parsed_expires = [
        _parse_required_timestamp(value, label="retention_expires_at")
        for value in expires_values
        if value is not None
    ]
    latest_expiration = max(parsed_expires)
    if now_dt is None:  # pragma: no cover - guarded by now_required
        raise ValueError("now timestamp is required for expiration classification")
    if latest_expiration > now_dt:
        return {
            **object_row,
            **ref_summary,
            "classification": "keep",
            "keep_reason": "active_quarantine_candidate",
            "latest_retention_expires_at": latest_expiration.isoformat(),
        }
    return {
        **object_row,
        **ref_summary,
        "classification": "cleanup_candidate",
        "cleanup_reason": "expired_quarantine_candidate",
        "latest_retention_expires_at": latest_expiration.isoformat(),
    }


def _summarize_ref_rows(ref_rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "reference_count": len(ref_rows),
        "notice_ids": sorted(
            {
                value
                for row in ref_rows
                for value in [_normalize_optional_text(row.get("notice_id"))]
                if value is not None
            }
        ),
        "attachment_ref_ids": sorted(
            {
                value
                for row in ref_rows
                for value in [_normalize_optional_text(row.get("attachment_ref_id"))]
                if value is not None
            }
        ),
        "attachment_refs_keys": sorted(
            {
                value
                for row in ref_rows
                for value in [_normalize_optional_text(row.get("attachment_refs_key"))]
                if value is not None
            }
        ),
        "retention_classes": sorted(
            {
                value
                for row in ref_rows
                for value in [_normalize_optional_text(row.get("retention_class"))]
                if value is not None
            }
        ),
        "attachment_promotion_states": sorted(
            {
                value
                for row in ref_rows
                for value in [_normalize_optional_text(row.get("attachment_promotion_state"))]
                if value is not None
            }
        ),
    }


def _object_row_from_head(*, bucket: str, key: str, metadata: dict[str, object]) -> dict[str, Any]:
    return {
        "bucket": bucket,
        "object_key": key,
        "byte_size": _coerce_content_length(metadata, label=key),
        "etag": _normalize_optional_text(_read_head_field(metadata, "ETag", "etag")),
    }


def _strict_optional_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _parse_optional_timestamp(value: str | None, *, label: str) -> datetime | None:
    if value is None:
        return None
    return _parse_required_timestamp(value, label=label)


def _parse_required_timestamp(value: str, *, label: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO timestamp") from exc


def _read_head_field(metadata: dict[str, object], *names: str) -> object | None:
    for name in names:
        if name in metadata:
            return metadata[name]
    return None


def _coerce_content_length(metadata: dict[str, object], *, label: str) -> int:
    value = _read_head_field(metadata, "ContentLength", "content_length")
    if value is None:
        raise ValueError(f"{label} missing content length in head_object response")
    return int(value)


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _sum_byte_size(rows: Sequence[dict[str, Any]]) -> int:
    return sum(int(row.get("byte_size") or 0) for row in rows)


def _normalize_attachment_filename(*, original_filename: object, source_object_key: str) -> str:
    value = str(original_filename or "").strip()
    candidate = Path(value).name if value else Path(str(source_object_key)).name
    candidate = candidate.strip().replace("/", "_")
    return candidate or "attachment"


def _build_canonical_attachment_capture_key(
    *,
    corpus: str,
    content_sha256: str,
    filename: str,
    year: str,
) -> str:
    return build_authenticated_notice_attachment_capture_key(
        corpus=corpus,
        content_sha256=content_sha256,
        filename=filename,
        year=year,
    )


def _load_jsonl_rows(payload: bytes) -> tuple[dict[str, Any], ...]:
    text = payload.decode("utf-8").strip()
    if not text:
        return ()
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        rows.append(dict(json.loads(normalized)))
    return tuple(rows)


def _write_jsonl(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    payload = audit_authenticated_notice_source_attachment_keys(
        corpus=args.corpus,
        collection=args.collection,
        output_dir=Path(args.output_dir),
        source_projections_path=(
            Path(args.source_projections_path) if args.source_projections_path else None
        ),
        notice_ids=tuple(args.notice_ids),
        now=args.now,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = [
    "CANONICAL_ATTACHMENT_OBJECT_KEY_RE",
    "LEGACY_ATTACHMENT_OBJECT_KEY_RE",
    "audit_authenticated_notice_source_attachment_keys",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
