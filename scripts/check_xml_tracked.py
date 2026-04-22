from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_xml_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths("*.xml", root=base)
        if not path.relative_to(base).as_posix().startswith(".planning/")
    )


def validate_xml_file(path: Path) -> None:
    ET.parse(path)


def main() -> int:
    failures: list[str] = []
    files = tracked_xml_files()
    for path in files:
        try:
            validate_xml_file(path)
        except (ET.ParseError, OSError) as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")
    if failures:
        print("XML syntax check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} XML files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
