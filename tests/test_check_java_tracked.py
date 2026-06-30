from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_java_tracked import (
    affected_java_lint_required,
    main,
    run_java_lint,
    tracked_java_files,
)


class CheckJavaTrackedTest(unittest.TestCase):
    def test_tracked_java_files_match_repo_inventory(self) -> None:
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
                "apps/legacy-office-conversion-service/src/**/*.java",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            and (decoded := item.decode("utf-8")).startswith(
                "apps/legacy-office-conversion-service/src/"
            )
            and decoded.endswith(".java")
            and (repo_root / decoded).exists()
        )

        self.assertEqual(tracked_java_files(root=repo_root), expected_paths)

    def test_run_java_lint_invokes_docker_lint_target(self) -> None:
        repo_root = Path("/repo")
        with patch("scripts.check_java_tracked.subprocess.run") as run:
            run_java_lint(root=repo_root)

        run.assert_called_once_with(
            [
                "docker",
                "build",
                "--file",
                "apps/legacy-office-conversion-service/Dockerfile",
                "--target",
                "lint",
                ".",
            ],
            check=True,
            cwd=repo_root,
        )

    def test_main_returns_success_when_no_java_files_exist(self) -> None:
        with patch("scripts.check_java_tracked.tracked_java_files", return_value=()):
            self.assertEqual(main(), 0)

    def test_affected_java_lint_skips_unrelated_frontend_paths(self) -> None:
        self.assertFalse(
            affected_java_lint_required(
                (
                    "apps/campus-web/src/features/conversation/assistant-ui-runtime.tsx",
                    "apps/campus-web/e2e/qa.spec.ts",
                )
            )
        )

    def test_affected_java_lint_runs_for_legacy_office_surface(self) -> None:
        self.assertTrue(
            affected_java_lint_required(
                ("apps/legacy-office-conversion-service/src/main/java/Foo.java",)
            )
        )
        self.assertTrue(
            affected_java_lint_required(("apps/legacy-office-conversion-service/Dockerfile",))
        )

    def test_main_fails_closed_when_docker_is_missing(self) -> None:
        fake_java_file = Path("/repo/apps/legacy-office-conversion-service/src/main/java/Foo.java")
        with (
            patch("scripts.check_java_tracked.tracked_java_files", return_value=(fake_java_file,)),
            patch("scripts.check_java_tracked.run_java_lint", side_effect=FileNotFoundError),
        ):
            self.assertEqual(main(), 1)


if __name__ == "__main__":
    unittest.main()
