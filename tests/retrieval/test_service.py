from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle
from campus_retrieval_core.service import clear_backend_cache, retrieve_sources


class RetrievalServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        clear_backend_cache()

    def tearDown(self) -> None:
        clear_backend_cache()

    def test_retrieve_sources_reuses_singleton_backend_for_same_settings(self) -> None:
        settings = object()
        backend = Mock()
        backend.retrieve.return_value = EvidenceBundle(
            query_text="library hours",
            corpus="regulations",
            collection="student_handbook",
        )

        with (
            patch("campus_retrieval_core.service.RetrievalSettings.from_env", return_value=settings) as from_env,
            patch("campus_retrieval_core.service.QdrantRetrievalBackend", return_value=backend) as backend_ctor,
        ):
            first = retrieve_sources(
                "library hours",
                corpus="regulations",
                collection="student_handbook",
                acl_groups=("students",),
            )
            second = retrieve_sources(
                "dorm rules",
                corpus="regulations",
                collection="student_handbook",
                acl_groups=("students",),
            )

        self.assertIsInstance(first, EvidenceBundle)
        self.assertIsInstance(second, EvidenceBundle)
        self.assertEqual(from_env.call_count, 2)
        backend_ctor.assert_called_once_with(settings)
        self.assertEqual(backend.retrieve.call_count, 2)


if __name__ == "__main__":
    unittest.main()
