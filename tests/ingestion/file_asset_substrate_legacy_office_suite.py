from .file_asset_substrate_support import *


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

            result = normalize_legacy_office_asset(
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
        self.assertIsInstance(result, NormalizationOutcome)
        self.assertEqual(result.normalized_extension, ".xlsx")
        self.assertEqual(result.output_path, str(output_path))
        self.assertEqual(result.descriptor.asset_family, "legacy_binary_office")
        self.assertEqual(result.descriptor.filename, "legacy-score-sheet.xls")
        self.assertEqual(
            result.descriptor.source_object_key,
            "attachments/example/legacy-score-sheet.xls",
        )
        self.assertEqual(
            result.artifact_refs,
            (
                FileAssetArtifactRef(
                    role="normalized_object",
                    object_key="campus_notices/operations/normalized/legacy-score-sheet.xlsx",
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ),
            ),
        )
        self.assertEqual(result.provenance.engine_name, "jodconverter+libreoffice")
        self.assertEqual(result.provenance.engine_version, "7.6.7")
        self.assertEqual(
            result.source_sha256,
            hashlib.sha256(input_bytes).hexdigest(),
        )
        self.assertEqual(
            result.normalized_sha256,
            hashlib.sha256(normalized_bytes).hexdigest(),
        )

    def test_extract_legacy_office_text_blocks_converts_xls_via_shared_normalization(self) -> None:
        normalized_bytes = _build_formula_xlsx_bytes()

        result = extract_legacy_office_text_blocks(
            b"legacy-xls-binary",
            filename="legacy-score-sheet.xls",
            media_type="application/vnd.ms-excel",
            source_object_key="attachments/example/legacy-score-sheet.xls",
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

        self.assertEqual(result.descriptor.asset_family, "legacy_binary_office")
        self.assertEqual(result.descriptor.filename, "legacy-score-sheet.xls")
        self.assertEqual(
            result.descriptor.source_object_key,
            "attachments/example/legacy-score-sheet.xls",
        )
        self.assertEqual(
            result.provenance.engine_name,
            "jodconverter+libreoffice+spreadsheetml-zip-xml",
        )
        self.assertIn("normalized_via_legacy_office_conversion", result.provenance.warnings)
        self.assertIn("项目 | 数量 | 总计", result.text_blocks[0])
        self.assertIn("报名人数 | 2 | 2 [formula=SUM(B2:B2)]", result.text_blocks[0])

    def test_normalize_legacy_office_asset_fails_close_when_service_is_not_configured(self) -> None:
        with TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "legacy-score-sheet.xls"
            input_path.write_bytes(b"legacy-xls-binary")
            output_dir = temp_root / "normalized"

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
                normalize_legacy_office_asset(
                    input_path=input_path,
                    output_dir=output_dir,
                )
