from __future__ import annotations

import signal
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scripts.academic_calendar_selected_write_runtime_smoke as smoke


class AcademicCalendarSelectedWriteRuntimeSmokeTest(unittest.TestCase):
    def test_plan_starts_only_execution_control_against_current_postgres_projection(self) -> None:
        plan = smoke.build_academic_calendar_selected_write_runtime_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/academic-calendar-smoke"),
            database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
            structured_query_secret="query-secret",
            api_port=19281,
        )

        self.assertEqual(len(plan.processes), 1)
        process = plan.processes[0]
        self.assertEqual(process.label, "execution-control")
        self.assertEqual(process.command, ("go", "run", "./cmd/execution-control"))
        self.assertEqual(process.cwd, Path("/repo/apps/execution-control"))
        self.assertEqual(process.env["CAMPUS_AGENT_HTTP_PORT"], "19281")
        self.assertEqual(
            process.env["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
        )
        self.assertEqual(
            process.env["EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"], "query-secret"
        )
        self.assertNotIn("EXECUTION_CONTROL_OPEN_CAPABILITIES", process.env)
        command_words = [word for command in plan.processes for word in command.command]
        self.assertNotIn("docker", command_words)
        self.assertNotIn("wrangler", command_words)

    def test_plan_uses_explicit_trusted_time_anchor_when_provided(self) -> None:
        plan = smoke.build_academic_calendar_selected_write_runtime_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/academic-calendar-smoke"),
            database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
            structured_query_secret="query-secret",
            trusted_time_rfc3339="2026-05-04T00:00:01Z",
            api_port=19281,
        )

        self.assertEqual(
            plan.processes[0].env["EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"],
            "2026-05-04T00:00:01Z",
        )

    def test_run_smoke_passes_current_release_runtime_probes(self) -> None:
        class FakeProcess:
            pid = 4321

            def poll(self) -> None:
                return None

            def wait(self, timeout: float | None = None) -> int:
                return 0

        responses = {
            "teaching_week_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "week_index": 10,
                    "source_refs": ["official_web:muc-public-academic-calendar:owver"],
                },
            ),
            "holiday_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "day_kind": "course_suspension",
                    "display_start_date": "2026-04-27",
                    "display_end_date": "2026-05-05",
                    "event_name": "运动会、春季社会实践周、劳动节假期课程调整",
                    "source_refs": ["authenticated_notice:355682"],
                },
            ),
            "spring_break_alias_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "day_kind": "course_suspension",
                    "display_start_date": "2026-04-27",
                    "display_end_date": "2026-05-05",
                    "event_name": "运动会、春季社会实践周、劳动节假期课程调整",
                    "event_aliases": ["春假", "春季社会实践周"],
                    "source_refs": ["authenticated_notice:355682"],
                },
            ),
            "notice_rest_day_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "day_kind": "normal_rest_day",
                    "is_makeup_class": False,
                    "conflict_refs": ["calendar:official_web:baseline-2026-05-09"],
                    "source_refs": ["official_web:muc-public-academic-calendar:owver"],
                },
            ),
        }

        def fake_post_probe(
            _url: str,
            probe: smoke.AcademicCalendarRuntimeProbe,
            *,
            secret: str,
            timeout_seconds: float,
        ) -> tuple[int, object]:
            self.assertEqual(secret, "query-secret")
            self.assertGreater(timeout_seconds, 0)
            return responses[probe.probe_id]

        with tempfile.TemporaryDirectory() as temp_dir:
            plan = smoke.build_academic_calendar_selected_write_runtime_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(temp_dir),
                database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                structured_query_secret="query-secret",
            )
            with (
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", return_value=200),
                patch.object(smoke, "_post_academic_calendar_probe", side_effect=fake_post_probe),
                patch.object(
                    smoke,
                    "load_current_academic_calendar_projection_summary",
                    return_value=smoke.CurrentAcademicCalendarProjectionSummary(
                        release_id="academic-calendar-20260504T090000",
                        academic_calendar_records=3,
                    ),
                ),
                patch.object(smoke.os, "killpg") as killpg,
            ):
                report = smoke.run_academic_calendar_selected_write_runtime_smoke(
                    plan,
                    timeout_seconds=1,
                    startup_timeout_seconds=1,
                )

        self.assertTrue(report["passed"])
        self.assertEqual(report["projection"]["release_id"], "academic-calendar-20260504T090000")
        self.assertEqual(report["projection"]["academic_calendar_records"], 3)
        self.assertEqual(
            report["processes"][0]["env"]["CAMPUS_SHARED_POSTGRES_URL"],
            "<redacted>",
        )
        self.assertEqual(len(report["probes"]["academic_calendar_queries"]), 4)
        self.assertEqual(report["probes"]["failed_probe_ids"], [])
        killpg.assert_called_once_with(4321, signal.SIGTERM)

    def test_run_smoke_fails_when_resolved_probe_lacks_source_refs(self) -> None:
        class FakeProcess:
            pid = 4321

            def poll(self) -> None:
                return None

            def wait(self, timeout: float | None = None) -> int:
                return 0

        def fake_post_probe(
            _url: str,
            probe: smoke.AcademicCalendarRuntimeProbe,
            *,
            secret: str,
            timeout_seconds: float,
        ) -> tuple[int, object]:
            if probe.probe_id == "teaching_week_current":
                return 200, {"outcome": "resolved_current", "week_index": 10, "source_refs": []}
            if probe.probe_id == "holiday_current":
                return 200, {
                    "outcome": probe.expected_outcome,
                    "day_kind": "course_suspension",
                    "display_start_date": "2026-04-27",
                    "display_end_date": "2026-05-05",
                    "event_name": "运动会、春季社会实践周、劳动节假期课程调整",
                    "source_refs": ["authenticated_notice:355682"],
                }
            if probe.probe_id == "spring_break_alias_current":
                return 200, {
                    "outcome": probe.expected_outcome,
                    "day_kind": "course_suspension",
                    "display_start_date": "2026-04-27",
                    "display_end_date": "2026-05-05",
                    "event_name": "运动会、春季社会实践周、劳动节假期课程调整",
                    "event_aliases": ["春假", "春季社会实践周"],
                    "source_refs": ["authenticated_notice:355682"],
                }
            return 200, {
                "outcome": probe.expected_outcome,
                "day_kind": "normal_rest_day",
                "is_makeup_class": False,
                "conflict_refs": ["calendar:official_web:baseline-2026-05-09"],
                "source_refs": ["authenticated_notice:355589", "authenticated_notice:355682"],
            }

        with tempfile.TemporaryDirectory() as temp_dir:
            plan = smoke.build_academic_calendar_selected_write_runtime_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(temp_dir),
                database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                structured_query_secret="query-secret",
            )
            with (
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", return_value=200),
                patch.object(smoke, "_post_academic_calendar_probe", side_effect=fake_post_probe),
                patch.object(
                    smoke,
                    "load_current_academic_calendar_projection_summary",
                    return_value=smoke.CurrentAcademicCalendarProjectionSummary(
                        release_id="academic-calendar-20260504T090000",
                        academic_calendar_records=3,
                    ),
                ),
            ):
                report = smoke.run_academic_calendar_selected_write_runtime_smoke(
                    plan,
                    timeout_seconds=1,
                    startup_timeout_seconds=1,
                )

        self.assertFalse(report["passed"])
        self.assertEqual(report["probes"]["failed_probe_ids"], ["teaching_week_current"])

    def test_script_help_is_executable_from_non_repo_cwd(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp_dir:
            result = subprocess.run(
                [
                    "uv",
                    "run",
                    "--all-packages",
                    "python",
                    str(
                        repo_root / "scripts" / "academic_calendar_selected_write_runtime_smoke.py"
                    ),
                    "--help",
                ],
                cwd=temp_dir,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("calendar/academic_calendar", result.stdout)


if __name__ == "__main__":
    unittest.main()
