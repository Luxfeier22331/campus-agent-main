from __future__ import annotations

import hashlib
import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.build_authenticated_notice_media_gate_evidence"
)


class BuildAuthenticatedNoticeMediaGateEvidenceWorkerTest(unittest.TestCase):
    def test_main_writes_manifest_and_verdict(self) -> None:
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

            with (
                patch(
                    "campus_ingestion_worker.build_authenticated_notice_media_gate_evidence."
                    "load_worker_env"
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(["--run-id", "run-001", "--operations-dir", str(root)])

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["verdict"], "passed")
            self.assertTrue((root / "authenticated-notice-media-gate-evidence.json").exists())
            self.assertTrue(
                (root / "authenticated-notice-media-gate-evidence-verdict.json").exists()
            )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    unittest.main()
