# ruff: noqa: F405
from __future__ import annotations

import unittest

from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)

from tests.agent.rag_agent_answer_quality_regression_suite_support import *


class RagAgentConditionOverviewSynthesisTailTest(unittest.TestCase):
    def test_conduct_grade_does_not_create_amount_or_quota_dimension(self) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:conduct-award",
                        title="品行奖学金评审办法",
                        snippet="申请品行奖学金应当诚实守信,品行测评等级为优秀。",
                        score=0.94,
                        chunk="conduct-award-condition",
                        detail_label="第六条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="policy:academic-award",
                        title="学业奖学金评审办法",
                        snippet="申请学业奖学金应当学习成绩优良,综合测评排名靠前。",
                        score=0.93,
                        chunk="academic-award-condition",
                        detail_label="第七条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition",),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=("policy:conduct-award", "policy:academic-award"),
                condition_subject="generic_condition",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertIn("思想品德与诚信", draft.answer_text)
        self.assertIn("学习与综合表现", draft.answer_text)
        self.assertNotIn("名额金额与等级", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
