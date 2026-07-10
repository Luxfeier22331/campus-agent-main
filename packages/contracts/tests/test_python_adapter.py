from __future__ import annotations

import unittest
from dataclasses import asdict, fields

import campus_contracts
from campus_contracts import (
    ALLOWED_MODEL_VISIBLE_TOOL_NAMES,
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    ExecutionRequest,
    SessionSlot,
    SessionSummary,
    ToolObservability,
    ToolRequest,
    TransportScheduleLookupPayload,
    VersionQuery,
    WorkflowToolContext,
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
                "public_web_search",
                "transport_schedule_lookup",
                "campus_notice_discover",
            ),
        )

        request = ToolRequest(
            tool="transport_schedule_lookup",
            user_goal="校车下一班几点",
            payload=TransportScheduleLookupPayload(
                query_text="校车下一班几点",
                intent="next_departure",
            ),
            allowed_tools=("transport_schedule_lookup",),
        )

        self.assertEqual(asdict(request)["tool"], "transport_schedule_lookup")
        self.assertEqual(tuple(asdict(request)["allowed_tools"]), ("transport_schedule_lookup",))

    def test_python_adapter_rejects_removed_or_non_canonical_fields(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported requested_tool: availability"):
            ExecutionRequest(
                user_goal="官网能打开吗",
                requested_tool="availability",  # type: ignore[arg-type]
            )
        with self.assertRaises(TypeError):
            ActorContext(groups=("students",))  # type: ignore[call-arg]
        self.assertNotIn("groups", {field.name for field in fields(ActorContext)})

    def test_python_adapter_enforces_temporal_and_raw_payload_guardrails(self) -> None:
        with self.assertRaisesRegex(ValueError, "as_of is required when version mode is as_of"):
            VersionQuery(mode="as_of")

        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            ToolObservability(
                selected_tool="transport_schedule_lookup",
                safe_details={"debug": {"raw_prompt": "secret"}},
            )

        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            WorkflowToolContext(
                tool="knowledge_query",
                workflow_run_ref="workflow:req-test",
                step_id="tool:knowledge_query:rag_request",
                tool_id="knowledge_query",
                projection_refs=(
                    {
                        "projection_id": "projection:notice_context:test",
                        "source_step_id": "handoff:notice:campus_notice_get",
                        "projection_kind": "notice_context",
                        "content_hash": "sha256:test",
                        "safety": {"max_chars": 1600, "fields_present": ["title"]},
                        "raw_response": "secret",
                    },
                ),
            )

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
