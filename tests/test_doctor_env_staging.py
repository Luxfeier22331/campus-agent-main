from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status


class DoctorEnvStagingTest(unittest.TestCase):
    def test_collect_env_doctor_status_reports_worker_staging_shell_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_ACCESS_TEAM_DOMAIN": "https://mucwiki-edge.cloudflareaccess.com",
                    "STAGING_ACCESS_POLICY_AUD": "operator-console-staging-audience",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(repo_root=repo_root, surface="worker-staging")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["settings"]["required"]["staging_access_team_domain"]["present"])
            self.assertTrue(status["settings"]["required"]["staging_access_policy_aud"]["present"])

    def test_collect_env_doctor_status_reports_app_api_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-app-api"
                )

            self.assertTrue(status["overall_ready"])
            self.assertNotIn("staging_execution_control_base_url", status["settings"]["required"])
            self.assertNotIn(
                "staging_execution_control_access_client_id", status["settings"]["required"]
            )
            self.assertNotIn(
                "staging_execution_control_access_client_secret", status["settings"]["required"]
            )
            self.assertNotIn(
                "staging_app_api_operator_database_url", status["settings"]["optional"]
            )
            self.assertNotIn("staging_app_api_database_sslmode", status["settings"]["optional"])
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_campus_web_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY": "0x4AAAAAAAstagingWidget",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-campus-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(
                status["settings"]["required"]["staging_campus_auth_turnstile_site_key"]["present"]
            )
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_operator_console_worker_staging_requirements(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_ACCESS_TEAM_DOMAIN": "https://mucwiki-edge.cloudflareaccess.com",
                    "STAGING_ACCESS_POLICY_AUD": "operator-console-staging-audience",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-operator-console-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["settings"]["required"]["staging_access_team_domain"]["present"])
            self.assertTrue(status["settings"]["required"]["staging_access_policy_aud"]["present"])
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])


if __name__ == "__main__":
    unittest.main()
