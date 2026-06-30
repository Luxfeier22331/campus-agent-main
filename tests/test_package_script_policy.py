from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_package_script_policy import (
    PackageScriptPolicyIssue,
    audit_package_script_policy,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
ACTIVE_REFERENCE_ROOTS = (
    REPO_ROOT / "apps",
    REPO_ROOT / "configs",
    REPO_ROOT / "docs",
    REPO_ROOT / "packages",
)
TEXT_SUFFIXES = {".json", ".md", ".toml", ".ts", ".tsx", ".yaml", ".yml"}
FORBIDDEN_COLLECTOR_PACKAGE_SCRIPT_COMMANDS = (
    "pnpm --dir apps/authenticated-notice-collector auth:save",
    "pnpm --dir apps/authenticated-notice-collector auth:check",
    "pnpm --dir apps/authenticated-notice-collector bootstrap:export",
    "pnpm --dir apps/authenticated-notice-collector notice:capture",
    "pnpm --dir apps/authenticated-notice-collector collector:run",
    "pnpm --dir apps/authenticated-notice-collector file-release:export",
    "pnpm --filter authenticated-notice-collector auth:save",
    "pnpm --filter authenticated-notice-collector auth:check",
    "pnpm --filter authenticated-notice-collector bootstrap:export",
    "pnpm --filter authenticated-notice-collector notice:capture",
    "pnpm --filter authenticated-notice-collector collector:run",
    "pnpm --filter authenticated-notice-collector file-release:export",
    "pnpm --dir apps/official-web-collector crawl",
    "pnpm --dir apps/official-web-collector plan",
    "pnpm --dir apps/official-web-collector validate-source-pack",
    "pnpm --dir apps/official-web-collector validate",
    "pnpm --dir apps/official-web-collector qc-report",
    "pnpm --filter official-web-collector crawl",
    "pnpm --filter official-web-collector plan",
    "pnpm --filter official-web-collector validate-source-pack",
    "pnpm --filter official-web-collector validate",
    "pnpm --filter official-web-collector qc-report",
    "pnpm --dir apps/wechat-official-account-collector capture",
    "pnpm --filter wechat-official-account-collector capture",
)


class PackageScriptPolicyTest(unittest.TestCase):
    def test_current_repo_package_scripts_match_policy(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_package_script_policy(root=repo_root), ())

    def test_active_references_do_not_restore_collector_runtime_package_commands(
        self,
    ) -> None:
        offenders: list[str] = []
        for root in ACTIVE_REFERENCE_ROOTS:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                    continue
                text = path.read_text(encoding="utf-8")
                for command in FORBIDDEN_COLLECTOR_PACKAGE_SCRIPT_COMMANDS:
                    if command in text:
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {command}")

        self.assertEqual(offenders, [])

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

    def test_audit_reports_collector_package_scripts_outside_allowlist(self) -> None:
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

        self.assertIn(
            PackageScriptPolicyIssue(
                path="apps/official-web-collector/package.json",
                script="crawl",
                message=(
                    "collector package scripts may only expose build/test/typecheck "
                    "verification lanes; runtime entrypoints must be invoked directly "
                    "or through ingestion-control jobs"
                ),
            ),
            issues,
        )

    def test_audit_allows_collector_verification_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"repo:guard": "true"})
            _write_package(
                root / "apps/official-web-collector/package.json",
                {
                    "test": "vitest run",
                    "typecheck": "tsc --noEmit",
                },
            )

            issues = audit_package_script_policy(root=root)

        self.assertEqual(issues, ())

    def test_audit_allows_authenticated_notice_collector_build_script(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"repo:guard": "true"})
            _write_package(
                root / "apps/authenticated-notice-collector/package.json",
                {
                    "build": "tsc -p tsconfig.build.json",
                    "test": "vitest run",
                    "typecheck": "tsc --noEmit",
                },
            )

            issues = audit_package_script_policy(root=root)

        self.assertEqual(issues, ())

    def test_audit_rejects_new_collector_runtime_aliases_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _write_package(root / "package.json", {"repo:guard": "true"})
            _write_package(
                root / "apps/wechat-official-account-collector/package.json",
                {
                    "capture:debug": "node src/capture-cli.ts",
                    "test": "vitest run",
                    "typecheck": "tsc --noEmit",
                },
            )

            issues = audit_package_script_policy(root=root)

        self.assertIn(
            PackageScriptPolicyIssue(
                path="apps/wechat-official-account-collector/package.json",
                script="capture:debug",
                message=(
                    "collector package scripts may only expose build/test/typecheck "
                    "verification lanes; runtime entrypoints must be invoked directly "
                    "or through ingestion-control jobs"
                ),
            ),
            issues,
        )


def _write_package(path: Path, scripts: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"scripts": scripts}), encoding="utf-8")
