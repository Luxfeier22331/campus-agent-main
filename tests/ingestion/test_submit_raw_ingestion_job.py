from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_worker.submit_raw_ingestion_job import submit_raw_ingestion_job


class SubmitRawIngestionJobTest(unittest.TestCase):
    def test_submit_raw_ingestion_job_writes_placeholder_job_envelope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            (raw_root / "student-handbook.pdf").write_bytes(b"%PDF-1.4 a")
            (raw_root / "student-rules.pdf").write_bytes(b"%PDF-1.4 b")
            (raw_root / "ignore.txt").write_text("ignore", encoding="utf-8")

            report = submit_raw_ingestion_job(
                env={
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "RAW_INGESTION_JOB_DIR": str(root / "jobs"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                }
            )

            self.assertEqual(report.status, "queued_placeholder")
            self.assertEqual(report.submitted_count, 2)
            self.assertEqual(
                report.pdf_paths,
                (str(raw_root / "student-handbook.pdf"), str(raw_root / "student-rules.pdf")),
            )
            self.assertTrue(Path(report.job_path).exists())
            self.assertTrue(Path(report.report_path).exists())

            payload = json.loads(Path(report.job_path).read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "queued_placeholder")
            self.assertEqual(payload["corpus"], "student_handbook")
            self.assertEqual(
                payload["pdf_paths"],
                [str(raw_root / "student-handbook.pdf"), str(raw_root / "student-rules.pdf")],
            )

    def test_submit_raw_ingestion_job_uses_configured_corpus(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            (raw_root / "curriculum-plan.pdf").write_bytes(b"%PDF-1.4 curriculum")

            report = submit_raw_ingestion_job(
                env={
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "INGESTION_CORPUS": "curriculum_plan",
                    "RAW_INGESTION_JOB_DIR": str(root / "jobs"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                }
            )

            payload = json.loads(Path(report.job_path).read_text(encoding="utf-8"))

            self.assertEqual(payload["corpus"], "curriculum_plan")

    def test_submit_raw_ingestion_job_prefers_explicit_source_paths(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            selected_path = raw_root / "curriculum-plan.pdf"
            selected_path.write_bytes(b"%PDF-1.4 curriculum")
            ignored_path = raw_root / "ignored.pdf"
            ignored_path.write_bytes(b"%PDF-1.4 ignored")

            report = submit_raw_ingestion_job(
                env={
                    "RAW_INGESTION_SOURCE_PATHS": str(selected_path),
                    "RAW_INGESTION_JOB_DIR": str(root / "jobs"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                }
            )

            payload = json.loads(Path(report.job_path).read_text(encoding="utf-8"))

            self.assertEqual(payload["raw_root"], None)
            self.assertEqual(payload["pdf_paths"], [str(selected_path)])

    def test_submit_raw_ingestion_job_requires_raw_root_or_source_paths(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "RAW_INGESTION_SOURCE_PATHS"):
                submit_raw_ingestion_job(
                    env={
                        "RAW_INGESTION_JOB_DIR": str(root / "jobs"),
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    }
                )


if __name__ == "__main__":
    unittest.main()
