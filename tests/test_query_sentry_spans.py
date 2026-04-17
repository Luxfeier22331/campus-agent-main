from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.query_sentry_spans import (
    DEFAULT_FIELDS,
    query_sentry_spans,
    render_markdown_report,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class QuerySentrySpansTest(unittest.TestCase):
    def test_query_sentry_spans_reads_root_env_and_queries_explore_spans(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(repo_root / ".env", "SENTRY_API_TOKEN=repo-token\n")
            requested_urls: list[str] = []

            def fake_fetch_json(url: str, token: str) -> object:
                requested_urls.append(url)
                self.assertEqual(token, "repo-token")
                return {
                    "data": [
                        {
                            "id": "span_01",
                            "project.name": "campus-agent-chat",
                            "span.description": "POST /api/chat/requests",
                            "span.op": "http.server",
                            "timestamp": "2026-04-09T06:22:44+00:00",
                            "trace": "aa87e040f4a74358aa74b62fa06b87b8",
                        }
                    ],
                    "meta": {
                        "dataset": "spans",
                        "fields": {field: "string" for field in DEFAULT_FIELDS},
                    },
                }

            status = query_sentry_spans(
                repo_root=repo_root,
                org_slug="linear27",
                project_ids=["4511127821484032", "4511127812571136"],
                environment="staging",
                stats_period="30d",
                query="trace:aa87e040f4a74358aa74b62fa06b87b8",
                fetch_json=fake_fetch_json,
            )

            self.assertEqual(status["token_env_key"], "SENTRY_API_TOKEN")
            self.assertEqual(status["token_source"], "source_env")
            self.assertEqual(status["org_slug"], "linear27")
            self.assertEqual(status["dataset"], "spans")
            self.assertEqual(status["projects"], ["4511127821484032", "4511127812571136"])
            self.assertEqual(status["environment"], "staging")
            self.assertEqual(status["stats_period"], "30d")
            self.assertEqual(status["query"], "trace:aa87e040f4a74358aa74b62fa06b87b8")
            self.assertEqual(status["row_count"], 1)
            self.assertEqual(status["rows"][0]["trace"], "aa87e040f4a74358aa74b62fa06b87b8")
            self.assertEqual(
                requested_urls,
                [
                    "https://sentry.io/api/0/organizations/linear27/events/?dataset=spans&field=trace&field=span.op&field=span.description&field=timestamp&field=id&field=project.name&project=4511127821484032&project=4511127812571136&environment=staging&statsPeriod=30d&sort=-timestamp&per_page=20&query=trace%3Aaa87e040f4a74358aa74b62fa06b87b8"
                ],
            )

    def test_render_markdown_report_includes_query_inputs_and_rows(self) -> None:
        report = render_markdown_report(
            {
                "api_url": "https://sentry.io/api/0/organizations/linear27/events/?dataset=spans",
                "base_url": "https://sentry.io",
                "dataset": "spans",
                "environment": "staging",
                "fields": list(DEFAULT_FIELDS),
                "meta": {"dataset": "spans"},
                "org_slug": "linear27",
                "per_page": 20,
                "projects": ["campus-agent-chat", "campus-agent-api"],
                "query": "trace:aa87e040f4a74358aa74b62fa06b87b8",
                "row_count": 2,
                "rows": [
                    {
                        "id": "9ff5f1a72be00a6d",
                        "project.name": "campus-agent-chat",
                        "span.description": "POST /api/chat/requests",
                        "span.op": "http.server",
                        "timestamp": "2026-04-09T06:22:44+00:00",
                        "trace": "aa87e040f4a74358aa74b62fa06b87b8",
                    },
                    {
                        "id": "905455803471b6c2",
                        "project.name": "campus-agent-api",
                        "span.description": "POST /api/chat/requests",
                        "span.op": "http.server",
                        "timestamp": "2026-04-09T06:22:45+00:00",
                        "trace": "aa87e040f4a74358aa74b62fa06b87b8",
                    },
                ],
                "sort": "-timestamp",
                "source_env_path": "/tmp/campus-agent/.env",
                "stats_period": "30d",
                "token_env_key": "SENTRY_API_TOKEN",
                "token_source": "source_env",
            }
        )

        self.assertIn("# Sentry Span Query", report)
        self.assertIn("- Org: `linear27`", report)
        self.assertIn("- Dataset: `spans`", report)
        self.assertIn("- Environment: `staging`", report)
        self.assertIn("- Projects: `campus-agent-chat`, `campus-agent-api`", report)
        self.assertIn("- Row count: `2`", report)
        self.assertIn("`campus-agent-chat` | `POST /api/chat/requests`", report)
        self.assertIn("`campus-agent-api` | `POST /api/chat/requests`", report)


if __name__ == "__main__":
    unittest.main()
