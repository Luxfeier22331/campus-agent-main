from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)


class RagAgentRetrievalIntentContractTest(unittest.TestCase):
    def test_valid_policy_list_intent_serializes_stably(self) -> None:
        intent = RetrievalIntent(
            kind="policy_list",
            normalized_query="有哪些本科生可以申请的奖学金",
            expected=RetrievalIntentExpectation(
                answer_kind="policy_list",
                evidence_roles=("category_overview",),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
                rerank_policy="profile_gated_if_eligible",
                replan_policy="coverage_gap_replan",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=("handbook:a", "handbook:b"),
            ),
            critical_terms=("奖学金",),
        )

        self.assertEqual(intent.schema_version, 1)
        self.assertEqual(intent.kind, "policy_list")
        self.assertEqual(intent.expected.answer_kind, "policy_list")
        self.assertEqual(intent.target.category_id, "scholarship")
        self.assertEqual(
            json.loads(json.dumps(intent.to_dict(), ensure_ascii=False)),
            {
                "schema_version": 1,
                "kind": "policy_list",
                "normalized_query": "有哪些本科生可以申请的奖学金",
                "expected": {
                    "answer_kind": "policy_list",
                    "evidence_roles": ["category_overview"],
                    "coverage_policy": "category_member_coverage",
                    "selection_policy": "one_answer_ready_source_per_member",
                    "rerank_policy": "profile_gated_if_eligible",
                    "replan_policy": "coverage_gap_replan",
                },
                "target": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "document_ids": [],
                    "document_titles": [],
                    "preferred_document_ids": [],
                    "version_ids": [],
                    "revision_track": "",
                    "article_nos": [],
                    "clause_nos": [],
                    "detail_labels": [],
                    "focus_terms": [],
                    "category_id": "scholarship",
                    "category_member_document_ids": ["handbook:a", "handbook:b"],
                    "condition_subject": "",
                },
                "critical_terms": ["奖学金"],
                "clarification_reason": "",
                "unsupported_reason": "",
            },
        )

    def test_valid_judgment_procedure_and_condition_intents(self) -> None:
        cases = (
            ("eligibility_judgment", "eligibility_judgment", "condition_subject_alignment"),
            ("procedure_steps", "procedure_steps", "procedure_step_completeness"),
            ("condition_table", "condition_table", "condition_subject_alignment"),
        )
        for kind, answer_kind, coverage_policy in cases:
            with self.subTest(kind=kind):
                intent = RetrievalIntent(
                    kind=kind,
                    normalized_query="学生证丢了怎么办",
                    expected=RetrievalIntentExpectation(
                        answer_kind=answer_kind,
                        evidence_roles=("procedure_step",),
                        coverage_policy=coverage_policy,
                        selection_policy="answer_role_first",
                        rerank_policy="profile_gated_if_eligible",
                        replan_policy="intent_gap_replan",
                    ),
                    target=RetrievalIntentTarget(
                        corpus="regulations",
                        collection="student_rules",
                        document_ids=("handbook:student-card",),
                        condition_subject="student_card_or_identity_credential",
                    ),
                )

                self.assertEqual(intent.kind, kind)
                self.assertEqual(intent.expected.answer_kind, answer_kind)

    def test_category_scoped_condition_intent_can_target_member_documents(self) -> None:
        intent = RetrievalIntent(
            kind="condition_table",
            normalized_query="申请奖学金需要满足什么条件",
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition",),
                coverage_policy="condition_subject_alignment",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=("handbook:national", "handbook:professional"),
                condition_subject="generic_condition",
            ),
        )

        self.assertEqual(intent.kind, "condition_table")
        self.assertEqual(intent.target.document_ids, ())
        self.assertEqual(
            intent.target.category_member_document_ids,
            ("handbook:national", "handbook:professional"),
        )

    def test_policy_object_lookup_can_target_document_title_before_doc_id_resolution(
        self,
    ) -> None:
        intent = RetrievalIntent(
            kind="policy_object_lookup",
            normalized_query="中央民族大学丰台校区就医管理办法（暂行）",
            expected=RetrievalIntentExpectation(answer_kind="policy_object"),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="institutional_rules",
                document_titles=("中央民族大学丰台校区就医管理办法（暂行）",),
            ),
        )

        self.assertEqual(intent.target.document_ids, ())
        self.assertEqual(
            intent.target.document_titles,
            ("中央民族大学丰台校区就医管理办法（暂行）",),
        )

    def test_rejects_invalid_empty_required_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "policy_list requires category_id"):
            RetrievalIntent(
                kind="policy_list",
                normalized_query="有哪些奖学金",
                expected=RetrievalIntentExpectation(answer_kind="policy_list"),
                target=RetrievalIntentTarget(corpus="regulations", collection="student_rules"),
            )

        with self.assertRaisesRegex(ValueError, "specific_clause_lookup requires document_ids"):
            RetrievalIntent(
                kind="specific_clause_lookup",
                normalized_query="国奖第九条",
                expected=RetrievalIntentExpectation(answer_kind="specific_clause"),
                target=RetrievalIntentTarget(corpus="regulations", collection="student_rules"),
            )

        with self.assertRaisesRegex(
            ValueError,
            "condition_table requires document_ids or category_member_document_ids",
        ):
            RetrievalIntent(
                kind="condition_table",
                normalized_query="申请奖学金需要满足什么条件",
                expected=RetrievalIntentExpectation(answer_kind="condition_table"),
                target=RetrievalIntentTarget(corpus="regulations", collection="student_rules"),
            )

        with self.assertRaisesRegex(
            ValueError,
            "policy_object_lookup requires document_ids or document_titles",
        ):
            RetrievalIntent(
                kind="policy_object_lookup",
                normalized_query="中央民族大学丰台校区就医管理办法（暂行）",
                expected=RetrievalIntentExpectation(answer_kind="policy_object"),
                target=RetrievalIntentTarget(
                    corpus="regulations",
                    collection="institutional_rules",
                ),
            )

    def test_rejects_invalid_enum_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported retrieval intent kind"):
            RetrievalIntent(
                kind="made_up",
                normalized_query="query",
                expected=RetrievalIntentExpectation(answer_kind="general_fact"),
                target=RetrievalIntentTarget(corpus="regulations", collection="student_rules"),
            )

        with self.assertRaisesRegex(ValueError, "unsupported retrieval answer kind"):
            RetrievalIntentExpectation(answer_kind="made_up")

    def test_contract_does_not_enter_packages_contracts(self) -> None:
        contracts_root = Path("packages/contracts")
        for path in contracts_root.rglob("*.py"):
            self.assertNotIn("RetrievalIntent", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
