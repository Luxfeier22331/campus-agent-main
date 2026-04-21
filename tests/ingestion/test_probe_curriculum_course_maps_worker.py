from __future__ import annotations

import importlib
import importlib.util
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    CurriculumCourseMapAdmissionSummary,
    CurriculumCourseMapGoldReport,
    CurriculumCourseMapProbeReport,
    CurriculumCourseMapRepeatabilityReport,
)

_MODULE_NAME = "campus_ingestion_worker.probe_curriculum_course_maps"


class ProbeCurriculumCourseMapsWorkerCliTest(unittest.TestCase):
    def test_main_runs_probe_and_prints_json_report(self) -> None:
        module_spec = importlib.util.find_spec(_MODULE_NAME)
        self.assertIsNotNone(module_spec)
        if module_spec is None:
            return
        worker = importlib.import_module(_MODULE_NAME)
        report = CurriculumCourseMapProbeReport(
            schema_version="curriculum_course_map_multimodal_probe_v1",
            source_bucket="campus-rag-source",
            raw_asset_id="asset:curriculum-plan-2022",
            raw_version_id="sha256:test",
            source_pdf_key="source.pdf",
            provider_response_key="provider-response.jsonl",
            layout_elements_key="layout-elements.jsonl",
            inventory_count=42,
            selected_sample_count=12,
            sample_ids=("course-map-p207",),
            run_count=3,
            output_dir="/tmp/course-map-probe",
            runs=(),
            repeatability=CurriculumCourseMapRepeatabilityReport(
                schema_version="curriculum_course_map_multimodal_probe_v1",
                threshold=0.78,
                page_scores=(),
                pass_rate=1.0,
                overall_score=0.93,
            ),
            gold=CurriculumCourseMapGoldReport(
                schema_version="curriculum_course_map_multimodal_probe_v1",
                page_scores=(),
                pass_rate=0.83,
            ),
            admission=CurriculumCourseMapAdmissionSummary(
                schema_version="curriculum_course_map_multimodal_probe_v1",
                recommendation="bounded_candidate_for_follow_up",
                repeatability_pass_rate=1.0,
                gold_pass_rate=0.83,
                repeatability_overall_score=0.93,
                reasons=("repeatability gate reached bounded admission threshold",),
            ),
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.run_curriculum_course_map_multimodal_probe", return_value=report
            ) as run_probe,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--source-bucket", "campus-rag-source", "--prompt-runs", "3"])

        run_probe.assert_called_once()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["inventory_count"], 42)
        self.assertEqual(payload["admission"]["recommendation"], "bounded_candidate_for_follow_up")


if __name__ == "__main__":
    unittest.main()
