from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from scripts.check_pnpm_lock_tracked import (
        app_package_manifest_for_lockfile,
        build_app_pnpm_lock_check_command,
        build_root_pnpm_lock_check_command,
        main,
        tracked_pnpm_lock_files,
        validate_app_manifest_has_no_workspace_dependencies,
    )
except ModuleNotFoundError:  # pragma: no cover - red phase for TDD
    app_package_manifest_for_lockfile = None
    build_app_pnpm_lock_check_command = None
    build_root_pnpm_lock_check_command = None
    validate_app_manifest_has_no_workspace_dependencies = None
    main = None
    tracked_pnpm_lock_files = None


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

    def test_build_app_pnpm_lock_check_command_uses_isolated_app_lockfile(self) -> None:
        self.assertIsNotNone(build_app_pnpm_lock_check_command)
        repo_root = Path(__file__).resolve().parents[1]
        lockfile = repo_root / "apps/app-api/pnpm-lock.yaml"
        self.assertEqual(
            build_app_pnpm_lock_check_command(lockfile, root=repo_root),
            [
                "pnpm",
                "install",
                "--dir",
                "apps/app-api",
                "--ignore-workspace",
                "--lockfile-dir",
                "apps/app-api",
                "--frozen-lockfile",
                "--ignore-scripts",
                "--lockfile-only",
            ],
        )

    def test_app_package_manifest_for_lockfile_requires_package_json(self) -> None:
        self.assertIsNotNone(app_package_manifest_for_lockfile)
        repo_root = Path(__file__).resolve().parents[1]
        with self.assertRaisesRegex(FileNotFoundError, "package.json"):
            app_package_manifest_for_lockfile(
                repo_root / "tmp/missing/pnpm-lock.yaml", root=repo_root
            )

    def test_app_local_lockfile_rejects_workspace_protocol_dependencies(self) -> None:
        self.assertIsNotNone(validate_app_manifest_has_no_workspace_dependencies)
        repo_root = Path(__file__).resolve().parents[1]
        with self.assertRaisesRegex(ValueError, "workspace protocol"):
            validate_app_manifest_has_no_workspace_dependencies(
                {
                    "dependencies": {
                        "dining-floorplans": "workspace:*",
                    }
                },
                repo_root / "apps/app-api/package.json",
                root=repo_root,
            )

    @patch("scripts.check_pnpm_lock_tracked.subprocess.run")
    def test_main_runs_root_and_app_local_checks(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        self.assertIsNotNone(main)
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_pnpm_lock_tracked.tracked_pnpm_lock_files",
            return_value=(
                repo_root / "pnpm-lock.yaml",
                repo_root / "apps/app-api/pnpm-lock.yaml",
                repo_root / "apps/protected-panel-web/pnpm-lock.yaml",
            ),
        ):
            run_mock.side_effect = [
                subprocess.CompletedProcess(args=["pnpm"], returncode=0),
                subprocess.CompletedProcess(args=["pnpm"], returncode=0),
                subprocess.CompletedProcess(args=["pnpm"], returncode=0),
            ]

            exit_code = main(root=repo_root)

        self.assertEqual(exit_code, 0)
        command_calls = [call.args[0] for call in run_mock.call_args_list]
        self.assertEqual(command_calls[0], build_root_pnpm_lock_check_command())
        self.assertEqual(
            command_calls[1],
            build_app_pnpm_lock_check_command(
                repo_root / "apps/app-api/pnpm-lock.yaml", root=repo_root
            ),
        )
        self.assertEqual(
            command_calls[2],
            build_app_pnpm_lock_check_command(
                repo_root / "apps/protected-panel-web/pnpm-lock.yaml",
                root=repo_root,
            ),
        )
