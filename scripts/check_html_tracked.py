from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

import html5lib

from scripts.worktree_file_discovery import worktree_paths

_HTML_TRACKED_PATHS = ("*.html", "apps/**/*.html", "jobs/**/*.html")
_HTML_EXCLUDE_PREFIXES = (".planning/", ".tmp/", ".worktrees/")
_HTML_EXCLUDE_SEGMENTS = ("/vendor/", "/node_modules/")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_html_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*_HTML_TRACKED_PATHS, root=base)
        if _is_tracked_html_candidate(path.relative_to(base).as_posix())
    )


def _is_tracked_html_candidate(path: str) -> bool:
    return (
        path.endswith(".html")
        and not path.startswith(_HTML_EXCLUDE_PREFIXES)
        and not any(segment in path for segment in _HTML_EXCLUDE_SEGMENTS)
    )


def validate_html_file(path: Path) -> tuple[str, ...]:
    parser = html5lib.HTMLParser(strict=False)
    content = path.read_text(encoding="utf-8")
    document = parser.parse(content)
    errors = [_format_parse_error(error) for error in parser.errors]
    errors.extend(_validate_document_structure(content, document))
    return tuple(errors)


def _validate_document_structure(content: str, document: ElementTree.Element) -> list[str]:
    errors: list[str] = []
    normalized_content = content.lower()
    if not normalized_content.lstrip().startswith("<!doctype html>"):
        errors.append("missing <!doctype html> declaration")

    tag_counts = Counter(_local_name(element.tag) for element in document.iter())
    if tag_counts["html"] != 1:
        errors.append(f"expected exactly one <html> element, found {tag_counts['html']}")
    if tag_counts["head"] != 1 and "<head" in normalized_content:
        errors.append(f"expected exactly one <head> element, found {tag_counts['head']}")
    if tag_counts["body"] != 1:
        errors.append(f"expected exactly one <body> element, found {tag_counts['body']}")

    if "<head" not in normalized_content:
        errors.append("missing <head> element")
        errors.append("missing non-empty <title> element")
        return errors

    head = next(
        (element for element in document.iter() if _local_name(element.tag) == "head"), None
    )
    if head is None:
        errors.append("missing <head> element")
        errors.append("missing non-empty <title> element")
        return errors

    title = next((element for element in head if _local_name(element.tag) == "title"), None)
    if title is None or not "".join(title.itertext()).strip():
        errors.append("missing non-empty <title> element")
    return errors


def _local_name(tag: str) -> str:
    return tag.rsplit("}", maxsplit=1)[-1]


def _format_parse_error(error: tuple[tuple[int, int], str, dict[str, object]]) -> str:
    (line, column), message, _details = error
    return f"line {line}, column {column}: {message}"


def main() -> int:
    failures: list[str] = []
    files = tracked_html_files()
    for path in files:
        try:
            errors = validate_html_file(path)
        except OSError as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")
            continue
        if errors:
            for error in errors:
                failures.append(f"{path.relative_to(repo_root())}: {error}")
    if failures:
        print("HTML structure check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} HTML files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
