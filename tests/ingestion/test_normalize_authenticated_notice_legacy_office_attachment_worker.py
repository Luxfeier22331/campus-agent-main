from __future__ import annotations

import hashlib
import importlib
import io
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


worker = importlib.import_module(
    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment"
)


class NormalizeAuthenticatedNoticeLegacyOfficeAttachmentWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.normalize_authenticated_notice_legacy_office_attachment"
            ) as normalize,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            normalize.return_value = worker.LegacyOfficeNormalizationResult(
                input_path="/tmp/legacy.doc",
                output_path="/tmp/out/legacy.docx",
                source_extension=".doc",
                source_mime_type="application/msword",
                source_object_key="attachments/example/legacy.doc",
                source_sha256="abc123",
                normalized_extension=".docx",
                normalized_sha256="def456",
                normalizer_name="libreoffice-soffice",
                normalizer_version="LibreOffice 25.2.1.2",
            )
            worker.main(
                [
                    "--input-path",
                    "/tmp/legacy.doc",
                    "--output-dir",
                    "/tmp/out",
                    "--source-object-key",
                    "attachments/example/legacy.doc",
                    "--source-sha256",
                    "abc123",
                    "--source-mime-type",
                    "application/msword",
                ]
            )

        self.assertEqual(
            normalize.call_args.kwargs["input_path"],
            Path("/tmp/legacy.doc"),
        )
        self.assertEqual(
            normalize.call_args.kwargs["output_dir"],
            Path("/tmp/out"),
        )
        self.assertEqual(
            normalize.call_args.kwargs["source_object_key"],
            "attachments/example/legacy.doc",
        )
        self.assertEqual(normalize.call_args.kwargs["source_sha256"], "abc123")
        self.assertEqual(
            normalize.call_args.kwargs["source_mime_type"],
            "application/msword",
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["normalized_extension"], ".docx")

    def test_normalize_invokes_soffice_and_returns_provenance_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "legacy-rule.doc"
            input_bytes = b"legacy-doc-binary"
            input_path.write_bytes(input_bytes)
            output_dir = temp_root / "normalized"
            output_path = output_dir / "legacy-rule.docx"
            normalized_bytes = b"normalized-docx-binary"

            def fake_run(
                argv: list[str],
                *,
                capture_output: bool,
                text: bool,
                check: bool,
            ) -> subprocess.CompletedProcess[str]:
                self.assertTrue(capture_output)
                self.assertTrue(text)
                self.assertFalse(check)
                if "--version" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout="LibreOffice 25.2.1.2\n",
                        stderr="",
                    )
                self.assertIn("--convert-to", argv)
                output_dir.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(normalized_bytes)
                return subprocess.CompletedProcess(argv, 0, stdout="convert ok\n", stderr="")

            with (
                patch(
                    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.shutil.which",
                    return_value="/usr/bin/soffice",
                ),
                patch(
                    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.subprocess.run",
                    side_effect=fake_run,
                ),
            ):
                result = worker.normalize_authenticated_notice_legacy_office_attachment(
                    input_path=input_path,
                    output_dir=output_dir,
                    source_object_key="attachments/example/legacy-rule.doc",
                    source_mime_type="application/msword",
                )

        self.assertEqual(result.source_extension, ".doc")
        self.assertEqual(result.normalized_extension, ".docx")
        self.assertEqual(result.output_path, str(output_path))
        self.assertEqual(
            result.source_sha256,
            hashlib.sha256(input_bytes).hexdigest(),
        )
        self.assertEqual(
            result.normalized_sha256,
            hashlib.sha256(normalized_bytes).hexdigest(),
        )
        self.assertEqual(result.normalizer_name, "libreoffice-soffice")
        self.assertEqual(result.normalizer_version, "LibreOffice 25.2.1.2")

    def test_normalize_requires_soffice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "legacy-rule.doc"
            input_path.write_bytes(b"legacy-doc-binary")
            output_dir = Path(temp_dir) / "normalized"

            with patch(
                "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.shutil.which",
                return_value=None,
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "LibreOffice soffice is required",
                ):
                    worker.normalize_authenticated_notice_legacy_office_attachment(
                        input_path=input_path,
                        output_dir=output_dir,
                    )

    def test_normalize_xls_invokes_soffice_and_returns_provenance_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "legacy-score-sheet.xls"
            input_bytes = b"legacy-xls-binary"
            input_path.write_bytes(input_bytes)
            output_dir = temp_root / "normalized"
            output_path = output_dir / "legacy-score-sheet.xlsx"
            normalized_bytes = b"normalized-xlsx-binary"

            def fake_run(
                argv: list[str],
                *,
                capture_output: bool,
                text: bool,
                check: bool,
            ) -> subprocess.CompletedProcess[str]:
                self.assertTrue(capture_output)
                self.assertTrue(text)
                self.assertFalse(check)
                if "--version" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout="LibreOffice 25.2.1.2\n",
                        stderr="",
                    )
                self.assertIn("--convert-to", argv)
                self.assertIn("xlsx", argv)
                output_dir.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(normalized_bytes)
                return subprocess.CompletedProcess(argv, 0, stdout="convert ok\n", stderr="")

            with (
                patch(
                    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.shutil.which",
                    return_value="/usr/bin/soffice",
                ),
                patch(
                    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.subprocess.run",
                    side_effect=fake_run,
                ),
            ):
                result = worker.normalize_authenticated_notice_legacy_office_attachment(
                    input_path=input_path,
                    output_dir=output_dir,
                    source_object_key="attachments/example/legacy-score-sheet.xls",
                    source_mime_type="application/vnd.ms-excel",
                )

        self.assertEqual(result.source_extension, ".xls")
        self.assertEqual(result.normalized_extension, ".xlsx")
        self.assertEqual(result.output_path, str(output_path))
        self.assertEqual(
            result.source_sha256,
            hashlib.sha256(input_bytes).hexdigest(),
        )
        self.assertEqual(
            result.normalized_sha256,
            hashlib.sha256(normalized_bytes).hexdigest(),
        )
        self.assertEqual(result.normalizer_name, "libreoffice-soffice")
        self.assertEqual(result.normalizer_version, "LibreOffice 25.2.1.2")


if __name__ == "__main__":
    unittest.main()
