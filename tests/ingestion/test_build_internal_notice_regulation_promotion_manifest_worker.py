from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.models import DocumentRegistryRecord

worker = importlib.import_module(
    "campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest"
)


class BuildInternalNoticeRegulationPromotionManifestWorkerCliTest(unittest.TestCase):
    def test_main_builds_request_and_exports_when_output_dir_is_set(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest.build_internal_notice_regulation_promotion_manifest"
            ) as build_manifest,
            patch(
                "campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest.export_internal_notice_regulation_promotion_manifest"
            ) as export_manifest,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            build_manifest.return_value = {
                "candidate_count": 2,
                "hold_count": 3,
                "machine_processing_required_count": 1,
                "documents": [],
            }
            export_manifest.return_value = (
                Path("/tmp/promotion-manifest.json"),
                Path("/tmp/document-reports.jsonl"),
            )
            worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--promotion-routing-path",
                    "/tmp/promotion-routing.v1.json",
                    "--notice-id",
                    "100002",
                    "--notice-id",
                    "100001",
                    "--document-id",
                    "notice_attachment:muc_internal_portal:100001:attachment-0001",
                    "--output-dir",
                    "/tmp/promotion-out",
                ]
            )

        request = build_manifest.call_args.kwargs["request"]
        self.assertEqual(request.corpus, "campus_notices")
        self.assertEqual(request.collection, "internal_notice")
        self.assertEqual(str(request.promotion_routing_path), "/tmp/promotion-routing.v1.json")
        self.assertEqual(request.notice_ids, ("100001", "100002"))
        self.assertEqual(
            request.document_ids,
            ("notice_attachment:muc_internal_portal:100001:attachment-0001",),
        )
        export_manifest.assert_called_once()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["candidate_count"], 2)
        self.assertEqual(payload["promotion_manifest_path"], "/tmp/promotion-manifest.json")
        self.assertEqual(payload["document_reports_path"], "/tmp/document-reports.jsonl")

    def test_main_loads_local_snapshot_inputs_without_env_backends(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            object_store_root = root / "object-store"
            documents_json = root / "registry" / "documents.json"
            inventory_json = root / "registry" / "source-truth-inventory.json"

            record = DocumentRegistryRecord(
                document_id="notice:muc_internal_portal:300001",
                revision_track="source-faithful",
                version_id="sha256:300001:source-faithful",
                source_uri="https://portal.example.edu/notices/300001",
                content_hash="sha256:parent-300001",
                corpus="campus_notices",
                collection="internal_notice",
                cleaning_policy_version="authenticated_notice_projection_v1",
                entitlement_groups=("campus_members",),
                visibility_scope="campus",
                visibility_level="restricted",
                status="active",
                ingestion_timestamp="2026-04-10T00:00:00+00:00",
                parser_version="authenticated_notice_source_projection_v1",
                embedding_model="Qwen3-Embedding-4B",
                source_channel="authenticated_notice_portal",
                is_current=True,
                document_units_object_key="campus_notices/documents/internal_notice/300001/document-units.jsonl",
                canonical_markdown_object_key="campus_notices/documents/internal_notice/300001/canonical.md",
                processed_object_keys=(
                    "campus_notices/documents/internal_notice/300001/canonical.md",
                    "campus_notices/documents/internal_notice/300001/document-units.jsonl",
                ),
                import_source="authenticated_notice_source_projection",
                published_date="2026-04-10",
            )
            inventory_entry = AuthenticatedNoticeSourceTruthInventoryEntry(
                corpus="campus_notices",
                collection="internal_notice",
                notice_id="300001",
                site_id="muc_internal_portal",
                document_id="notice:muc_internal_portal:300001",
                revision_track="source-faithful",
                version_id="sha256:300001:inventory",
                raw_asset_id="raw:300001",
                raw_version_id="sha256:300001:raw",
                source_home_url="https://portal.example.edu",
                embedding_model="Qwen3-Embedding-4B",
                notice_manifest_key="source/300001/notice-manifest.json",
                content_blocks_key="source/300001/content-blocks.jsonl",
                attachment_refs_key="source/300001/attachment-refs.jsonl",
                attachment_document_count=0,
                attachment_ref_count=0,
                text_extractable_count=0,
                ocr_required_count=0,
                reference_only_count=0,
                multimodal_processing_required_count=0,
                notice_risk_label="body_only",
                attachment_mix_score=0,
                has_text_table_attachment=False,
                has_spatial_attachment=False,
                has_reference_only_attachment=False,
                planning_weight=1,
                parent_snapshot={
                    "notice_id": "300001",
                    "site_id": "muc_internal_portal",
                    "document_id": "notice:muc_internal_portal:300001",
                    "notice_title": "中央民族大学实验室安全管理规定",
                    "attachment_projection_plans": [],
                    "record": {
                        "document_id": "notice:muc_internal_portal:300001",
                        "published_date": "2026-04-10",
                    },
                },
            )
            documents_json.parent.mkdir(parents=True, exist_ok=True)
            documents_json.write_text(
                json.dumps(
                    {
                        "notice:muc_internal_portal:300001::source-faithful::sha256:300001:source-faithful": asdict(
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
                "# 中央民族大学实验室安全管理规定\n\n第一条 为加强实验室安全管理，制定本规定。\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest.build_internal_notice_regulation_promotion_manifest"
                ) as build_manifest,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                build_manifest.return_value = {
                    "candidate_count": 0,
                    "hold_count": 0,
                    "machine_processing_required_count": 0,
                    "documents": [],
                }
                worker.main(
                    [
                        "--documents-json",
                        str(documents_json),
                        "--source-truth-inventory-json",
                        str(inventory_json),
                        "--object-store-root",
                        str(object_store_root),
                    ]
                )
                call_kwargs = build_manifest.call_args.kwargs
                self.assertEqual(call_kwargs["request"].corpus, "campus_notices")
                self.assertEqual(call_kwargs["request"].collection, "internal_notice")
                self.assertEqual(
                    len(call_kwargs["registry"].list_by_scope("campus_notices", "internal_notice")),
                    1,
                )
                self.assertEqual(
                    len(
                        call_kwargs["source_truth_inventory_store"].list_by_scope(
                            "campus_notices",
                            "internal_notice",
                        )
                    ),
                    1,
                )
                self.assertEqual(
                    call_kwargs["object_store"].get_bytes(
                        bucket="campus-rag-derived",
                        key="campus_notices/documents/internal_notice/300001/canonical.md",
                    ),
                    b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xae\x9e\xe9\xaa\x8c\xe5\xae\xa4\xe5\xae\x89\xe5\x85\xa8\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a\n\n\xe7\xac\xac\xe4\xb8\x80\xe6\x9d\xa1 \xe4\xb8\xba\xe5\x8a\xa0\xe5\xbc\xba\xe5\xae\x9e\xe9\xaa\x8c\xe5\xae\xa4\xe5\xae\x89\xe5\x85\xa8\xe7\xae\xa1\xe7\x90\x86\xef\xbc\x8c\xe5\x88\xb6\xe5\xae\x9a\xe6\x9c\xac\xe8\xa7\x84\xe5\xae\x9a\xe3\x80\x82\n",
                )


if __name__ == "__main__":
    unittest.main()
