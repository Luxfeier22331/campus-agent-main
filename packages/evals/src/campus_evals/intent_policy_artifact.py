from __future__ import annotations

import json
from pathlib import Path
from typing import Any

INTENT_POLICY_ARTIFACT_PATH = (
    Path(__file__).resolve().parents[4] / "configs/runtime/intent-policy.v1.json"
)


def load_intent_policy_artifact(path: str | Path | None = None) -> dict[str, Any]:
    artifact_path = Path(path) if path is not None else INTENT_POLICY_ARTIFACT_PATH
    payload = json.loads(artifact_path.read_text(encoding="utf-8"))
    _validate_intent_policy_artifact(payload)
    return payload


def intent_policy_gate_metadata(path: str | Path | None = None) -> dict[str, str]:
    artifact = load_intent_policy_artifact(path)
    return {
        "case_set_version": str(artifact["case_set_version"]),
        "classifier_version": str(artifact["classifier_version"]),
        "intent_schema_version": str(artifact["intent_schema_version"]),
        "policy_version": str(artifact["policy_version"]),
        "schema_version": str(artifact["schema_version"]),
    }


def _validate_intent_policy_artifact(payload: object) -> None:
    if not isinstance(payload, dict):
        raise ValueError("intent policy artifact must be an object")
    required = (
        "schema_version",
        "policy_version",
        "classifier_version",
        "intent_schema_version",
        "case_set_version",
        "reason_codes",
        "signal_groups",
    )
    for key in required:
        if key not in payload:
            raise ValueError(f"intent policy artifact missing {key}")
    if payload["schema_version"] != "intent-policy-artifact-v1":
        raise ValueError("intent policy artifact schema_version must be intent-policy-artifact-v1")
    if not isinstance(payload["reason_codes"], list) or not payload["reason_codes"]:
        raise ValueError("intent policy artifact reason_codes must be a non-empty list")
    if not isinstance(payload["signal_groups"], dict) or not payload["signal_groups"]:
        raise ValueError("intent policy artifact signal_groups must be a non-empty object")


__all__ = [
    "INTENT_POLICY_ARTIFACT_PATH",
    "intent_policy_gate_metadata",
    "load_intent_policy_artifact",
]
