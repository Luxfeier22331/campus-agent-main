from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.authenticated_notice_file_release_owner_recovery import (
    load_authenticated_notice_file_release_export,
    resolve_file_release_owner_recovery_readiness,
)


def _bundle_record(
    *,
    file_release_id: int,
    filename: str,
    upfilename: str | None = None,
    storage_provider: str = "object_store",
    bucket: str | None = "campus-rag-source",
    object_key: str | None = "authenticated_notice_portal/file-release-646/2025/sha256-deadbeef/capture/file.pdf",
    sha256: str | None = "deadbeef" * 8,
    ingest_status: str | None = "uploaded",
    provenance_status: str | None = "collected_internal",
) -> dict[str, object]:
    return {
        "file_release_id": file_release_id,
        "file_release": {
            "source_surface": "file_release",
            "filename": filename,
            "filecode": f"CODE-{file_release_id}",
            "filetime": "2025-07-09",
            "filedepartment": "财务处",
            "explain_department": "财务处",
            "publisher_user_name": "operator",
            "file_type_id": 1,
            "file_type_name": "规章制度",
            "original_portal_file_url": f"https://portal.example.edu/files/{file_release_id}",
            "resolved_download_url": f"https://portal.example.edu/files/{file_release_id}/download",
            "upfilename": upfilename,
            "important": 0,
            "det_important": 0,
            "role": 0,
            "last_seen_at": "2026-04-12T00:30:00Z",
            "enrich_attempted_at": "2026-04-12T00:31:00Z",
        },
        "released_file": {
            "source_url": f"https://portal.example.edu/files/{file_release_id}/download",
            "normalized_source_url": f"https://portal.example.edu/files/{file_release_id}/download",
            "final_url": f"https://portal.example.edu/files/{file_release_id}/download",
            "original_filename": filename,
            "mime_type": "application/pdf",
            "byte_size": 1024 if sha256 else None,
            "sha256": sha256,
            "storage_provider": storage_provider,
            "bucket": bucket,
            "object_key": object_key,
            "etag": None,
            "version_id": None,
            "origin_url_scheme": "https",
            "origin_host": "portal.example.edu",
            "origin_scope": "internal",
            "provenance_status": provenance_status,
            "ingest_status": ingest_status,
            "local_path": None,
            "downloaded_at": "2026-04-12T00:31:30Z",
            "uploaded_at": "2026-04-12T00:32:00Z" if sha256 else None,
            "last_error": None,
            "created_at": "2026-04-12T00:31:30Z",
            "updated_at": "2026-04-12T00:32:00Z",
        },
    }


def _export_manifest() -> dict[str, object]:
    return {
        "schema_version": "authenticated_notice_file_release_export_v1",
        "exported_at": "2026-04-12T00:33:00Z",
        "export_date": "20260412",
        "export_scope": "file-release-20260412T003300Z",
        "source_channel": "authenticated_notice_portal",
        "source_surface": "file_release",
        "site_id": "muc_internal_portal",
        "source_home_url": "https://portal.example.edu/",
        "collector": {
            "runtime_shell": "repo_local_node",
            "export_contract_version": "authenticated_notice_file_release_export_v1",
            "file_release_collection_mode": "prompt_portlet_materialized",
            "file_storage_mode": "object_store_write",
        },
        "filters": {
            "page_size": 50,
            "max_pages": 1,
            "max_file_releases": 10,
        },
        "observed_file_types": [],
        "observed_departments": ["财务处"],
        "run": {
            "mode": "file_release_export",
            "status": "success",
            "started_at": "2026-04-12T00:30:00Z",
            "finished_at": "2026-04-12T00:33:00Z",
            "pages_fetched": 1,
            "items_seen": 1,
            "items_inserted": 1,
            "detail_fetched": 1,
            "file_urls_resolved": 1,
            "errors": 0,
        },
    }


