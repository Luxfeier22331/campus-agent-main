from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTIVE_COMMAND_ENV_EXAMPLES = {
    "compare-online-ocr.env.example",
    "legacy-office-conversion-service.env.example",
    "official-web-handoff-consumer.env.example",
    "official-web-handoff-receiver.env.example",
    "process-raw-ingestion-job.env.example",
    "rebuild-local-data.env.example",
    "release-registry-scope.env.example",
    "supervisor-runtime.env.example",
}
HISTORICAL_COMMAND_ENV_EXAMPLES = {
    "migrate-student-handbook.env.example",
    "official-web-history-backfill.env.example",
}


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
        ingestion_readme = (ROOT / "apps" / "ingestion-worker" / "README.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("env/commands/*.env.example", docs_environment)
        self.assertIn("env/commands/historical/*.env.example", docs_environment)
        self.assertIn("env/commands/historical/*.env.example", root_env)
        self.assertIn(
            "env/commands/historical/official-web-history-backfill.env.example",
            ingestion_readme,
        )
        self.assertIn(
            "env/commands/historical/migrate-student-handbook.env.example",
            ingestion_readme,
        )
        self.assertIn("--file-path", ingestion_readme)
        self.assertNotIn("--pdf-path", ingestion_readme)


if __name__ == "__main__":
    unittest.main()
