from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any, Sequence

from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_attachment_capture_key,
)
from campus_ingestion_core.object_store import parse_source_object_key
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_worker.env_bootstrap import load_worker_env


LEGACY_ATTACHMENT_OBJECT_KEY_RE = re.compile(r"^[0-9a-f]{2}/[0-9a-f]{64}/[^/]+$")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit authenticated notice source attachment legacy object keys"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-projections-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    return parser


def audit_authenticated_notice_source_attachment_keys(
    *,
    corpus: str,
    collection: str,
    output_dir: Path,
    source_projections_path: Path | None = None,
    notice_ids: Sequence[str] = (),
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
            if not _is_legacy_attachment_object_key(object_key):
                continue
            referenced_keys.add(object_key)
            content_sha256 = str(row.get("content_sha256") or "").strip()
            original_filename = _normalize_attachment_filename(
                original_filename=row.get("original_filename"),
                fallback_key=object_key,
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
    all_legacy_keys = sorted(key for key in all_source_keys if _is_legacy_attachment_object_key(key))
    unreferenced_rows = [
        {"legacy_object_key": key}
        for key in all_legacy_keys
        if key not in referenced_keys
    ]

    output_dir.mkdir(parents=True, exist_ok=True)
    referenced_path = output_dir / "referenced-legacy-keys.jsonl"
    unreferenced_path = output_dir / "unreferenced-legacy-keys.jsonl"
    mapping_path = output_dir / "legacy-to-canonical-mapping.jsonl"
    summary_path = output_dir / "summary.json"
    _write_jsonl(referenced_path, referenced_rows)
    _write_jsonl(unreferenced_path, unreferenced_rows)
    _write_jsonl(mapping_path, mapping_rows)

    summary = {
        "corpus": corpus,
        "collection": collection,
        "selected_notice_ids": list(_normalize_notice_ids(notice_ids)),
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
        "output_dir": str(output_dir),
        "referenced_inventory_path": str(referenced_path),
        "unreferenced_inventory_path": str(unreferenced_path),
        "mapping_inventory_path": str(mapping_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def _normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _is_legacy_attachment_object_key(value: str) -> bool:
    return bool(LEGACY_ATTACHMENT_OBJECT_KEY_RE.fullmatch(str(value or "").strip()))


def _normalize_attachment_filename(*, original_filename: object, fallback_key: str) -> str:
    value = str(original_filename or "").strip()
    candidate = Path(value).name if value else Path(str(fallback_key)).name
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
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = [
    "LEGACY_ATTACHMENT_OBJECT_KEY_RE",
    "audit_authenticated_notice_source_attachment_keys",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
