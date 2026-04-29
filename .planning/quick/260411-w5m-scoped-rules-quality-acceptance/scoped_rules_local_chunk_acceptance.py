from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import shutil
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry, InMemoryRawAssetRegistry
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    prepare_scoped_rule_chunks,
)
from campus_ingestion_core.internal_notice_scoped_rule_materialization import (
    materialize_scoped_rules_from_internal_notice_scope,
)


_SOURCE_DOCUMENTS_JSON = Path(
    ".tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/documents.json"
)
_SOURCE_OBJECT_STORE_ROOT = Path(
    ".tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/object-store"
)
_SOURCE_INVENTORY_JSON = Path(
    ".planning/quick/260411-rho-institutional-regulations-promotion-adju/cohort-a-rebuilt-source-truth-inventory.json"
)
_DUMMY_ENV = {
    "OBJECT_STORE_ENDPOINT": "http://local.test",
    "OBJECT_STORE_ACCESS_KEY": "local",
    "OBJECT_STORE_SECRET_KEY": "local",
    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
}


class LocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        target = self.root / bucket / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def main() -> None:
    output_dir = Path(__file__).resolve().parent
    isolated_root = output_dir / "object-store-snapshot"
    if isolated_root.exists():
        shutil.rmtree(isolated_root)
    shutil.copytree(_SOURCE_OBJECT_STORE_ROOT, isolated_root)

    source_registry = InMemoryDocumentRegistry.from_json_file(_SOURCE_DOCUMENTS_JSON)
    registry = InMemoryDocumentRegistry(
        source_registry.list_by_scope("campus_notices", "internal_notice"),
        backing_path=output_dir / "scoped-rules-materialized-documents.json",
    )
    raw_asset_registry = InMemoryRawAssetRegistry(
        (),
        backing_path=output_dir / "scoped-rules-materialized-raw-assets.json",
    )
    inventory_store = _load_inventory_store(_SOURCE_INVENTORY_JSON)
    object_store = LocalFilesystemObjectStore(isolated_root)

    materialization_report = materialize_internal_notice_scoped_rules(
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=inventory_store,
        object_store=object_store,
    )
    (output_dir / "scoped-rules-materialization-report.json").write_text(
        json.dumps(asdict(materialization_report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    scoped_records = registry.list_by_scope("regulations", "scoped_rules")
    chunk_output_dir = output_dir / "scoped-rules-chunk-prep"
    if chunk_output_dir.exists():
        shutil.rmtree(chunk_output_dir)
    chunk_report = prepare_scoped_rule_chunks(
        records=scoped_records,
        object_store=object_store,
        output_dir=chunk_output_dir,
    )
    validation = json.loads(
        Path(chunk_report.validation_summary_path).read_text(encoding="utf-8")
    )
    document_reports = [
        json.loads(line)
        for line in Path(chunk_report.document_reports_path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    summary = {
        "schema_version": "scoped_rules_local_chunk_acceptance_v1",
        "source_documents_json": str(_SOURCE_DOCUMENTS_JSON),
        "source_inventory_json": str(_SOURCE_INVENTORY_JSON),
        "source_object_store_root": str(_SOURCE_OBJECT_STORE_ROOT),
        "isolated_object_store_root": str(isolated_root),
        "scoped_rule_candidate_count": materialization_report.scoped_rule_candidate_count,
        "materialized_document_count": materialization_report.materialized_document_count,
        "document_nature_counts": materialization_report.document_nature_counts,
        "prepared_document_count": chunk_report.prepared_document_count,
        "total_unit_count": chunk_report.total_unit_count,
        "total_chunk_count": chunk_report.total_chunk_count,
        "hard_gate_passed": bool(validation["passed"]),
        "short_body_chunk_count": int(validation["short_body_chunk_count"]),
        "failed_document_ids": list(validation["failed_document_ids"]),
        "operator_rule": (
            "Use an isolated snapshot root for local-only scoped_rules acceptance; "
            "do not write target-side acceptance artifacts back into the long-lived "
            "historical local-smoke object-store root."
        ),
        "document_reports": [
            {
                "target_document_id": report["target_document_id"],
                "document_nature": report["document_nature"],
                "source_notice_ids": report["source_notice_ids"],
                "chunk_count": report["chunk_count"],
                "short_body_chunk_count": report["short_body_chunk_count"],
                "passed": report["passed"],
            }
            for report in document_reports
        ],
    }
    (output_dir / "scoped-rules-chunk-acceptance-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "scoped-rules-chunk-acceptance.md").write_text(
        _render_markdown_summary(summary),
        encoding="utf-8",
    )


def materialize_internal_notice_scoped_rules(
    *,
    registry: InMemoryDocumentRegistry,
    raw_asset_registry: InMemoryRawAssetRegistry,
    source_truth_inventory_store: InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    object_store: LocalFilesystemObjectStore,
):
    return materialize_scoped_rules_from_internal_notice_scope(
        request=InternalNoticeRegulationPromotionRequest(),
        env=_DUMMY_ENV,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=source_truth_inventory_store,
        object_store=object_store,
    )


def _load_inventory_store(path: Path) -> InMemoryAuthenticatedNoticeSourceTruthInventoryStore:
    store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.values() if isinstance(payload, dict) else payload
    store.upsert_many(
        tuple(
            AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(dict(row))
            for row in rows
        )
    )
    return store


def _render_markdown_summary(summary: dict[str, Any]) -> str:
    document_rows = "\n".join(
        f"| `{row['target_document_id']}` | `{row['document_nature']}` | `{','.join(row['source_notice_ids'])}` | `{row['chunk_count']}` | `{row['short_body_chunk_count']}` | `{row['passed']}` |"
        for row in summary["document_reports"]
    )
    return (
        "# Scoped Rules Local Chunk Acceptance\n\n"
        "## Outcome\n\n"
        f"- scoped-rule candidates: `{summary['scoped_rule_candidate_count']}`\n"
        f"- materialized documents: `{summary['materialized_document_count']}`\n"
        f"- prepared documents: `{summary['prepared_document_count']}`\n"
        f"- total chunks: `{summary['total_chunk_count']}`\n"
        f"- hard gate passed: `{summary['hard_gate_passed']}`\n"
        f"- short body chunks: `{summary['short_body_chunk_count']}`\n\n"
        "## Operator Rule\n\n"
        f"- {summary['operator_rule']}\n\n"
        "## Document Reports\n\n"
        "| target_document_id | document_nature | source_notice_ids | chunk_count | short_body_chunk_count | passed |\n"
        "| --- | --- | --- | --- | --- | --- |\n"
        f"{document_rows}\n"
    )


if __name__ == "__main__":
    main()
