from __future__ import annotations

import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.run_gitleaks_scan import (
    GITLEAKS_INSTALL_COMMAND,
    run_gitleaks_scan,
)
from scripts.run_osv_scan import OSV_SCANNER_INSTALL_COMMAND, run_osv_scan


class RunSecurityScannersTest(unittest.TestCase):
    def test_gitleaks_wrapper_fails_with_install_hint_when_cli_missing(self) -> None:
        stderr = io.StringIO()
        with (
            tempfile.TemporaryDirectory() as tmp_dir,
            patch("scripts.run_gitleaks_scan.shutil.which", return_value=None),
            patch("scripts.run_gitleaks_scan.subprocess.run") as run_mock,
            patch("scripts.run_gitleaks_scan.sys.stderr", stderr),
        ):
            exit_code = run_gitleaks_scan(root=Path(tmp_dir))

        self.assertEqual(exit_code, 127)
        self.assertIn(GITLEAKS_INSTALL_COMMAND, stderr.getvalue())
        self.assertIn("pnpm ci:secrets", stderr.getvalue())
        run_mock.assert_not_called()

    def test_gitleaks_wrapper_runs_current_tree_scan(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmp_dir,
            patch("scripts.run_gitleaks_scan.shutil.which", return_value="/usr/bin/gitleaks"),
            patch("scripts.run_gitleaks_scan.subprocess.run") as run_mock,
        ):
            root = Path(tmp_dir)
            (root / ".gitleaks.toml").write_text("title = 'test'\n", encoding="utf-8")
            (root / "tracked.txt").write_text("tracked content\n", encoding="utf-8")
            (root / "new.txt").write_text("new content\n", encoding="utf-8")
            (root / "ignored.secret").write_text("ignored secret\n", encoding="utf-8")

            def run_side_effect(
                args: tuple[str, ...], **kwargs: object
            ) -> subprocess.CompletedProcess[bytes]:
                if args[0] == "git":
                    return subprocess.CompletedProcess(
                        args,
                        0,
                        stdout=b"tracked.txt\0new.txt\0",
                        stderr=b"",
                    )

                scan_root = kwargs["cwd"]
                self.assertIsInstance(scan_root, Path)
                self.assertEqual(
                    (scan_root / "tracked.txt").read_text(encoding="utf-8"), "tracked content\n"
                )
                self.assertEqual(
                    (scan_root / "new.txt").read_text(encoding="utf-8"), "new content\n"
                )
                self.assertFalse((scan_root / "ignored.secret").exists())
                return subprocess.CompletedProcess(args, 3)

            run_mock.side_effect = run_side_effect

            exit_code = run_gitleaks_scan(root=root)

        self.assertEqual(exit_code, 3)
        self.assertEqual(run_mock.call_count, 2)
        run_mock.assert_any_call(
            (
                "git",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ),
            cwd=root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        run_mock.assert_any_call(
            (
                "gitleaks",
                "dir",
                "--config",
                str((root / ".gitleaks.toml").resolve()),
                "--redact",
                "--no-banner",
                ".",
            ),
            cwd=run_mock.call_args.kwargs["cwd"],
            check=False,
        )

    def test_osv_wrapper_fails_with_install_hint_when_cli_missing(self) -> None:
        stderr = io.StringIO()
        with (
            tempfile.TemporaryDirectory() as tmp_dir,
            patch("scripts.run_osv_scan.shutil.which", return_value=None),
            patch("scripts.run_osv_scan.subprocess.run") as run_mock,
            patch("scripts.run_osv_scan.sys.stderr", stderr),
        ):
            exit_code = run_osv_scan(root=Path(tmp_dir))

        self.assertEqual(exit_code, 127)
        self.assertIn(OSV_SCANNER_INSTALL_COMMAND, stderr.getvalue())
        self.assertIn("pnpm ci:deps:vuln", stderr.getvalue())
        run_mock.assert_not_called()

    def test_osv_wrapper_runs_source_scan(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmp_dir,
            patch("scripts.run_osv_scan.shutil.which", return_value="/usr/bin/osv-scanner"),
            patch("scripts.run_osv_scan.subprocess.run") as run_mock,
        ):
            run_mock.return_value.returncode = 4

            exit_code = run_osv_scan(root=Path(tmp_dir))

        self.assertEqual(exit_code, 4)
        run_mock.assert_called_once_with(
            (
                "osv-scanner",
                "scan",
                "source",
                "--config",
                "osv-scanner.toml",
                "--format=vertical",
                "--verbosity=error",
                "--lockfile",
                "pnpm-lock.yaml",
                "--lockfile",
                "uv.lock",
            ),
            cwd=Path(tmp_dir),
            check=False,
        )

    def test_install_commands_remain_pinned(self) -> None:
        self.assertEqual(
            GITLEAKS_INSTALL_COMMAND,
            "go install github.com/zricethezav/gitleaks/v8@v8.30.1",
        )
        self.assertEqual(
            OSV_SCANNER_INSTALL_COMMAND,
            "go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.3.8",
        )


if __name__ == "__main__":
    unittest.main()
