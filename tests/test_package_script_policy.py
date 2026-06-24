from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_package_script_policy import (
    PackageScriptPolicyIssue,
    audit_package_script_policy,
)


class PackageScriptPolicyTest(unittest.TestCase):
    def test_current_repo_package_scripts_match_policy(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_package_script_policy(root=repo_root), ())

    def test_audit_reports_root_script_outside_public_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"repo:guard": "true", "docs:lint": "true"})

            issues = audit_package_script_policy(root=root)

        self.assertIn(
            PackageScriptPolicyIssue(
                path="package.json",
                script="docs:lint",
                message="root package.json may only expose repo, ci, web, contracts, and go public lanes",
            ),
            issues,
        )

    def test_audit_reports_campus_dev_without_app_api(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"dev": "turbo run dev --filter=campus-web"})

            issues = audit_package_script_policy(root=root)

        self.assertIn(
            PackageScriptPolicyIssue(
                path="package.json",
                script="dev",
                message="root dev must start both campus-web and app-api for local student-surface development",
            ),
            issues,
        )

    def test_audit_reports_package_ops_admin_and_smoke_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"repo:guard": "true"})
            app_dir = root / "apps/app-api"
            _write_package(
                app_dir / "package.json",
                {
                    "build": "vite build",
                    "db:migrate": "drizzle-kit migrate",
                    "deploy:preflight:staging": "node ../../scripts/run-worker-staging-preflight.mjs",
                    "docs:gated:smoke:staging": "tsx scripts/staging-docs-gated-smoke.ts",
                },
            )

            issues = audit_package_script_policy(root=root)

        self.assertIn(
            PackageScriptPolicyIssue(
                path="apps/app-api/package.json",
                script="db:migrate",
                message="app-api package scripts must not expose DB/data/backfill/provider ops commands",
            ),
            issues,
        )
        self.assertIn(
            PackageScriptPolicyIssue(
                path="apps/app-api/package.json",
                script="deploy:preflight:staging",
                message="deploy internals must be owned by deploy scripts instead of package.json aliases",
            ),
            issues,
        )
        self.assertIn(
            PackageScriptPolicyIssue(
                path="apps/app-api/package.json",
                script="docs:gated:smoke:staging",
                message="staging smoke helpers must be invoked directly from runbooks or CI, not exposed as package scripts",
            ),
            issues,
        )

    def test_audit_allows_collector_cli_and_standard_lifecycle_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"repo:guard": "true"})
            _write_package(
                root / "apps/official-web-collector/package.json",
                {
                    "crawl": "node src/crawl.ts",
                    "plan": "node src/plan.ts",
                    "validate-source-pack": "node src/validate-source-pack.ts",
                    "validate": "node src/validate.ts",
                    "qc-report": "node src/qc-report.ts",
                    "test": "vitest run",
                    "typecheck": "tsc --noEmit",
                },
            )

            issues = audit_package_script_policy(root=root)

        self.assertEqual(issues, ())


def _write_package(path: Path, scripts: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"scripts": scripts}), encoding="utf-8")
