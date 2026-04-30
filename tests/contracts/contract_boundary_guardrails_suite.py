from __future__ import annotations

import unittest
from pathlib import Path

CONTRACTS_PACKAGE = Path("packages/contracts/src/campus_contracts")


class ContractBoundaryGuardrailsTest(unittest.TestCase):
    def test_contracts_do_not_expose_runtime_or_infra_types(self) -> None:
        forbidden_fragments = (
            "Qdrant",
            "MinIO",
            "S3ObjectStore",
            "Agno",
            "openai-agents",
            "openai_agents",
            "from agents",
            "LlamaIndex",
            "qdrant_client",
            "llama_index",
            "supervisor_bridge_v",
            "runtime_decisions",
            "terminal_envelope",
        )
        for path in sorted(CONTRACTS_PACKAGE.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for fragment in forbidden_fragments:
                    self.assertNotIn(fragment, source)


if __name__ == "__main__":
    unittest.main()
