from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, PersonalizationHint
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.service import build_retrieval_backend, retrieve_sources


class RetrievalServiceTest(unittest.TestCase):
    def test_build_retrieval_backend_initializes_backend_from_settings(self) -> None:
        settings = object()
        backend = Mock()

        with (
            patch("campus_retrieval_core.service.RetrievalSettings.from_env", return_value=settings) as from_env,
            patch("campus_retrieval_core.service.QdrantRetrievalBackend", return_value=backend) as backend_ctor,
        ):
            runtime_backend = build_retrieval_backend()

        self.assertIs(runtime_backend, backend)
        from_env.assert_called_once_with()
        backend_ctor.assert_called_once_with(settings)

    def test_retrieve_sources_uses_explicit_backend_without_reinitializing_runtime(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="library hours",
            corpus="regulations",
            collection="student_handbook",
        )

        result = retrieve_sources(
            "library hours",
            corpus="regulations",
            collection="student_handbook",
            acl_groups=("students",),
            backend=backend,
        )

        self.assertIsInstance(result, EvidenceBundle)
        backend.retrieve.assert_called_once()

    def test_retrieve_sources_uses_runtime_profile_retrieval_budget_when_top_k_is_omitted(self) -> None:
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
            collection="student_handbook",
        )

        retrieve_sources(
            "保研流程",
            corpus="regulations",
            collection="student_handbook",
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

    def test_retrieve_sources_passes_authorized_filter_with_legacy_compatibility_fields(self) -> None:
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="保研流程",
            corpus="regulations",
            collection="student_handbook",
        )
        authorized_filter = AuthorizedRetrievalFilter(
            acl_groups=("entitled-students",),
            visibility_scope="north",
            campus_scope="north",
        )

        retrieve_sources(
            "保研流程",
            corpus="regulations",
            collection="student_handbook",
            campus_scope="legacy-campus",
            acl_groups=("legacy-group",),
            authorized_filter=authorized_filter,
            backend=backend,
        )

        request = backend.retrieve.call_args.args[0]
        self.assertIsInstance(request, RetrievalRequest)
        self.assertEqual(request.authorized_filter, authorized_filter)
        self.assertEqual(request.acl_groups, ("legacy-group",))
        self.assertEqual(request.campus_scope, "legacy-campus")


if __name__ == "__main__":
    unittest.main()
