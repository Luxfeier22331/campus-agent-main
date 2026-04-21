from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry_scope_chunk_preparation import prepare_registry_scope_chunks
from campus_ingestion_core.registry_scope_release import release_registry_scope
from qdrant_client import QdrantClient

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.reads: list[tuple[str, str]] = []
        self.uploads: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


class _CloseoutOnlyRegistry(InMemoryDocumentRegistry):
    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        raise AssertionError("closeout-run preparation must not scan current registry scope")


class _FakeCloseoutStore:
    def __init__(self, *, run, staged_documents: tuple[dict[str, object], ...]) -> None:
        self.run = run
        self.staged_documents = staged_documents

    def get_run(self, run_id: str):
        if self.run is None or self.run.run_id != run_id:
            return None
        return self.run

    def get_staged_documents(self, run_id: str) -> tuple[dict[str, object], ...]:
        if self.run is None or self.run.run_id != run_id:
            return ()
        return self.staged_documents


def _make_internal_notice_record(*, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice:muc_internal_portal:355119",
        revision_track="source-faithful",
        version_id="sha256:test-version",
        source_uri="https://portal.example.edu/notice/355119",
        content_hash="sha256:test-content",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="authenticated_notice_source_projection",
    )


def _make_internal_notice_attachment_record(*, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
        revision_track="source-faithful",
        version_id="sha256:test-attachment-version",
        source_uri="https://portal.example.edu/notice/355119/attachments/1",
        content_hash="sha256:test-attachment-content",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="authenticated_notice_source_projection",
    )


def _make_verified_closeout_run(*, run_id: str):
    from campus_ingestion_core.authenticated_notice_closeout import CloseoutRun

    return (
        CloseoutRun(
            run_id=run_id,
            bundle_path="/tmp/not-used.json",
            manifest_path=None,
            expected_notice_count=1,
            expected_document_count=1,
            operations_prefix=f"campus_notices/operations/authenticated-notice-closeout/{run_id}",
            corpus="campus_notices",
            collection="internal_notice",
        )
        .mark_planned()
        .mark_running()
        .mark_verifying()
        .mark_verified({"staged_document_count": 1})
    )


def _build_staged_document(
    *,
    record: DocumentRegistryRecord,
    staged_document_units_key: str,
) -> dict[str, object]:
    return {
        "document": {
            "document_id": record.document_id,
            "revision_track": record.revision_track,
            "version_id": record.version_id,
            "source_label": record.source_uri,
            "metadata": {
                "document_id": record.document_id,
                "version_id": record.version_id,
                "source_url": record.source_uri,
                "entitlement_groups": list(record.entitlement_groups),
                "visibility_scope": record.visibility_scope,
                "visibility_level": record.visibility_level,
                "policy_projection_version": record.policy_projection_version,
            },
            "import_source": record.import_source,
            "source_channel": record.source_channel,
            "is_current": record.is_current,
            "corpus": record.corpus,
            "collection": record.collection,
            "visibility_scope": record.visibility_scope,
            "status": record.status,
            "raw_source_uri": record.source_uri,
            "raw_asset_id": None,
            "raw_version_id": None,
            "provider_response_object_key": record.provider_response_object_key,
            "layout_elements_object_key": record.layout_elements_object_key,
            "additional_processed_object_keys": [],
            "processed_object_keys": list(record.processed_object_keys),
            "title": record.document_id,
            "year": None,
            "parser_version": record.parser_version,
            "embedding_model": record.embedding_model,
            "cleaning_policy_version": record.cleaning_policy_version,
        },
        "staged_object_keys": {"document_units": staged_document_units_key},
        "final_object_keys": {"document_units": str(record.document_units_object_key)},
        "content_hash": record.content_hash,
        "staged_object_metadata": {
            "document_units": {"sha256": record.content_hash, "content_length": 256}
        },
    }


def _make_internal_notice_document_units_bytes(
    *,
    document_id: str,
    version_id: str,
) -> bytes:
    row = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": "body-001",
        "root_unit_id": "body-001",
        "unit_type": "paragraph",
        "clean_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
        "anchor": {
            "source_uri": f"https://portal.example.edu/notice/{document_id.split(':')[-1]}",
        },
        "metadata": {
            "title": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
            "block_role": "paragraph",
        },
    }
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


