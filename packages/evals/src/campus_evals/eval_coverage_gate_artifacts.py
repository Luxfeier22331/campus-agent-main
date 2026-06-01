from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from campus_evals.eval_coverage_snapshot import (
    EVAL_COVERAGE_GATE_ARTIFACT_KINDS,
    EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION,
)
from campus_evals.rag_eval_coverage import CURRENT_RAG_CONSUMPTION_SURFACES

ALLOWED_EVAL_COVERAGE_GATE_ARTIFACT_KINDS = EVAL_COVERAGE_GATE_ARTIFACT_KINDS


def build_eval_coverage_gate_artifacts_manifest(
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    by_surface: dict[str, dict[str, str]] = {}
    for index, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict):
            raise ValueError(f"artifacts[{index}] must be an object")
        normalized = _normalize_artifact(artifact, f"artifacts[{index}]")
        surface_key = normalized["surface_key"]
        if surface_key not in CURRENT_RAG_CONSUMPTION_SURFACES:
            raise ValueError(f"unsupported gate artifact surface: {surface_key}")
        if surface_key in by_surface:
            raise ValueError(f"duplicate gate artifact surface: {surface_key}")
        _assert_artifact_file_is_json_object(Path(normalized["path"]), f"artifacts[{index}].path")
        by_surface[surface_key] = normalized
    missing = set(CURRENT_RAG_CONSUMPTION_SURFACES) - set(by_surface)
    if missing:
        raise ValueError("missing gate artifacts for surfaces: " + ", ".join(sorted(missing)))
    return {
        "schema_version": EVAL_COVERAGE_GATE_ARTIFACTS_SCHEMA_VERSION,
        "artifacts": [by_surface[surface_key] for surface_key in CURRENT_RAG_CONSUMPTION_SURFACES],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build an explicit eval coverage gate artifact manifest."
    )
    parser.add_argument(
        "--artifact",
        action="append",
        help=(
            "JSON object with artifact_id, artifact_kind, path, profile_id and surface_key. "
            "Repeat once per current RAG denominator surface."
        ),
    )
    parser.add_argument(
        "--artifact-file",
        help="JSON object containing an artifacts array with explicit artifact declarations.",
    )
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    manifest = build_eval_coverage_gate_artifacts_manifest(
        [
            *_load_artifact_file(args.artifact_file),
            *[_load_artifact_arg(value, index) for index, value in enumerate(args.artifact or ())],
        ]
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


def _load_artifact_arg(value: str, index: int) -> dict[str, Any]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"--artifact[{index}] must be valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"--artifact[{index}] must be a JSON object")
    return payload


def _load_artifact_file(path_value: str | None) -> list[dict[str, Any]]:
    if not path_value:
        return []
    path = Path(path_value)
    if not path.exists():
        raise ValueError(f"artifact file does not exist: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("--artifact-file must contain a JSON object")
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, list):
        raise ValueError("--artifact-file must contain artifacts")
    return artifacts


def _normalize_artifact(item: dict[str, Any], prefix: str) -> dict[str, str]:
    artifact_kind = _required_string(item, "artifact_kind", prefix)
    if artifact_kind not in ALLOWED_EVAL_COVERAGE_GATE_ARTIFACT_KINDS:
        raise ValueError(f"{prefix}.artifact_kind is unsupported")
    return {
        "artifact_id": _required_string(item, "artifact_id", prefix),
        "artifact_kind": artifact_kind,
        "path": _required_string(item, "path", prefix),
        "profile_id": _required_string(item, "profile_id", prefix),
        "surface_key": _required_string(item, "surface_key", prefix),
    }


def _assert_artifact_file_is_json_object(path: Path, field: str) -> None:
    if not path.exists():
        raise ValueError(f"{field} artifact path does not exist: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field} artifact must be valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{field} artifact must contain a JSON object: {path}")


def _required_string(item: dict[str, Any], key: str, prefix: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{prefix}.{key} is required")
    return value.strip()


__all__ = [
    "ALLOWED_EVAL_COVERAGE_GATE_ARTIFACT_KINDS",
    "build_eval_coverage_gate_artifacts_manifest",
    "main",
]


if __name__ == "__main__":
    raise SystemExit(main())
