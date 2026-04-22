from __future__ import annotations

import unittest

from .processing_pipeline_test_support import *  # noqa: F401,F403


class ProcessingPipelinePolicyChunkingTest(unittest.TestCase):
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

    def test_build_indexable_chunks_merges_first_article_even_when_only_first_has_preface_text(
        self,
    ) -> None:
        record = _make_registry_record()
        base_metadata = {
            "title": "中央民族大学学生资助管理工作暂行办法",
            "policy_doc_no": "民大校发〔2012〕357号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-001",
                        unit_type="article_body",
                        root_unit_id="article-001",
                        clean_text="坚持公平、公开、公正原则,合理分配资助资源。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata={
                            **base_metadata,
                            "preface_text": "为规范学校学生资助工作,制定本办法。",
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="坚持资助与解困、助学与育人相结合的原则。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=base_metadata,
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
        self.assertEqual(chunk.anchor["article_label"], "第一条-第二条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertNotIn("preface_text", chunk.metadata)
        self.assertIn("第一条 坚持公平、公开、公正原则", chunk.metadata["display_text"])
        self.assertIn(
            "第二条 坚持资助与解困、助学与育人相结合的原则。", chunk.metadata["display_text"]
        )

    def test_build_indexable_chunks_merges_short_policy_page_siblings_under_shared_parent(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生志愿服务管理办法",
            "policy_doc_no": "民大团发〔2010〕14号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-010",
                        unit_type="policy_page",
                        root_unit_id="policy-010",
                        clean_text="志愿服务认证是针对注册志愿服务组织、志愿者组织和参加的各项志愿服务活动而定期开展的志愿服务评定工作。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-011",
                        unit_type="policy_page",
                        root_unit_id="policy-011",
                        clean_text="(一)每学年第一学期,针对全体注册志愿者开展志愿服务认证。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证", "一、认证时间"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-012",
                        unit_type="policy_page",
                        root_unit_id="policy-012",
                        clean_text="共青团中央民族大学委员会(青年志愿者工作部)。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证", "三、认证程序"],
                            "page_start": 3,
                            "page_end": 3,
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
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 3)
        self.assertEqual(chunk.anchor["section_path"], ["第二章 分则", "第二部分 认证"])
        self.assertIn("第二部分 认证", chunk.text)
        self.assertIn(
            "(一)每学年第一学期,针对全体注册志愿者开展志愿服务认证。",
            chunk.metadata["display_text"],
        )
        self.assertIn(
            "共青团中央民族大学委员会(青年志愿者工作部)。", chunk.metadata["display_text"]
        )
        self.assertNotIn("一、认证时间 (一)每学年第一学期", chunk.metadata["display_text"])
        self.assertNotIn("三、认证程序 共青团中央民族大学委员会", chunk.metadata["display_text"])

    def test_build_indexable_chunks_does_not_repeat_policy_section_heading_inside_display_text(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学学生课堂行为规范及课堂秩序管理办法",
            "policy_doc_no": "民大校发[2007]282号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-020",
                        unit_type="policy_page",
                        root_unit_id="policy-020",
                        clean_text="12、学生课堂行为规范和秩序的管理依照“全员参与、分级管理”的原则进行。",
                        anchor={
                            "section_path": ["三、学生课堂秩序管理"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-021",
                        unit_type="policy_page",
                        root_unit_id="policy-021",
                        clean_text="四、本办法由学生工作部(处)负责解释。",
                        anchor={
                            "section_path": ["三、学生课堂秩序管理"],
                            "provision_label": "四",
                            "page_start": 3,
                            "page_end": 3,
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
                max_chunk_size=512,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertIn("12、学生课堂行为规范和秩序的管理依照", chunk.metadata["display_text"])
        self.assertNotIn("三、学生课堂秩序管理 12、", chunk.metadata["display_text"])
        self.assertIn("\n\n四、本办法由学生工作部(处)负责解释。", chunk.metadata["display_text"])
        self.assertNotIn("三、学生课堂秩序管理 12、", chunk.text)

    def test_build_indexable_chunks_does_not_merge_policy_procedure_block_with_closing_provisions(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "中央民族大学全日制本科学生学士学位授予规定",
            "policy_doc_no": "民大校发[2009]90号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-030",
                        unit_type="policy_page",
                        root_unit_id="policy-030",
                        clean_text="\n".join(
                            [
                                "1. 学生本人提出申请,填报学士学位申请表。",
                                "2. 院(系)学位委员会对提出申请授予学士学位的学生进行审核,提出建议授予学士学位名单和不授予学士学位名单。",
                                "3. 教务处审核全部学生材料并负责向校学位委员会提出召开学士学位评定委员会会议。",
                                "4. 校学位委员会审查通过获得学士学位的学生名单。",
                            ]
                        ),
                        anchor={
                            "section_path": ["三、学士学位授予程序"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-031",
                        unit_type="policy_page",
                        root_unit_id="policy-031",
                        clean_text="四、学士学位证书遗失不予补发。如遗失或者损坏,经本人申请,学校核实后出具相应的证明书。证明书与原证书具有同等效力。",
                        anchor={
                            "provision_label": "四",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-032",
                        unit_type="policy_page",
                        root_unit_id="policy-032",
                        clean_text="五、本规定自2009年3月17日起实施。",
                        anchor={
                            "provision_label": "五",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-033",
                        unit_type="policy_page",
                        root_unit_id="policy-033",
                        clean_text="六、本规定由教务处负责解释。",
                        anchor={
                            "provision_label": "六",
                            "page_start": 3,
                            "page_end": 3,
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
                max_chunk_size=512,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 2)
        self.assertNotIn("四、学士学位证书遗失不予补发", chunks[0].metadata["display_text"])
        self.assertEqual(chunks[1].anchor["provision_label"], "四-六")
        self.assertEqual(chunks[1].metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertIn("四、学士学位证书遗失不予补发", chunks[1].metadata["display_text"])
        self.assertIn("五、本规定自2009年3月17日起实施。", chunks[1].metadata["display_text"])
        self.assertIn("六、本规定由教务处负责解释。", chunks[1].metadata["display_text"])
        self.assertNotIn("三、学士学位授予程序", chunks[1].text)

    def test_build_indexable_chunks_marks_time_rule_policy_page_as_answer_bearing(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-time-rule",
                        unit_type="policy_page",
                        root_unit_id="policy-time-rule",
                        clean_text="冬季作息时间为周日至周四23:00熄灯，周五至周六23:30熄灯。",
                        anchor={
                            "section_path": ["一、时间安排"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        metadata={"title": "中央民族大学学生宿舍管理规定"},
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=256, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["detail_label"], "一、时间安排")
        self.assertEqual(chunk.metadata["content_role"], "time_rule")
        self.assertTrue(chunk.metadata["is_answer_bearing"])

    def test_build_indexable_chunks_marks_scope_rule_policy_page_as_non_answer_bearing(
        self,
    ) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-scope-rule",
                        unit_type="policy_page",
                        root_unit_id="policy-scope-rule",
                        clean_text="本规定适用于全日制本科生在校期间的住宿管理。",
                        anchor={
                            "provision_label": "三",
                            "page_start": 12,
                            "page_end": 12,
                        },
                        metadata={"title": "中央民族大学学生宿舍管理规定"},
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=256, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["detail_label"], "三")
        self.assertEqual(chunk.metadata["content_role"], "scope_rule")
        self.assertFalse(chunk.metadata["is_answer_bearing"])