class InternalNoticeScopeChunkPipelineTest(unittest.TestCase):
    def _env(self) -> dict[str, str]:
        return {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        }

    def test_prepare_registry_scope_chunks_writes_chunk_prep_artifacts_without_embedding_env(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id=record.document_id,
                        version_id=record.version_id,
                    ),
                }
            )

            report = prepare_registry_scope_chunks(
                corpus="campus_notices",
                collection="internal_notice",
                preparation_run_id="prep-20260406-0001",
                env=self._env(),
                registry=registry,
                object_store=object_store,
            )

        self.assertEqual(report.corpus, "campus_notices")
        self.assertEqual(report.collection, "internal_notice")
        self.assertEqual(report.preparation_run_id, "prep-20260406-0001")
        self.assertEqual(report.validation_status, "passed")
        self.assertEqual(report.document_count, 1)
        self.assertGreater(report.chunk_count, 0)
        self.assertEqual(object_store.reads, [("campus-rag-derived", object_key)])
        upload_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertIn(report.manifest_object_key, upload_keys)
        self.assertIn(str(report.validation_summary_object_key), upload_keys)
        self.assertIn(str(report.document_report_object_key), upload_keys)

    def test_prepare_registry_scope_chunks_can_use_verified_closeout_run_without_current_scope(
        self,
    ) -> None:
        closeout_run_id = "authenticated-notice-source-truth-pilot-20260409-stratified-003"
        final_object_key = (
            "campus_notices/documents/internal_notice/"
            "notice-355119/source-faithful/2026/document-units.jsonl"
        )
        staged_object_key = (
            "campus_notices/operations/authenticated-notice-closeout/"
            f"{closeout_run_id}/staging/batches/batch-0001/documents/notice-355119/document-units.jsonl"
        )
        record = _make_internal_notice_record(object_key=final_object_key)
        closeout_store = _FakeCloseoutStore(
            run=_make_verified_closeout_run(run_id=closeout_run_id),
            staged_documents=(
                _build_staged_document(
                    record=record,
                    staged_document_units_key=staged_object_key,
                ),
            ),
        )
        registry = _CloseoutOnlyRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    staged_object_key,
                ): _make_internal_notice_document_units_bytes(
                    document_id=record.document_id,
                    version_id=record.version_id,
                ),
            }
        )

        report = prepare_registry_scope_chunks(
            corpus="campus_notices",
            collection="internal_notice",
            preparation_run_id="prep-20260409-closeout-001",
            closeout_run_id=closeout_run_id,
            env=self._env(),
            registry=registry,
            object_store=object_store,
            closeout_store=closeout_store,
        )

        self.assertEqual(report.validation_status, "passed")
        self.assertEqual(report.document_count, 1)
        self.assertEqual(report.selection_mode, "verified_closeout_run")
        self.assertEqual(report.closeout_run_id, closeout_run_id)
        self.assertEqual(object_store.reads, [("campus-rag-derived", staged_object_key)])
        manifest_bytes = object_store.objects[("campus-rag-derived", report.manifest_object_key)]
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        self.assertEqual(manifest["selection_mode"], "verified_closeout_run")
        self.assertEqual(manifest["closeout_run_id"], closeout_run_id)
        self.assertEqual(
            manifest["documents"][0]["document_units_object_key"],
            final_object_key,
        )

    def test_internal_notice_parent_chunks_use_notice_body_lane_strategy(self) -> None:
        record = _make_internal_notice_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
        )
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "title-001",
                    "root_unit_id": "title-001",
                    "unit_type": "policy_page",
                    "text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    "raw_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    "clean_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
                    "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                    "metadata": {"block_role": "title"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "article_body",
                    "text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
                    "raw_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
                    "clean_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
                    "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        body_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "article_body"]
        self.assertTrue(body_chunks)
        self.assertTrue(
            all(chunk.metadata["internal_notice_lane"] == "notice_body" for chunk in body_chunks)
        )
        self.assertTrue(
            all(
                chunk.metadata["strategy_name"] == "internal_notice_notice_body_v2"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(
                chunk.metadata["title"] == "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知"
                for chunk in body_chunks
            )
        )

    def test_internal_notice_notice_body_avoids_short_token_guardrail_tail_chunks(self) -> None:
        record = _make_internal_notice_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-241275/source-faithful/2026/document-units.jsonl"
            )
        )
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "title-001",
                    "root_unit_id": "title-001",
                    "unit_type": "policy_page",
                    "text": "你我共同努力，终结结核流行",
                    "raw_text": "你我共同努力，终结结核流行",
                    "clean_text": "你我共同努力，终结结核流行",
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "title"},
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "body-001",
                    "root_unit_id": "body-001",
                    "unit_type": "article_body",
                    "text": (
                        "北京市委、市政府一直高度重视结核病防控工作，不断完善结核病防治服务体系建设，"
                        "大力保障结核病防治工作经费，在全市构建了政府主导、部门协同、专业机构分工负责、"
                        "社会共同参与的综合防治机制。北京市目前有北京结核病控制研究与防治所、北京胸科医院、"
                        "北京老年医院、解放军总医院第八医学中心、北京儿童医院、北京佑安医院、北京地坛医院共7家"
                        "市级结核病定点医疗机构，以及18家区级结核病定点医疗机构，实现对耐药、疑难病例、危急重症、"
                        "TB/HIV双重感染、儿童、孕产妇等人群肺结核患者规范治疗管理全覆盖。结核病纳入本市基本医疗保险，"
                        "患者发生的相关医疗费用，大部分可以按相关政策予以报销。2020年将耐多药肺结核纳入本市基本医疗保险门诊特殊疾病范围。"
                    ),
                    "raw_text": (
                        "北京市委、市政府一直高度重视结核病防控工作，不断完善结核病防治服务体系建设，"
                        "大力保障结核病防治工作经费，在全市构建了政府主导、部门协同、专业机构分工负责、"
                        "社会共同参与的综合防治机制。北京市目前有北京结核病控制研究与防治所、北京胸科医院、"
                        "北京老年医院、解放军总医院第八医学中心、北京儿童医院、北京佑安医院、北京地坛医院共7家"
                        "市级结核病定点医疗机构，以及18家区级结核病定点医疗机构，实现对耐药、疑难病例、危急重症、"
                        "TB/HIV双重感染、儿童、孕产妇等人群肺结核患者规范治疗管理全覆盖。结核病纳入本市基本医疗保险，"
                        "患者发生的相关医疗费用，大部分可以按相关政策予以报销。2020年将耐多药肺结核纳入本市基本医疗保险门诊特殊疾病范围。"
                    ),
                    "clean_text": (
                        "北京市委、市政府一直高度重视结核病防控工作，不断完善结核病防治服务体系建设，"
                        "大力保障结核病防治工作经费，在全市构建了政府主导、部门协同、专业机构分工负责、"
                        "社会共同参与的综合防治机制。北京市目前有北京结核病控制研究与防治所、北京胸科医院、"
                        "北京老年医院、解放军总医院第八医学中心、北京儿童医院、北京佑安医院、北京地坛医院共7家"
                        "市级结核病定点医疗机构，以及18家区级结核病定点医疗机构，实现对耐药、疑难病例、危急重症、"
                        "TB/HIV双重感染、儿童、孕产妇等人群肺结核患者规范治疗管理全覆盖。结核病纳入本市基本医疗保险，"
                        "患者发生的相关医疗费用，大部分可以按相关政策予以报销。2020年将耐多药肺结核纳入本市基本医疗保险门诊特殊疾病范围。"
                    ),
                    "anchor": {"source_uri": record.source_uri},
                    "metadata": {"block_role": "paragraph"},
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        short_guardrail_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "article_body"
            and chunk.metadata.get("split_reason") == "token_guardrail"
            and int(chunk.metadata.get("final_token_count") or 0) < 48
        ]

        self.assertEqual(short_guardrail_chunks, [])

    def test_internal_notice_attachment_text_chunks_use_text_lane_strategy(self) -> None:
        record = _make_internal_notice_attachment_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            )
        )
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-title",
                    "root_unit_id": "attachment-title",
                    "unit_type": "attachment_title",
                    "text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx",
                    "raw_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx",
                    "clean_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx",
                    "anchor": {
                        "source_uri": record.source_uri,
                        "attachment_ref_id": "attachment-0001",
                    },
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "office_document_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "报名表.docx",
                        "attachment_mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "extraction_class": "text_extractable",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-body-0001",
                    "root_unit_id": "attachment-body-0001",
                    "unit_type": "attachment_body",
                    "text": "姓名：张三\n学院：法学院\n联系电话：12345678",
                    "raw_text": "姓名：张三\n学院：法学院\n联系电话：12345678",
                    "clean_text": "姓名：张三\n学院：法学院\n联系电话：12345678",
                    "anchor": {
                        "source_uri": record.source_uri,
                        "attachment_ref_id": "attachment-0001",
                    },
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "office_document_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "报名表.docx",
                        "attachment_mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "extraction_class": "text_extractable",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        body_chunks = [
            chunk for chunk in chunks if chunk.metadata["unit_type"] == "attachment_body"
        ]
        self.assertTrue(body_chunks)
        self.assertTrue(
            all(
                chunk.metadata["internal_notice_lane"] == "attachment_text_extractable"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(
                chunk.metadata["strategy_name"] == "internal_notice_attachment_text_v2"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(
                chunk.metadata["title"]
                == "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 报名表.docx"
                for chunk in body_chunks
            )
        )

    def test_internal_notice_attachment_ocr_chunks_use_ocr_lane_budget(self) -> None:
        record = _make_internal_notice_attachment_record(
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units-ocr.jsonl"
            )
        )
        ocr_text = "\n".join(f"第{index}行 {'甲' * 40}" for index in range(1, 40))
        structured_payload = (
            json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-title",
                    "root_unit_id": "attachment-title",
                    "unit_type": "attachment_title",
                    "text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 现场签到图.jpg",
                    "raw_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 现场签到图.jpg",
                    "clean_text": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知 / 附件 1 / 现场签到图.jpg",
                    "anchor": {
                        "source_uri": record.source_uri,
                        "attachment_ref_id": "attachment-0001",
                    },
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "ocr_document_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "现场签到图.jpg",
                        "attachment_mime_type": "image/jpeg",
                        "extraction_class": "ocr_required",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                {
                    "doc_id": record.document_id,
                    "version_id": record.version_id,
                    "chunk_id": "attachment-body-0001",
                    "root_unit_id": "attachment-body-0001",
                    "unit_type": "attachment_body",
                    "text": ocr_text,
                    "raw_text": ocr_text,
                    "clean_text": ocr_text,
                    "anchor": {
                        "source_uri": record.source_uri,
                        "attachment_ref_id": "attachment-0001",
                    },
                    "metadata": {
                        "projection_name": "internal_notice_attachment_documents",
                        "parent_document_id": "notice:muc_internal_portal:355119",
                        "attachment_ref_id": "attachment-0001",
                        "attachment_kind": "ocr_document_attachment",
                        "attachment_role": "notice_attachment_document",
                        "attachment_filename": "现场签到图.jpg",
                        "attachment_mime_type": "image/jpeg",
                        "extraction_class": "ocr_required",
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
        )

        body_chunks = [
            chunk for chunk in chunks if chunk.metadata["unit_type"] == "attachment_body"
        ]
        self.assertGreater(len(body_chunks), 1)
        self.assertTrue(
            all(
                chunk.metadata["internal_notice_lane"] == "attachment_ocr_required"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(
                chunk.metadata["strategy_name"] == "internal_notice_attachment_ocr_v2"
                for chunk in body_chunks
            )
        )
        self.assertTrue(
            all(int(chunk.metadata["final_token_count"]) <= 240 for chunk in body_chunks)
        )

    def test_release_registry_scope_requires_chunk_preparation_for_internal_notice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id=record.document_id,
                        version_id=record.version_id,
                    ),
                }
            )

            with self.assertRaisesRegex(
                ValueError,
                "chunk preparation run id is required before release for campus_notices/internal_notice",
            ):
                release_registry_scope(
                    corpus="campus_notices",
                    collection="internal_notice",
                    env=self._env(),
                    registry=registry,
                    object_store=object_store,
                    qdrant_client=QdrantClient(location=":memory:"),
                    publish_alias=False,
                )

    def test_release_registry_scope_uses_verified_chunk_preparation_for_internal_notice(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id=record.document_id,
                        version_id=record.version_id,
                    ),
                }
            )

            prepare_registry_scope_chunks(
                corpus="campus_notices",
                collection="internal_notice",
                preparation_run_id="prep-20260406-0002",
                env=self._env(),
                registry=registry,
                object_store=object_store,
            )
            report = release_registry_scope(
                corpus="campus_notices",
                collection="internal_notice",
                preparation_run_id="prep-20260406-0002",
                env={
                    **self._env(),
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                registry=registry,
                object_store=object_store,
                qdrant_client=QdrantClient(location=":memory:"),
                publish_alias=False,
            )

        self.assertEqual(report.corpus, "campus_notices")
        self.assertEqual(report.collection, "internal_notice")
        self.assertEqual(report.validation_status, "passed")
        self.assertEqual(report.document_count, 1)
        self.assertGreater(report.point_count, 0)

    def test_prepare_registry_scope_chunks_reports_record_context_on_structured_mismatch(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_key = (
                "campus_notices/documents/internal_notice/"
                "notice-355119/source-faithful/2026/document-units.jsonl"
            )
            record = _make_internal_notice_record(object_key=object_key)
            registry = InMemoryDocumentRegistry((record,), backing_path=root / "registry.json")
            object_store = _FakeObjectStore(
                objects={
                    ("campus-rag-derived", object_key): _make_internal_notice_document_units_bytes(
                        document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
                        version_id=record.version_id,
                    ),
                }
            )

            with self.assertRaisesRegex(
                ValueError,
                "document_units_object_key=.*document-units.jsonl",
            ):
                prepare_registry_scope_chunks(
                    corpus="campus_notices",
                    collection="internal_notice",
                    preparation_run_id="prep-20260406-0003",
                    env=self._env(),
                    registry=registry,
                    object_store=object_store,
                )


if __name__ == "__main__":
    unittest.main()
