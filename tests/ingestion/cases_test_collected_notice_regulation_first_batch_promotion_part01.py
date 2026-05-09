# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_collected_notice_regulation_first_batch_promotion_support import *


class CollectedNoticeRegulationFirstBatchPromotionTestsPart01(unittest.TestCase):
    def test_scoped_rule_document_units_split_non_article_chinese_heading_structure(
        self,
    ) -> None:
        document = _target_document(
            source_notice_id="620",
            collection="scoped_rules",
            canonical_markdown=(
                "# 测试规章 620\n\n"
                "一、招募对象\n\n"
                "申请者须符合学校研究生支教团选拔条件，并按要求提交材料。\n\n"
                "（一）报名条件\n\n"
                "申请者应具有良好政治素质、学业成绩和志愿服务经历。\n\n"
                "（二）选拔程序\n\n"
                "学院完成资格审查后，学校统一组织面试并公示结果。\n\n"
                "二、组织管理\n\n"
                "入选成员应按学校统一安排完成培训、派遣和服务期管理。"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        body_rows = [row for row in rows if row["unit_type"] == "scoped_rule_body"]
        self.assertGreaterEqual(len(body_rows), 5)
        top_heading = next(row for row in body_rows if row["clean_text"] == "一、招募对象")
        self.assertEqual(top_heading["row_type"], "heading")
        self.assertFalse(top_heading["metadata"]["is_answer_bearing"])
        self.assertEqual(top_heading["metadata"]["section_path"], ["一、招募对象"])
        subsection_heading = next(row for row in body_rows if row["clean_text"] == "（一）报名条件")
        self.assertEqual(
            subsection_heading["metadata"]["section_path"],
            ["一、招募对象", "（一）报名条件"],
        )
        self.assertTrue(
            any(
                row["clean_text"] == "申请者应具有良好政治素质、学业成绩和志愿服务经历。"
                and row["metadata"]["section_path"] == ["一、招募对象", "（一）报名条件"]
                for row in body_rows
            )
        )
        self.assertFalse(
            any(
                row["metadata"]["is_answer_bearing"]
                and row["metadata"]["section_path"] == [row["clean_text"]]
                for row in body_rows
            )
        )

    def test_notice_body_source_document_keeps_notice_body_lineage(self) -> None:
        document = _target_document(
            source_notice_id="191705",
            collection="institutional_rules",
            canonical_markdown=(
                "# 重要通知--中央民族大学丰台校区就医管理办法（暂行）\n\n"
                "1、增加中国航天科工集团七三一医院为丰台校区合同医院。\n\n"
                "2、为保证就医需求，目前在丰台校区内暂设立临时医疗点。"
            ),
        )
        document["source_document_ids"] = ["notice:muc_internal_portal:191705"]
        document["source_scope"] = {
            "source_channel": "authenticated_notice_portal",
            "source_surface": "notice_body",
            "source_corpus": "campus_notices",
            "source_collection": "internal_notice",
        }

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        first_metadata = rows[0]["metadata"]
        self.assertEqual(first_metadata["semantic_owner_kind"], "notice_body")
        self.assertEqual(
            first_metadata["semantic_owner_document_id"],
            "notice:muc_internal_portal:191705",
        )
        self.assertEqual(first_metadata["source_attachment_document_id"], "")

    def test_scoped_rule_document_units_mark_doc_number_and_article_title_as_non_answer_bearing(
        self,
    ) -> None:
        document = _target_document(
            source_notice_id="481",
            collection="scoped_rules",
            canonical_markdown=(
                "# 中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法（试行）\n\n"
                "民大校发（2021）148号\n\n"
                "第一章 总 则\n\n"
                "第五条 报考条件\n\n"
                "申请者应符合学校规定的政治素质、学业水平和推荐免试资格要求。"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        doc_number = next(row for row in rows if row["clean_text"] == "民大校发（2021）148号")
        self.assertEqual(doc_number["row_type"], "heading")
        self.assertFalse(doc_number["metadata"]["is_answer_bearing"])

        article_title = next(row for row in rows if row["clean_text"] == "第五条 报考条件")
        self.assertEqual(article_title["row_type"], "heading")
        self.assertFalse(article_title["metadata"]["is_answer_bearing"])
        self.assertEqual(article_title["metadata"]["article_label"], "第五条")

        answer_row = next(
            row
            for row in rows
            if row["clean_text"] == "申请者应符合学校规定的政治素质、学业水平和推荐免试资格要求。"
        )
        self.assertEqual(answer_row["row_type"], "paragraph")
        self.assertTrue(answer_row["metadata"]["is_answer_bearing"])

    def test_article_short_sentence_remains_answer_bearing_when_not_title_phrase(self) -> None:
        document = _target_document(
            source_notice_id="481",
            collection="scoped_rules",
            canonical_markdown=(
                "# 测试规章 481\n\n"
                "第五条 本办法由研究生院负责解释\n\n"
                "第六条 申请者应符合学校规定条件"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        article_rows = [
            row
            for row in rows
            if row["clean_text"]
            in {"第五条 本办法由研究生院负责解释", "第六条 申请者应符合学校规定条件"}
        ]
        self.assertEqual(len(article_rows), 2)
        self.assertTrue(all(row["row_type"] == "paragraph" for row in article_rows))
        self.assertTrue(all(row["metadata"]["is_answer_bearing"] for row in article_rows))

    def test_document_units_mark_tiny_layout_fragments_as_non_answer_bearing(self) -> None:
        document = _target_document(
            source_notice_id="620",
            collection="scoped_rules",
            canonical_markdown=(
                "# 中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法\n\n"
                "（试行）\n\n"
                "第一章 总则\n\n"
                "第一条 推荐类型\n\n"
                "（一） 普通免试生；\n\n"
                "申请者应符合学校推荐免试资格要求。\n\n"
                "一类奖项包括：\n\n"
                "国家级竞赛奖项。\n\n"
                "义务：\n\n"
                "合作单位应提供必要实践条件。\n\n"
                "附件\n\n"
                "附件1\n\n"
                "2026年3月24日印发"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        rows_by_text = {row["clean_text"]: row for row in rows}

        for text in (
            "（试行）",
            "第一条 推荐类型",
            "一类奖项包括：",
            "义务：",
            "附件",
            "附件1",
            "2026年3月24日印发",
        ):
            self.assertEqual(rows_by_text[text]["row_type"], "heading")
            self.assertFalse(rows_by_text[text]["metadata"]["is_answer_bearing"])

        self.assertEqual(rows_by_text["（一） 普通免试生；"]["row_type"], "paragraph")
        self.assertTrue(rows_by_text["（一） 普通免试生；"]["metadata"]["is_answer_bearing"])
        self.assertTrue(
            rows_by_text["申请者应符合学校推荐免试资格要求。"]["metadata"]["is_answer_bearing"]
        )
        self.assertTrue(rows_by_text["国家级竞赛奖项。"]["metadata"]["is_answer_bearing"])
        self.assertEqual(
            rows_by_text["国家级竞赛奖项。"]["metadata"]["section_path"][-1],
            "一类奖项包括：",
        )
        self.assertEqual(
            rows_by_text["合作单位应提供必要实践条件。"]["metadata"]["section_path"][-1],
            "义务：",
        )

    def test_document_units_do_not_accumulate_replaced_short_context_headings(
        self,
    ) -> None:
        document = _target_document(
            source_notice_id="623",
            collection="scoped_rules",
            canonical_markdown=(
                "# 测试规章 623\n\n"
                "第三章 遴选资格和条件\n\n"
                "一类奖项包括：\n\n"
                "国家级竞赛奖项。\n\n"
                "二类奖项包括：\n\n"
                "省部级竞赛奖项。\n\n"
                "（二）普通类专业学生的奖项要求\n\n"
                "在校期间至少获得一类奖项 1 项或二类奖项 3 项。"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        rows_by_text = {row["clean_text"]: row for row in rows}

        self.assertEqual(
            rows_by_text["国家级竞赛奖项。"]["metadata"]["section_path"],
            ["第三章 遴选资格和条件", "一类奖项包括："],
        )
        self.assertEqual(
            rows_by_text["省部级竞赛奖项。"]["metadata"]["section_path"],
            ["第三章 遴选资格和条件", "二类奖项包括："],
        )
        self.assertEqual(
            rows_by_text["（二）普通类专业学生的奖项要求"]["metadata"]["section_path"],
            ["第三章 遴选资格和条件", "（二）普通类专业学生的奖项要求"],
        )
        self.assertEqual(
            rows_by_text["在校期间至少获得一类奖项 1 项或二类奖项 3 项。"]["metadata"][
                "section_path"
            ],
            ["第三章 遴选资格和条件", "（二）普通类专业学生的奖项要求"],
        )

    def test_document_units_do_not_accumulate_body_list_items_in_section_path(self) -> None:
        document = _target_document(
            source_notice_id="621",
            collection="scoped_rules",
            canonical_markdown=(
                "# 测试规章 621\n\n"
                "一、导师职责\n\n"
                "（一）应遵守学校纪律要求；\n\n"
                "（二）应完成培养指导任务；\n\n"
                "导师应定期检查学生培养进展。"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        rows_by_text = {row["clean_text"]: row for row in rows}

        self.assertEqual(
            rows_by_text["（一）应遵守学校纪律要求；"]["metadata"]["section_path"],
            ["一、导师职责"],
        )
        self.assertEqual(
            rows_by_text["（二）应完成培养指导任务；"]["metadata"]["section_path"],
            ["一、导师职责"],
        )
        self.assertNotIn(
            "（一）应遵守学校纪律要求；",
            rows_by_text["导师应定期检查学生培养进展。"]["metadata"]["section_path"],
        )
        self.assertEqual(
            rows_by_text["导师应定期检查学生培养进展。"]["metadata"]["section_path"],
            ["一、导师职责"],
        )

    def test_document_units_do_not_promote_body_intro_sentence_with_comma_to_section_path(
        self,
    ) -> None:
        document = _target_document(
            source_notice_id="622",
            collection="institutional_rules",
            canonical_markdown=(
                "# 测试规章 622\n\n"
                "第四章 处理\n\n"
                "（一）被认定为有违反立德树人规范行为的导师，给予下列处理：\n\n"
                "1、暂停研究生指导和教学工作。\n\n"
                "2、本年度综合考核不合格。"
            ),
        )

        import_input = build_document_import_input(document)
        rows = [
            json.loads(line)
            for line in import_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        rows_by_text = {row["clean_text"]: row for row in rows}

        self.assertEqual(
            rows_by_text["（一）被认定为有违反立德树人规范行为的导师，给予下列处理："]["row_type"],
            "paragraph",
        )
        self.assertEqual(
            rows_by_text["1、暂停研究生指导和教学工作。"]["metadata"]["section_path"],
            ["第四章 处理"],
        )
        self.assertNotIn(
            "（一）被认定为有违反立德树人规范行为的导师，给予下列处理：",
            rows_by_text["2、本年度综合考核不合格。"]["metadata"]["section_path"],
        )

    def test_selection_requires_downstream_ready_candidates_and_passed_consistency(self) -> None:
        selection = build_first_batch_regulation_selection(
            candidate_audit=_candidate_audit(),
            consistency_report=_consistency_report(),
            institutional_materialization=_materialization_report(
                target_collection="institutional_rules",
                documents=[
                    _target_document(source_notice_id="594", collection="institutional_rules")
                ],
            ),
            scoped_materialization=_materialization_report(
                target_collection="scoped_rules",
                documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
            ),
            selected_notice_ids=("594", "620"),
            generated_at="2026-04-30T00:00:00+00:00",
        )

        self.assertEqual(selection["schema_version"], FIRST_BATCH_SELECTION_SCHEMA_VERSION)
        self.assertEqual(selection["phase"], PHASE_09_ID)
        self.assertEqual(selection["selected_notice_ids"], ["594", "620"])
        self.assertEqual(selection["selected_count"], 2)
        self.assertEqual(
            selection["selected_counts_by_collection"],
            {"institutional_rules": 1, "scoped_rules": 1},
        )
        self.assertEqual(
            selection["blocked_counts"],
            {"manual_review": 1, "needs_multimodal": 1},
        )
        self.assertFalse(selection["query_serving_opened"])
        self.assertFalse(selection["rag_release_opened"])

    def test_selection_rejects_unadmitted_or_not_ready_selected_candidate(self) -> None:
        candidate_audit = _candidate_audit()
        candidate_audit["candidates"][0]["owner_text_status"] = "not_ready"

        with self.assertRaisesRegex(ValueError, "owner_text_status=ready"):
            build_first_batch_regulation_selection(
                candidate_audit=candidate_audit,
                consistency_report=_consistency_report(),
                institutional_materialization=_materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            )

    def test_selection_rejects_failed_consistency_or_open_serving_report(self) -> None:
        consistency = _consistency_report()
        consistency["verdict"] = "failed"

        with self.assertRaisesRegex(ValueError, "consistency report verdict must be passed"):
            build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=consistency,
                institutional_materialization=_materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            )

        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
        )
        institutional["query_serving_enabled"] = True

        with self.assertRaisesRegex(ValueError, "query serving must stay closed"):
            build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=_consistency_report(),
                institutional_materialization=institutional,
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            )

    def test_dry_run_materialization_does_not_write_registry_or_object_store(self) -> None:
        registry = InMemoryDocumentRegistry((_existing_scoped_rule_record(),))
        object_store = _FakeObjectStore(_source_ref_objects())

        report = materialize_first_batch_regulation_selection(
            selection=build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=_consistency_report(),
                institutional_materialization=_materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
                scoped_materialization=_materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
                selected_notice_ids=("594", "620"),
            ),
            institutional_materialization=_materialization_report(
                target_collection="institutional_rules",
                documents=[
                    _target_document(source_notice_id="594", collection="institutional_rules")
                ],
            ),
            scoped_materialization=_materialization_report(
                target_collection="scoped_rules",
                documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
            ),
            registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(),
            object_store=object_store,
            execute=False,
            env=_object_store_env(),
        )

        self.assertEqual(report["mode"], "dry_run")
        self.assertFalse(report["write_enabled"])
        self.assertEqual(len(registry.list_by_scope("regulations", "institutional_rules")), 0)
        self.assertEqual(len(registry.list_by_scope("regulations", "scoped_rules")), 1)
        self.assertEqual(object_store.puts, [])

    def test_execute_writes_selected_documents_and_preserves_unselected_existing_rows(self) -> None:
        registry = InMemoryDocumentRegistry((_existing_scoped_rule_record(),))
        object_store = _FakeObjectStore(_source_ref_objects())
        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
        )
        scoped = _materialization_report(
            target_collection="scoped_rules",
            documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
        )

        report = materialize_first_batch_regulation_selection(
            selection=build_first_batch_regulation_selection(
                candidate_audit=_candidate_audit(),
                consistency_report=_consistency_report(),
                institutional_materialization=institutional,
                scoped_materialization=scoped,
                selected_notice_ids=("594", "620"),
            ),
            institutional_materialization=institutional,
            scoped_materialization=scoped,
            registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(),
            object_store=object_store,
            execute=True,
            env=_object_store_env(),
        )

        self.assertEqual(report["mode"], "execute")
        self.assertTrue(report["write_enabled"])
        self.assertEqual(report["materialized_document_count"], 2)
        self.assertEqual(
            report["target_scope_postflight_document_counts"],
            {
                "regulations/institutional_rules": 1,
                "regulations/scoped_rules": 2,
            },
        )
        self.assertEqual(
            {
                record.document_id
                for record in registry.list_by_scope("regulations", "scoped_rules")
            },
            {
                "existing:scoped-rule",
                "institutional_regulation:muc:620",
            },
        )
        selected_record = registry.list_by_scope("regulations", "institutional_rules")[0]
        self.assertEqual(selected_record.source_channel, "authenticated_notice_portal")
        self.assertEqual(
            selected_record.import_source,
            "collected_notice_regulation_first_batch_promotion",
        )
        self.assertEqual(selected_record.source_uri, "https://my.muc.edu.cn/file/594.pdf")
        self.assertEqual(len(selected_record.source_observations), 1)
        self.assertEqual(
            selected_record.source_observations[0].source_channel,
            "authenticated_notice_portal",
        )
        rows = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=selected_record.document_units_object_key or "",
        )
        first_row = json.loads(rows.decode("utf-8").splitlines()[0])
        self.assertEqual(first_row["metadata"]["source_notice_ids"], ["594"])
        self.assertEqual(
            first_row["metadata"]["normalizer_version"],
            REGULATION_CANONICAL_NORMALIZER_VERSION,
        )
        self.assertEqual(
            first_row["metadata"]["cleaning_policy_version"],
            "institutional_rules_cleaning_v1",
        )
        self.assertEqual(
            first_row["metadata"]["normalization_quality"]["quality_verdict"],
            "passed",
        )
        by_document_id = {
            item["target_document_id"]: item for item in report["materialized_documents"]
        }
        materialized = by_document_id["institutional_regulation:muc:594"]
        self.assertEqual(materialized["normalization_quality"]["quality_verdict"], "passed")
        self.assertEqual(
            materialized["canonical_markdown_object_key"],
            selected_record.canonical_markdown_object_key,
        )
        self.assertEqual(
            materialized["document_units_object_key"],
            selected_record.document_units_object_key,
        )
        self.assertEqual(len(materialized["canonical_markdown_sha256"]), 64)
        self.assertEqual(len(materialized["document_units_sha256"]), 64)
        self.assertFalse(report["query_serving_opened"])
        self.assertFalse(report["rag_release_opened"])

        scoped_record = registry.current_version(
            "institutional_regulation:muc:620",
            preferred_revision_tracks=("current-effective",),
        )
        self.assertIsNotNone(scoped_record)
        scoped_rows = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=scoped_record.document_units_object_key or "",
        )
        scoped_first_row = json.loads(scoped_rows.decode("utf-8").splitlines()[0])
        self.assertEqual(
            scoped_first_row["metadata"]["source_notice_release_time"],
            "2024-11-16 18:58:28",
        )
        self.assertEqual(
            scoped_first_row["metadata"]["document_nature"],
            "annual_cycle_rule",
        )
        self.assertEqual(scoped_first_row["metadata"]["cycle_year"], "2024")
        self.assertEqual(scoped_first_row["metadata"]["school_unit_name"], "新闻与传播学院")

    def test_execute_rejects_selected_document_without_passed_normalization_quality(self) -> None:
        institutional = _materialization_report(
            target_collection="institutional_rules",
            documents=[
                _target_document(
                    source_notice_id="594",
                    collection="institutional_rules",
                    quality_verdict="flagged_manual_review",
                )
            ],
        )
        scoped = _materialization_report(
            target_collection="scoped_rules",
            documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
        )

        with self.assertRaisesRegex(ValueError, "normalization quality must be passed"):
            materialize_first_batch_regulation_selection(
                selection=build_first_batch_regulation_selection(
                    candidate_audit=_candidate_audit(),
                    consistency_report=_consistency_report(),
                    institutional_materialization=institutional,
                    scoped_materialization=scoped,
                    selected_notice_ids=("594", "620"),
                ),
                institutional_materialization=institutional,
                scoped_materialization=scoped,
                registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
                object_store=_FakeObjectStore(_source_ref_objects()),
                execute=True,
                env=_object_store_env(),
            )


if __name__ == "__main__":
    unittest.main()
