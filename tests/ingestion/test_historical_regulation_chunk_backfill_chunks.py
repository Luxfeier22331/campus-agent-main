from __future__ import annotations

import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

from campus_ingestion_core.historical_regulation_chunk_backfill import (
    prepare_historical_regulation_chunk_backfill_chunks,
)
from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class HistoricalRegulationChunkBackfillChunksTest(unittest.TestCase):
    def test_prepares_only_admitted_targets_without_release_side_effects(self) -> None:
        institutional = _record(
            document_id="institutional_regulation:muc:社团管理办法:aaaa",
            collection="institutional_rules",
            units_key="regulations/documents/institutional_rules/a/document-units.jsonl",
        )
        scoped = _record(
            document_id="institutional_regulation:muc:研究生三助办法:bbbb",
            collection="scoped_rules",
            units_key="regulations/documents/scoped_rules/b/document-units.jsonl",
        )
        rejected = _record(
            document_id="institutional_regulation:muc:rejected:cccc",
            collection="scoped_rules",
            units_key="regulations/documents/scoped_rules/c/document-units.jsonl",
        )
        institutional_prepare = Mock(
            return_value=_PrepReport(
                prepared_document_count=1,
                total_unit_count=4,
                total_chunk_count=3,
                passed=True,
                manifest_path="institutional_rules/chunk-prep-manifest.json",
                validation_summary_path="institutional_rules/validation-summary.json",
                document_reports_path="institutional_rules/document-reports.jsonl",
            )
        )
        scoped_prepare = Mock(
            return_value=_PrepReport(
                prepared_document_count=1,
                total_unit_count=5,
                total_chunk_count=4,
                passed=True,
                manifest_path="scoped_rules/chunk-prep-manifest.json",
                validation_summary_path="scoped_rules/validation-summary.json",
                document_reports_path="scoped_rules/document-reports.jsonl",
            )
        )

        with TemporaryDirectory() as temp_dir:
            evidence = prepare_historical_regulation_chunk_backfill_chunks(
                classification_report=_classification_report(
                    institutional=institutional,
                    scoped=scoped,
                    rejected=rejected,
                ),
                canonical_preflight=_canonical_preflight(
                    institutional=institutional,
                    scoped=scoped,
                    rejected=rejected,
                ),
                registry=InMemoryDocumentRegistry((institutional, scoped, rejected)),
                object_store=object(),
                output_dir=Path(temp_dir),
                bucket_derived="campus-rag-derived",
                preparation_run_id_prefix="hist-reg",
                prepare_institutional_chunks=institutional_prepare,
                prepare_scoped_chunks=scoped_prepare,
                generated_at="2026-05-02T00:00:00+00:00",
            )

        batch = evidence["chunk_preparation_batch_report"]
        self.assertEqual(batch["target_count"], 2)
        self.assertEqual(batch["document_site_eligible_count"], 1)
        self.assertEqual(batch["rag_consumption_eligible_count"], 1)
        self.assertEqual(batch["prepared_document_count"], 2)
        self.assertEqual(batch["total_chunk_count"], 7)
        self.assertEqual(batch["overall_verdict"], "passed")
        self.assertEqual(
            [item["target_collection"] for item in batch["collections"]],
            ["institutional_rules", "scoped_rules"],
        )
        self.assertEqual(
            evidence["serving_closed_assertion"]["candidate_enqueue_opened"],
            False,
        )
        self.assertEqual(evidence["serving_closed_assertion"]["embedding_opened"], False)
        self.assertEqual(evidence["serving_closed_assertion"]["alias_publish_opened"], False)
        self.assertEqual(
            evidence["candidate_store_noop_assertion"]["candidate_store_mutated"],
            False,
        )
        institutional_records = institutional_prepare.call_args.kwargs["records"]
        scoped_records = scoped_prepare.call_args.kwargs["records"]
        self.assertEqual(
            [record.document_id for record in institutional_records], [institutional.document_id]
        )
        self.assertEqual([record.document_id for record in scoped_records], [scoped.document_id])


@dataclass(frozen=True, slots=True)
class _PrepReport:
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    passed: bool
    manifest_path: str
    validation_summary_path: str
    document_reports_path: str


def _classification_report(
    *,
    institutional: DocumentRegistryRecord,
    scoped: DocumentRegistryRecord,
    rejected: DocumentRegistryRecord,
) -> dict[str, object]:
    return {
        "records": [
            _classification_record(institutional, classification="admit_to_chunk"),
            _classification_record(scoped, classification="admit_to_chunk"),
            _classification_record(rejected, classification="reject"),
        ]
    }


def _classification_record(
    record: DocumentRegistryRecord,
    *,
    classification: str,
) -> dict[str, object]:
    is_downstream_eligible = record.collection == "institutional_rules"
    return {
        "target_collection": record.collection,
        "target_document_id": record.document_id,
        "classification": classification,
        "reason_codes": ["ready_for_chunk_preparation"],
        "document_site_eligible": is_downstream_eligible,
        "rag_consumption_eligible": is_downstream_eligible,
        "downstream_consumption_status": (
            "eligible_after_release_gate" if is_downstream_eligible else "chunk_only_non_serving"
        ),
    }


def _canonical_preflight(
    *,
    institutional: DocumentRegistryRecord,
    scoped: DocumentRegistryRecord,
    rejected: DocumentRegistryRecord,
) -> dict[str, object]:
    return {
        "records": [
            _preflight_record(institutional, verdict="passed"),
            _preflight_record(scoped, verdict="passed"),
            _preflight_record(rejected, verdict="failed"),
        ]
    }


def _preflight_record(
    record: DocumentRegistryRecord,
    *,
    verdict: str,
) -> dict[str, object]:
    return {
        "target_collection": record.collection,
        "target_document_id": record.document_id,
        "version_id": record.version_id,
        "content_hash": record.content_hash,
        "document_units_object_key": record.document_units_object_key,
        "canonical_markdown_object_key": record.canonical_markdown_object_key,
        "verdict": verdict,
        "issues": [] if verdict == "passed" else ["normalization_quality_not_passed"],
    }


def _record(
    *,
    document_id: str,
    collection: str,
    units_key: str,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"sha256:{document_id[-4:]}:effective-undated:revision-none",
        source_uri=f"authenticated_notice:policy-regulation:{document_id}",
        content_hash=f"{document_id[-4:]}" * 16,
        corpus="regulations",
        collection=collection,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-05-02T00:00:00+00:00",
        parser_version="test-parser-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        import_source="test",
    )


if __name__ == "__main__":
    unittest.main()
