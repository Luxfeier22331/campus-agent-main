from __future__ import annotations

import unittest

from .processing_pipeline_test_support import *


class ProcessingPipelinePolicyChunkingMergeTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_rewrites_parent_table_html_to_placeholder(
        self,
    ) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "legacy-chunk-001",
                        "unit_type": "article_body",
                        "root_unit_id": "article-001",
                        "clean_text": (
                            "Library opening hours are listed below.\n"
                            "<table><tr><td>Mon</td><td>08:00-22:00</td></tr></table>\n"
                            "The library remains open for regular student use."
                        ),
                        "anchor": {
                            "section_path": ["Student Handbook", "Library", "Hours"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.source_chunk_id, "legacy-chunk-001")
        self.assertEqual(chunk.metadata["unit_type"], "article_body")
        self.assertEqual(chunk.metadata["root_unit_id"], "article-001")
        self.assertNotIn("<table>", chunk.text)
        self.assertIn(TABLE_PLACEHOLDER, chunk.text)
        self.assertIn("library remains open", chunk.text.lower())

    def test_build_indexable_chunks_from_jsonl_splits_oversized_unit_and_keeps_root_metadata(
        self,
    ) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "legacy-chunk-001",
                        "unit_type": "article_body",
                        "root_unit_id": "article-001",
                        "clean_text": " ".join(f"token-{index:04d}" for index in range(520)),
                    }
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertGreater(len(chunks), 1)
        self.assertEqual(
            tuple(chunk.metadata["segment_index"] for chunk in chunks),
            tuple(range(1, len(chunks) + 1)),
        )
        self.assertTrue(all(chunk.metadata["segment_total"] == len(chunks) for chunk in chunks))
        self.assertTrue(
            all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in chunks)
        )
        self.assertTrue(all(chunk.metadata["unit_type"] == "article_body" for chunk in chunks))
        self.assertTrue(all(chunk.metadata["root_unit_id"] == "article-001" for chunk in chunks))

    def test_build_indexable_chunks_merges_adjacent_short_textual_units_before_embedding(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应按时注册。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应按时缴费。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第三条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-004",
                        unit_type="article_body",
                        root_unit_id="article-004",
                        clean_text="学生应遵守宿舍秩序。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第四条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.anchor["article_label"], "第二条-第四条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 3)
        self.assertEqual(
            chunk.metadata["member_root_unit_ids"],
            ["article-002", "article-003", "article-004"],
        )
        self.assertEqual(
            chunk.metadata["member_article_labels"],
            ["第二条", "第三条", "第四条"],
        )
        self.assertIn("第二条 学生应按时注册。", chunk.metadata["display_text"])
        self.assertIn("第三条 学生应按时缴费。", chunk.metadata["display_text"])
        self.assertIn("第四条 学生应遵守宿舍秩序。", chunk.metadata["display_text"])
        self.assertIn("第二条-第四条", chunk.text)

    def test_build_indexable_chunks_does_not_merge_short_textual_units_across_table_units(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应按时注册。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="table-001",
                        unit_type="table_unit",
                        root_unit_id="table-001",
                        clean_text="学生类别 | 管理要求\n本科生 | 按学期注册",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "table_context": "学生类别与管理要求",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata={
                            **metadata,
                            "table_header_line": "学生类别 | 管理要求",
                            "table_row_lines": ["本科生 | 按学期注册"],
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应按时缴费。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第三条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 3)
        self.assertEqual(
            [chunk.metadata["unit_type"] for chunk in chunks],
            ["article_body", "table_unit", "article_body"],
        )
        self.assertIsNone(chunks[0].metadata.get("aggregation_mode"))
        self.assertIsNone(chunks[2].metadata.get("aggregation_mode"))
        self.assertEqual(chunks[1].metadata["unit_type"], "table_unit")

    def test_build_indexable_table_chunks_expose_release_gate_header_metadata(
        self,
    ) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="table-001",
                        unit_type="table_unit",
                        root_unit_id="table-001",
                        clean_text="学生类别 | 管理要求\n本科生 | 按学期注册",
                        anchor={"section_path": ["第一章 总则"]},
                        metadata={
                            "title": "中央民族大学学生管理规定",
                            "table_header_line": "学生类别 | 管理要求",
                            "table_column_paths": ["学生类别", "管理要求"],
                            "table_row_lines": ["本科生 | 按学期注册"],
                        },
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["table_headers"], ["学生类别", "管理要求"])
        self.assertEqual(chunks[0].metadata["table_columns"], ["学生类别", "管理要求"])

    def test_build_indexable_chunks_clears_segment_metadata_after_short_textual_merge(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应按时注册。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应按时缴费。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第三条",
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertIsNone(chunks[0].metadata["segment_index"])
        self.assertIsNone(chunks[0].metadata["segment_total"])
        self.assertEqual(
            chunks[0].metadata["member_segment_lineage"],
            [
                {
                    "root_unit_id": "article-002",
                    "segment_index": 1,
                    "segment_total": 1,
                },
                {
                    "root_unit_id": "article-003",
                    "segment_index": 1,
                    "segment_total": 1,
                },
            ],
        )

    def test_build_indexable_chunks_absorbs_trailing_short_tail_into_previous_textual_chunk(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生管理规定",
            "policy_doc_no": "民大校发〔2024〕12号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="学生应当遵守学校管理制度。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第二条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-003",
                        unit_type="article_body",
                        root_unit_id="article-003",
                        clean_text="学生应当完成学籍注册。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第三条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-004",
                        unit_type="article_body",
                        root_unit_id="article-004",
                        clean_text="学生应当按时缴纳相关费用。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第四条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-005",
                        unit_type="article_body",
                        root_unit_id="article-005",
                        clean_text="学生应当维护校园秩序。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第五条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-006",
                        unit_type="article_body",
                        root_unit_id="article-006",
                        clean_text="本办法自公布之日起施行。",
                        anchor={
                            "section_path": ["第三章 学生支持"],
                            "article_label": "第六条",
                            "page_start": 2,
                            "page_end": 2,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.anchor["article_label"], "第二条-第六条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 5)
        self.assertIn("第五条", chunk.metadata["display_text"])
        self.assertIn("第六条 本办法自公布之日起施行。", chunk.metadata["display_text"])
