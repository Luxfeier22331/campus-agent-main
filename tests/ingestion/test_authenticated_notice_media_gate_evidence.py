from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_media_gate_evidence import (
    AUTHENTICATED_NOTICE_MEDIA_GATE_EVIDENCE_SCHEMA_VERSION,
    build_authenticated_notice_media_gate_evidence_manifest,
    validate_authenticated_notice_media_gate_evidence_manifest,
)


class AuthenticatedNoticeMediaGateEvidenceTest(unittest.TestCase):
    def test_manifest_uses_deterministic_operations_paths_and_validates_hashes(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            _write_json(root / "media-extraction-candidate-inventory.json", {"candidates": []})
            _write_json(root / "media-extraction-attempt-ledger.json", {"attempts": []})
            _write_json(
                root / "media-extraction-candidate-inventory.closeout.json",
                {"candidates": []},
            )
            _write_json(root / "target-admission-manifest.json", {"admissions": []})
            _write_json(root / "cleanup.dry-run.json", {"items": []})
            _write_json(
                root / "media-source-object-verification-report.json",
                {"row_count": 0, "verified_count": 0},
            )
            audit_path = root / "media-closeout-state-machine-audit.json"
            _write_json(
                audit_path,
                {
                    "schema_version": "notice_media_closeout_target_admission_state_machine_audit.v1",
                    "verdict": "passed",
                    "strict_gate": True,
                    "finding_count": 0,
                    "candidate_count": 0,
                    "attempt_count": 0,
                    "input_hashes": {
                        "candidate_inventory_sha256": _sha(
                            root / "media-extraction-candidate-inventory.json"
                        ),
                        "attempt_ledger_sha256": _sha(
                            root / "media-extraction-attempt-ledger.json"
                        ),
                        "closeout_candidate_inventory_sha256": _sha(
                            root / "media-extraction-candidate-inventory.closeout.json"
                        ),
                        "target_admission_manifest_1_sha256": _sha(
                            root / "target-admission-manifest.json"
                        ),
                        "cleanup_report_sha256": _sha(root / "cleanup.dry-run.json"),
                        "object_verification_report_sha256": _sha(
                            root / "media-source-object-verification-report.json"
                        ),
                    },
                },
            )

            manifest = build_authenticated_notice_media_gate_evidence_manifest(
                run_id="run-001",
                operations_dir=root,
            )
            verdict = validate_authenticated_notice_media_gate_evidence_manifest(manifest)

        self.assertEqual(
            manifest["schema_version"],
            AUTHENTICATED_NOTICE_MEDIA_GATE_EVIDENCE_SCHEMA_VERSION,
        )
        self.assertEqual(manifest["run_id"], "run-001")
        self.assertEqual(verdict["verdict"], "passed")
        self.assertEqual(verdict["audit"]["finding_count"], 0)

    def test_validation_rejects_stale_candidate_inventory_hash(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            _write_json(root / "media-extraction-candidate-inventory.json", {"candidates": []})
            _write_json(root / "media-extraction-attempt-ledger.json", {"attempts": []})
            _write_json(
                root / "media-extraction-candidate-inventory.closeout.json",
                {"candidates": []},
            )
            _write_json(root / "target-admission-manifest.json", {"admissions": []})
            _write_json(root / "cleanup.dry-run.json", {"items": []})
            _write_json(
                root / "media-source-object-verification-report.json",
                {"row_count": 0, "verified_count": 0},
            )
            _write_json(
                root / "media-closeout-state-machine-audit.json",
                {
                    "verdict": "passed",
                    "strict_gate": True,
                    "finding_count": 0,
                    "input_hashes": {"candidate_inventory_sha256": "0" * 64},
                },
            )

            manifest = build_authenticated_notice_media_gate_evidence_manifest(
                run_id="run-001",
                operations_dir=root,
            )
            with self.assertRaisesRegex(ValueError, "candidate_inventory_sha256"):
                validate_authenticated_notice_media_gate_evidence_manifest(manifest)


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    unittest.main()
