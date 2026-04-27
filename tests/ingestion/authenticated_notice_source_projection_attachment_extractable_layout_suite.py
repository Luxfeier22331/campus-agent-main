from .authenticated_notice_source_projection_attachment_extractable_support import *


class AuthenticatedNoticeSourceProjectionAttachmentExtractableLayoutTest(
    AuthenticatedNoticeSourceProjectionAttachmentExtractableBaseTest
):
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
                    mode="admit_and_materialize",
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
