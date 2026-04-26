from __future__ import annotations

import unittest

from .authenticated_notice_source_projection_test_support import *


class AuthenticatedNoticeSourceProjectionAttachmentOcrTest(unittest.TestCase):
    def test_rebuild_authenticated_notice_source_projections_accepts_mineru_provider_and_adapts_payload(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        pdf_bytes = _build_minimal_pdf_bytes()
        bundle = _sample_notice_bundle_with_downloaded_pdf_attachment(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            pdf_bytes=pdf_bytes,
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
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][2]["object_key"]),
                data=pdf_bytes,
                content_type="application/pdf",
            )

            ocr_client = _FakeAttachmentMineruOcrClient()
            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env={
                    **_env(),
                    "OCR_BASE_URL": "https://mineru.example.edu/api/v4",
                    "OCR_API_KEY": "test-token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=ocr_client,
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.projected_attachment_count, 3)
        self.assertEqual(report.ocr_attachment_count, 2)
        self.assertEqual(sorted(ocr_client.calls), ["notice.png", "pdf:supplement.pdf"])

        pdf_child = next(
            record
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0003"
        )
        provider_payload_bytes = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(pdf_child.provider_response_object_key),
        )
        self.assertFalse(provider_payload_bytes.startswith(b"PK"))
        provider_payload = json.loads(provider_payload_bytes.decode("utf-8").splitlines()[0])
        blocks = provider_payload["result"]["layoutParsingResults"][0]["prunedResult"][
            "parsing_res_list"
        ]
        self.assertEqual(blocks[0]["block_label"], "doc_title")
        self.assertEqual(blocks[0]["block_content"], "中央民族大学附件 OCR 标题")
        self.assertIn("字段", blocks[2]["block_content"])

    def test_rebuild_authenticated_notice_source_projections_uses_mineru_primary_with_paddle_fallback_for_ocr_attachments(
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

            mineru_client = _FailingAttachmentMineruOcrClient()
            paddle_client = _FakeAttachmentStructuredOcrClient()
            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env={
                    **_env(),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "paddle-token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example/api/v4",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_clients={
                    "mineru_api": mineru_client,
                    "paddleocr_async_jobs": paddle_client,
                },
            )

        self.assertEqual(report.projected_attachment_count, 2)
        self.assertEqual(mineru_client.calls, ["notice.png"])
        self.assertEqual(paddle_client.calls, ["notice.png"])

        image_child = next(
            record
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0002"
        )
        image_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(image_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("班车时间安排", image_markdown)

    def test_rebuild_authenticated_notice_source_projections_keeps_ocr_no_text_as_relation_only(
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

            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.attachment_ref_count, 3)
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.ocr_no_text_attachment_count, 1)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.errors, ())

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(
            {record.document_id for record in records},
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )

    def test_rebuild_authenticated_notice_source_projections_materializes_structured_ocr_artifacts(
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

            rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=_FakeAttachmentStructuredOcrClient(),
            )

        image_child = next(
            record
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0002"
        )
        self.assertIsNotNone(image_child.provider_response_object_key)
        self.assertIsNotNone(image_child.layout_elements_object_key)
        self.assertIsNotNone(image_child.canonical_markdown_object_key)

        layout_rows = [
            json.loads(line)
            for line in object_store.get_bytes(
                bucket=DERIVED_BUCKET,
                key=str(image_child.layout_elements_object_key),
            )
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertTrue(any(row["row_type"] == "table" for row in layout_rows))
        self.assertTrue(
            any(
                row.get("table_cells")
                == [["时间", "地点"], ["08:00", "海淀校区"], ["17:30", "丰台校区"]]
                for row in layout_rows
            )
        )

        image_units = [
            json.loads(line)
            for line in object_store.get_bytes(
                bucket=DERIVED_BUCKET, key=str(image_child.document_units_object_key)
            )
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertIn("section_text", {row["unit_type"] for row in image_units})
        self.assertIn("table_unit", {row["unit_type"] for row in image_units})
        self.assertFalse(
            any(
                "<table" in str(row.get("clean_text") or "")
                or "<div" in str(row.get("clean_text") or "")
                for row in image_units
            )
        )

        image_markdown = object_store.get_bytes(
            bucket=DERIVED_BUCKET,
            key=str(image_child.canonical_markdown_object_key),
        ).decode("utf-8")
        self.assertIn("班车时间安排", image_markdown)
        self.assertIn("08:00", image_markdown)
        self.assertNotIn("<table", image_markdown)

    def test_rebuild_authenticated_notice_source_projections_routes_downloaded_pdf_attachments_to_ocr(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_minimal_png_bytes()
        pdf_bytes = _build_minimal_pdf_bytes()
        bundle = _sample_notice_bundle_with_downloaded_pdf_attachment(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            pdf_bytes=pdf_bytes,
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
            object_store.put_bytes(
                bucket=SOURCE_BUCKET,
                key=str(bundle[0]["attachments"][2]["object_key"]),
                data=pdf_bytes,
                content_type="application/pdf",
            )

            ocr_client = _FakeAttachmentOcrClient()
            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=ocr_client,
            )

        self.assertEqual(report.parent_notice_count, 1)
        self.assertEqual(report.attachment_ref_count, 3)
        self.assertEqual(report.projected_attachment_count, 3)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 2)
        self.assertEqual(report.reference_only_attachment_count, 0)
        self.assertEqual(ocr_client.calls, ["notice.png", "supplement.pdf"])

        records = document_registry.list_by_scope("campus_notices", "internal_notice")
        pdf_child = next(
            record
            for record in records
            if record.document_id == "notice_attachment:muc_internal_portal:355119:attachment-0003"
        )
        pdf_units = [
            json.loads(line)
            for line in object_store.get_bytes(
                bucket=DERIVED_BUCKET, key=str(pdf_child.document_units_object_key)
            )
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertTrue(pdf_units)
        self.assertTrue(
            all(row["metadata"]["extraction_class"] == "ocr_required" for row in pdf_units)
        )
        self.assertTrue(
            all(
                row["metadata"]["attachment_kind"] == "ocr_document_attachment" for row in pdf_units
            )
        )
        self.assertTrue(
            all(row["metadata"]["attachment_filename"] == "supplement.pdf" for row in pdf_units)
        )

    def test_rebuild_authenticated_notice_source_projections_reuses_ocr_result_for_shared_pdf_payloads(
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

            ocr_client = _FakeAttachmentOcrClient()
            report = rebuild_authenticated_notice_source_projections(
                request=AuthenticatedNoticeSourceProjectionRequest(
                    corpus="campus_notices",
                    collection="internal_notice",
                ),
                env=_env(),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                ocr_client=ocr_client,
            )

        self.assertEqual(report.parent_notice_count, 2)
        self.assertEqual(report.projected_attachment_count, 4)
        self.assertEqual(report.ocr_attachment_count, 3)
        self.assertEqual(ocr_client.calls.count("supplement.pdf"), 1)

    def test_rebuild_authenticated_notice_source_projections_surfaces_attachment_context_when_ocr_fails(
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

            with self.assertRaisesRegex(
                RuntimeError,
                r"notice:muc_internal_portal:355119#attachment-0002 attachment OCR failed: "
                r"provider contract breach for",
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
                    ocr_client=_FailingAttachmentOcrClient(),
                )
