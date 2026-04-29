from .file_asset_substrate_support import *


class FileAssetTextExtractableDispatcherTest(unittest.TestCase):
    def test_extract_text_extractable_file_asset_routes_doc_to_shared_legacy_seam(self) -> None:
        expected = ExtractionOutcome(
            descriptor=FileAssetDescriptor(
                asset_family="legacy_binary_office",
                filename="制度正文.doc",
                media_type="application/msword",
                source_object_key="source/notice-001.doc",
                source_sha256="hash",
            ),
            provenance=ArtifactProvenance(
                engine_name="libreoffice-soffice+wordprocessingml-zip-xml",
                engine_version="LibreOffice 25.2.1.2;wordprocessingml-zip-xml-v1",
            ),
            text_blocks=("制度正文第一段",),
            extraction_strategy="legacy_office_conversion_then_docx_text_blocks",
        )

        with patch(
            "campus_ingestion_core.file_asset_text_extractable.extract_legacy_office_text_blocks",
            return_value=expected,
        ) as extract_legacy_office:
            result = extract_text_extractable_file_asset(
                b"legacy-doc",
                filename="制度正文.doc",
                media_type="application/msword",
                source_object_key="source/notice-001.doc",
            )

        self.assertIs(result, expected)
        extract_legacy_office.assert_called_once_with(
            b"legacy-doc",
            filename="制度正文.doc",
            media_type="application/msword",
            source_object_key="source/notice-001.doc",
        )

    def test_extract_text_extractable_file_asset_routes_xls_to_shared_legacy_seam(self) -> None:
        expected = ExtractionOutcome(
            descriptor=FileAssetDescriptor(
                asset_family="legacy_binary_office",
                filename="报名表.xls",
                media_type="application/vnd.ms-excel",
                source_object_key="source/notice-001.xls",
                source_sha256="hash",
            ),
            provenance=ArtifactProvenance(
                engine_name="libreoffice-soffice+spreadsheetml-zip-xml",
                engine_version="LibreOffice 25.2.1.2;spreadsheetml-zip-xml-v1",
            ),
            text_blocks=("Sheet1\n姓名 | 张三",),
            extraction_strategy="legacy_office_conversion_then_xlsx_structured_blocks",
        )

        with patch(
            "campus_ingestion_core.file_asset_text_extractable.extract_legacy_office_text_blocks",
            return_value=expected,
        ) as extract_legacy_office:
            result = extract_text_extractable_file_asset(
                b"legacy-xls",
                filename="报名表.xls",
                media_type="application/vnd.ms-excel",
                source_object_key="source/notice-001.xls",
            )

        self.assertIs(result, expected)
        extract_legacy_office.assert_called_once_with(
            b"legacy-xls",
            filename="报名表.xls",
            media_type="application/vnd.ms-excel",
            source_object_key="source/notice-001.xls",
        )
