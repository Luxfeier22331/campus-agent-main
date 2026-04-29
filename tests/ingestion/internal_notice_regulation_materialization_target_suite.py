from __future__ import annotations

from .internal_notice_regulation_materialization_test_support import *


class InternalNoticeRegulationMaterializationTargetTest(unittest.TestCase):
    def test_materialize_requires_configured_projection_store_when_not_injected(
        self,
    ) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        with (
            unittest.mock.patch(
                "campus_ingestion_core.internal_notice_regulation_materialization.build_notice_consumption_projection_store_from_env",
                side_effect=ValueError("projection store is required"),
            ),
            self.assertRaisesRegex(ValueError, "projection store is required"),
        ):
            materialize(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                },
                object_store=_FakeObjectStore(),
                registry=InMemoryDocumentRegistry(()),
                raw_asset_registry=InMemoryRawAssetRegistry(()),
            )

    def test_materialize_from_internal_notice_scope_builds_target_documents_and_replaces_scope(
        self,
    ) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        parent_1 = _record(
            document_id="notice:muc_internal_portal:100001",
            source_uri="https://portal.example.edu/notices/100001",
            canonical_key="campus_notices/documents/internal_notice/100001/canonical.md",
            units_key="campus_notices/documents/internal_notice/100001/document-units.jsonl",
            content_hash="sha256:parent-100001",
        )
        attachment_1 = _record(
            document_id="notice_attachment:muc_internal_portal:100001:attachment-0001",
            source_uri="https://portal.example.edu/files/100001.docx",
            canonical_key="campus_notices/documents/internal_notice/100001-attachment-1/canonical.md",
            units_key="campus_notices/documents/internal_notice/100001-attachment-1/document-units.jsonl",
            content_hash="sha256:attachment-guideline",
            is_current=True,
        )
        parent_2 = _record(
            document_id="notice:muc_internal_portal:100002",
            source_uri="https://portal.example.edu/notices/100002",
            canonical_key="campus_notices/documents/internal_notice/100002/canonical.md",
            units_key="campus_notices/documents/internal_notice/100002/document-units.jsonl",
            content_hash="sha256:parent-100002",
        )
        attachment_2 = _record(
            document_id="notice_attachment:muc_internal_portal:100002:attachment-0001",
            source_uri="https://portal.example.edu/files/100002.docx",
            canonical_key="campus_notices/documents/internal_notice/100002-attachment-1/canonical.md",
            units_key="campus_notices/documents/internal_notice/100002-attachment-1/document-units.jsonl",
            content_hash="sha256:attachment-guideline-copy",
        )
        parent_3 = _record(
            document_id="notice:muc_internal_portal:100003",
            source_uri="https://portal.example.edu/notices/100003",
            canonical_key="campus_notices/documents/internal_notice/100003/canonical.md",
            units_key="campus_notices/documents/internal_notice/100003/document-units.jsonl",
            content_hash="sha256:parent-100003",
            is_current=True,
        )
        stale_target = _regulation_record("institutional_regulation:muc:stale-regulation:stale1234")

        registry = InMemoryDocumentRegistry(
            (parent_1, attachment_1, parent_2, attachment_2, parent_3, stale_target)
        )
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="100001",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                    attachment_projection_plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": attachment_1.document_id,
                            "materialization_policy": "required_document",
                            "attachment_content_sha256": "sha256-guideline",
                        },
                    ),
                ),
                _inventory_entry(
                    notice_id="100002",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）",
                    attachment_projection_plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": attachment_2.document_id,
                            "materialization_policy": "required_document",
                            "attachment_content_sha256": "sha256-guideline",
                        },
                    ),
                ),
                _inventory_entry(
                    notice_id="100003",
                    notice_title="中央民族大学实验室安全管理规定（2026年修订）",
                    published_date="2026-02-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent_1.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知\n\n现将《中央民族大学关于学生使用人工智能的指导意见（2026版）》予以发布，请遵照执行。\n"
                ),
                (
                    "campus-rag-derived",
                    attachment_1.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n第二条 本指导意见适用于全体在校学生。\n"
                ),
                ("campus-rag-derived", parent_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）\n\n请相关单位参照附件执行。\n"
                ),
                (
                    "campus-rag-derived",
                    attachment_2.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n第二条 本指导意见适用于全体在校学生。\n"
                ),
                ("campus-rag-derived", parent_3.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《中央民族大学实验室安全管理规定》的通知\n\n学校各单位、各部门：\n\n为进一步加强实验室安全管理，现将有关事项通知如下：\n\n2026年2月1日起施行。\n\n第一条 为加强实验室安全管理，制定本规定。\n第二条 实验室实行分级分类安全管理。\n第三条 各实验室应建立日常巡检制度。\n\n特此通知。\n"
                ),
                ("campus-rag-derived", parent_1.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent_1.document_id,
                            "version_id": parent_1.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                            "source_url": parent_1.source_uri,
                            "page_start": 1,
                            "page_end": 1,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", attachment_1.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": attachment_1.document_id,
                            "version_id": attachment_1.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "source_url": attachment_1.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "中央民族大学关于学生使用人工智能的指导意见（2026版）"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", parent_2.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent_2.document_id,
                            "version_id": parent_2.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）",
                            "source_url": parent_2.source_uri,
                            "page_start": 3,
                            "page_end": 3,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", attachment_2.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": attachment_2.document_id,
                            "version_id": attachment_2.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "source_url": attachment_2.source_uri,
                            "page_start": 3,
                            "page_end": 4,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "中央民族大学关于学生使用人工智能的指导意见（2026版）"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", parent_3.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent_3.document_id,
                            "version_id": parent_3.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于修订《中央民族大学实验室安全管理规定》的通知",
                            "source_url": parent_3.source_uri,
                            "page_start": 5,
                            "page_end": 7,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "关于修订《中央民族大学实验室安全管理规定》的通知"
                            },
                        }
                    ]
                ),
            }
        )

        report = materialize(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=InMemoryNoticeConsumptionProjectionStore(
                (
                    _ready_institutional_projection_entry(
                        notice_id="100001",
                        source_document_id=attachment_1.document_id,
                    ),
                    _ready_institutional_projection_entry(
                        notice_id="100002",
                        source_document_id=attachment_2.document_id,
                    ),
                    _ready_institutional_projection_entry(
                        notice_id="100003",
                        source_document_id=parent_3.document_id,
                    ),
                )
            ),
        )

        self.assertEqual(report.promotion_candidate_count, 2)
        self.assertEqual(report.materialized_document_count, 2)
        self.assertEqual(len(report.created_document_ids), 2)
        self.assertEqual(report.updated_document_ids, ())
        self.assertTrue(
            report.raw_asset_id.startswith("asset:internal-notice-regulation-promotion")
        )
        raw_record = raw_asset_registry.get(report.raw_asset_id, report.raw_version_id)
        self.assertIsNotNone(raw_record)
        if raw_record is None:
            return
        self.assertEqual(raw_record.collection, "institutional_rules")

        target_records = registry.list_by_scope("regulations", "institutional_rules")
        self.assertEqual(len(target_records), 2)
        self.assertNotIn(
            stale_target.document_id, {record.document_id for record in target_records}
        )
        self.assertTrue(all("100001" not in record.document_id for record in target_records))
        self.assertTrue(all("100003" not in record.document_id for record in target_records))

        uploads_by_key = {
            str(upload["key"]): upload
            for upload in object_store.uploads
            if str(upload["key"]).endswith(".jsonl")
        }
        guidance_record = next(
            record
            for record in target_records
            if "学生使用人工智能的指导意见" in (record.canonical_markdown_object_key or "")
        )
        regulation_record = next(
            record
            for record in target_records
            if "实验室安全管理规定" in (record.canonical_markdown_object_key or "")
        )

        guidance_rows = _document_rows(
            uploads_by_key[guidance_record.document_units_object_key or ""]
        )
        first_guidance_metadata = guidance_rows[0]["metadata"]
        self.assertEqual(
            first_guidance_metadata["source_notice_ids"],
            ["100001", "100002"],
        )
        self.assertEqual(
            first_guidance_metadata["source_document_ids"],
            [
                "notice_attachment:muc_internal_portal:100001:attachment-0001",
                "notice_attachment:muc_internal_portal:100002:attachment-0001",
            ],
        )
        self.assertEqual(
            first_guidance_metadata["promotion_source_collection"], "campus_notices/internal_notice"
        )
        self.assertEqual(
            first_guidance_metadata["source_notice_document_id"],
            "notice:muc_internal_portal:100001",
        )
        self.assertEqual(
            first_guidance_metadata["source_notice_document_ids"],
            [
                "notice:muc_internal_portal:100001",
                "notice:muc_internal_portal:100002",
            ],
        )
        self.assertEqual(
            first_guidance_metadata["source_attachment_document_id"],
            "notice_attachment:muc_internal_portal:100001:attachment-0001",
        )
        self.assertEqual(
            first_guidance_metadata["semantic_owner_document_id"],
            "notice_attachment:muc_internal_portal:100001:attachment-0001",
        )
        self.assertEqual(first_guidance_metadata["source_attachment_ref_id"], "attachment-0001")
        self.assertEqual(first_guidance_metadata["source_attachment_ref_ids"], ["attachment-0001"])
        self.assertEqual(first_guidance_metadata["semantic_owner_kind"], "attachment_document")
        self.assertEqual(
            first_guidance_metadata["regulation_title_normalized"],
            "中央民族大学关于学生使用人工智能的指导意见（2026版）",
        )
        self.assertEqual(
            first_guidance_metadata["regulation_work_title"],
            "中央民族大学关于学生使用人工智能的指导意见",
        )
        self.assertEqual(first_guidance_metadata["regulation_edition_label"], "2026版")
        self.assertEqual(
            first_guidance_metadata["regulation_display_title"],
            "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
        )
        self.assertEqual(
            first_guidance_metadata["source_title_literal"],
            "中央民族大学关于学生使用人工智能的指导意见（2026版）",
        )
        self.assertEqual(
            first_guidance_metadata["title"],
            "中央民族大学关于学生使用人工智能的指导意见",
        )
        self.assertTrue(guidance_record.is_current)

        regulation_rows = _document_rows(
            uploads_by_key[regulation_record.document_units_object_key or ""]
        )
        regulation_metadata = regulation_rows[0]["metadata"]
        self.assertEqual(regulation_metadata["source_notice_ids"], ["100003"])
        self.assertEqual(
            regulation_metadata["source_notice_document_id"],
            "notice:muc_internal_portal:100003",
        )
        self.assertEqual(
            regulation_metadata["source_parent_document_id"],
            "notice:muc_internal_portal:100003",
        )
        self.assertEqual(
            regulation_metadata["semantic_owner_document_id"],
            "notice:muc_internal_portal:100003",
        )
        self.assertEqual(regulation_metadata["semantic_owner_kind"], "notice_body")
        self.assertEqual(
            regulation_metadata["regulation_work_title"],
            "中央民族大学实验室安全管理规定",
        )
        self.assertEqual(regulation_metadata["regulation_edition_label"], "2026年修订")
        self.assertEqual(
            regulation_metadata["regulation_display_title"],
            "中央民族大学实验室安全管理规定 / 2026年修订",
        )
        self.assertEqual(
            regulation_metadata["title"],
            "中央民族大学实验室安全管理规定",
        )
        self.assertEqual(regulation_metadata["effective_date"], "2026年2月1日")
        self.assertEqual(regulation_metadata["revision_signal"], "修订")
        self.assertTrue(regulation_record.is_current)
        self.assertNotIn("2026年修订", regulation_record.canonical_markdown_object_key or "")
        self.assertNotIn("2026年修订", regulation_record.document_units_object_key or "")

        guidance_markdown = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=guidance_record.canonical_markdown_object_key or "",
        ).decode("utf-8")
        self.assertTrue(
            guidance_markdown.startswith("# 中央民族大学关于学生使用人工智能的指导意见（2026版）")
        )
        self.assertNotIn("关于发布", guidance_markdown)

        regulation_markdown = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=regulation_record.canonical_markdown_object_key or "",
        ).decode("utf-8")
        self.assertTrue(regulation_markdown.startswith("# 中央民族大学实验室安全管理规定"))
        self.assertNotIn("特此通知", regulation_markdown)
        self.assertIn("第一条 为加强实验室安全管理", regulation_markdown)

    def test_selected_materialize_preserves_existing_target_scope_records(self) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        parent = _record(
            document_id="notice:muc_internal_portal:100003",
            source_uri="https://portal.example.edu/notices/100003",
            canonical_key="campus_notices/documents/internal_notice/100003/canonical.md",
            units_key="campus_notices/documents/internal_notice/100003/document-units.jsonl",
            content_hash="sha256:parent-100003",
            is_current=True,
        )
        existing_target = _regulation_record(
            "institutional_regulation:muc:existing-regulation:existing1234"
        )
        registry = InMemoryDocumentRegistry((parent, existing_target))
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="100003",
                    notice_title="关于修订《中央民族大学实验室安全管理规定》的通知",
                    published_date="2026-02-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《中央民族大学实验室安全管理规定》的通知\n\n"
                    "第一条 为加强实验室安全管理，制定本规定。\n"
                    "第二条 实验室实行分级分类安全管理。\n"
                    "2026年2月1日起施行。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent.document_id,
                            "version_id": parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于修订《中央民族大学实验室安全管理规定》的通知",
                            "source_url": parent.source_uri,
                            "page_start": 1,
                            "page_end": 1,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "关于修订《中央民族大学实验室安全管理规定》的通知"
                            },
                        }
                    ]
                ),
            }
        )

        report = materialize(
            request=regulation_materialization.InternalNoticeRegulationPromotionRequest(
                notice_ids=("100003",)
            ),
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=InMemoryNoticeConsumptionProjectionStore(
                (
                    _ready_institutional_projection_entry(
                        notice_id="100003",
                        source_document_id=parent.document_id,
                    ),
                )
            ),
        )

        self.assertEqual(report.materialized_document_count, 1)
        target_document_ids = {
            record.document_id
            for record in registry.list_by_scope("regulations", "institutional_rules")
        }
        self.assertIn(existing_target.document_id, target_document_ids)
        self.assertTrue(
            any("实验室安全管理规定" in document_id for document_id in target_document_ids)
        )

    def test_selected_materialize_removes_stale_target_record_when_projection_is_held(
        self,
    ) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        parent = _record(
            document_id="notice:muc_internal_portal:187233",
            source_uri="https://portal.example.edu/notices/187233",
            canonical_key="campus_notices/documents/internal_notice/187233/canonical.md",
            units_key="campus_notices/documents/internal_notice/187233/document-units.jsonl",
            content_hash="sha256:parent-187233",
            is_current=True,
        )
        stale_target = _target_regulation_record(
            document_id="institutional_regulation:muc:procurement-work-rule:stale187233",
            document_units_key=(
                "regulations/documents/institutional_rules/procurement-work-rule/"
                "source-faithful/2021/document-units.jsonl"
            ),
            canonical_key=(
                "regulations/documents/institutional_rules/procurement-work-rule/"
                "source-faithful/2021/canonical.md"
            ),
        )
        unrelated_target = _target_regulation_record(
            document_id="institutional_regulation:muc:student-work-rule:stable",
            document_units_key=(
                "regulations/documents/institutional_rules/student-work-rule/"
                "source-faithful/2026/document-units.jsonl"
            ),
            canonical_key=(
                "regulations/documents/institutional_rules/student-work-rule/"
                "source-faithful/2026/canonical.md"
            ),
        )
        registry = InMemoryDocumentRegistry((parent, stale_target, unrelated_target))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n"
                    "经研究，现对《中央民族大学采购工作管理办法》作如下修订。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent.document_id,
                            "version_id": parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于修订《中央民族大学采购工作管理办法》的通知",
                            "source_url": parent.source_uri,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "关于修订《中央民族大学采购工作管理办法》的通知"},
                        }
                    ]
                ),
                ("campus-rag-derived", stale_target.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": stale_target.document_id,
                            "version_id": stale_target.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学采购工作管理办法",
                            "source_url": stale_target.source_uri,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "中央民族大学采购工作管理办法",
                                "source_notice_ids": ["187233"],
                                "source_document_ids": [parent.document_id],
                                "source_notice_document_ids": [parent.document_id],
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", unrelated_target.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": unrelated_target.document_id,
                            "version_id": unrelated_target.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学学生工作管理办法",
                            "source_url": unrelated_target.source_uri,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "中央民族大学学生工作管理办法",
                                "source_notice_ids": ["100003"],
                                "source_document_ids": ["notice:muc_internal_portal:100003"],
                                "source_notice_document_ids": ["notice:muc_internal_portal:100003"],
                            },
                        }
                    ]
                ),
            }
        )
        held_projection_entry = NoticeConsumptionProjectionEntry(
            source_family="internal_notice_restricted",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="187233",
            unit_id="notice_unit:muc_internal_portal:187233:attachment_rule_body:held",
            primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
            semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
            default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
            target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
            temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
            completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
            answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            source_notice_document_id=parent.document_id,
            source_document_id=parent.document_id,
            role_metadata={"reasons": ("parent_notice_body_not_full_regulation_text",)},
        )

        report = materialize(
            request=regulation_materialization.InternalNoticeRegulationPromotionRequest(
                notice_ids=("187233",)
            ),
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(()),
            source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
            consumption_projection_store=_ReadOnlyProjectionStore((held_projection_entry,)),
        )

        self.assertEqual(report.promotion_candidate_count, 0)
        self.assertEqual(report.materialized_document_count, 0)
        target_document_ids = {
            record.document_id
            for record in registry.list_by_scope("regulations", "institutional_rules")
        }
        self.assertNotIn(stale_target.document_id, target_document_ids)
        self.assertIn(unrelated_target.document_id, target_document_ids)
