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

    def test_submit_raw_ingestion_job_requires_raw_root(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "CAMPUSRAG_RAW_ROOT"):
                submit_raw_ingestion_job(
                    env={
                        "RAW_INGESTION_JOB_DIR": str(root / "jobs"),
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    }
                )


if __name__ == "__main__":
    unittest.main()
