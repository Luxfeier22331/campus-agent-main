from __future__ import annotations

import unittest

from campus_ingestion_core.campusrag_ingestion_sources import merge_equivalent_source_record
from campus_ingestion_core.models import DocumentRegistryRecord, SourceObservation
from campus_ingestion_core.registry_scope_chunk_preparation import (
    require_verified_chunk_preparation,
)


class RegulationServingReleaseGateTests(unittest.TestCase):
    def test_regulation_scope_requires_verified_chunk_preparation_before_release(self) -> None:
        with self.assertRaisesRegex(ValueError, "chunk preparation run id is required"):
            require_verified_chunk_preparation(
                corpus="regulations",
                collection="institutional_rules",
                preparation_run_id=None,
                records=(_registry_record(collection="institutional_rules"),),
                object_store=_MissingObjectStore(),
                bucket="campus-rag-derived",
            )

    def test_authenticated_notice_source_observation_outranks_manual_curated_regulation(
        self,
    ) -> None:
        merged = merge_equivalent_source_record(
            existing=_registry_record(collection="institutional_rules"),
            candidate_observation=SourceObservation(
                source_channel="authenticated_notice_portal",
                source_uri="https://my.muc.edu.cn/file/594.pdf",
                raw_asset=None,
                is_primary=False,
                import_source="collected_notice_regulation_first_batch_promotion",
            ),
            candidate_is_current=True,
            timestamp="2026-04-30T00:00:00+00:00",
        )

        self.assertEqual(merged.source_channel, "authenticated_notice_portal")
        self.assertEqual(merged.source_uri, "https://my.muc.edu.cn/file/594.pdf")
        self.assertEqual(len(merged.source_observations), 2)
        primary_observations = [
            observation for observation in merged.source_observations if observation.is_primary
        ]
        self.assertEqual(len(primary_observations), 1)
        self.assertEqual(primary_observations[0].source_channel, "authenticated_notice_portal")


def _registry_record(*, collection: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="institutional_regulation:muc:test",
        revision_track="current-effective",
        version_id="sha256:test",
        source_uri="campusrag://manual/test",
        content_hash="sha256:test",
        corpus="regulations",
        collection=collection,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-29T00:00:00+00:00",
        parser_version="test_parser_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key="regulations/documents/test/document-units.jsonl",
        canonical_markdown_object_key="regulations/documents/test/canonical.md",
        processed_object_keys=("regulations/documents/test/document-units.jsonl",),
        import_source="test",
    )


class _MissingObjectStore:
    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        raise AssertionError("object store should not be read without a preparation run id")

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        raise AssertionError("object store should not be written by verification")


if __name__ == "__main__":
    unittest.main()
