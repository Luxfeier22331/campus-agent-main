from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def build_uv_lock_check_command() -> list[str]:
    return ["uv", "lock", "--check", "--offline"]


def main(*, root: Path | None = None) -> int:
    base = root or repo_root()
    if not (base / "uv.lock").exists():
        print("uv lock integrity check failed:", file=sys.stderr)
        print("- uv.lock: missing repo root uv.lock", file=sys.stderr)
        return 1
    try:
        subprocess.run(
            build_uv_lock_check_command(),
            check=True,
            capture_output=True,
            text=True,
            cwd=base,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", None) or getattr(exc, "stdout", None) or str(exc)
        print("uv lock integrity check failed:", file=sys.stderr)
        print(f"- uv.lock: {str(detail).strip()}", file=sys.stderr)
        return 1
    print("Validated repo root uv.lock.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
