from __future__ import annotations

import unittest

from .authenticated_notice_source_projection_test_support import *  # noqa: F401,F403


class AuthenticatedNoticeSourceProjectionInlineImageContextTest(unittest.TestCase):
    def test_rebuild_authenticated_notice_source_projections_routes_compact_mobile_ui_screenshots_to_reference_only_when_body_already_carries_the_instruction(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_compact_mobile_screenshot_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>需通过官方报名小程序完成作品上传。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>提交后等待审核。</p>"
            ),
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_contextual_small_program_codes_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_small_program_code_like_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>扫描下方二维码下载相关文本。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>请按要求完成提交。</p>"
            ),
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_tiny_decorative_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_tiny_decorative_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>证书与奖励</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>所有城市阶段优秀选手均可获得证书。</p>"
            ),
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_intro_poster_inline_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_promotional_banner_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>共同开展第六届“用英语讲中国故事大会”中央民族大学专场活动。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="image.png" /></p>'
                "<p>“用英语讲中国故事大会”活动旨在为青年学生搭建深入理解中华文化、与世界文明对话的桥梁。</p>"
            ),
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_routes_social_practice_hero_images_to_reference_only(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_activity_notice_inline_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开展“知行中华”铸魂育人工程——中央民族大学2026年大学生寒假社会实践活动的通知</h1>"
                "<p>学校拟于2026年1月-3月组织开展“知行中华”铸魂育人工程——中央民族大学2026年大学生寒假社会实践活动。</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="3.png" /></p>'
                "<p>一、活动主题</p>"
                "<p>青春返乡行，奋进新时代</p>"
                "<p>二、活动时间</p>"
                "<p>2026年1月-3月</p>"
            ),
            image_link_text="3.png",
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
        self.assertEqual(report.projected_attachment_count, 1)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 0)
        self.assertEqual(report.reference_only_attachment_count, 2)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, [])

    def test_rebuild_authenticated_notice_source_projections_keeps_scoring_table_inline_images_in_ocr_lane(
        self,
    ) -> None:
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表正文第一段", "报名表正文第二段"))
        png_bytes = _build_table_like_png_bytes()
        bundle = _sample_notice_bundle_with_inline_image_context(
            docx_bytes=docx_bytes,
            png_bytes=png_bytes,
            notice_content=(
                "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                "<p>5. 评分标准</p>"
                "<p>本阶段注重考察选手的沟通自信与文化自信，综合评价其语言表达能力，具体维度如下：</p>"
                '<p><img src="https://portal.example.edu/files/notice.png" alt="1769304903305.png" /></p>'
                "<p>评审将围绕发音准确性、语调自然度、用词恰当性、表达逻辑性以及整体表现力等方面进行综合评价。</p>"
            ),
            image_link_text="1769304903305.png",
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
        self.assertEqual(report.projected_attachment_count, 2)
        self.assertEqual(report.text_extractable_attachment_count, 1)
        self.assertEqual(report.ocr_attachment_count, 1)
        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(report.manual_review_attachment_count, 0)
        self.assertEqual(ocr_client.calls, ["notice.png"])

    def test_classify_attachment_ref_routes_operational_schedule_inline_images_to_manual_review(
        self,
    ) -> None:
        png_bytes = _build_table_like_png_bytes()
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        settings = ObjectStoreSettings.from_env(_env())
        object_store = _FakeObjectStore()
        object_key = (
            "authenticated_notice_portal/attachment-operational-schedule/2026/sha256/"
            f"{hashlib.sha256(png_bytes).hexdigest()}/capture/notice.png"
        )
        object_store.put_bytes(
            bucket=settings.bucket_source,
            key=object_key,
            data=png_bytes,
            content_type="image/png",
        )

        result = _classify_attachment_ref(
            attachment_ref={
                "attachment_ref_id": "attachment-0002",
                "source_url": "https://portal.example.edu/files/notice.png",
                "normalized_source_url": "https://portal.example.edu/files/notice.png",
                "final_url": "https://portal.example.edu/files/notice.png",
                "anchor_text": "选课时间安排.png",
                "resource_role": "inline_image",
                "object_key": object_key,
                "content_sha256": hashlib.sha256(png_bytes).hexdigest(),
                "mime_type": "image/png",
                "byte_size": len(png_bytes),
            },
            config=config,
            object_store=object_store,
            object_store_settings=settings,
            attachment_context_by_ref_id={
                "attachment-0002": (
                    "关于2025-2026学年第二学期本科生网上选课的通知 "
                    "附件：2025-2026学年第二学期选课时间安排 "
                    "请同学们按照选课时间安排完成操作。"
                )
            },
        )

        self.assertEqual(result.classification, "manual_review_required")

    def test_classify_attachment_ref_keeps_scoring_table_inline_images_in_ocr_lane(
        self,
    ) -> None:
        png_bytes = _build_table_like_png_bytes()
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        settings = ObjectStoreSettings.from_env(_env())
        object_store = _FakeObjectStore()
        object_key = (
            "authenticated_notice_portal/attachment-scoring-table/2026/sha256/"
            f"{hashlib.sha256(png_bytes).hexdigest()}/capture/notice.png"
        )
        object_store.put_bytes(
            bucket=settings.bucket_source,
            key=object_key,
            data=png_bytes,
            content_type="image/png",
        )

        result = _classify_attachment_ref(
            attachment_ref={
                "attachment_ref_id": "attachment-0002",
                "source_url": "https://portal.example.edu/files/notice.png",
                "normalized_source_url": "https://portal.example.edu/files/notice.png",
                "final_url": "https://portal.example.edu/files/notice.png",
                "anchor_text": "1769304903305.png",
                "resource_role": "inline_image",
                "object_key": object_key,
                "content_sha256": hashlib.sha256(png_bytes).hexdigest(),
                "mime_type": "image/png",
                "byte_size": len(png_bytes),
            },
            config=config,
            object_store=object_store,
            object_store_settings=settings,
            attachment_context_by_ref_id={
                "attachment-0002": (
                    "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知 "
                    "5.评分标准 "
                    "综合评价其语言表达能力，具体维度如下： "
                    "评审将围绕发音准确性、语调自然度、用词恰当性以及整体表现力等方面进行综合评价。"
                )
            },
        )

        self.assertEqual(result.classification, "ocr_required")
