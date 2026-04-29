from __future__ import annotations

import importlib
import importlib.util
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.curriculum_course_map_docs_surface import (
    CurriculumCourseMapDocsSurfaceMaterializationReport,
)

_MODULE_NAME = "campus_ingestion_worker.materialize_curriculum_course_map_docs_surface"


class MaterializeCurriculumCourseMapDocsSurfaceWorkerCliTest(unittest.TestCase):
    def test_main_runs_materialization_for_requested_documents_and_prints_report(self) -> None:
        module_spec = importlib.util.find_spec(_MODULE_NAME)
        self.assertIsNotNone(module_spec)
        if module_spec is None:
            return
        worker = importlib.import_module(_MODULE_NAME)
        report = CurriculumCourseMapDocsSurfaceMaterializationReport(
            source_document_count=2,
            materialized_document_count=1,
            source_bucket="campus-rag-source",
            derived_bucket="campus-rag-derived",
            raw_asset_id="asset:curriculum-plan-2022",
            raw_version_id="sha256:test-001",
            source_pdf_key="official_pdf/curriculum.pdf",
            provider_response_key="provider/provider-response.jsonl",
            layout_elements_key="source-truth/layout-elements.jsonl",
            materialized_document_ids=("curriculum:法学（民族实验班）本科人才培养方案",),
            purged_document_ids=(
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
            ),
        )
        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as from_env,
            patch(f"{_MODULE_NAME}.materialize_curriculum_course_map_docs_surface") as materialize,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            from_env.return_value.bucket_source = "campus-rag-source"
            from_env.return_value.bucket_derived = "campus-rag-derived"
            materialize.return_value = report
            worker.main(
                [
                    "--source-document-id",
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "--source-document-id",
                    "curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                ]
            )

        materialize.assert_called_once()
        kwargs = materialize.call_args.kwargs
        self.assertEqual(
            kwargs["source_document_ids"],
            (
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
            ),
        )
        self.assertEqual(kwargs["source_bucket"], "campus-rag-source")
        self.assertEqual(kwargs["derived_bucket"], "campus-rag-derived")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["materialized_document_count"], 1)
        self.assertEqual(payload["raw_asset_id"], "asset:curriculum-plan-2022")


if __name__ == "__main__":
    unittest.main()
