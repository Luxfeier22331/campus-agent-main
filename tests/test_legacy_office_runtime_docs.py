from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVICE_README = REPO_ROOT / "apps/legacy-office-conversion-service/README.md"
RUNTIME_RUNBOOK = REPO_ROOT / "docs/runbooks/legacy-office-conversion-runtime.md"
COMPOSE_WITH_ROOT_ENV = (
    "docker compose --env-file .env -f infra/local/docker-compose.legacy-office-conversion.yml"
)


def _normalize_shell_snippets(text: str) -> str:
    return " ".join(text.replace("\\\n", " ").split())


class LegacyOfficeRuntimeDocsTest(unittest.TestCase):
    def test_compose_commands_load_root_env_explicitly(self) -> None:
        service_readme = _normalize_shell_snippets(SERVICE_README.read_text(encoding="utf-8"))
        runtime_runbook = _normalize_shell_snippets(RUNTIME_RUNBOOK.read_text(encoding="utf-8"))

        self.assertIn(COMPOSE_WITH_ROOT_ENV, service_readme)
        self.assertIn(COMPOSE_WITH_ROOT_ENV, runtime_runbook)


if __name__ == "__main__":
    unittest.main()
