from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    AuthenticatedNoticeFileReleaseInventoryEntry,
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
    PostgresAuthenticatedNoticeFileReleaseInventoryStore,
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


def _inventory_entry(
    file_release_id: int,
    *,
    storage_provider: str = "object_store",
) -> AuthenticatedNoticeFileReleaseInventoryEntry:
    return AuthenticatedNoticeFileReleaseInventoryEntry(
        corpus="campus_notices",
        collection="file_release_capture",
        file_release_id=file_release_id,
        site_id="muc_internal_portal",
        export_scope="file-release-20260421T121246Z",
        collector_contract_version="authenticated_notice_file_release_export_v1",
        source_home_url="https://portal.example.edu/",
        filename=f"办法-{file_release_id}.pdf",
        upfilename=None,
        filecode=f"CODE-{file_release_id}",
        filetime="2025-07-09",
        filedepartment="财务处",
        explain_department="财务处",
        file_type_id=1,
        file_type_name="规章制度",
        resolved_download_url=f"https://portal.example.edu/files/{file_release_id}/download",
        released_file_storage_provider=storage_provider,
        released_file_bucket=("campus-rag-source" if storage_provider == "object_store" else None),
        released_file_object_key=(
            f"authenticated_notice_portal/file-release-{file_release_id}/2025/"
            f"sha256-deadbeef/capture/file-{file_release_id}.pdf"
            if storage_provider == "object_store"
            else None
        ),
        released_file_sha256=("deadbeef" * 8 if storage_provider == "object_store" else None),
        released_file_byte_size=(1024 if storage_provider == "object_store" else None),
        released_file_ingest_status=(
            "uploaded" if storage_provider == "object_store" else "reference_only"
        ),
        released_file_provenance_status=(
            "collected_internal" if storage_provider == "object_store" else "reference_only"
        ),
        record={
            "file_release_id": file_release_id,
            "file_release": {
                "filename": f"办法-{file_release_id}.pdf",
                "filecode": f"CODE-{file_release_id}",
            },
            "released_file": {
                "storage_provider": storage_provider,
                "object_key": (
                    f"authenticated_notice_portal/file-release-{file_release_id}/2025/"
                    f"sha256-deadbeef/capture/file-{file_release_id}.pdf"
                    if storage_provider == "object_store"
                    else None
                ),
            },
        },
    )


class AuthenticatedNoticeFileReleaseInventoryStoreTest(unittest.TestCase):
    def test_in_memory_store_replaces_scope_and_filters_selected_file_release_ids(self) -> None:
        store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
        store.upsert_many((_inventory_entry(700),))
        store.replace_scope(
            "campus_notices",
            "file_release_capture",
            (_inventory_entry(646), _inventory_entry(647)),
        )

        all_records = store.list_by_scope("campus_notices", "file_release_capture")
        selected = store.list_by_scope(
            "campus_notices",
            "file_release_capture",
            file_release_ids=(647, 647, 646),
        )

        self.assertEqual([record.file_release_id for record in all_records], [646, 647])
        self.assertEqual([record.file_release_id for record in selected], [646, 647])

    def test_postgres_store_list_by_scope_uses_keyset_paging(self) -> None:
        store = object.__new__(PostgresAuthenticatedNoticeFileReleaseInventoryStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.authenticated_notice_file_release_inventory"
        row_1 = (json.dumps(asdict(_inventory_entry(646))),)
        row_2 = (json.dumps(asdict(_inventory_entry(647))),)
        cursor = _PagedCursor([[row_1], [row_2], []])

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_file_release_inventory._postgres_connection",
                return_value=_FakeConnectionContextManager(cursor),
            ),
            patch(
                "campus_ingestion_core.authenticated_notice_file_release_inventory.DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE",
                1,
            ),
        ):
            records = store.list_by_scope("campus_notices", "file_release_capture")

        self.assertEqual([record.file_release_id for record in records], [646, 647])
        self.assertEqual(len(cursor.execute_calls), 3)
        first_query, first_params = cursor.execute_calls[0]
        second_query, second_params = cursor.execute_calls[1]
        self.assertIn("jsonb_build_object", first_query)
        self.assertIn("limit %s", first_query.lower())
        self.assertIn("file_release_id > %s", second_query)
        self.assertEqual(first_params[-1], 1)
        self.assertEqual(second_params[2], 646)

    def test_postgres_store_list_by_scope_pushes_down_selected_file_release_ids(self) -> None:
        store = object.__new__(PostgresAuthenticatedNoticeFileReleaseInventoryStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.authenticated_notice_file_release_inventory"
        row_1 = (json.dumps(asdict(_inventory_entry(646))),)
        row_2 = (json.dumps(asdict(_inventory_entry(647))),)
        cursor = _PagedCursor([[row_1, row_2]])

        with patch(
            "campus_ingestion_core.authenticated_notice_file_release_inventory._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.list_by_scope(
                "campus_notices",
                "file_release_capture",
                file_release_ids=(647, 646, 647),
            )

        self.assertEqual([record.file_release_id for record in records], [646, 647])
        self.assertEqual(len(cursor.execute_calls), 1)
        query, params = cursor.execute_calls[0]
        self.assertIn("jsonb_build_object", query)
        self.assertIn("file_release_id = any(%s)", query)
        self.assertEqual(params, ("campus_notices", "file_release_capture", [646, 647]))


if __name__ == "__main__":
    unittest.main()
