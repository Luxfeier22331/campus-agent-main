from __future__ import annotations

import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.supervisor_runtime_process_smoke import (
    build_process_smoke_plan,
    process_spec_to_artifact,
)


class SupervisorRuntimeProcessSmokeTest(unittest.TestCase):
    def test_build_process_smoke_plan_uses_direct_local_processes(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            api_port=19080,
            worker_port=19081,
        )

        commands = {command.label: command for command in plan.processes}
        self.assertEqual(
            commands["supervisor-agent-worker"].command,
            (
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "campus_supervisor_agent_worker.bridge_server",
            ),
        )
        self.assertEqual(
            commands["supervisor-api"].command,
            ("go", "run", "./cmd/supervisor-api"),
        )
        self.assertEqual(commands["supervisor-api"].cwd, Path("/repo/apps/supervisor-api"))
        self.assertEqual(
            commands["supervisor-api"].env["SUPERVISOR_AGENT_WORKER_BASE_URL"],
            "http://127.0.0.1:19081",
        )
        command_words = [word for process in plan.processes for word in process.command]
        self.assertNotIn("docker", command_words)
        self.assertNotIn("wrangler", command_words)

    def test_process_smoke_artifact_redacts_secret_env_values(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
        )

        process = plan.processes[1]
        artifact = process_spec_to_artifact(
            process.__class__(
                label=process.label,
                command=process.command,
                cwd=process.cwd,
                env={
                    **process.env,
                    "CAMPUS_SHARED_POSTGRES_URL": (
                        "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent"
                    ),
                },
                log_path=process.log_path,
            )
        )

        self.assertEqual(artifact["env"]["API_WORKER_SHARED_SECRET"], "<redacted>")
        self.assertEqual(
            artifact["env"]["SUPERVISOR_AGENT_WORKER_SHARED_SECRET"],
            "<redacted>",
        )
        self.assertEqual(artifact["env"]["CAMPUS_SHARED_POSTGRES_URL"], "<redacted>")
        self.assertEqual(
            artifact["env"]["SUPERVISOR_AGENT_WORKER_BASE_URL"],
            "http://127.0.0.1:18081",
        )

    def test_process_smoke_configures_go_readyz_prompt_gate_for_mock_runtime(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
        )

        process_by_label = {process.label: process for process in plan.processes}
        api_env = process_by_label["supervisor-api"].env

        self.assertEqual(api_env["PROMPT_RUNTIME_PROVIDER"], "mock-runtime")
        self.assertEqual(api_env["PROMPT_RUNTIME_MODEL"], "gpt-5.5")
        self.assertEqual(api_env["PROMPT_RUNTIME_API_KEY"], "process-smoke-prompt-key")
        self.assertEqual(api_env["PROMPT_STRICT_STRUCTURED_OUTPUTS"], "true")

    def test_run_process_smoke_starts_processes_in_isolated_process_sessions(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        popen_kwargs: list[dict[str, object]] = []

        def fake_popen(*args: object, **kwargs: object) -> FakeProcess:
            popen_kwargs.append(dict(kwargs))
            return FakeProcess()

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
            )
            with (
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None),
                patch.object(smoke.subprocess, "Popen", side_effect=fake_popen),
                patch.object(smoke, "wait_for_status", side_effect=(200, 200)),
                patch.object(smoke, "wait_for_json_status", return_value=(200, {})),
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(
                    smoke,
                    "post_answer_probe",
                    return_value=(503, {"failure_kind": "structured_runtime_closed"}),
                ),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertTrue(summary["passed"])
        self.assertEqual(len(popen_kwargs), 2)
        self.assertTrue(all(kwargs.get("start_new_session") is True for kwargs in popen_kwargs))

    def test_terminate_processes_signals_process_groups(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 9876

            def poll(self) -> None:
                return None

            def wait(self, timeout: float | None = None) -> int:
                return 0

        with patch.object(smoke.os, "killpg") as killpg:
            smoke.terminate_processes([FakeProcess()])  # type: ignore[list-item]

        killpg.assert_called_once_with(9876, signal.SIGTERM)

    def test_profiles_select_distinct_answer_payloads_and_expectations(self) -> None:
        closed = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="closed_gate",
        )
        terminal = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="terminal_fail_close",
        )
        rag = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="rag_delegate",
        )
        structured_open = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="structured_direct_opened",
        )
        structured_stream = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="structured_direct_opened_stream",
        )
        service_status = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="service_status_direct_opened",
        )
        service_guide = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="service_guide_direct_opened",
        )
        contact_directory = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="contact_directory_direct_opened",
        )
        notice_discover = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="notice_discover_direct_opened",
        )
        notice_get = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="notice_get_direct_opened",
        )
        multi_step_notice = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="multi_step_notice_knowledge_followthrough",
        )
        transactional = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transactional_approval_required",
        )

        self.assertEqual(closed.expected_status, 503)
        self.assertIn("structured_runtime_closed", closed.expected_body_tokens)
        self.assertEqual(terminal.expected_status, 200)
        self.assertEqual(terminal.answer_payload["requested_capability"], "knowledge")
        self.assertIn("product_scope_boundary", terminal.expected_body_tokens)
        self.assertEqual(rag.expected_status, 200)
        self.assertIn("workflow_trace_summary", rag.expected_body_tokens)
        self.assertIn("agent_execution_projection", rag.expected_body_tokens)
        self.assertIn("agent_plan", rag.expected_body_tokens)
        self.assertEqual(rag.answer_payload["requested_capability"], "knowledge")
        self.assertEqual(structured_open.expected_status, 200)
        self.assertEqual(
            structured_open.processes[1].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            structured_open.processes[1].env["SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"],
            "2026-04-24T20:30:00+08:00",
        )
        self.assertIn("direct_runtime", structured_open.expected_body_tokens)
        self.assertIn("agent_execution_projection", structured_open.expected_body_tokens)
        self.assertIn("result_guardrail", structured_open.expected_body_tokens)
        self.assertEqual(
            structured_open.answer_payload["requested_capability"],
            "campus_services",
        )
        self.assertEqual(structured_stream.answer_path, "/api/v1/answer/stream")
        self.assertEqual(structured_stream.answer_response_kind, "sse")
        self.assertIn("event: execution.completed", structured_stream.expected_body_tokens)
        self.assertEqual(
            structured_stream.processes[1].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(service_status.expected_status, 200)
        self.assertEqual(
            service_status.processes[1].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            service_status.answer_payload["requested_capability"],
            "campus_services",
        )
        self.assertIn("service_status_lookup", service_status.expected_body_tokens)
        self.assertIn("direct_runtime", service_status.expected_body_tokens)
        self.assertEqual(service_guide.expected_status, 200)
        self.assertEqual(
            service_guide.processes[1].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            service_guide.answer_payload["requested_capability"],
            "campus_services",
        )
        self.assertIn("service_guide_lookup", service_guide.expected_body_tokens)
        self.assertIn("agent_execution_projection", service_guide.expected_body_tokens)
        self.assertEqual(contact_directory.expected_status, 200)
        self.assertEqual(
            contact_directory.processes[1].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            contact_directory.answer_payload["requested_capability"],
            "campus_services",
        )
        self.assertIn("contact_directory_lookup", contact_directory.expected_body_tokens)
        self.assertIn("result_guardrail", contact_directory.expected_body_tokens)
        notice_discover_processes = {
            process.label: process for process in notice_discover.processes
        }
        self.assertEqual(notice_discover.answer_payload["requested_capability"], "notice")
        self.assertEqual(
            notice_discover_processes["supervisor-api"].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "notice",
        )
        self.assertIn("s3-smoke-object-store", notice_discover_processes)
        self.assertEqual(
            notice_discover_processes["supervisor-api"].env["OBJECT_STORE_ENDPOINT"],
            "http://127.0.0.1:18082",
        )
        self.assertIn("campus_notice_discover", notice_discover.expected_body_tokens)
        self.assertIn("direct_runtime", notice_discover.expected_body_tokens)
        notice_processes = {process.label: process for process in notice_get.processes}
        self.assertEqual(notice_get.answer_payload["requested_capability"], "notice")
        self.assertEqual(
            notice_get.answer_payload["context"]["session"]["selected_notice_ref"]["notice_id"],
            "notice:smoke:001",
        )  # type: ignore[index]
        self.assertEqual(
            notice_processes["supervisor-api"].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "notice",
        )
        self.assertIn("s3-smoke-object-store", notice_processes)
        self.assertEqual(
            notice_processes["supervisor-api"].env["OBJECT_STORE_ENDPOINT"],
            "http://127.0.0.1:18082",
        )
        self.assertIn("campus_notice_get", notice_get.expected_body_tokens)
        multi_step_processes = {
            process.label: process for process in multi_step_notice.processes
        }
        self.assertEqual(multi_step_notice.expected_status, 200)
        self.assertEqual(multi_step_notice.answer_payload["requested_capability"], "knowledge")
        self.assertEqual(
            multi_step_notice.answer_payload["context"]["session"]["selected_notice_ref"][
                "notice_id"
            ],
            "notice:smoke:001",
        )  # type: ignore[index]
        self.assertEqual(
            multi_step_processes["supervisor-api"].env[
                "SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED"
            ],
            "true",
        )
        self.assertEqual(
            multi_step_processes["supervisor-api"].env[
                "SUPERVISOR_API_WORKFLOW_RUN_AUTO_MIGRATE"
            ],
            "true",
        )
        self.assertEqual(
            multi_step_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_STRUCTURED_QUERY_BASE_URL"
            ],
            "http://127.0.0.1:18080",
        )
        self.assertEqual(
            multi_step_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET"
            ],
            multi_step_processes["supervisor-api"].env["SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET"],
        )
        self.assertIn("s3-smoke-object-store", multi_step_processes)
        self.assertIn("multi_step", multi_step_notice.expected_body_tokens)
        self.assertIn("campus_notice_get", multi_step_notice.expected_body_tokens)
        self.assertIn("retrieval.query", multi_step_notice.expected_body_tokens)
        self.assertEqual(transactional.expected_status, 200)
        self.assertEqual(transactional.answer_payload["requested_capability"], "knowledge")
        self.assertEqual(
            transactional.processes[1].env["SUPERVISOR_API_OPEN_CAPABILITIES"],
            "",
        )
        self.assertIn("approval_required", transactional.expected_body_tokens)
        self.assertIn("workflow_trace_summary", transactional.expected_body_tokens)
        self.assertIn("selected_target", transactional.expected_body_tokens)

    def test_answer_probe_uses_process_smoke_timeout_budget(self) -> None:
        import inspect

        from scripts.supervisor_runtime_process_smoke_http import _post_json

        parameters = inspect.signature(_post_json).parameters

        self.assertIn("timeout_seconds", parameters)

    def test_sse_answer_probe_preserves_event_stream_text(self) -> None:
        from scripts.supervisor_runtime_process_smoke_http import _parse_sse_response

        payload = _parse_sse_response(
            b'event: execution.completed\ndata: {"status":"completed"}\n\n'
        )

        self.assertEqual(payload["kind"], "sse")
        self.assertIn("event: execution.completed", payload["body_text"])
        self.assertEqual(payload["events"][0]["event"], "execution.completed")
        self.assertEqual(payload["events"][0]["data"]["status"], "completed")

    def test_structured_open_profile_uses_temporary_postgres_overlay(self) -> None:
        from scripts.supervisor_runtime_process_smoke import (
            STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
            _postgres_url_with_database,
            _processes_with_env_overlay,
        )

        for profile in (
            "structured_direct_opened",
            "structured_direct_opened_stream",
            "service_status_direct_opened",
            "service_guide_direct_opened",
            "contact_directory_direct_opened",
        ):
            with self.subTest(profile=profile):
                plan = build_process_smoke_plan(
                    repo_root=Path("/repo"),
                    output_dir=Path("/tmp/smoke"),
                    profile=profile,
                )
                runtime_database_url = _postgres_url_with_database(
                    "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                    "campus_agent_process_smoke_test",
                )

                processes = _processes_with_env_overlay(
                    plan.processes,
                    {
                        "CAMPUS_SHARED_POSTGRES_URL": runtime_database_url,
                        "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339": (
                            STRUCTURED_DIRECT_OPENED_TRUSTED_TIME
                        ),
                    },
                )

                self.assertEqual(
                    processes[1].env["CAMPUS_SHARED_POSTGRES_URL"],
                    "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent_process_smoke_test",
                )
                self.assertEqual(
                    processes[1].env["SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"],
                    STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
                )
                self.assertNotIn("CAMPUS_SHARED_POSTGRES_URL", plan.processes[1].env)
                self.assertNotIn("CAMPUS_SHARED_POSTGRES_URL", processes[0].env)

    def test_notice_open_profile_uses_temporary_notice_read_model_overlay(self) -> None:
        from scripts.supervisor_runtime_process_smoke import (
            _postgres_url_with_database,
            _processes_with_env_overlay,
        )

        for profile in ("notice_discover_direct_opened", "notice_get_direct_opened"):
            with self.subTest(profile=profile):
                plan = build_process_smoke_plan(
                    repo_root=Path("/repo"),
                    output_dir=Path("/tmp/smoke"),
                    profile=profile,
                )
                runtime_database_url = _postgres_url_with_database(
                    "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                    "campus_agent_process_smoke_notice",
                )

                processes = _processes_with_env_overlay(
                    plan.processes,
                    {
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL": runtime_database_url,
                    },
                )
                process_by_label = {process.label: process for process in processes}

                self.assertEqual(
                    process_by_label["supervisor-api"].env[
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"
                    ],
                    "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent_process_smoke_notice",
                )
                self.assertNotIn(
                    "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
                    process_by_label["supervisor-agent-worker"].env,
                )
                if "s3-smoke-object-store" in process_by_label:
                    self.assertNotIn(
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
                        process_by_label["s3-smoke-object-store"].env,
                    )

    def test_multi_step_profile_uses_workflow_and_notice_runtime_overlays(self) -> None:
        from scripts.supervisor_runtime_process_smoke import (
            _postgres_url_with_database,
            _processes_with_env_overlay,
        )

        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="multi_step_notice_knowledge_followthrough",
        )
        runtime_database_url = _postgres_url_with_database(
            "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
            "campus_agent_process_smoke_multi_step",
        )

        processes = _processes_with_env_overlay(
            plan.processes,
            {
                "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL": runtime_database_url,
                "SUPERVISOR_API_WORKFLOW_RUN_DATABASE_URL": runtime_database_url,
            },
        )
        process_by_label = {process.label: process for process in processes}

        self.assertEqual(
            process_by_label["supervisor-api"].env["INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"],
            "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent_process_smoke_multi_step",
        )
        self.assertEqual(
            process_by_label["supervisor-api"].env["SUPERVISOR_API_WORKFLOW_RUN_DATABASE_URL"],
            "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent_process_smoke_multi_step",
        )
        self.assertNotIn(
            "SUPERVISOR_API_WORKFLOW_RUN_DATABASE_URL",
            process_by_label["supervisor-agent-worker"].env,
        )


if __name__ == "__main__":
    unittest.main()
