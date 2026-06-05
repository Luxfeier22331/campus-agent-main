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
                    "STAGING_SUPERVISOR_API_BASE_URL": "https://supervisor-staging.example.com",
                    "STAGING_ACCESS_TEAM_DOMAIN": "https://mucwiki-edge.cloudflareaccess.com",
                    "STAGING_ACCESS_POLICY_AUD": "panel-staging-audience",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(repo_root=repo_root, surface="worker-staging")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(
                status["settings"]["required"]["staging_supervisor_api_base_url"]["present"]
            )
            self.assertTrue(status["settings"]["required"]["staging_access_team_domain"]["present"])
            self.assertTrue(status["settings"]["required"]["staging_access_policy_aud"]["present"])

    def test_collect_env_doctor_status_reports_app_api_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_SUPERVISOR_API_BASE_URL": "https://supervisor-staging.example.com",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-app-api"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(
                status["settings"]["required"]["staging_supervisor_api_base_url"]["present"]
            )
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_public_chat_worker_staging_without_shell_inputs(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-public-chat-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["settings"]["required"], {})
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_hub_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_HUB_AUTH_TURNSTILE_SITE_KEY": "0x4AAAAAAAstagingWidget",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-hub-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(
                status["settings"]["required"]["staging_hub_auth_turnstile_site_key"]["present"]
            )
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_panel_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_ACCESS_TEAM_DOMAIN": "https://mucwiki-edge.cloudflareaccess.com",
                    "STAGING_ACCESS_POLICY_AUD": "panel-staging-audience",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-protected-panel-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["settings"]["required"]["staging_access_team_domain"]["present"])
            self.assertTrue(status["settings"]["required"]["staging_access_policy_aud"]["present"])
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])


if __name__ == "__main__":
    unittest.main()
