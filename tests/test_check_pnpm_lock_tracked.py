from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from scripts.check_pnpm_lock_tracked import (
        build_root_pnpm_lock_check_command,
        main,
        tracked_pnpm_lock_files,
        unexpected_pnpm_lock_files,
    )
except ModuleNotFoundError:  # pragma: no cover - red phase for TDD
    build_root_pnpm_lock_check_command = None
    main = None
    tracked_pnpm_lock_files = None
    unexpected_pnpm_lock_files = None


class CheckPnpmLockTrackedTest(unittest.TestCase):
    def test_tracked_pnpm_lock_files_match_repo_inventory(self) -> None:
        self.assertIsNotNone(tracked_pnpm_lock_files)
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
                "pnpm-lock.yaml",
                "**/pnpm-lock.yaml",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / line
            for item in expected.stdout.split(b"\0")
            if item
            and not (line := item.decode("utf-8")).startswith(".planning/")
            and "/vendor/" not in line
            and "/node_modules/" not in line
            and (repo_root / line).exists()
        )
        self.assertEqual(tracked_pnpm_lock_files(root=repo_root), expected_paths)

    def test_build_root_pnpm_lock_check_command_uses_frozen_lockfile_only(self) -> None:
        self.assertIsNotNone(build_root_pnpm_lock_check_command)
        self.assertEqual(
            build_root_pnpm_lock_check_command(),
            [
                "pnpm",
                "install",
                "--frozen-lockfile",
                "--ignore-scripts",
                "--lockfile-only",
            ],
        )

    def test_unexpected_pnpm_lock_files_reports_app_local_lockfiles(self) -> None:
        self.assertIsNotNone(unexpected_pnpm_lock_files)
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_pnpm_lock_tracked.tracked_pnpm_lock_files",
            return_value=(
                repo_root / "pnpm-lock.yaml",
                repo_root / "apps/app-api/pnpm-lock.yaml",
            ),
        ):
            self.assertEqual(
                unexpected_pnpm_lock_files(root=repo_root),
                (repo_root / "apps/app-api/pnpm-lock.yaml",),
            )

    @patch("scripts.check_pnpm_lock_tracked.subprocess.run")
    def test_main_runs_root_lockfile_check(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        self.assertIsNotNone(main)
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_pnpm_lock_tracked.tracked_pnpm_lock_files",
            return_value=(repo_root / "pnpm-lock.yaml",),
        ):
            run_mock.return_value = subprocess.CompletedProcess(args=["pnpm"], returncode=0)

            exit_code = main(root=repo_root)

        self.assertEqual(exit_code, 0)
        command_calls = [call.args[0] for call in run_mock.call_args_list]
        self.assertEqual(command_calls, [build_root_pnpm_lock_check_command()])

    @patch("scripts.check_pnpm_lock_tracked.subprocess.run")
    def test_main_rejects_app_local_lockfiles_without_running_pnpm(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        self.assertIsNotNone(main)
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_pnpm_lock_tracked.tracked_pnpm_lock_files",
            return_value=(
                repo_root / "pnpm-lock.yaml",
                repo_root / "apps/app-api/pnpm-lock.yaml",
            ),
        ):
            exit_code = main(root=repo_root)

        self.assertEqual(exit_code, 1)
        run_mock.assert_not_called()
