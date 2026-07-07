from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_env_surface_policy import audit_env_surface_policy


class CheckEnvSurfacePolicyTest(unittest.TestCase):
    def test_audit_env_surface_policy_accepts_current_repo_templates(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        failures = audit_env_surface_policy(root=repo_root)

        self.assertEqual(failures, ())

    def test_env_surface_policy_does_not_advertise_retired_notice_collector_keys(
        self,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        policy = json.loads(
            (repo_root / "configs/runtime/env-surface-policy.v1.json").read_text(encoding="utf-8")
        )

        retired_keys = sorted(
            key
            for key in policy["keys"]
            if key.startswith("AUTHENTICATED_NOTICE_") and key.endswith("_DATABASE_URL")
        )

        self.assertEqual(retired_keys, [])

    def test_env_surface_policy_registers_ingestion_control_runtime_surface(
        self,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        policy = json.loads(
            (repo_root / "configs/runtime/env-surface-policy.v1.json").read_text(encoding="utf-8")
        )

        self.assertIn(
            "env/commands/ingestion-control-runtime.env.example",
            policy["allowed_templates"],
        )
        self.assertEqual(
            policy["template_key_limits"]["env/commands/ingestion-control-runtime.env.example"],
            13,
        )
        for key in (
            "INGESTION_CONTROL_DATABASE_URL",
            "INGESTION_TASK_REGISTRY_ROOT",
            "INGESTION_TEMPORAL_ADDRESS",
            "INGESTION_TEMPORAL_WORKFLOW_TASK_QUEUE",
            "INGESTION_TEMPORAL_CONTROL_ACTIVITY_TASK_QUEUE",
        ):
            self.assertIn(key, policy["keys"])
            self.assertIn("command", policy["keys"][key]["scopes"])
        for key in (
            "OBJECT_STORE_ENDPOINT",
            "OBJECT_STORE_REGION",
            "OBJECT_STORE_BUCKET_SOURCE",
            "OBJECT_STORE_SOURCE_ACCESS_KEY",
            "OBJECT_STORE_SOURCE_SECRET_KEY",
        ):
            self.assertIn(key, policy["keys"])
            self.assertIn("command", policy["keys"][key]["scopes"])
            self.assertIn("ingestion-control", policy["keys"][key]["scopes"])
        self.assertNotIn("ingestion-control", policy["allowed_prefixes"]["OBJECT_STORE_"])

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
            template_path = root / "apps/example-app/.env.example"
            template_path.parent.mkdir(parents=True)
            template_path.write_text("UNKNOWN_ENV_KEY=value\n", encoding="utf-8")
            policy_path = root / "configs/runtime/env-surface-policy.v1.json"
            policy_path.parent.mkdir(parents=True)
            policy_path.write_text(
                """
{
  "schema_version": "campus_env_surface_policy.v1",
  "allowed_templates": ["apps/example-app/.env.example"],
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
