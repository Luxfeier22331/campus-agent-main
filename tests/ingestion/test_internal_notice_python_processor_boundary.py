from __future__ import annotations

import unittest
from pathlib import Path

from tests.ingestion.test_ingestion_clean_target_boundary import (
    ACTIVE_REFERENCE_ROOTS,
    REFERENCE_ALLOWLIST,
    REMOVED_INTERNAL_NOTICE_PYTHON_PROCESSOR_TERMS,
    REPO_ROOT,
    TEXT_SUFFIXES,
)

PROCESSOR_BOUNDARY_REFERENCE_ALLOWLIST = {
    *REFERENCE_ALLOWLIST,
    Path("tests/ingestion/clean_target_boundary_support.py"),
}


class InternalNoticePythonProcessorBoundaryTest(unittest.TestCase):
    def test_active_tree_does_not_reintroduce_internal_notice_python_processors(
        self,
    ) -> None:
        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                relative_path = path.relative_to(REPO_ROOT)
                if (
                    relative_path in REFERENCE_ALLOWLIST
                    or "archive" in relative_path.parts
                    or relative_path.parts[:2] == ("docs", "decisions")
                ):
                    continue
                lines = path.read_text(encoding="utf-8").splitlines()
                for term in sorted(REMOVED_INTERNAL_NOTICE_PYTHON_PROCESSOR_TERMS):
                    for line_number, line in enumerate(lines, start=1):
                        if (
                            relative_path in PROCESSOR_BOUNDARY_REFERENCE_ALLOWLIST
                            or "assertNotIn(" in line
                        ):
                            continue
                        if term in line:
                            offenders.append(f"{relative_path}:{line_number}: {term}")

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