class AuthenticatedNoticeFileReleaseOwnerRecoveryTest(unittest.TestCase):
    def test_load_export_reads_bundle_and_manifest_json(self) -> None:
        bundle = [_bundle_record(file_release_id=646, filename="中央民族大学差旅费管理办法（民大校发〔2025〕104号）.pdf")]
        manifest = _export_manifest()
        with TemporaryDirectory() as tmpdir:
            bundle_path = Path(tmpdir) / "file-releases-bundle.json"
            manifest_path = Path(tmpdir) / "file-releases-manifest.json"
            bundle_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

            export = load_authenticated_notice_file_release_export(
                bundle_path=bundle_path,
                manifest_path=manifest_path,
            )

        self.assertEqual(export.export_scope, "file-release-20260412T003300Z")
        self.assertEqual(export.site_id, "muc_internal_portal")
        self.assertEqual(len(export.bundle_records), 1)

    def test_resolve_readiness_marks_materialized_match_as_ready(self) -> None:
        report = resolve_file_release_owner_recovery_readiness(
            owner_title_hint="中央民族大学差旅费管理办法",
            bundle_records=(
                _bundle_record(
                    file_release_id=646,
                    filename="中央民族大学差旅费管理办法（民大校发〔2025〕104号）.pdf",
                ),
            ),
            export_manifest=_export_manifest(),
        )

        self.assertEqual(report.status, "ready")
        self.assertIsNone(report.reason)
        self.assertEqual(report.match_count, 1)
        self.assertEqual(report.selected_match.file_release_id, 646)
        self.assertEqual(report.selected_match.match_strategy, "owner_hint_contained_in_candidate")
        self.assertEqual(report.selected_match.released_file.bucket, "campus-rag-source")

    def test_resolve_readiness_marks_reference_only_match_as_missing_source_bytes(self) -> None:
        report = resolve_file_release_owner_recovery_readiness(
            owner_title_hint="中央民族大学差旅费管理办法",
            bundle_records=(
                _bundle_record(
                    file_release_id=646,
                    filename="中央民族大学差旅费管理办法（民大校发〔2025〕104号）.pdf",
                    storage_provider="reference_only",
                    bucket=None,
                    object_key=None,
                    sha256=None,
                    ingest_status="reference_only",
                    provenance_status="reference_only",
                ),
            ),
            export_manifest=_export_manifest(),
        )

        self.assertEqual(report.status, "missing_source_bytes")
        self.assertEqual(report.reason, "file_release_source_bytes_missing")
        self.assertEqual(report.selected_match.file_release_id, 646)

    def test_resolve_readiness_marks_missing_capture_when_no_file_release_matches(self) -> None:
        report = resolve_file_release_owner_recovery_readiness(
            owner_title_hint="中央民族大学差旅费管理办法",
            bundle_records=(
                _bundle_record(
                    file_release_id=701,
                    filename="中央民族大学合同管理办法.pdf",
                ),
            ),
            export_manifest=_export_manifest(),
        )

        self.assertEqual(report.status, "missing_capture")
        self.assertEqual(report.reason, "file_release_capture_missing")
        self.assertEqual(report.match_count, 0)
        self.assertIsNone(report.selected_match)

    def test_resolve_readiness_marks_ambiguous_when_multiple_top_matches_exist(self) -> None:
        report = resolve_file_release_owner_recovery_readiness(
            owner_title_hint="中央民族大学差旅费管理办法",
            bundle_records=(
                _bundle_record(
                    file_release_id=646,
                    filename="中央民族大学差旅费管理办法.pdf",
                ),
                _bundle_record(
                    file_release_id=647,
                    filename="中央民族大学差旅费管理办法.docx",
                ),
            ),
            export_manifest=_export_manifest(),
        )

        self.assertEqual(report.status, "ambiguous_match")
        self.assertEqual(report.reason, "file_release_match_ambiguous")
        self.assertEqual(report.match_count, 2)
        self.assertIsNone(report.selected_match)
        self.assertEqual(report.ambiguous_file_release_ids, (646, 647))


if __name__ == "__main__":
    unittest.main()
