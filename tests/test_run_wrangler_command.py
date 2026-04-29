from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


class RunWranglerCommandEnvTest(unittest.TestCase):
    def test_build_wrangler_command_env_suppresses_experimental_config_warning(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        script = """
            import { buildWranglerCommandEnv } from "./scripts/run-wrangler-command.mjs";
            const env = buildWranglerCommandEnv({
                HTTP_PROXY: "http://proxy.example",
                NO_PROXY: "internal.example",
            });
            console.log(JSON.stringify(env));
        """

        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            check=True,
            cwd=repo_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        env = json.loads(result.stdout)
        self.assertNotIn("HTTP_PROXY", env)
        self.assertEqual(env["WRANGLER_DISABLE_EXPERIMENTAL_WARNING"], "1")
        self.assertIn("api.cloudflare.com", env["NO_PROXY"])
        self.assertIn("internal.example", env["NO_PROXY"])


if __name__ == "__main__":
    unittest.main()
