from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    _institutional_registry_record,
    _registry_record_for_document,
    _structured_row,
    build_collection_semantic_metadata,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    decide_answer_role,
    json,
)


class HandbookChunkingPipelinePart04Test(unittest.TestCase):
    def test_answer_ready_chunk_metadata_emits_contract_validation_result(self) -> None:
        record = _registry_record_for_document("handbook:test-contract-validation-metadata")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-contract-validation-metadata",
                    clean_text="申请人提交书面申请。",
                    anchor={
                        "section_path": ["第三章 申请程序"],
                        "article_label": "第四条",
                        "provision_label": "（一）",
                    },
                    metadata={"title": "示例大学学生申诉处理办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")
        self.assertEqual(
            metadata["answer_ready_contract_validation_severity"],
            "release_blocking",
        )
        self.assertEqual(metadata["answer_ready_contract_validation_issues"], ())
        self.assertIn(
            "condition_group_id",
            metadata["answer_ready_contract_required_fields"],
        )

    def test_answer_ready_chunk_metadata_emits_contract_validation_failures(self) -> None:
        record = _registry_record_for_document("handbook:test-contract-validation-failure")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-contract-validation-failure",
                    clean_text="参评学生应符合下列条件之一:",
                    metadata={
                        "title": "示例大学本科学生国家奖学金评审办法",
                        "answer_role": "eligibility_intro",
                        "role_confidence": "high",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")
        self.assertEqual(
            metadata["answer_ready_contract_validation_severity"],
            "release_blocking",
        )
        self.assertEqual(metadata["intro_target_roles"], ("eligibility_condition",))
        self.assertEqual(metadata["intro_scope"], "eligibility_group")
        self.assertEqual(
            metadata["introduced_condition_group_id"],
            "article-contract-validation-failure:generic_condition",
        )
        self.assertEqual(metadata["answer_ready_contract_validation_issues"], ())

    def test_policy_page_procedure_substep_with_application_form_stays_procedure_step(self) -> None:
        record = _registry_record_for_document("handbook:test-overseas-study-procedure-step")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="policy_page",
                    root_unit_id="policy-page-0002",
                    clean_text=(
                        "(2)学生根据认定结果填写“示例大学交换学生课程学分成绩认定申请表”,"
                        "并将填好后的表交给所在院系主管教学院长(主任)审查、签字,并加盖院系公章。"
                    ),
                    anchor={
                        "section_path": [
                            "第三章 学籍管理",
                            "(五)认定程序",
                            "1.学生申请",
                            "2.院系认定境外课程、学分、成绩",
                        ],
                        "provision_label": "(2)",
                    },
                    metadata={"title": "示例大学本科生境外留学管理办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")

    def test_official_web_review_step_under_selection_procedure_stays_procedure_step(self) -> None:
        record = _institutional_registry_record("official-web-regulation-selection-procedure-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:e0f2bc4afa91a6a1:unit-0018",
                    clean_text=(
                        "（二）研究生院复评。院系将初评结果汇总，附参评材料盖公章后报至研究生院，"
                        "由研究生院完成材料复审及评选工作。"
                    ),
                    anchor={
                        "section_path": ["五、评选程序"],
                        "provision_label": "（二）",
                    },
                    metadata={
                        "title": "示例大学研究生宝钢优秀学生奖评选实施办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")

    def test_student_rules_as_below_procedure_text_is_not_treated_as_example_evidence(
        self,
    ) -> None:
        decision = decide_answer_role(
            text="(1)审核无误后,向全校进行公示。",
            prefix_text="按如下程序办理:",
        )

        self.assertEqual(decision["answer_role"], "procedure_step")
        self.assertEqual(decision["role_confidence"], "high")

    def test_recognition_procedure_scope_single_step_with_form_submission_stays_procedure_step(
        self,
    ) -> None:
        decision = decide_answer_role(
            text=(
                "(2)学生根据认定结果填写“示例大学交换学生课程学分成绩认定申请表”,"
                "并将填好后的表交给所在院系主管教学院长(主任)审查、签字,并加盖院系公章。"
            ),
            prefix_text="认定程序",
        )

        self.assertEqual(decision["answer_role"], "procedure_step")
        self.assertEqual(decision["role_confidence"], "high")

    def test_selection_procedure_review_step_stays_procedure_step(self) -> None:
        decision = decide_answer_role(
            text=(
                "（二）研究生院复评。院系将初评结果汇总，附参评材料盖公章后报至研究生院，"
                "由研究生院完成材料复审及评选工作。"
            ),
            prefix_text="评选程序",
        )

        self.assertEqual(decision["answer_role"], "procedure_step")
        self.assertEqual(decision["role_confidence"], "high")

    def test_student_rules_release_semantics_retains_procedure_step_over_time_rule(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_registry_record_for_document("handbook:test-procedure-release"),
            unit_type="article_body",
            anchor={
                "section_path": ["第四章 专业方向调整"],
                "article_label": "第十五条",
            },
            metadata={"title": "示例大学本科生专业调整实施办法"},
            text=(
                "专业方向调整程序\n"
                "一、院系在学校开展转专业的时间内开展本单位内的专业方向调整工作,"
                "包括接受申请、审核、公示等。"
            ),
        )

        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["role_confidence"], "high")

    def test_student_rules_release_semantics_promotes_procedure_over_eligibility_example(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_registry_record_for_document("handbook:test-procedure-release-example"),
            unit_type="article_body",
            anchor={
                "section_path": ["第四章 推荐程序"],
                "article_label": "第十七条",
                "provision_label": "(1)",
            },
            metadata={"title": "示例大学推荐应届本科毕业生免试攻读硕士学位研究生管理办法"},
            text="(1)符合条件的申请人数不多于当年公布的名额数,审核无误后,向全校进行公示。",
        )

        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["role_confidence"], "high")

    def test_student_rules_release_semantics_marks_procedure_intro_as_typed_intro(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_registry_record_for_document("handbook:test-procedure-intro"),
            unit_type="article_body",
            anchor={
                "section_path": ["第四章 违规行为处理程序"],
                "article_label": "第十二条",
            },
            metadata={"title": "示例大学学生考试违规认定与处理办法"},
            text=(
                "学生在考试过程中实施违纪、作弊行为的,考试工作人员应及时予以纠正并如实记录,"
                "对学生用于作弊的材料、工具等,应予暂扣,并按如下程序办理:"
            ),
        )

        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertEqual(metadata["content_role"], "eligibility")
        self.assertEqual(metadata["semantic_role"], "intro")
        self.assertEqual(metadata["claim_type"], "condition")
        self.assertEqual(metadata["role_confidence"], "high")

    def test_release_semantics_preserves_explicit_regulation_body_without_finer_body_role(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_institutional_registry_record("official-web-regulation-body-support"),
            unit_type="institutional_regulation_block",
            anchor={
                "section_path": ["第一章 总则"],
                "article_label": "第一条",
            },
            metadata={
                "title": "示例大学关于学生使用人工智能的指导意见",
                "content_role": "regulation_body",
            },
            text="为规范学生使用人工智能，制定本指导意见。",
        )

        self.assertEqual(metadata["content_role"], "regulation_body")

    def test_student_rules_single_enumerated_procedure_step_keeps_procedure_role(self) -> None:
        record = _registry_record_for_document("handbook:test-single-enumerated-procedure")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-single-procedure",
                    clean_text="1. 学生本人提交解除处分申请材料。",
                    anchor={
                        "section_path": ["示例大学解除学生纪律处分实施办法", "解除程序"],
                        "article_label": "第三条",
                    },
                    metadata={"title": "示例大学解除学生纪律处分实施办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertEqual(metadata["clause_unit_id"], "article-single-procedure:1")
        self.assertEqual(metadata["procedure_action"], "submit_materials")
        self.assertEqual(metadata["procedure_actor"], "student")

    def test_student_rules_single_enumerated_procedure_step_infers_action_type_from_structural_context(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-single-enumerated-procedure-context")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-single-procedure-context",
                    clean_text="1. 学生本人提交申请材料。",
                    anchor={
                        "section_path": ["解除程序"],
                        "article_label": "第三条",
                    },
                    metadata={"title": "示例大学解除学生纪律处分实施办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertEqual(metadata["action_type"], "lift_discipline")
        self.assertEqual(metadata["procedure_action"], "submit_materials")

    def test_student_rules_example_context_does_not_leak_into_following_procedure_list(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-example-then-procedure")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-example-then-procedure",
                    clean_text="\n".join(
                        [
                            "参评学生还须具备以下条件之一:",
                            "（1）在学术研究上取得显著成绩。",
                            "（2）在体育竞赛中取得显著成绩。",
                            "按如下程序办理:",
                            "1. 教务处汇总审核。",
                            "2. 公示期应不少于7天。",
                        ]
                    ),
                    metadata={"title": "示例大学本科学生国家奖学金评审办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        procedure_chunks = [
            chunk
            for chunk in chunks
            if "教务处汇总审核" in chunk.metadata["display_text"]
            or "公示期应不少于7天" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(procedure_chunks), 2)
        self.assertTrue(
            all(chunk.metadata["answer_role"] == "procedure_step" for chunk in procedure_chunks)
        )

    def test_mixed_security_condition_and_procedure_reuses_shared_condition_subject_resolution(
        self,
    ) -> None:
        record = _institutional_registry_record("official-web-regulation-security-mixed-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-security-mixed-test:unit-0001",
                    clean_text=(
                        "（一）信息系统建设须达到学校安全等级要求；经信息化建设管理处核准后接入校园网。"
                    ),
                    anchor={
                        "section_path": ["第四章 信息系统管理"],
                        "article_label": "第八条",
                        "provision_label": "（一）",
                    },
                    metadata={
                        "title": "示例大学信息系统管理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 2)
        condition_chunk = next(
            chunk for chunk in chunks if "达到学校安全等级要求" in chunk.metadata["display_text"]
        )
        procedure_chunk = next(
            chunk for chunk in chunks if "核准后接入校园网" in chunk.metadata["display_text"]
        )
        self.assertEqual(condition_chunk.metadata["answer_role"], "eligibility_condition")
        self.assertEqual(
            condition_chunk.metadata["condition_subject"],
            "security_or_confidentiality_requirement",
        )
        self.assertEqual(
            condition_chunk.metadata["condition_group_subject"],
            "security_or_confidentiality_requirement",
        )
        self.assertEqual(procedure_chunk.metadata["answer_role"], "procedure_step")
        self.assertEqual(
            procedure_chunk.metadata["condition_group_id"],
            condition_chunk.metadata["condition_group_id"],
        )

    def test_student_rules_ordinary_but_clause_is_not_exception_rule(self) -> None:
        record = _registry_record_for_document("handbook:test-ordinary-but")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-condition",
                    clean_text="\n".join(
                        [
                            "申请专项奖学金应符合以下条件:",
                            "1. 品行端正,但仍需按学院要求提交证明材料。",
                            "2. 学习态度认真。",
                        ]
                    ),
                    metadata={"title": "示例大学本科学生专项奖学金评定办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        condition_chunks = [
            chunk for chunk in chunks if "品行端正" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(condition_chunks), 1)
        self.assertEqual(condition_chunks[0].metadata["answer_role"], "eligibility_condition")
        self.assertEqual(condition_chunks[0].metadata["role_confidence"], "high")
        self.assertIn("eligibility_condition", condition_chunks[0].metadata["role_reason"])
        intro_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] == "申请专项奖学金应符合以下条件:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        self.assertEqual(intro_chunks[0].metadata["answer_role"], "eligibility_intro")

    def test_student_rules_supporting_detail_has_low_confidence_reason(self) -> None:
        record = _registry_record_for_document("handbook:test-supporting-detail")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-supporting-detail",
                    clean_text="\n".join(
                        [
                            "申请奖学金应符合以下条件:",
                            "1. 本办法自公布之日起施行。",
                            "2. 申请人应当品行端正。",
                        ]
                    ),
                    metadata={"title": "示例大学学生管理规定"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        detail_chunks = [
            chunk for chunk in chunks if "自公布之日起施行" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(detail_chunks), 1)
        self.assertEqual(detail_chunks[0].metadata["answer_role"], "supporting_detail")
        self.assertEqual(detail_chunks[0].metadata["role_confidence"], "low")
        self.assertEqual(detail_chunks[0].metadata["is_answer_bearing"], False)
        self.assertIn("terminal_provision", detail_chunks[0].metadata["role_reason"])

    def test_student_rules_aggregated_answer_bearing_chunk_gets_role_confidence(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-aggregated-answer-role")
        structured_payload = "\n".join(
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id=f"article-00{index}",
                    clean_text=text,
                    anchor={
                        "section_path": ["第一章 总则"],
                        "article_label": f"第{index}条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "示例大学本科创新教育实施办法"},
                ),
                ensure_ascii=False,
            )
            for index, text in enumerate(
                (
                    "第一条 创新教育以加强学生的实践能力为先导，以拓展学生的发现能力为重点。",
                    "第二条 创新教育应贯穿于我校人才培养的每个教学环节。",
                    "第三条 课程建设是全面开展创新教育的基础。",
                    "第四条 学校鼓励学生积极参与科学研究活动和学科竞赛活动。",
                ),
                start=1,
            )
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "supporting_detail")
        self.assertEqual(metadata["role_confidence"], "low")
        self.assertTrue(metadata["role_reason"])


if __name__ == "__main__":
    unittest.main()
