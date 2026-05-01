from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from campus_ingestion_worker.authenticated_notice_processing_projection_reporting import (
    HttpAuthenticatedNoticeRunProcessingProjectionReporter,
    build_run_processing_projection_reporter_from_env,
)


class AuthenticatedNoticeRunProcessingProjectionReporterTest(unittest.TestCase):
    def test_http_reporter_posts_run_snapshots_to_app_api_internal_endpoint(self) -> None:
        reporter = HttpAuthenticatedNoticeRunProcessingProjectionReporter(
            base_url="https://app-api.internal/",
            internal_shared_secret="trusted-secret",
        )
        response = MagicMock()
        response.status = 200
        response.__enter__.return_value = response
        response.__exit__.return_value = None

        with patch(
            "campus_ingestion_worker.authenticated_notice_processing_projection_reporting.urllib_request.urlopen",
            return_value=response,
        ) as urlopen:
            reporter.report(
                snapshots=[
                    {
                        "id": "run-processing-001",
                        "collectorRunToken": "20260428T181953007Z",
                    }
                ]
            )

        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://app-api.internal/api/internal/operator/authenticated-notices/run-processing-snapshots",
        )
        self.assertEqual(request.headers["X-app-internal-auth"], "trusted-secret")
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {
                "snapshots": [
                    {
                        "id": "run-processing-001",
                        "collectorRunToken": "20260428T181953007Z",
                    }
                ]
            },
        )

    def test_builds_run_reporter_from_existing_app_api_callback_env(self) -> None:
        self.assertIsNone(build_run_processing_projection_reporter_from_env({}))
        reporter = build_run_processing_projection_reporter_from_env(
            {
                "INGESTION_WORKER_APP_API_BASE_URL": "https://app-api.internal",
                "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
            }
        )
        self.assertIsInstance(reporter, HttpAuthenticatedNoticeRunProcessingProjectionReporter)


if __name__ == "__main__":
    unittest.main()
