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
            ("apps/source-collector/Dockerfile",),
            root=repo_root,
        )

        self.assertEqual(selected, (repo_root / "apps/source-collector/Dockerfile",))

    def test_select_affected_dockerfiles_returns_all_when_hadolint_config_changes(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        selected = select_affected_dockerfiles((".hadolint.yaml",), root=repo_root)

        self.assertEqual(selected, tracked_dockerfiles(root=repo_root))

    def test_build_local_hadolint_command_uses_repo_config_and_relative_path(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = repo_root / "apps/source-collector/Dockerfile"

        command = build_local_hadolint_command(dockerfile, root=repo_root)

        self.assertEqual(
            command,
            [
                "hadolint",
                "-c",
                str(repo_root / ".hadolint.yaml"),
                "apps/source-collector/Dockerfile",
            ],
        )

    def test_build_docker_hadolint_command_mounts_repo_and_uses_official_image(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = repo_root / "apps/source-collector/Dockerfile"

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
                "apps/source-collector/Dockerfile",
            ],
        )

    def test_dockerignore_keeps_source_collector_build_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!package.json",
                "!pnpm-lock.yaml",
                "!pnpm-workspace.yaml",
                "!apps/source-collector/",
                "!apps/source-collector/**",
                "!packages/ingest-core/",
                "!packages/ingest-core/**",
                "!packages/ingestion-contracts/",
                "!packages/ingestion-contracts/**",
            }.issubset(patterns)
        )

    def test_source_collector_dockerfile_runs_adapter_entrypoints_through_tsx(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/source-collector/Dockerfile").read_text(encoding="utf-8")

        self.assertIn("FROM mcr.microsoft.com/playwright:v1.61.1-noble", dockerfile)
        self.assertIn("RUN pnpm install --frozen-lockfile --filter source-collector...", dockerfile)
        self.assertNotIn("packages/official-web-core", dockerfile)
        self.assertNotIn("packages/wechat-official-account-core", dockerfile)
        self.assertIn("RUN pnpm --filter source-collector typecheck", dockerfile)
        self.assertIn(
            'ENTRYPOINT ["pnpm", "--dir", "/workspace/apps/source-collector", "exec", "tsx"]',
            dockerfile,
        )
        self.assertIn('CMD ["--version"]', dockerfile)
        self.assertNotIn("collector-entrypoint.ts", dockerfile)

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
                "!packages/ingest-core/",
                "!packages/ingest-core/**",
                "!packages/ingestion-contracts/",
                "!packages/ingestion-contracts/**",
                "!Cargo.toml",
                "!Cargo.lock",
                "!packages/ingestion-kernels-rs/",
                "!packages/ingestion-kernels-rs/**",
            }.issubset(patterns)
        )

    def test_ingestion_control_dockerfile_builds_ingest_core_and_rust_kernel_runner(
        self,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/ingestion-control/Dockerfile").read_text(encoding="utf-8")

        self.assertIn(
            "COPY packages/ingest-core/package.json ./packages/ingest-core/package.json",
            dockerfile,
        )
        self.assertIn("COPY packages/ingest-core ./packages/ingest-core", dockerfile)
        self.assertIn("FROM rust:", dockerfile)
        self.assertIn("COPY Cargo.toml Cargo.lock ./", dockerfile)
        self.assertIn(
            "COPY packages/ingestion-kernels-rs ./packages/ingestion-kernels-rs",
            dockerfile,
        )
        self.assertIn(
            "cargo build --locked -p ingestion-kernels-rs --bin ingestion-kernel-runner --release",
            dockerfile,
        )
        self.assertIn(
            "COPY --from=rust-kernel-build /rust-workspace/target/release/ingestion-kernel-runner /usr/local/bin/ingestion-kernel-runner",
            dockerfile,
        )

    def test_ingestion_control_dockerfile_documents_api_and_worker_commands(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/ingestion-control/Dockerfile").read_text(encoding="utf-8")

        self.assertIn(
            'LABEL org.opencontainers.image.description="ingestion-control image supports api command and temporal-worker command"',
            dockerfile,
        )
        self.assertIn(
            'CMD ["node", "--experimental-strip-types", "apps/ingestion-control/src/server.ts"]',
            dockerfile,
        )
        self.assertIn(
            "# temporal-worker command: node --experimental-strip-types apps/ingestion-control/src/temporal-worker.ts",
            dockerfile,
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
                "!configs/runtime/query-serving-scopes.v2.json",
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
                "!apps/source-collector/**",
                "!apps/agent-runtime/**",
                "!apps/ingestion-control/**",
                "!jobs/dining-sync/**",
                "!packages/domains/**",
            )
        )

        for pattern in ("**/node_modules", "**/node_modules/**", "**/.turbo", "**/.turbo/**"):
            self.assertIn(pattern, entries)
            self.assertGreater(entries.index(pattern), last_app_reinclude)

    def test_dockerignore_excludes_source_collector_runtime_secrets_after_reinclude(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        entries = _dockerignore_entries(repo_root)
        source_collector_reinclude = entries.index("!apps/source-collector/**")

        for pattern in (
            "apps/source-collector/**/.env",
            "apps/source-collector/**/.env.*",
            "!apps/source-collector/**/.env.example",
            "apps/source-collector/**/runtime",
            "apps/source-collector/**/runtime/**",
            "apps/source-collector/**/.crawlee",
            "apps/source-collector/**/.crawlee/**",
        ):
            self.assertIn(pattern, entries)
            self.assertGreater(entries.index(pattern), source_collector_reinclude)

    def test_dockerignore_does_not_reinclude_retired_ingestion_worker(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertNotIn("!apps/ingestion-worker/", patterns)
        self.assertNotIn("!apps/ingestion-worker/**", patterns)

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
            return_value=(repo_root / "apps/source-collector/Dockerfile",),
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
            return_value=(repo_root / "apps/source-collector/Dockerfile",),
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
