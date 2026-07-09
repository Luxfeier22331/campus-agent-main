from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy-staging.yml"
RETIRED_EXECUTION_CONTROL_PUBLIC_URL_KEY = "_".join(
    ("STAGING", "EXECUTION", "CONTROL", "BASE", "URL")
)
RETIRED_EXECUTION_CONTROL_ACCESS_ID_KEY = "_".join(
    ("STAGING", "EXECUTION", "CONTROL", "ACCESS", "CLIENT", "ID")
)
RETIRED_EXECUTION_CONTROL_ACCESS_SECRET_KEY = "_".join(
    ("STAGING", "EXECUTION", "CONTROL", "ACCESS", "CLIENT", "SECRET")
)


class DeployStagingWorkflowEnvTest(unittest.TestCase):
    def test_deploy_staging_uses_minimal_github_environment_scope(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", source)
        self.assertIn("CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}", source)
        self.assertIn(
            "STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY: "
            "${{ vars.STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY }}",
            source,
        )
        self.assertIn("STAGING_ACCESS_TEAM_DOMAIN: ${{ vars.STAGING_ACCESS_TEAM_DOMAIN }}", source)
        self.assertIn("STAGING_ACCESS_POLICY_AUD: ${{ vars.STAGING_ACCESS_POLICY_AUD }}", source)

        self.assertNotIn("secrets.CLOUDFLARE_ACCOUNT_ID", source)
        self.assertNotIn("secrets.STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY", source)
        self.assertNotIn("secrets.STAGING_ACCESS_TEAM_DOMAIN", source)
        self.assertNotIn("secrets.STAGING_ACCESS_POLICY_AUD", source)
        self.assertNotIn("STAGING_APP_API_OPERATOR_DATABASE_URL", source)
        self.assertNotIn("STAGING_APP_API_DATABASE_SSLMODE", source)
        self.assertNotIn(RETIRED_EXECUTION_CONTROL_PUBLIC_URL_KEY, source)
        self.assertNotIn(RETIRED_EXECUTION_CONTROL_ACCESS_ID_KEY, source)
        self.assertNotIn(RETIRED_EXECUTION_CONTROL_ACCESS_SECRET_KEY, source)


if __name__ == "__main__":
    unittest.main()
