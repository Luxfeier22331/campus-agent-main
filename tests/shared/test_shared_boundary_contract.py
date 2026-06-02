from __future__ import annotations

import importlib
import unittest


class SharedBoundaryContractTest(unittest.TestCase):
    def test_regulation_semantics_has_explicit_owner_package(self) -> None:
        module = importlib.import_module("campus_regulation_semantics")

        self.assertTrue(hasattr(module, "validate_answer_ready_evidence_metadata"))
        self.assertTrue(hasattr(module, "load_default_regulation_semantics_registry"))

    def test_campus_shared_does_not_export_regulation_semantics(self) -> None:
        shared = importlib.import_module("campus_shared")

        self.assertFalse(hasattr(shared, "validate_answer_ready_evidence_metadata"))
        self.assertFalse(hasattr(shared, "load_default_regulation_semantics_registry"))
        with self.assertRaises(ModuleNotFoundError):
            importlib.import_module("campus_shared.regulation_semantic_registry")
        with self.assertRaises(ModuleNotFoundError):
            importlib.import_module("campus_shared.answer_ready_evidence_contract")


if __name__ == "__main__":
    unittest.main()
