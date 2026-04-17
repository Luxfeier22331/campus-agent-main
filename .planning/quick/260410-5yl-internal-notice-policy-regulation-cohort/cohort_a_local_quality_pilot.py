from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import asdict
import hashlib
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
DEFAULT_COHORT_MANIFEST = Path(__file__).with_name("run14-policy-regulation-cohorts.json")
DEFAULT_LOCAL_SMOKE_ROOT = (
    REPO_ROOT / ".tmp" / "historical-intake" / "run14-policy-regulation-expanded" / "local-smoke"
)
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent


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
        description="Run a local-only Cohort A quality pilot over run14 internal-notice local-smoke artifacts."
    )
    parser.add_argument(
        "--cohort-manifest",
        type=Path,
        default=DEFAULT_COHORT_MANIFEST,
    )
    parser.add_argument(
        "--local-smoke-root",
        type=Path,
        default=DEFAULT_LOCAL_SMOKE_ROOT,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
    )
    parser.add_argument(
        "--sample-seed",
        type=int,
        default=DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cohort_manifest = _read_json(args.cohort_manifest)
    notice_ids = list(cohort_manifest["cohorts"]["A"]["notice_ids"])
    local_smoke_root = args.local_smoke_root.resolve()
    output_dir = args.output_dir.resolve()
    registry = _load_cohort_registry(local_smoke_root=local_smoke_root, notice_ids=notice_ids)
    inventory_store = _load_inventory_store(local_smoke_root=local_smoke_root, notice_ids=notice_ids)
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
    report = build_internal_notice_chunking_validation_report(scan_result=scan_result)
    samples_dir = output_dir / "cohort-a-samples"
    shutil.rmtree(samples_dir, ignore_errors=True)
    export_internal_notice_chunk_samples(
        output_dir=samples_dir,
        registry=registry,
        object_store=object_store,
        source_truth_inventory_store=inventory_store,
        scan_result=scan_result,
        report=report,
        sample_seed=args.sample_seed,
    )
    sample_index = _read_json(samples_dir / "samples.json")
    duplicate_source_observations = _build_duplicate_source_observations(scan_result.documents, object_store)
    notice_issue_map = _collect_notice_issues(scan_result.documents)
    cleanup_attention_notice_ids = sorted(
        notice_id for notice_id, issues in notice_issue_map.items() if issues
    )
    verdict = "ready_for_chunk_prep" if report.passed else "needs_fix"
    summary_payload = {
        "cohort": "A",
        "batch_id": str(cohort_manifest["batch_id"]),
        "local_only": True,
        "writes_postgres": False,
        "writes_qdrant": False,
        "writes_embeddings": False,
        "writes_release_manifests": False,
        "writes_aliases": False,
        "notice_count": len(notice_ids),
        "notice_ids": notice_ids,
        "local_smoke_root": _relative_or_absolute(local_smoke_root),
        "sample_directory": _relative_or_absolute(samples_dir),
        "sample_files": list(sample_index["sample_files"]),
        "selection_mode": report.selection_mode,
        "readiness_verdict": verdict,
        "cleanup_attention_notice_ids": cleanup_attention_notice_ids,
        "notice_issue_map": notice_issue_map,
        "duplicate_source_observations": duplicate_source_observations,
        "report": asdict(report),
    }
    (output_dir / "cohort-a-validation-summary.json").write_text(
        json.dumps(summary_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "cohort-a-quality-summary.md").write_text(
        _render_quality_summary(
            verdict=verdict,
            report=summary_payload["report"],
            notice_ids=notice_ids,
            sample_directory=summary_payload["sample_directory"],
            duplicate_source_observations=duplicate_source_observations,
            cleanup_attention_notice_ids=cleanup_attention_notice_ids,
            notice_issue_map=notice_issue_map,
        ),
        encoding="utf-8",
    )


def _load_cohort_registry(
    *,
    local_smoke_root: Path,
    notice_ids: list[str],
) -> InMemoryDocumentRegistry:
    full_registry = InMemoryDocumentRegistry.from_json_file(
        local_smoke_root / "registry" / "documents.json"
    )
    selected_records = tuple(
        record
        for record in full_registry.list_by_scope("campus_notices", "internal_notice")
        if record.document_id.startswith("notice:")
        and _notice_id_from_document_id(record.document_id) in set(notice_ids)
    )
    selected_notice_ids = {
        _notice_id_from_document_id(record.document_id) for record in selected_records
    }
    missing_notice_ids = [notice_id for notice_id in notice_ids if notice_id not in selected_notice_ids]
    if missing_notice_ids:
        raise ValueError(f"missing cohort A records in local-smoke registry: {missing_notice_ids}")
    return InMemoryDocumentRegistry(selected_records)


def _load_inventory_store(
    *,
    local_smoke_root: Path,
    notice_ids: list[str],
) -> InMemoryAuthenticatedNoticeSourceTruthInventoryStore:
    payload = _read_json(local_smoke_root / "registry" / "source-truth-inventory.json")
    rows = list(payload.values()) if isinstance(payload, dict) else list(payload)
    selected_rows = [
        AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row))
        for row in rows
        if str(row.get("notice_id") or "").strip() in set(notice_ids)
    ]
    selected_notice_ids = sorted({row.notice_id for row in selected_rows})
    if selected_notice_ids != sorted(notice_ids):
        raise ValueError(
            "missing cohort A source-truth inventory rows: "
            f"{sorted(set(notice_ids) - set(selected_notice_ids))}"
        )
    store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    store.upsert_many(tuple(selected_rows))
    return store


