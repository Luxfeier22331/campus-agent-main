from __future__ import annotations

from dataclasses import asdict
import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.models import DocumentRegistryRecord


worker = importlib.import_module(
    "campus_ingestion_worker.export_internal_notice_regulation_candidate_artifacts"
)


class ExportInternalNoticeRegulationCandidateArtifactsWorkerCliTest(unittest.TestCase):
    def test_main_exports_local_candidate_artifacts_from_snapshot_inputs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            documents_json = root / "documents.json"
            inventory_json = root / "source-truth-inventory.json"
            object_store_root = root / "object-store"
            output_dir = root / "candidate-export"

            record = DocumentRegistryRecord(
                document_id="notice:muc_internal_portal:300101",
                revision_track="source-faithful",
                version_id="sha256:300101:source-faithful",
                source_uri="https://portal.example.edu/notices/300101",
                content_hash="sha256:body-300101",
                corpus="campus_notices",
                collection="internal_notice",
                cleaning_policy_version="authenticated_notice_projection_v1",
                entitlement_groups=("campus_members",),
                visibility_scope="campus",
                visibility_level="restricted",
                status="active",
                ingestion_timestamp="2026-04-11T00:00:00+00:00",
                parser_version="authenticated_notice_source_projection_v1",
                embedding_model="Qwen3-Embedding-4B",
                source_channel="authenticated_notice_portal",
                is_current=True,
                canonical_markdown_object_key="campus_notices/documents/internal_notice/300101/canonical.md",
                document_units_object_key="campus_notices/documents/internal_notice/300101/document-units.jsonl",
                processed_object_keys=(
                    "campus_notices/documents/internal_notice/300101/canonical.md",
                    "campus_notices/documents/internal_notice/300101/document-units.jsonl",
                ),
                import_source="authenticated_notice_source_projection",
                published_date="2021-02-28",
            )
            inventory_entry = AuthenticatedNoticeSourceTruthInventoryEntry(
                corpus="campus_notices",
                collection="internal_notice",
                notice_id="300101",
                site_id="muc_internal_portal",
                document_id="notice:muc_internal_portal:300101",
                revision_track="source-faithful",
                version_id="sha256:300101:inventory",
                raw_asset_id="raw:300101",
                raw_version_id="sha256:300101:raw",
                source_home_url="https://portal.example.edu",
                embedding_model="Qwen3-Embedding-4B",
                notice_manifest_key="source/300101/notice-manifest.json",
                content_blocks_key="source/300101/content-blocks.jsonl",
                attachment_refs_key="source/300101/attachment-refs.jsonl",
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
                parent_snapshot={
                    "notice_id": "300101",
                    "site_id": "muc_internal_portal",
                    "document_id": "notice:muc_internal_portal:300101",
                    "notice_title": "中央民族大学实验室安全管理规定",
                    "notice_release_time": "2021-02-28 16:09",
                    "attachment_projection_plans": [],
                    "record": {
                        "document_id": "notice:muc_internal_portal:300101",
                        "published_date": "2021-02-28",
                    },
                },
            )

            documents_json.write_text(
                json.dumps(
                    {
                        "notice:muc_internal_portal:300101::source-faithful::sha256:300101:source-faithful": asdict(
                            record
                        )
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            inventory_json.write_text(
                json.dumps([asdict(inventory_entry)], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            target = object_store_root / "campus-rag-derived" / record.canonical_markdown_object_key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                "# 中央民族大学实验室安全管理规定\n\n"
                "2021年2月28日起施行。\n\n"
                "第一条 为加强实验室安全管理，制定本规定。\n"
                "第二条 实验室实行分级分类安全管理制度。\n"
                "第三条 各实验室应建立日常巡检和安全培训机制。\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.export_internal_notice_regulation_candidate_artifacts.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--documents-json",
                        str(documents_json),
                        "--source-truth-inventory-json",
                        str(inventory_json),
                        "--object-store-root",
                        str(object_store_root),
                        "--output-dir",
                        str(output_dir),
                        "--notice-id",
                        "300101",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["exported_candidate_count"], 1)
            self.assertTrue(Path(payload["manifest_path"]).exists())
            self.assertTrue(Path(payload["candidate_documents_path"]).exists())
            self.assertEqual(len(payload["candidate_markdown_paths"]), 1)
            markdown_path = Path(payload["candidate_markdown_paths"][0])
            self.assertTrue(markdown_path.exists())
            markdown = markdown_path.read_text(encoding="utf-8")
            self.assertIn("# 中央民族大学实验室安全管理规定", markdown)
            self.assertIn("source_notice_release_time: 2021-02-28 16:09", markdown)
            candidate_documents = [
                json.loads(line)
                for line in Path(payload["candidate_documents_path"]).read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(candidate_documents[0]["entitlement_groups"], ["campus_members"])
            self.assertEqual(candidate_documents[0]["visibility_scope"], "campus")
            self.assertEqual(candidate_documents[0]["visibility_level"], "restricted")
            self.assertEqual(candidate_documents[0]["embedding_model"], "Qwen3-Embedding-4B")


if __name__ == "__main__":
    unittest.main()
