from __future__ import annotations

import io
import json
import unittest
from unittest.mock import patch

from tests.ingestion._curriculum_course_map_probe_test_support import (
    load_curriculum_course_map_probe_module,
    load_probe_curriculum_course_maps_worker_module,
)

_probe_module = load_curriculum_course_map_probe_module()
CurriculumCourseMapAdmissionSummary = _probe_module.CurriculumCourseMapAdmissionSummary
CurriculumCourseMapGoldReport = _probe_module.CurriculumCourseMapGoldReport
CurriculumCourseMapProbeReport = _probe_module.CurriculumCourseMapProbeReport
CurriculumCourseMapRepeatabilityReport = _probe_module.CurriculumCourseMapRepeatabilityReport


class ProbeCurriculumCourseMapsWorkerCliTest(unittest.TestCase):
    def test_main_runs_probe_and_prints_json_report(self) -> None:
        worker = load_probe_curriculum_course_maps_worker_module()
        report = CurriculumCourseMapProbeReport(
            schema_version="curriculum_course_map_multimodal_probe_v2",
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
                schema_version="curriculum_course_map_multimodal_probe_v2",
                threshold=0.78,
                page_scores=(),
                pass_rate=1.0,
                overall_score=0.93,
            ),
            gold=CurriculumCourseMapGoldReport(
                schema_version="curriculum_course_map_multimodal_probe_v2",
                page_scores=(),
                pass_rate=0.83,
            ),
            admission=CurriculumCourseMapAdmissionSummary(
                schema_version="curriculum_course_map_multimodal_probe_v2",
                recommendation="bounded_candidate_for_follow_up",
                repeatability_pass_rate=1.0,
                gold_pass_rate=0.83,
                repeatability_overall_score=0.93,
                reasons=("repeatability gate reached bounded admission threshold",),
            ),
        )

        with (
            patch.object(worker, "load_worker_env"),
            patch.object(
                worker, "run_curriculum_course_map_multimodal_probe", return_value=report
            ) as run_probe,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(
                [
                    "--source-bucket",
                    "campus-rag-source",
                    "--prompt-runs",
                    "3",
                    "--prompt-transport",
                    "chat_completions",
                    "--max-inflight-pages",
                    "2",
                    "--max-request-attempts",
                    "4",
                    "--resume",
                ]
            )

        run_probe.assert_called_once()
        _, kwargs = run_probe.call_args
        self.assertEqual(kwargs["prompt_transport"], "chat_completions")
        self.assertEqual(kwargs["max_inflight_pages"], 2)
        self.assertEqual(kwargs["max_request_attempts"], 4)
        self.assertTrue(kwargs["resume"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["inventory_count"], 42)
        self.assertEqual(payload["admission"]["recommendation"], "bounded_candidate_for_follow_up")


if __name__ == "__main__":
    unittest.main()
