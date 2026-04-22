from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

_EDITORCONFIG_TRACKED_PATHS = (
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    "**/.gitignore",
)
_EDITORCONFIG_EXCLUDES = (
    ".planning/",
    ".tmp/",
    ".worktrees/",
    "node_modules/",
    "apps/public-chat-web/vendor/",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_editorconfig_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", *_EDITORCONFIG_TRACKED_PATHS],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )
    return tuple(
        base / line
        for line in result.stdout.splitlines()
        if line.strip() and not any(line.startswith(prefix) for prefix in _EDITORCONFIG_EXCLUDES)
    )


def editorconfig_checker_binary(*, root: Path | None = None) -> Path:
    base = root or repo_root()
    return base / "node_modules" / ".bin" / "editorconfig-checker"


def _materialize_check_tree(target_dir: Path, files: tuple[Path, ...], *, root: Path) -> None:
    shutil.copy2(root / ".editorconfig", target_dir / ".editorconfig")
    for path in files:
        relative_path = path.relative_to(root)
        destination = target_dir / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def main() -> int:
    root = repo_root()
    files = tracked_editorconfig_files(root=root)
    if not files:
        print("No tracked EditorConfig-managed files matched the live-surface pathspecs.")
        return 0

    binary = editorconfig_checker_binary(root=root)
    if not binary.exists():
        raise FileNotFoundError(
            "editorconfig-checker binary not found; run 'pnpm install' before invoking this lane."
        )

    with tempfile.TemporaryDirectory(prefix="editorconfig-check-") as tmp_dir:
        target_dir = Path(tmp_dir)
        _materialize_check_tree(target_dir, files, root=root)
        completed = subprocess.run([str(binary), "-no-color"], cwd=target_dir)
    if completed.returncode == 0:
        print(f"Validated {len(files)} tracked EditorConfig-managed files.")
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
