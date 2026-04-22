from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from scripts.env_sync import parse_env_file, resolve_source_env_path

SENTRY_API_TOKEN_KEY = "SENTRY_API_TOKEN"


class SentryApiRequestError(RuntimeError):
    def __init__(self, *, url: str, status_code: int | None, body: str) -> None:
        self.url = url
        self.status_code = status_code
        self.body = body
        message = f"Sentry API request failed for {url}"
        if status_code is not None:
            message += f" (status={status_code})"
        if body:
            message += f": {body}"
        super().__init__(message)


def load_sentry_api_token(
    repo_root: Path,
    source_env_path: Path | None = None,
    env: Mapping[str, str] | None = None,
) -> tuple[str, str, Path]:
    source_path = source_env_path or resolve_source_env_path(repo_root)
    process_env = env or {}
    process_value = process_env.get(SENTRY_API_TOKEN_KEY, "").strip()
    if process_value:
        return process_value, "process_env", source_path

    if not source_path.exists():
        raise FileNotFoundError(f"Source env file not found: {source_path}")

    source_values = parse_env_file(source_path)
    source_value = source_values.get(SENTRY_API_TOKEN_KEY, "").strip()
    if not source_value:
        raise ValueError(f"Missing required env value in source env: {SENTRY_API_TOKEN_KEY}")
    return source_value, "source_env", source_path


def fetch_json(url: str, token: str) -> Any:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "campus-agent/sentry-lookup-check",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SentryApiRequestError(url=url, status_code=exc.code, body=body) from exc
    except URLError as exc:
        raise SentryApiRequestError(url=url, status_code=None, body=str(exc.reason)) from exc


def _normalize_org(org: Mapping[str, Any]) -> dict[str, str | None]:
    return {
        "id": str(org.get("id")) if org.get("id") is not None else None,
        "name": str(org.get("name")) if org.get("name") is not None else None,
        "slug": str(org.get("slug")) if org.get("slug") is not None else None,
    }


def _normalize_project(project: Mapping[str, Any]) -> dict[str, str | None]:
    return {
        "id": str(project.get("id")) if project.get("id") is not None else None,
        "name": str(project.get("name")) if project.get("name") is not None else None,
        "platform": str(project.get("platform")) if project.get("platform") is not None else None,
        "slug": str(project.get("slug")) if project.get("slug") is not None else None,
    }


def probe_sentry_lookup_access(
    repo_root: Path,
    source_env_path: Path | None = None,
    base_url: str = "https://sentry.io",
    org_slug: str | None = None,
    env: Mapping[str, str] | None = None,
    fetch_json: Callable[[str, str], Any] = fetch_json,
) -> dict[str, Any]:
    token, token_source, source_path = load_sentry_api_token(
        repo_root=repo_root,
        source_env_path=source_env_path,
        env=env,
    )
    api_root = base_url.rstrip("/")
    organizations_data = fetch_json(f"{api_root}/api/0/organizations/", token)
    organizations = [_normalize_org(org) for org in organizations_data]

    selected_org_slug = org_slug.strip() if org_slug else None
    org_slug_required = False
    projects: list[dict[str, str | None]] = []

    if selected_org_slug is None:
        discovered_slugs = [org["slug"] for org in organizations if org.get("slug")]
        if len(discovered_slugs) == 1:
            selected_org_slug = str(discovered_slugs[0])
        elif len(discovered_slugs) > 1:
            org_slug_required = True

    if selected_org_slug:
        projects_data = fetch_json(
            f"{api_root}/api/0/organizations/{selected_org_slug}/projects/",
            token,
        )
        projects = [_normalize_project(project) for project in projects_data]

    return {
        "base_url": api_root,
        "org_count": len(organizations),
        "org_slug_required": org_slug_required,
        "organizations": organizations,
        "project_count": len(projects),
        "projects": projects,
        "selected_org_slug": selected_org_slug,
        "source_env_path": str(source_path),
        "token_env_key": SENTRY_API_TOKEN_KEY,
        "token_source": token_source,
    }


def render_markdown_report(status: Mapping[str, Any]) -> str:
    lines = [
        "# Sentry Lookup Access",
        "",
        "## Token",
        f"- Env key: `{status['token_env_key']}`",
        f"- Token source: `{status['token_source']}`",
        f"- Source env path: `{status['source_env_path']}`",
        f"- Base URL: `{status['base_url']}`",
        "",
        "## Organizations",
        f"- Count: `{status['org_count']}`",
    ]
    if status["selected_org_slug"]:
        lines.append(f"- Selected org: `{status['selected_org_slug']}`")
    if status["org_slug_required"]:
        lines.append("- `--org-slug` required because multiple organizations are visible")
    for organization in status["organizations"]:
        lines.append(f"- `{organization['slug']}` ({organization['name'] or 'unknown-name'})")

    lines.extend(
        [
            "",
            "## Projects",
            f"- Count: `{status['project_count']}`",
        ]
    )
    for project in status["projects"]:
        platform = project["platform"] or "unknown-platform"
        lines.append(f"- `{project['slug']}` (`{platform}`)")

    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Probe repo-local Sentry API lookup access using root .env SENTRY_API_TOKEN "
            "without changing Worker runtime ownership."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--source-env",
        type=Path,
        default=None,
        help="Optional explicit source .env path. Defaults to the root worktree .env.",
    )
    parser.add_argument(
        "--base-url",
        default="https://sentry.io",
        help="Sentry base URL. Defaults to https://sentry.io.",
    )
    parser.add_argument(
        "--org-slug",
        default=None,
        help="Optional explicit organization slug when the token can access multiple orgs.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the status report as JSON.",
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=None,
        help="Optional path to write a markdown report suitable for smoke artifacts.",
    )
    return parser.parse_args()


def _print_text_report(status: Mapping[str, Any]) -> None:
    print(f"token_env_key={status['token_env_key']}")
    print(f"token_source={status['token_source']}")
    print(f"source_env_path={status['source_env_path']}")
    print(f"base_url={status['base_url']}")
    print(f"org_count={status['org_count']}")
    if status["selected_org_slug"]:
        print(f"selected_org_slug={status['selected_org_slug']}")
    if status["org_slug_required"]:
        print("org_slug_required=true")
    for organization in status["organizations"]:
        print(
            "org="
            + ":".join(
                [
                    str(organization.get("slug") or ""),
                    str(organization.get("id") or ""),
                    str(organization.get("name") or ""),
                ]
            )
        )
    print(f"project_count={status['project_count']}")
    for project in status["projects"]:
        print(
            "project="
            + ":".join(
                [
                    str(project.get("slug") or ""),
                    str(project.get("id") or ""),
                    str(project.get("platform") or ""),
                ]
            )
        )


def main() -> int:
    args = parse_args()
    status = probe_sentry_lookup_access(
        repo_root=args.repo_root.resolve(),
        source_env_path=args.source_env.resolve() if args.source_env else None,
        base_url=args.base_url,
        org_slug=args.org_slug,
    )
    if args.json:
        print(json.dumps(status, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        _print_text_report(status)
    if args.markdown_output:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(render_markdown_report(status), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
