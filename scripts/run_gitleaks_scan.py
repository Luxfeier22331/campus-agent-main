from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GITLEAKS_VERSION = "v8.30.1"
GITLEAKS_INSTALL_COMMAND = f"go install github.com/zricethezav/gitleaks/v8@{GITLEAKS_VERSION}"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _git_scannable_files(base: Path) -> list[Path]:
    result = subprocess.run(
        (
            "git",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ),
        cwd=base,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(stderr or "git ls-files failed")

    files: list[Path] = []
    stdout = result.stdout.decode("utf-8", errors="surrogateescape")
    for raw_path in stdout.split("\0"):
        if not raw_path:
            continue
        relative_path = Path(raw_path)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise RuntimeError(f"refusing unsafe git path: {raw_path}")
        files.append(relative_path)
    return files


def _copy_scannable_files(*, base: Path, files: list[Path], scan_root: Path) -> None:
    for relative_path in files:
        source = base / relative_path
        if not source.exists() and not source.is_symlink():
            continue
        target = scan_root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target, follow_symlinks=False)


def run_gitleaks_scan(*, root: Path | None = None) -> int:
    if shutil.which("gitleaks") is None:
        print(
            "gitleaks CLI is required for pnpm ci:secrets. "
            f"Install it with: {GITLEAKS_INSTALL_COMMAND}",
            file=sys.stderr,
        )
        return 127
    base = root or repo_root()
    try:
        scannable_files = _git_scannable_files(base)
    except RuntimeError as exc:
        print(f"Unable to enumerate files for pnpm ci:secrets: {exc}", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="campus-agent-gitleaks-") as tmp_dir:
        scan_root = Path(tmp_dir) / "scan"
        scan_root.mkdir()
        _copy_scannable_files(base=base, files=scannable_files, scan_root=scan_root)
        return subprocess.run(
            (
                "gitleaks",
                "dir",
                "--config",
                str((base / ".gitleaks.toml").resolve()),
                "--redact",
                "--no-banner",
                ".",
            ),
            cwd=scan_root,
            check=False,
        ).returncode


def main() -> int:
    return run_gitleaks_scan()


if __name__ == "__main__":
    raise SystemExit(main())
