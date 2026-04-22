from __future__ import annotations

import unittest

from .handbook_chunking_validation_test_support import *  # noqa: F401,F403


class HandbookChunkingValidationTableAndAppendixTest(unittest.TestCase):
    def test_validation_fails_when_policy_page_promotes_body_sentence_into_section_path(
        self,
    ) -> None:
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                            "section_path": [
                                "第一章 总则",
                                "一、为进一步规范学生管理工作,特制定本办法。",
                            ],
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                            "section_path": [
                                "第四章 监督与管理",
                                "中央民族大学本科生家庭经济困难学生认定统计表",
                            ],
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
                            "section_path": [
                                "第四章 监督与管理",
                                "中央民族大学本科生家庭经济困难学生认定统计表",
                            ],
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
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
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
