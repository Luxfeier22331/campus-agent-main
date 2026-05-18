from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.source_handoff_operator_projection import (
    build_source_handoff_operator_projection,
)
from campus_ingestion_core.source_handoff_store import (
    InMemorySourceHandoffStore,
    SourceHandoffStore,
)


def show_source_handoff_executions(
    *,
    store: SourceHandoffStore,
    limit: int = 100,
    source_channel: str | None = None,
    source_surface: str | None = None,
    include_terminal: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    return build_source_handoff_operator_projection(
        store=store,
        limit=limit,
        source_channel=source_channel,
        source_surface=source_surface,
        include_terminal=include_terminal,
        now=now,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Show operator-safe source handoff execution projection."
    )
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--source-channel", default="")
    parser.add_argument("--source-surface", default="")
    parser.add_argument("--active-only", action="store_true")
    parser.add_argument(
        "--empty-in-memory",
        action="store_true",
        help="Use an empty in-memory store for CLI smoke. Production store wiring is external.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.empty_in_memory:
        raise SystemExit(
            "source handoff store runtime wiring is not configured; pass --empty-in-memory "
            "only for CLI smoke"
        )
    projection = show_source_handoff_executions(
        store=InMemorySourceHandoffStore(),
        limit=args.limit,
        source_channel=args.source_channel or None,
        source_surface=args.source_surface or None,
        include_terminal=not args.active_only,
    )
    print(json.dumps(projection, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["build_parser", "main", "show_source_handoff_executions"]
