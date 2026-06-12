from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from campus_ingestion_core.structured_projection_postgres import (
    StructuredProjectionReleaseRecord,
    build_structured_projection_publisher_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage structured projection PG release pointers.",
    )
    parser.add_argument("--corpus", default="campus_services")
    parser.add_argument(
        "--collection",
        required=True,
        choices=("service_status", "service_guide", "transport_schedule"),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("current", help="Show the current release pointer.")

    list_parser = subparsers.add_parser("list", help="List recent releases.")
    list_parser.add_argument("--limit", type=int, default=20)

    promote_parser = subparsers.add_parser("promote", help="Promote an existing release.")
    promote_parser.add_argument("--release-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    publisher = build_structured_projection_publisher_from_env()
    if publisher is None:
        raise ValueError("CAMPUS_SHARED_POSTGRES_URL is required")

    if args.command == "current":
        _print_json(
            {
                "corpus": args.corpus,
                "collection": args.collection,
                "release_id": publisher.get_current_release(
                    corpus=args.corpus,
                    collection=args.collection,
                ),
            }
        )
        return
    if args.command == "list":
        _print_json(
            {
                "corpus": args.corpus,
                "collection": args.collection,
                "releases": [
                    _release_record_to_json(record)
                    for record in publisher.list_releases(
                        corpus=args.corpus,
                        collection=args.collection,
                        limit=args.limit,
                    )
                ],
            }
        )
        return
    if args.command == "promote":
        promoted_release_id = publisher.promote_release(
            corpus=args.corpus,
            collection=args.collection,
            release_id=args.release_id,
        )
        _print_json(
            {
                "corpus": args.corpus,
                "collection": args.collection,
                "promoted_release_id": promoted_release_id,
            }
        )
        return
    raise ValueError(f"unsupported command: {args.command}")


def _release_record_to_json(record: StructuredProjectionReleaseRecord) -> dict[str, object]:
    return {
        "release_id": record.release_id,
        "corpus": record.corpus,
        "collection": record.collection,
        "schema_version": record.schema_version,
        "artifact_object_key": record.artifact_object_key,
        "artifact_checksum": record.artifact_checksum,
        "generated_at": record.generated_at,
        "published_at": record.published_at,
        "validation_status": record.validation_status,
        "counts": record.counts,
    }


def _print_json(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
