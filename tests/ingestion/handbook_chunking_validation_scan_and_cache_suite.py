from __future__ import annotations

import unittest

from .handbook_chunking_validation_test_support import *


class HandbookChunkingValidationScanAndCacheTest(unittest.TestCase):
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="健康检查制度"
                            ),
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
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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

            structure_text = "\n".join(
                f"({marker})" + ("甲" * 220) for marker in ("一", "二", "三", "四")
            )
            guardrail_text = "甲" * 1400
            objects = {
                ("campus-agent-derived", plain_record.document_units_object_key): (
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
                ("campus-agent-derived", policy_record.document_units_object_key): (
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
                ("campus-agent-derived", table_record.document_units_object_key): (
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
                                        "table_context": "考核等级表",
                                    },
                                    "anchor": {
                                        "page_start": 1,
                                        "page_end": 1,
                                        "section_path": ["第一章 总则"],
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
                                        "table_context": "考核等级表",
                                        "table_header_line": "等级 | 分数",
                                        "table_row_lines": ["优 | 90-100"],
                                    },
                                    "anchor": {
                                        "page_start": 1,
                                        "page_end": 1,
                                        "section_path": ["第一章 总则"],
                                    },
                                },
                                ensure_ascii=False,
                            ),
                        ]
                    )
                    + "\n"
                ).encode("utf-8"),
                ("campus-agent-derived", structure_record.document_units_object_key): (
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
                ("campus-agent-derived", guardrail_record.document_units_object_key): (
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
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
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
            self.assertEqual(object_store.healthcheck_calls, ["campus-agent-derived"])

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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                    ("campus-agent-derived", record.document_units_object_key): payload,
                }
            )

            first_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
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
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=record.document_id, title="兼容旧桶配置制度"
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
            self.assertEqual(
                first_record.document_units_object_key, second_record.document_units_object_key
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:test-handbook",
                        "documents": [
                            _manifest_document(
                                document_id=first_record.document_id, title="缓存制度"
                            ),
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
                    ("campus-agent-derived", first_record.document_units_object_key): first_payload,
                }
            )

            first_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
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

            object_store.objects[
                ("campus-agent-derived", second_record.document_units_object_key)
            ] = second_payload
            object_store.get_bytes_calls.clear()

            second_scan = scan_student_handbook_chunking(
                env={
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
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
