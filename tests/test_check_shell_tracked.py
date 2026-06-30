from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_shell_tracked import (
    build_docker_shellcheck_command,
    build_local_shellcheck_command,
    main,
    select_affected_shell_files,
    tracked_shell_files,
    validate_shell_file,
)


class CheckShellTrackedTest(unittest.TestCase):
    def test_tracked_shell_files_match_git_ls_files(self) -> None:
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
                "*.sh",
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
        self.assertEqual(tracked_shell_files(root=repo_root), expected_paths)

    def test_select_affected_shell_files_skips_unrelated_paths(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        selected = select_affected_shell_files(
            ("apps/campus-web/src/features/conversation/assistant-ui-runtime.tsx",),
            root=repo_root,
        )

        self.assertEqual(selected, ())

    def test_select_affected_shell_files_returns_changed_shell_script(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        selected = select_affected_shell_files(
            ("infra/local/minio/create_buckets.sh",),
            root=repo_root,
        )

        self.assertEqual(selected, (repo_root / "infra/local/minio/create_buckets.sh",))

    def test_build_local_shellcheck_command_uses_repo_relative_path(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        script = repo_root / "infra/local/minio/create_buckets.sh"

        self.assertEqual(
            build_local_shellcheck_command(script, root=repo_root),
            [
                "shellcheck",
                "-x",
                "-s",
                "bash",
                "infra/local/minio/create_buckets.sh",
            ],
        )

    def test_build_docker_shellcheck_command_uses_repo_mount(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        script = repo_root / "infra/local/minio/create_buckets.sh"

        self.assertEqual(
            build_docker_shellcheck_command(script, root=repo_root),
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{repo_root}:/work",
                "-w",
                "/work",
                "koalaman/shellcheck:stable",
                "-x",
                "-s",
                "bash",
                "infra/local/minio/create_buckets.sh",
            ],
        )

    @patch("scripts.check_shell_tracked.shutil.which", return_value=shutil.which("shellcheck"))
    def test_validate_shell_file_raises_for_invalid_script(self, _which_mock: str | None) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "broken.sh"
            path.write_text("#!/usr/bin/env bash\nif [\n", encoding="utf-8")
            with self.assertRaises(subprocess.CalledProcessError):
                validate_shell_file(path)

    @patch("scripts.check_shell_tracked.shutil.which")
    @patch("scripts.check_shell_tracked.subprocess.run")
    def test_main_invokes_shellcheck_for_each_tracked_file(
        self,
        run_mock: subprocess.CompletedProcess[str],
        which_mock: unittest.mock.Mock,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        which_mock.side_effect = ["/usr/bin/shellcheck"]
        with patch(
            "scripts.check_shell_tracked.tracked_shell_files",
            return_value=(
                repo_root / "infra/local/minio/create_buckets.sh",
                repo_root / "infra/local/staging/start-execution-control-staging.sh",
            ),
        ):
            run_mock.side_effect = [
                subprocess.CompletedProcess(args=["shellcheck"], returncode=0),
                subprocess.CompletedProcess(args=["shellcheck"], returncode=0),
            ]

            exit_code = main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            [call.args[0] for call in run_mock.call_args_list],
            [
                [
                    "shellcheck",
                    "-x",
                    "-s",
                    "bash",
                    "infra/local/minio/create_buckets.sh",
                ],
                [
                    "shellcheck",
                    "-x",
                    "-s",
                    "bash",
                    "infra/local/staging/start-execution-control-staging.sh",
                ],
            ],
        )
