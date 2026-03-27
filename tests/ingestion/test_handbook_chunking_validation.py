from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.handbook_chunking_validation import (
    build_student_handbook_chunking_validation_report,
    export_student_handbook_chunk_samples,
    scan_student_handbook_chunking,
    validate_student_handbook_chunking,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key
from tests.ingestion._handbook_chunking_test_support import build_hermetic_handbook_v3_chunk_profile


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


class _CountingObjectStore(_FakeObjectStore):
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        super().__init__(objects)
        self.get_bytes_calls: list[tuple[str, str]] = []
        self.healthcheck_calls: list[str] = []

    def healthcheck(self, *, bucket: str) -> None:
        self.healthcheck_calls.append(bucket)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.get_bytes_calls.append((bucket, key))
        return super().get_bytes(bucket=bucket, key=key)


class _FailFastObjectStore(_FakeObjectStore):
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        super().__init__(objects)
        self.get_bytes_call_count = 0

    def healthcheck(self, *, bucket: str) -> None:
        raise RuntimeError(f"healthcheck failed for {bucket}")

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.get_bytes_call_count += 1
        return super().get_bytes(bucket=bucket, key=key)


def _manifest_document(*, document_id: str, title: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "title": title,
        "handbook_section": "测试章节",
        "page_start": 1,
        "page_end": 2,
        "source_uri": f"campus-agent://regulations/student_handbook/docs/{document_id}",
    }


def _manifest_document_with_pages(
    *,
    document_id: str,
    title: str,
    page_start: int,
    page_end: int,
) -> dict[str, object]:
    return {
        **_manifest_document(document_id=document_id, title=title),
        "page_start": page_start,
        "page_end": page_end,
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
        embedding_model="Qwen3-Embedding-4B",
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
    def test_validation_fails_when_chunk_contains_broken_policy_doc_no_linebreak(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:broken-citation-doc",
                version_id="v1:broken-citation-doc",
                title="断行制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="断行制度"),
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
                            unit_type="article_body",
                            clean_text="第一条 百分制成绩、成绩等级及学分绩点的对应关系根据《中央民族大学本科学生学籍管理规定》(民大校发\n[2009]89号)规定执行。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "断行制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.broken_citation_linebreak_count, 1)

    def test_validation_fails_when_chunk_contains_unclosed_citation_context(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:unclosed-citation-doc",
                version_id="v1:unclosed-citation-doc",
                title="未闭合引文制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="未闭合引文制度"),
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
                            unit_type="article_body",
                            clean_text="第一条 为认真贯彻有关精神,根据《中央民族大学关于进一步加强和改进新时期大学生思想政治教育的实施意见》(民大党发〔2009〕41号的精神,特制定本办法。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "未闭合引文制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.unclosed_citation_context_count, 1)

    def test_validation_fails_when_chunk_contains_heading_body_glue(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:heading-glue-doc",
                version_id="v1:heading-glue-doc",
                title="粘连制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="粘连制度"),
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
                            unit_type="article_body",
                            clean_text="第八条 十佳大学生评选程序\n3. 候选人公示中央民族大学十佳大学生候选人在学生工作部网站公示一周,接受监督。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "粘连制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 评选程序"],
                            "article_label": "第八条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_fails_when_article_heading_is_glued_to_body(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:article-heading-glue-doc",
                version_id="v1:article-heading-glue-doc",
                title="条文粘连制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="条文粘连制度"),
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
                            unit_type="article_body",
                            clean_text="第十二条 毕业、结业与肄业参加留学项目学生返校后,必须按学校各项要求完成学习任务。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "条文粘连制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第五章 附则"],
                            "article_label": "第十二条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_ignores_regular_clause_lines_that_contain_participation_verbs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:regular-clause-doc",
                version_id="v1:regular-clause-doc",
                title="常规条款制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="常规条款制度"),
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
                            unit_type="article_body",
                            clean_text="第七条 评选条件\n(四)积极参加体育锻炼,身心健康;",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "常规条款制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第二章 评选条件"],
                            "article_label": "第七条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(report.heading_body_glue_count, 0)

    def test_validation_ignores_compact_identity_path_headers(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:path-header-doc",
                version_id="v1:path-header-doc",
                title="路径标题制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="路径标题制度"),
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
                            clean_text="学生参加公益服务活动应当在学有余力的情况下进行。",
                            root_unit_id="policy-page-001",
                        ),
                        "metadata": {
                            "title": "中央民族大学本科受资助学生参与公益服务活动实施办法",
                            "policy_doc_no": "民大学发[2013]7号",
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["二、活动原则"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(report.heading_body_glue_count, 0)

    def test_validation_ignores_procedural_phrase_after_heading_keyword(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:procedural-phrase-doc",
                version_id="v1:procedural-phrase-doc",
                title="程序说明制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="程序说明制度"),
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
                            unit_type="article_body",
                            clean_text="第七条 选拔程序与要求\n(九)办理出国(境)手续\n公示无异议后,教务处将学生信息送交国际合作处。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "程序说明制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第二章 申请与选拔"],
                            "article_label": "第七条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(report.heading_body_glue_count, 0)

    def test_validation_still_flags_heading_body_glue_when_remainder_starts_with_wu(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:wu-heading-glue-doc",
                version_id="v1:wu-heading-glue-doc",
                title="减免制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="减免制度"),
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
                            unit_type="article_body",
                            clean_text="第五条 资助方式\n(六)学费、住宿费减免无经济来源的烈士子女可申请减免学费、住宿费。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "减免制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 主要资助方式"],
                            "article_label": "第五条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_fails_when_chunk_contains_repeated_heading_body_glue(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:repeated-heading-glue-doc",
                version_id="v1:repeated-heading-glue-doc",
                title="重复标题制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="重复标题制度"),
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
                            unit_type="article_body",
                            clean_text="第五条 资助方式\n(一)奖学金奖学金用于奖励品学兼优、综合素质全面发展的在校学生。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "重复标题制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 主要资助方式"],
                            "article_label": "第五条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.heading_body_glue_count, 1)

    def test_validation_fails_when_chunk_contains_boundary_overlap_duplication(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:overlap-dup-doc",
                version_id="v1:overlap-dup-doc",
                title="重复制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="重复制度"),
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
                            unit_type="article_body",
                            clean_text="第十一条 课程、学分与成绩认定\n1. 学生申请学生需要提交境外学校提供的境外课程成绩单原件1份及复印件。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "重复制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第三章 学籍管理"],
                            "article_label": "第十一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.adjacent_overlap_duplication_count, 1)

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
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(valid_record, stale_record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", valid_record.document_units_object_key): valid_payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
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
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.chunk_policy_version, "student_handbook_semantic_v3")
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
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.polluted_section_path_count, 1)

    def test_validation_fails_when_section_path_tail_is_numeric_appendix_leaf(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:appendix-leaf-doc",
                version_id="v1:appendix-leaf-doc",
                title="附件制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="附件制度"),
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
                            clean_text="认定结果为:特别困难、困难;户口类型为:农村、城镇。",
                            root_unit_id="policy-page-001",
                        ),
                        "metadata": {"title": "附件制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第五章 附则", "三:"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.polluted_section_path_count, 1)

    def test_validation_treats_isolated_tiny_textual_chunk_as_diagnostic_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:tiny-doc",
                version_id="v1:tiny-doc",
                title="短条款制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="短条款制度"),
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
                            unit_type="article_body",
                            clean_text="本办法自公布之日起施行。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {
                            "title": "短条款制度",
                            "policy_doc_no": "民大校发〔2024〕12号",
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertTrue(report.passed)
            self.assertEqual(report.tiny_textual_chunk_count, 1)
            self.assertEqual(report.header_dominant_chunk_count, 0)
            self.assertEqual(report.small_unaggregated_chunk_count, 0)

    def test_validation_fails_on_running_header_only_policy_page(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:boilerplate-policy-doc",
                version_id="v1:boilerplate-policy-doc",
                title="贷款制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="贷款制度"),
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
                            clean_text="学生手册",
                            root_unit_id="policy-page-001",
                        ),
                        "metadata": {
                            "title": "贷款制度",
                            "policy_doc_no": "民大校发〔2024〕12号",
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第五章 贷款还款"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.boilerplate_policy_page_count, 1)

    def test_validation_fails_on_weak_appendix_textual_chunk_before_table(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:weak-appendix-doc",
                version_id="v1:weak-appendix-doc",
                title="认定制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="认定制度"),
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
                            clean_text="中央民族大学本科生家庭经济困难学生认定统计表\n学生手册",
                            root_unit_id="policy-page-001",
                        ),
                        "metadata": {
                            "title": "认定制度",
                            "policy_doc_no": "民大校发〔2024〕12号",
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第四章 监督与管理", "中央民族大学本科生家庭经济困难学生认定统计表"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
                + json.dumps(
                    {
                        **_structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="table",
                            clean_text="<table><tr><td>姓名</td><td>院系</td></tr><tr><td>张三</td><td>文学院</td></tr></table>",
                            root_unit_id="table-001",
                        ),
                        "metadata": {
                            "title": "认定制度",
                            "policy_doc_no": "民大校发〔2024〕12号",
                            "table_row_lines": ["张三 | 文学院"],
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第四章 监督与管理", "中央民族大学本科生家庭经济困难学生认定统计表"],
                            "table_context": "中央民族大学本科生家庭经济困难学生认定统计表",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.weak_appendix_textual_chunk_count, 1)

    def test_scan_fails_fast_when_object_store_healthcheck_fails(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:healthcheck-doc",
                version_id="v1:healthcheck-doc",
                title="健康检查制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="健康检查制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FailFastObjectStore({})

            with self.assertRaisesRegex(RuntimeError, "healthcheck failed"):
                scan_student_handbook_chunking(
                    env={
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    registry=_FakeRegistry(record),
                    object_store=object_store,
                    manifest_path=manifest_path,
                    chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
                )

            self.assertEqual(object_store.get_bytes_call_count, 0)

    def test_scan_reuses_document_reads_for_report_and_sample_export(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            output_dir = root / "chunk-samples"

            plain_record = _registry_record(
                document_id="handbook:plain-doc",
                version_id="v1:plain-doc",
                title="普通制度",
            )
            policy_record = _registry_record(
                document_id="handbook:policy-doc",
                version_id="v1:policy-doc",
                title="页面制度",
            )
            table_record = _registry_record(
                document_id="handbook:table-doc",
                version_id="v1:table-doc",
                title="表格制度",
            )
            structure_record = _registry_record(
                document_id="handbook:structure-doc",
                version_id="v1:structure-doc",
                title="结构拆分制度",
            )
            guardrail_record = _registry_record(
                document_id="handbook:guardrail-doc",
                version_id="v1:guardrail-doc",
                title="预算拆分制度",
            )

            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document_with_pages(
                                document_id=plain_record.document_id,
                                title="普通制度",
                                page_start=1,
                                page_end=1,
                            ),
                            _manifest_document_with_pages(
                                document_id=policy_record.document_id,
                                title="页面制度",
                                page_start=2,
                                page_end=2,
                            ),
                            _manifest_document_with_pages(
                                document_id=table_record.document_id,
                                title="表格制度",
                                page_start=3,
                                page_end=3,
                            ),
                            _manifest_document_with_pages(
                                document_id=structure_record.document_id,
                                title="结构拆分制度",
                                page_start=4,
                                page_end=4,
                            ),
                            _manifest_document_with_pages(
                                document_id=guardrail_record.document_id,
                                title="预算拆分制度",
                                page_start=5,
                                page_end=5,
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            structure_text = "\n".join(f"({marker})" + ("甲" * 220) for marker in ("一", "二", "三", "四"))
            guardrail_text = "甲" * 1400
            objects = {
                ("campus-rag-derived", plain_record.document_units_object_key): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=plain_record.document_id,
                                version_id=plain_record.version_id,
                                unit_type="article_body",
                                clean_text="第一条 学校坚持立德树人。",
                                root_unit_id="article-001",
                            ),
                            "metadata": {"title": "普通制度", "article_label": "第一条"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["第一章 总则"],
                                "article_label": "第一条",
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                ("campus-rag-derived", policy_record.document_units_object_key): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=policy_record.document_id,
                                version_id=policy_record.version_id,
                                unit_type="policy_page",
                                clean_text="一、为进一步规范课堂秩序,特制定本办法。",
                                root_unit_id="policy-page-001",
                            ),
                            "metadata": {"title": "页面制度"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["一、总则"],
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                ("campus-rag-derived", table_record.document_units_object_key): (
                    "\n".join(
                        [
                            json.dumps(
                                {
                                    **_structured_row(
                                        doc_id=table_record.document_id,
                                        version_id=table_record.version_id,
                                        unit_type="table",
                                        clean_text="<table><tr><td>等级</td><td>分数</td></tr></table>",
                                        root_unit_id="table-001",
                                    ),
                                    "metadata": {"title": "表格制度", "table_context": "考核等级表"},
                                    "anchor": {"page_start": 1, "page_end": 1, "section_path": ["第一章 总则"]},
                                },
                                ensure_ascii=False,
                            ),
                            json.dumps(
                                {
                                    **_structured_row(
                                        doc_id=table_record.document_id,
                                        version_id=table_record.version_id,
                                        unit_type="table_unit",
                                        clean_text="考核等级表\n等级 | 分数\n优 | 90-100",
                                        root_unit_id="table-001",
                                    ),
                                    "metadata": {
                                        "title": "表格制度",
                                        "table_context": "考核等级表",
                                        "table_header_line": "等级 | 分数",
                                        "table_row_lines": ["优 | 90-100"],
                                    },
                                    "anchor": {"page_start": 1, "page_end": 1, "section_path": ["第一章 总则"]},
                                },
                                ensure_ascii=False,
                            ),
                        ]
                    )
                    + "\n"
                ).encode("utf-8"),
                ("campus-rag-derived", structure_record.document_units_object_key): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=structure_record.document_id,
                                version_id=structure_record.version_id,
                                unit_type="article_body",
                                clean_text=structure_text,
                                root_unit_id="article-001",
                            ),
                            "metadata": {"title": "结构拆分制度", "article_label": "第一条"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["第一章 总则"],
                                "article_label": "第一条",
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                ("campus-rag-derived", guardrail_record.document_units_object_key): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=guardrail_record.document_id,
                                version_id=guardrail_record.version_id,
                                unit_type="policy_page",
                                clean_text=guardrail_text,
                                root_unit_id="policy-page-001",
                            ),
                            "metadata": {"title": "预算拆分制度"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["一、长段正文"],
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
            }
            object_store = _CountingObjectStore(objects)

            scan_result = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(
                    plain_record,
                    policy_record,
                    table_record,
                    structure_record,
                    guardrail_record,
                ),
                object_store=object_store,
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )
            report = build_student_handbook_chunking_validation_report(scan_result=scan_result)
            export_student_handbook_chunk_samples(
                output_dir=output_dir,
                report=report,
                scan_result=scan_result,
                sample_seed=7,
            )

            self.assertEqual(len(object_store.get_bytes_calls), 5)
            self.assertEqual(object_store.healthcheck_calls, ["campus-rag-derived"])

    def test_scan_uses_local_artifact_cache_before_object_store(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            cache_dir = root / "validation-cache"
            record = _registry_record(
                document_id="handbook:cache-doc",
                version_id="v1:cache-doc",
                title="缓存制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="缓存制度"),
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
                            unit_type="article_body",
                            clean_text="第一条 学校坚持立德树人。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "缓存制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")
            object_store = _CountingObjectStore(
                {
                    ("campus-rag-derived", record.document_units_object_key): payload,
                }
            )

            first_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "HANDBOOK_VALIDATION_CACHE_DIR": str(cache_dir),
                },
                registry=_FakeRegistry(record),
                object_store=object_store,
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )
            self.assertEqual(len(first_scan.documents), 1)
            self.assertEqual(len(object_store.get_bytes_calls), 1)

            object_store.get_bytes_calls.clear()
            second_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "HANDBOOK_VALIDATION_CACHE_DIR": str(cache_dir),
                },
                registry=_FakeRegistry(record),
                object_store=object_store,
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(len(second_scan.documents), 1)
            self.assertEqual(object_store.get_bytes_calls, [])
            self.assertTrue(any(cache_dir.rglob("document-units.jsonl")))

    def test_scan_accepts_legacy_processed_bucket_env_via_bucket_resolution(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:legacy-bucket-doc",
                version_id="v1:legacy-bucket-doc",
                title="兼容旧桶配置制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=record.document_id, title="兼容旧桶配置制度"),
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
                            unit_type="article_body",
                            clean_text="第一条 兼容旧桶配置也应读取派生产物。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "兼容旧桶配置制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")
            object_store = _CountingObjectStore(
                {
                    ("legacy-derived", record.document_units_object_key): payload,
                }
            )

            scan_result = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "legacy-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=object_store,
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(len(scan_result.documents), 1)
            self.assertEqual(object_store.healthcheck_calls, ["legacy-derived"])
            self.assertEqual(
                object_store.get_bytes_calls,
                [("legacy-derived", record.document_units_object_key)],
            )

    def test_scan_invalidates_local_artifact_cache_when_version_changes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            cache_dir = root / "validation-cache"
            first_record = _registry_record(
                document_id="handbook:cache-doc",
                version_id="v1:cache-doc",
                title="缓存制度",
            )
            second_record = _registry_record(
                document_id="handbook:cache-doc",
                version_id="v1:cache-doc-updated",
                title="缓存制度",
            )
            self.assertEqual(first_record.document_units_object_key, second_record.document_units_object_key)
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(document_id=first_record.document_id, title="缓存制度"),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            first_payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=first_record.document_id,
                            version_id=first_record.version_id,
                            unit_type="article_body",
                            clean_text="第一条 旧版本正文。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "缓存制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")
            second_payload = (
                json.dumps(
                    {
                        **_structured_row(
                            doc_id=second_record.document_id,
                            version_id=second_record.version_id,
                            unit_type="article_body",
                            clean_text="第一条 新版本正文。",
                            root_unit_id="article-001",
                        ),
                        "metadata": {"title": "缓存制度"},
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")
            object_store = _CountingObjectStore(
                {
                    ("campus-rag-derived", first_record.document_units_object_key): first_payload,
                }
            )

            first_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "HANDBOOK_VALIDATION_CACHE_DIR": str(cache_dir),
                },
                registry=_FakeRegistry(first_record),
                object_store=object_store,
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )
            self.assertEqual(first_scan.documents[0].rows[0]["clean_text"], "第一条 旧版本正文。")
            self.assertEqual(len(object_store.get_bytes_calls), 1)

            object_store.objects[("campus-rag-derived", second_record.document_units_object_key)] = second_payload
            object_store.get_bytes_calls.clear()

            second_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "HANDBOOK_VALIDATION_CACHE_DIR": str(cache_dir),
                },
                registry=_FakeRegistry(second_record),
                object_store=object_store,
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertEqual(second_scan.documents[0].rows[0]["clean_text"], "第一条 新版本正文。")
            self.assertEqual(len(object_store.get_bytes_calls), 1)

    def test_export_chunk_samples_writes_bucketed_markdown_batch(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            output_dir = root / "chunk-samples"

            plain_record = _registry_record(
                document_id="handbook:plain-doc",
                version_id="v1:plain-doc",
                title="普通制度",
            )
            policy_record = _registry_record(
                document_id="handbook:policy-doc",
                version_id="v1:policy-doc",
                title="页面制度",
            )
            table_record = _registry_record(
                document_id="handbook:table-doc",
                version_id="v1:table-doc",
                title="表格制度",
            )
            structure_record = _registry_record(
                document_id="handbook:structure-doc",
                version_id="v1:structure-doc",
                title="结构拆分制度",
            )
            guardrail_record = _registry_record(
                document_id="handbook:guardrail-doc",
                version_id="v1:guardrail-doc",
                title="预算拆分制度",
            )

            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document_with_pages(
                                document_id=plain_record.document_id,
                                title="普通制度",
                                page_start=1,
                                page_end=1,
                            ),
                            _manifest_document_with_pages(
                                document_id=policy_record.document_id,
                                title="页面制度",
                                page_start=2,
                                page_end=2,
                            ),
                            _manifest_document_with_pages(
                                document_id=table_record.document_id,
                                title="表格制度",
                                page_start=3,
                                page_end=3,
                            ),
                            _manifest_document_with_pages(
                                document_id=structure_record.document_id,
                                title="结构拆分制度",
                                page_start=4,
                                page_end=4,
                            ),
                            _manifest_document_with_pages(
                                document_id=guardrail_record.document_id,
                                title="预算拆分制度",
                                page_start=5,
                                page_end=5,
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            structure_text = "\n".join(f"({marker})" + ("甲" * 220) for marker in ("一", "二", "三", "四"))
            guardrail_text = "甲" * 1400

            objects = {
                (
                    "campus-rag-derived",
                    plain_record.document_units_object_key,
                ): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=plain_record.document_id,
                                version_id=plain_record.version_id,
                                unit_type="article_body",
                                clean_text="第一条 学校坚持立德树人。",
                                root_unit_id="article-001",
                            ),
                            "metadata": {"title": "普通制度", "article_label": "第一条"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["第一章 总则"],
                                "article_label": "第一条",
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                (
                    "campus-rag-derived",
                    policy_record.document_units_object_key,
                ): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=policy_record.document_id,
                                version_id=policy_record.version_id,
                                unit_type="policy_page",
                                clean_text="一、为进一步规范课堂秩序,特制定本办法。",
                                root_unit_id="policy-page-001",
                            ),
                            "metadata": {"title": "页面制度"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["一、总则"],
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                (
                    "campus-rag-derived",
                    table_record.document_units_object_key,
                ): (
                    "\n".join(
                        [
                            json.dumps(
                                {
                                    **_structured_row(
                                        doc_id=table_record.document_id,
                                        version_id=table_record.version_id,
                                        unit_type="table",
                                        clean_text="<table><tr><td>等级</td><td>分数</td></tr></table>",
                                        root_unit_id="table-001",
                                    ),
                                    "metadata": {
                                        "title": "表格制度",
                                        "article_label": "第一条",
                                        "table_context": "考核等级表",
                                    },
                                    "anchor": {
                                        "page_start": 1,
                                        "page_end": 1,
                                        "section_path": ["第一章 总则"],
                                        "article_label": "第一条",
                                    },
                                },
                                ensure_ascii=False,
                            ),
                            json.dumps(
                                {
                                    **_structured_row(
                                        doc_id=table_record.document_id,
                                        version_id=table_record.version_id,
                                        unit_type="table_unit",
                                        clean_text="考核等级表\n等级 | 分数\n优 | 90-100",
                                        root_unit_id="table-001",
                                    ),
                                    "metadata": {
                                        "title": "表格制度",
                                        "article_label": "第一条",
                                        "table_context": "考核等级表",
                                        "table_header_line": "等级 | 分数",
                                        "table_row_lines": ["优 | 90-100"],
                                    },
                                    "anchor": {
                                        "page_start": 1,
                                        "page_end": 1,
                                        "section_path": ["第一章 总则"],
                                        "article_label": "第一条",
                                    },
                                },
                                ensure_ascii=False,
                            ),
                        ]
                    )
                    + "\n"
                ).encode("utf-8"),
                (
                    "campus-rag-derived",
                    structure_record.document_units_object_key,
                ): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=structure_record.document_id,
                                version_id=structure_record.version_id,
                                unit_type="article_body",
                                clean_text=structure_text,
                                root_unit_id="article-001",
                            ),
                            "metadata": {"title": "结构拆分制度", "article_label": "第一条"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["第一章 总则"],
                                "article_label": "第一条",
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                (
                    "campus-rag-derived",
                    guardrail_record.document_units_object_key,
                ): (
                    json.dumps(
                        {
                            **_structured_row(
                                doc_id=guardrail_record.document_id,
                                version_id=guardrail_record.version_id,
                                unit_type="policy_page",
                                clean_text=guardrail_text,
                                root_unit_id="policy-page-001",
                            ),
                            "metadata": {"title": "预算拆分制度"},
                            "anchor": {
                                "page_start": 1,
                                "page_end": 1,
                                "section_path": ["一、长段正文"],
                            },
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
            }

            export_student_handbook_chunk_samples(
                output_dir=output_dir,
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(
                    plain_record,
                    policy_record,
                    table_record,
                    structure_record,
                    guardrail_record,
                ),
                object_store=_FakeObjectStore(objects),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
                sample_seed=7,
            )

            self.assertTrue((output_dir / "INDEX.md").exists())
            self.assertTrue((output_dir / "validation-report.json").exists())
            self.assertTrue((output_dir / "header-budget-summary.json").exists())
            self.assertTrue((output_dir / "oversize-chunks.json").exists())

            index_text = (output_dir / "INDEX.md").read_text(encoding="utf-8")
            self.assertIn("structure-boundary", index_text)
            self.assertIn("token-guardrail", index_text)
            self.assertIn("table", index_text)
            self.assertIn("policy-page", index_text)
            self.assertIn("plain-article", index_text)
            self.assertEqual(len(list(output_dir.glob("*.md"))), 6)

            table_sample = (output_dir / "03-table.md").read_text(encoding="utf-8")
            self.assertNotIn("<table>", table_sample)
            self.assertNotIn("- unit_type: `table`", table_sample)
            self.assertIn("- unit_type: `table_unit`", table_sample)

    def test_validation_fails_when_table_chunk_contains_unnamed_column_label(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "split-manifest.v1.json"
            record = _registry_record(
                document_id="handbook:test-doc",
                version_id="v1:test-doc",
                title="表格制度",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id,
                                title="表格制度",
                            ),
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
                            unit_type="table_unit",
                            clean_text="考核等级表\n未命名列 | 分数\n优 | 90-100",
                            root_unit_id="table-001",
                        ),
                        "metadata": {
                            "title": "表格制度",
                            "table_header_line": "未命名列 | 分数",
                            "table_row_lines": ["优 | 90-100"],
                            "table_row_count": 1,
                        },
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "section_path": ["第一章 总则"],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")

            report = validate_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                registry=_FakeRegistry(record),
                object_store=_FakeObjectStore(
                    {
                        ("campus-rag-derived", record.document_units_object_key): payload,
                    }
                ),
                manifest_path=manifest_path,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertFalse(report.passed)
            self.assertEqual(report.generic_table_label_chunk_count, 1)


if __name__ == "__main__":
    unittest.main()
