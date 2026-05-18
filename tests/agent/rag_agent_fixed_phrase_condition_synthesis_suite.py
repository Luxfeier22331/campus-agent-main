from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_rag_agent import RagAgent
from campus_rag_agent.query_planning import plan_student_handbook_query

from tests.agent.rag_agent_answer_quality_regression_suite_support import (
    _answer_ready_anchor,
    _make_handbook_source,
)


class RagAgentFixedPhraseConditionSynthesisTest(unittest.TestCase):
    def test_dormitory_lighting_fixed_phrase_preserves_schedule_rows(self) -> None:
        title = "中央民族大学关于学生宿舍照明的管理规定"
        source = _make_handbook_source(
            doc_id="handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",
            title=title,
            snippet=(
                "1. 10月至次年5月31日:\n"
                "亮灯时间:周一至周五每天早晨5:30。\n"
                "熄灯时间:周日至周四 每天晚上 24:00;23:50 提示。\n"
                "每周五、周六晚上及复习考试期间不统一熄灯。\n"
                "2. 6月1日至9月30日,学生宿舍不统一熄灯。"
            ),
            score=0.97,
            chunk_id_suffix="lighting-time-rules",
            detail_label="一、时间安排",
            content_role="deadline",
            is_answer_bearing=True,
            semantic_role="time_constraint",
            polarity="positive",
            claim_type="time_constraint",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                semantic_role="time_constraint",
                condition_subject="deadline",
                condition_group_subject="deadline",
                condition_polarity="positive",
                claim_type="time_constraint",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="宿舍照明",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            retrieval_intent=plan_student_handbook_query("宿舍照明").retrieval_intent,
        )

        self.assertIn("宿舍照明安排：", draft.answer_text)
        self.assertIn("亮灯时间:周一至周五每天早晨5:30", draft.answer_text)
        self.assertIn("熄灯时间:周日至周四 每天晚上 24:00;23:50 提示", draft.answer_text)
        self.assertIn("每周五、周六晚上及复习考试期间不统一熄灯", draft.answer_text)
        self.assertIn("6月1日至9月30日,学生宿舍不统一熄灯", draft.answer_text)

    def test_single_document_condition_answer_renders_source_title_once(self) -> None:
        title = "中央民族大学关于加强学生宿舍电器使用管理的规定"
        sources = (
            _condition_source(
                title=title,
                chunk="appliance-scope",
                detail_label="一、学生宿舍电器使用范围",
                snippet="宿舍内只允许使用电脑、复读机、收录音机、CD机、手机、电风扇及公寓内配套照明设备,其他电器一律严禁使用。",
                answer_role="exclusion_rule",
                condition_subject="generic_restriction",
            ),
            _condition_source(
                title=title,
                chunk="appliance-3c",
                detail_label="二、使用电器的标准",
                snippet="宿舍内允许使用的所有电器(包括接线板、充电器)必须是经3C(中国强制认证)认证的产品。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
            _condition_source(
                title=title,
                chunk="appliance-power",
                detail_label="(三)",
                snippet="电器(包括接线板)在有人时才可以接通电源,人走时必须切断电源。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="电器使用管理",
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            ),
            retrieval_intent=plan_student_handbook_query("电器使用管理").retrieval_intent,
        )

        self.assertIn("电器使用管理：", draft.answer_text)
        self.assertEqual(draft.answer_text.count(title), 1)
        self.assertIn("允许使用的范围包括：电脑、复读机、收录音机", draft.answer_text)
        self.assertIn("必须是经3C", draft.answer_text)
        self.assertIn("人走时必须切断电源", draft.answer_text)

    def test_fixed_phrase_condition_answer_uses_statement_level_sentences(self) -> None:
        title = "中央民族大学关于加强学生宿舍电器使用管理的规定"
        sources = (
            _condition_source(
                title=title,
                chunk="appliance-application",
                detail_label="一、学生宿舍电器使用范围",
                snippet="学生使用电脑、电风扇,须向公寓管理部提出书面申请,经核定电器功率后,签字批准方可使用。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
            _condition_source(
                title=title,
                chunk="appliance-3c",
                detail_label="二、使用电器的标准",
                snippet="宿舍内允许使用的所有电器(包括接线板、充电器)必须是经3C(中国强制认证)认证的产品。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
            _condition_source(
                title=title,
                chunk="appliance-power",
                detail_label="三、学生宿舍电器使用注意事项",
                snippet="电器(包括接线板)在有人时才可以接通电源,人走时必须切断电源(接线板要关闭按钮)。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
            _condition_source(
                title=title,
                chunk="appliance-scope",
                detail_label="一、学生宿舍电器使用范围",
                snippet="宿舍内只允许使用电脑、复读机、收录音机、CD机、手机、电风扇及公寓内配套照明设备,其他电器一律严禁使用。",
                answer_role="exclusion_rule",
                condition_subject="generic_restriction",
            ),
            _condition_source(
                title=title,
                chunk="appliance-placement",
                detail_label="三、学生宿舍电器使用注意事项",
                snippet="电器(包括接线板)使用和放置时应远离易燃物品,宿舍内禁止私拉电线,乱设电源。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="电器使用管理",
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            ),
            retrieval_intent=plan_student_handbook_query("电器使用管理").retrieval_intent,
        )

        self.assertIn("电器使用管理：学生使用电脑、电风扇", draft.answer_text)
        self.assertIn("。宿舍内允许使用的所有电器", draft.answer_text)
        self.assertIn("。电器(包括接线板)在有人时才可以接通电源", draft.answer_text)
        self.assertIn("。宿舍内允许使用的范围包括：电脑、复读机、收录音机", draft.answer_text)
        self.assertIn("。电器(包括接线板)使用和放置时应远离易燃物品", draft.answer_text)
        self.assertNotIn("；宿舍内允许使用的所有电器", draft.answer_text)
        self.assertEqual(draft.answer_text.count(title), 1)

    def test_fixed_phrase_condition_answer_renders_allowed_scope_without_single_item_exclusivity(
        self,
    ) -> None:
        title = "中央民族大学关于加强学生宿舍电器使用管理的规定"
        sources = (
            _condition_source(
                title=title,
                chunk="appliance-scope",
                detail_label="一、学生宿舍电器使用范围",
                snippet="宿舍内只允许使用电脑、复读机、收录音机、CD机、手机、电风扇及公寓内配套照明设备,其他电器一律严禁使用。",
                answer_role="exclusion_rule",
                condition_subject="generic_restriction",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="电器使用管理",
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            ),
            retrieval_intent=plan_student_handbook_query("电器使用管理").retrieval_intent,
        )

        self.assertIn(
            "允许使用的范围包括：电脑、复读机、收录音机、CD机、手机、电风扇及公寓内配套照明设备",
            draft.answer_text,
        )
        self.assertIn("其他电器一律严禁使用", draft.answer_text)
        self.assertNotIn("只允许使用电脑", draft.answer_text)
        self.assertEqual(draft.answer_text.count(title), 1)

    def test_fixed_phrase_condition_answer_renders_source_attribution_as_complete_sentence(
        self,
    ) -> None:
        title = "中央民族大学关于加强学生宿舍电器使用管理的规定"
        sources = (
            _condition_source(
                title=title,
                chunk="appliance-application",
                detail_label="一、学生宿舍电器使用范围",
                snippet="学生使用电脑、电风扇,须向公寓管理部提出书面申请,经核定电器功率后,签字批准方可使用。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
            _condition_source(
                title=title,
                chunk="appliance-3c",
                detail_label="二、使用电器的标准",
                snippet="宿舍内允许使用的所有电器(包括接线板、充电器)必须是经3C(中国强制认证)认证的产品。",
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
            ),
        )

        draft = RagAgent().build_answer(
            EvidenceBundle(
                query_text="电器使用管理",
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            ),
            retrieval_intent=plan_student_handbook_query("电器使用管理").retrieval_intent,
        )

        self.assertTrue(draft.answer_text.endswith(f"依据《{title}》。"))
        self.assertNotIn(f"。依据{title}", draft.answer_text)
        self.assertEqual(draft.answer_text.count(title), 1)


def _condition_source(
    *,
    title: str,
    chunk: str,
    detail_label: str,
    snippet: str,
    answer_role: str,
    condition_subject: str,
):
    doc_id = "handbook:a633b4ce84d8d92e1d98f97c57491ec24e8be834"
    return replace(
        _make_handbook_source(
            doc_id=doc_id,
            title=title,
            snippet=snippet,
            score=0.94,
            chunk_id_suffix=chunk,
            detail_label=detail_label,
            content_role="requirement",
            is_answer_bearing=True,
            semantic_role="condition",
            polarity="positive",
            claim_type="condition",
        ),
        anchor=_answer_ready_anchor(
            answer_role=answer_role,
            semantic_role="condition",
            condition_subject=condition_subject,
            condition_group_subject=condition_subject,
            condition_polarity="positive",
            claim_type="condition",
        ),
    )


if __name__ == "__main__":
    unittest.main()
