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
    tracked_dockerfiles,
)


def _dockerignore_patterns(repo_root: Path) -> set[str]:
    return {
        line.strip()
        for line in (repo_root / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


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

    def test_dockerignore_keeps_supervisor_api_contract_fixture_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!tests/",
                "!tests/fixtures/",
                "!tests/fixtures/supervisor_execution_contract/",
                "!tests/fixtures/supervisor_execution_contract/**",
            }.issubset(patterns)
        )

    def test_dockerignore_keeps_supervisor_api_runtime_policy_inputs(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        patterns = _dockerignore_patterns(repo_root)

        self.assertTrue(
            {
                "!configs/runtime/",
                "!configs/runtime/agents.v1.json",
                "!configs/runtime/intent-policy.v1.json",
                "!configs/runtime/query-serving-scopes.v1.json",
                "!configs/runtime/tools.v1.json",
                "!tests/fixtures/service_guide_vpn_grouped_procedure_result.json",
            }.issubset(patterns)
        )

    def test_supervisor_api_dockerfile_copies_contract_fixtures_before_tests(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        dockerfile = (repo_root / "apps/supervisor-api/Dockerfile").read_text(encoding="utf-8")

        copy_statement = (
            "COPY tests/fixtures/supervisor_execution_contract "
            "/src/tests/fixtures/supervisor_execution_contract"
        )

        self.assertIn(copy_statement, dockerfile)
        self.assertLess(dockerfile.index(copy_statement), dockerfile.index("RUN go test ./..."))

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
