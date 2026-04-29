from __future__ import annotations

from pathlib import Path

SHARED_POSTGRES_ENV_KEY = "CAMPUS_SHARED_POSTGRES_URL"
SHARED_POSTGRES_OPERATOR_ENV_KEY = "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"
SHARED_POSTGRES_MANAGEMENT_ENV_KEY = "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL"


def resolve_source_env_path(repo_root: Path) -> Path:
    if repo_root.parent.name == ".worktrees":
        return repo_root.parent.parent / ".env"
    return repo_root / ".env"


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def replace_or_append_env_values(existing_text: str, assignments: dict[str, str]) -> str:
    pending = dict(assignments)
    output_lines: list[str] = []

    for raw_line in existing_text.splitlines():
        if "=" not in raw_line:
            output_lines.append(raw_line)
            continue

        key, _ = raw_line.split("=", 1)
        normalized_key = key.strip()
        if normalized_key in pending:
            output_lines.append(f"{normalized_key}={pending.pop(normalized_key)}")
        else:
            output_lines.append(raw_line)

    for key, value in pending.items():
        output_lines.append(f"{key}={value}")

    return "\n".join(output_lines) + "\n"


def load_target_seed(target_path: Path) -> str:
    if target_path.exists():
        return target_path.read_text(encoding="utf-8")

    example_path = target_path.with_name(f"{target_path.name}.example")
    if example_path.exists():
        return example_path.read_text(encoding="utf-8")

    return ""


def require_env_value(source_values: dict[str, str], key: str) -> str:
    value = source_values.get(key, "").strip()
    if not value:
        raise ValueError(f"Missing required env value in source env: {key}")
    return value
