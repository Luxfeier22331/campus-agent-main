from __future__ import annotations

import inspect
import unittest
from dataclasses import fields
from unittest.mock import Mock, patch

from campus_contracts import (
    AuthorizedRetrievalFilter,
    EvidenceBundle,
    PersonalizationHint,
)
from campus_retrieval_core.backend_qdrant import RestrictedDocumentAccessDeniedError
from campus_retrieval_core.models import (
    RetrievalRequest,
)
from campus_retrieval_core.service import (
    build_retrieval_backend,
    retrieve_sources,
)


class RetrievalServiceBackendAndRequestProjectionTest(unittest.TestCase):
    def test_build_retrieval_backend_initializes_backend_from_settings(self) -> None:
        settings = object()
        backend = Mock()

        with (
            patch(
                "campus_retrieval_core.service.RetrievalSettings.from_env", return_value=settings
            ) as from_env,
            patch(
                "campus_retrieval_core.service.QdrantRetrievalBackend", return_value=backend
            ) as backend_ctor,
        ):
            runtime_backend = build_retrieval_backend()

        self.assertIs(runtime_backend, backend)
        from_env.assert_called_once_with()
        backend_ctor.assert_called_once_with(settings)

    def test_build_retrieval_backend_reuses_env_backed_runtime_backend(self) -> None:
        settings = Mock()
        first_backend = Mock()
        second_backend = Mock()

        with (
            patch("campus_retrieval_core.service._RUNTIME_BACKEND_CACHE", {}),
            patch(
                "campus_retrieval_core.service.RetrievalSettings.from_env", return_value=settings
            ) as from_env,
            patch(
                "campus_retrieval_core.service.QdrantRetrievalBackend",
                side_effect=(first_backend, second_backend),
            ) as backend_ctor,
        ):
            first = build_retrieval_backend()
            second = build_retrieval_backend()

        self.assertIs(first, first_backend)
        self.assertIs(second, first_backend)
        self.assertEqual(from_env.call_count, 2)
        backend_ctor.assert_called_once_with(settings)

    def test_retrieve_sources_uses_explicit_backend_without_reinitializing_runtime(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="library hours",
            corpus="regulations",
            collection="student_rules",
        )

        result = retrieve_sources(
            "library hours",
            corpus="regulations",
            collection="student_rules",
            authorized_filter=AuthorizedRetrievalFilter(
                entitlement_groups=("students",),
                visibility_level="public",
                policy_projection_version="phase1-authorization-projection-v1",
            ),
            backend=backend,
        )

        self.assertIsInstance(result, EvidenceBundle)
        backend.retrieve.assert_called_once()

    def test_retrieve_sources_uses_runtime_profile_retrieval_budget_when_top_k_is_omitted(
        self,
    ) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        retrieve_sources(
            "民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.top_k, 5)

    def test_retrieve_sources_keeps_explicit_top_k_override(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        retrieve_sources(
            "民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            top_k=7,
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.top_k, 7)

    def test_retrieve_sources_passes_personalization_hint_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="保研流程",
            corpus="regulations",
            collection="student_rules",
        )

        retrieve_sources(
            "保研流程",
            corpus="regulations",
            collection="student_rules",
            personalization_hint=PersonalizationHint(
                actor_claim_terms=("2023 cohort", "philosophy major"),
                recent_goal="咨询保研",
                confirmed_slot_terms=("推免资格",),
            ),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(
            request.personalization_hint,
            PersonalizationHint(
                actor_claim_terms=("2023 cohort", "philosophy major"),
                recent_goal="咨询保研",
                confirmed_slot_terms=("推免资格",),
            ),
        )

    def test_retrieve_sources_passes_authorized_filter_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="保研流程",
            corpus="regulations",
            collection="student_rules",
        )
        authorized_filter = AuthorizedRetrievalFilter(
            entitlement_groups=("entitled-students",),
            visibility_scope="north",
        )

        retrieve_sources(
            "保研流程",
            corpus="regulations",
            collection="student_rules",
            authorized_filter=authorized_filter,
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.authorized_filter, authorized_filter)

    def test_retrieve_sources_propagates_restricted_access_denied(self) -> None:
        backend = Mock()
        backend.retrieve.side_effect = RestrictedDocumentAccessDeniedError(
            "restricted document access denied"
        )

        with self.assertRaises(RestrictedDocumentAccessDeniedError):
            retrieve_sources(
                "这条通知写了什么？",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=("handbook:restricted-notice",),
                backend=backend,
            )

    def test_retrieve_sources_passes_target_document_ids_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="国奖评审办法里的论文要求是什么？",
            corpus="regulations",
            collection="student_rules",
        )

        retrieve_sources(
            "国奖评审办法里的论文要求是什么？",
            corpus="regulations",
            collection="student_rules",
            target_document_ids=("handbook:national-scholarship",),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.target_document_ids, ("handbook:national-scholarship",))

    def test_retrieve_sources_passes_preferred_document_ids_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="基地班培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        retrieve_sources(
            "基地班培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            preferred_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(
            request.preferred_document_ids,
            ("curriculum:历史学（强基计划）本科人才培养方案",),
        )

    def test_retrieve_sources_passes_version_filters_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="旧版国奖评审办法",
            corpus="regulations",
            collection="student_rules",
        )

        retrieve_sources(
            "旧版国奖评审办法",
            corpus="regulations",
            collection="student_rules",
            target_document_ids=("handbook:national-scholarship",),
            target_version_ids=("v1:national-scholarship",),
            target_revision_track="source-faithful",
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.target_version_ids, ("v1:national-scholarship",))
        self.assertEqual(request.target_revision_track, "source-faithful")

    def test_retrieve_sources_passes_canonical_course_filters_through_request(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="习概有哪些专业要上",
            corpus="curriculum",
            collection="course_facts",
        )

        retrieve_sources(
            "习概有哪些专业要上",
            corpus="curriculum",
            collection="course_facts",
            canonical_course_ids=("course:muc.xigai",),
            canonical_course_family_ids=("course_family:muc.ideological_political_theory",),
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.canonical_course_ids, ("course:muc.xigai",))
        self.assertEqual(
            request.canonical_course_family_ids,
            ("course_family:muc.ideological_political_theory",),
        )

    def test_retrieve_sources_exposes_program_family_filter_surface(self) -> None:
        self.assertIn(
            "canonical_program_family_ids", inspect.signature(retrieve_sources).parameters
        )
        self.assertIn(
            "canonical_program_family_ids",
            {field.name for field in fields(RetrievalRequest)},
        )

    def test_retrieval_request_omits_non_canonical_top_level_authz_fields(self) -> None:
        field_names = {field.name for field in fields(RetrievalRequest)}
        parameter_names = set(inspect.signature(RetrievalRequest).parameters)

        self.assertNotIn("acl_groups", field_names)
        self.assertNotIn("campus_scope", field_names)
        self.assertNotIn("acl_groups", parameter_names)
        self.assertNotIn("campus_scope", parameter_names)
