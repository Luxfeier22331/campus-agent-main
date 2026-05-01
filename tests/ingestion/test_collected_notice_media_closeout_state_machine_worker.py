from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_media_source_object_verification import (
    build_collected_notice_media_source_object_verification_report,
)

from tests.ingestion.collected_notice_media_closeout_state_machine_audit_support import (
    _attempt,
    _candidate_inventory,
    _cleanup_report,
    _object_verification_report,
    _target_admission_manifest,
)


class CollectedNoticeMediaCloseoutStateMachineWorkerTests(unittest.TestCase):
    def test_attempt_ledger_worker_writes_ledger(self) -> None:
        worker = importlib.import_module(
            "campus_ingestion_worker.build_collected_notice_media_extraction_attempt_ledger"
        )
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_path = root / "candidates.json"
            attempt_path = root / "attempt-plan.json"
            output_dir = root / "out"
            candidate_path.write_text(json.dumps(_candidate_inventory()), encoding="utf-8")
            attempt_path.write_text(
                json.dumps({"attempts": [{"candidate_id": "candidate:schedule"}]}),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker."
                    "build_collected_notice_media_extraction_attempt_ledger.load_worker_env"
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--candidate-inventory-path",
                        str(candidate_path),
                        "--attempt-plan-path",
                        str(attempt_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            summary = json.loads(stdout.getvalue())
            self.assertEqual(summary["attempt_count"], 1)
            self.assertTrue((output_dir / "media-extraction-attempt-ledger.json").exists())

    def test_audit_worker_writes_audit(self) -> None:
        worker = importlib.import_module(
            "campus_ingestion_worker.audit_collected_notice_media_closeout_state_machine"
        )
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_path = root / "candidates.json"
            ledger_path = root / "ledger.json"
            closeout_path = root / "closeout-candidates.json"
            admission_path = root / "target-admission.json"
            cleanup_path = root / "cleanup.json"
            verification_path = root / "object-verification.json"
            output_dir = root / "audit"
            candidate_path.write_text(json.dumps(_candidate_inventory()), encoding="utf-8")
            ledger_path.write_text(
                json.dumps(
                    {
                        "attempts": [
                            _attempt(
                                "candidate:schedule",
                                status="pending",
                                retry_budget_remaining=2,
                                source_key="objects/schedule.png",
                            )
                        ]
                    }
                ),
                encoding="utf-8",
            )
            closeout_path.write_text(json.dumps(_candidate_inventory()), encoding="utf-8")
            admission_path.write_text(json.dumps(_target_admission_manifest("needs_multimodal")))
            cleanup_path.write_text(
                json.dumps(_cleanup_report(protected_keys=("objects/schedule.png",))),
                encoding="utf-8",
            )
            verification_path.write_text(
                json.dumps(_object_verification_report(source_hash="a" * 64)),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker."
                    "audit_collected_notice_media_closeout_state_machine.load_worker_env"
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--candidate-inventory-path",
                        str(candidate_path),
                        "--attempt-ledger-path",
                        str(ledger_path),
                        "--closeout-candidate-inventory-path",
                        str(closeout_path),
                        "--target-admission-manifest-path",
                        str(admission_path),
                        "--cleanup-report-path",
                        str(cleanup_path),
                        "--object-verification-report-path",
                        str(verification_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            summary = json.loads(stdout.getvalue())
            self.assertEqual(summary["verdict"], "passed")
            self.assertTrue((output_dir / "media-closeout-state-machine-audit.json").exists())

    def test_audit_worker_exits_nonzero_when_strict_gate_fails(self) -> None:
        worker = importlib.import_module(
            "campus_ingestion_worker.audit_collected_notice_media_closeout_state_machine"
        )
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_path = root / "candidates.json"
            ledger_path = root / "ledger.json"
            output_dir = root / "audit"
            candidate_path.write_text(json.dumps(_candidate_inventory()), encoding="utf-8")
            ledger_path.write_text(
                json.dumps(
                    {
                        "attempts": [
                            _attempt(
                                "candidate:schedule",
                                status="pending",
                                retry_budget_remaining=2,
                                source_key="objects/schedule.png",
                            )
                        ]
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker."
                    "audit_collected_notice_media_closeout_state_machine.load_worker_env"
                ),
                redirect_stdout(StringIO()),
                self.assertRaises(SystemExit) as raised,
            ):
                worker.main(
                    [
                        "--candidate-inventory-path",
                        str(candidate_path),
                        "--attempt-ledger-path",
                        str(ledger_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            self.assertEqual(raised.exception.code, 1)

    def test_audit_worker_does_not_expose_partial_gate_escape_hatch(self) -> None:
        worker = importlib.import_module(
            "campus_ingestion_worker.audit_collected_notice_media_closeout_state_machine"
        )

        option_strings = {
            option
            for action in worker.build_parser()._actions
            for option in getattr(action, "option_strings", ())
        }

        self.assertNotIn("--allow-partial-gate", option_strings)

    def test_source_object_verifier_uses_get_hash_when_head_lacks_checksum(self) -> None:
        class _Store:
            def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
                self.head_request = {"bucket": bucket, "key": key}
                return {"content_length": 123, "metadata": {}}

            def get_bytes(self, *, bucket: str, key: str) -> bytes:
                self.get_request = {"bucket": bucket, "key": key}
                return b"schedule-image"

        store = _Store()
        inventory = _candidate_inventory()
        inventory["candidates"][0]["source_object_ref"]["sha256"] = (  # type: ignore[index]
            "57f84d542435a9de3eeb32f5bfd07bbd3d815612dbd9708a7de130cdabf9b5ea"
        )
        inventory["candidates"][0]["source_object_ref"]["byte_size"] = len(  # type: ignore[index]
            b"schedule-image"
        )

        report = build_collected_notice_media_source_object_verification_report(
            candidate_inventory=inventory,
            object_store=store,
            checked_at="2026-05-01T00:00:00+08:00",
        )

        self.assertEqual(
            report["schema_version"], "notice_media_source_object_verification_report.v1"
        )
        self.assertEqual(report["verified_count"], 1)
        self.assertEqual(report["rows"][0]["status"], "verified")
        self.assertEqual(report["rows"][0]["check_method"], "get_hash")
        self.assertEqual(report["rows"][0]["storage_provider"], "object_store")
        self.assertEqual(report["rows"][0]["live_checked_at"], "2026-05-01T00:00:00+08:00")

    def test_source_object_verifier_worker_writes_report(self) -> None:
        worker = importlib.import_module(
            "campus_ingestion_worker.verify_collected_notice_media_source_objects"
        )
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_path = root / "candidates.json"
            output_dir = root / "verification"
            candidate_path.write_text(json.dumps(_candidate_inventory()), encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker."
                    "verify_collected_notice_media_source_objects.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker."
                    "verify_collected_notice_media_source_objects."
                    "CollectedNoticeMediaSourceObjectS3Verifier"
                ) as verifier_cls,
                patch(
                    "campus_ingestion_worker."
                    "verify_collected_notice_media_source_objects.ObjectStoreSettings.from_env",
                    return_value=object(),
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                verifier = verifier_cls.return_value
                verifier.head_object.return_value = {
                    "content_length": 123,
                    "metadata": {"sha256": "a" * 64},
                }
                worker.main(
                    [
                        "--candidate-inventory-path",
                        str(candidate_path),
                        "--output-dir",
                        str(output_dir),
                        "--checked-at",
                        "2026-05-01T00:00:00+08:00",
                    ]
                )

            summary = json.loads(stdout.getvalue())
            self.assertEqual(summary["verified_count"], 1)
            self.assertTrue((output_dir / "media-source-object-verification-report.json").exists())


if __name__ == "__main__":
    unittest.main()
