# ruff: noqa: F403,F405
from __future__ import annotations

import json
import unittest

from campus_ingestion_core.index_release_acceptance import evaluate_release_chunk_quality
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl

from tests.ingestion.official_web_projection_core_replay_suite_support import *


class OfficialWebProjectionCoreReplayTestPart08(unittest.TestCase):
    def test_stable_reference_directory_source_pack_preview_seed_emits_document(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            declarations = _declarations_payload()
            declarations["declarations"].append(
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                }
            )
            _write_json(declarations_path, declarations)
            stable_match = _target_match(
                consumer_family="stable_reference_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="official_web/stable_reference",
                target_id="official-web-stable-reference",
                target_job_id="owtarget_stable_reference",
                workset_reason="source_pack_preview_seed",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_stable_directory_preview",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-14T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_units",
                            raw_version_id="owver_units",
                            normalized_canonical_url="https://www.example.edu/zzjg/jxhkydw1.htm",
                            page_family="directory_page",
                            target_matches=[stable_match],
                            source_pack_id="stable-reference-source-pack.v1",
                            source_pack_entry_id="stable-reference-teaching-research-units",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_units",
                raw_version_id="owver_units",
                normalized_canonical_url="https://www.example.edu/zzjg/jxhkydw1.htm",
                page_title="教学和科研单位",
                page_family="directory_page",
                target_matches=[stable_match],
                source_pack_id="stable-reference-source-pack.v1",
                source_pack_entry_id="stable-reference-teaching-research-units",
                blocks=[
                    _block(
                        raw_asset_id="owasset_units",
                        raw_version_id="owver_units",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="教学和科研单位",
                    ),
                    _block(
                        raw_asset_id="owasset_units",
                        raw_version_id="owver_units",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="文学院、历史文化学院、民族学与社会学学院、经济学院、管理学院。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 1)
            self.assertEqual(report.counts["consumer_candidate_pages"], 0)
            self.assertEqual(report.documents[0]["target_collection"], "stable_reference")
            self.assertEqual(
                report.documents[0]["routing_route_id"],
                "consumer-denominator:stable_reference_candidate",
            )

    def test_replay_projects_official_web_table_cells_as_release_grade_table_metadata(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            routing_path = root / "projection-routing.json"
            declarations = _declarations_payload()
            declarations["declarations"].append(
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                }
            )
            _write_json(declarations_path, declarations)
            _write_json(routing_path, _routing_payload(titles=["中央民族大学大学教育收费公示表"]))
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_fee_table_projection",
                    "generatedAt": "2026-05-14T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_fee_table",
                            raw_version_id="owver_fee_table",
                            normalized_canonical_url="https://xxgk.example.edu/sfxx.htm",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            table_block = _block(
                raw_asset_id="owasset_fee_table",
                raw_version_id="owver_fee_table",
                row_id="table-1",
                row_index=1,
                block_order=1,
                block_role="table",
                text="收费项目 收费标准 收费依据\n普通本科专业 5000元/生·学年 京发改收费文件\n艺术类专业 10000元/生·学年 京发改收费文件",
                parent_heading_path=["收费公示"],
            )
            table_block["tableCells"] = [
                ["中央民族大学大学教育收费公示表"],
                ["收费项目", "收费标准", "收费依据"],
                ["普通本科专业", "5000元/生·学年", "京发改收费文件"],
                ["艺术类专业", "10000元/生·学年", "京发改收费文件"],
            ]
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_fee_table",
                raw_version_id="owver_fee_table",
                normalized_canonical_url="https://xxgk.example.edu/sfxx.htm",
                page_title="中央民族大学大学教育收费公示表",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_fee_table",
                        raw_version_id="owver_fee_table",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学大学教育收费公示表",
                    ),
                    table_block,
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
                routing_path=routing_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 1)
            document = report.documents[0]
            units_path = Path(document["document_units_path"])
            rows = [
                json.loads(line)
                for line in units_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            table_unit = next(row for row in rows if row["unit_type"] == "table_unit")
            self.assertEqual(
                table_unit["metadata"]["table_header_line"],
                "收费项目 | 收费标准 | 收费依据",
            )
            self.assertEqual(
                table_unit["metadata"]["table_row_lines"],
                [
                    "普通本科专业 | 5000元/生·学年 | 京发改收费文件",
                    "艺术类专业 | 10000元/生·学年 | 京发改收费文件",
                ],
            )
            self.assertEqual(
                table_unit["metadata"]["table_columns"],
                ["收费项目", "收费标准", "收费依据"],
            )
            self.assertEqual(table_unit["anchor"]["table_context"], "收费公示")

            record = DocumentRegistryRecord(
                document_id=str(document["document_id"]),
                revision_track="source-faithful",
                version_id=str(document["version_id"]),
                source_uri="https://xxgk.example.edu/sfxx.htm",
                content_hash="sha256:fee-table",
                corpus="official_web",
                collection="stable_reference",
                entitlement_groups=(),
                visibility_scope=None,
                status="active",
                ingestion_timestamp="2026-05-14T09:00:00+00:00",
                parser_version="official_web_projection_replay.v1",
                embedding_model="Qwen3-Embedding-4B",
                source_channel="official_web",
                is_current=True,
                import_source="official_web_source_truth_replay",
            )
            chunks = build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=units_path.read_bytes(),
            )
            quality = evaluate_release_chunk_quality(
                chunks=chunks,
                max_token_count=384,
                qrels_coverage_required=False,
            )

            self.assertEqual(quality.chunk_quality_status, "passed")
