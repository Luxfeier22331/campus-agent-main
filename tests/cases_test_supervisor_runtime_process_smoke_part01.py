# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.test_supervisor_runtime_process_smoke_support import *


class SupervisorRuntimeProcessSmokeTestPart01(unittest.TestCase):
    def test_build_process_smoke_plan_uses_direct_local_processes(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            api_port=19080,
            worker_port=19081,
            object_store_port=19082,
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
            commands["execution-gateway"].command,
            ("go", "run", "./cmd/execution-gateway"),
        )
        self.assertEqual(commands["execution-gateway"].cwd, Path("/repo/apps/execution-gateway"))
        self.assertEqual(
            commands["execution-gateway"].env["SUPERVISOR_AGENT_WORKER_BASE_URL"],
            "http://127.0.0.1:19081",
        )
        command_words = [word for process in plan.processes for word in process.command]
        self.assertNotIn("docker", command_words)
        self.assertNotIn("wrangler", command_words)

    def test_multi_step_profile_uses_requested_object_store_port(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_notice_override_multistep",
            api_port=19080,
            worker_port=19081,
            object_store_port=19082,
        )

        process_by_label = {process.label: process for process in plan.processes}
        self.assertIn("s3-smoke-object-store", process_by_label)
        self.assertNotIn("OBJECT_STORE_ENDPOINT", process_by_label["execution-gateway"].env)
        self.assertEqual(
            process_by_label["execution-gateway"].env[
                "SUPERVISOR_NOTICE_BODY_OBJECT_STORE_ENDPOINT"
            ],
            "http://127.0.0.1:19082",
        )
        self.assertEqual(
            process_by_label["s3-smoke-object-store"].command[-1],
            "19082",
        )

    def test_transport_override_profile_seeds_only_transport_schedule_collection(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                profile="transport_notice_override_multistep",
            )
            with (
                patch.object(
                    smoke, "_create_temporary_postgres_database", return_value=lambda: None
                ),
                patch.object(
                    smoke,
                    "_process_smoke_base_postgres_url",
                    return_value="postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                ),
                patch.object(smoke, "_seed_structured_projection_smoke") as seed_projection,
                patch.object(smoke, "_seed_notice_read_model_smoke"),
            ):
                runtime_preparation = smoke._prepare_process_smoke_runtime(
                    plan,
                    timeout_seconds=10,
                )

        assert runtime_preparation is not None
        self.assertEqual(
            runtime_preparation.artifact["seed_artifacts"][0]["collections"],
            ["transport_schedule"],
        )
        self.assertEqual(
            seed_projection.call_args.kwargs["collections"],
            ("transport_schedule",),
        )
        self.assertEqual(
            seed_projection.call_args.kwargs["generated_at"],
            TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME,
        )
        self.assertEqual(
            runtime_preparation.artifact["seed_artifacts"][0]["trusted_time"],
            TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME,
        )

    def test_transport_override_profile_uses_fixture_aligned_trusted_time(self) -> None:
        default_plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_schedule_sdk_opened",
        )
        override_plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_notice_override_multistep",
        )
        process_by_label = {process.label: process for process in override_plan.processes}

        self.assertEqual(
            default_plan.processes[1].env["SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"],
            STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
        )
        self.assertEqual(
            process_by_label["execution-gateway"].env[
                "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"
            ],
            TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME,
        )
        self.assertIn("2026-05-07", override_plan.execution_run_payload["user_goal"])

    def test_transport_override_profile_accepts_degraded_readyz_for_partial_structured_runtime(
        self,
    ) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_notice_override_multistep",
        )

        self.assertEqual(plan.expected_readyz_statuses, (200, 503))

    def test_process_smoke_summary_includes_runtime_preparation_on_prepare_failure(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                profile="transport_notice_override_multistep",
            )
            with patch.object(
                smoke,
                "_prepare_process_smoke_runtime",
                side_effect=RuntimeError("seed command timed out"),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertFalse(summary["passed"])
        self.assertEqual(summary["error"], "seed command timed out")
        self.assertEqual(summary["profile"], "transport_notice_override_multistep")
        self.assertIn("runtime_preparation", summary)

    def test_process_smoke_records_readyz_body_in_summary(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                profile="transport_notice_override_multistep",
            )
            with (
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None),
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", side_effect=(200, 200)),
                patch.object(
                    smoke,
                    "wait_for_json_status",
                    return_value=(503, {"workflow_run_runtime": {"last_error": "init failed"}}),
                ),
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(
                    smoke,
                    "post_execution_run_probe",
                    return_value=(
                        503,
                        {
                            "error": {
                                "code": "supervisor_multistep_workflow_unavailable",
                            }
                        },
                    ),
                ),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertEqual(
            summary["probes"]["readyz_body"],
            {"workflow_run_runtime": {"last_error": "init failed"}},
        )

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
            "http://127.0.0.1:27052",
        )

    def test_process_smoke_configures_go_readyz_prompt_gate_for_mock_runtime(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
        )

        process_by_label = {process.label: process for process in plan.processes}
        api_env = process_by_label["execution-gateway"].env

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
                    "post_execution_run_probe",
                    return_value=(
                        202,
                        {
                            "run_id": "process-smoke-structured-runtime-closed",
                            "conversation_id": "conversation-closed-gate",
                            "status": "queued",
                        },
                    ),
                ),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertTrue(summary["passed"])
        self.assertEqual(len(popen_kwargs), 2)
        self.assertTrue(all(kwargs.get("start_new_session") is True for kwargs in popen_kwargs))

    def test_run_process_smoke_uses_separate_startup_and_execution_run_timeouts(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
            )
            with (
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None) as prepare,
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", side_effect=(200, 200)) as wait_status,
                patch.object(smoke, "wait_for_json_status", return_value=(200, {})) as wait_json,
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(
                    smoke,
                    "post_execution_run_probe",
                    return_value=(
                        202,
                        {
                            "run_id": "process-smoke-structured-runtime-closed",
                            "conversation_id": "conversation-closed-gate",
                            "status": "queued",
                        },
                    ),
                ) as post_run,
            ):
                summary = smoke.run_process_smoke(
                    plan,
                    timeout_seconds=2,
                    startup_timeout_seconds=17,
                )

        self.assertTrue(summary["passed"])
        self.assertEqual(prepare.call_args.kwargs["timeout_seconds"], 17)
        self.assertEqual(
            [call.kwargs["timeout_seconds"] for call in wait_status.call_args_list],
            [17, 17],
        )
        self.assertEqual(wait_json.call_args.kwargs["timeout_seconds"], 17)
        self.assertEqual(post_run.call_args.kwargs["timeout_seconds"], 2)
        self.assertEqual(summary["probes"]["startup_timeout_seconds"], 17)
        self.assertEqual(summary["probes"]["execution_run_timeout_seconds"], 2)

    def test_multi_step_smoke_fails_when_rag_retrieval_error_is_present(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        run_body = {
            "run_id": "process-smoke-multi-step-notice-knowledge",
            "conversation_id": "conversation-multi-step-notice-knowledge-followthrough",
            "status": "queued",
            "error": {
                "code": "retrieval_failed",
                "message": "release metadata drift for student_rules/r1",
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                profile="multi_step_notice_knowledge_followthrough",
            )
            with (
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None),
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", side_effect=(200, 200)),
                patch.object(smoke, "wait_for_json_status", return_value=(200, {})),
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(smoke, "post_execution_run_probe", return_value=(202, run_body)),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertFalse(summary["passed"])
        self.assertEqual(summary["probes"]["forbidden_body_tokens"], ("retrieval_failed",))

    def test_selected_notice_guardrail_smoke_ignores_retrieval_error_token(
        self,
    ) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        run_body = {
            "run_id": "process-smoke-selected-notice-knowledge-ineligible",
            "conversation_id": "conversation-selected-notice-knowledge-followthrough-ineligible",
            "status": "queued",
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                profile="selected_notice_knowledge_followthrough_ineligible",
            )
            with (
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None),
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", side_effect=(200, 200)),
                patch.object(smoke, "wait_for_json_status", return_value=(200, {})),
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(smoke, "post_execution_run_probe", return_value=(202, run_body)),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertTrue(summary["passed"])
        self.assertEqual(summary["probes"]["forbidden_body_tokens"], ())

    def test_rag_delegate_smoke_fails_when_positive_path_returns_no_answer(self) -> None:
        import scripts.supervisor_runtime_process_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        run_body = {
            "run_id": "process-smoke-rag-delegate",
            "conversation_id": "conversation-rag-delegate",
            "status": "no_answer",
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_process_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                profile="rag_delegate",
            )
            with (
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None),
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", side_effect=(200, 200)),
                patch.object(smoke, "wait_for_json_status", return_value=(200, {})),
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(smoke, "post_execution_run_probe", return_value=(202, run_body)),
            ):
                summary = smoke.run_process_smoke(plan, timeout_seconds=1)

        self.assertFalse(summary["passed"])
        self.assertEqual(
            summary["probes"]["forbidden_body_tokens"],
            ("retrieval_failed", '"status": "no_answer"'),
        )

    def test_institutional_rules_rag_profile_uses_restricted_campus_auth_projection(
        self,
    ) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="rag_delegate_institutional_rules",
        )

        context = plan.execution_run_payload["context"]  # type: ignore[index]
        retrieval_filter = context["authorization"]["retrieval_filter"]  # type: ignore[index]

        self.assertEqual(
            retrieval_filter,
            {
                "entitlement_groups": ["campus_members"],
                "visibility_level": "restricted",
                "visibility_scope": "campus",
                "policy_projection_version": "phase1-authorization-projection-v1",
            },
        )

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


if __name__ == "__main__":
    unittest.main()
