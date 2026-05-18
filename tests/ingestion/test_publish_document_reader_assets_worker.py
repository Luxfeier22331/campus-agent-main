from __future__ import annotations

import importlib
import unittest

from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry

worker = importlib.import_module("campus_ingestion_worker.publish_document_reader_assets")


class PublishDocumentReaderAssetsWorkerTests(unittest.TestCase):
    def test_select_records_excludes_scoped_rules_from_default_docs_site_publish(self) -> None:
        registry = InMemoryDocumentRegistry(
            (
                _record(
                    document_id="institutional:current",
                    collection="institutional_rules",
                    revision_track="current-effective",
                ),
                _record(
                    document_id="scoped:current",
                    collection="scoped_rules",
                    revision_track="current-effective",
                ),
                _record(
                    document_id="scoped:source-faithful",
                    collection="scoped_rules",
                    revision_track="source-faithful",
                ),
            )
        )

        records = worker._select_records(
            registry=registry,
            scopes=("regulations/institutional_rules", "regulations/scoped_rules"),
        )

        self.assertEqual(
            [record.document_id for record in records],
            ["institutional:current"],
        )


def _record(
    *,
    document_id: str,
    collection: str,
    revision_track: str,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=f"sha256:{document_id}:{revision_track}",
        source_uri=f"https://my.muc.edu.cn/{document_id}.pdf",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection=collection,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-30T00:00:00+00:00",
        parser_version="test",
        embedding_model="mock-embedding-8d",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=f"regulations/{collection}/{document_id}.jsonl",
        canonical_markdown_object_key=f"regulations/{collection}/{document_id}.md",
        processed_object_keys=(f"regulations/{collection}/{document_id}.jsonl",),
        import_source="test",
    )


if __name__ == "__main__":
    unittest.main()
