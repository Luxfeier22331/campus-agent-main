from __future__ import annotations

import unittest

from campus_ingestion_core.index_release_registry_restore import (
    build_restored_registry_records_from_release_payloads,
    restore_registry_scope_from_index_release_payloads,
)
from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class _UpsertOnlyRegistry(InMemoryDocumentRegistry):
    def __init__(self, records: tuple[DocumentRegistryRecord, ...] = ()) -> None:
        super().__init__(records)
        self.upserted_batches: list[tuple[DocumentRegistryRecord, ...]] = []

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        self.upserted_batches.append(records)
        super().upsert_many(records)

    def replace_scope(
        self,
        corpus: str,
        collection: str | None,
        records: tuple[DocumentRegistryRecord, ...],
    ) -> None:
        raise AssertionError("restore must not replace the registry scope")


def _release_manifest_payload() -> dict[str, object]:
    return {
        "release_id": "r20260503_111156_686885_6ce8d197",
        "corpus": "regulations",
        "collection": "institutional_rules",
        "cleaning_policy_version": "institutional_rules_cleaning_v1",
        "chunk_policy_version": "institutional_rules_semantic_v1",
        "embedding_model": "Qwen3-Embedding-4B",
        "indexed_at": "2026-05-03T11:11:56+00:00",
        "documents": [
            {
                "document_id": (
                    "institutional_regulation:muc:"
                    "中央民族大学本科教学事故认定与处理办法:9ff43316b979"
                ),
                "revision_track": "current-effective",
                "version_id": (
                    "sha256:d1c5e76658bdd5ce035190a6be8b61a22a711a6cb945742c7b9f137c279a76de:"
                    "effective-undated:revision-none"
                ),
                "document_units_object_key": (
                    "regulations/documents/institutional_rules/"
                    "中央民族大学本科教学事故认定与处理办法--9ff43316/"
                    "current-effective/undated/document-units.jsonl"
                ),
                "document_units_sha256": "sha256-units",
            }
        ],
    }


def _release_payload() -> dict[str, object]:
    return {
        "document_id": (
            "institutional_regulation:muc:中央民族大学本科教学事故认定与处理办法:9ff43316b979"
        ),
        "revision_track": "current-effective",
        "version_id": (
            "sha256:d1c5e76658bdd5ce035190a6be8b61a22a711a6cb945742c7b9f137c279a76de:"
            "effective-undated:revision-none"
        ),
        "source_uri": "https://my.muc.edu.cn/comsys-prompt-portlet-web/file/test.pdf",
        "source_channel": "authenticated_notice_portal",
        "parser_version": "collected_notice_regulation_canonical_backfill_v1",
        "embedding_model": "Qwen3-Embedding-4B",
        "entitlement_groups": ["campus_members"],
        "visibility_scope": "campus",
        "visibility_level": "restricted",
        "policy_projection_version": "phase1-authorization-projection-v1",
        "status": "active",
        "is_current": True,
        "published_date": "2024-01-09",
        "cleaning_policy_version": "institutional_rules_cleaning_v1",
    }


class IndexReleaseRegistryRestoreTest(unittest.TestCase):
    def test_builds_missing_records_from_release_payloads(self) -> None:
        records = build_restored_registry_records_from_release_payloads(
            corpus="regulations",
            collection="institutional_rules",
            release_manifest_payload=_release_manifest_payload(),
            release_payloads=(_release_payload(),),
        )

        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record.corpus, "regulations")
        self.assertEqual(record.collection, "institutional_rules")
        self.assertEqual(record.revision_track, "current-effective")
        self.assertEqual(
            record.content_hash, "d1c5e76658bdd5ce035190a6be8b61a22a711a6cb945742c7b9f137c279a76de"
        )
        self.assertEqual(record.source_channel, "authenticated_notice_portal")
        self.assertEqual(record.import_source, "index_release_registry_restore")
        self.assertEqual(record.visibility_level, "restricted")
        self.assertEqual(record.visibility_scope, "campus")
        self.assertEqual(record.entitlement_groups, ("campus_members",))
        self.assertTrue(record.is_current)
        self.assertEqual(record.published_date, "2024-01-09")
        self.assertIn(record.document_units_object_key, record.processed_object_keys)
        self.assertIn(
            "regulations/documents/institutional_rules/"
            "中央民族大学本科教学事故认定与处理办法--9ff43316/"
            "current-effective/undated/reader-assets/reader.json",
            record.processed_object_keys,
        )
        self.assertEqual(len(record.source_observations), 1)
        self.assertTrue(record.source_observations[0].is_primary)

    def test_restore_upserts_missing_records_without_replacing_scope(self) -> None:
        registry = _UpsertOnlyRegistry(())

        report = restore_registry_scope_from_index_release_payloads(
            corpus="regulations",
            collection="institutional_rules",
            release_manifest_payload=_release_manifest_payload(),
            release_payloads=(_release_payload(),),
            registry=registry,
            execute=True,
        )

        self.assertEqual(report.restored_count, 1)
        self.assertEqual(report.skipped_existing_count, 0)
        self.assertEqual(len(registry.upserted_batches), 1)
        self.assertEqual(len(registry.list_by_scope("regulations", "institutional_rules")), 1)

    def test_restore_fails_closed_when_manifest_document_has_no_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing release payload"):
            build_restored_registry_records_from_release_payloads(
                corpus="regulations",
                collection="institutional_rules",
                release_manifest_payload=_release_manifest_payload(),
                release_payloads=(),
            )


if __name__ == "__main__":
    unittest.main()
