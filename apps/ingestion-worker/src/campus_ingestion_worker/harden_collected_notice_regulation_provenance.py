from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    harden_first_batch_regulation_registry_provenance,
)
from campus_ingestion_core.registry import build_document_registry_from_env

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_SELECTION_PATH = Path(
    ".planning/workstreams/authenticated-notice-regulation-consumption/"
    "evidence/phase-09-first-batch-regulation-promotion-write-gate/"
    "first-batch-selection.json"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Harden first-batch regulation registry provenance from manual curated "
            "records to authenticated notice portal observations."
        )
    )
    parser.add_argument("--selection-path", default=str(DEFAULT_SELECTION_PATH))
    parser.add_argument("--output-path")
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    selection = _load_json_object(Path(args.selection_path))
    registry = build_document_registry_from_env(prefer_operator=True)
    report = harden_first_batch_regulation_registry_provenance(
        selection=selection,
        registry=registry,
        execute=args.execute,
    )
    payload = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output_path:
        output_path = Path(args.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload + "\n", encoding="utf-8")
    print(payload)


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


__all__ = [
    "DEFAULT_SELECTION_PATH",
    "build_document_registry_from_env",
    "build_parser",
    "harden_first_batch_regulation_registry_provenance",
    "main",
]


if __name__ == "__main__":
    main()
