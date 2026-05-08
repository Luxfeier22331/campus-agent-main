from __future__ import annotations

import unittest
from pathlib import Path


class RagAgentSdkRolloutTest(unittest.TestCase):
    def test_rollout_modes_are_removed_from_service_and_models(self) -> None:
        model_path = Path("packages/rag-agent/src/campus_rag_agent/rag_sdk_models.py")
        service_path = Path("packages/rag-agent/src/campus_rag_agent/service.py")
        deleted_runtime_path = Path("packages/rag-agent/src/campus_rag_agent/rag_sdk_service.py")
        model_source = model_path.read_text(encoding="utf-8")
        service_source = service_path.read_text(encoding="utf-8")

        for fragment in (
            "RagSdkRolloutMode",
            "rag_sdk_rollout_mode",
            "shadow",
            "candidate",
            "default_on",
            "fallback_only",
            "should_attempt_rag_sdk",
            "should_return_rag_sdk_response",
        ):
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, model_source)
                self.assertNotIn(fragment, service_source)
        self.assertFalse(deleted_runtime_path.exists())


if __name__ == "__main__":
    unittest.main()
