from __future__ import annotations

from dataclasses import asdict, fields
import unittest

from campus_contracts import (
    ActorContext,
    AvailabilityCheckPayload,
    AvailabilityObservation,
    DocumentRef,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorRequest,
    TraceContext,
)


class ContractModelsTest(unittest.TestCase):
    def test_supervisor_request_defaults_do_not_inject_fixed_capability_or_scope(self) -> None:
        request = SupervisorRequest(user_goal="library hours")

        self.assertEqual(request.conversation_id, "")
        self.assertEqual(request.request_id, "")
        self.assertIsNone(request.requested_capability)
        self.assertIsNone(request.requested_scope)
        self.assertIsNone(request.availability_target_id)
        self.assertTrue(request.follow_redirects)
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

    def test_specialist_request_requires_explicit_payload(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        self.assertEqual(request.conversation_id, "")
        self.assertEqual(request.request_id, "")
        self.assertEqual(
            request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

    def test_contract_request_shape_no_longer_owns_scope_catalog_validation(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="library hours",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="curriculum_plan",
                )
            )
        )

        self.assertEqual(request.payload.scope.corpus, "regulations")
        self.assertEqual(request.payload.scope.collection, "curriculum_plan")
    def test_request_accepts_offline_campus_services_scope(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="校园110电话是多少？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="campus_services",
                    collection="contact_directory",
                )
            ),
        )

        self.assertEqual(request.payload.scope.corpus, "campus_services")
        self.assertEqual(request.payload.scope.collection, "contact_directory")

    def test_response_serializes_rag_result_shape(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="completed",
            answer_text="The library is open.",
            confidence="high",
            result=RagResultPayload(
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
                            source_title="Library Hours Policy",
                            structural_path=("Chapter 1", "Opening Hours"),
                            content_kind="text",
                            content_role="time_rule",
                            detail_label="Article 3",
                            is_answer_bearing=True,
                        ),
                    ),
                )
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["target"], "rag-specialist")
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["confidence"], "high")
        self.assertEqual(payload["result"]["evidence"]["corpus"], "regulations")
        self.assertEqual(payload["result"]["evidence"]["collection"], "student_handbook")
        self.assertEqual(
            payload["result"]["evidence"]["sources"][0]["canonical_url"],
            "https://campus.example/library#hours",
        )
        self.assertEqual(
            payload["result"]["evidence"]["sources"][0]["source_title"],
            "Library Hours Policy",
        )
        self.assertEqual(
            tuple(payload["result"]["evidence"]["sources"][0]["structural_path"]),
            ("Chapter 1", "Opening Hours"),
        )
        self.assertEqual(payload["result"]["evidence"]["sources"][0]["content_role"], "time_rule")
        self.assertTrue(payload["result"]["evidence"]["sources"][0]["is_answer_bearing"])
        self.assertEqual(
            tuple(field.name for field in fields(SpecialistResponse)),
            (
                "target",
                "status",
                "answer_text",
                "follow_up_question",
                "confidence",
                "result",
                "error",
            ),
        )

    def test_response_serializes_availability_observation_shape(self) -> None:
        response = SpecialistResponse(
            target="availability-specialist",
            status="completed",
            answer_text="official-homepage timed out during the latest probe.",
            result=AvailabilityObservation(
                target_id="official-homepage",
                observed_status="timeout",
                http_status=None,
                final_url="https://campus.example/official-homepage",
                redirect_chain=(),
                failure_classification="timeout",
            ),
        )

        payload = asdict(response)

        self.assertEqual(payload["target"], "availability-specialist")
        self.assertEqual(payload["result"]["observed_status"], "timeout")
        self.assertEqual(payload["result"]["failure_classification"], "timeout")

    def test_availability_request_payload_serializes(self) -> None:
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="检查官网是否可访问",
            payload=AvailabilityCheckPayload(
                target_id="official-homepage",
                follow_redirects=False,
            ),
        )

        self.assertEqual(
            asdict(request)["payload"],
            {
                "target_id": "official-homepage",
                "follow_redirects": False,
            },
        )

    def test_specialist_request_rejects_missing_payload(self) -> None:
        with self.assertRaises(TypeError):
            SpecialistRequest(  # type: ignore[call-arg]
                target="rag-specialist",
                user_goal="library hours",
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
