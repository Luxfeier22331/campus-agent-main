from __future__ import annotations

import unittest

from campus_ingestion_core.index_release import validate_scope_release
from campus_ingestion_core.process import IndexableChunk


def _make_chunk(
    *,
    chunk_id: str,
    text: str,
    section_path: list[str],
    tokens: int,
    unit_type: str = "section_text",
) -> IndexableChunk:
    return IndexableChunk(
        document_id="curriculum:test",
        revision_track="source-faithful",
        version_id="sha256:test",
        chunk_id=chunk_id,
        chunk_order=1,
        corpus="curriculum",
        collection="curriculum_plan",
        acl_groups=("students",),
        campus_scope="main",
        source_uri="https://campus.example/curriculum:test",
        source_chunk_id=None,
        acl_level="public",
        anchor={"section_path": section_path, "page_start": 1, "page_end": 1},
        text=text,
        source_channel="pdf_ocr",
        is_current=True,
        parser_version="raw-online-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        metadata={
            "unit_type": unit_type,
            "final_token_count": tokens,
            "segment_total": 1,
        },
    )


class IndexReleaseValidationTest(unittest.TestCase):
    def test_curriculum_validation_allows_concise_fact_sections(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="五、学制 两年",
                    section_path=["民族学本科第二学士学位人才培养方案", "五、学制 两年"],
                    tokens=6,
                ),
                _make_chunk(
                    chunk_id="chunk-0002",
                    text="八、教学进程计划表\n\n专业代码:060104",
                    section_path=["八、教学进程计划表"],
                    tokens=22,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)

    def test_curriculum_validation_keeps_suspicious_tiny_chunks_as_failures(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="课程号 | 学分",
                    section_path=["六、课程地图"],
                    tokens=8,
                    unit_type="table_unit",
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 1)

    def test_curriculum_validation_allows_course_map_title_chunks_as_observations(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="六、课程地图\n\n经济学拔尖人才创新班本科课程结果拓扑图",
                    section_path=["经济学拔尖人才创新班人才培养方案", "六、课程地图"],
                    tokens=12,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)
        self.assertEqual(validation.summary["course_map_chunks"], 1)

    def test_curriculum_validation_allows_short_course_map_reference_note(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="六、课程地图\n\n参见各专业培养方案的课程地图。",
                    section_path=["理工科交叉创新人才培养实验班本科人才培养方案", "六、课程地图"],
                    tokens=15,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)


if __name__ == "__main__":
    unittest.main()
