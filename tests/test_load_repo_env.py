from __future__ import annotations

import json
import os
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class LoadRepoStagingEnvFileTest(unittest.TestCase):
    def test_staging_env_overlays_repo_env_without_overriding_explicit_env(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / ".env").write_text(
                "BASE_ONLY=base\nSTAGING_KEY=base\nEXPLICIT_KEY=base\n",
                encoding="utf-8",
            )
            (temp_root / ".env.staging.local").write_text(
                "STAGING_KEY=staging\nEXPLICIT_KEY=staging\nSTAGING_ONLY=staging\n",
                encoding="utf-8",
            )
            script_path = temp_root / "check.mjs"
            script_path.write_text(
                textwrap.dedent(
                    f"""
                    import {{ loadRepoStagingEnvFile }} from {json.dumps((repo_root / "scripts" / "load-repo-env.mjs").as_uri())};
                    loadRepoStagingEnvFile(import.meta.url, ".");
                    console.log(JSON.stringify({{
                      BASE_ONLY: process.env.BASE_ONLY,
                      STAGING_KEY: process.env.STAGING_KEY,
                      EXPLICIT_KEY: process.env.EXPLICIT_KEY,
                      STAGING_ONLY: process.env.STAGING_ONLY,
                    }}));
                    """
                ).strip(),
                encoding="utf-8",
            )

            result = subprocess.run(
                ["node", str(script_path)],
                check=True,
                cwd=temp_root,
                env={**os.environ, "EXPLICIT_KEY": "explicit"},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        self.assertEqual(
            json.loads(result.stdout),
            {
                "BASE_ONLY": "base",
                "STAGING_KEY": "staging",
                "EXPLICIT_KEY": "explicit",
                "STAGING_ONLY": "staging",
            },
        )

    def test_staging_smoke_env_loads_explicit_ops_runtime_env_first(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            runtime_env = temp_root / "ops-runtime.env"
            runtime_env.write_text(
                "APP_API_STAGING_SMOKE_AUTH_SECRET=runtime-secret\nEXPLICIT_KEY=runtime\n",
                encoding="utf-8",
            )
            (temp_root / ".env.staging.local").write_text(
                "APP_API_STAGING_SMOKE_AUTH_SECRET=repo-secret\nREPO_ONLY=repo\n",
                encoding="utf-8",
            )
            script_path = temp_root / "check.mjs"
            script_path.write_text(
                textwrap.dedent(
                    f"""
                    import {{ loadStagingSmokeEnvFile }} from {json.dumps((repo_root / "scripts" / "load-repo-env.mjs").as_uri())};
                    const loaded = loadStagingSmokeEnvFile(import.meta.url, ".");
                    console.log(JSON.stringify({{
                      loaded,
                      APP_API_STAGING_SMOKE_AUTH_SECRET: process.env.APP_API_STAGING_SMOKE_AUTH_SECRET,
                      EXPLICIT_KEY: process.env.EXPLICIT_KEY,
                      REPO_ONLY: process.env.REPO_ONLY || null,
                    }}));
                    """
                ).strip(),
                encoding="utf-8",
            )

            result = subprocess.run(
                ["node", str(script_path)],
                check=True,
                cwd=temp_root,
                env={
                    **os.environ,
                    "EXECUTION_CONTROL_STAGING_ENV_FILE": str(runtime_env),
                    "EXPLICIT_KEY": "explicit",
                },
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        payload = json.loads(result.stdout)
        self.assertEqual(payload["loaded"]["source"], "ops-runtime")
        self.assertEqual(payload["loaded"]["runtimeEnvPath"], str(runtime_env))
        self.assertEqual(payload["APP_API_STAGING_SMOKE_AUTH_SECRET"], "runtime-secret")
        self.assertEqual(payload["EXPLICIT_KEY"], "explicit")
        self.assertIsNone(payload["REPO_ONLY"])


if __name__ == "__main__":
    unittest.main()
