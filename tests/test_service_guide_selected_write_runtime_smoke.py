from __future__ import annotations

import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scripts.service_guide_selected_write_runtime_smoke as smoke


class ServiceGuideSelectedWriteRuntimeSmokeTest(unittest.TestCase):
    def test_plan_starts_only_execution_control_against_current_postgres_projection(self) -> None:
        plan = smoke.build_service_guide_selected_write_runtime_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/service-guide-smoke"),
            database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
            structured_query_secret="query-secret",
            api_port=19181,
        )

        self.assertEqual(len(plan.processes), 1)
        process = plan.processes[0]
        self.assertEqual(process.label, "execution-control")
        self.assertEqual(process.command, ("go", "run", "./cmd/execution-control"))
        self.assertEqual(process.cwd, Path("/repo/apps/execution-control"))
        self.assertEqual(process.env["CAMPUS_AGENT_HTTP_PORT"], "19181")
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

    def test_plan_chooses_available_port_when_not_explicitly_configured(self) -> None:
        plan = smoke.build_service_guide_selected_write_runtime_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/service-guide-smoke"),
            database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
            structured_query_secret="query-secret",
            api_port=0,
        )

        port = int(plan.processes[0].env["CAMPUS_AGENT_HTTP_PORT"])
        self.assertGreater(port, 0)
        self.assertEqual(plan.api_base_url, f"http://127.0.0.1:{port}")

    def test_plan_uses_explicit_trusted_time_anchor_when_provided(self) -> None:
        plan = smoke.build_service_guide_selected_write_runtime_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/service-guide-smoke"),
            database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
            structured_query_secret="query-secret",
            trusted_time_rfc3339="2026-05-04T00:00:01Z",
            api_port=19181,
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
            "procedure_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "resolved_service": {
                        "service_id": "svc-info",
                        "display_name": "信息公开申请流程",
                    },
                },
            ),
            "phone_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "field_status": {"phone": "present"},
                    "contact_refs": [
                        {"phone": "010-68932551"},
                        {"phone": "010-68933983"},
                    ],
                },
            ),
            "responsible_department_current": (
                200,
                {
                    "outcome": "resolved_current",
                    "contact_refs": [{"department": "学校信息公开办公室"}],
                },
            ),
        }

        def fake_post_probe(
            _url: str,
            probe: smoke.ServiceGuideRuntimeProbe,
            *,
            secret: str,
            timeout_seconds: float,
        ) -> tuple[int, object]:
            self.assertEqual(secret, "query-secret")
            self.assertGreater(timeout_seconds, 0)
            return responses[probe.probe_id]

        with tempfile.TemporaryDirectory() as temp_dir:
            plan = smoke.build_service_guide_selected_write_runtime_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(temp_dir),
                database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                structured_query_secret="query-secret",
            )
            with (
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", return_value=200),
                patch.object(smoke, "_post_service_guide_probe", side_effect=fake_post_probe),
                patch.object(
                    smoke,
                    "load_current_service_guide_projection_summary",
                    return_value=smoke.CurrentServiceGuideProjectionSummary(
                        release_id="owrelease_selected_write_123",
                        service_guide_records=2,
                        conflict_records=0,
                        manual_review_sources=0,
                    ),
                ),
                patch.object(smoke.os, "killpg") as killpg,
            ):
                report = smoke.run_service_guide_selected_write_runtime_smoke(
                    plan,
                    timeout_seconds=1,
                    startup_timeout_seconds=1,
                )

        self.assertTrue(report["passed"])
        self.assertEqual(report["projection"]["release_id"], "owrelease_selected_write_123")
        self.assertEqual(report["projection"]["service_guide_records"], 2)
        self.assertEqual(
            report["processes"][0]["env"]["CAMPUS_SHARED_POSTGRES_URL"],
            "<redacted>",
        )
        self.assertEqual(len(report["probes"]["service_guide_queries"]), 3)
        self.assertEqual(report["probes"]["failed_probe_ids"], [])
        killpg.assert_called_once_with(4321, signal.SIGTERM)

    def test_run_smoke_fails_when_phone_probe_resolves_without_source_phone(self) -> None:
        class FakeProcess:
            pid = 4321

            def poll(self) -> None:
                return None

            def wait(self, timeout: float | None = None) -> int:
                return 0

        def fake_post_probe(
            _url: str,
            probe: smoke.ServiceGuideRuntimeProbe,
            *,
            secret: str,
            timeout_seconds: float,
        ) -> tuple[int, object]:
            if probe.probe_id == "phone_current":
                return 200, {"outcome": "resolved_current", "contact_refs": [{"phone": ""}]}
            if probe.probe_id == "procedure_current":
                return 200, {
                    "outcome": probe.expected_outcome,
                    "resolved_service": {"display_name": "信息公开申请流程"},
                }
            if probe.probe_id == "responsible_department_current":
                return 200, {
                    "outcome": probe.expected_outcome,
                    "contact_refs": [{"department": "学校信息公开办公室"}],
                }
            return 200, {"outcome": probe.expected_outcome}

        with tempfile.TemporaryDirectory() as temp_dir:
            plan = smoke.build_service_guide_selected_write_runtime_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(temp_dir),
                database_url="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                structured_query_secret="query-secret",
            )
            with (
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", return_value=200),
                patch.object(smoke, "_post_service_guide_probe", side_effect=fake_post_probe),
                patch.object(
                    smoke,
                    "load_current_service_guide_projection_summary",
                    return_value=smoke.CurrentServiceGuideProjectionSummary(
                        release_id="owrelease_selected_write_123",
                        service_guide_records=2,
                        conflict_records=0,
                        manual_review_sources=0,
                    ),
                ),
            ):
                report = smoke.run_service_guide_selected_write_runtime_smoke(
                    plan,
                    timeout_seconds=1,
                    startup_timeout_seconds=1,
                )

        self.assertFalse(report["passed"])
        self.assertEqual(report["probes"]["failed_probe_ids"], ["phone_current"])


if __name__ == "__main__":
    unittest.main()
