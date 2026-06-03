# ruff: noqa: F403,F405
from __future__ import annotations

import unittest
from unittest.mock import patch

from tests.ingestion.test_official_web_regulation_materialization_support import *


class OfficialWebRegulationMaterializationTestPart02(unittest.TestCase):
    def test_worker_local_object_store_uses_local_registries_without_env_registry(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            declarations_path = root / "projection-declarations.json"
            worker_output_dir = root / "worker-output"
            object_store_root = root / "object-store"
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
                    "crawlRunId": "owrun_local_registry_boundary_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_local_registry",
                            raw_version_id="owver_local_registry",
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
                raw_asset_id="owasset_local_registry",
                raw_version_id="owver_local_registry",
                normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                page_title="校园一卡通管理规定",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_local_registry",
                        raw_version_id="owver_local_registry",
                        row_id="title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校园一卡通管理规定",
                    ),
                    _block(
                        raw_asset_id="owasset_local_registry",
                        raw_version_id="owver_local_registry",
                        row_id="p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范校园一卡通管理，制定本规定。",
                    ),
                ],
            )

            with (
                patch(
                    "campus_ingestion_worker.materialize_official_web_regulations."
                    "build_document_registry_from_env",
                    side_effect=AssertionError("document registry env must not be used"),
                ),
                patch(
                    "campus_ingestion_worker.materialize_official_web_regulations."
                    "build_raw_asset_registry_from_env",
                    side_effect=AssertionError("raw asset registry env must not be used"),
                ),
            ):
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

            self.assertTrue((worker_output_dir / "document-registry.snapshot.json").exists())
            self.assertTrue((worker_output_dir / "raw-asset-registry.snapshot.json").exists())

    def test_materialization_keeps_official_web_page_title_for_public_plan_documents(self) -> None:
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
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_staff_plan_title_regression",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_staff_plan_6451",
                            raw_version_id="owver_staff_plan_6451",
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
                raw_asset_id="owasset_staff_plan_6451",
                raw_version_id="owver_staff_plan_6451",
                normalized_canonical_url=source_url,
                page_title="中央民族大学事业发展“十三五”规划",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_staff_plan_6451",
                        raw_version_id="owver_staff_plan_6451",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学事业发展“十三五”规划",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_plan_6451",
                        raw_version_id="owver_staff_plan_6451",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text=(
                            "第一章 发展基础 根据《中央民族大学章程》，"
                            "学校制定中央民族大学事业发展“十三五”规划。"
                            "第一条 本规划用于指导学校事业发展。"
                        ),
                    ),
                ],
            )

            object_store = _FakeObjectStore()
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
            )

            record = registry.list_by_scope("regulations", "institutional_rules")[0]
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("# 中央民族大学事业发展“十三五”规划", canonical)
            self.assertNotIn("# 中央民族大学章程", canonical)
            self.assertEqual(units[0]["metadata"]["title"], "中央民族大学事业发展“十三五”规划")
            self.assertEqual(units[0]["metadata"]["title_raw"], "中央民族大学事业发展“十三五”规划")
            self.assertIn(
                "中央民族大学事业发展-十三五-规划", record.document_units_object_key or ""
            )
            self.assertNotIn("中央民族大学章程", record.document_units_object_key or "")

    def test_materialization_keeps_source_title_when_body_references_related_rule(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            source_url = "https://xxgk.muc.edu.cn/info/1247/4911.htm"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_student_transfer_title_regression",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_student_transfer_4911",
                            raw_version_id="owver_student_transfer_4911",
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
                raw_asset_id="owasset_student_transfer_4911",
                raw_version_id="owver_student_transfer_4911",
                normalized_canonical_url=source_url,
                page_title="本科生转专业实施细则",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_transfer_4911",
                        raw_version_id="owver_student_transfer_4911",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科生转专业实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_student_transfer_4911",
                        raw_version_id="owver_student_transfer_4911",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text=(
                            "为充分体现学校“以人为本、以学生为主体”的教育理念，"
                            "根据《中央民族大学本科学生学籍管理规定》关于学生转专业的有关条款，"
                            "结合学校实际情况，进一步健全转专业管理制度，特对原有相关办法进行修订。"
                            "一、基本原则（一）本办法的适用对象为一年级在籍在校本科学生。"
                        ),
                    ),
                ],
            )

            object_store = _FakeObjectStore()
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
            )

            record = registry.list_by_scope("regulations", "student_rules")[0]
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("# 本科生转专业实施细则", canonical)
            self.assertNotIn("# 中央民族大学本科学生学籍管理规定", canonical)
            self.assertEqual(units[0]["metadata"]["title"], "本科生转专业实施细则")
            self.assertEqual(units[0]["metadata"]["title_raw"], "本科生转专业实施细则")
            self.assertIn("本科生转专业实施细则", record.document_units_object_key or "")
            self.assertNotIn("本科学生学籍管理规定", record.document_units_object_key or "")

    def test_materialization_preserves_regulation_preface_and_drops_inline_link_child_duplicate(
        self,
    ) -> None:
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
            source_url = "https://xxgk.muc.edu.cn/info/1290/5651.htm"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_staff_position_preface_link_regression",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_staff_position_5651",
                            raw_version_id="owver_staff_position_5651",
                            normalized_canonical_url=source_url,
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            title = "中央民族大学岗位设置与聘用管理暂行办法"
            parent_dom_path = (
                "body[1] > div[4] > div[1] > div[2] > form[1] > div[1] > div[1] > div[1] > p[134]"
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_staff_position_5651",
                raw_version_id="owver_staff_position_5651",
                normalized_canonical_url=source_url,
                page_title=title,
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="head-title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text=title,
                        is_main_content=False,
                        dom_path="head[1] > title[1]",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="sidebar-heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="干部人事",
                        dom_path="body[1] > div[4] > div[1] > div[1] > h1[1]",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="title-1",
                        row_index=2,
                        block_order=2,
                        block_role="heading",
                        text=title,
                        dom_path=(
                            "body[1] > div[4] > div[1] > div[2] > form[1] > "
                            "div[1] > center[1] > h1[1]"
                        ),
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="preface-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text=(
                            "为切实做好学校岗位设置与聘用工作，根据《国家民委事业单位岗位设置管理实施意见》"
                            "等文件精神和经国家民委批复的《中央民族大学岗位设置方案》的有关规定，"
                            "制定本暂行办法。"
                        ),
                        dom_path=(
                            "body[1] > div[4] > div[1] > div[2] > form[1] > "
                            "div[1] > div[1] > div[1] > p[1]"
                        ),
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="chapter-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="第一章 总 则",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="section-1",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="一、岗位设置与聘用原则",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="item-17",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="(17) 国家科技支撑计划、国际科技合作计划、国家攀登计划、科技基础条件平台建设计划项目主持人。",
                        dom_path=parent_dom_path,
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="item-17-link",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="科技基础条件平台建设计划",
                        link_target="http://program.most.gov.cn/page/pds/mian1_DD.htm?planId=DD",
                        dom_path=f"{parent_dom_path} > a[1]",
                    ),
                ],
            )

            object_store = _FakeObjectStore()
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
            )

            record = registry.list_by_scope("regulations", "institutional_rules")[0]
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("为切实做好学校岗位设置与聘用工作", canonical)
            self.assertIn("制定本暂行办法。", canonical)
            self.assertIn(
                "为切实做好学校岗位设置与聘用工作", "\n".join(unit["clean_text"] for unit in units)
            )
            self.assertNotIn("\n干部人事\n", canonical)
            self.assertFalse(any(unit["clean_text"] == "干部人事" for unit in units))
            self.assertIn("科技基础条件平台建设计划项目主持人。", canonical)
            self.assertNotIn("项目主持人。\n科技基础条件平台建设计划", canonical)
            self.assertNotIn("项目主持人。科技基础条件平台建设计划", canonical)

    def test_materialization_drops_wrapper_heading_and_recovers_formal_title_from_body(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_student_rule_recovery_4871",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_student_rule_4871",
                            raw_version_id="owver_student_rule_4871",
                            normalized_canonical_url="https://xxgk.muc.edu.cn/info/1247/4871.htm",
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_student_rule_4871",
                raw_version_id="owver_student_rule_4871",
                normalized_canonical_url="https://xxgk.muc.edu.cn/info/1247/4871.htm",
                page_title="成人高等教育学籍管理",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="成人高等教育学籍管理",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学生工作",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="paragraph-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text=(
                            "中央民族大学成人高等学历教育学生学籍管理规定 "
                            "第一章 总则第一条 为加强我校成人高等学历教育学生的学籍管理，制定本规定。"
                            "第二条 本规定适用于我校成人高等学历教育学生。"
                        ),
                    ),
                ],
            )

            object_store = _FakeObjectStore()
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
            )

            record = registry.list_by_scope("regulations", "student_rules")[0]
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("# 中央民族大学成人高等学历教育学生学籍管理规定", canonical)
            self.assertNotIn("学生工作", canonical)
            self.assertEqual(units[0]["clean_text"], "中央民族大学成人高等学历教育学生学籍管理规定")
            self.assertFalse(any(unit["clean_text"] == "学生工作" for unit in units))

    def test_worker_scope_refresh_prunes_stale_local_document_artifact_directories(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            declarations_path = root / "projection-declarations.json"
            object_store_root = root / "object-store"
            worker_output_dir = root / "worker-output"
            stale_dir = (
                object_store_root
                / "campus-rag-derived"
                / "regulations"
                / "documents"
                / "institutional_rules"
                / "校-园-一-卡-通-管-理-规-定--old"
            )
            stale_dir.mkdir(parents=True)
            (stale_dir / "current-effective").mkdir()
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
                    "crawlRunId": "owrun_regulation_local_prune_test",
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
                    "--scope-refresh",
                ]
            )

            scope_dir = (
                object_store_root
                / "campus-rag-derived"
                / "regulations"
                / "documents"
                / "institutional_rules"
            )
            document_dirs = sorted(path.name for path in scope_dir.iterdir() if path.is_dir())
            self.assertEqual(len(document_dirs), 1)
            self.assertTrue(document_dirs[0].startswith("校园一卡通管理规定--"))


if __name__ == "__main__":
    unittest.main()
