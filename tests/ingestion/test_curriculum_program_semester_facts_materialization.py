from __future__ import annotations

import json
import unittest

import campus_ingestion_core.curriculum_program_semester_facts_projection as semester_projection
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.reads: list[tuple[str, str]] = []
        self.uploads: list[dict[str, object]] = []

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(
            sorted(
                key
                for object_bucket, key in self.objects
                if object_bucket == bucket and key.startswith(prefix)
            )
        )

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
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data


def _curriculum_document_units_bytes() -> bytes:
    rows = (
        {
            "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
            "version_id": "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67:split:法学（民族实验班）本科人才培养方案:4b97e5cd7999",
            "chunk_id": "page-0001-block-1-0001",
            "row_id": "page-0001-block-1-0001",
            "row_type": "heading",
            "clean_text": "法学（民族实验班）本科人才培养方案",
            "html": None,
            "table_cells": None,
            "source_pdf": "curriculum-plan-2022.pdf",
            "source_url": "campusrag://source/curriculum/curriculum-plan-2022/sha256/0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/capture/pages/1-2",
            "source": {
                "id": "campusrag://source/curriculum/curriculum-plan-2022/sha256/0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/capture/pages/1-2"
            },
            "page_start": 1,
            "page_end": 1,
            "entitlement_groups": [],
            "visibility_scope": None,
            "visibility_level": "public",
            "policy_projection_version": "phase1-authorization-projection-v1",
        },
        {
            "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
            "version_id": "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67:split:法学（民族实验班）本科人才培养方案:4b97e5cd7999",
            "chunk_id": "page-0001-block-2-0002",
            "row_id": "page-0001-block-2-0002",
            "row_type": "table",
            "clean_text": (
                "<table><tr><td>课程名称</td><td>修读学期</td></tr>"
                "<tr><td>中国近现代史纲要</td><td>1</td></tr>"
                "<tr><td>习近平新时代中国特色社会主义思想概论</td><td>2</td></tr>"
                "<tr><td>大学英语(四)</td><td>4</td></tr>"
                "<tr><td>侵权责任法</td><td>4</td></tr></table>"
            ),
            "html": (
                "<table><tr><td>课程名称</td><td>修读学期</td></tr>"
                "<tr><td>中国近现代史纲要</td><td>1</td></tr>"
                "<tr><td>习近平新时代中国特色社会主义思想概论</td><td>2</td></tr>"
                "<tr><td>大学英语(四)</td><td>4</td></tr>"
                "<tr><td>侵权责任法</td><td>4</td></tr></table>"
            ),
            "table_cells": [],
            "source_pdf": "curriculum-plan-2022.pdf",
            "source_url": "campusrag://source/curriculum/curriculum-plan-2022/sha256/0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/capture/pages/1-2",
            "source": {
                "id": "campusrag://source/curriculum/curriculum-plan-2022/sha256/0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/capture/pages/1-2"
            },
            "page_start": 1,
            "page_end": 2,
            "entitlement_groups": [],
            "visibility_scope": None,
            "visibility_level": "public",
            "policy_projection_version": "phase1-authorization-projection-v1",
        },
    )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


class CurriculumProgramSemesterFactsMaterializationTest(unittest.TestCase):
    def test_materialize_program_semester_facts_from_canonical_scope(self) -> None:
        materialize = getattr(
            semester_projection,
            "materialize_curriculum_program_semester_facts_from_canonical_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        source_key = (
            "curriculum/documents/curriculum_plan/"
            "法学-民族实验班-本科人才培养方案--法学-民族实验班-本科人才培养方案/"
            "source-faithful/2022/document-units.jsonl"
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", source_key): _curriculum_document_units_bytes(),
            }
        )
        registry = InMemoryDocumentRegistry(())
        raw_asset_registry = InMemoryRawAssetRegistry(())

        report = materialize(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    title="法学（民族实验班）本科人才培养方案",
                    page_start=1,
                    page_end=2,
                ),
            ),
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-2022",
                raw_version_id="sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/asset:curriculum-plan-2022/sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
                content_hash="0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
                source_filename="curriculum-plan-2022.pdf",
                object_key=(
                    "official_pdf/curriculum-plan-2022/2022/sha256/"
                    "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/"
                    "capture/curriculum-plan-2022.pdf"
                ),
                ingestion_timestamp="2026-04-04T04:40:27+00:00",
                import_source="provider_response_replay",
            ),
            source_document_units_keys={
                "curriculum:法学（民族实验班）本科人才培养方案": source_key,
            },
        )

        self.assertEqual(report.source_document_count, 1)
        self.assertEqual(report.materialized_document_count, 3)
        self.assertEqual(len(registry.list_by_scope("curriculum", "program_semester_facts")), 3)
        raw_record = raw_asset_registry.get(
            "asset:curriculum-plan-2022",
            "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
        )
        self.assertIsNotNone(raw_record)
        uploaded_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertIn(
            "curriculum/documents/program_semester_facts/"
            "法学-民族实验班-本科人才培养方案-第一学期课程事实--semester-1/"
            "source-faithful/2022/document-units.jsonl",
            uploaded_keys,
        )
        self.assertIn(
            "curriculum/documents/program_semester_facts/"
            "法学-民族实验班-本科人才培养方案-第四学期课程事实--semester-4/"
            "source-faithful/2022/document-units.jsonl",
            uploaded_keys,
        )

    def test_materialize_program_semester_facts_from_canonical_scope_filters_source_documents(self) -> None:
        materialize = getattr(
            semester_projection,
            "materialize_curriculum_program_semester_facts_from_canonical_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        law_key = (
            "curriculum/documents/curriculum_plan/"
            "法学-民族实验班-本科人才培养方案--法学-民族实验班-本科人才培养方案/"
            "source-faithful/2022/document-units.jsonl"
        )
        history_key = (
            "curriculum/documents/curriculum_plan/"
            "历史学-强基计划-本科人才培养方案--历史学-强基计划-本科人才培养方案/"
            "source-faithful/2022/document-units.jsonl"
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", law_key): _curriculum_document_units_bytes(),
                ("campus-rag-derived", history_key): _curriculum_document_units_bytes().replace(
                    "法学（民族实验班）本科人才培养方案".encode("utf-8"),
                    "历史学（强基计划）本科人才培养方案".encode("utf-8"),
                ),
            }
        )
        registry = InMemoryDocumentRegistry(())
        raw_asset_registry = InMemoryRawAssetRegistry(())

        report = materialize(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    title="法学（民族实验班）本科人才培养方案",
                    page_start=1,
                    page_end=2,
                ),
                SplitManifestDocument(
                    document_id="curriculum:历史学（强基计划）本科人才培养方案",
                    title="历史学（强基计划）本科人才培养方案",
                    page_start=90,
                    page_end=96,
                ),
            ),
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-2022",
                raw_version_id="sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/asset:curriculum-plan-2022/sha256:test",
                content_hash="0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
                source_filename="curriculum-plan-2022.pdf",
                object_key="official_pdf/curriculum-plan-2022/provider-response.jsonl",
                ingestion_timestamp="2026-04-04T04:40:27+00:00",
                import_source="provider_response_replay",
            ),
            source_document_units_keys={
                "curriculum:法学（民族实验班）本科人才培养方案": law_key,
                "curriculum:历史学（强基计划）本科人才培养方案": history_key,
            },
            source_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
        )

        self.assertEqual(report.source_document_count, 1)
        self.assertTrue(
            all("历史学（强基计划）本科人才培养方案" in document_id for document_id in report.created_document_ids)
        )


if __name__ == "__main__":
    unittest.main()
