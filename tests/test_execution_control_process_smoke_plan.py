from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.execution_control_process_smoke import build_process_smoke_plan

_PROFILE_OWNED_ENV_KEYS = {
    "EXECUTION_CONTROL_OPEN_CAPABILITIES",
    "EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED",
    "EXECUTION_CONTROL_OTEL_ENABLED",
    "EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED",
}
_RETIRED_PROMPT_ENV_KEYS = {
    "PROMPT_RUNTIME_PROVIDER",
    "PROMPT_RUNTIME_MODEL",
    "PROMPT_RUNTIME_API_KEY",
    "PROMPT_STRICT_STRUCTURED_OUTPUTS",
    "EXECUTION_PROMPT_MODEL",
}


class ExecutionControlProcessSmokePlanTest(unittest.TestCase):
    def test_notice_profile_writes_runtime_config_instead_of_profile_owned_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / ".tmp" / "process-smoke"
            with patch.dict(os.environ, {}, clear=True):
                plan = build_process_smoke_plan(
                    repo_root=root,
                    output_dir=output_dir,
                    profile="notice_discover_sdk_opened",
                )
            env = _execution_control_env(plan)
            self.assertTrue(_PROFILE_OWNED_ENV_KEYS.isdisjoint(env))
            self.assertTrue(_RETIRED_PROMPT_ENV_KEYS.isdisjoint(env))
            profile_path = Path(env["EXECUTION_CONTROL_RUNTIME_CONFIG_PATH"])
            runtime_profile = json.loads(profile_path.read_text(encoding="utf-8"))
            self.assertEqual(runtime_profile["open_capabilities"], ["notice"])
            self.assertFalse(runtime_profile["otel"]["enabled"])
            self.assertFalse(runtime_profile["execution_audit"]["enabled"])

    def test_multi_step_profile_writes_runtime_config_instead_of_profile_owned_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / ".tmp" / "process-smoke"
            with patch.dict(os.environ, {}, clear=True):
                plan = build_process_smoke_plan(
                    repo_root=root,
                    output_dir=output_dir,
                    profile="transport_notice_override_multistep",
                )
            env = _execution_control_env(plan)
            self.assertTrue(_PROFILE_OWNED_ENV_KEYS.isdisjoint(env))
            self.assertTrue(_RETIRED_PROMPT_ENV_KEYS.isdisjoint(env))
            profile_path = Path(env["EXECUTION_CONTROL_RUNTIME_CONFIG_PATH"])
            runtime_profile = json.loads(profile_path.read_text(encoding="utf-8"))
            self.assertEqual(runtime_profile["open_capabilities"], ["campus_services"])
            self.assertTrue(runtime_profile["multi_step_workflow_enabled"])


def _execution_control_env(plan: object) -> dict[str, str]:
    processes = plan.processes
    for process in processes:
        if process.label == "execution-control":
            return process.env
    raise AssertionError("execution-control process missing")


if __name__ == "__main__":
    unittest.main()
