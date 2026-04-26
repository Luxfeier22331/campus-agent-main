from __future__ import annotations

import unittest
from pathlib import Path

RETRIEVAL_CORE = Path("packages/retrieval-core/src/campus_retrieval_core")
QDRANT_BACKEND = RETRIEVAL_CORE / "backend_qdrant.py"
QDRANT_BACKEND_ERRORS = RETRIEVAL_CORE / "backend_qdrant_errors.py"
QDRANT_BACKEND_EMBEDDINGS = RETRIEVAL_CORE / "backend_qdrant_embeddings.py"
QDRANT_BACKEND_EVIDENCE = RETRIEVAL_CORE / "backend_qdrant_evidence.py"
QDRANT_BACKEND_REGISTRY = RETRIEVAL_CORE / "backend_qdrant_registry.py"
RETRIEVAL_SERVICE = RETRIEVAL_CORE / "service.py"
RETRIEVAL_SERVICE_EXECUTION = RETRIEVAL_CORE / "service_execution.py"
RETRIEVAL_SERVICE_REQUESTS = RETRIEVAL_CORE / "service_requests.py"


class RetrievalCoreStructureTest(unittest.TestCase):
    def test_qdrant_backend_is_split_by_runtime_concern(self) -> None:
        backend_source = QDRANT_BACKEND.read_text(encoding="utf-8")

        self.assertTrue(QDRANT_BACKEND_ERRORS.exists())
        self.assertTrue(QDRANT_BACKEND_EMBEDDINGS.exists())
        self.assertTrue(QDRANT_BACKEND_EVIDENCE.exists())
        self.assertTrue(QDRANT_BACKEND_REGISTRY.exists())
        self.assertNotIn("class RetrievalBackendError", backend_source)
        self.assertNotIn("def _build_evidence_sources", backend_source)
        self.assertNotIn("def _get_dense_query_embedding", backend_source)
        self.assertNotIn("def _get_current_registry_record", backend_source)
        self.assertLessEqual(len(backend_source.splitlines()), 620)

    def test_retrieval_service_keeps_request_projection_and_execution_split(self) -> None:
        service_source = RETRIEVAL_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RETRIEVAL_SERVICE_EXECUTION.exists())
        self.assertTrue(RETRIEVAL_SERVICE_REQUESTS.exists())
        self.assertNotIn("def _build_retrieval_request", service_source)
        self.assertNotIn("def _execute_retrieval_step", service_source)
        self.assertLessEqual(len(service_source.splitlines()), 520)


if __name__ == "__main__":
    unittest.main()
