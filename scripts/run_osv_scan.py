from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

OSV_SCANNER_VERSION = "v2.3.8"
OSV_SCANNER_INSTALL_COMMAND = (
    f"go install github.com/google/osv-scanner/v2/cmd/osv-scanner@{OSV_SCANNER_VERSION}"
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def run_osv_scan(*, root: Path | None = None) -> int:
    if shutil.which("osv-scanner") is None:
        print(
            "osv-scanner CLI is required for pnpm ci:deps:vuln. "
            f"Install it with: {OSV_SCANNER_INSTALL_COMMAND}",
            file=sys.stderr,
        )
        return 127
    base = root or repo_root()
    return subprocess.run(
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
        cwd=base,
        check=False,
    ).returncode


def main() -> int:
    return run_osv_scan()


if __name__ == "__main__":
    raise SystemExit(main())