def _build_duplicate_source_observations(documents, object_store: LocalSmokeObjectStore) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for document in documents:
        if document.read_failure is not None:
            continue
        canonical_hash = _hash_bytes(
            object_store.get_bytes(
                bucket=DEFAULT_BUCKET_DERIVED,
                key=str(document.record.canonical_markdown_object_key),
            )
        )
        groups[document.title].append(
            {
                "notice_id": document.notice_id,
                "document_id": document.record.document_id,
                "content_hash": document.record.content_hash,
                "canonical_markdown_hash": canonical_hash,
                "chunk_count": len(document.chunks),
            }
        )
    observations: list[dict[str, Any]] = []
    for title, entries in sorted(groups.items()):
        if len(entries) < 2:
            continue
        observations.append(
            {
                "title": title,
                "notice_ids": [entry["notice_id"] for entry in entries],
                "content_hashes": [entry["content_hash"] for entry in entries],
                "canonical_markdown_hashes": [entry["canonical_markdown_hash"] for entry in entries],
                "same_content_hash": len({entry["content_hash"] for entry in entries}) == 1,
                "same_canonical_markdown": len(
                    {entry["canonical_markdown_hash"] for entry in entries}
                )
                == 1,
                "chunk_counts": {entry["notice_id"]: entry["chunk_count"] for entry in entries},
            }
        )
    return observations


def _collect_notice_issues(documents) -> dict[str, list[str]]:
    issues: dict[str, set[str]] = defaultdict(set)
    for document in documents:
        notice_id = document.notice_id
        if document.read_failure is not None:
            issues[notice_id].add(f"read_failure:{document.read_failure.error}")
            continue
        if document.chunk_failure is not None:
            issues[notice_id].add(f"chunk_failure:{document.chunk_failure.error}")
            continue
        has_stable_title_source = _document_has_stable_title_source(document.rows)
        if not document.chunks:
            issues[notice_id].add("empty_document")
        for chunk in document.chunks:
            unit_type = _chunk_unit_type(chunk)
            if unit_type not in {"article_body", "attachment_body", "section_text", "table_unit"}:
                continue
            if not has_stable_title_source:
                issues[notice_id].add("missing_title_source")
            if not bool(chunk.metadata.get("contextualized_text")):
                issues[notice_id].add("missing_contextualized_text")
            if document.lane == "notice_body" and _is_fragmented_notice_body_chunk(
                chunk=chunk,
                document_chunk_count=len(document.chunks),
            ):
                issues[notice_id].add("notice_body_fragmentation")
            display_text = _resolve_display_text(chunk)
            if _contains_markup_leak(chunk.text) or _contains_markup_leak(display_text):
                issues[notice_id].add("markup_leakage")
        issues.setdefault(notice_id, set())
    return {notice_id: sorted(values) for notice_id, values in sorted(issues.items())}


def _render_quality_summary(
    *,
    verdict: str,
    report: dict[str, Any],
    notice_ids: list[str],
    sample_directory: str,
    duplicate_source_observations: list[dict[str, Any]],
    cleanup_attention_notice_ids: list[str],
    notice_issue_map: dict[str, list[str]],
) -> str:
    lines = [
        "# Cohort A Local Quality Summary",
        "",
        f"- Verdict: `{verdict}`",
        f"- Notice count: `{len(notice_ids)}`",
        f"- Notice ids: `{', '.join(notice_ids)}`",
        f"- Local-only pilot: `true`",
        f"- Sample evidence dir: `{sample_directory}`",
        "",
        "## Quality Signals",
        "",
        f"- Missing title/context counts: `missing_title_chunk_count={report['missing_title_chunk_count']}`, `missing_contextualization_count={report['missing_contextualization_count']}`",
        f"- Notice-body fragmentation count: `notice_body_fragmentation_count={report['notice_body_fragmentation_count']}`",
        f"- Markup leakage count: `markup_leak_chunk_count={report['markup_leak_chunk_count']}`",
        f"- Missing lane metadata count: `missing_lane_metadata_count={report['missing_lane_metadata_count']}`",
        f"- Read failures: `{len(report['read_failures'])}`; chunk failures: `{len(report['chunk_failures'])}`; empty documents: `{len(report['empty_document_ids'])}`",
        f"- Total units/chunks: `total_units={report['total_units']}`, `total_chunks={report['total_chunks']}`",
        "",
        "## Duplicate Source Observations",
        "",
    ]
    if duplicate_source_observations:
        for observation in duplicate_source_observations:
            lines.append(
                "- "
                + f"`{' / '.join(observation['notice_ids'])}` share title "
                + f"`{observation['title']}`; "
                + f"`same_content_hash={str(observation['same_content_hash']).lower()}`, "
                + f"`same_canonical_markdown={str(observation['same_canonical_markdown']).lower()}`, "
                + f"`chunk_counts={observation['chunk_counts']}`"
            )
    else:
        lines.append("- None")
    lines.extend(
        [
            "",
            "## Cleanup Attention",
            "",
        ]
    )
    if cleanup_attention_notice_ids:
        lines.append(f"- Notice ids needing cleanup attention: `{', '.join(cleanup_attention_notice_ids)}`")
        for notice_id in cleanup_attention_notice_ids:
            lines.append(f"- `{notice_id}` -> `{', '.join(notice_issue_map[notice_id])}`")
    else:
        lines.append("- No notice ids currently require cleanup attention under the chunking validator rules.")
    return "\n".join(lines) + "\n"


def _notice_id_from_document_id(document_id: str) -> str:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) >= 3 and parts[2]:
        return parts[2]
    raise ValueError(f"unable to resolve notice id from document_id: {document_id}")


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _relative_or_absolute(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
