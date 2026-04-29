from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.notice_consumption_projection import normalize_notice_ids


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Select notice records from an authenticated notice export bundle."
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--output-bundle-path", required=True)
    parser.add_argument("--output-manifest-path", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    selected_notice_ids = _selected_notice_ids(
        explicit_notice_ids=args.notice_id,
        selection_path=args.selection_path,
    )
    if not selected_notice_ids:
        raise ValueError("--notice-id or --selection-path is required")
    bundle_path = Path(args.bundle_path).resolve()
    records = _load_bundle_records(bundle_path)
    selected_records = _select_records(records=records, selected_notice_ids=selected_notice_ids)
    found_notice_ids = normalize_notice_ids(_notice_id(record) for record in selected_records)
    missing_notice_ids = tuple(
        notice_id for notice_id in selected_notice_ids if notice_id not in set(found_notice_ids)
    )
    if missing_notice_ids:
        raise ValueError("missing selected notice ids: " + ", ".join(missing_notice_ids))

    output_bundle_path = Path(args.output_bundle_path)
    output_manifest_path = Path(args.output_manifest_path)
    _write_json(output_bundle_path, selected_records)
    _write_json(
        output_manifest_path,
        {
            "schema_version": "authenticated_notice_selected_export_manifest.v1",
            "source_bundle_path": str(bundle_path),
            "filters": {"selected_notice_ids": list(selected_notice_ids)},
            "counts": {
                "source_notice_count": len(records),
                "selected_notice_count": len(selected_records),
            },
        },
    )
    print(
        json.dumps(
            {
                "selected_notice_ids": list(selected_notice_ids),
                "selected_notice_count": len(selected_records),
                "output_bundle_path": str(output_bundle_path),
                "output_manifest_path": str(output_manifest_path),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _selected_notice_ids(
    *,
    explicit_notice_ids: Sequence[object],
    selection_path: str | None,
) -> tuple[str, ...]:
    selected_from_path: tuple[str, ...] = ()
    if str(selection_path or "").strip():
        selected_from_path = load_authenticated_notice_selection_notice_ids(
            Path(str(selection_path))
        )
    return normalize_notice_ids((*explicit_notice_ids, *selected_from_path))


def _load_bundle_records(path: Path) -> tuple[dict[str, Any], ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("authenticated notice bundle must be a JSON array")
    return tuple(dict(item) for item in payload if isinstance(item, Mapping))


def _select_records(
    *,
    records: Sequence[Mapping[str, Any]],
    selected_notice_ids: Sequence[str],
) -> list[dict[str, Any]]:
    selected = set(selected_notice_ids)
    return [dict(record) for record in records if _notice_id(record) in selected]


def _notice_id(record: Mapping[str, Any]) -> str:
    direct = str(record.get("notice_id") or "").strip()
    if direct:
        return direct
    notice = record.get("notice")
    if isinstance(notice, Mapping):
        return str(notice.get("notice_id") or "").strip()
    return ""


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
