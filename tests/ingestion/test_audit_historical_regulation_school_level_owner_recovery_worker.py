from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_worker.audit_historical_regulation_school_level_owner_recovery import (
    main,
)

from tests.ingestion.test_historical_regulation_school_level_owner_recovery import (
    _collected_bundle_without_owner_sources,
    _phase05_inventory,
)


class AuditHistoricalRegulationSchoolLevelOwnerRecoveryWorkerTests(unittest.TestCase):
    def test_writes_phase06_blocked_evidence_without_downstream_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory_path = root / "school-level-inventory.json"
            bundle_path = root / "notices-bundle.normalized.json"
            output_dir = root / "phase-06"
            _write_json(inventory_path, _phase05_inventory())
            _write_json(bundle_path, _collected_bundle_without_owner_sources())

            main(
                [
                    "--inventory-path",
                    str(inventory_path),
                    "--bundle-path",
                    str(bundle_path),
                    "--output-dir",
                    str(output_dir),
                ]
            )

            audit = _read_json(output_dir / "owner-text-recovery-audit.json")
            blocked = _read_json(output_dir / "blocked-owner-source-backlog.json")
            source_candidates = _read_json(output_dir / "source-candidate-manifest.json")
            serving_closed = _read_json(output_dir / "serving-closed-assertion.json")

            self.assertEqual(audit["blocked_notice_ids"], ["355282", "187233", "177880"])
            self.assertEqual(blocked["notice_ids"], ["355282", "187233", "177880"])
            self.assertEqual(source_candidates["notice_ids"], [])
            self.assertFalse(serving_closed["embedding_opened"])
            self.assertFalse((output_dir / "canonical-selection.json").exists())
            self.assertFalse((output_dir / "embedding-manifest.json").exists())
            self.assertFalse((output_dir / "release-admission.json").exists())


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
