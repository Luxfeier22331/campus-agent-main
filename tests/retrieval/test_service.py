from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle
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


if __name__ == "__main__":
    unittest.main()
