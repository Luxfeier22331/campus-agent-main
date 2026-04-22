from __future__ import annotations

from tests.evals.curriculum_live_benchmark_test_support import (
    AppApiEvalClientSettings,
    unittest,
)


class AppApiEvalClientSettingsTest(unittest.TestCase):
    def test_from_env_uses_profile_default_timeout_when_env_override_is_absent(self) -> None:
        settings = AppApiEvalClientSettings.from_env(
            {
                "APP_API_BASE_URL": "https://app-api.internal",
                "APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
                "APP_API_EVAL_USER_EMAIL": "eval-benchmark@example.edu",
            },
            default_timeout_seconds=180.0,
        )

        self.assertEqual(settings.timeout_seconds, 180.0)

    def test_from_env_prefers_explicit_env_timeout_over_profile_default(self) -> None:
        settings = AppApiEvalClientSettings.from_env(
            {
                "APP_API_BASE_URL": "https://app-api.internal",
                "APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
                "APP_API_EVAL_USER_EMAIL": "eval-benchmark@example.edu",
                "APP_API_EVAL_HTTP_TIMEOUT_SECONDS": "45",
            },
            default_timeout_seconds=180.0,
        )

        self.assertEqual(settings.timeout_seconds, 45.0)
