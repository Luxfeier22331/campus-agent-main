# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_institutional_regulation_semantic_regressions_support import *


class InstitutionalRegulationSemanticRegressionsTestPart02(
    InstitutionalRegulationSemanticRegressionsTestBase
):
    def test_procedure_titled_section_result_usage_clause_does_not_become_procedure_step(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-procedure-result-usage-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-result-usage-test:unit-0013",
                    clean_text=(
                        "第十三条 各级党组织考核为“好”的，作为申报上级党组织评优评先活动的依据；"
                        "考核为“较好”以上的，方可参评校内评优评先。"
                    ),
                    anchor={
                        "section_path": ["第四章 考核程序"],
                        "article_label": "第十三条",
                    },
                    metadata={
                        "title": "中央民族大学基层党组织考核办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertNotEqual(metadata.get("procedure_action"), "procedure_step")
        self.assertNotEqual(metadata.get("procedure_actor"), "responsible_party")

    def test_procedure_titled_section_prohibition_clause_does_not_become_procedure_step(
        self,
    ) -> None:
        record = _institutional_registry_record("institutional-procedure-prohibition-clause-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-procedure-prohibition-clause-test:unit-0007",
                    clean_text="（七）发放任何形式的个人补助；",
                    anchor={
                        "section_path": ["第二章 经费审批程序"],
                        "provision_label": "（七）",
                    },
                    metadata={
                        "title": "中央民族大学专项经费管理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertEqual(metadata["answer_role"], "exclusion_rule")
        self.assertIsNone(metadata.get("procedure_action"))
        self.assertIsNone(metadata.get("procedure_actor"))

    def test_official_web_planning_prose_does_not_emit_intro_contract(self) -> None:
        record = _institutional_registry_record("official_web_regulation:12ce0e9b47598c5d")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:12ce0e9b47598c5d:unit-0001",
                    clean_text=(
                        "积极推进学校治理体系和治理能力现代化，完善内部治理结构，"
                        "不断提升办学质量和服务水平。"
                    ),
                    anchor={
                        "section_path": ["中央民族大学事业发展“十三五”规划"],
                    },
                    metadata={
                        "title": "中央民族大学事业发展“十三五”规划",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
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
        self.assertEqual(metadata["answer_role"], "supporting_detail")
        self.assertIsNone(metadata.get("intro_scope"))
        self.assertIsNone(metadata.get("intro_target_roles"))

    def test_formal_regulation_reviewer_recusal_intro_does_not_become_procedure_step(self) -> None:
        record = _institutional_registry_record("institutional-recusal-intro-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-recusal-intro-test:unit-0022",
                    clean_text="第二十二条 调解委员会成员有下列情形之一者，当事人有权以书面形式申请要求其回避：",
                    anchor={
                        "section_path": ["第四章 调解程序"],
                        "article_label": "第二十二条",
                    },
                    metadata={
                        "title": "中央民族大学校内纠纷调解办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_official_web_eligibility_intro_does_not_emit_generic_procedure_step_fallback(
        self,
    ) -> None:
        record = _institutional_registry_record("official_web_regulation:de10f64c02d1be9b")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:de10f64c02d1be9b:unit-0130",
                    clean_text="\n".join(
                        [
                            "具有下列条件之一者，可申报六级职员岗位：",
                            "1．处级副职。",
                            "2．科级正职12年及以上。",
                            "3. 科级正职6年及以上，且具有高级专业技术职务。",
                        ]
                    ),
                    anchor={
                        "section_path": ["（三）六级职员岗位"],
                    },
                    metadata={
                        "title": "中央民族大学岗位设置与聘用管理暂行办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
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

        self.assertGreaterEqual(len(chunks), 4)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["display_text"], "具有下列条件之一者，可申报六级职员岗位：")
        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertEqual(metadata.get("condition_subject"), "generic_condition")
        self.assertEqual(metadata.get("intro_target_roles"), ("eligibility_condition",))
        self.assertEqual(metadata.get("intro_scope"), "eligibility_group")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_institutional_break_study_intro_keeps_non_procedure_intro_shape(self) -> None:
        record = _institutional_registry_record(
            "institutional_regulation:muc:中央民族大学研究生学籍管理办法:d11f18c41059"
        )
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id=(
                        "institutional_regulation:muc:中央民族大学研究生学籍管理办法:d11f18c41059:unit-0063"
                    ),
                    clean_text="研究生有下列情形之一者，应当办理休学手续：",
                    anchor={
                        "section_path": ["第五章 休学与复学"],
                        "article_label": "第二十三条",
                    },
                    metadata={
                        "title": "中央民族大学研究生学籍管理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertEqual(metadata.get("condition_subject"), "generic_condition")
        self.assertEqual(metadata.get("condition_group_subject"), "generic_condition")
        self.assertEqual(metadata.get("intro_scope"), "eligibility_group")
        self.assertEqual(metadata.get("intro_target_roles"), ("exclusion_rule",))
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_institutional_disposition_heading_does_not_emit_procedure_contract(self) -> None:
        record = _institutional_registry_record("institutional-disposition-heading-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-disposition-heading-test:unit-0001",
                    clean_text="第九条 导师违反立德树人规范行为的处理",
                    anchor={
                        "section_path": ["第四章 违反立德树人规范行为的认定与处理"],
                        "article_label": "第九条",
                    },
                    metadata={
                        "title": "中央民族大学全面落实研究生导师立德树人职责实施细则",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_action"))
        self.assertIsNone(metadata.get("procedure_actor"))

    def test_institutional_disposition_result_clause_does_not_emit_procedure_contract(self) -> None:
        record = _institutional_registry_record("institutional-disposition-result-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-disposition-result-test:unit-0002",
                    clean_text=(
                        "（二）认定为本细则第七条第一项至第五项的违反立德树人规范行为的，"
                        "给予解聘处理。"
                    ),
                    anchor={
                        "section_path": ["第四章 违反立德树人规范行为的认定与处理"],
                        "provision_label": "（二）",
                    },
                    metadata={
                        "title": "中央民族大学全面落实研究生导师立德树人职责实施细则",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_actor"))

    def test_institutional_agenda_apply_item_does_not_emit_procedure_contract(self) -> None:
        record = _institutional_registry_record("institutional-agenda-apply-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-agenda-apply-test:unit-0003",
                    clean_text="（4）各级各类人才计划、人才项目人选推荐申报。",
                    anchor={
                        "section_path": ["（二）事关教师队伍建设的事项"],
                        "provision_label": "（4）",
                    },
                    metadata={
                        "title": "中央民族大学学院党政联席会议议事规则",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_actor"))

    def test_institutional_retirement_intro_uses_intro_compatible_subject(self) -> None:
        record = _institutional_registry_record("institutional-retirement-intro-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="institutional-retirement-intro-test:unit-0004",
                    clean_text="学生有下列情形之一，给予退学处理：",
                    anchor={
                        "section_path": ["第六章 退学"],
                        "article_label": "第三十五条",
                    },
                    metadata={
                        "title": "中央民族大学本科学生学籍管理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
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
        self.assertEqual(metadata.get("intro_target_roles"), ("exclusion_rule",))
        self.assertNotEqual(metadata.get("condition_subject"), "generic_restriction")
        self.assertEqual(
            metadata.get("answer_ready_contract_validation_status"),
            "passed",
        )

    def test_institutional_eligibility_clause_with_pending_investigation_does_not_become_procedure(
        self,
    ) -> None:
        record = _institutional_registry_record("official_web_regulation:de10f64c02d1be9b")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:de10f64c02d1be9b:unit-0148",
                    clean_text="（5）正在接受纪律审查或司法调查尚未做出结论者；",
                    anchor={
                        "section_path": ["（四）七级职员岗位", "任职条件"],
                        "provision_label": "（5）",
                    },
                    metadata={
                        "title": "中央民族大学岗位设置与聘用管理暂行办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
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
        self.assertEqual(metadata["answer_role"], "eligibility_condition")
        self.assertNotEqual(metadata["condition_subject"], "application_procedure")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))
        self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")

    def test_institutional_misconduct_clause_does_not_emit_procedure_contract(self) -> None:
        chunks = self._build_chunks(
            document_id="institutional-misconduct-clause-test",
            rows=(
                self._row(
                    document_id="institutional-misconduct-clause-test",
                    root_unit_id="institutional-misconduct-clause-test:unit-0034",
                    clean_text="（七）在培养环节中签署虚假意见，违规委托他人填写培养各环节的鉴定意见或评审意见；",
                    section_path=("第四章 违反立德树人规范行为的认定与处理",),
                    title="中央民族大学全面落实研究生导师立德树人职责实施细则",
                    provision_label="（七）",
                    promotion_class="formal_regulation",
                ),
            ),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_institutional_tiebreak_ranking_clause_does_not_emit_procedure_contract(
        self,
    ) -> None:
        chunks = self._build_chunks(
            document_id="institutional-ranking-clause-test",
            rows=(
                self._row(
                    document_id="institutional-ranking-clause-test",
                    root_unit_id="institutional-ranking-clause-test:unit-0039",
                    clean_text="（四）总成绩相同者按学业成绩 A+学业成绩 B 由高至低排序；如上述成绩仍相同，则按学业成绩 A 由高至低排序。",
                    section_path=("第四章 遴选办法及程序",),
                    title="中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
                    provision_label="（四）",
                    promotion_class="formal_regulation",
                ),
            ),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_institutional_mixed_condition_clause_does_not_split_tail_into_procedure_step(
        self,
    ) -> None:
        chunks = self._build_chunks(
            document_id="institutional-mixed-tail-clause-test",
            rows=(
                self._row(
                    document_id="institutional-mixed-tail-clause-test",
                    root_unit_id="institutional-mixed-tail-clause-test:unit-0010",
                    clean_text="（三）因不可抗力情况、因病调课（需提供医疗证明，遇特殊情况，可先申请，3日内完善手续）的不计入调课次数；",
                    section_path=("第五条 调课要求和程序",),
                    title="中央民族大学本科课程临时调(停)课管理办法",
                    provision_label="（三）",
                    promotion_class="formal_regulation",
                ),
            ),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_institutional_official_web_planning_prose_does_not_emit_procedure_contract(
        self,
    ) -> None:
        chunks = self._build_chunks(
            document_id="official_web_regulation:planning-prose-procedure-test",
            rows=(
                self._row(
                    document_id="official_web_regulation:planning-prose-procedure-test",
                    root_unit_id="official_web_regulation:planning-prose-procedure-test:unit-0005",
                    clean_text=(
                        "12. 大学文化建设丰富多彩。我校60周年校庆工作取得圆满成功，时任中共中央政治局委员、"
                        "国务院副总理回良玉、国务委员刘延东等领导出席庆祝大会，进一步弘扬和传承了学校文化。"
                        "开设了民大名师纪念展，出版了民大名师纪念文集，对学生进行生动的爱校爱学教育。"
                        "发挥新媒体的重要作用，建立了官方微信、微博等新媒体宣传平台，宣传民大品牌。"
                        "通过知识竞赛、报告会等形式，加强民族团结主题教育，践行“美美与共，知行合一”的大学校训。"
                        "通过“十二五”建设，学校其他各项工作也都取得了长足进展，学校获中国关工委授予的"
                        "“全国科普基地”称号和“2015年北京国际田联世锦赛”优秀组织奖；顺利通过北京市“平安校园”验收；"
                        "学校办公室获“北京市教育事业统计工作优秀集体一等奖”，研究生院获“北京地区学位授予信息报送工作先进单位”，"
                        "后勤产业集团获“后勤节能先进集体”，离退休干部处获国家民委系统“老干部工作先进集体”。"
                    ),
                    section_path=("一、发展基础及面临的机遇与挑战", "（一）发展基础"),
                    title="中央民族大学事业发展“十三五”规划",
                    promotion_class="formal_regulation",
                ),
            ),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))


if __name__ == "__main__":
    unittest.main()
