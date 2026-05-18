from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_worker.audit_historical_regulation_school_level_inventory import (
    main,
)

from tests.ingestion.test_historical_regulation_school_level_inventory import (
    _collected_bundle,
)


class AuditHistoricalRegulationSchoolLevelInventoryWorkerTests(unittest.TestCase):
    def test_writes_phase05_inventory_evidence_without_downstream_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle_path = root / "notices-bundle.normalized.json"
            completed_path = root / "completed.json"
            output_dir = root / "evidence"
            _write_json(bundle_path, _collected_bundle())
            _write_json(completed_path, {"entries": [{"source_notice_id": "done"}]})

            main(
                [
                    "--bundle-path",
                    str(bundle_path),
                    "--completed-manifest-path",
                    str(completed_path),
                    "--output-dir",
                    str(output_dir),
                ]
            )

            inventory = _read_json(output_dir / "school-level-inventory.json")
            school_ready = _read_json(output_dir / "school-level-ready-candidates.json")
            non_serving = _read_json(output_dir / "non-serving-scoped-rules.json")
            recovery = _read_json(output_dir / "recovery-backlog.json")
            serving_closed = _read_json(output_dir / "serving-closed-assertion.json")

            self.assertEqual(inventory["input_notice_count"], 6)
            self.assertEqual(school_ready["notice_ids"], ["school"])
            self.assertEqual(non_serving["notice_ids"], ["scoped"])
            self.assertEqual(recovery["notice_ids"], ["wrapper", "summary"])
            self.assertFalse(serving_closed["embedding_opened"])
            self.assertFalse((output_dir / "embedding-manifest.json").exists())
            self.assertFalse((output_dir / "release-admission.json").exists())
            self.assertFalse((output_dir / "rag-release-candidates.json").exists())


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
