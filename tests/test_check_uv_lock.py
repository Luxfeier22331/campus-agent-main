from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from scripts.check_uv_lock import build_uv_lock_check_command, main
except ModuleNotFoundError:  # pragma: no cover - red phase for TDD
    build_uv_lock_check_command = None
    main = None


class CheckUvLockTest(unittest.TestCase):
    def test_build_uv_lock_check_command_uses_offline_check_mode(self) -> None:
        self.assertIsNotNone(build_uv_lock_check_command)
        self.assertEqual(
            build_uv_lock_check_command(),
            ["uv", "lock", "--check", "--offline"],
        )

    @patch("scripts.check_uv_lock.subprocess.run")
    def test_main_invokes_uv_lock_check_at_repo_root(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        self.assertIsNotNone(main)
        repo_root = Path(__file__).resolve().parents[1]
        run_mock.return_value = subprocess.CompletedProcess(args=["uv"], returncode=0)

        exit_code = main(root=repo_root)

        self.assertEqual(exit_code, 0)
        self.assertEqual(run_mock.call_args.args[0], build_uv_lock_check_command())
        self.assertEqual(run_mock.call_args.kwargs["cwd"], repo_root)
