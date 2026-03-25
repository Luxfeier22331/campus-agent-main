from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_retrieval_core import CorpusQueryDisabledError, RetrievalBackendError
from campus_rag_specialist.confidence import derive_confidence
from campus_rag_specialist.service import delegate_to_rag_agent


def _make_evidence(*, scores: tuple[float, ...] = (0.82, 0.77)) -> EvidenceBundle:
    sources = tuple(
        EvidenceSource(
            doc_id=f"handbook:test-{index + 1}",
            revision_track="source-faithful",
            version_id=f"v1:test-{index + 1}",
            chunk_id=f"handbook:test-{index + 1}:source-faithful:v1:test-{index + 1}:chunk-0001",
            anchor={"page_start": index + 1, "page_end": index + 1},
            acl_level="public",
            canonical_url=f"https://campus.example/handbook/test-{index + 1}",
            latest_url=f"https://campus.example/handbook/test-{index + 1}",
            source_channel="pdf_ocr",
            collection="student_handbook",
            is_current=False,
            snippet=f"Evidence snippet {index + 1} about library hours and student support.",
            score=score,
        )
        for index, score in enumerate(scores)
    )
    return EvidenceBundle(
        query_text="library hours",
        corpus="regulations",
        collection="student_handbook",
        sources=sources,
    )


class RagSpecialistTest(unittest.TestCase):
    def test_blank_user_goal_is_rejected_by_request_contract(self) -> None:
        with self.assertRaisesRegex(ValueError, "user_goal"):
            SpecialistRequest(
                target="rag-specialist",
                user_goal="   ",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            )

    def test_retrieval_error_maps_to_error_response(self) -> None:
        def raising_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            raise RetrievalBackendError("qdrant unavailable")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=raising_retriever,
        )

        self.assertEqual(
            response,
            SpecialistResponse(
                target="rag-specialist",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="qdrant unavailable",
                    retryable=False,
                ),
            ),
        )

    def test_query_disabled_corpus_maps_to_explicit_error_response(self) -> None:
        def raising_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            raise CorpusQueryDisabledError(
                "curriculum/curriculum_plan retrieval is disabled in phase-1"
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="培养方案要求",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(
                        corpus="curriculum",
                        collection="curriculum_plan",
                    )
                ),
            ),
            retriever=raising_retriever,
        )

        self.assertIsInstance(response, SpecialistResponse)
        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.error.code, "corpus_not_query_enabled")
        self.assertIn("curriculum_plan", response.error.message)

    def test_no_evidence_maps_to_no_answer(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertFalse(response.answer_text)
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
        )

    def test_completed_response_uses_evidence_and_actor_context(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence()

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="What are the library hours?",
            actor=ActorContext(
                user_id="student-001",
                groups=("students",),
                campus_scope="north",
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        response = delegate_to_rag_agent(request, retriever=fake_retriever)

        self.assertIsInstance(response, SpecialistResponse)
        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(captured_kwargs["query"], "What are the library hours?")
        self.assertEqual(captured_kwargs["corpus"], "regulations")
        self.assertEqual(captured_kwargs["collection"], "student_handbook")
        self.assertEqual(captured_kwargs["acl_groups"], ("students",))
        self.assertEqual(captured_kwargs["campus_scope"], "north")
        self.assertTrue(response.answer_text)
        self.assertIn("Evidence snippet 1", response.answer_text)
        self.assertIn("handbook:test-1", response.answer_text)
        self.assertEqual(response.confidence, "medium")
        self.assertEqual(response.result, RagResultPayload(evidence=_make_evidence()))

    def test_confidence_derivation_prefers_stronger_multi_source_evidence(self) -> None:
        self.assertEqual(
            derive_confidence(
                EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
            "low",
        )
        self.assertEqual(derive_confidence(_make_evidence(scores=(0.58,))), "medium")
        self.assertEqual(derive_confidence(_make_evidence(scores=(0.92, 0.89))), "high")


if __name__ == "__main__":
    unittest.main()
