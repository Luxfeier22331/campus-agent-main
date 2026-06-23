from __future__ import annotations

import json
import os
import shlex
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.execution_control_staging_preflight_support import (
    copy_staging_modules_for_tests,
    write_provider_config_projection_for_tests,
)


class ExecutionControlStagingProviderProjectionBoundaryTest(unittest.TestCase):
    def test_env_loader_defaults_provider_projection_to_canonical_runtime_dir(self) -> None:
        result = _run_env_loader_with_default_provider_projection_path()

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"],
            projected["expectedProjectionPath"],
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH"],
            projected["expectedProjectionPath"],
        )
        self.assertEqual(projected["hindsightModel"], "gpt-test")


def _run_env_loader_with_default_provider_projection_path() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = copy_staging_modules_for_tests(root)
        runtime_env = root / "ops" / "runtime.env"
        runtime_dir = root / ".tmp" / "execution-control-staging"
        projection_path = runtime_dir / "provider-config-projection.json"
        write_provider_config_projection_for_tests(projection_path)
        runtime_env.parent.mkdir(exist_ok=True)
        runtime_env.write_text(
            "EXECUTION_CONTROL_SHARED_SECRET=worker-secret\n",
            encoding="utf-8",
        )
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={shlex.quote(str(runtime_env))}
        export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=test-sha
        source {shlex.quote(str(common_path))}
        execution_control_staging_load_env
        node - <<'NODE'
        console.log(JSON.stringify({{
          expectedProjectionPath: {json.dumps(str(projection_path))},
          CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH: process.env.CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH,
          EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH:
            process.env.EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH,
          hindsightModel: process.env.HINDSIGHT_API_LLM_MODEL,
        }}));
        NODE
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            env=os.environ.copy(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
