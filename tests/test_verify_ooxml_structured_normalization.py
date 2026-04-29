from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.verify_ooxml_structured_normalization import (
    OoxmlStructuredNormalizationVerificationError,
    load_ooxml_verification_samples,
    validate_xlsx_forward_fill_prefix,
)


class VerifyOoxmlStructuredNormalizationTest(unittest.TestCase):
    def test_load_ooxml_verification_samples_reads_docx_and_xlsx_entries(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = root / "sample.docx"
            xlsx_path = root / "sample.xlsx"
            docx_path.write_bytes(b"docx")
            xlsx_path.write_bytes(b"xlsx")
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "samples": [
                            {
                                "sample_kind": "doc",
                                "source_object_key": "source/doc",
                                "source_filename": "sample.doc",
                                "normalized_path": str(docx_path),
                                "target_format": "docx",
                            },
                            {
                                "sample_kind": "xls",
                                "source_object_key": "source/xls",
                                "source_filename": "sample.xls",
                                "normalized_path": str(xlsx_path),
                                "target_format": "xlsx",
                            },
                        ]
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            samples = load_ooxml_verification_samples(manifest_path)

        self.assertEqual([sample.target_format for sample in samples], ["docx", "xlsx"])

    def test_load_ooxml_verification_samples_fails_closed_when_file_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "samples": [
                            {
                                "sample_kind": "doc",
                                "source_object_key": "source/doc",
                                "source_filename": "sample.doc",
                                "normalized_path": str(root / "missing.docx"),
                                "target_format": "docx",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaises(OoxmlStructuredNormalizationVerificationError):
                load_ooxml_verification_samples(manifest_path)

    def test_validate_xlsx_forward_fill_prefix_rejects_interior_forward_fill(self) -> None:
        self.assertTrue(
            validate_xlsx_forward_fill_prefix(
                [
                    {"row": 2, "col": 1, "is_forward_filled": True},
                    {"row": 2, "col": 2, "is_forward_filled": False},
                    {"row": 2, "col": 4, "is_forward_filled": False},
                ]
            )
        )
        self.assertFalse(
            validate_xlsx_forward_fill_prefix(
                [
                    {"row": 2, "col": 1, "is_forward_filled": True},
                    {"row": 2, "col": 3, "is_forward_filled": True},
                    {"row": 2, "col": 2, "is_forward_filled": False},
                    {"row": 2, "col": 4, "is_forward_filled": False},
                ]
            )
        )


if __name__ == "__main__":
    unittest.main()
