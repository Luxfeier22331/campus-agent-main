from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_powershell_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.ps1"],
        check=True,
        capture_output=True,
        cwd=base,
    )
    return tuple(
        base / decoded
        for item in result.stdout.split(b"\0")
        if item and not (decoded := item.decode("utf-8")).startswith(".planning/")
    )


def powershell_parse_command(path: Path) -> list[str]:
    escaped_path = str(path).replace("'", "''")
    parser_script = (
        f"[System.Management.Automation.Language.Parser]::ParseFile('{escaped_path}', [ref]$null, "
        "[ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { "
        "$_.ToString() }; exit 1 }"
    )
    return ["pwsh", "-NoLogo", "-NoProfile", "-Command", parser_script]


def validate_powershell_file(path: Path, *, root: Path | None = None) -> None:
    base = root or repo_root()
    subprocess.run(
        powershell_parse_command(path),
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )


def main() -> int:
    failures: list[str] = []
    files = tracked_powershell_files()
    for path in files:
        try:
            validate_powershell_file(path)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(repo_root())}: {stderr}")
        except OSError as exc:
            failures.append(
                f"{path.relative_to(repo_root())}: {exc}. Install PowerShell ('pwsh') to run this lane locally."
            )
    if failures:
        print("PowerShell syntax check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} tracked PowerShell files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
