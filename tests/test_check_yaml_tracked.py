from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_yaml_tracked import main, tracked_yaml_files


class CheckYamlTrackedTest(unittest.TestCase):
    def test_tracked_yaml_files_match_git_ls_files_without_planning(self) -> None:
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
                "*.yml",
                "*.yaml",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            and not (decoded := item.decode("utf-8")).startswith(".planning/")
            and (repo_root / decoded).exists()
        )
        self.assertEqual(tracked_yaml_files(root=repo_root), expected_paths)
        self.assertTrue(
            all(".planning" not in str(path.relative_to(repo_root)) for path in expected_paths)
        )

    @patch("scripts.check_yaml_tracked.subprocess.run")
    def test_main_invokes_yamllint_for_tracked_files(
        self,
        run_mock: subprocess.CompletedProcess[str],
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_yaml_tracked.tracked_yaml_files",
            return_value=(
                repo_root / ".github/workflows/pr-checks.yml",
                repo_root
                / "apps/legacy-office-conversion-service/src/main/resources/application.yml",
            ),
        ):
            run_mock.return_value = subprocess.CompletedProcess(args=["yamllint"], returncode=0)

            exit_code = main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            run_mock.call_args.args[0],
            [
                "yamllint",
                "-c",
                ".yamllint.yml",
                ".github/workflows/pr-checks.yml",
                "apps/legacy-office-conversion-service/src/main/resources/application.yml",
            ],
        )
