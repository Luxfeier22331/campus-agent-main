from __future__ import annotations

import re
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

_KEY_PATTERN = re.compile(r"^[A-Z0-9_]+$")
_ROOT_FORBIDDEN_EXACT_KEYS = frozenset(
    {
        "DOCS_READ_MODEL_MANIFEST_PATH",
        "FEEDWE_API_KEY",
        "RAW_INGESTION_ARTIFACT_MODE",
        "SPECIALIST_PROMPT_MODEL",
        "EXECUTION_GATEWAY_DOCKER_GOPROXY",
        "EXECUTION_GATEWAY_DOCKER_GOSUMDB",
        "EXECUTION_GATEWAY_HOST_PORT",
    }
)
_ROOT_FORBIDDEN_PREFIXES = (
    "AUTHENTICATED_NOTICE_",
    "LEGACY_OFFICE_CONVERSION_",
    "LIBREOFFICE_SERVICE_",
    "OFFICIAL_WEB_RELEASE_TASK_",
    "SUPERVISOR_CORE_WORKER_",
    "WECHAT_OFFICIAL_ACCOUNT_",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_env_example_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(
            "*.env.example",
            "*.local.example",
            "*.dev.vars.example",
            root=base,
        )
        for decoded in [path.relative_to(base).as_posix()]
        if decoded.endswith((".env.example", ".local.example", ".dev.vars.example"))
        and not decoded.startswith(".planning/")
        and "/vendor/" not in decoded
    )


def validate_env_example_file(path: Path) -> tuple[str, ...]:
    seen_keys: set[str] = set()
    failures: list[str] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw_line.strip()
        if stripped.startswith("#") and raw_line.rstrip() != raw_line:
            failures.append(f"{path}:{line_number}: trailing whitespace is not allowed")
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in raw_line:
            failures.append(f"{path}:{line_number}: expected KEY=VALUE entry")
            continue
        key, value = raw_line.split("=", 1)
        if key != key.strip():
            failures.append(f"{path}:{line_number}: key must not contain surrounding whitespace")
            continue
        if not _KEY_PATTERN.fullmatch(key):
            failures.append(f"{path}:{line_number}: invalid env key '{key}'")
            continue
        if key in seen_keys:
            failures.append(f"{path}:{line_number}: duplicate env key '{key}'")
            continue
        if value and value != value.strip():
            failures.append(
                f"{path}:{line_number}: value must not contain leading or trailing whitespace"
            )
        seen_keys.add(key)
    return tuple(failures)


def _iter_env_keys(path: Path) -> tuple[tuple[int, str], ...]:
    keys: list[tuple[int, str]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            continue
        key, _value = raw_line.split("=", 1)
        keys.append((line_number, key.strip()))
    return tuple(keys)


def validate_env_example_ownership(path: Path) -> tuple[str, ...]:
    if path.name != ".env.example" or path.parent != repo_root():
        return ()

    failures: list[str] = []
    for line_number, key in _iter_env_keys(path):
        if key in _ROOT_FORBIDDEN_EXACT_KEYS or key.startswith(_ROOT_FORBIDDEN_PREFIXES):
            failures.append(
                f"{path}:{line_number}: root .env.example must not own app-local, "
                f"command-scoped, or retired key '{key}'"
            )
    return tuple(failures)


def main() -> int:
    failures: list[str] = []
    files = tracked_env_example_files()
    for path in files:
        failures.extend(validate_env_example_file(path))
        failures.extend(validate_env_example_ownership(path))
    if failures:
        print("Env example structure check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} env example files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
