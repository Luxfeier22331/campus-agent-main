from __future__ import annotations

import unittest
from pathlib import Path

RETRIEVAL_CORE = Path("packages/retrieval-core/src/campus_retrieval_core")
QDRANT_BACKEND = RETRIEVAL_CORE / "backend_qdrant.py"
QDRANT_BACKEND_ERRORS = RETRIEVAL_CORE / "backend_qdrant_errors.py"
QDRANT_BACKEND_EMBEDDINGS = RETRIEVAL_CORE / "backend_qdrant_embeddings.py"
QDRANT_BACKEND_EVIDENCE = RETRIEVAL_CORE / "backend_qdrant_evidence.py"
QDRANT_BACKEND_REGISTRY = RETRIEVAL_CORE / "backend_qdrant_registry.py"
QDRANT_BACKEND_ACCESS = RETRIEVAL_CORE / "backend_qdrant_access.py"
QDRANT_BACKEND_DOCUMENT_SUPPORT = RETRIEVAL_CORE / "backend_qdrant_document_support.py"
QDRANT_BACKEND_POLICIES = RETRIEVAL_CORE / "backend_qdrant_policies.py"
QDRANT_NO_HIT_POLICY = RETRIEVAL_CORE / "backend_qdrant_no_hit_policy.py"
QDRANT_OFFICIAL_WEB_POLICY = RETRIEVAL_CORE / "backend_qdrant_official_web_policy.py"
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
        self.assertTrue(QDRANT_BACKEND_ACCESS.exists())
        self.assertTrue(QDRANT_BACKEND_DOCUMENT_SUPPORT.exists())
        self.assertNotIn("class RetrievalBackendError", backend_source)
        self.assertNotIn("def _build_evidence_sources", backend_source)
        self.assertNotIn("def _get_dense_query_embedding", backend_source)
        self.assertNotIn("def _get_current_registry_record", backend_source)
        self.assertNotIn("def _fail_closed_on_denied_target_documents", backend_source)
        self.assertNotIn("def _expand_named_document_support", backend_source)
        self.assertNotIn("def _recover_official_web_lead_chunk_support", backend_source)
        self.assertLessEqual(len(backend_source.splitlines()), 420)

    def test_qdrant_backend_policies_are_split_by_domain(self) -> None:
        policy_source = QDRANT_BACKEND_POLICIES.read_text(encoding="utf-8")

        self.assertTrue(QDRANT_NO_HIT_POLICY.exists())
        self.assertTrue(QDRANT_OFFICIAL_WEB_POLICY.exists())
        self.assertNotIn("_OFFICIAL_WEB_GENERIC_QUERY_TERMS =", policy_source)
        self.assertNotIn("def _select_official_web_scholar_support_sources", policy_source)
        self.assertNotIn("def _has_query_lexical_support", policy_source)
        self.assertLessEqual(len(policy_source.splitlines()), 120)

    def test_retrieval_service_keeps_request_projection_and_execution_split(self) -> None:
        service_source = RETRIEVAL_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RETRIEVAL_SERVICE_EXECUTION.exists())
        self.assertTrue(RETRIEVAL_SERVICE_REQUESTS.exists())
        self.assertNotIn("def _build_retrieval_request", service_source)
        self.assertNotIn("def _execute_retrieval_step", service_source)
        self.assertLessEqual(len(service_source.splitlines()), 520)


if __name__ == "__main__":
    unittest.main()
