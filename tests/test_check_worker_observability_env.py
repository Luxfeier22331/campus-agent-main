from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.check_worker_observability_env import collect_worker_observability_status


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class CheckWorkerObservabilityEnvTest(unittest.TestCase):
    def test_collect_worker_observability_status_reports_ready_when_targets_are_complete(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps/app-api/.dev.vars",
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "SENTRY_ENVIRONMENT=development",
                        "SENTRY_RELEASE=app-api@dev-local",
                        "APP_API_OTEL_INGEST_ENDPOINT=https://otel-ingest.example.com",
                        "APP_API_OTEL_INGEST_SHARED_SECRET=ingest-secret",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps/operator-console-web/.dev.vars",
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "SENTRY_ENVIRONMENT=development",
                        "SENTRY_RELEASE=operator-console-web@dev-local",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps/campus-web/.dev.vars",
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "SENTRY_ENVIRONMENT=development",
                        "SENTRY_RELEASE=campus-web@dev-local",
                    ]
                )
                + "\n",
            )

            status = collect_worker_observability_status(repo_root=repo_root)

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["targets"]["apps/app-api/.dev.vars"]["ready"])
            self.assertTrue(status["targets"]["apps/operator-console-web/.dev.vars"]["ready"])
            self.assertTrue(status["targets"]["apps/campus-web/.dev.vars"]["ready"])

    def test_collect_worker_observability_status_reports_missing_target_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / "apps/app-api/.dev.vars",
                "SENTRY_DSN=https://shared.example\n",
            )

            status = collect_worker_observability_status(repo_root=repo_root)

            self.assertFalse(status["overall_ready"])
            self.assertIn(
                "APP_API_OTEL_INGEST_ENDPOINT",
                status["targets"]["apps/app-api/.dev.vars"]["missing_keys"],
            )
            self.assertFalse(status["targets"]["apps/campus-web/.dev.vars"]["exists"])

    def test_collect_worker_observability_status_rejects_source_env_input(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            source_env = repo_root / ".env"

            with self.assertRaisesRegex(ValueError, "--source-env was retired"):
                collect_worker_observability_status(
                    repo_root=repo_root,
                    source_env_path=source_env,
                )


if __name__ == "__main__":
    unittest.main()
