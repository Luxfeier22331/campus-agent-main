from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

AUTHENTICATED_NOTICE_MEDIA_GATE_EVIDENCE_SCHEMA_VERSION = (
    "authenticated_notice_media_gate_evidence_manifest.v1"
)

_CANDIDATE_INVENTORY = "media-extraction-candidate-inventory.json"
_ATTEMPT_LEDGER = "media-extraction-attempt-ledger.json"
_CLOSEOUT_CANDIDATE_INVENTORY = "media-extraction-candidate-inventory.closeout.json"
_TARGET_ADMISSION_MANIFEST = "target-admission-manifest.json"
_CLEANUP_REPORT = "cleanup.dry-run.json"
_OBJECT_VERIFICATION_REPORT = "media-source-object-verification-report.json"
_STRICT_AUDIT = "media-closeout-state-machine-audit.json"


def build_authenticated_notice_media_gate_evidence_manifest(
    *,
    run_id: str,
    operations_dir: Path,
) -> dict[str, Any]:
    root = Path(operations_dir)
    evidence = {
        "candidate_inventory": _artifact_ref(root / _CANDIDATE_INVENTORY),
        "attempt_ledger": _artifact_ref(root / _ATTEMPT_LEDGER),
        "closeout_candidate_inventory": _artifact_ref(root / _CLOSEOUT_CANDIDATE_INVENTORY),
        "target_admission_manifests": [_artifact_ref(root / _TARGET_ADMISSION_MANIFEST)],
        "cleanup_report": _artifact_ref(root / _CLEANUP_REPORT),
        "object_verification_report": _artifact_ref(root / _OBJECT_VERIFICATION_REPORT),
        "strict_audit": _artifact_ref(root / _STRICT_AUDIT),
    }
    return {
        "schema_version": AUTHENTICATED_NOTICE_MEDIA_GATE_EVIDENCE_SCHEMA_VERSION,
        "run_id": _required_text(run_id, "run_id"),
        "operations_dir": str(root),
        "evidence": evidence,
    }


def validate_authenticated_notice_media_gate_evidence_manifest(
    manifest: Mapping[str, Any],
) -> dict[str, Any]:
    _assert_schema(manifest)
    evidence = manifest.get("evidence")
    if not isinstance(evidence, Mapping):
        raise ValueError("media gate evidence manifest evidence must be an object")
    audit_ref = _artifact_mapping(evidence.get("strict_audit"), "strict_audit")
    audit = _load_json_object(Path(str(audit_ref["path"])))
    if str(audit.get("verdict") or "") != "passed":
        raise ValueError("media gate strict audit verdict must be passed")
    if not bool(audit.get("strict_gate")):
        raise ValueError("media gate strict audit must use strict_gate=true")
    if int(audit.get("finding_count") or 0) != 0:
        raise ValueError("media gate strict audit must have zero findings")
    input_hashes = dict(audit.get("input_hashes") or {})
    _assert_ref_hash(
        evidence=evidence,
        manifest_key="candidate_inventory",
        audit_hash_key="candidate_inventory_sha256",
        input_hashes=input_hashes,
    )
    _assert_ref_hash(
        evidence=evidence,
        manifest_key="attempt_ledger",
        audit_hash_key="attempt_ledger_sha256",
        input_hashes=input_hashes,
    )
    _assert_ref_hash(
        evidence=evidence,
        manifest_key="closeout_candidate_inventory",
        audit_hash_key="closeout_candidate_inventory_sha256",
        input_hashes=input_hashes,
    )
    _assert_ref_hash(
        evidence=evidence,
        manifest_key="cleanup_report",
        audit_hash_key="cleanup_report_sha256",
        input_hashes=input_hashes,
    )
    _assert_ref_hash(
        evidence=evidence,
        manifest_key="object_verification_report",
        audit_hash_key="object_verification_report_sha256",
        input_hashes=input_hashes,
    )
    target_refs = evidence.get("target_admission_manifests")
    if not isinstance(target_refs, Sequence) or isinstance(target_refs, str | bytes):
        raise ValueError("target_admission_manifests must be a list")
    if not target_refs:
        raise ValueError("target_admission_manifests is required")
    for index, value in enumerate(target_refs, start=1):
        ref = _artifact_mapping(value, f"target_admission_manifests[{index}]")
        expected = str(input_hashes.get(f"target_admission_manifest_{index}_sha256") or "")
        _assert_hash_matches(ref=ref, expected=expected, label=f"target_admission_manifest_{index}_sha256")
    return {
        "verdict": "passed",
        "run_id": str(manifest.get("run_id") or ""),
        "audit": audit,
    }


def _assert_schema(manifest: Mapping[str, Any]) -> None:
    if (
        str(manifest.get("schema_version") or "")
        != AUTHENTICATED_NOTICE_MEDIA_GATE_EVIDENCE_SCHEMA_VERSION
    ):
        raise ValueError("unsupported authenticated notice media gate evidence schema_version")


def _assert_ref_hash(
    *,
    evidence: Mapping[str, Any],
    manifest_key: str,
    audit_hash_key: str,
    input_hashes: Mapping[str, Any],
) -> None:
    ref = _artifact_mapping(evidence.get(manifest_key), manifest_key)
    expected = str(input_hashes.get(audit_hash_key) or "")
    _assert_hash_matches(ref=ref, expected=expected, label=audit_hash_key)


def _assert_hash_matches(*, ref: Mapping[str, Any], expected: str, label: str) -> None:
    if not expected:
        raise ValueError(f"media gate audit missing {label}")
    actual = str(ref.get("sha256") or "")
    if actual != expected:
        raise ValueError(f"media gate evidence hash mismatch for {label}")


def _artifact_ref(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"media gate evidence artifact missing: {path}")
    return {
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "byte_size": path.stat().st_size,
    }


def _artifact_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} artifact ref is required")
    path = _required_text(value.get("path"), f"{label}.path")
    sha256 = _required_text(value.get("sha256"), f"{label}.sha256")
    if len(sha256) != 64:
        raise ValueError(f"{label}.sha256 must be a sha256 hex digest")
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != sha256:
        raise ValueError(f"{label}.sha256 does not match file bytes")
    return value


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


__all__ = [
    "AUTHENTICATED_NOTICE_MEDIA_GATE_EVIDENCE_SCHEMA_VERSION",
    "build_authenticated_notice_media_gate_evidence_manifest",
    "validate_authenticated_notice_media_gate_evidence_manifest",
]
