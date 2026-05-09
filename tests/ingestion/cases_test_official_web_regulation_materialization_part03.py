# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_official_web_regulation_materialization_support import *


class OfficialWebRegulationMaterializationTestPart03(unittest.TestCase):
    def test_scope_refresh_prunes_stale_derived_document_objects_for_selected_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
            )
            source_url = "https://xxgk.muc.edu.cn/info/1198/6451.htm"
            document_id = "official_web_regulation:12ce0e9b47598c5d"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_stale_artifact_prune_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_plan",
                            raw_version_id="owver_plan",
                            normalized_canonical_url=source_url,
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_plan",
                raw_version_id="owver_plan",
                normalized_canonical_url=source_url,
                page_title="中央民族大学事业发展“十三五”规划",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_plan",
                        raw_version_id="owver_plan",
                        row_id="plan-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学事业发展“十三五”规划",
                    ),
                    _block(
                        raw_asset_id="owasset_plan",
                        raw_version_id="owver_plan",
                        row_id="plan-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 本规划用于指导学校事业发展。",
                    ),
                ],
            )

            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/document-units.jsonl"
                ),
                data=(
                    json.dumps(
                        {
                            "clean_text": "中央民族大学章程",
                            "doc_id": document_id,
                            "entitlement_groups": [],
                            "row_type": "heading",
                            "visibility_level": "public",
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                    + b"\n"
                ),
                content_type="application/x-ndjson",
            )
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()

            materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=True,
            )
            current_record = registry.current_version(document_id)
            self.assertIsNotNone(current_record)
            stale_record = replace(
                current_record,
                version_id="owregver:stale-title",
                content_hash="sha256:stale-title",
                is_current=False,
                status="superseded",
                document_units_object_key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/document-units.jsonl"
                ),
                canonical_markdown_object_key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/canonical.md"
                ),
                processed_object_keys=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/canonical.md",
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/document-units.jsonl",
                ),
            )
            registry.upsert(stale_record)
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/canonical.md"
                ),
                data=b"# stale title\n",
                content_type="text/markdown; charset=utf-8",
            )

            materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=True,
            )

            derived_keys = {
                key for bucket, key in object_store.objects if bucket == "campus-rag-derived"
            }
            self.assertFalse(any("中央民族大学章程--12ce0e9b" in key for key in derived_keys))
            self.assertTrue(
                any("中央民族大学事业发展-十三五-规划--12ce0e9b" in key for key in derived_keys)
            )

    def test_worker_materialization_report_includes_selected_documents_for_downstream_reuse(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            declarations_path = root / "projection-declarations.json"
            object_store_root = root / "object-store"
            worker_output_dir = root / "worker-output"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_report_contract_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_card",
                            raw_version_id="owver_card",
                            normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_card",
                raw_version_id="owver_card",
                normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                page_title="校 园 一 卡 通 管 理 规 定",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_card",
                        raw_version_id="owver_card",
                        row_id="card-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校 园 一 卡 通 管 理 规 定",
                    ),
                    _block(
                        raw_asset_id="owasset_card",
                        raw_version_id="owver_card",
                        row_id="card-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范校园一卡通管理，制定本规定。",
                    ),
                ],
            )

            materialize_worker_main(
                [
                    "--source-truth-output-dir",
                    str(output_dir),
                    "--declarations-path",
                    str(declarations_path),
                    "--output-dir",
                    str(worker_output_dir),
                    "--object-store-root",
                    str(object_store_root),
                ]
            )

            report = json.loads(
                (worker_output_dir / "materialization-report.json").read_text(encoding="utf-8")
            )
            summary = json.loads(
                (
                    worker_output_dir / "official-web-regulation-materialization-summary.json"
                ).read_text(encoding="utf-8")
            )

            self.assertEqual(report["materialized_document_count"], 1)
            self.assertEqual(len(report["selected_target_document_ids"]), 1)
            self.assertEqual(len(report["materialized_documents"]), 1)
            materialized = report["materialized_documents"][0]
            self.assertEqual(
                report["selected_target_document_ids"],
                [materialized["target_document_id"]],
            )
            self.assertEqual(materialized["target_corpus"], "regulations")
            self.assertEqual(materialized["target_collection"], "institutional_rules")
            self.assertEqual(materialized["source_channel"], "official_web")
            self.assertEqual(materialized["title"], "校园一卡通管理规定")
            self.assertEqual(materialized["title_raw"], "校 园 一 卡 通 管 理 规 定")
            self.assertEqual(
                materialized["normalization_quality"]["quality_verdict"],
                "passed",
            )
            self.assertEqual(len(materialized["canonical_markdown_sha256"]), 64)
            self.assertEqual(len(materialized["document_units_sha256"]), 64)
            self.assertEqual(
                summary["materialization_report"]["selected_target_document_ids"],
                report["selected_target_document_ids"],
            )

    def test_document_identity_stays_stable_across_title_cleanup(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
            )
            source_url = "https://met.example.edu/info/1024/1086.htm"

            first_record = _materialize_single_title(
                declarations_path=declarations_path,
                output_dir=output_dir,
                projection_dir=projection_dir,
                raw_asset_id="owasset_card",
                raw_version_id="owver_card",
                source_url=source_url,
                title="校 园 一 卡 通 管 理 规 定",
                target_matches=[regulation_match],
                work_dir=work_dir,
            )
            second_record = _materialize_single_title(
                declarations_path=declarations_path,
                output_dir=output_dir,
                projection_dir=projection_dir,
                raw_asset_id="owasset_card",
                raw_version_id="owver_card",
                source_url=source_url,
                title="中央民族大学校园一卡通管理规定",
                target_matches=[regulation_match],
                work_dir=work_dir,
            )

            self.assertEqual(first_record["document_id"], second_record["document_id"])

    def test_materializes_all_collected_live_source_pack_regulation_pages_when_present(
        self,
    ) -> None:
        source_pack_dir = (
            Path("var")
            / "official-web-source-pack-live-seam"
            / "owrun_source_pack_live_20260504T122734Z"
            / "collector-output"
        )
        if not source_pack_dir.exists():
            self.skipTest("live official-web source-pack evidence is not present")
        projection_dir = (
            Path("var")
            / "official-web-source-pack-live-seam"
            / "owrun_source_pack_live_20260504T122734Z"
            / "executions"
            / "owevt_completed_0f9f6de598f44845b2de924ba6ce3b90"
            / "projection-output"
        )
        if not projection_dir.exists():
            self.skipTest("live official-web projection evidence is not present")
        expected_urls = _materializable_regulation_urls(projection_dir)
        self.assertEqual(len(expected_urls), 11)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()
            report = materialize_official_web_regulation_candidates(
                source_truth_output_dir=source_pack_dir,
                projection_output_dir=root / "projection-output",
                work_dir=root / "work",
                declarations_path=Path(
                    "configs/sources/official_web/muc_public/projection-declarations.json"
                ),
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=True,
            )

            self.assertEqual(set(report.source_urls), expected_urls)
            self.assertEqual(report.candidate_count, len(expected_urls))
            self.assertEqual(report.materialized_document_count, len(expected_urls))
            records = registry.list_by_scope("regulations", "institutional_rules")
            self.assertEqual(len(records), len(expected_urls))
            self.assertEqual(
                {
                    record.source_uri
                    for record in records
                    if record.source_channel == "official_web"
                    and record.canonical_markdown_object_key
                    and record.document_units_object_key
                },
                expected_urls,
            )
            reader_report = publish_document_reader_assets(
                bucket_derived="campus-rag-derived",
                generated_at="2026-05-05T00:00:00+00:00",
                object_store=object_store,
                records=records,
            )
            self.assertEqual(reader_report.document_count, len(expected_urls))
            self.assertEqual(reader_report.public_entry_count, len(expected_urls))

    def test_materializes_regulation_candidates_into_multiple_selected_write_scopes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            student_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            scoped_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/scoped_rules",
                target_id="official-web-scoped-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_official_web_multi_scope_regulations",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_student_rule",
                            raw_version_id="owver_student_rule",
                            normalized_canonical_url="https://www.example.edu/rules/student-award.htm",
                            target_matches=[student_match],
                        ),
                        _page(
                            raw_asset_id="owasset_scoped_rule",
                            raw_version_id="owver_scoped_rule",
                            normalized_canonical_url="https://www.example.edu/rules/summer-lab.htm",
                            target_matches=[scoped_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_student_rule",
                raw_version_id="owver_student_rule",
                normalized_canonical_url="https://www.example.edu/rules/student-award.htm",
                page_title="中央民族大学学生奖学金评定办法",
                page_family="article_detail",
                target_matches=[student_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule",
                        raw_version_id="owver_student_rule",
                        row_id="student-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学学生奖学金评定办法",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule",
                        raw_version_id="owver_student_rule",
                        row_id="student-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范学生奖学金评定工作，制定本办法。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_scoped_rule",
                raw_version_id="owver_scoped_rule",
                normalized_canonical_url="https://www.example.edu/rules/summer-lab.htm",
                page_title="中央民族大学暑期实验室安全管理规定",
                page_family="article_detail",
                target_matches=[scoped_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_scoped_rule",
                        raw_version_id="owver_scoped_rule",
                        row_id="scoped-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学暑期实验室安全管理规定",
                    ),
                    _block(
                        raw_asset_id="owasset_scoped_rule",
                        raw_version_id="owver_scoped_rule",
                        row_id="scoped-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范暑期实验室开放期间的安全管理，制定本规定。",
                    ),
                ],
            )

            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()
            report = materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=True,
            )

            self.assertEqual(report.candidate_count, 2)
            self.assertEqual(report.materialized_document_count, 2)
            student_records = registry.list_by_scope("regulations", "student_rules")
            scoped_records = registry.list_by_scope("regulations", "scoped_rules")
            self.assertEqual(len(student_records), 1)
            self.assertEqual(len(scoped_records), 1)
            self.assertEqual(
                student_records[0].source_uri,
                "https://www.example.edu/rules/student-award.htm",
            )
            self.assertEqual(
                scoped_records[0].source_uri,
                "https://www.example.edu/rules/summer-lab.htm",
            )


if __name__ == "__main__":
    unittest.main()
