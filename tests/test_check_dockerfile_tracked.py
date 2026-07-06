from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_dockerfile_tracked import (
    build_docker_hadolint_command,
    build_local_hadolint_command,
    main,
    select_affected_dockerfiles,
    tracked_dockerfiles,
)


def _dockerignore_patterns(repo_root: Path) -> set[str]:
    return {
        line.strip()
        for line in (repo_root / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def _dockerignore_entries(repo_root: Path) -> list[str]:
    return [
        line.strip()
        for line in (repo_root / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


class CheckDockerfileTrackedTest(unittest.TestCase):
    def test_tracked_dockerfiles_match_repo_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            [
                "git",
                "-c",
                "core.quotePath=false",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "Dockerfile*",
                "*.dockerfile",
                "apps/**/Dockerfile*",
                "jobs/**/Dockerfile*",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item and (decoded := item.decode("utf-8")) and (repo_root / decoded).exists()
        )
        self.assertEqual(tracked_dockerfiles(root=repo_root), expected_paths)

    def test_select_affected_dockerfiles_skips_unrelated_paths(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        selected = select_affected_dockerfiles(
            (
                "apps/campus-web/src/features/conversation/assistant-ui-runtime.tsx",
                "apps/campus-web/e2e/qa.spec.ts",
            ),
            root=repo_root,
        )

        self.assertEqual(selected, ())

    def test_select_affected_dockerfiles_returns_changed_dockerfile(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        selected = select_affected_dockerfiles(
            ("apps/legacy-office-conversion-service/Dockerfile",),
            root=repo_root,
        )

        self.assertEqual(
            selected, (repo_root / "apps/legacy-office-conversion-service/Dockerfile",)
        )

    def test_select_affected_dockerfiles_returns_all_when_hadolint_config_changes(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        selected = select_affected_dockerfiles((".hadolint.yaml",), root=repo_root)

        self.assertEqual(selected, tracked_dockerfiles(root=repo_root))

    def test_build_local_hadolint_command_uses_repo_config_and_relative_path(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = repo_root / "apps/legacy-office-conversion-service/Dockerfile"

        command = build_local_hadolint_command(dockerfile, root=repo_root)

        self.assertEqual(
            command,
            [
                "hadolint",
                "-c",
                str(repo_root / ".hadolint.yaml"),
                "apps/legacy-office-conversion-service/Dockerfile",
            ],
        )

    def test_build_docker_hadolint_command_mounts_repo_and_uses_official_image(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = repo_root / "apps/legacy-office-conversion-service/Dockerfile"

        command = build_docker_hadolint_command(dockerfile, root=repo_root)

        self.assertEqual(
            command[:8],
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{repo_root}:/work",
                "-w",
                "/work",
                "hadolint/hadolint",
            ],
        )
        self.assertEqual(
            command[8:],
            [
                "hadolint",
                "-c",
                "/work/.hadolint.yaml",
                "apps/legacy-office-conversion-service/Dockerfile",
            ],
        )

    def test_dockerignore_keeps_authenticated_notice_collector_build_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!package.json",
                "!pnpm-lock.yaml",
                "!pnpm-workspace.yaml",
                "!apps/authenticated-notice-collector/",
                "!apps/authenticated-notice-collector/**",
            }.issubset(patterns)
        )

    def test_dockerignore_keeps_dining_sync_job_build_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!package.json",
                "!pnpm-lock.yaml",
                "!pnpm-workspace.yaml",
                "!jobs/dining-sync/",
                "!jobs/dining-sync/**",
                "!packages/domains/",
                "!packages/domains/**",
            }.issubset(patterns)
        )

    def test_dockerignore_keeps_agent_runtime_build_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!package.json",
                "!pnpm-lock.yaml",
                "!pnpm-workspace.yaml",
                "!apps/agent-runtime/",
                "!apps/agent-runtime/**",
                "!configs/runtime/tool-function-schemas.v1.json",
                "!configs/runtime/tools.v4.json",
            }.issubset(patterns)
        )

    def test_dockerignore_keeps_ingestion_control_build_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!package.json",
                "!pnpm-lock.yaml",
                "!pnpm-workspace.yaml",
                "!apps/ingestion-control/",
                "!apps/ingestion-control/**",
                "!packages/ingestion-contracts/",
                "!packages/ingestion-contracts/**",
            }.issubset(patterns)
        )

    def test_dockerignore_keeps_execution_control_contract_fixture_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!packages/contracts/",
                "!packages/contracts/**",
            }.issubset(patterns)
        )

    def test_dockerignore_keeps_execution_control_runtime_policy_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!configs/runtime/",
                "!configs/runtime/intent-policy.v1.json",
                "!configs/runtime/provider-pricing.v1.json",
                "!configs/runtime/query-serving-scopes.v1.json",
                "!configs/runtime/tool-function-schemas.v1.json",
                "!configs/runtime/tools.v4.json",
                "!configs/runtime/workflow-artifacts.v2.json",
            }.issubset(patterns)
        )

    def test_dockerignore_excludes_retired_calendar_agent_package(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertNotIn("!packages/calendar-agent/", patterns)
        self.assertNotIn("!packages/calendar-agent/**", patterns)

    def test_dockerignore_excludes_workspace_artifacts_after_app_reincludes(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        entries = _dockerignore_entries(repo_root)

        last_app_reinclude = max(
            entries.index(pattern)
            for pattern in (
                "!apps/authenticated-notice-collector/**",
                "!apps/agent-runtime/**",
                "!apps/ingestion-control/**",
                "!jobs/dining-sync/**",
                "!packages/domains/**",
            )
        )

        for pattern in ("**/node_modules", "**/node_modules/**", "**/.turbo", "**/.turbo/**"):
            self.assertIn(pattern, entries)
            self.assertGreater(entries.index(pattern), last_app_reinclude)

    def test_execution_control_dockerfile_copies_contract_fixtures_before_tests(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/execution-control/Dockerfile").read_text(encoding="utf-8")

        copy_statement = (
            "COPY packages/contracts/fixtures/tool_execution_contract "
            "/src/packages/contracts/fixtures/tool_execution_contract"
        )

        self.assertIn(copy_statement, dockerfile)
        self.assertLess(dockerfile.index(copy_statement), dockerfile.index("RUN go test ./..."))

    def test_execution_control_dockerfile_copies_httpapi_test_fixtures_before_tests(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/execution-control/Dockerfile").read_text(encoding="utf-8")

        tool_registry_copy = "COPY configs/runtime/tools.v4.json /src/configs/runtime/tools.v4.json"
        tool_schema_copy = (
            "COPY configs/runtime/tool-function-schemas.v1.json "
            "/src/configs/runtime/tool-function-schemas.v1.json"
        )

        self.assertIn(tool_registry_copy, dockerfile)
        self.assertIn(tool_schema_copy, dockerfile)
        self.assertLess(
            dockerfile.index(tool_registry_copy),
            dockerfile.index("RUN go test ./..."),
        )
        self.assertLess(dockerfile.index(tool_schema_copy), dockerfile.index("RUN go test ./..."))

    def test_execution_control_dockerfile_builds_primary_agent_activity_worker(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/execution-control/Dockerfile").read_text(encoding="utf-8")

        build_statement = (
            'CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/activity-worker-agent '
            "./cmd/activity-worker-agent"
        )
        copy_statement = (
            "COPY --from=build /out/activity-worker-agent /usr/local/bin/activity-worker-agent"
        )

        self.assertIn(build_statement, dockerfile)
        self.assertIn(copy_statement, dockerfile)

    @patch("scripts.check_dockerfile_tracked.shutil.which")
    @patch("scripts.check_dockerfile_tracked.subprocess.run")
    def test_main_prefers_local_hadolint_binary(
        self,
        run_mock: subprocess.CompletedProcess[str],
        which_mock: shutil.which,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        which_mock.side_effect = lambda name: f"/usr/bin/{name}" if name == "hadolint" else None
        with patch(
            "scripts.check_dockerfile_tracked.tracked_dockerfiles",
            return_value=(repo_root / "apps/legacy-office-conversion-service/Dockerfile",),
        ):
            run_mock.return_value = subprocess.CompletedProcess(args=["hadolint"], returncode=0)

            exit_code = main()

        self.assertEqual(exit_code, 0)
        args = run_mock.call_args.args[0]
        self.assertEqual(args[0], "hadolint")

    @patch("scripts.check_dockerfile_tracked.shutil.which")
    @patch("scripts.check_dockerfile_tracked.subprocess.run")
    def test_main_falls_back_to_docker_image_when_hadolint_binary_missing(
        self,
        run_mock: subprocess.CompletedProcess[str],
        which_mock: shutil.which,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        which_mock.side_effect = lambda name: "/usr/bin/docker" if name == "docker" else None
        with patch(
            "scripts.check_dockerfile_tracked.tracked_dockerfiles",
            return_value=(repo_root / "apps/legacy-office-conversion-service/Dockerfile",),
        ):
            run_mock.return_value = subprocess.CompletedProcess(args=["docker"], returncode=0)

            exit_code = main()

        self.assertEqual(exit_code, 0)
        args = run_mock.call_args.args[0]
        self.assertEqual(args[0], "docker")

    @patch("scripts.check_dockerfile_tracked.shutil.which", return_value=None)
    def test_main_fails_when_no_supported_runtime_is_available(
        self, which_mock: shutil.which
    ) -> None:
        self.assertEqual(main(), 1)
