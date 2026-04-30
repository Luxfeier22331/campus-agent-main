from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

PHASE_09_ID = "phase-09-first-batch-regulation-promotion-write-gate"


def write_phase09_evidence_files(
    *,
    output_dir: Path,
    selection: Mapping[str, Any],
    admission_preflight_report: Mapping[str, Any],
    materialization_report: Mapping[str, Any],
    preflight_snapshot: Mapping[str, Any],
    postflight_snapshot: Mapping[str, Any],
    source_to_target_trace: Mapping[str, Any],
    serving_closed_assertion: Mapping[str, Any],
    reader_assets_report: Mapping[str, Any] | None = None,
) -> dict[str, Path]:
    files: dict[str, Mapping[str, Any]] = {
        "first-batch-selection.json": selection,
        "admission-preflight-report.json": admission_preflight_report,
        "materialization-preflight.snapshot.json": preflight_snapshot,
        "materialization.execute.json": materialization_report,
        "materialization-postflight.snapshot.json": postflight_snapshot,
        "source-to-target-provenance-trace.json": source_to_target_trace,
        "serving-closed-assertion.json": serving_closed_assertion,
        "reader-assets-skipped-report.json": reader_assets_report
        or {
            "phase": PHASE_09_ID,
            "reader_assets_opened": False,
            "reason": "not_requested_for_first_batch_write_gate",
        },
    }
    written: dict[str, Path] = {}
    for filename, payload in files.items():
        path = output_dir / filename
        _write_json(path, payload)
        written[filename] = path
    return written


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = ["write_phase09_evidence_files"]
