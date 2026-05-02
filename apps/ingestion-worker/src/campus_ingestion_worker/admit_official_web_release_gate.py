from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.official_web_release_task_admission import (
    build_stable_reference_release_task_from_gate,
)
from campus_ingestion_core.official_web_release_task_store import (
    OfficialWebReleaseTaskStore,
    build_official_web_release_task_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def admit_official_web_release_gate(
    *,
    release_gate: Mapping[str, Any],
    release_task_store: OfficialWebReleaseTaskStore,
) -> dict[str, object]:
    task = build_stable_reference_release_task_from_gate(release_gate)
    admitted = release_task_store.create_or_get_task(task)
    return {
        "schema_version": "official_web_release_gate_admission.v1",
        "admitted_count": 1,
        "task": admitted.to_payload(),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Admit an approved official_web stable-reference release gate into ingestion release tasks.",
    )
    parser.add_argument("--release-gate-path", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    release_gate = _read_json_object(Path(args.release_gate_path))
    report = admit_official_web_release_gate(
        release_gate=release_gate,
        release_task_store=build_official_web_release_task_store_from_env(),
    )
    print(json.dumps(_jsonable(report), ensure_ascii=False, indent=2))


def _read_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"release gate JSON must be an object: {path}")
    return payload


def _jsonable(value: object) -> object:
    if hasattr(value, "__dataclass_fields__"):
        return _jsonable(asdict(value))  # type: ignore[arg-type]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(item) for item in value]
    return value


__all__ = ["admit_official_web_release_gate", "build_parser", "main"]


if __name__ == "__main__":
    main()
