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
    def test_main_runs_canonical_scope_materialization_for_requested_source_documents_and_prints_report(
        self,
    ) -> None:
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
                f"{_MODULE_NAME}.rematerialize_curriculum_program_semester_facts_from_local_rebuild"
            ) as materialize,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            materialize.return_value = report
            worker.main(
                [
                    "--source-document-id",
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "--source-document-id",
                    "curriculum:历史学（强基计划）本科人才培养方案",
                ]
            )

        materialize.assert_called_once_with(
            source_document_ids=(
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:历史学（强基计划）本科人才培养方案",
            )
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["materialized_document_count"], 380)
        self.assertEqual(payload["raw_asset_id"], "asset:curriculum-plan-2022")


if __name__ == "__main__":
    unittest.main()
