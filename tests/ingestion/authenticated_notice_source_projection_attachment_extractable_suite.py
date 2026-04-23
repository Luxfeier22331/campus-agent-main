from __future__ import annotations

import unittest

from .authenticated_notice_source_projection_test_support import *


class AuthenticatedNoticeSourceProjectionAttachmentExtractableTest(unittest.TestCase):
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

    def test_rebuild_authenticated_notice_source_projections_replaces_scope_and_materializes_attachment_children(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        bundle = _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)

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
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=png_bytes,
                content_type="image/png",
            )

            parent_record = document_registry.list_by_scope("campus_notices", "internal_notice")[0]
            document_registry.upsert(
                replace(
                    parent_record,
                    document_id="notice_attachment:muc_internal_portal:355119:stale",
                    version_id="sha256:stale",
                    content_hash="stale",
                    source_uri="https://portal.example.edu/files/stale.png",
                    document_units_object_key=(
                        "campus_notices/documents/internal_notice/"
                        "notice-attachment-stale/source-faithful/2026/document-units.jsonl"
                    ),
                    provider_response_object_key=None,
                    canonical_markdown_object_key=None,
                    processed_object_keys=(
                        "campus_notices/documents/internal_notice/"
                        "notice-attachment-stale/source-faithful/2026/document-units.jsonl",
                    ),
                    import_source="authenticated_notice_source_projection",
                )
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
        self.assertEqual(report.projected_attachment_count, 2)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.ocr_no_text_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
                "notice_attachment:muc_internal_portal:355119:attachment-0002",
            },
        )

        parent = next(
            record
            for record in records
            if record.document_id == "notice:muc_internal_portal:355119"
        )
        parent_units = [
            json.loads(line)
            for line in object_store.get_bytes(
                bucket=DERIVED_BUCKET, key=str(parent.document_units_object_key)
            )
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertNotIn("attachment_ref", [row["unit_type"] for row in parent_units])

        docx_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0001"
        )
        docx_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(docx_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("projection_name: internal_notice_attachment_documents", docx_markdown)
        self.assertIn("parent_document_id: notice:muc_internal_portal:355119", docx_markdown)
        self.assertIn("报名表正文第一段", docx_markdown)
        self.assertIsNotNone(docx_child.provider_response_object_key)
        docx_payload = json.loads(
            object_store.get_bytes(
                bucket=DERIVED_BUCKET,
                key=str(docx_child.provider_response_object_key),
            ).decode("utf-8")
        )
        self.assertEqual(docx_payload["schema_version"], "file_asset_extraction_record_v1")
        docx_record = parse_file_asset_extraction_record(docx_payload)
        self.assertEqual(docx_record.metadata["attachment_ref_id"], "attachment-0001")
        self.assertEqual(docx_record.metadata["extraction_class"], "text_extractable")
        docx_outcome = docx_record.outcome
        self.assertEqual(docx_outcome.descriptor.filename, "application.docx")
        self.assertEqual(
            docx_outcome.descriptor.source_object_key,
            str(bundle[0]["attachments"][0]["object_key"]),
        )
        self.assertEqual(docx_outcome.provenance.engine_name, "python-docx")
        self.assertEqual(docx_outcome.artifact_refs, ())

        image_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0002"
        )
        image_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(image_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("图片附件 OCR 正文 第一行", image_markdown)

    def test_rebuild_authenticated_notice_source_projections_uses_shared_text_extractable_entrypoint(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        bundle = _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)
        shared_outcome = ExtractionOutcome(
            descriptor=FileAssetDescriptor(
                asset_family="modern_ooxml",
                filename="application.docx",
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                source_object_key=str(bundle[0]["attachments"][0]["object_key"]),
                source_sha256=hashlib.sha256(docx_bytes).hexdigest(),
            ),
            provenance=ArtifactProvenance(
                engine_name="shared-text-extractable-dispatch",
                engine_version="v1",
            ),
            text_blocks=("共享 dispatcher 正文",),
            extraction_strategy="docx_structured_blocks",
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
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=png_bytes,
                content_type="image/png",
            )

            with (
                patch(
                    "campus_ingestion_core.authenticated_notice_source_projections.extract_text_extractable_file_asset",
                    return_value=shared_outcome,
                    create=True,
                ) as shared_extract,
                patch(
                    "campus_ingestion_core.authenticated_notice_source_projections.build_text_extractable_layout_elements_bytes",
                    return_value=None,
                    create=True,
                ),
            ):
                rebuild_authenticated_notice_source_projections(
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

        shared_extract.assert_called_once_with(
            docx_bytes,
            filename="application.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            source_object_key=str(bundle[0]["attachments"][0]["object_key"]),
        )
        docx_child = next(
            record
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0001"
        )
        docx_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(docx_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("共享 dispatcher 正文", docx_markdown)

    def test_rebuild_authenticated_notice_source_projections_prefers_ooxml_structured_layout_when_available(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("旧提取正文",))
        png_bytes = _build_minimal_png_bytes()
        bundle = _sample_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)
        shared_outcome = ExtractionOutcome(
            descriptor=FileAssetDescriptor(
                asset_family="modern_ooxml",
                filename="application.docx",
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                source_object_key=str(bundle[0]["attachments"][0]["object_key"]),
                source_sha256=hashlib.sha256(docx_bytes).hexdigest(),
            ),
            provenance=ArtifactProvenance(
                engine_name="shared-text-extractable-dispatch",
                engine_version="v1",
            ),
            text_blocks=("旧提取正文",),
            extraction_strategy="docx_structured_blocks",
        )
        layout_elements_bytes = (
            "\n".join(
                (
                    json.dumps(
                        {
                            "schema_version": "ooxml_layout_elements_v1",
                            "row_id": "row-0001",
                            "row_index": 1,
                            "row_type": "heading",
                            "heading_level": 1,
                            "text_raw": "结构化标题",
                            "text_normalized": "结构化标题",
                            "source_object_key": str(bundle[0]["attachments"][0]["object_key"]),
                            "source_format": "docx",
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "schema_version": "ooxml_layout_elements_v1",
                            "row_id": "row-0002",
                            "row_index": 2,
                            "row_type": "paragraph",
                            "heading_level": None,
                            "text_raw": "结构化正文",
                            "text_normalized": "结构化正文",
                            "source_object_key": str(bundle[0]["attachments"][0]["object_key"]),
                            "source_format": "docx",
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            + "\n"
        ).encode("utf-8")

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
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][0]["object_key"]),
                data=docx_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][1]["object_key"]),
                data=png_bytes,
                content_type="image/png",
            )

            with (
                patch(
                    "campus_ingestion_core.authenticated_notice_source_projections.extract_text_extractable_file_asset",
                    return_value=shared_outcome,
                    create=True,
                ) as shared_extract,
                patch(
                    "campus_ingestion_core.authenticated_notice_source_projections.build_text_extractable_layout_elements_bytes",
                    return_value=layout_elements_bytes,
                    create=True,
                ) as build_layout,
            ):
                rebuild_authenticated_notice_source_projections(
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

        shared_extract.assert_called_once()
        build_layout.assert_called_once_with(
            docx_bytes,
            filename="application.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            source_object_key=str(bundle[0]["attachments"][0]["object_key"]),
        )
        docx_child = next(
            record
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0001"
        )
        self.assertIsNotNone(docx_child.layout_elements_object_key)
        docx_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(docx_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("结构化标题", docx_markdown)
        self.assertIn("结构化正文", docx_markdown)
        self.assertNotIn("旧提取正文", docx_markdown)
        layout_rows = [
            json.loads(line)
            for line in object_store.get_bytes(
                bucket=DERIVED_BUCKET,
                key=str(docx_child.layout_elements_object_key),
            )
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertEqual([row["row_type"] for row in layout_rows], ["heading", "paragraph"])

    def test_rebuild_authenticated_notice_source_projections_notice_id_filter_keeps_unselected_scope_rows(
        self,
    ) -> None:
        pdf_bytes = _build_minimal_pdf_bytes()
        bundle = _sample_notice_bundle_pair_with_shared_downloaded_pdf_attachment(
            pdf_bytes=pdf_bytes
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
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            uploaded_keys: set[str] = set()
            for record in bundle:
                for attachment in record["attachments"]:
                    key = str(attachment["object_key"])
                    if key in uploaded_keys:
                        continue
                    uploaded_keys.add(key)
                    filename = str(attachment["original_filename"])
                    if filename.endswith(".docx"):
                        data = _build_minimal_docx_bytes(
                            paragraphs=("报名表正文第一段", "报名表正文第二段")
                        )
                        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    elif filename.endswith(".png"):
                        data = _build_minimal_png_bytes()
                        content_type = "image/png"
                    else:
                        data = pdf_bytes
                        content_type = "application/pdf"
                    object_store.put_bytes(
                        bucket=SOURCE_BUCKET,
                        key=key,
                        data=data,
                        content_type=content_type,
                    )

            rebuild_authenticated_notice_source_projections(
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
            filtered_report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                    notice_ids=("355119",),
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentOcrClient(),
            )

        self.assertEqual(filtered_report.parent_notice_count, 1)
        self.assertEqual(filtered_report.attachment_ref_count, 3)
        self.assertEqual(filtered_report.projected_attachment_count, 3)
        self.assertEqual(filtered_report.text_extractable_attachment_count, 1)
        self.assertEqual(filtered_report.ocr_attachment_count, 2)
        self.assertEqual(filtered_report.reference_only_attachment_count, 0)

        self.assertEqual(
            {
                record.document_id
                for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            },
            {
                "notice:muc_internal_portal:355119",
                "notice:muc_internal_portal:355120",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
                "notice_attachment:muc_internal_portal:355119:attachment-0002",
                "notice_attachment:muc_internal_portal:355119:attachment-0003",
                "notice_attachment:muc_internal_portal:355120:attachment-0001",
            },
        )
