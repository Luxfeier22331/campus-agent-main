from __future__ import annotations

import importlib
import importlib.util
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    CurriculumProgramSemesterFactsMaterializationReport,
)


_MODULE_NAME = "campus_ingestion_worker.materialize_curriculum_program_semester_facts"


class MaterializeCurriculumProgramSemesterFactsWorkerCliTest(unittest.TestCase):
    def test_main_runs_canonical_scope_materialization_and_prints_report(self) -> None:
        module_spec = importlib.util.find_spec(_MODULE_NAME)
        self.assertIsNotNone(module_spec)
        if module_spec is None:
            return
        worker = importlib.import_module(_MODULE_NAME)
        report = CurriculumProgramSemesterFactsMaterializationReport(
            source_document_count=69,
            materialized_document_count=380,
            created_document_ids=("program_semester_facts:law:semester-4",),
            updated_document_ids=(),
            raw_asset_id="asset:curriculum-plan-2022",
            raw_version_id="sha256:test-001",
            source_pdf="curriculum-plan-2022.pdf",
        )
        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.materialize_curriculum_program_semester_facts_from_canonical_scope"
            ) as materialize,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            materialize.return_value = report
            worker.main([])

        materialize.assert_called_once_with()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["materialized_document_count"], 380)
        self.assertEqual(payload["raw_asset_id"], "asset:curriculum-plan-2022")


if __name__ == "__main__":
    unittest.main()
