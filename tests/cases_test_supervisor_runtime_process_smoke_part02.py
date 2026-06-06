# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.test_supervisor_runtime_process_smoke_support import *


class SupervisorRuntimeProcessSmokeTestPart02(unittest.TestCase):
    def test_profiles_select_distinct_execution_run_payloads_and_expectations(self) -> None:
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
        rag_sdk = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="rag_delegate_sdk_candidate",
        )
        institutional_rag = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="rag_delegate_institutional_rules",
        )
        transport_schedule = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_schedule_sdk_opened",
        )
        transport_schedule_stream = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_schedule_sdk_opened_stream",
        )
        service_status = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="service_status_sdk_opened",
        )
        service_guide = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="service_guide_sdk_opened",
        )
        contact_directory = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="contact_directory_sdk_opened",
        )
        notice_discover = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="notice_discover_sdk_opened",
        )
        academic_calendar = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="academic_calendar_sdk_opened",
        )
        multi_step_notice = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="multi_step_notice_knowledge_followthrough",
        )
        transport_notice_override = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transport_notice_override_multistep",
        )
        selected_notice_guardrail = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="selected_notice_knowledge_followthrough_ineligible",
        )
        transactional = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="transactional_approval_required",
        )

        self.assertEqual(closed.expected_run_status, 202)
        self.assertEqual(closed.execution_run_path, "/internal/execution/runs")
        self.assertIn('"status": "queued"', closed.expected_run_body_tokens)
        self.assertEqual(terminal.expected_run_status, 202)
        self.assertEqual(terminal.execution_run_payload["requested_capability"], "knowledge")
        self.assertIn('"status": "queued"', terminal.expected_run_body_tokens)
        self.assertEqual(rag.expected_run_status, 202)
        self.assertEqual(rag.execution_run_path, "/internal/execution/runs")
        self.assertEqual(rag.execution_run_payload["requested_capability"], "knowledge")
        self.assertEqual(rag.execution_run_payload["user_goal"], "公费医疗报销")
        rag_sdk_processes = {process.label: process for process in rag_sdk.processes}
        self.assertEqual(rag_sdk.expected_run_status, 202)
        self.assertEqual(rag_sdk.execution_run_payload["requested_capability"], "knowledge")
        self.assertEqual(rag_sdk.execution_run_payload["user_goal"], "公费医疗报销")
        self.assertEqual(
            rag_sdk_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED"
            ],
            "true",
        )
        self.assertEqual(institutional_rag.expected_run_status, 202)
        self.assertEqual(
            institutional_rag.execution_run_payload["requested_capability"], "knowledge"
        )
        self.assertEqual(
            institutional_rag.execution_run_payload["requested_scope"],
            {"corpus": "regulations", "collection": "institutional_rules"},
        )
        self.assertEqual(
            institutional_rag.execution_run_payload["user_goal"],
            "研究生助教助研助管工作应该依据哪份管理办法？",
        )
        self.assertEqual(transport_schedule.expected_run_status, 202)
        self.assertEqual(
            transport_schedule.processes[1].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            transport_schedule.processes[1].env["SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"],
            "2026-04-24T20:30:00+08:00",
        )
        self.assertEqual(
            transport_schedule.execution_run_payload["requested_capability"],
            "campus_services",
        )
        transport_processes = {process.label: process for process in transport_schedule.processes}
        self.assertEqual(
            transport_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_INTERNAL_QUERY_BASE_URL"
            ],
            "http://127.0.0.1:27051",
        )
        self.assertEqual(
            transport_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"
            ],
            transport_processes["execution-gateway"].env["SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"],
        )
        self.assertEqual(
            transport_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED"
            ],
            "true",
        )
        for process in transport_schedule.processes:
            self.assertNotIn("SUPERVISOR_STRUCTURED_QUERY_BASE_URL", process.env)
            self.assertNotIn("SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET", process.env)
        self.assertEqual(
            transport_schedule_stream.execution_run_path,
            "/internal/execution/runs",
        )
        self.assertIn('"status": "queued"', transport_schedule_stream.expected_run_body_tokens)
        self.assertEqual(
            transport_schedule_stream.processes[1].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(service_status.expected_run_status, 202)
        self.assertEqual(
            service_status.processes[1].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            service_status.execution_run_payload["requested_capability"],
            "campus_services",
        )
        self.assertEqual(service_guide.expected_run_status, 202)
        self.assertEqual(
            service_guide.processes[1].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            service_guide.execution_run_payload["requested_capability"],
            "campus_services",
        )
        self.assertEqual(contact_directory.expected_run_status, 202)
        self.assertEqual(
            contact_directory.processes[1].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            contact_directory.execution_run_payload["requested_capability"],
            "campus_services",
        )
        notice_discover_processes = {
            process.label: process for process in notice_discover.processes
        }
        self.assertEqual(notice_discover.execution_run_payload["requested_capability"], "notice")
        self.assertEqual(
            notice_discover_processes["execution-gateway"].env[
                "EXECUTION_GATEWAY_OPEN_CAPABILITIES"
            ],
            "notice",
        )
        self.assertNotIn("s3-smoke-object-store", notice_discover_processes)
        self.assertNotIn(
            "OBJECT_STORE_ENDPOINT", notice_discover_processes["execution-gateway"].env
        )
        self.assertEqual(
            notice_discover_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_INTERNAL_QUERY_BASE_URL"
            ],
            "http://127.0.0.1:27051",
        )
        academic_processes = {process.label: process for process in academic_calendar.processes}
        self.assertEqual(academic_calendar.expected_run_status, 202)
        self.assertEqual(
            academic_calendar.execution_run_payload["requested_capability"],
            "campus_services",
        )
        self.assertEqual(
            academic_processes["execution-gateway"].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "campus_services",
        )
        self.assertEqual(
            academic_processes["supervisor-agent-worker"].env["SUPERVISOR_INTERNAL_QUERY_BASE_URL"],
            "http://127.0.0.1:27051",
        )
        multi_step_processes = {process.label: process for process in multi_step_notice.processes}
        self.assertEqual(multi_step_notice.expected_run_status, 202)
        self.assertEqual(
            multi_step_notice.execution_run_payload["requested_capability"], "knowledge"
        )
        self.assertEqual(
            multi_step_notice.execution_run_payload["context"]["session"]["selected_notice_ref"][
                "notice_id"
            ],
            "notice:smoke:001",
        )  # type: ignore[index]
        self.assertEqual(
            multi_step_processes["execution-gateway"].env[
                "EXECUTION_GATEWAY_MULTI_STEP_WORKFLOW_ENABLED"
            ],
            "true",
        )
        self.assertEqual(
            multi_step_processes["execution-gateway"].env[
                "EXECUTION_GATEWAY_WORKFLOW_RUN_AUTO_MIGRATE"
            ],
            "true",
        )
        self.assertEqual(
            multi_step_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_INTERNAL_QUERY_BASE_URL"
            ],
            "http://127.0.0.1:27051",
        )
        self.assertEqual(
            multi_step_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"
            ],
            multi_step_processes["execution-gateway"].env[
                "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"
            ],
        )
        self.assertIn("s3-smoke-object-store", multi_step_processes)
        transport_override_processes = {
            process.label: process for process in transport_notice_override.processes
        }
        self.assertEqual(transport_notice_override.expected_run_status, 202)
        self.assertEqual(
            transport_notice_override.execution_run_payload["requested_capability"],
            "campus_services",
        )
        self.assertEqual(
            transport_notice_override.execution_run_payload["context"]["session"][
                "selected_notice_ref"
            ]["notice_id"],
            "353903",
        )  # type: ignore[index]
        self.assertEqual(
            transport_override_processes["execution-gateway"].env[
                "EXECUTION_GATEWAY_MULTI_STEP_WORKFLOW_ENABLED"
            ],
            "true",
        )
        self.assertEqual(
            transport_override_processes["execution-gateway"].env[
                "EXECUTION_GATEWAY_OPEN_CAPABILITIES"
            ],
            "campus_services",
        )
        self.assertEqual(
            transport_override_processes["supervisor-agent-worker"].env[
                "SUPERVISOR_INTERNAL_QUERY_BASE_URL"
            ],
            "http://127.0.0.1:27051",
        )
        self.assertIn("s3-smoke-object-store", transport_override_processes)
        selected_notice_guardrail_processes = {
            process.label: process for process in selected_notice_guardrail.processes
        }
        self.assertEqual(selected_notice_guardrail.expected_run_status, 202)
        self.assertEqual(
            selected_notice_guardrail.execution_run_payload["requested_capability"],
            "campus_services",
        )
        self.assertEqual(
            selected_notice_guardrail.execution_run_payload["requested_scope"],
            {"corpus": "regulations", "collection": "student_rules"},
        )
        self.assertEqual(
            selected_notice_guardrail.execution_run_payload["context"]["authorization"][
                "retrieval_filter"
            ],
            {
                "entitlement_groups": ["students"],
                "visibility_level": "restricted",
                "visibility_scope": "campus",
                "policy_projection_version": "phase1-authorization-projection-v1",
            },
        )  # type: ignore[index]
        self.assertEqual(
            selected_notice_guardrail.execution_run_payload["context"]["session"][
                "selected_notice_ref"
            ]["notice_id"],
            "notice:transport:355122",
        )  # type: ignore[index]
        self.assertEqual(
            selected_notice_guardrail_processes["execution-gateway"].env[
                "EXECUTION_GATEWAY_OPEN_CAPABILITIES"
            ],
            "campus_services",
        )
        self.assertNotIn(
            "SUPERVISOR_INTERNAL_QUERY_BASE_URL",
            selected_notice_guardrail_processes["supervisor-agent-worker"].env,
        )
        self.assertNotIn(
            "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET",
            selected_notice_guardrail_processes["supervisor-agent-worker"].env,
        )
        self.assertNotIn("s3-smoke-object-store", selected_notice_guardrail_processes)
        self.assertEqual(transactional.expected_run_status, 202)
        self.assertEqual(transactional.execution_run_payload["requested_capability"], "knowledge")
        self.assertEqual(
            transactional.processes[1].env["EXECUTION_GATEWAY_OPEN_CAPABILITIES"],
            "",
        )
        self.assertIn('"status": "queued"', transactional.expected_run_body_tokens)

    def test_execution_run_probe_uses_process_smoke_timeout_budget(self) -> None:
        import inspect

        from scripts.supervisor_runtime_process_smoke_http import _post_json

        parameters = inspect.signature(_post_json).parameters

        self.assertIn("timeout_seconds", parameters)

    def test_json_status_probe_accepts_headers(self) -> None:
        import inspect

        from scripts.supervisor_runtime_process_smoke_http import wait_for_json_status

        parameters = inspect.signature(wait_for_json_status).parameters

        self.assertIn("headers", parameters)

    def test_sse_parser_preserves_event_stream_text_for_other_callers(self) -> None:
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
            "transport_schedule_sdk_opened",
            "transport_schedule_sdk_opened_stream",
            "service_status_sdk_opened",
            "service_guide_sdk_opened",
            "contact_directory_sdk_opened",
            "academic_calendar_sdk_opened",
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

        for profile in ("notice_discover_sdk_opened",):
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
                    process_by_label["execution-gateway"].env[
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
            STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
            _postgres_url_with_database,
            _processes_with_env_overlay,
        )

        for profile, database_name in (
            ("multi_step_notice_knowledge_followthrough", "campus_agent_process_smoke_multi_step"),
            (
                "transport_notice_override_multistep",
                "campus_agent_process_smoke_transport_notice_override",
            ),
            (
                "selected_notice_knowledge_followthrough_ineligible",
                "campus_agent_process_smoke_selected_notice_guardrail",
            ),
        ):
            with self.subTest(profile=profile):
                plan = build_process_smoke_plan(
                    repo_root=Path("/repo"),
                    output_dir=Path("/tmp/smoke"),
                    profile=profile,
                )
                runtime_database_url = _postgres_url_with_database(
                    "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                    database_name,
                )

                processes = _processes_with_env_overlay(
                    plan.processes,
                    {
                        "CAMPUS_SHARED_POSTGRES_URL": runtime_database_url,
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL": runtime_database_url,
                        "EXECUTION_GATEWAY_WORKFLOW_RUN_DATABASE_URL": runtime_database_url,
                        "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339": (
                            STRUCTURED_DIRECT_OPENED_TRUSTED_TIME
                        ),
                    },
                )
                process_by_label = {process.label: process for process in processes}

                self.assertEqual(
                    process_by_label["execution-gateway"].env[
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"
                    ],
                    f"postgresql://postgres:postgres@127.0.0.1:5432/{database_name}",
                )
                self.assertEqual(
                    process_by_label["execution-gateway"].env[
                        "EXECUTION_GATEWAY_WORKFLOW_RUN_DATABASE_URL"
                    ],
                    f"postgresql://postgres:postgres@127.0.0.1:5432/{database_name}",
                )
                self.assertNotIn(
                    "EXECUTION_GATEWAY_WORKFLOW_RUN_DATABASE_URL",
                    process_by_label["supervisor-agent-worker"].env,
                )


if __name__ == "__main__":
    unittest.main()
