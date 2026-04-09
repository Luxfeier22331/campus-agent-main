from __future__ import annotations

from dataclasses import asdict
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    PostgresAuthenticatedNoticeSourceTruthInventoryStore,
    _list_document_registry_scope_records_for_inventory,
    _list_raw_asset_registry_scope_records_for_inventory,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef
from campus_ingestion_core.registry import (
    PostgresDocumentRegistry,
    PostgresRawAssetRegistry,
)


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self._pages = list(pages)
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        if not self._pages:
            return []
        return self._pages.pop(0)


def _document_record(document_id: str, version_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"https://portal.example.edu/{document_id}",
        content_hash=version_id,
        corpus="campus_notices",
        collection="internal_notice",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        raw_asset=RawAssetRef(
            raw_asset_id=f"asset:{document_id}",
            raw_version_id=version_id,
        ),
        processed_object_keys=(
            f"campus_notices/source-truth/{document_id}/notice-manifest.json",
        ),
        import_source="authenticated_notice_bootstrap_import",
    )


def _raw_record(raw_asset_id: str, raw_version_id: str) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="campus_notices",
        collection="internal_notice",
        raw_source_uri=f"https://portal.example.edu/raw/{raw_asset_id}",
        content_hash=raw_version_id,
        source_filename="detail-response.json",
        object_key=f"campus_notices/raw/{raw_asset_id}/{raw_version_id}/detail-response.json",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        import_source="authenticated_notice_bootstrap_import",
    )


def _inventory_entry(notice_id: str) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus="campus_notices",
        collection="internal_notice",
        notice_id=notice_id,
        site_id="muc_internal_portal",
        document_id=f"notice:muc_internal_portal:{notice_id}",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}",
        raw_asset_id=f"asset:{notice_id}",
        raw_version_id=f"sha256:{notice_id}",
        source_home_url="https://portal.example.edu/home",
        embedding_model="Qwen3-Embedding-4B",
        notice_manifest_key=f"source/{notice_id}/notice-manifest.json",
        content_blocks_key=f"source/{notice_id}/content-blocks.jsonl",
        attachment_refs_key=f"source/{notice_id}/attachment-refs.jsonl",
        attachment_document_count=0,
        attachment_ref_count=0,
        text_extractable_count=0,
        ocr_required_count=0,
        reference_only_count=0,
        manual_review_required_count=0,
        notice_risk_label="body_only",
        attachment_mix_score=0,
        has_text_table_attachment=False,
        has_spatial_attachment=False,
        has_reference_only_attachment=False,
        planning_weight=1,
        parent_snapshot={"notice_id": notice_id},
    )


