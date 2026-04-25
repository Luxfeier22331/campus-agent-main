from __future__ import annotations

import unittest
from pathlib import Path

RAG_AGENT_PACKAGE = Path("packages/rag-agent/src/campus_rag_agent")
RAG_SERVICE = RAG_AGENT_PACKAGE / "service.py"
RAG_SERVICE_COMMON = RAG_AGENT_PACKAGE / "service_common.py"
RAG_SERVICE_RETRIEVAL = RAG_AGENT_PACKAGE / "service_retrieval.py"
RAG_SERVICE_SYNTHESIS = RAG_AGENT_PACKAGE / "service_answer_synthesis.py"


class RagAgentServiceStructureTest(unittest.TestCase):
    def test_delegate_service_keeps_retrieval_pipeline_in_dedicated_module(self) -> None:
        service_source = RAG_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_RETRIEVAL.exists())
        self.assertNotIn("execute_retrieval_plan", service_source)
        self.assertNotIn("build_ordered_retrieval_plan", service_source)
        self.assertNotIn("load_runtime_profile", service_source)
        self.assertNotIn("interpret_curriculum_query", service_source)

    def test_delegate_service_keeps_answer_synthesis_in_dedicated_module(self) -> None:
        service_source = RAG_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_SYNTHESIS.exists())
        self.assertNotIn("validate_prompt_answer_grounding", service_source)
        self.assertNotIn("build_rag_answer_prompt_packet", service_source)
        self.assertNotIn("should_block_remote_content_generation", service_source)
        self.assertLessEqual(len(service_source.splitlines()), 520)

    def test_retriever_adapter_uses_current_callable_naming(self) -> None:
        scanned_paths = (
            RAG_SERVICE,
            RAG_SERVICE_COMMON,
            RAG_SERVICE_RETRIEVAL,
        )
        for path in scanned_paths:
            if not path.exists():
                continue
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("legacy_retriever", source)
                self.assertNotIn("_execute_retrieval_request_with_legacy_retriever", source)


if __name__ == "__main__":
    unittest.main()
