from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scripts.check_env_example_tracked import tracked_env_example_files
from scripts.worktree_file_discovery import worktree_paths

_DEFAULT_POLICY_PATH = Path("configs/runtime/env-surface-policy.v1.json")
_ENV_ENTRY_PATTERN = re.compile(r"^([A-Z][A-Z0-9_]*)=")


@dataclass(frozen=True)
class EnvPolicy:
    allowed_templates: frozenset[str]
    key_scopes: dict[str, frozenset[str]]
    prefix_scopes: dict[str, frozenset[str]]
    retired_keys: frozenset[str]
    retired_scan_paths: tuple[str, ...]
    template_key_limits: dict[str, int]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_env_surface_policy(path: Path) -> EnvPolicy:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schema_version") != "campus_env_surface_policy.v1":
        raise ValueError("env surface policy schema_version must be campus_env_surface_policy.v1")
    keys = raw.get("keys", {})
    if not isinstance(keys, dict):
        raise ValueError("env surface policy keys must be an object")
    prefixes = raw.get("allowed_prefixes", {})
    if not isinstance(prefixes, dict):
        raise ValueError("env surface policy allowed_prefixes must be an object")
    template_limits = raw.get("template_key_limits", {})
    if not isinstance(template_limits, dict):
        raise ValueError("env surface policy template_key_limits must be an object")

    key_scopes: dict[str, frozenset[str]] = {}
    retired_keys: set[str] = set()
    for key, spec in keys.items():
        if not isinstance(key, str) or not key:
            raise ValueError("env surface policy key names must be non-empty strings")
        if not isinstance(spec, dict):
            raise ValueError(f"env surface policy key {key} must be an object")
        if bool(spec.get("retired", False)):
            retired_keys.add(key)
        scopes = spec.get("scopes", ())
        if not isinstance(scopes, list) or not all(isinstance(item, str) for item in scopes):
            raise ValueError(f"env surface policy key {key} scopes must be a string list")
        key_scopes[key] = frozenset(scopes)

    prefix_scopes: dict[str, frozenset[str]] = {}
    for prefix, scopes in prefixes.items():
        if not isinstance(prefix, str) or not prefix:
            raise ValueError("env surface policy prefixes must be non-empty strings")
        if not isinstance(scopes, list) or not all(isinstance(item, str) for item in scopes):
            raise ValueError(f"env surface policy prefix {prefix} scopes must be a string list")
        prefix_scopes[prefix] = frozenset(scopes)

    allowed_templates = raw.get("allowed_templates", ())
    retired_scan_paths = raw.get("retired_scan_paths", [])
    return EnvPolicy(
        allowed_templates=frozenset(_string_list(allowed_templates, "allowed_templates")),
        key_scopes=key_scopes,
        prefix_scopes=prefix_scopes,
        retired_keys=frozenset(retired_keys),
        retired_scan_paths=tuple(_string_list(retired_scan_paths, "retired_scan_paths")),
        template_key_limits={
            str(name): _positive_int(limit, f"template_key_limits.{name}")
            for name, limit in template_limits.items()
        },
    )


def audit_env_surface_policy(
    *,
    root: Path | None = None,
    policy_path: Path | None = None,
) -> tuple[str, ...]:
    base = root or repo_root()
    resolved_policy_path = policy_path or base / _DEFAULT_POLICY_PATH
    policy = load_env_surface_policy(resolved_policy_path)
    failures: list[str] = []
    for template_path in _env_template_files(base):
        relative_path = template_path.relative_to(base).as_posix()
        scope = _template_scope(relative_path)
        if relative_path not in policy.allowed_templates:
            failures.append(
                f"{template_path}: env template is not registered in env surface policy"
            )
            continue
        env_keys = tuple(_iter_env_keys(template_path))
        limit = policy.template_key_limits.get(relative_path)
        if limit is not None and len(env_keys) > limit:
            failures.append(
                f"{template_path}: declares {len(env_keys)} env keys, exceeds policy limit {limit}"
            )
        for line_number, key in env_keys:
            if key in policy.retired_keys:
                failures.append(f"{template_path}:{line_number}: retired env key '{key}'")
                continue
            if not _key_allowed_for_scope(key, scope, policy):
                failures.append(
                    f"{template_path}:{line_number}: unregistered env key '{key}' for scope '{scope}'"
                )
    failures.extend(_audit_retired_key_text(base, policy))
    return tuple(failures)


def main() -> int:
    try:
        failures = audit_env_surface_policy()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Env surface policy check failed to load policy: {exc}", file=sys.stderr)
        return 1
    if failures:
        print("Env surface policy check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Validated env surface policy.")
    return 0


def _env_template_files(root: Path) -> tuple[Path, ...]:
    if (root / ".git").exists():
        return tracked_env_example_files(root=root)
    return tuple(
        sorted(
            path
            for pattern in ("*.env.example", "*.dev.vars.example", "*.local.example")
            for path in root.rglob(pattern)
            if "/vendor/" not in path.as_posix()
        )
    )


def _iter_env_keys(path: Path) -> tuple[tuple[int, str], ...]:
    keys: list[tuple[int, str]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        match = _ENV_ENTRY_PATTERN.match(raw_line)
        if match:
            keys.append((line_number, match.group(1)))
    return tuple(keys)


def _template_scope(relative_path: str) -> str:
    if relative_path == ".env.example":
        return "root"
    if relative_path.startswith("env/commands/"):
        return "command"
    if relative_path.startswith("infra/"):
        return "infra"
    if relative_path.startswith("apps/"):
        return relative_path.split("/", 2)[1]
    return "unknown"


def _key_allowed_for_scope(key: str, scope: str, policy: EnvPolicy) -> bool:
    if scope in policy.key_scopes.get(key, frozenset()):
        return True
    return any(
        key.startswith(prefix) and scope in scopes
        for prefix, scopes in policy.prefix_scopes.items()
    )


def _audit_retired_key_text(root: Path, policy: EnvPolicy) -> tuple[str, ...]:
    if not policy.retired_keys:
        return ()
    failures: list[str] = []
    for relative_path in _retired_scan_files(root, policy):
        path = root / relative_path
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for key in sorted(policy.retired_keys):
            if key in text:
                failures.append(f"{path}: retired env key '{key}' appears in tracked text")
    return tuple(failures)


def _retired_scan_files(root: Path, policy: EnvPolicy) -> tuple[str, ...]:
    if not (root / ".git").exists():
        return ()
    patterns = tuple(policy.retired_scan_paths)
    return tuple(
        path.relative_to(root).as_posix()
        for path in worktree_paths(*patterns, root=root)
        if path.is_file()
        and "/node_modules/" not in path.as_posix()
        and "/vendor/" not in path.as_posix()
        and "/.git/" not in path.as_posix()
    )


def _string_list(value: Any, name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"env surface policy {name} must be a string list")
    return tuple(value)


def _positive_int(value: Any, name: str) -> int:
    if not isinstance(value, int) or value < 1:
        raise ValueError(f"env surface policy {name} must be a positive integer")
    return value


if __name__ == "__main__":
    raise SystemExit(main())
