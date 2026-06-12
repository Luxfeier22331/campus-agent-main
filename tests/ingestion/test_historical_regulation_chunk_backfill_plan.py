from __future__ import annotations

import hashlib
import unittest

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_historical_regulation_chunk_backfill_evidence,
)
from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class HistoricalRegulationChunkBackfillPlanTest(unittest.TestCase):
    def test_builds_chunk_only_evidence_without_release_side_effects(self) -> None:
        canonical = b"# Central regulation\n\nArticle one."
        units = b'{"unit_type":"article","text":"Article one."}\n'
        record = self._record(
            document_id="institutional_regulation:muc:rule:abc123",
            collection="institutional_rules",
            content_hash=hashlib.sha256(canonical).hexdigest(),
            canonical_key="regulations/documents/institutional_rules/rule/canonical.md",
            units_key="regulations/documents/institutional_rules/rule/document-units.jsonl",
        )

        evidence = build_historical_regulation_chunk_backfill_evidence(
            phase13_report={"selected_notice_ids": ["619"]},
            materialization_reports={
                "manual-review": {
                    "materialized_documents": [
                        self._materialized_document(
                            notice_id="619",
                            collection="institutional_rules",
                            document_id=record.document_id,
                            content_hash=record.content_hash,
                            canonical_key=record.canonical_markdown_object_key,
                            canonical_sha256=hashlib.sha256(canonical).hexdigest(),
                            units_key=record.document_units_object_key,
                            units_sha256=hashlib.sha256(units).hexdigest(),
                        )
                    ]
                }
            },
            registry=InMemoryDocumentRegistry((record,)),
            object_store=_FakeObjectStore(
                {
                    record.canonical_markdown_object_key: canonical,
                    record.document_units_object_key: units,
                }
            ),
            bucket_derived="campus-rag-derived",
            preparation_run_id_prefix="phase0",
        )

        self.assertEqual(evidence["target_inventory"]["target_count"], 1)
        self.assertEqual(evidence["classification_report"]["status_counts"], {"admit_to_chunk": 1})
        preflight = evidence["canonical_provenance_preflight"]
        self.assertEqual(preflight["overall_verdict"], "passed")
        self.assertEqual(preflight["records"][0]["verdict"], "passed")
        self.assertEqual(evidence["serving_closed_assertion"]["candidate_enqueue_opened"], False)
        self.assertEqual(evidence["serving_closed_assertion"]["embedding_opened"], False)
        self.assertEqual(evidence["serving_closed_assertion"]["alias_publish_opened"], False)
        self.assertEqual(
            evidence["candidate_store_noop_assertion"]["candidate_store_mutated"],
            False,
        )
        self.assertIn(
            "campus_ingestion_worker.prepare_historical_regulation_chunk_backfill",
            evidence["chunk_only_execution_plan_md"],
        )
        self.assertNotIn(
            "campus-ingestion-prepare-registry-scope-chunks",
            evidence["chunk_only_execution_plan_md"],
        )
        self.assertNotIn("process-regulation-rag-release", evidence["chunk_only_execution_plan_md"])

    def test_scoped_rules_are_chunk_only_and_not_downstream_eligible(self) -> None:
        canonical = b"# School scoped regulation\n\nArticle one."
        units = b'{"unit_type":"article","text":"Article one."}\n'
        record = self._record(
            document_id="institutional_regulation:muc:scoped:abc123",
            collection="scoped_rules",
            content_hash=hashlib.sha256(canonical).hexdigest(),
            canonical_key="regulations/documents/scoped_rules/scoped/canonical.md",
            units_key="regulations/documents/scoped_rules/scoped/document-units.jsonl",
        )

        evidence = build_historical_regulation_chunk_backfill_evidence(
            phase13_report={"selected_notice_ids": ["354006"]},
            materialization_reports={
                "denominator-expansion": {
                    "materialized_documents": [
                        self._materialized_document(
                            notice_id="354006",
                            collection="scoped_rules",
                            document_id=record.document_id,
                            content_hash=record.content_hash,
                            canonical_key=record.canonical_markdown_object_key,
                            canonical_sha256=hashlib.sha256(canonical).hexdigest(),
                            units_key=record.document_units_object_key,
                            units_sha256=hashlib.sha256(units).hexdigest(),
                        )
                    ]
                }
            },
            registry=InMemoryDocumentRegistry((record,)),
            object_store=_FakeObjectStore(
                {
                    record.canonical_markdown_object_key: canonical,
                    record.document_units_object_key: units,
                }
            ),
            bucket_derived="campus-rag-derived",
            preparation_run_id_prefix="phase0",
        )

        classification = evidence["classification_report"]["records"][0]
        self.assertEqual(classification["classification"], "admit_to_chunk")
        self.assertEqual(
            classification["downstream_consumption_status"],
            "chunk_only_non_serving",
        )
        self.assertFalse(classification["document_site_eligible"])
        self.assertFalse(classification["rag_consumption_eligible"])
        self.assertEqual(
            evidence["classification_report"]["downstream_eligible_counts"],
            {
                "document_site": 0,
                "rag_consumption": 0,
                "institutional_rules": 0,
                "scoped_rules": 0,
            },
        )
        self.assertIn("`scoped_rules`", evidence["chunk_only_execution_plan_md"])
        self.assertIn("Do not run candidate enqueue", evidence["chunk_only_execution_plan_md"])

    def test_missing_current_registry_record_needs_recovery(self) -> None:
        canonical = b"# Central regulation\n"
        units = b'{"unit_type":"article","text":"Article one."}\n'

        evidence = build_historical_regulation_chunk_backfill_evidence(
            phase13_report={"selected_notice_ids": ["619"]},
            materialization_reports={
                "manual-review": {
                    "materialized_documents": [
                        self._materialized_document(
                            notice_id="619",
                            collection="institutional_rules",
                            document_id="institutional_regulation:muc:missing:abc123",
                            content_hash=hashlib.sha256(canonical).hexdigest(),
                            canonical_key="regulations/documents/institutional_rules/missing/canonical.md",
                            canonical_sha256=hashlib.sha256(canonical).hexdigest(),
                            units_key="regulations/documents/institutional_rules/missing/document-units.jsonl",
                            units_sha256=hashlib.sha256(units).hexdigest(),
                        )
                    ]
                }
            },
            registry=InMemoryDocumentRegistry(),
            object_store=_FakeObjectStore(
                {
                    "regulations/documents/institutional_rules/missing/canonical.md": canonical,
                    "regulations/documents/institutional_rules/missing/document-units.jsonl": units,
                }
            ),
            bucket_derived="campus-rag-derived",
        )

        self.assertEqual(
            evidence["classification_report"]["status_counts"],
            {"needs_recovery": 1},
        )
        self.assertEqual(
            evidence["canonical_provenance_preflight"]["records"][0]["issues"],
            ["current_registry_record_missing"],
        )

    def _materialized_document(
        self,
        *,
        notice_id: str,
        collection: str,
        document_id: str,
        content_hash: str,
        canonical_key: str | None,
        canonical_sha256: str,
        units_key: str | None,
        units_sha256: str,
    ) -> dict[str, object]:
        return {
            "target_collection": collection,
            "target_document_id": document_id,
            "version_id": f"sha256:{content_hash}:effective-undated:revision-none",
            "content_hash": content_hash,
            "canonical_markdown_object_key": canonical_key,
            "canonical_markdown_sha256": canonical_sha256,
            "document_units_object_key": units_key,
            "document_units_sha256": units_sha256,
            "cleaning_policy_version": f"{collection}_cleaning_v1",
            "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
            "normalization_quality": {
                "quality_verdict": "passed",
                "source_notice_ids": [notice_id],
                "unit_count": 1,
                "article_count": 1,
                "suspicious_prefix": False,
            },
        }

    def _record(
        self,
        *,
        document_id: str,
        collection: str,
        content_hash: str,
        canonical_key: str,
        units_key: str,
    ) -> DocumentRegistryRecord:
        return DocumentRegistryRecord(
            document_id=document_id,
            revision_track="current-effective",
            version_id=f"sha256:{content_hash}:effective-undated:revision-none",
            source_uri=f"authenticated_notice:policy-regulation:{document_id}",
            content_hash=content_hash,
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
            canonical_markdown_object_key=canonical_key,
            import_source="test",
        )


class _FakeObjectStore:
    def __init__(self, objects: dict[str | None, bytes]) -> None:
        self._objects = {str(key): value for key, value in objects.items() if key}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        del bucket
        return self._objects[key]


if __name__ == "__main__":
    unittest.main()
