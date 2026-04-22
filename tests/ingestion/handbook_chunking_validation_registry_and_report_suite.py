from __future__ import annotations

import unittest

from .handbook_chunking_validation_test_support import *  # noqa: F401,F403


class HandbookChunkingValidationRegistryAndReportTest(unittest.TestCase):
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
                            _manifest_document(
                                document_id=valid_record.document_id, title="有效制度"
                            ),
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
                        (
                            "campus-rag-derived",
                            valid_record.document_units_object_key,
                        ): valid_payload,
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
                [f"({marker})" + ("甲" * 220) for marker in ("一", "二", "三", "四")]
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

            structure_text = "\n".join(
                f"({marker})" + ("甲" * 220) for marker in ("一", "二", "三", "四")
            )
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
