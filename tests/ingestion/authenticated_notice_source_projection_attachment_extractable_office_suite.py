from .authenticated_notice_source_projection_attachment_extractable_support import *


class AuthenticatedNoticeSourceProjectionAttachmentExtractableOfficeTest(
    AuthenticatedNoticeSourceProjectionAttachmentExtractableBaseTest
):
    def test_rebuild_authenticated_notice_source_projections_materializes_downloaded_xlsx_attachment(
        self,
    ) -> None:
        xlsx_bytes = _build_minimal_xlsx_bytes()
        bundle = _sample_notice_bundle_with_downloaded_spreadsheet_attachment(
            spreadsheet_bytes=xlsx_bytes,
            filename="course-plan.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=xlsx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=_build_minimal_png_bytes(),
                content_type="image/png",
            )

            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentOcrClient(),
            )

        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        spreadsheet_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0001"
        )
        spreadsheet_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(spreadsheet_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("姓名", spreadsheet_markdown)
        self.assertIn("张三", spreadsheet_markdown)
        self.assertIn("2026001", spreadsheet_markdown)

    def test_rebuild_authenticated_notice_source_projections_skips_unsupported_binary_attachment(
        self,
    ) -> None:
        zip_bytes = b"PK\x03\x04unsupported-binary-fixture"
        bundle = _sample_notice_bundle_with_downloaded_spreadsheet_attachment(
            spreadsheet_bytes=zip_bytes,
            filename="unsupported-materials.zip",
            mime_type="application/zip",
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=zip_bytes,
                content_type="application/zip",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=_build_minimal_png_bytes(),
                content_type="image/png",
            )

            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentOcrClient(),
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.attachment_ref_count, 3)
        self.assertEqual(report.unsupported_binary_attachment_count, 1)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0002",
            },
        )

    def test_rebuild_authenticated_notice_source_projections_materializes_downloaded_xls_attachment(
        self,
    ) -> None:
        xls_bytes = b"placeholder-xls-binary"
        bundle = _sample_notice_bundle_with_downloaded_spreadsheet_attachment(
            spreadsheet_bytes=xls_bytes,
            filename="course-plan.xls",
            mime_type="application/vnd.ms-excel",
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=xls_bytes,
                content_type="application/vnd.ms-excel",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=_build_minimal_png_bytes(),
                content_type="image/png",
            )

            with patch(
                "campus_ingestion_core.file_asset_text_extractable.extract_legacy_office_text_blocks",
                return_value=ExtractionOutcome(
                    descriptor=FileAssetDescriptor(
                        asset_family="legacy_binary_office",
                        filename="course-plan.xls",
                        media_type="application/vnd.ms-excel",
                        source_object_key=str(bundle[0]["attachments"][0]["object_key"]),
                        source_sha256=hashlib.sha256(xls_bytes).hexdigest(),
                    ),
                    provenance=ArtifactProvenance(
                        engine_name="libreoffice-soffice+spreadsheetml-zip-xml",
                        engine_version="LibreOffice 25.2.1.2;spreadsheetml-zip-xml-v1",
                        warnings=("normalized_via_legacy_office_conversion",),
                    ),
                    text_blocks=("工作表：Sheet1\n姓名 | 张三",),
                    extraction_strategy="legacy_office_conversion_then_xlsx_structured_blocks",
                ),
                create=True,
            ) as extract_legacy_office:
                report = rebuild_authenticated_notice_source_projections(
                    request=AuthenticatedNoticeSourceProjectionRequest(
                        corpus="campus_notices",
                        collection="internal_notice",
                    ),
                    env=_env(),
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    ocr_client=_FakeAttachmentOcrClient(),
                )
                self.assertTrue(extract_legacy_office.called)

        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        spreadsheet_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0001"
        )
        spreadsheet_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(spreadsheet_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("工作表：Sheet1", spreadsheet_markdown)
        self.assertIn("姓名 | 张三", spreadsheet_markdown)
        self.assertIsNotNone(spreadsheet_child.provider_response_object_key)
        spreadsheet_payload = json.loads(
            object_store.get_bytes(
                bucket=DERIVED_BUCKET,
                key=str(spreadsheet_child.provider_response_object_key),
            ).decode("utf-8")
        )
        self.assertEqual(spreadsheet_payload["schema_version"], "file_asset_extraction_record_v1")
        spreadsheet_record = parse_file_asset_extraction_record(spreadsheet_payload)
        self.assertEqual(spreadsheet_record.metadata["attachment_ref_id"], "attachment-0001")
        self.assertEqual(spreadsheet_record.metadata["extraction_class"], "text_extractable")
        self.assertEqual(
            spreadsheet_record.outcome.provenance.warnings,
            ("normalized_via_legacy_office_conversion",),
        )
        self.assertEqual(
            spreadsheet_record.outcome.descriptor.source_object_key,
            str(bundle[0]["attachments"][0]["object_key"]),
        )
