from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import zipfile

from campus_ingestion_core.file_asset_legacy_office import (
    normalize_legacy_office_asset,
)
from campus_ingestion_core.file_asset_ooxml import (
    extract_docx_text_blocks,
    extract_xlsx_text_blocks,
)
from campus_ingestion_core.file_asset_routing import (
    RawAssetTypedMetadata,
    infer_raw_asset_typed_metadata,
    refine_raw_asset_typed_metadata_with_ocr_evidence,
    select_adjudicated_image_routing,
    select_online_ocr_routing,
)


def _build_minimal_docx_bytes(*, paragraphs: tuple[str, ...]) -> bytes:
    document_xml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        "<w:body>",
    ]
    for paragraph in paragraphs:
        document_xml.append(f"<w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p>")
    document_xml.extend(["<w:sectPr/>", "</w:body>", "</w:document>"])

    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", "\n".join(document_xml))
    return buffer.getvalue()


def _build_formula_xlsx_bytes() -> bytes:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>
"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""
    workbook = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="预算表" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"""
    workbook_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>
"""
    shared_strings = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>项目</t></si>
  <si><t>数量</t></si>
  <si><t>总计</t></si>
</sst>
"""
    worksheet = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>报名人数</t></is></c>
      <c r="B2"><v>2</v></c>
      <c r="C2"><f>SUM(B2:B2)</f><v>2</v></c>
    </row>
  </sheetData>
</worksheet>
"""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/sharedStrings.xml", shared_strings)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return buffer.getvalue()


class FileAssetOoxmlExtractionTest(unittest.TestCase):
    def test_extract_docx_text_blocks_preserves_paragraph_blocks(self) -> None:
        result = extract_docx_text_blocks(
            _build_minimal_docx_bytes(paragraphs=("第一段", "第二段"))
        )

        self.assertEqual(result.text_blocks, ("第一段", "第二段"))
        self.assertEqual(result.provenance.engine_name, "python-docx")

    def test_extract_xlsx_text_blocks_preserves_shared_strings_and_formula_cache(self) -> None:
        result = extract_xlsx_text_blocks(_build_formula_xlsx_bytes())

        self.assertEqual(result.provenance.engine_name, "spreadsheetml-zip-xml")
        self.assertIn("项目 | 数量 | 总计", result.text_blocks[0])
        self.assertIn("报名人数 | 2 | 2 [formula=SUM(B2:B2)]", result.text_blocks[0])


class FileAssetRoutingSubstrateTest(unittest.TestCase):
    def test_infer_raw_asset_typed_metadata_classifies_pdf_as_document_pdf(self) -> None:
        result = infer_raw_asset_typed_metadata(
            source_path=Path("中央民族大学培养方案.pdf"),
            file_bytes=b"%PDF-1.7 sample fixture",
        )

        self.assertEqual(result.asset_kind, "document")
        self.assertEqual(result.asset_subkind, "pdf")
        self.assertEqual(result.file_extension, ".pdf")

    def test_select_online_ocr_routing_prefers_mineru_for_pdf(self) -> None:
        decision = select_online_ocr_routing(
            asset_kind="document",
            asset_subkind="pdf",
            mineru_available=True,
        )

        self.assertTrue(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "pdf_mineru_primary_with_paddle_fallback")
        self.assertEqual(decision.canonical_provider, "mineru_api")
        self.assertEqual(decision.fallback_provider, "paddleocr_async_jobs")

    def test_refined_spatial_image_stays_fail_closed_after_dual_run(self) -> None:
        initial_typed_metadata = RawAssetTypedMetadata(
            content_type="image/png",
            file_extension=".png",
            byte_size=2048,
            page_count=1,
            image_width=1920,
            image_height=1080,
            asset_kind="image",
            asset_subkind="generic_image",
            classification_confidence=1.0,
        )
        candidate_summary = {
            "provider": "mineru_api",
            "usable_output": True,
            "structure_signals": {
                "table_row_count": 0,
                "nonempty_line_count": 2,
                "image_reference_count": 1,
            },
        }
        baseline_summary = {
            "provider": "paddleocr_async_jobs",
            "usable_output": True,
            "structure_signals": {
                "table_row_count": 0,
                "nonempty_line_count": 1,
                "image_reference_count": 0,
            },
        }
        adjudication = {"winner": "candidate", "reason_codes": []}

        refined = refine_raw_asset_typed_metadata_with_ocr_evidence(
            typed_metadata=initial_typed_metadata,
            source_name="campus-map.png",
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
            adjudication=adjudication,
        )
        decision = select_adjudicated_image_routing(
            refined_asset_subkind=refined.asset_subkind,
            candidate_summary=candidate_summary,
            baseline_summary=baseline_summary,
        )

        self.assertEqual(refined.asset_subkind, "spatial_image")
        self.assertFalse(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "spatial_image_deferred")


class LegacyOfficeNormalizationSubstrateTest(unittest.TestCase):
    def test_normalize_legacy_office_asset_converts_xls_to_xlsx_with_provenance(self) -> None:
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
                    "campus_ingestion_core.file_asset_legacy_office.shutil.which",
                    return_value="/usr/bin/soffice",
                ),
                patch(
                    "campus_ingestion_core.file_asset_legacy_office.subprocess.run",
                    side_effect=fake_run,
                ),
            ):
                result = normalize_legacy_office_asset(
                    input_path=input_path,
                    output_dir=output_dir,
                    source_object_key="attachments/example/legacy-score-sheet.xls",
                    source_mime_type="application/vnd.ms-excel",
                )

        self.assertEqual(result.source_extension, ".xls")
        self.assertEqual(result.normalized_extension, ".xlsx")
        self.assertEqual(result.provenance.engine_name, "libreoffice-soffice")
        self.assertEqual(result.provenance.engine_version, "LibreOffice 25.2.1.2")
        self.assertEqual(
            result.source_sha256,
            hashlib.sha256(input_bytes).hexdigest(),
        )
        self.assertEqual(
            result.normalized_sha256,
            hashlib.sha256(normalized_bytes).hexdigest(),
        )


if __name__ == "__main__":
    unittest.main()
