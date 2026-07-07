from __future__ import annotations

import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

from scripts.check_env_surface_policy import _iter_env_keys
from scripts.check_worker_secret_presence import load_required_worker_secrets

DEFAULT_WORKER_CONFIG_PATTERN = "apps/*/wrangler*.toml"
_SECRET_LIKE_KEY_PATTERN = re.compile(
    r"(SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|DSN|TOKEN|SALT)",
    re.IGNORECASE,
)
_PUBLIC_ALLOWED_SECRET_LIKE_KEYS = {
    # Cloudflare Access service-token ids are identifiers used for allowlisting,
    # not token secret material.
    "OPERATOR_CONSOLE_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST",
}


@dataclass(frozen=True, slots=True)
class WorkerConfigIssue:
    path: str
    message: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def audit_worker_config_surface(*, root: Path | None = None) -> tuple[WorkerConfigIssue, ...]:
    base = root or repo_root()
    issues: list[WorkerConfigIssue] = []
    wrangler_paths = tuple(sorted(base.glob(DEFAULT_WORKER_CONFIG_PATTERN)))
    for wrangler_path in wrangler_paths:
        issues.extend(_audit_wrangler_vars(wrangler_path, base=base))

    for app_dir in sorted({path.parent for path in wrangler_paths}):
        dev_vars = app_dir / ".dev.vars.example"
        if not dev_vars.exists():
            continue
        app_wrangler_paths = tuple(path for path in wrangler_paths if path.parent == app_dir)
        issues.extend(_audit_dev_vars(dev_vars, app_wrangler_paths, base=base))
    return tuple(issues)


def _audit_wrangler_vars(path: Path, *, base: Path) -> tuple[WorkerConfigIssue, ...]:
    relative = path.relative_to(base).as_posix()
    try:
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        return (WorkerConfigIssue(path=relative, message=f"invalid TOML: {exc}"),)
    issues: list[WorkerConfigIssue] = []
    for scope_name, vars_payload in _iter_wrangler_var_tables(payload):
        for key in vars_payload:
            if _is_secret_like_key(key) and key not in _PUBLIC_ALLOWED_SECRET_LIKE_KEYS:
                issues.append(
                    WorkerConfigIssue(
                        path=relative,
                        message=f"{scope_name}.vars contains secret-like key {key}; use secrets.required",
                    )
                )
    return tuple(issues)


def _audit_dev_vars(
    path: Path, wrangler_paths: tuple[Path, ...], *, base: Path
) -> tuple[WorkerConfigIssue, ...]:
    relative = path.relative_to(base).as_posix()
    issues: list[WorkerConfigIssue] = []
    required: set[str] = set()
    for wrangler_path in wrangler_paths:
        required.update(
            load_required_worker_secrets(wrangler_config_path=wrangler_path, env_name=None)[1]
        )
        required.update(
            load_required_worker_secrets(wrangler_config_path=wrangler_path, env_name="local")[1]
        )
    for line_number, key in _iter_env_keys(path):
        if (
            _is_secret_like_key(key)
            and key not in required
            and key not in _PUBLIC_ALLOWED_SECRET_LIKE_KEYS
        ):
            issues.append(
                WorkerConfigIssue(
                    path=relative,
                    message=f"line {line_number}: secret-like key {key} is not declared in local/root secrets.required",
                )
            )
    return tuple(issues)


def _iter_wrangler_var_tables(
    payload: dict[str, object],
) -> tuple[tuple[str, dict[str, object]], ...]:
    tables: list[tuple[str, dict[str, object]]] = []
    root_vars = payload.get("vars")
    if isinstance(root_vars, dict):
        tables.append(("root", root_vars))
    env_payload = payload.get("env")
    if isinstance(env_payload, dict):
        for env_name, raw_env in env_payload.items():
            if not isinstance(raw_env, dict):
                continue
            vars_payload = raw_env.get("vars")
            if isinstance(vars_payload, dict):
                tables.append((f"env.{env_name}", vars_payload))
    return tuple(tables)


def _is_secret_like_key(key: str) -> bool:
    return bool(_SECRET_LIKE_KEY_PATTERN.search(key))


def main() -> int:
    issues = audit_worker_config_surface()
    if issues:
        print("Worker config surface check failed:", file=sys.stderr)
        for issue in issues:
            print(f"- {issue.path}: {issue.message}", file=sys.stderr)
        return 1
    print("Validated Worker config surface.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
