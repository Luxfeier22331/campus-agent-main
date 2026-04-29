from __future__ import annotations

import unittest

from .processing_pipeline_test_support import *


class ProcessingPipelineOfficialWebTest(unittest.TestCase):
    def test_build_indexable_chunks_deduplicates_identical_official_web_title_and_section_path(
        self,
    ) -> None:
        record = _make_official_web_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0001",
                        unit_type="link_list",
                        root_unit_id=f"{record.document_id}:root-0001",
                        clean_text="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        anchor={
                            "section_path": ["教学科研"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/jxky.htm",
                            "page_family": "listing_page",
                        },
                        metadata={
                            "title": "教学科研",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "declaration_id": "muc_public_listing_page_v1",
                        },
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertTrue(chunk.metadata["contextualized_text"])
        self.assertNotIn("教学科研 / 教学科研", chunk.text)
        self.assertNotIn("标题：教学科研 | 章节：教学科研", chunk.text)
        self.assertTrue(chunk.text.startswith("教学科研\n"))
        self.assertIn("中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会", chunk.text)

    def test_build_indexable_chunks_uses_official_web_collection_specific_strategy(self) -> None:
        record = _make_official_web_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0001",
                        unit_type="section_text",
                        root_unit_id=f"{record.document_id}:root-0001",
                        clean_text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                        anchor={
                            "section_path": ["校园新闻"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.muc.edu.cn/info/1002/10001.htm",
                            "page_family": "article_detail",
                        },
                        metadata={
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "www.muc.edu.cn",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "primary_content",
                        },
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["strategy_name"], "official_web_structure_v2")
        self.assertEqual(chunks[0].metadata["chunk_policy_version"], "official_web_semantic_v2")
        self.assertEqual(chunks[0].metadata["cleaning_policy_version"], "official_web_cleaning_v2")

    def test_build_indexable_chunks_uses_official_web_strategy_for_stable_reference_scope(
        self,
    ) -> None:
        record = _make_official_web_registry_record(collection="stable_reference")
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0001",
                        unit_type="section_text",
                        root_unit_id=f"{record.document_id}:root-0001",
                        clean_text="学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                        anchor={
                            "section_path": ["人才培养"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.muc.edu.cn/rcpy/bkpy.htm",
                            "page_family": "article_detail",
                        },
                        metadata={
                            "title": "本科培养",
                            "site_id": "muc_public",
                            "host": "www.muc.edu.cn",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "reference_fact",
                        },
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["strategy_name"], "official_web_structure_v2")
        self.assertEqual(chunks[0].metadata["chunk_policy_version"], "official_web_semantic_v2")
        self.assertEqual(chunks[0].metadata["cleaning_policy_version"], "official_web_cleaning_v2")

    def test_build_indexable_chunks_skips_support_only_official_web_units(self) -> None:
        record = _make_official_web_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0001",
                        unit_type="section_text",
                        root_unit_id=f"{record.document_id}:root-0001",
                        clean_text="学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                        anchor={
                            "section_path": ["人才培养"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.muc.edu.cn/rcpy/bkpy.htm",
                            "page_family": "article_detail",
                        },
                        metadata={
                            "title": "本科培养",
                            "site_id": "muc_public",
                            "host": "www.muc.edu.cn",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "reference_fact",
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0002",
                        unit_type="section_text",
                        root_unit_id=f"{record.document_id}:root-0002",
                        clean_text="（来源：教务处）",
                        anchor={
                            "section_path": ["人才培养"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.muc.edu.cn/rcpy/bkpy.htm",
                            "page_family": "article_detail",
                        },
                        metadata={
                            "title": "本科培养",
                            "site_id": "muc_public",
                            "host": "www.muc.edu.cn",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "source_attribution",
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0003",
                        unit_type="section_text",
                        root_unit_id=f"{record.document_id}:root-0003",
                        clean_text="投稿方式：mucxcb@muc.edu.cn",
                        anchor={
                            "section_path": ["人才培养"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.muc.edu.cn/rcpy/bkpy.htm",
                            "page_family": "article_detail",
                        },
                        metadata={
                            "title": "本科培养",
                            "site_id": "muc_public",
                            "host": "www.muc.edu.cn",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "boilerplate",
                        },
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["content_role"], "reference_fact")
        self.assertNotIn("教务处", chunks[0].text)
        self.assertNotIn("投稿方式", chunks[0].text)

    def test_build_indexable_chunks_keeps_labeled_header_for_short_official_web_sections(
        self,
    ) -> None:
        record = _make_official_web_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:unit-0001",
                        unit_type="section_text",
                        root_unit_id=f"{record.document_id}:root-0001",
                        clean_text="图书馆馆藏图书500万余册，是首批全国古籍重点保护单位。",
                        anchor={
                            "section_path": ["学校概况", "学校简介"],
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.muc.edu.cn/xxgk1/xxgk.htm",
                            "page_family": "article_detail",
                        },
                        metadata={
                            "title": "学校概况",
                            "site_id": "muc_public",
                            "host": "www.muc.edu.cn",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "reference_fact",
                        },
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        first_line = chunks[0].text.splitlines()[0]
        self.assertEqual(chunks[0].metadata["header_mode"], "compact_path")
        self.assertTrue(first_line.startswith("标题：学校概况 | 章节：学校简介"))
        self.assertNotIn("学校概况 / 学校简介", first_line)
