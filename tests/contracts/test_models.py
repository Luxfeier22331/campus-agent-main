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
    KnowledgeScope,
    TraceContext,
)


class ContractModelsTest(unittest.TestCase):
    def test_request_defaults_and_scope_are_stable(self) -> None:
        request = DelegateToRagAgentRequest(user_goal="library hours")

        self.assertEqual(request.conversation_id, "bootstrap-conversation")
        self.assertEqual(request.request_id, "")
        self.assertEqual(
            request.scope,
            KnowledgeScope(corpus="regulations", collection="student_handbook"),
        )
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

    def test_request_rejects_invalid_collection_scope(self) -> None:
        with self.assertRaises(ValueError):
            DelegateToRagAgentRequest(
                user_goal="library hours",
                scope=KnowledgeScope(corpus="regulations", collection="curriculum_plan"),
            )

    def test_request_accepts_offline_campus_services_scope(self) -> None:
        request = DelegateToRagAgentRequest(
            user_goal="校园110电话是多少？",
            scope=KnowledgeScope(corpus="campus_services", collection="contact_directory"),
        )

        self.assertEqual(request.scope.corpus, "campus_services")
        self.assertEqual(request.scope.collection, "contact_directory")

    def test_response_serializes_evidence_shape(self) -> None:
        response = DelegateToRagAgentResponse(
            status="completed",
            answer_text="The library is open.",
            confidence="high",
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                sources=(
                    EvidenceSource(
                        doc_id="doc-library-hours",
                        revision_track="source-faithful",
                        version_id="v2026-03-19",
                        chunk_id="chunk-001",
                        anchor={"section": "hours"},
                        acl_level="public",
                        canonical_url="https://campus.example/library#hours",
                        latest_url="https://campus.example/library#hours",
                        source_channel="pdf_ocr",
                        collection="student_handbook",
                        is_current=False,
                        snippet="The library is open from 08:00 to 22:00.",
                        score=0.98,
                    ),
                ),
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["confidence"], "high")
        self.assertEqual(payload["evidence"]["corpus"], "regulations")
        self.assertEqual(payload["evidence"]["collection"], "student_handbook")
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
            revision_track="source-faithful",
            version_id="v1:test-001",
            corpus="regulations",
            collection="student_handbook",
            source_uri="https://campus.example/docs/test-001",
            content_hash="sha256:test-001",
        )
        error = ErrorInfo(code="retrieval_failed", message="Qdrant timeout")

        self.assertEqual(document_ref.corpus, "regulations")
        self.assertEqual(document_ref.collection, "student_handbook")
        self.assertFalse(error.retryable)
        self.assertEqual(asdict(error)["message"], "Qdrant timeout")

    def test_document_ref_accepts_campus_services_collections(self) -> None:
        navigation_ref = DocumentRef(
            document_id="service:catalog-001",
            revision_track="source-faithful",
            version_id="v1:catalog-001",
            corpus="campus_services",
            collection="service_catalog",
            source_uri="https://service.muc.edu.cn/v2/site/index",
            content_hash="sha256:catalog-001",
        )
        contact_ref = DocumentRef(
            document_id="service:contact-001",
            revision_track="source-faithful",
            version_id="v1:contact-001",
            corpus="campus_services",
            collection="contact_directory",
            source_uri="campus-agent://campus_services/contact_directory/docs/service:contact-001",
            content_hash="sha256:contact-001",
        )

        self.assertEqual(navigation_ref.corpus, "campus_services")
        self.assertEqual(navigation_ref.collection, "service_catalog")
        self.assertEqual(contact_ref.collection, "contact_directory")


if __name__ == "__main__":
    unittest.main()
