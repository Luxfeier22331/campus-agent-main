from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from campus_ingestion_worker.official_web_release_task_projection_reporting import (
    HttpOfficialWebReleaseTaskProjectionReporter,
    OfficialWebReleaseTaskProjectionReportError,
    build_official_web_release_task_projection_reporter_from_env,
    require_official_web_release_task_projection_reporter_from_env,
)


class OfficialWebReleaseTaskProjectionReporterTest(unittest.TestCase):
    def test_http_reporter_posts_snapshots_to_app_api_internal_endpoint(self) -> None:
        reporter = HttpOfficialWebReleaseTaskProjectionReporter(
            base_url="https://app-api.internal/",
            internal_shared_secret="trusted-secret",
        )
        response = MagicMock()
        response.status = 200
        response.__enter__.return_value = response
        response.__exit__.return_value = None

        with patch(
            "campus_ingestion_worker.official_web_release_task_projection_reporting.urllib_request.urlopen",
            return_value=response,
        ) as urlopen:
            reporter.report(
                snapshots=[
                    {
                        "taskId": "owrelease_contact",
                        "lifecycleStatus": "published",
                    }
                ]
            )

        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://app-api.internal/api/internal/operator/official-web/release-task-snapshots",
        )
        self.assertEqual(request.headers["X-app-internal-auth"], "trusted-secret")
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {
                "snapshots": [
                    {
                        "taskId": "owrelease_contact",
                        "lifecycleStatus": "published",
                    }
                ]
            },
        )

    def test_builds_reporter_only_when_app_api_callback_is_configured(self) -> None:
        self.assertIsNone(build_official_web_release_task_projection_reporter_from_env({}))
        reporter = build_official_web_release_task_projection_reporter_from_env(
            {
                "INGESTION_WORKER_APP_API_BASE_URL": "https://app-api.internal",
                "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
            }
        )
        self.assertIsInstance(reporter, HttpOfficialWebReleaseTaskProjectionReporter)

    def test_require_reporter_fails_closed_when_callback_env_is_missing(self) -> None:
        with self.assertRaises(OfficialWebReleaseTaskProjectionReportError) as raised:
            require_official_web_release_task_projection_reporter_from_env({})

        self.assertEqual(
            raised.exception.code,
            "official_web_release_task_projection_callback_not_configured",
        )


if __name__ == "__main__":
    unittest.main()
