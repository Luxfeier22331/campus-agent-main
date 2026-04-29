from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import shutil
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.internal_notice_chunking_validation import (
    DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED,
    _chunk_unit_type,
    _contains_markup_leak,
    _document_has_stable_title_source,
    _is_fragmented_notice_body_chunk,
    _resolve_display_text,
    build_internal_notice_chunking_validation_report,
    export_internal_notice_chunk_samples,
    scan_internal_notice_chunking,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED, DEFAULT_BUCKET_SOURCE


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_LOCAL_SMOKE_ROOT = (
    REPO_ROOT / ".tmp" / "historical-intake" / "run14-policy-regulation-expanded" / "local-smoke"
)
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent
DEFAULT_NOTICE_ID = "187233"
DEFAULT_DOCUMENT_ID = "notice:muc_internal_portal:187233"


class LocalSmokeObjectStore:
    def __init__(self, local_smoke_root: Path) -> None:
        self._root = Path(local_smoke_root) / "object-store"

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self._resolve(bucket=bucket, key=key).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        target = self._resolve(bucket=bucket, key=key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def _resolve(self, *, bucket: str, key: str) -> Path:
        return self._root / bucket / Path(key)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a local-only single-document internal_notice chunk-prep pilot for notice 187233."
    )
    parser.add_argument("--notice-id", default=DEFAULT_NOTICE_ID)
    parser.add_argument("--document-id", default=DEFAULT_DOCUMENT_ID)
    parser.add_argument("--local-smoke-root", type=Path, default=DEFAULT_LOCAL_SMOKE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--sample-seed", type=int, default=DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    local_smoke_root = args.local_smoke_root.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    registry = _load_registry(
        local_smoke_root=local_smoke_root,
        document_id=args.document_id,
        notice_id=args.notice_id,
    )
    inventory_store = _load_inventory_store(
        local_smoke_root=local_smoke_root,
        notice_id=args.notice_id,
    )
    object_store = LocalSmokeObjectStore(local_smoke_root)
    scan_result = scan_internal_notice_chunking(
        env={
            "OBJECT_STORE_BUCKET_SOURCE": DEFAULT_BUCKET_SOURCE,
            "OBJECT_STORE_BUCKET_DERIVED": DEFAULT_BUCKET_DERIVED,
            "INTERNAL_NOTICE_CHUNK_VALIDATION_MAX_WORKERS": "1",
        },
        registry=registry,
        object_store=object_store,
        source_truth_inventory_store=inventory_store,
        mode="full",
        sample_seed=args.sample_seed,
    )
    if len(scan_result.documents) != 1:
        raise ValueError(f"expected one scanned document, found {len(scan_result.documents)}")
    document = scan_result.documents[0]
    report = build_internal_notice_chunking_validation_report(scan_result=scan_result)

    sample_dir = output_dir / "187233-sample-export"
    shutil.rmtree(sample_dir, ignore_errors=True)
    export_internal_notice_chunk_samples(
        output_dir=sample_dir,
        registry=registry,
        object_store=object_store,
        source_truth_inventory_store=inventory_store,
        scan_result=scan_result,
        report=report,
        sample_seed=args.sample_seed,
    )

    chunk_catalog = _build_chunk_catalog(document=document)
    issue_flags = _collect_issue_flags(document=document)
    summary_payload = {
        "notice_id": args.notice_id,
        "document_id": document.record.document_id,
        "title": document.title,
        "lane": document.lane,
        "local_only": True,
        "writes_postgres": False,
        "writes_qdrant": False,
        "writes_embeddings": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "local_smoke_root": _relative_or_absolute(local_smoke_root),
        "sample_directory": _relative_or_absolute(sample_dir),
        "readiness_verdict": "ready_for_chunk_prep" if report.passed else "needs_fix",
        "issue_flags": issue_flags,
        "chunk_count": len(chunk_catalog),
        "chunk_ids": [entry["chunk_id"] for entry in chunk_catalog],
        "report": asdict(report),
    }

    (output_dir / "187233-pilot-summary.json").write_text(
        json.dumps(summary_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "187233-chunk-catalog.json").write_text(
        json.dumps(chunk_catalog, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "187233-chunk-preview.md").write_text(
        _render_chunk_preview(document=document, chunk_catalog=chunk_catalog, issue_flags=issue_flags),
        encoding="utf-8",
    )


def _load_registry(
    *,
    local_smoke_root: Path,
    document_id: str,
    notice_id: str,
) -> InMemoryDocumentRegistry:
    full_registry = InMemoryDocumentRegistry.from_json_file(
        local_smoke_root / "registry" / "documents.json"
    )
    selected_records = tuple(
        record
        for record in full_registry.list_by_scope("campus_notices", "internal_notice")
        if record.document_id == document_id
    )
    if len(selected_records) != 1:
        raise ValueError(f"expected one record for {document_id}, found {len(selected_records)}")
    if _notice_id_from_document_id(selected_records[0].document_id) != notice_id:
        raise ValueError(
            f"document {selected_records[0].document_id} does not match notice_id {notice_id}"
        )
    return InMemoryDocumentRegistry(selected_records)


def _load_inventory_store(
    *,
    local_smoke_root: Path,
    notice_id: str,
) -> InMemoryAuthenticatedNoticeSourceTruthInventoryStore:
    payload = _read_json(local_smoke_root / "registry" / "source-truth-inventory.json")
    rows = list(payload.values()) if isinstance(payload, dict) else list(payload)
    selected_rows = [
        AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row))
        for row in rows
        if str(row.get("notice_id") or "").strip() == notice_id
    ]
    if len(selected_rows) != 1:
        raise ValueError(f"expected one inventory row for notice_id {notice_id}, found {len(selected_rows)}")
    store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    store.upsert_many(tuple(selected_rows))
    return store


def _build_chunk_catalog(*, document) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for chunk in document.chunks:
        display_text = _resolve_display_text(chunk)
        catalog.append(
            {
                "chunk_id": chunk.chunk_id,
                "chunk_order": chunk.chunk_order,
                "unit_type": _chunk_unit_type(chunk),
                "char_count": len(chunk.text),
                "display_char_count": len(display_text),
                "anchor": chunk.anchor,
                "metadata": {
                    "title": chunk.metadata.get("title"),
                    "contextualized_text": chunk.metadata.get("contextualized_text"),
                    "header_path": chunk.metadata.get("header_path"),
                    "chunk_policy_version": chunk.metadata.get("chunk_policy_version"),
                    "source_unit_types": chunk.metadata.get("source_unit_types"),
                },
                "text": chunk.text,
                "display_text": display_text,
            }
        )
    return catalog


def _collect_issue_flags(*, document) -> list[str]:
    flags: set[str] = set()
    if document.read_failure is not None:
        flags.add(f"read_failure:{document.read_failure.error}")
        return sorted(flags)
    if document.chunk_failure is not None:
        flags.add(f"chunk_failure:{document.chunk_failure.error}")
        return sorted(flags)

    has_stable_title_source = _document_has_stable_title_source(document.rows)
    if not document.chunks:
        flags.add("empty_document")
    for chunk in document.chunks:
        unit_type = _chunk_unit_type(chunk)
        if unit_type not in {"article_body", "attachment_body", "section_text", "table_unit"}:
            continue
        if not has_stable_title_source:
            flags.add("missing_title_source")
        if not bool(chunk.metadata.get("contextualized_text")):
            flags.add("missing_contextualized_text")
        if document.lane == "notice_body" and _is_fragmented_notice_body_chunk(
            chunk=chunk,
            document_chunk_count=len(document.chunks),
        ):
            flags.add("notice_body_fragmentation")
        display_text = _resolve_display_text(chunk)
        if _contains_markup_leak(chunk.text) or _contains_markup_leak(display_text):
            flags.add("markup_leakage")
    return sorted(flags)


def _render_chunk_preview(*, document, chunk_catalog: list[dict[str, Any]], issue_flags: list[str]) -> str:
    lines = [
        "# 187233 Local-Only Chunk Prep Pilot Preview",
        "",
        f"- Title: `{document.title}`",
        f"- Document id: `{document.record.document_id}`",
        f"- Lane: `{document.lane}`",
        f"- Chunk count: `{len(chunk_catalog)}`",
        f"- Issue flags: `{', '.join(issue_flags) if issue_flags else 'none'}`",
        "",
        "## Chunks",
        "",
    ]
    for entry in chunk_catalog:
        lines.extend(
            [
                f"### Chunk {entry['chunk_order']}",
                "",
                f"- Chunk id: `{entry['chunk_id']}`",
                f"- Unit type: `{entry['unit_type']}`",
                f"- Char count: `{entry['char_count']}`",
                f"- Display char count: `{entry['display_char_count']}`",
                f"- Anchor: `{json.dumps(entry['anchor'], ensure_ascii=False)}`",
                f"- Metadata: `{json.dumps(entry['metadata'], ensure_ascii=False)}`",
                "",
                "```text",
                str(entry["display_text"]),
                "```",
                "",
            ]
        )
    return "\n".join(lines) + "\n"


def _notice_id_from_document_id(document_id: str) -> str:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) >= 3 and parts[2]:
        return parts[2]
    raise ValueError(f"unable to resolve notice id from document_id: {document_id}")


def _read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _relative_or_absolute(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
