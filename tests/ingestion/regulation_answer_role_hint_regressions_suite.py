from __future__ import annotations

import unittest

from campus_ingestion_core.regulation_answer_roles import (
    build_answer_role_metadata,
    decide_answer_role,
)


class RegulationAnswerRoleHintRegressionsTest(unittest.TestCase):
    def test_procedure_step_hint_does_not_upgrade_supporting_detail_text(self) -> None:
        decision = decide_answer_role(
            text="12. 大学文化建设丰富多彩，校园文化活动蓬勃开展。",
            prefix_text="第六部分 事业发展任务",
            role_hint="procedure_step",
        )
        metadata = build_answer_role_metadata(
            text="12. 大学文化建设丰富多彩，校园文化活动蓬勃开展。",
            prefix_text="第六部分 事业发展任务",
            role_hint="procedure_step",
        )

        self.assertEqual(decision["answer_role"], "supporting_detail")
        self.assertEqual(metadata["answer_role"], "supporting_detail")
        self.assertFalse(metadata["is_answer_bearing"])

    def test_procedure_step_hint_does_not_upgrade_eligibility_condition_text(self) -> None:
        decision = decide_answer_role(
            text="综合测评成绩排名应位于前10%。",
            prefix_text="申请条件",
            role_hint="procedure_step",
        )
        metadata = build_answer_role_metadata(
            text="综合测评成绩排名应位于前10%。",
            prefix_text="申请条件",
            role_hint="procedure_step",
        )

        self.assertEqual(decision["answer_role"], "eligibility_condition")
        self.assertEqual(metadata["answer_role"], "eligibility_condition")
        self.assertTrue(metadata["is_answer_bearing"])

    def test_true_procedure_step_with_hint_stays_procedure_step(self) -> None:
        decision = decide_answer_role(
            text=(
                "（二）研究生院复评。院系将初评结果汇总，附参评材料盖公章后报至研究生院，"
                "由研究生院完成材料复审及评选工作。"
            ),
            prefix_text="评选程序",
            role_hint="procedure_step",
        )
        metadata = build_answer_role_metadata(
            text=(
                "（二）研究生院复评。院系将初评结果汇总，附参评材料盖公章后报至研究生院，"
                "由研究生院完成材料复审及评选工作。"
            ),
            prefix_text="评选程序",
            role_hint="procedure_step",
        )

        self.assertEqual(decision["answer_role"], "procedure_step")
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertTrue(metadata["is_answer_bearing"])

    def test_procedure_step_hint_does_not_upgrade_misconduct_clause(self) -> None:
        decision = decide_answer_role(
            text="（七）在培养环节中签署虚假意见，违规委托他人填写培养各环节的鉴定意见或评审意见；",
            prefix_text="第四章 违反立德树人规范行为的认定与处理",
            role_hint="procedure_step",
        )
        metadata = build_answer_role_metadata(
            text="（七）在培养环节中签署虚假意见，违规委托他人填写培养各环节的鉴定意见或评审意见；",
            prefix_text="第四章 违反立德树人规范行为的认定与处理",
            role_hint="procedure_step",
        )

        self.assertNotEqual(decision["answer_role"], "procedure_step")
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertFalse(metadata["is_answer_bearing"])

    def test_procedure_step_hint_does_not_upgrade_ranking_tiebreak_rule(self) -> None:
        decision = decide_answer_role(
            text="（四）总成绩相同者按学业成绩 A+学业成绩 B 由高至低排序；如上述成绩仍相同，则按学业成绩 A 由高至低排序。",
            prefix_text="第四章 遴选办法及程序",
            role_hint="procedure_step",
        )
        metadata = build_answer_role_metadata(
            text="（四）总成绩相同者按学业成绩 A+学业成绩 B 由高至低排序；如上述成绩仍相同，则按学业成绩 A 由高至低排序。",
            prefix_text="第四章 遴选办法及程序",
            role_hint="procedure_step",
        )

        self.assertNotEqual(decision["answer_role"], "procedure_step")
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertFalse(metadata["is_answer_bearing"])


if __name__ == "__main__":
    unittest.main()
