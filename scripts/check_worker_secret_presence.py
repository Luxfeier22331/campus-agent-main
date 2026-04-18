from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import tomllib
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


DEFAULT_APP_PATHS = (
    "apps/app-api",
    "apps/public-chat-web",
    "apps/protected-panel-web",
)

_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_PROXY_ENV_KEYS = (
    "ALL_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "http_proxy",
    "https_proxy",
)
_CLOUDFLARE_NO_PROXY_HOSTS = (
    "api.cloudflare.com",
    "dash.cloudflare.com",
    "localhost",
    "127.0.0.1",
    "::1",
)
DEFAULT_WRANGLER_TIMEOUT_SECONDS = 15


def _normalize_required_secret_names(raw_value: object) -> list[str]:
    if not isinstance(raw_value, list):
        return []

    normalized = {
        item.strip()
        for item in raw_value
        if isinstance(item, str) and item.strip()
    }
    return sorted(normalized)


def load_required_worker_secrets(
    *,
    wrangler_config_path: Path,
    env_name: str | None,
) -> tuple[str | None, list[str]]:
    if not wrangler_config_path.exists():
        raise FileNotFoundError(f"Wrangler config not found: {wrangler_config_path}")

    config = tomllib.loads(wrangler_config_path.read_text(encoding="utf-8"))
    worker_name = config.get("name")
    normalized_worker_name = worker_name.strip() if isinstance(worker_name, str) and worker_name.strip() else None

    if env_name:
        env_config = config.get("env", {})
        selected_env = env_config.get(env_name, {}) if isinstance(env_config, dict) else {}
        secrets_config = selected_env.get("secrets", {}) if isinstance(selected_env, dict) else {}
        return normalized_worker_name, _normalize_required_secret_names(
            secrets_config.get("required") if isinstance(secrets_config, dict) else None
        )

    secrets_config = config.get("secrets", {})
    return normalized_worker_name, _normalize_required_secret_names(
        secrets_config.get("required") if isinstance(secrets_config, dict) else None
    )


