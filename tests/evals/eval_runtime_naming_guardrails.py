from __future__ import annotations

import unittest
from pathlib import Path

EVALS_PACKAGE = Path("packages/evals/src/campus_evals")


class EvalRuntimeNamingGuardrailTest(unittest.TestCase):
    def test_direct_agent_eval_executors_do_not_use_legacy_runtime_names(self) -> None:
        scanned_paths = (
            EVALS_PACKAGE / "curriculum_live_benchmark.py",
            EVALS_PACKAGE / "handbook_live_benchmark.py",
            EVALS_PACKAGE / "__init__.py",
        )
        forbidden_fragments = (
            "build_legacy_curriculum_live_executor",
            "build_legacy_handbook_live_executor",
            "legacy_executor",
        )
        for path in scanned_paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for fragment in forbidden_fragments:
                    self.assertNotIn(fragment, source)


if __name__ == "__main__":
    unittest.main()
