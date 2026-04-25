from __future__ import annotations

import hashlib
import importlib
import io
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.file_asset_contract import (
    ArtifactProvenance,
    FileAssetArtifactRef,
    FileAssetDescriptor,
)

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
                descriptor=FileAssetDescriptor(
                    asset_family="legacy_binary_office",
                    filename="legacy.doc",
                    media_type="application/msword",
                    source_object_key="attachments/example/legacy.doc",
                    source_sha256="abc123",
                ),
                provenance=ArtifactProvenance(
                    engine_name="jodconverter+libreoffice",
                    engine_version="7.6.7",
                ),
                normalized_extension=".docx",
                normalized_sha256="def456",
                artifact_refs=(
                    FileAssetArtifactRef(
                        role="normalized_object",
                        object_key="campus_notices/operations/normalized/legacy.docx",
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    ),
                ),
                input_path="/tmp/legacy.doc",
                output_path="/tmp/out/legacy.docx",
                source_extension=".doc",
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
                    "--normalized-object-key",
                    "campus_notices/operations/normalized/legacy.docx",
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
        self.assertEqual(
            normalize.call_args.kwargs["normalized_object_key"],
            "campus_notices/operations/normalized/legacy.docx",
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["outcome_type"], "normalization")
        self.assertEqual(payload["normalized_extension"], ".docx")
        self.assertEqual(
            payload["descriptor"]["source_object_key"], "attachments/example/legacy.doc"
        )
        self.assertEqual(payload["provenance"]["engine_name"], "jodconverter+libreoffice")
        self.assertEqual(
            payload["artifact_refs"][0]["object_key"],
            "campus_notices/operations/normalized/legacy.docx",
        )

    def test_normalize_uses_service_client_and_returns_provenance_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "legacy-rule.doc"
            input_bytes = b"legacy-doc-binary"
            input_path.write_bytes(input_bytes)
            output_dir = temp_root / "normalized"
            output_path = output_dir / "legacy-rule.docx"
            normalized_bytes = b"normalized-docx-binary"

            result = worker.normalize_authenticated_notice_legacy_office_attachment(
                input_path=input_path,
                output_dir=output_dir,
                source_object_key="attachments/example/legacy-rule.doc",
                source_mime_type="application/msword",
                normalized_object_key="campus_notices/operations/normalized/legacy-rule.docx",
                conversion_client=SimpleNamespace(
                    convert=lambda request: SimpleNamespace(
                        target_format="docx",
                        normalized_media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        normalized_sha256=hashlib.sha256(normalized_bytes).hexdigest(),
                        normalized_bytes=normalized_bytes,
                        engine_name="jodconverter+libreoffice",
                        engine_version="7.6.7",
                        warnings=(),
                    )
                ),
            )

        self.assertEqual(result.source_extension, ".doc")
        self.assertEqual(result.normalized_extension, ".docx")
        self.assertEqual(result.output_path, str(output_path))
        self.assertEqual(result.descriptor.filename, "legacy-rule.doc")
        self.assertEqual(result.descriptor.source_object_key, "attachments/example/legacy-rule.doc")
        self.assertEqual(
            result.artifact_refs[0].object_key,
            "campus_notices/operations/normalized/legacy-rule.docx",
        )
        self.assertEqual(
            result.source_sha256,
            hashlib.sha256(input_bytes).hexdigest(),
        )
        self.assertEqual(
            result.normalized_sha256,
            hashlib.sha256(normalized_bytes).hexdigest(),
        )
        self.assertEqual(result.provenance.engine_name, "jodconverter+libreoffice")
        self.assertEqual(result.provenance.engine_version, "7.6.7")

    def test_normalize_fails_close_when_service_is_not_configured(self) -> None:
        with TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "legacy-rule.doc"
            input_path.write_bytes(b"legacy-doc-binary")
            output_dir = Path(temp_dir) / "normalized"

            with (
                patch.dict(
                    os.environ,
                    {
                        "LEGACY_OFFICE_CONVERSION_BASE_URL": "",
                        "LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET": "",
                    },
                ),
                self.assertRaisesRegex(
                    RuntimeError,
                    "legacy Office conversion service is not configured",
                ),
            ):
                worker.normalize_authenticated_notice_legacy_office_attachment(
                    input_path=input_path,
                    output_dir=output_dir,
                )

    def test_normalize_xls_uses_service_client_and_returns_provenance_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "legacy-score-sheet.xls"
            input_bytes = b"legacy-xls-binary"
            input_path.write_bytes(input_bytes)
            output_dir = temp_root / "normalized"
            output_path = output_dir / "legacy-score-sheet.xlsx"
            normalized_bytes = b"normalized-xlsx-binary"

            result = worker.normalize_authenticated_notice_legacy_office_attachment(
                input_path=input_path,
                output_dir=output_dir,
                source_object_key="attachments/example/legacy-score-sheet.xls",
                source_mime_type="application/vnd.ms-excel",
                normalized_object_key="campus_notices/operations/normalized/legacy-score-sheet.xlsx",
                conversion_client=SimpleNamespace(
                    convert=lambda request: SimpleNamespace(
                        target_format="xlsx",
                        normalized_media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        normalized_sha256=hashlib.sha256(normalized_bytes).hexdigest(),
                        normalized_bytes=normalized_bytes,
                        engine_name="jodconverter+libreoffice",
                        engine_version="7.6.7",
                        warnings=(),
                    )
                ),
            )

        self.assertEqual(result.source_extension, ".xls")
        self.assertEqual(result.normalized_extension, ".xlsx")
        self.assertEqual(result.output_path, str(output_path))
        self.assertEqual(result.descriptor.filename, "legacy-score-sheet.xls")
        self.assertEqual(
            result.descriptor.source_object_key,
            "attachments/example/legacy-score-sheet.xls",
        )
        self.assertEqual(
            result.artifact_refs[0].object_key,
            "campus_notices/operations/normalized/legacy-score-sheet.xlsx",
        )
        self.assertEqual(
            result.source_sha256,
            hashlib.sha256(input_bytes).hexdigest(),
        )
        self.assertEqual(
            result.normalized_sha256,
            hashlib.sha256(normalized_bytes).hexdigest(),
        )
        self.assertEqual(result.provenance.engine_name, "jodconverter+libreoffice")
        self.assertEqual(result.provenance.engine_version, "7.6.7")


if __name__ == "__main__":
    unittest.main()
