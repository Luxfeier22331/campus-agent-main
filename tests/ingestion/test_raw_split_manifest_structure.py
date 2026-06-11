from __future__ import annotations

import ast
import unittest
from pathlib import Path


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules.add(node.module)
    return modules


class RawSplitManifestStructureTest(unittest.TestCase):
    def test_raw_split_manifest_module_keeps_domain_adapters_out(self) -> None:
        module_path = Path(
            "packages/ingestion-core/src/campus_ingestion_core/raw_ingestion_split_manifest.py"
        )

        imported_modules = _imported_modules(module_path)

        disallowed_modules = {
            "campus_ingestion_core.curriculum_chunk_units_shared",
            "campus_ingestion_core.curriculum_course_facts_projection",
            "campus_ingestion_core.curriculum_program_family_facts_projection",
            "campus_ingestion_core.curriculum_program_semester_facts_projection",
            "campus_ingestion_core.curriculum_title_normalization",
            "campus_ingestion_core.handbook_cleanup",
            "campus_ingestion_core.handbook_provider_normalize",
            "campus_ingestion_core.handbook_source_projections",
        }
        leaked_modules = imported_modules & disallowed_modules

        self.assertEqual(leaked_modules, set())


if __name__ == "__main__":
    unittest.main()
