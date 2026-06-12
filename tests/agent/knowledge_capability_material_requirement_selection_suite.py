from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_knowledge_capability import KnowledgeCapability
from campus_knowledge_capability.query_planning import plan_student_handbook_query

from tests.agent.knowledge_capability_answer_quality_regression_suite_support import (
    _answer_ready_anchor,
    _make_policy_source,
)


class KnowledgeCapabilityMaterialRequirementSelectionTest(unittest.TestCase):
    def test_relief_materials_query_excludes_archive_management_material_rows(self) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        application_material = replace(
            _make_policy_source(
                doc_id="policy:discipline-relief",
                title=title,
                snippet=(
                    "向所在学院(系)提交解除处分的书面申请,并填写"
                    "《中央民族大学违纪学生申请解除处分审批表》,附成绩单、"
                    "思想汇报、各种相关证明等材料。"
                ),
                score=0.95,
                chunk="discipline-relief-application-material",
                detail_label="第七条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="material_requirement",
                condition_subject="material_requirement",
                condition_group_subject="material_requirement",
                condition_polarity="positive",
                semantic_role="material_requirement",
                claim_type="condition",
            ),
        )
        archive_management = replace(
            _make_policy_source(
                doc_id="policy:discipline-relief",
                title=title,
                snippet=(
                    "受处分学生的日常检讨书、思想汇报,学院(系)"
                    "《受处分学生日常表现考核档案》、班级评议记录、学院(系)"
                    "党政联席会会议记录等处分及解除处分的相关文书材料,均由学生"
                    "所在学院(系)负责保管;学生毕业时尚未解除处分的,处分材料装入本人档案。"
                ),
                score=0.94,
                chunk="discipline-relief-archive-management",
                detail_label="第九条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                condition_subject="material_requirement",
                condition_group_subject="material_requirement",
                condition_polarity="positive",
                semantic_role="supporting_detail",
                claim_type="condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="申请解除处分需要提交哪些材料",
                corpus="regulations",
                collection="student_rules",
                sources=(archive_management, application_material),
            ),
            retrieval_intent=plan_student_handbook_query(
                "申请解除处分需要提交哪些材料"
            ).retrieval_intent,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in draft.supporting_sources),
            (application_material.chunk_id,),
        )
        self.assertIn("书面申请", draft.answer_text)
        self.assertIn("申请解除处分审批表", draft.answer_text)
        self.assertIn("成绩单", draft.answer_text)
        self.assertIn("需要提交：", draft.answer_text)
        self.assertIn("相关证明等材料", draft.answer_text)
        self.assertIn(f"来源：{title} 第七条", draft.answer_text)
        self.assertNotIn(f"依据{title} 第七条", draft.answer_text)
        self.assertNotIn("负责保管", draft.answer_text)
        self.assertNotIn("装入本人档案", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
