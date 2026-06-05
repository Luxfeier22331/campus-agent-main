from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.historical_regulation_school_level_owner_recovery import (
    BLOCKED_INCOMPLETE_OWNER_TEXT,
    BLOCKED_NO_OWNER_SOURCE,
    OWNER_SOURCE_CANDIDATE_FOUND,
    build_historical_regulation_school_level_owner_recovery_audit,
)

DEFAULT_INVENTORY_PATH = Path(
    "var/ingestion-evidence/historical-regulation-denominator-expansion/"
    "phase-05-school-level-inventory/school-level-inventory.json"
)
DEFAULT_BUNDLE_PATH = Path(
    ".tmp/historical-intake/run14-policy-regulation-expanded/normalized/"
    "notices-bundle.normalized.json"
)
DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/historical-regulation-denominator-expansion/"
    "phase-06-school-level-owner-text-recovery"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Audit school-level historical regulation owner-text recovery readiness "
            "without opening canonical, chunk or downstream lanes."
        )
    )
    parser.add_argument("--inventory-path", default=str(DEFAULT_INVENTORY_PATH))
    parser.add_argument("--bundle-path", default=str(DEFAULT_BUNDLE_PATH))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    audit = build_historical_regulation_school_level_owner_recovery_audit(
        school_level_inventory=_load_json_object(Path(args.inventory_path)),
        collected_bundle=_load_json(Path(args.bundle_path)),
    )
    files = write_phase06_evidence_files(output_dir=Path(args.output_dir), audit=audit)
    print(
        json.dumps(
            {
                "schema_version": "historical-regulation-school-level-owner-recovery-worker.v1",
                "output_dir": str(args.output_dir),
                "files": {name: str(path) for name, path in sorted(files.items())},
                "target_notice_ids": audit["target_notice_ids"],
                "source_candidate_notice_ids": audit["source_candidate_notice_ids"],
                "blocked_notice_ids": audit["blocked_notice_ids"],
                "status_counts": audit["status_counts"],
                "serving_closed": audit["serving_closed_assertion"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_phase06_evidence_files(
    *,
    output_dir: Path,
    audit: Mapping[str, Any],
) -> dict[str, Path]:
    files = {
        "owner-text-recovery-audit.json": output_dir / "owner-text-recovery-audit.json",
        "source-candidate-manifest.json": output_dir / "source-candidate-manifest.json",
        "blocked-owner-source-backlog.json": output_dir / "blocked-owner-source-backlog.json",
        "serving-closed-assertion.json": output_dir / "serving-closed-assertion.json",
        "candidate-store-noop-assertion.json": output_dir / "candidate-store-noop-assertion.json",
    }
    _write_json(files["owner-text-recovery-audit.json"], audit)
    _write_json(
        files["source-candidate-manifest.json"],
        _subset_payload(
            audit=audit,
            schema_version="historical_regulation_owner_source_candidate_manifest.v1",
            statuses={OWNER_SOURCE_CANDIDATE_FOUND},
            notice_ids=list(audit["source_candidate_notice_ids"]),
        ),
    )
    _write_json(
        files["blocked-owner-source-backlog.json"],
        _subset_payload(
            audit=audit,
            schema_version="historical_regulation_blocked_owner_source_backlog.v1",
            statuses={BLOCKED_NO_OWNER_SOURCE, BLOCKED_INCOMPLETE_OWNER_TEXT},
            notice_ids=list(audit["blocked_notice_ids"]),
        ),
    )
    _write_json(files["serving-closed-assertion.json"], audit["serving_closed_assertion"])
    _write_json(
        files["candidate-store-noop-assertion.json"],
        audit["candidate_store_noop_assertion"],
    )
    return files


def _subset_payload(
    *,
    audit: Mapping[str, Any],
    schema_version: str,
    statuses: set[str],
    notice_ids: list[str],
) -> dict[str, Any]:
    return {
        "schema_version": schema_version,
        "generated_at": audit["generated_at"],
        "notice_ids": notice_ids,
        "records": [
            dict(record)
            for record in audit["records"]
            if str(record.get("status") or "") in statuses
        ],
    }


def _load_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_json_object(path: Path) -> dict[str, Any]:
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
    "write_phase06_evidence_files",
]


if __name__ == "__main__":
    main()