class AuthenticatedNoticeSourceTruthInventoryPagingTest(unittest.TestCase):
    def test_document_registry_inventory_scan_uses_keyset_paging(self) -> None:
        registry = object.__new__(PostgresDocumentRegistry)
        registry.database_url = "postgresql://example.test/db"
        registry.table_name = "ingestion_registry.document_registry_records"
        row_1 = (json.dumps(asdict(_document_record("notice:muc:000001", "sha256:1"))),)
        row_2 = (json.dumps(asdict(_document_record("notice:muc:000002", "sha256:2"))),)
        cursor = _PagedCursor([[row_1], [row_2], []])

        with patch(
            "campus_ingestion_core.authenticated_notice_source_truth_inventory._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = _list_document_registry_scope_records_for_inventory(
                registry,
                corpus="campus_notices",
                collection="internal_notice",
                page_size=1,
            )

        self.assertEqual([record.document_id for record in records], ["notice:muc:000001", "notice:muc:000002"])
        self.assertEqual(len(cursor.execute_calls), 3)
        first_query, first_params = cursor.execute_calls[0]
        second_query, second_params = cursor.execute_calls[1]
        self.assertIn("limit %s", first_query.lower())
        self.assertIn("record->>'document_id' like %s", first_query)
        self.assertIn("(document_id, revision_track, version_id) > (%s, %s, %s)", second_query)
        self.assertEqual(first_params[-1], 1)
        self.assertEqual(first_params[2], "notice:%")
        self.assertEqual(second_params[3:6], ("notice:muc:000001", "source-faithful", "sha256:1"))

    def test_raw_asset_registry_inventory_scan_uses_keyset_paging(self) -> None:
        registry = object.__new__(PostgresRawAssetRegistry)
        registry.database_url = "postgresql://example.test/db"
        registry.table_name = "ingestion_registry.raw_asset_registry_records"
        row_1 = (json.dumps(asdict(_raw_record("asset:1", "sha256:1"))),)
        row_2 = (json.dumps(asdict(_raw_record("asset:2", "sha256:2"))),)
        cursor = _PagedCursor([[row_1], [row_2], []])

        with patch(
            "campus_ingestion_core.authenticated_notice_source_truth_inventory._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = _list_raw_asset_registry_scope_records_for_inventory(
                registry,
                corpus="campus_notices",
                collection="internal_notice",
                page_size=1,
            )

        self.assertEqual([record.raw_asset_id for record in records], ["asset:1", "asset:2"])
        self.assertEqual(len(cursor.execute_calls), 3)
        first_query, first_params = cursor.execute_calls[0]
        second_query, second_params = cursor.execute_calls[1]
        self.assertIn("limit %s", first_query.lower())
        self.assertIn("(raw_asset_id, raw_version_id) > (%s, %s)", second_query)
        self.assertEqual(first_params[-1], 1)
        self.assertEqual(second_params[2:4], ("asset:1", "sha256:1"))

    def test_inventory_store_list_by_scope_uses_keyset_paging(self) -> None:
        store = object.__new__(PostgresAuthenticatedNoticeSourceTruthInventoryStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.authenticated_notice_source_truth_inventory"
        row_1 = (json.dumps(asdict(_inventory_entry("000001"))),)
        row_2 = (json.dumps(asdict(_inventory_entry("000002"))),)
        cursor = _PagedCursor([[row_1], [row_2], []])

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_source_truth_inventory._postgres_connection",
                return_value=_FakeConnectionContextManager(cursor),
            ),
            patch(
                "campus_ingestion_core.authenticated_notice_source_truth_inventory.DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE",
                1,
            ),
        ):
            records = store.list_by_scope("campus_notices", "internal_notice")

        self.assertEqual([record.notice_id for record in records], ["000001", "000002"])
        self.assertEqual(len(cursor.execute_calls), 3)
        first_query, first_params = cursor.execute_calls[0]
        second_query, second_params = cursor.execute_calls[1]
        self.assertIn("limit %s", first_query.lower())
        self.assertIn("notice_id > %s", second_query)
        self.assertEqual(first_params[-1], 1)
        self.assertEqual(second_params[2], "000001")

    def test_inventory_store_list_by_scope_pushes_down_selected_notice_ids(self) -> None:
        store = object.__new__(PostgresAuthenticatedNoticeSourceTruthInventoryStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.authenticated_notice_source_truth_inventory"
        row_2 = (json.dumps(asdict(_inventory_entry("000002"))),)
        row_3 = (json.dumps(asdict(_inventory_entry("000003"))),)
        cursor = _PagedCursor([[row_2, row_3]])

        with patch(
            "campus_ingestion_core.authenticated_notice_source_truth_inventory._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.list_by_scope(
                "campus_notices",
                "internal_notice",
                notice_ids=("000003", "000002", "000003"),
            )

        self.assertEqual([record.notice_id for record in records], ["000002", "000003"])
        self.assertEqual(len(cursor.execute_calls), 1)
        query, params = cursor.execute_calls[0]
        self.assertIn("notice_id = any(%s)", query)
        self.assertNotIn("limit %s", query.lower())
        self.assertEqual(params, ("campus_notices", "internal_notice", ["000002", "000003"]))

    def test_inventory_store_list_by_scope_accepts_legacy_rows_without_new_profile_fields(
        self,
    ) -> None:
        store = object.__new__(PostgresAuthenticatedNoticeSourceTruthInventoryStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.authenticated_notice_source_truth_inventory"
        legacy_payload = asdict(_inventory_entry("000004"))
        legacy_payload.pop("attachment_ref_count")
        legacy_payload.pop("manual_review_required_count")
        legacy_payload.pop("notice_risk_label")
        legacy_payload.pop("attachment_mix_score")
        legacy_payload.pop("has_text_table_attachment")
        legacy_payload.pop("has_spatial_attachment")
        legacy_payload.pop("has_reference_only_attachment")
        cursor = _PagedCursor([[(json.dumps(legacy_payload),)]])

        with patch(
            "campus_ingestion_core.authenticated_notice_source_truth_inventory._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.list_by_scope(
                "campus_notices",
                "internal_notice",
                notice_ids=("000004",),
            )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].notice_id, "000004")
        self.assertEqual(records[0].attachment_ref_count, 0)
        self.assertEqual(records[0].manual_review_required_count, 0)
        self.assertEqual(records[0].notice_risk_label, "body_only")
        self.assertEqual(records[0].attachment_mix_score, 0)
        self.assertFalse(records[0].has_text_table_attachment)
        self.assertFalse(records[0].has_spatial_attachment)
        self.assertFalse(records[0].has_reference_only_attachment)


if __name__ == "__main__":
    unittest.main()
