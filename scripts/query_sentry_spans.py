from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from scripts.check_sentry_lookup_access import load_sentry_api_token

DEFAULT_DATASET = "spans"
DEFAULT_FIELDS = (
    "trace",
    "span.op",
    "span.description",
    "timestamp",
    "id",
    "project.name",
)
DEFAULT_PER_PAGE = 20
DEFAULT_SORT = "-timestamp"


def build_sentry_spans_query_url(
    *,
    base_url: str,
    org_slug: str,
    dataset: str = DEFAULT_DATASET,
    fields: Sequence[str] = DEFAULT_FIELDS,
    project_ids: Sequence[str] = (),
    environment: str | None = None,
    stats_period: str = "14d",
    sort: str = DEFAULT_SORT,
    per_page: int = DEFAULT_PER_PAGE,
    query: str | None = None,
) -> str:
    params: list[tuple[str, str | int]] = [("dataset", dataset)]
    for field in fields:
        params.append(("field", field))
    for project_id in project_ids:
        params.append(("project", project_id))
    if environment:
        params.append(("environment", environment))
    if stats_period:
        params.append(("statsPeriod", stats_period))
    if sort:
        params.append(("sort", sort))
    params.append(("per_page", per_page))
    if query:
        params.append(("query", query))

    return f"{base_url.rstrip('/')}/api/0/organizations/{org_slug}/events/?{urlencode(params)}"


def query_sentry_spans(
    *,
    repo_root: Path,
    org_slug: str,
    source_env_path: Path | None = None,
    base_url: str = "https://sentry.io",
    project_ids: Sequence[str] = (),
    environment: str | None = None,
    stats_period: str = "14d",
    sort: str = DEFAULT_SORT,
    per_page: int = DEFAULT_PER_PAGE,
    query: str | None = None,
    fields: Sequence[str] = DEFAULT_FIELDS,
    fetch_json_impl: Callable[[str, str], Any] | None = None,
    fetch_json: Callable[[str, str], Any] | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    token, token_source, source_path = load_sentry_api_token(
        repo_root=repo_root,
        source_env_path=source_env_path,
        env=env,
    )
    query_url = build_sentry_spans_query_url(
        base_url=base_url,
        org_slug=org_slug,
        fields=fields,
        project_ids=project_ids,
        environment=environment,
        stats_period=stats_period,
        sort=sort,
        per_page=per_page,
        query=query,
    )
    query_impl = fetch_json_impl or fetch_json or globals()["fetch_json"]
    payload = query_impl(query_url, token)
    rows = payload.get("data", []) if isinstance(payload, Mapping) else []
    meta = payload.get("meta", {}) if isinstance(payload, Mapping) else {}

    return {
        "api_url": query_url,
        "base_url": base_url.rstrip("/"),
        "dataset": DEFAULT_DATASET,
        "environment": environment,
        "fields": list(fields),
        "meta": meta,
        "org_slug": org_slug,
        "per_page": per_page,
        "projects": list(project_ids),
        "query": query,
        "row_count": len(rows),
        "rows": rows,
        "sort": sort,
        "source_env_path": str(source_path),
        "stats_period": stats_period,
        "token_env_key": "SENTRY_API_TOKEN",
        "token_source": token_source,
    }


def render_markdown_report(status: Mapping[str, Any]) -> str:
    projects = status.get("projects") or []
    lines = [
        "# Sentry Span Query",
        "",
        "## Token",
        f"- Env key: `{status['token_env_key']}`",
        f"- Token source: `{status['token_source']}`",
        f"- Source env path: `{status['source_env_path']}`",
        "",
        "## Query Inputs",
        f"- Org: `{status['org_slug']}`",
        f"- Dataset: `{status['dataset']}`",
        f"- Environment: `{status['environment'] or 'all'}`",
        f"- Projects: {', '.join(f'`{project}`' for project in projects) if projects else '`all visible`'}",
        f"- Stats period: `{status['stats_period']}`",
        f"- Sort: `{status['sort']}`",
        f"- Per page: `{status['per_page']}`",
        f"- Query: `{status['query'] or '*'}`",
        f"- API URL: `{status['api_url']}`",
        "",
        "## Rows",
        f"- Row count: `{status['row_count']}`",
    ]

    rows = status.get("rows") or []
    if rows:
        lines.extend(
            [
                "",
                "| Project | Description | Op | Trace | Timestamp | Span ID |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for row in rows:
            lines.append(
                "| "
                + " | ".join(
                    [
                        f"`{row.get('project.name', '')}`",
                        f"`{row.get('span.description', '')}`",
                        f"`{row.get('span.op', '')}`",
                        f"`{row.get('trace', '')}`",
                        f"`{row.get('timestamp', '')}`",
                        f"`{row.get('id', '')}`",
                    ]
                )
                + " |"
            )

    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Query Sentry Explore spans using repo-local SENTRY_API_TOKEN so staging "
            "observability evidence can be captured without broad issue-search scopes."
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
        required=True,
        help="Target Sentry organization slug.",
    )
    parser.add_argument(
        "--project",
        action="append",
        default=[],
        help="Optional project id or slug filter. Repeat for multiple projects.",
    )
    parser.add_argument(
        "--environment",
        default=None,
        help="Optional environment filter, for example staging.",
    )
    parser.add_argument(
        "--stats-period",
        default="14d",
        help="Sentry statsPeriod value. Defaults to 14d.",
    )
    parser.add_argument(
        "--sort",
        default=DEFAULT_SORT,
        help=f"Explore sort expression. Defaults to {DEFAULT_SORT}.",
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=DEFAULT_PER_PAGE,
        help=f"Number of rows to request. Defaults to {DEFAULT_PER_PAGE}.",
    )
    parser.add_argument(
        "--query",
        default=None,
        help="Optional explore query expression.",
    )
    parser.add_argument(
        "--field",
        action="append",
        default=None,
        help="Optional field selection. Repeat for multiple fields.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full query result as JSON.",
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=None,
        help="Optional path to write a markdown report suitable for smoke artifacts.",
    )
    return parser.parse_args()


def _print_text_report(status: Mapping[str, Any]) -> None:
    print(f"org_slug={status['org_slug']}")
    print(f"dataset={status['dataset']}")
    print(f"environment={status['environment'] or ''}")
    print(f"row_count={status['row_count']}")
    print(f"api_url={status['api_url']}")
    for row in status["rows"]:
        print(
            "row="
            + ":".join(
                [
                    str(row.get("project.name") or ""),
                    str(row.get("span.description") or ""),
                    str(row.get("span.op") or ""),
                    str(row.get("trace") or ""),
                    str(row.get("timestamp") or ""),
                    str(row.get("id") or ""),
                ]
            )
        )


def main() -> int:
    args = parse_args()
    status = query_sentry_spans(
        repo_root=args.repo_root.resolve(),
        source_env_path=args.source_env.resolve() if args.source_env else None,
        base_url=args.base_url,
        org_slug=args.org_slug,
        project_ids=args.project,
        environment=args.environment,
        stats_period=args.stats_period,
        sort=args.sort,
        per_page=args.per_page,
        query=args.query,
        fields=args.field or DEFAULT_FIELDS,
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
