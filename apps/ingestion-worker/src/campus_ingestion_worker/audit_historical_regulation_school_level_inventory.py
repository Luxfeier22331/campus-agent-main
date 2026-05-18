from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.historical_regulation_school_level_inventory import (
    SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK,
    SCOPED_RULE_CHUNK_ONLY_NON_SERVING,
    WRAPPER_NEEDS_OWNER_TEXT_RECOVERY,
    WRAPPER_SUMMARY_BACKLOG,
    build_historical_regulation_school_level_inventory,
)

DEFAULT_BUNDLE_PATH = Path(
    ".tmp/historical-intake/run14-policy-regulation-expanded/normalized/"
    "notices-bundle.normalized.json"
)
DEFAULT_COMPLETED_MANIFEST_PATH = Path(
    ".planning/workstreams/historical-regulation-canonical-chunk-backfill/evidence/"
    "phase-09-historical-offline-regulation-admission/"
    "regulation-consumer-admission-manifest.json"
)
DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/historical-regulation-denominator-expansion/evidence/"
    "phase-05-school-level-inventory"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Audit collected regulation-like notices and isolate school-level "
            "institutional_rules candidates without opening downstream lanes."
        )
    )
    parser.add_argument("--bundle-path", default=str(DEFAULT_BUNDLE_PATH))
    parser.add_argument(
        "--completed-manifest-path",
        default=str(DEFAULT_COMPLETED_MANIFEST_PATH),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    inventory = build_historical_regulation_school_level_inventory(
        collected_bundle=_load_json(Path(args.bundle_path)),
        completed_manifest=_load_json_object_if_exists(Path(args.completed_manifest_path)),
    )
    files = write_phase05_evidence_files(output_dir=Path(args.output_dir), inventory=inventory)
    print(
        json.dumps(
            {
                "schema_version": "historical-regulation-school-level-inventory-worker.v1",
                "output_dir": str(args.output_dir),
                "files": {name: str(path) for name, path in sorted(files.items())},
                "input_notice_count": inventory["input_notice_count"],
                "status_counts": inventory["status_counts"],
                "school_level_ready_notice_ids": inventory["school_level_ready_notice_ids"],
                "non_serving_notice_ids": inventory["non_serving_notice_ids"],
                "recovery_notice_ids": inventory["recovery_notice_ids"],
                "serving_closed": inventory["serving_closed_assertion"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_phase05_evidence_files(
    *,
    output_dir: Path,
    inventory: Mapping[str, Any],
) -> dict[str, Path]:
    files = {
        "school-level-inventory.json": output_dir / "school-level-inventory.json",
        "school-level-ready-candidates.json": output_dir / "school-level-ready-candidates.json",
        "non-serving-scoped-rules.json": output_dir / "non-serving-scoped-rules.json",
        "recovery-backlog.json": output_dir / "recovery-backlog.json",
        "hold-backlog.json": output_dir / "hold-backlog.json",
        "serving-closed-assertion.json": output_dir / "serving-closed-assertion.json",
        "candidate-store-noop-assertion.json": output_dir / "candidate-store-noop-assertion.json",
    }
    _write_json(files["school-level-inventory.json"], inventory)
    _write_json(
        files["school-level-ready-candidates.json"],
        _subset_payload(
            inventory=inventory,
            schema_version="historical_regulation_school_level_ready_candidates.v1",
            statuses={SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK},
            notice_ids=list(inventory["school_level_ready_notice_ids"]),
        ),
    )
    _write_json(
        files["non-serving-scoped-rules.json"],
        _subset_payload(
            inventory=inventory,
            schema_version="historical_regulation_non_serving_scoped_rules.v1",
            statuses={SCOPED_RULE_CHUNK_ONLY_NON_SERVING},
            notice_ids=list(inventory["non_serving_notice_ids"]),
        ),
    )
    _write_json(
        files["recovery-backlog.json"],
        _subset_payload(
            inventory=inventory,
            schema_version="historical_regulation_school_level_recovery_backlog.v1",
            statuses={WRAPPER_NEEDS_OWNER_TEXT_RECOVERY, WRAPPER_SUMMARY_BACKLOG},
            notice_ids=list(inventory["recovery_notice_ids"]),
        ),
    )
    _write_json(
        files["hold-backlog.json"],
        {
            "schema_version": "historical_regulation_school_level_hold_backlog.v1",
            "generated_at": inventory["generated_at"],
            "notice_ids": list(inventory["hold_notice_ids"]),
            "records": [
                dict(record)
                for record in inventory["records"]
                if str(record.get("source_notice_id") or "") in inventory["hold_notice_ids"]
            ],
        },
    )
    _write_json(files["serving-closed-assertion.json"], inventory["serving_closed_assertion"])
    _write_json(
        files["candidate-store-noop-assertion.json"],
        inventory["candidate_store_noop_assertion"],
    )
    return files


def _subset_payload(
    *,
    inventory: Mapping[str, Any],
    schema_version: str,
    statuses: set[str],
    notice_ids: list[str],
) -> dict[str, Any]:
    return {
        "schema_version": schema_version,
        "generated_at": inventory["generated_at"],
        "notice_ids": notice_ids,
        "records": [
            dict(record)
            for record in inventory["records"]
            if str(record.get("status") or "") in statuses
        ],
    }


def _load_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_json_object_if_exists(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"entries": []}
    payload = _load_json(path)
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "DEFAULT_OUTPUT_DIR",
    "build_parser",
    "main",
    "write_phase05_evidence_files",
]


if __name__ == "__main__":
    main()
