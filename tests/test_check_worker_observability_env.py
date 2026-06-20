from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.check_worker_observability_env import collect_worker_observability_status


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class CheckWorkerObservabilityEnvTest(unittest.TestCase):
    def test_collect_worker_observability_status_reports_ready_when_root_and_targets_align(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "APP_API_OTEL_INGEST_ENDPOINT=https://otel-ingest.example.com",
                        "APP_API_OTEL_INGEST_SHARED_SECRET=ingest-secret",
                    ]
                )
                + "\n",
            )
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
            self.assertTrue(status["source_ready"])
            self.assertEqual(status["source_missing_keys"], [])
            self.assertTrue(status["targets"]["apps/app-api/.dev.vars"]["ready"])
            self.assertTrue(status["targets"]["apps/operator-console-web/.dev.vars"]["ready"])
            self.assertTrue(status["targets"]["apps/campus-web/.dev.vars"]["ready"])

    def test_collect_worker_observability_status_reports_source_missing_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "SENTRY_DSN=https://shared.example\n",
            )

            status = collect_worker_observability_status(repo_root=repo_root)

            self.assertFalse(status["overall_ready"])
            self.assertFalse(status["source_ready"])
            self.assertIn("APP_API_OTEL_INGEST_ENDPOINT", status["source_missing_keys"])
            self.assertFalse(status["targets"]["apps/campus-web/.dev.vars"]["exists"])

    def test_collect_worker_observability_status_reports_target_mismatch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "APP_API_OTEL_INGEST_ENDPOINT=https://otel-ingest.example.com",
                        "APP_API_OTEL_INGEST_SHARED_SECRET=ingest-secret",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps/app-api/.dev.vars",
                "\n".join(
                    [
                        "SENTRY_DSN=https://api.other.example",
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

            self.assertFalse(status["overall_ready"])
            self.assertIn(
                "SENTRY_DSN",
                status["targets"]["apps/app-api/.dev.vars"]["mismatched_keys"],
            )
            self.assertFalse(status["targets"]["apps/app-api/.dev.vars"]["ready"])


if __name__ == "__main__":
    unittest.main()
