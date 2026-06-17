from __future__ import annotations

import re
import unittest
from itertools import pairwise

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.regulation_document_units import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
    SCOPED_TARGET_COLLECTION,
    serialize_regulation_document_units,
)


class RegulationChunkPrecisionTest(unittest.TestCase):
    def test_scoped_rule_chunks_use_structural_list_boundaries_without_overlap(self) -> None:
        chunks = _build_scoped_rule_chunks(
            canonical_markdown=(
                "# 药学院2021年硕博连读博士研究生招生实施细则\n\n"
                "三、申请条件\n\n"
                "（四）、硕士研究生培养阶段至少须有一项高水平科研成果，包括已发表的学术论文、资政报告或科研成果奖励等。科研成果至少满足下列要求中的一项：\n"
                "1. 在中文核心及以上期刊至少发表1篇学术论文，正式发表或在线（ONLINE）发表均可；\n"
                "2. 至少获得1项省部级及以上科研成果（申请人排名前8名），或国家一级协会或学会一等奖及以上奖项（申请人排名前5名），或国家一级协会或学会一等奖以下奖项（申请人排名前3名），教学类奖项和学科竞赛类奖项不属于科研获奖；\n"
                "3. 以排名前3发明人获得至少1项授权专利，或以排名前2发明人申请至少1项专利；\n"
                "4. 经药学院研究生招生领导小组审议的被第三方认可的其他科研成果至少1项。"
            )
        )

        body_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata.get("answer_role") == "eligibility_condition"
            and chunk.metadata.get("content_role") == "eligibility"
        ]

        self.assertGreaterEqual(len(body_chunks), 2)
        for left, right in pairwise(body_chunks):
            self.assertFalse(
                _meaningful_line_overlap(
                    str(left.metadata.get("display_text") or ""),
                    str(right.metadata.get("display_text") or ""),
                ),
                f"adjacent chunks overlap:\nLEFT={left.metadata.get('display_text')}\nRIGHT={right.metadata.get('display_text')}",
            )

        labels = [
            str(chunk.metadata.get("provision_label") or "")
            for chunk in body_chunks
            if "授权专利" in str(chunk.metadata.get("display_text") or "")
        ]
        self.assertTrue(labels)
        self.assertTrue(all(label != "（四）、" for label in labels))
        self.assertTrue(any("3." in label for label in labels), labels)

    def test_scoped_rule_chunks_label_multi_item_segments_by_item_range(self) -> None:
        chunks = _build_scoped_rule_chunks(
            canonical_markdown=(
                "# 中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则\n\n"
                "三、申请条件\n\n"
                "（一）基本条件\n\n"
                "1. 坚定对伟大祖国、中华民族、中华文化、中国共产党、中国特色社会主义的高度认同，维护祖国统一和民族团结，遵纪守法，品行端正，无任何违法违纪受处分记录，诚实守信，学风端正。\n"
                "2. 已完成的专业必修课和专业选修课成绩均不低于80分，其他课程成绩均不低于70分。\n"
                "3. 遵守学术道德，具备创新精神和培养潜质。\n"
                "4. 至少有2名所报考学科专业领域的教授或相当专业技术职称的专家做出书面推荐。\n"
                "5. 硕博连读申报的博士专业一般应与硕士就读专业属于同一个一级学科。对于跨学位类型、跨一级学科的申请人，要具备跨学科的潜力和科研能力。\n"
                "6. 身心健康，身体健康状况符合《普通高等学校招生体检工作指导意见》的相关要求。"
            )
        )

        multi_item_chunks = [
            chunk
            for chunk in chunks
            if len(_enumerated_labels(str(chunk.metadata.get("display_text") or ""))) >= 2
        ]

        self.assertTrue(multi_item_chunks)
        self.assertTrue(
            all(
                "-" in str(chunk.metadata.get("provision_label") or "")
                for chunk in multi_item_chunks
            ),
            [chunk.metadata.get("provision_label") for chunk in multi_item_chunks],
        )
        self.assertFalse(
            any(
                str(chunk.metadata.get("provision_label") or "") == "1."
                for chunk in multi_item_chunks
            )
        )

    def test_short_scoped_rule_subject_value_is_contextualized_in_display_text(self) -> None:
        chunks = _build_scoped_rule_chunks(
            canonical_markdown=(
                "# 中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则\n\n"
                "一、招生专业\n\n"
                "新闻传播学"
            )
        )

        subject_chunks = [
            chunk
            for chunk in chunks
            if "新闻传播学" in str(chunk.metadata.get("display_text") or "")
        ]

        self.assertEqual(len(subject_chunks), 1)
        self.assertEqual(
            subject_chunks[0].metadata["display_text"],
            "招生专业：新闻传播学",
        )
        self.assertEqual(int(subject_chunks[0].metadata["final_token_count"]), 10)


def _build_scoped_rule_chunks(*, canonical_markdown: str):
    document_id = "institutional_regulation:muc:test-scoped-rule"
    version_id = f"{document_id}@2025-12-16"
    title = canonical_markdown.splitlines()[0].removeprefix("# ").strip()
    document_units_bytes = serialize_regulation_document_units(
        target_collection=SCOPED_TARGET_COLLECTION,
        target_document_id=document_id,
        version_id=version_id,
        title=title,
        canonical_markdown=canonical_markdown,
        source_url="campusrag://authenticated-notice/353963",
        visibility_level="restricted",
        visibility_scope="campus",
        entitlement_groups=["campus_members"],
        common_metadata={
            "source_notice_ids": ["353963"],
            "source_document_ids": ["notice:muc_internal_portal:353963"],
            "source_channel": "authenticated_notice_portal",
            "source_surface": "notice_body",
            "source_notice_release_time": "2025-12-16 11:15",
            "document_nature": "time_bound_operational_rule",
            "cycle_year": "2025",
            "school_unit_name": "新闻与传播学院",
            "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
            "normalization_quality": "passed",
        },
        semantic_content_hash="test-scoped-rule-hash",
    )
    record = DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri="campusrag://authenticated-notice/353963",
        content_hash="test-scoped-rule-hash",
        corpus="regulations",
        collection=SCOPED_TARGET_COLLECTION,
        cleaning_policy_version="scoped_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-05-02T00:00:00+00:00",
        parser_version="historical_regulation_denominator_expansion_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        import_source="test",
    )
    return build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=document_units_bytes,
    )


def _meaningful_line_overlap(left: str, right: str) -> bool:
    left_lines = {_compact(line) for line in left.splitlines() if len(_compact(line)) >= 18}
    right_lines = {_compact(line) for line in right.splitlines() if len(_compact(line)) >= 18}
    return bool(left_lines & right_lines)


def _enumerated_labels(text: str) -> list[str]:
    pattern = re.compile(r"(^|\n)\s*((?:\d+[.、])|(?:[（(][一二三四五六七八九十]+[)）][、.]?))")
    return list(dict.fromkeys(match.group(2).strip() for match in pattern.finditer(text)))


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text).strip("，。；;:：、")


if __name__ == "__main__":
    unittest.main()
