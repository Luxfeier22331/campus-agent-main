from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

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
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_editorconfig_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*_EDITORCONFIG_TRACKED_PATHS, root=base)
        for line in [path.relative_to(base).as_posix()]
        if not any(line.startswith(prefix) for prefix in _EDITORCONFIG_EXCLUDES)
        if path.exists()
    )


def editorconfig_checker_binary(*, root: Path | None = None) -> Path:
    base = root or repo_root()
    return base / "node_modules" / ".bin" / "editorconfig-checker"


def _materialize_check_tree(target_dir: Path, files: tuple[Path, ...], *, root: Path) -> None:
    shutil.copy2(root / ".editorconfig", target_dir / ".editorconfig")
    for path in files:
        if not path.exists():
            continue
        relative_path = path.relative_to(root)
        destination = target_dir / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def main() -> int:
    root = repo_root()
    files = tracked_editorconfig_files(root=root)
    if not files:
        print("No current-worktree EditorConfig-managed files matched the live-surface pathspecs.")
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
        print(f"Validated {len(files)} EditorConfig-managed files from current worktree.")
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
