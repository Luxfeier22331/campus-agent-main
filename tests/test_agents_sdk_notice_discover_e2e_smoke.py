from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.agents_sdk_notice_discover_e2e_smoke import (
    AGENTS_SDK_NOTICE_DISCOVER_E2E_PROFILE,
    _bridge_response_passed,
    _build_bridge_payload,
    build_e2e_smoke_plan,
    run_smoke,
)


class AgentsSdkNoticeDiscoverE2ESmokeTest(unittest.TestCase):
    def test_plan_wires_worker_sdk_to_go_internal_query_without_old_env_names(self) -> None:
        plan = build_e2e_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/sdk-e2e"),
            api_port=19080,
            worker_port=19081,
            provider_env={
                "PROMPT_RUNTIME_PROVIDER": "openai",
                "PROMPT_RUNTIME_MODEL": "gpt-5.5-mini",
                "PROMPT_RUNTIME_API_KEY": "test-key",
                "PROMPT_RUNTIME_BASE_URL": "https://api.openai.com/v1",
            },
        )

        self.assertEqual(plan.profile, AGENTS_SDK_NOTICE_DISCOVER_E2E_PROFILE)
        process_by_label = {process.label: process for process in plan.processes}
        worker_env = process_by_label["supervisor-agent-worker"].env
        api_env = process_by_label["supervisor-api"].env

        self.assertEqual(
            worker_env["SUPERVISOR_INTERNAL_QUERY_BASE_URL"],
            "http://127.0.0.1:19080",
        )
        self.assertEqual(
            worker_env["SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"],
            api_env["SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"],
        )
        self.assertEqual(worker_env["SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED"], "true")
        self.assertEqual(worker_env["SUPERVISOR_AGENTS_SDK_ALLOWED_TARGETS"], "notice-agent")
        self.assertEqual(
            worker_env["SUPERVISOR_AGENTS_SDK_ALLOWED_TOOLS"],
            "campus_notice_discover",
        )
        self.assertEqual(worker_env["PROMPT_RUNTIME_PROVIDER"], "openai")
        self.assertEqual(worker_env["PROMPT_RUNTIME_MODEL"], "gpt-5.5-mini")
        self.assertEqual(worker_env["PROMPT_RUNTIME_API_KEY"], "test-key")
        self.assertEqual(worker_env["PROMPT_RUNTIME_BASE_URL"], "https://api.openai.com/v1")

        old_env_keys = (
            "SUPERVISOR_" + "STRUCTURED_QUERY_BASE_URL",
            "SUPERVISOR_" + "STRUCTURED_QUERY_SHARED_SECRET",
        )
        serialized_env = "\n".join(
            f"{key}={value}"
            for process in plan.processes
            for key, value in sorted(process.env.items())
        )
        for old_key in old_env_keys:
            self.assertNotIn(old_key, serialized_env)

    def test_bridge_payload_targets_notice_discover_handoff(self) -> None:
        payload = _build_bridge_payload()
        handoff = payload["runtime_decisions"]["handoff"]  # type: ignore[index]
        agent_request = handoff["agent_request"]  # type: ignore[index]

        self.assertEqual(payload["effective_capability"], "notice")
        self.assertEqual(handoff["target"], "notice-agent")  # type: ignore[index]
        self.assertEqual(handoff["allowed_tools"], ["campus_notice_discover"])  # type: ignore[index]
        self.assertEqual(agent_request["payload"]["kind"], "campus_notice_discover")  # type: ignore[index]
        self.assertEqual(
            agent_request["payload"]["payload"]["query_text"],  # type: ignore[index]
            "烟雾测试通知",
        )

    def test_report_passes_only_when_sdk_tool_execution_returns_seed_notice_card(self) -> None:
        response_body = {
            "target": "notice-agent",
            "status": "completed",
            "answer_text": "找到烟雾测试通知：https://example.invalid/notices/smoke",
            "agent_observability": {
                "selected_tool": "campus_notice_discover",
                "tool_outcome": "sdk_completed",
                "source_ref_count": 1,
                "safe_details": {
                    "agents_sdk_runner_projection": {
                        "tool_call_count": 1,
                        "tool_execution_count": 1,
                        "tool_result_projection": {
                            "outcome": "resolved_current",
                            "notice_card_count": 1,
                            "titles": ["烟雾测试通知"],
                            "source_urls": ["https://example.invalid/notices/smoke"],
                            "source_ref_count": 1,
                        },
                    }
                },
            },
        }

        passed, checks = _bridge_response_passed(200, response_body)

        self.assertTrue(passed)
        self.assertTrue(checks["structured_query_e2e"])
        self.assertTrue(checks["seed_notice_title_present"])
        self.assertTrue(checks["seed_notice_source_url_present"])

    def test_report_fails_when_tool_result_was_not_executed(self) -> None:
        response_body = {
            "target": "notice-agent",
            "status": "completed",
            "answer_text": "模型声称已找到烟雾测试通知。",
            "agent_observability": {
                "selected_tool": "campus_notice_discover",
                "tool_outcome": "sdk_completed",
                "source_ref_count": 0,
                "safe_details": {
                    "agents_sdk_runner_projection": {
                        "tool_call_count": 1,
                        "tool_execution_count": 0,
                    }
                },
            },
        }

        passed, checks = _bridge_response_passed(200, response_body)

        self.assertFalse(passed)
        self.assertFalse(checks["structured_query_e2e"])

    def test_cli_loads_repo_env_before_building_plan(self) -> None:
        import scripts.agents_sdk_notice_discover_e2e_smoke as smoke

        provider_env_keys = (
            "PROMPT_RUNTIME_PROVIDER",
            "PROMPT_RUNTIME_MODEL",
            "PROMPT_RUNTIME_API_KEY",
            "PROMPT_RUNTIME_BASE_URL",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            (tmp_path / ".env").write_text(
                "\n".join(
                    (
                        "PROMPT_RUNTIME_PROVIDER=openai",
                        "PROMPT_RUNTIME_MODEL=gpt-5.5-mini",
                        "PROMPT_RUNTIME_API_KEY=test-key",
                        "PROMPT_RUNTIME_BASE_URL=https://api.openai.com/v1",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            old_cwd = Path.cwd()
            old_env = {key: os.environ.pop(key, None) for key in provider_env_keys}
            try:
                os.chdir(tmp_path)
                with (
                    patch.object(
                        sys,
                        "argv",
                        [
                            "agents_sdk_notice_discover_e2e_smoke",
                            "--output-dir",
                            str(tmp_path / "out"),
                        ],
                    ),
                    patch.object(
                        smoke,
                        "run_smoke",
                        return_value={"passed": True, "schema_version": "test"},
                    ) as run_smoke,
                    patch("builtins.print"),
                ):
                    smoke.main()
            finally:
                os.chdir(old_cwd)
                for key, value in old_env.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

        self.assertTrue(run_smoke.called)

    def test_run_smoke_sends_bridge_auth_to_worker_readyz(self) -> None:
        import scripts.agents_sdk_notice_discover_e2e_smoke as smoke

        class FakeProcess:
            pid = 4321

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

        readyz_headers: list[dict[str, str]] = []

        def fake_wait_for_json_status(*args: object, **kwargs: object) -> tuple[int, object]:
            url = str(args[0])
            if url.endswith("/internal/bridge/readyz"):
                readyz_headers.append(dict(kwargs.get("headers") or {}))
            return 200, {"status": "ready"}

        with tempfile.TemporaryDirectory() as tmpdir:
            plan = build_e2e_smoke_plan(
                repo_root=Path("/repo"),
                output_dir=Path(tmpdir),
                provider_env={
                    "PROMPT_RUNTIME_PROVIDER": "openai",
                    "PROMPT_RUNTIME_MODEL": "gpt-5.5-mini",
                    "PROMPT_RUNTIME_API_KEY": "test-key",
                    "PROMPT_RUNTIME_BASE_URL": "https://api.openai.com/v1",
                },
            )
            with (
                patch.object(smoke, "_load_repo_env"),
                patch.object(smoke, "_prepare_process_smoke_runtime", return_value=None),
                patch.object(smoke.subprocess, "Popen", return_value=FakeProcess()),
                patch.object(smoke, "wait_for_status", return_value=200),
                patch.object(smoke, "wait_for_json_status", side_effect=fake_wait_for_json_status),
                patch.object(smoke, "_request_status", return_value=200),
                patch.object(
                    smoke,
                    "_post_json",
                    return_value=(
                        200,
                        {
                            "target": "notice-agent",
                            "status": "completed",
                            "answer_text": (
                                "找到烟雾测试通知：https://example.invalid/notices/smoke"
                            ),
                            "agent_observability": {
                                "selected_tool": "campus_notice_discover",
                                "tool_outcome": "sdk_completed",
                                "source_ref_count": 1,
                                "safe_details": {
                                    "agents_sdk_runner_projection": {
                                        "tool_call_count": 1,
                                        "tool_execution_count": 1,
                                        "tool_result_projection": {
                                            "outcome": "resolved_current",
                                            "notice_card_count": 1,
                                            "titles": ["烟雾测试通知"],
                                            "source_urls": [
                                                "https://example.invalid/notices/smoke"
                                            ],
                                            "source_ref_count": 1,
                                        },
                                    }
                                },
                            },
                        },
                    ),
                ),
            ):
                summary = run_smoke(plan=plan, timeout_seconds=1, startup_timeout_seconds=1)

        self.assertTrue(summary["passed"])
        self.assertEqual(
            readyz_headers,
            [{"x-supervisor-bridge-auth": "supervisor-agent-worker-sdk-e2e-placeholder"}],
        )


if __name__ == "__main__":
    unittest.main()
