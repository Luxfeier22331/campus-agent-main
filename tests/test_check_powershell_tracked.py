from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_powershell_tracked import (
    main,
    powershell_parse_command,
    tracked_powershell_files,
    validate_powershell_file,
)


class CheckPowerShellTrackedTest(unittest.TestCase):
    def test_tracked_powershell_files_match_repo_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.ps1"],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item and not (decoded := item.decode("utf-8")).startswith(".planning/")
        )
        self.assertEqual(tracked_powershell_files(root=repo_root), expected_paths)

    @patch("scripts.check_powershell_tracked.subprocess.run")
    def test_validate_powershell_file_uses_pwsh_parser(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        path = Path("/tmp/test.ps1")
        run_mock.return_value = subprocess.CompletedProcess(args=["pwsh"], returncode=0)

        validate_powershell_file(path)

        self.assertEqual(run_mock.call_args.args[0], powershell_parse_command(path))

    @patch("scripts.check_powershell_tracked.subprocess.run")
    def test_main_reports_missing_pwsh_binary(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        script_path = (
            repo_root / "infra/local/staging/install-dev-backed-supervisor-staging-task.ps1"
        )
        run_mock.side_effect = [
            subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout=b"infra/local/staging/install-dev-backed-supervisor-staging-task.ps1\0",
            ),
            OSError("pwsh not found"),
        ]

        exit_code = main()

        self.assertEqual(exit_code, 1)
        self.assertEqual(run_mock.call_args_list[1].args[0][0], "pwsh")
        self.assertEqual(run_mock.call_args_list[1].kwargs["cwd"], repo_root)
        self.assertIn(str(script_path), run_mock.call_args_list[1].args[0][4])
