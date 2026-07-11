from __future__ import annotations

import unittest
from dataclasses import asdict, fields

import campus_contracts
from campus_contracts import (
    ALLOWED_MODEL_VISIBLE_TOOL_NAMES,
    ALLOWED_TOOL_NAMES,
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    SessionSlot,
    SessionSummary,
    TransportScheduleLookupPayload,
    VersionQuery,
)


class PythonContractAdapterSmokeTest(unittest.TestCase):
    def test_public_exports_resolve_to_real_symbols(self) -> None:
        for symbol in campus_contracts.__all__:
            with self.subTest(symbol=symbol):
                self.assertTrue(hasattr(campus_contracts, symbol))

    def test_python_adapter_preserves_current_model_visible_tool_boundary(self) -> None:
        self.assertEqual(
            ALLOWED_MODEL_VISIBLE_TOOL_NAMES,
            (
                "knowledge_query",
                "transport_schedule_lookup",
            ),
        )
        self.assertEqual(
            ALLOWED_TOOL_NAMES,
            ("knowledge_query", "knowledge_search", "transport_schedule_lookup"),
        )

        payload = TransportScheduleLookupPayload(
            query_text="校车下一班几点",
            intent="next_departure",
        )

        self.assertEqual(asdict(payload)["intent"], "next_departure")

    def test_python_adapter_rejects_removed_or_non_canonical_fields(self) -> None:
        with self.assertRaises(TypeError):
            ActorContext(groups=("students",))  # type: ignore[call-arg]
        self.assertNotIn("groups", {field.name for field in fields(ActorContext)})
        for retired_symbol in (
            "RagReplanDecisionSummary",
            "RetrievalPlanSummary",
            "ToolRequest",
            "ToolResponse",
            "WorkflowToolContext",
        ):
            self.assertFalse(hasattr(campus_contracts, retired_symbol))

    def test_python_adapter_enforces_temporal_and_raw_payload_guardrails(self) -> None:
        with self.assertRaisesRegex(ValueError, "as_of is required when version mode is as_of"):
            VersionQuery(mode="as_of")

    def test_python_adapter_keeps_key_helper_defaults(self) -> None:
        summary = SessionSummary(
            confirmed_slots=(
                SessionSlot(
                    name="curriculum_program_family",
                    value="民族实验班",
                    confirmed=True,
                ),
                SessionSlot(
                    name="curriculum_program",
                    value="新闻学民族实验班",
                    confirmed=False,
                ),
                SessionSlot(
                    name="curriculum_program",
                    value="法学民族实验班",
                    confirmed=True,
                ),
            ),
        )
        self.assertEqual(summary.curriculum_follow_up.program_family, "民族实验班")
        self.assertEqual(summary.curriculum_follow_up.program, "法学民族实验班")

        source = EvidenceSource(
            doc_id="curriculum:law-ethnic-experimental",
            revision_track="source-faithful",
            version_id="v1:semester-4",
            chunk_id="curriculum:law-ethnic-experimental:semester-4:chunk-0001",
            anchor={"page_start": 1},
            canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
            latest_url="https://campus.example/curriculum/law-ethnic-experimental",
            source_channel="pdf_ocr",
            collection="curriculum_plan",
            is_current=False,
            snippet="第四学期开设课程。",
            score=0.94,
        )
        EvidenceBundle(
            corpus="curriculum",
            collection="curriculum_plan",
            query_text="法学民族班大二下有什么课",
            sources=(source,),
        )
        self.assertEqual(source.source_trust_tier, "T0")


if __name__ == "__main__":
    unittest.main()
