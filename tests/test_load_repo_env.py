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


if __name__ == "__main__":
    unittest.main()
