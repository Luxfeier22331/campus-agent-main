from __future__ import annotations

import unittest

from campus_knowledge_capability.answer_presentation_contract import (
    AnswerPresentationDraft,
    PresentationKind,
    validate_answer_presentation_draft,
)
from campus_knowledge_capability.answer_shape import AnswerShape
from campus_knowledge_capability.typed_answer_drafts import (
    TypedAnswerDraft,
    validate_typed_answer_draft,
)


class KnowledgeCapabilityPresentationContractTest(unittest.TestCase):
    def test_document_identity_requires_identity_token_and_stays_single_sentence(self) -> None:
        valid = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.DOCUMENT_IDENTITY,
                answer_shape=AnswerShape.TITLE_LOOKUP,
                fragments=("《中央民族大学研究生“三助”工作管理办法》是校级制度。",),
                identity_tokens=("中央民族大学研究生“三助”工作管理办法",),
            )
        )
        overlong = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.DOCUMENT_IDENTITY,
                answer_shape=AnswerShape.TITLE_LOOKUP,
                fragments=(
                    "《中央民族大学研究生“三助”工作管理办法》是校级制度。",
                    "它还规定了助教、助研、助管的岗位职责。",
                    "申请和考核另有具体流程。",
                ),
                identity_tokens=("中央民族大学研究生“三助”工作管理办法",),
            )
        )
        missing_identity = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.DOCUMENT_IDENTITY,
                answer_shape=AnswerShape.TITLE_LOOKUP,
                fragments=("这是一份校级制度。",),
                identity_tokens=("中央民族大学研究生“三助”工作管理办法",),
            )
        )

        self.assertEqual(valid.verdict, "valid")
        self.assertEqual(overlong.verdict, "invalid")
        self.assertEqual(overlong.failure_reason, "presentation_fragment_budget_exceeded")
        self.assertEqual(missing_identity.verdict, "invalid")
        self.assertEqual(missing_identity.failure_reason, "identity_token_missing")

    def test_brief_reference_allows_two_facts_but_rejects_summary_shape(self) -> None:
        valid = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.BRIEF_REFERENCE,
                answer_shape=AnswerShape.TITLE_LOOKUP,
                fragments=("学校设有56个本科招生专业。", "现有多个国家级一流本科专业建设点。"),
            )
        )
        shape_mismatch = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.BRIEF_REFERENCE,
                answer_shape=AnswerShape.GENERAL_SUMMARY,
                fragments=("学校设有56个本科招生专业。",),
            )
        )

        self.assertEqual(valid.verdict, "valid")
        self.assertEqual(shape_mismatch.verdict, "invalid")
        self.assertEqual(shape_mismatch.failure_reason, "presentation_answer_shape_mismatch")

    def test_general_summary_presentation_cannot_render_summary_chain(self) -> None:
        valid = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.GENERAL_SUMMARY,
                answer_shape=AnswerShape.GENERAL_SUMMARY,
                fragments=("当前依据可确认问题涉及该制度。",),
            )
        )
        summary_chain = validate_answer_presentation_draft(
            AnswerPresentationDraft(
                kind=PresentationKind.GENERAL_SUMMARY,
                answer_shape=AnswerShape.GENERAL_SUMMARY,
                fragments=("当前依据不足。", "第一段材料说明了背景。", "第二段材料说明了流程。"),
            )
        )

        self.assertEqual(valid.verdict, "valid")
        self.assertEqual(summary_chain.verdict, "invalid")
        self.assertEqual(summary_chain.failure_reason, "presentation_fragment_budget_exceeded")

    def test_typed_answer_draft_validation_includes_presentation_contract(self) -> None:
        draft = TypedAnswerDraft(
            kind="unsupported",
            unsupported_reason="short_answer_shape_unsupported",
            presentation=AnswerPresentationDraft(
                kind=PresentationKind.GENERAL_SUMMARY,
                answer_shape=AnswerShape.GENERAL_SUMMARY,
                fragments=("当前依据不足。", "第一段材料说明了背景。", "第二段材料说明了流程。"),
            ),
        )

        result = validate_typed_answer_draft(draft)

        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "presentation_fragment_budget_exceeded")


if __name__ == "__main__":
    unittest.main()
