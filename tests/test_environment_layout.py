from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTIVE_COMMAND_ENV_EXAMPLES = {
    "campus-docs-reader-build.env.example",
    "execution-control-runtime.env.example",
}
HISTORICAL_COMMAND_ENV_EXAMPLES: set[str] = set()


class EnvironmentLayoutTest(unittest.TestCase):
    def test_active_command_env_examples_are_separated_from_historical_templates(self) -> None:
        active_dir = ROOT / "env" / "commands"
        historical_dir = active_dir / "historical"

        active_files = {path.name for path in active_dir.glob("*.env.example")}
        historical_files = {path.name for path in historical_dir.glob("*.env.example")}

        self.assertEqual(active_files, ACTIVE_COMMAND_ENV_EXAMPLES)
        self.assertEqual(historical_files, HISTORICAL_COMMAND_ENV_EXAMPLES)

    def test_docs_reference_active_and_historical_env_surfaces(self) -> None:
        docs_environment = (ROOT / "docs" / "environment" / "README.md").read_text(encoding="utf-8")
        root_env = (ROOT / ".env.example").read_text(encoding="utf-8")

        self.assertIn("env/commands/*.env.example", docs_environment)
        self.assertNotIn("env/commands/historical/*.env.example", docs_environment)
        self.assertNotIn("env/commands/historical/*.env.example", root_env)
        self.assertFalse((ROOT / "apps" / "ingestion-worker" / "README.md").exists())


if __name__ == "__main__":
    unittest.main()