def _default_run_command(command: Sequence[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, **kwargs)


def _merge_no_proxy_value(current_value: str | None) -> str:
    entries = {
        entry.strip()
        for entry in str(current_value or "").split(",")
        if entry.strip()
    }
    entries.update(_CLOUDFLARE_NO_PROXY_HOSTS)
    return ",".join(sorted(entries))


def build_cloudflare_cli_env(base_env: Mapping[str, str] | None = None) -> dict[str, str]:
    source_env = dict(base_env or os.environ)
    for key in _PROXY_ENV_KEYS:
        source_env.pop(key, None)

    source_env["NO_PROXY"] = _merge_no_proxy_value(source_env.get("NO_PROXY"))
    source_env["no_proxy"] = _merge_no_proxy_value(source_env.get("no_proxy") or source_env.get("NO_PROXY"))
    return source_env


def build_secret_list_command(*, repo_root: Path, app_path: str, env_name: str | None) -> list[str]:
    app_dir = repo_root / app_path
    command: list[str] = [
        "node",
        str(repo_root / "scripts" / "run-wrangler-command.mjs"),
        "--cwd",
        str(app_dir),
        "secret",
        "list",
    ]
    if env_name:
        command.extend(["--env", env_name])
    command.extend(["--format", "json"])
    return command


def build_secret_put_command(
    *,
    repo_root: Path,
    app_path: str,
    secret_name: str,
    env_name: str | None,
) -> list[str]:
    command: list[str] = [
        "node",
        str(repo_root / "scripts" / "run-wrangler-command.mjs"),
        "--cwd",
        str(repo_root / app_path),
        "secret",
        "put",
        secret_name,
    ]
    if env_name:
        command.extend(["--env", env_name])
    return command


def _sanitize_cli_output(value: str) -> str:
    sanitized = _ANSI_ESCAPE_RE.sub("", value)
    return "\n".join(line.rstrip() for line in sanitized.splitlines()).strip()


def list_configured_worker_secrets(
    *,
    repo_root: Path,
    app_path: str,
    env_name: str | None,
    run_command: Callable[..., subprocess.CompletedProcess[str]],
) -> tuple[list[str], list[str], str]:
    command = build_secret_list_command(repo_root=repo_root, app_path=app_path, env_name=env_name)
    timeout_seconds = int(
        str(os.environ.get("WORKER_SECRET_AUDIT_TIMEOUT_SECONDS", DEFAULT_WRANGLER_TIMEOUT_SECONDS))
    )

    try:
        result = run_command(
            command,
            capture_output=True,
            text=True,
            check=False,
            env=build_cloudflare_cli_env(),
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"wrangler secret list timed out for {app_path} after {timeout_seconds}s"
        ) from exc
    if result.returncode != 0:
        error_parts = []
        stdout = _sanitize_cli_output(result.stdout)
        stderr = _sanitize_cli_output(result.stderr)
        if stdout:
            error_parts.append(stdout)
        if stderr:
            error_parts.append(stderr)
        raise RuntimeError(
            f"wrangler secret list failed for {app_path}: "
            + (" | ".join(error_parts) if error_parts else f"exit_code={result.returncode}")
        )

    payload = json.loads(result.stdout or "[]")
    if not isinstance(payload, list):
        raise ValueError(f"Unexpected wrangler secret list payload for {app_path}: expected list")

    configured_names = sorted(
        {
            item["name"].strip()
            for item in payload
            if isinstance(item, Mapping)
            and isinstance(item.get("name"), str)
            and item["name"].strip()
        }
    )
    return configured_names, command, shlex.join(command)


def collect_worker_secret_presence(
    *,
    repo_root: Path,
    env_name: str | None,
    app_paths: Sequence[str] = DEFAULT_APP_PATHS,
    run_command: Callable[..., subprocess.CompletedProcess[str]] = _default_run_command,
) -> dict[str, object]:
    apps: dict[str, object] = {}

    for app_path in app_paths:
        wrangler_config_path = repo_root / app_path / "wrangler.toml"
        app_status: dict[str, Any] = {
            "app_path": app_path,
            "wrangler_config_path": str(wrangler_config_path),
            "worker_name": None,
            "required_secrets": [],
            "configured_secrets": [],
            "missing_secrets": [],
            "recommended_put_commands": [],
            "audit_command": None,
            "ready": False,
            "error": None,
        }

        try:
            worker_name, required_secrets = load_required_worker_secrets(
                wrangler_config_path=wrangler_config_path,
                env_name=env_name,
            )
            app_status["worker_name"] = worker_name
            app_status["required_secrets"] = required_secrets
            app_status["audit_command"] = shlex.join(
                build_secret_list_command(repo_root=repo_root, app_path=app_path, env_name=env_name)
            )

            if not required_secrets:
                app_status["ready"] = True
                apps[app_path] = app_status
                continue

            configured_secrets, _, audit_command = list_configured_worker_secrets(
                repo_root=repo_root,
                app_path=app_path,
                env_name=env_name,
                run_command=run_command,
            )
            missing_secrets = [
                secret_name for secret_name in required_secrets if secret_name not in configured_secrets
            ]

            app_status["configured_secrets"] = configured_secrets
            app_status["missing_secrets"] = missing_secrets
            app_status["recommended_put_commands"] = [
                shlex.join(
                    build_secret_put_command(
                        repo_root=repo_root,
                        app_path=app_path,
                        secret_name=secret_name,
                        env_name=env_name,
                    )
                )
                for secret_name in missing_secrets
            ]
            app_status["audit_command"] = audit_command
            app_status["ready"] = len(missing_secrets) == 0
        except Exception as exc:  # noqa: BLE001
            app_status["error"] = str(exc)

        apps[app_path] = app_status

    overall_ready = all(bool(app_status["ready"]) for app_status in apps.values())
    return {
        "env": env_name,
        "overall_ready": overall_ready,
        "apps": apps,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Audit whether required Worker secrets for a selected Wrangler environment are "
            "already present in Cloudflare secret store."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--env",
        dest="env_name",
        default="staging",
        help="Wrangler environment name to audit. Defaults to staging.",
    )
    parser.add_argument(
        "--app",
        dest="app_paths",
        action="append",
        default=None,
        help=(
            "Optional relative app path to audit. Can be passed multiple times. "
            "Defaults to the three Worker apps."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the status report as JSON.",
    )
    return parser.parse_args(argv)


def _print_text_report(status: Mapping[str, object]) -> None:
    print(f"env={status['env']}")
    print(f"overall_ready={status['overall_ready']}")

    apps = status["apps"]
    if not isinstance(apps, Mapping):
        return

    for app_path, app_status in apps.items():
        if not isinstance(app_status, Mapping):
            continue
        print(f"{app_path}: ready={app_status['ready']}")
        if app_status.get("worker_name"):
            print(f"{app_path}: worker_name={app_status['worker_name']}")
        if app_status.get("audit_command"):
            print(f"{app_path}: audit_command={app_status['audit_command']}")
        required_secrets = app_status.get("required_secrets") or []
        configured_secrets = app_status.get("configured_secrets") or []
        missing_secrets = app_status.get("missing_secrets") or []
        if required_secrets:
            print(f"{app_path}: required_secrets={','.join(required_secrets)}")
        if configured_secrets:
            print(f"{app_path}: configured_secrets={','.join(configured_secrets)}")
        if missing_secrets:
            print(f"{app_path}: missing_secrets={','.join(missing_secrets)}")
        recommended_put_commands = app_status.get("recommended_put_commands") or []
        for command in recommended_put_commands:
            print(f"{app_path}: recommended_put_command={command}")
        if app_status.get("error"):
            print(f"{app_path}: error={app_status['error']}")


def main(
    argv: Sequence[str] | None = None,
    *,
    run_command: Callable[..., subprocess.CompletedProcess[str]] = _default_run_command,
) -> int:
    args = parse_args(argv)
    status = collect_worker_secret_presence(
        repo_root=args.repo_root.resolve(),
        env_name=args.env_name.strip() if args.env_name else None,
        app_paths=tuple(args.app_paths) if args.app_paths else DEFAULT_APP_PATHS,
        run_command=run_command,
    )
    if args.json:
        print(json.dumps(status, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        _print_text_report(status)
    return 0 if status["overall_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
