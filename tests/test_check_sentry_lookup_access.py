from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.check_sentry_lookup_access import (
    load_sentry_api_token,
    probe_sentry_lookup_access,
    render_markdown_report,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class CheckSentryLookupAccessTest(unittest.TestCase):
    def test_load_sentry_api_token_prefers_process_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            token, token_source, source_path = load_sentry_api_token(
                repo_root=repo_root,
                env={"SENTRY_API_TOKEN": "env-token"},
            )

            self.assertEqual(token, "env-token")
            self.assertEqual(token_source, "process_env")
            self.assertEqual(source_path, repo_root / ".env")

    def test_probe_sentry_lookup_access_reads_root_env_and_lists_projects(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(repo_root / ".env", "SENTRY_API_TOKEN=repo-token\n")
            requested_urls: list[str] = []

            def fake_fetch_json(url: str, token: str) -> object:
                requested_urls.append(url)
                self.assertEqual(token, "repo-token")
                if url.endswith("/api/0/organizations/"):
                    return [
                        {"id": "1", "slug": "linear27", "name": "Linear 27"},
                    ]
                if url.endswith("/api/0/organizations/linear27/projects/"):
                    return [
                        {
                            "id": "101",
                            "slug": "campus-agent-api",
                            "platform": "node-cloudflare-workers",
                            "name": "campus-agent-api",
                        },
                        {
                            "id": "102",
                            "slug": "campus-agent-chat",
                            "platform": "node-cloudflare-workers",
                            "name": "campus-agent-chat",
                        },
                    ]
                raise AssertionError(f"unexpected URL: {url}")

            status = probe_sentry_lookup_access(
                repo_root=repo_root,
                fetch_json=fake_fetch_json,
            )

            self.assertEqual(status["token_env_key"], "SENTRY_API_TOKEN")
            self.assertEqual(status["token_source"], "source_env")
            self.assertEqual(status["selected_org_slug"], "linear27")
            self.assertFalse(status["org_slug_required"])
            self.assertEqual(status["project_count"], 2)
            self.assertEqual(
                [project["slug"] for project in status["projects"]],
                ["campus-agent-api", "campus-agent-chat"],
            )
            self.assertEqual(
                requested_urls,
                [
                    "https://sentry.io/api/0/organizations/",
                    "https://sentry.io/api/0/organizations/linear27/projects/",
                ],
            )

    def test_probe_sentry_lookup_access_requires_org_slug_when_multiple_orgs_are_visible(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(repo_root / ".env", "SENTRY_API_TOKEN=repo-token\n")

            def fake_fetch_json(url: str, token: str) -> object:
                self.assertEqual(token, "repo-token")
                if url.endswith("/api/0/organizations/"):
                    return [
                        {"id": "1", "slug": "linear27", "name": "Linear 27"},
                        {"id": "2", "slug": "other-campus", "name": "Other Campus"},
                    ]
                raise AssertionError(f"unexpected URL: {url}")

            status = probe_sentry_lookup_access(
                repo_root=repo_root,
                fetch_json=fake_fetch_json,
            )

            self.assertIsNone(status["selected_org_slug"])
            self.assertTrue(status["org_slug_required"])
            self.assertEqual(status["project_count"], 0)
            self.assertEqual(status["projects"], [])

    def test_render_markdown_report_includes_org_and_project_summary(self) -> None:
        report = render_markdown_report(
            {
                "base_url": "https://sentry.io",
                "org_count": 1,
                "org_slug_required": False,
                "organizations": [
                    {"id": "1", "name": "Linear 27", "slug": "linear27"},
                ],
                "project_count": 2,
                "projects": [
                    {
                        "id": "101",
                        "name": "campus-agent-api",
                        "platform": "node-cloudflare-workers",
                        "slug": "campus-agent-api",
                    },
                    {
                        "id": "102",
                        "name": "campus-agent-chat",
                        "platform": "node-cloudflare-workers",
                        "slug": "campus-agent-chat",
                    },
                ],
                "selected_org_slug": "linear27",
                "source_env_path": "/tmp/campus-agent/.env",
                "token_env_key": "SENTRY_API_TOKEN",
                "token_source": "source_env",
            }
        )

        self.assertIn("# Sentry Lookup Access", report)
        self.assertIn("- Env key: `SENTRY_API_TOKEN`", report)
        self.assertIn("- Token source: `source_env`", report)
        self.assertIn("- Selected org: `linear27`", report)
        self.assertIn("- `campus-agent-api` (`node-cloudflare-workers`)", report)
        self.assertIn("- `campus-agent-chat` (`node-cloudflare-workers`)", report)


if __name__ == "__main__":
    unittest.main()
