from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    AuthenticatedNoticeFileReleaseInventoryEntry,
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
    build_authenticated_notice_file_release_inventory_store_from_env,
)


def _inventory_entry(
    file_release_id: int,
    *,
    storage_provider: str = "object_store",
) -> AuthenticatedNoticeFileReleaseInventoryEntry:
    return AuthenticatedNoticeFileReleaseInventoryEntry(
        corpus="campus_notices",
        collection="file_release_capture",
        file_release_id=file_release_id,
        site_id="example_internal_portal",
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
        released_file_bucket=(
            "campus-agent-source" if storage_provider == "object_store" else None
        ),
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

    def test_env_builder_fails_closed_after_python_db_runtime_retirement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Python database runtime is retired"):
            build_authenticated_notice_file_release_inventory_store_from_env({})


if __name__ == "__main__":
    unittest.main()
