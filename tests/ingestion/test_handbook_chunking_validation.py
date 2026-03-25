from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.chunking import build_student_handbook_chunk_profile
from campus_ingestion_core.handbook_chunking_validation import validate_student_handbook_chunking
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key


class _FakeRegistry:
    def __init__(self, *records: DocumentRegistryRecord) -> None:
        self.records = records

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        return tuple(
            record
            for record in self.records
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


def _manifest_document(*, document_id: str, title: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "title": title,
        "handbook_section": "测试章节",
        "page_start": 1,
        "page_end": 2,
        "source_uri": f"campus-agent://regulations/student_handbook/docs/{document_id}",
    }


def _registry_record(*, document_id: str, version_id: str, title: str) -> DocumentRegistryRecord:
    object_key = build_processed_artifact_key(
        corpus="regulations",
        collection="student_handbook",
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        title=title,
        year="2018",
        filename="document-units.jsonl",
    )
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"campus-agent://regulations/student_handbook/docs/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_handbook",
        cleaning_policy_version="student_handbook_cleaning_v1",
        acl_groups=("students",),
        campus_scope="main",
        status="active",
        ingestion_timestamp="2026-03-24T00:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="text-embedding-3-large",
        source_channel="pdf_ocr",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="provider_response_replay",
    )


def _structured_row(*, doc_id: str, version_id: str, unit_type: str, clean_text: str, root_unit_id: str) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": {"page_start": 1, "page_end": 1},
        "acl": {"level": "public", "allow_groups": []},
    }


class StudentHandbookChunkingValidationTest(unittest.TestCase):
    def test_validation_flags_stale_registry_record_with_missing_document_units(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            valid_record = _registry_record(
                document_id="handbook:valid-doc",
                version_id="v1:valid-doc",
                title="有效制度",
            )
            stale_record = _registry_record(
                document_id="handbook:stale-doc",
                version_id="v1:stale-doc",
                title="历史脏数据",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=valid_record.document_id, title="有效制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            valid_payload = (
                json.dumps(
                    _structured_row(
                        doc_id=valid_record.document_id,
                        version_id=valid_record.version_id,
                        unit_type="article_body",
                        clean_text="第一条 学校坚持立德树人。",
                        root_unit_id="article-001",
                    ),
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")
            report = validate_student_handbook_chunking(
                env={"OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed"},
                registry=_FakeRegistry(valid_record, stale_record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-processed", valid_record.document_units_object_key): valid_payload,
                    }
                ),
                manifest_path=manifest_path,
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.validated_document_count, 1)
            self.assertEqual(report.extra_registry_document_ids, ("handbook:stale-doc",))
            self.assertEqual(report.missing_registry_document_ids, ())
            self.assertEqual(len(report.read_failures), 1)
            self.assertEqual(report.read_failures[0].document_id, "handbook:stale-doc")
            self.assertIn("KeyError", report.read_failures[0].error)

    def test_validation_reports_structure_first_chunking_statistics(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:policy-doc",
                version_id="v1:policy-doc",
                title="结构化制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="结构化制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            clause_lines = "\n".join(
                [
                    f"({marker})" + ("甲" * 220)
                    for marker in ("一", "二", "三", "四")
                ]
            )
            payload = (
                json.dumps(
                    _structured_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        unit_type="article_body",
                        clean_text=clause_lines,
                        root_unit_id="article-001",
                    ),
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={"OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed"},
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-processed", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_student_handbook_chunk_profile(
                    profile_version="student_handbook_semantic_v2",
                    model_name="Qwen3-Embedding-4B",
                ),
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.chunk_policy_version, "student_handbook_semantic_v2")
            self.assertIn("Qwen3-Embedding-4B", report.tokenizer_name)
            self.assertEqual(report.validated_document_count, 1)
            self.assertEqual(report.total_units, 1)
            self.assertGreaterEqual(report.total_chunks, 1)
            self.assertEqual(report.non_table_oversize_chunk_count, 0)
            self.assertEqual(report.polluted_section_path_count, 0)
            self.assertEqual(report.missing_contextualization_count, 0)
            self.assertGreaterEqual(report.split_reason_counts.get("structure_boundary", 0), 1)
            self.assertGreaterEqual(report.boundary_rule_counts.get("clause_block", 0), 1)
            self.assertEqual(report.oversize_parent_unit_counts["article_body"], 1)
            self.assertEqual(report.oversize_multiline_parent_unit_counts["article_body"], 1)
            self.assertEqual(report.structure_eligible_unit_counts["clause_block"], 1)
            self.assertGreaterEqual(sum(report.chunk_token_histogram.values()), report.total_chunks)

    def test_validation_fails_when_policy_page_promotes_body_sentence_into_section_path(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:polluted-doc",
                version_id="v1:polluted-doc",
                title="污染制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="污染制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="policy_page",
                            clean_text="一、为进一步规范学生管理工作,特制定本办法。",
                            root_unit_id="policy-page-001",
                        ),
                        "metadata": {"title": "污染制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则", "一、为进一步规范学生管理工作,特制定本办法。"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={"OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed"},
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-processed", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_student_handbook_chunk_profile(
                    profile_version="student_handbook_semantic_v2",
                    model_name="Qwen3-Embedding-4B",
                ),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.polluted_section_path_count, 1)


if __name__ == "__main__":
    unittest.main()
