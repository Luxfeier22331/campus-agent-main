from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_env_surface_policy import audit_env_surface_policy


class CheckEnvSurfacePolicyTest(unittest.TestCase):
    def test_audit_env_surface_policy_accepts_current_repo_templates(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        failures = audit_env_surface_policy(root=repo_root)

        self.assertEqual(failures, ())

    def test_audit_env_surface_policy_rejects_retired_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".env.example").write_text("AGENT_PROMPT_MODEL=gpt-test\n", encoding="utf-8")
            policy_path = root / "configs/runtime/env-surface-policy.v1.json"
            policy_path.parent.mkdir(parents=True)
            policy_path.write_text(
                """
{
  "schema_version": "campus_env_surface_policy.v1",
  "allowed_templates": [".env.example"],
  "keys": {
    "AGENT_PROMPT_MODEL": {
      "owner": "retired",
      "scopes": [],
      "secret": false,
      "retired": true
    }
  }
}
""".strip()
                + "\n",
                encoding="utf-8",
            )

            failures = audit_env_surface_policy(root=root, policy_path=policy_path)

        self.assertEqual(len(failures), 1)
        self.assertIn("retired env key 'AGENT_PROMPT_MODEL'", failures[0])

    def test_audit_env_surface_policy_rejects_unregistered_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / ".env.example").write_text("UNKNOWN_ENV_KEY=value\n", encoding="utf-8")
            policy_path = root / "configs/runtime/env-surface-policy.v1.json"
            policy_path.parent.mkdir(parents=True)
            policy_path.write_text(
                """
{
  "schema_version": "campus_env_surface_policy.v1",
  "allowed_templates": [".env.example"],
  "keys": {}
}
""".strip()
                + "\n",
                encoding="utf-8",
            )

            failures = audit_env_surface_policy(root=root, policy_path=policy_path)

        self.assertEqual(len(failures), 1)
        self.assertIn("unregistered env key 'UNKNOWN_ENV_KEY'", failures[0])


if __name__ == "__main__":
    unittest.main()
