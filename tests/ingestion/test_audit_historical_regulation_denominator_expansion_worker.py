from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_worker.audit_historical_regulation_denominator_expansion import (
    main,
)

from tests.ingestion.test_historical_regulation_denominator_expansion import (
    _run14_batch_config,
    _run14_cohort_manifest,
    _wrapper_follow_up_manifest,
)


class AuditHistoricalRegulationDenominatorExpansionWorkerTests(unittest.TestCase):
    def test_writes_phase00_evidence_without_release_lane_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            batch_config = root / "batch.json"
            cohort_manifest = root / "cohort.json"
            wrapper_follow_up = root / "wrapper.json"
            completed_manifest = root / "completed.json"
            output_dir = root / "evidence"
            _write_json(batch_config, _run14_batch_config())
            _write_json(cohort_manifest, _run14_cohort_manifest())
            _write_json(wrapper_follow_up, _wrapper_follow_up_manifest())
            _write_json(completed_manifest, {"entries": []})

            main(
                [
                    "--batch-config-path",
                    str(batch_config),
                    "--cohort-manifest-path",
                    str(cohort_manifest),
                    "--wrapper-follow-up-path",
                    str(wrapper_follow_up),
                    "--completed-v9-admission-manifest-path",
                    str(completed_manifest),
                    "--output-dir",
                    str(output_dir),
                ]
            )

            audit = _read_json(output_dir / "denominator-audit.json")
            ready = _read_json(output_dir / "ready-canonical-chunk-candidates.json")
            recovery = _read_json(output_dir / "recovery-backlog.json")
            serving_closed = _read_json(output_dir / "serving-closed-assertion.json")

            self.assertEqual(audit["input_notice_count"], 16)
            self.assertEqual(len(ready["ready_notice_ids"]), 9)
            self.assertEqual(len(recovery["records"]), 7)
            self.assertFalse(serving_closed["rag_release_opened"])
            self.assertFalse(serving_closed["embedding_opened"])
            self.assertFalse((output_dir / "release-admission.json").exists())
            self.assertFalse((output_dir / "embedding-manifest.json").exists())


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
