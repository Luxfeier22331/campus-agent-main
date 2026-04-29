from __future__ import annotations

import json
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_jsonl_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths("*.jsonl", root=base)
        for decoded in [path.relative_to(base).as_posix()]
        if not decoded.startswith(".planning/") and "/vendor/" not in decoded
    )


def validate_jsonl_file(path: Path) -> tuple[str, ...]:
    failures: list[str] = []
    schema = _schema_for_path(path)
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            record = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            failures.append(f"{path}: line {line_number}: JSON parse error: {exc.msg}")
            continue
        if not isinstance(record, dict):
            failures.append(f"{path}: line {line_number}: must decode to a JSON object")
            continue
        if schema is not None:
            failures.extend(_validate_record_schema(path, line_number, record, schema))
    return tuple(failures)


def _schema_for_path(path: Path) -> tuple[str, ...] | None:
    name = path.name
    if "provider-result" in name:
        return ("logId", "result")
    if "layout-elements" in name:
        return ("schema_version", "row_id", "row_type", "page_start", "page_end")
    if name.endswith(".structured.jsonl"):
        return (
            "doc_id",
            "version_id",
            "chunk_id",
            "clean_text",
            "page_start",
            "page_end",
            "source",
            "acl",
        )
    return None


def _validate_record_schema(
    path: Path, line_number: int, record: dict[str, object], schema: tuple[str, ...]
) -> list[str]:
    for key in schema:
        if key not in record:
            return [f"{path}: line {line_number}: missing required key '{key}'"]

    failures: list[str] = []
    if "logId" in schema and "logId" in record and not _is_nonempty_string(record["logId"]):
        failures.append(f"{path}: line {line_number}: key 'logId' must be a non-empty string")
    if "result" in schema and "result" in record and not isinstance(record["result"], dict):
        failures.append(f"{path}: line {line_number}: key 'result' must decode to a JSON object")
    if (
        "clean_text" in schema
        and "clean_text" in record
        and not _is_nonempty_string(record["clean_text"])
    ):
        failures.append(f"{path}: line {line_number}: key 'clean_text' must be a non-empty string")
    if "source" in schema and "source" in record and not isinstance(record["source"], dict):
        failures.append(f"{path}: line {line_number}: key 'source' must decode to a JSON object")
    if "acl" in schema and "acl" in record and not isinstance(record["acl"], dict):
        failures.append(f"{path}: line {line_number}: key 'acl' must decode to a JSON object")
    return failures


def _is_nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def main() -> int:
    failures: list[str] = []
    files = tracked_jsonl_files()
    for path in files:
        failures.extend(validate_jsonl_file(path))
    if failures:
        print("JSONL structure check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} JSONL files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
