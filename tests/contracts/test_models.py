from __future__ import annotations

from dataclasses import asdict, fields
import unittest

from campus_contracts import (
    ActorContext,
    DelegateToRagAgentRequest,
    DelegateToRagAgentResponse,
    DocumentRef,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    TraceContext,
)


class ContractModelsTest(unittest.TestCase):
    def test_request_defaults_and_corpora_are_frozen(self) -> None:
        request = DelegateToRagAgentRequest(user_goal="library hours")

        self.assertEqual(request.conversation_id, "bootstrap-conversation")
        self.assertEqual(request.request_id, "")
        self.assertEqual(request.corpora, ("student_handbook",))
        self.assertEqual(
            request.trace,
            TraceContext(trace_id="", parent_run_id="", tool_call_id=""),
        )
        self.assertEqual(
            request.actor,
            ActorContext(
                user_id="",
                roles=(),
                departments=(),
                groups=(),
                campus_scope=None,
                snapshot={},
            ),
        )

    def test_request_rejects_non_student_handbook_corpus(self) -> None:
        with self.assertRaises(ValueError):
            DelegateToRagAgentRequest(
                user_goal="library hours",
                corpora=("student_handbook", "faculty_handbook"),
            )

    def test_response_serializes_evidence_shape(self) -> None:
        response = DelegateToRagAgentResponse(
            status="completed",
            answer_text="The library is open.",
            confidence="high",
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus="student_handbook",
                sources=(
                    EvidenceSource(
                        doc_id="doc-library-hours",
                        version_id="v2026-03-19",
                        chunk_id="chunk-001",
                        anchor={"section": "hours"},
                        acl_level="public",
                        canonical_url="https://campus.example/library#hours",
                        latest_url="https://campus.example/library#hours",
                        snippet="The library is open from 08:00 to 22:00.",
                        score=0.98,
                    ),
                ),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["confidence"], "high")
        self.assertEqual(payload["evidence"]["corpus"], "student_handbook")
        self.assertEqual(
            payload["evidence"]["sources"][0]["canonical_url"],
            "https://campus.example/library#hours",
        )
        self.assertEqual(
            tuple(field.name for field in fields(DelegateToRagAgentResponse)),
            (
                "status",
                "answer_text",
                "follow_up_question",
                "confidence",
                "evidence",
                "error",
            ),
        )

    def test_document_ref_and_error_defaults_are_stable(self) -> None:
        document_ref = DocumentRef(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            corpus="student_handbook",
            source_uri="https://campus.example/docs/test-001",
            content_hash="sha256:test-001",
        )
        error = ErrorInfo(code="retrieval_failed", message="Qdrant timeout")

        self.assertEqual(document_ref.corpus, "student_handbook")
        self.assertFalse(error.retryable)
        self.assertEqual(asdict(error)["message"], "Qdrant timeout")


if __name__ == "__main__":
    unittest.main()
