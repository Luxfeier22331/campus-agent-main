from __future__ import annotations

import re
from pathlib import Path

from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    extract_html_table_cells,
    infer_list_level_hint,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    is_bottom_band,
    normalize_bbox,
    normalize_text,
)

LAYOUT_ELEMENTS_SCHEMA_VERSION = "curriculum_layout_elements_v3"
_CN_SECTION_RE = re.compile(r"^[一二三四五六七八九十]+、")
_CN_SUBSECTION_RE = re.compile(r"^[（(][一二三四五六七八九十]+[)）]")
_NUMERIC_HEADING_RE = re.compile(r"^\d+[\.．、]")
_CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十百千万〇零0-9]+[章节]")
_SENTENCE_PUNCTUATION_RE = re.compile(r"[。！？；?!;]")
_LIST_LIKE_LINE_RE = re.compile(
    r"^(?:[-*•]|[0-9]+[\.．、)]|[（(][一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、|第[一二三四五六七八九十百千万〇零0-9]+[章节])"
)
_FIELD_LABEL_LINE_RE = re.compile(
    r"^(?:备注|课程类|课程号|课程名称|学分|学时|实践学时|开设学期|修读学期)[:：]"
)
_DECIMAL_LIST_MARKER_AFTER_SENTENCE_RE = re.compile(r"(?<=[。！？；!?;])(?=\d+\.\d+\s)")
_MISSING_NUMERIC_LIST_DOT_RE = re.compile(
    r"(?m)^(?P<number>[1-9]\d?)(?P<body>[\u4e00-\u9fff][^:\n：]{0,24}[:：])"
)
_SPACED_NUMERIC_RANGE_RE = re.compile(r"(?<=\d)-\s+(?=\d)")
_TABLE_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_GLOBAL_COMPETENCE_PLACEHOLDER = "学校通开的全球胜任力培养课程"


def _normalize_page_payload(
    *,
    page_payload: dict[str, object],
    source_pdf: str,
    source_slug: str,
    ocr_provider: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    row_index_start: int,
) -> list[dict[str, object]]:
    pruned = page_payload.get("prunedResult")
    parsing_res_list = pruned.get("parsing_res_list") if isinstance(pruned, dict) else None
    page_height = _extract_page_height(page_payload)
    rows: list[dict[str, object]] = []

    if isinstance(parsing_res_list, list) and parsing_res_list:
        for block_offset, raw_block in enumerate(parsing_res_list, start=1):
            if not isinstance(raw_block, dict):
                continue
            rows.append(
                _normalize_block(
                    raw_block=raw_block,
                    source_pdf=source_pdf,
                    source_slug=source_slug,
                    ocr_provider=ocr_provider,
                    ocr_model=ocr_model,
                    provider_log_id=provider_log_id,
                    provider_page_id=provider_page_id,
                    row_index=row_index_start + block_offset,
                    fallback_block_index=block_offset,
                    page_height=page_height,
                )
            )
        return rows

    markdown = page_payload.get("markdown")
    markdown_text = markdown.get("text") if isinstance(markdown, dict) else None
    normalized_text = _normalize_text(markdown_text if isinstance(markdown_text, str) else "")
    if not normalized_text:
        raise ValueError(
            f"curriculum provider page {provider_page_id} has neither blocks nor markdown text"
        )
    return [
        _build_row(
            source_pdf=source_pdf,
            source_slug=source_slug,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
            provider_log_id=provider_log_id,
            provider_page_id=provider_page_id,
            provider_block_id="markdown-fallback",
            row_index=row_index_start + 1,
            row_id=f"page-{provider_page_id:04d}-block-fallback",
            row_type="paragraph",
            block_role="markdown_fallback",
            heading_level=None,
            reading_order=1,
            bbox=None,
            text_raw=markdown_text,
            text_normalized=normalized_text,
            html=None,
            table_cells=None,
            is_blank=False,
            title_candidate_score=0.0,
            section_hint=None,
            classification_confidence=0.7,
            classification_reason="markdown_fallback:page_text",
        )
    ]


def _normalize_block(
    *,
    raw_block: dict[str, object],
    source_pdf: str,
    source_slug: str,
    ocr_provider: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    row_index: int,
    fallback_block_index: int,
    page_height: float | None,
) -> dict[str, object]:
    block_label = str(raw_block.get("block_label") or "unknown").strip() or "unknown"
    block_content = raw_block.get("block_content")
    text_raw = str(block_content) if isinstance(block_content, str) else ""
    text_normalized = _normalize_text(text_raw)
    block_id = str(raw_block.get("block_id") or fallback_block_index)
    reading_order = raw_block.get("block_order")
    bbox = raw_block.get("block_bbox")
    bbox_value = normalize_bbox(bbox)
    html = text_normalized if "<table" in text_normalized.lower() else None
    table_cells = _extract_table_cells(html) if html else None
    row_type, block_role, heading_level, classification_confidence, classification_reason = (
        _classify_block(
            block_label=block_label,
            text=text_normalized,
            bbox=bbox_value,
            page_height=page_height,
            table_cells=table_cells,
        )
    )
    title_candidate_score = (
        1.0 if block_role == "doc_title" else (0.75 if row_type == "heading" else 0.0)
    )
    section_hint = _section_hint(text_normalized) if row_type == "heading" else None

    return _build_row(
        source_pdf=source_pdf,
        source_slug=source_slug,
        ocr_provider=ocr_provider,
        ocr_model=ocr_model,
        provider_log_id=provider_log_id,
        provider_page_id=provider_page_id,
        provider_block_id=block_id,
        row_index=row_index,
        row_id=f"page-{provider_page_id:04d}-block-{block_id}-{fallback_block_index:04d}",
        row_type=row_type,
        block_role=block_role,
        heading_level=heading_level,
        reading_order=reading_order if isinstance(reading_order, int) else None,
        bbox=bbox_value,
        text_raw=text_raw,
        text_normalized=text_normalized,
        html=html,
        table_cells=table_cells,
        is_blank=not bool(text_normalized),
        title_candidate_score=title_candidate_score,
        section_hint=section_hint,
        classification_confidence=classification_confidence,
        classification_reason=classification_reason,
    )


def _build_row(
    *,
    source_pdf: str,
    source_slug: str,
    ocr_provider: str,
    ocr_model: str,
    provider_log_id: str,
    provider_page_id: int,
    provider_block_id: str,
    row_index: int,
    row_id: str,
    row_type: str,
    block_role: str,
    heading_level: int | None,
    reading_order: int | None,
    bbox: list[object] | None,
    text_raw: str | None,
    text_normalized: str,
    html: str | None,
    table_cells: list[dict[str, object]] | None,
    is_blank: bool,
    title_candidate_score: float,
    section_hint: str | None,
    classification_confidence: float,
    classification_reason: str,
) -> dict[str, object]:
    table_header_rows = infer_table_header_rows(table_cells)
    return {
        "schema_version": LAYOUT_ELEMENTS_SCHEMA_VERSION,
        "corpus": "curriculum",
        "collection": "curriculum_plan",
        "source_artifact_id": f"asset:{source_slug}",
        "source_pdf": source_pdf,
        "page_start": provider_page_id,
        "page_end": provider_page_id,
        "row_id": row_id,
        "row_index": row_index,
        "ocr_provider": ocr_provider,
        "ocr_model": ocr_model,
        "provider_page_id": provider_page_id,
        "provider_block_id": provider_block_id,
        "provider_payload_ref": f"{provider_log_id}:page-{provider_page_id}",
        "confidence": None,
        "row_type": row_type,
        "block_role": block_role,
        "heading_level": heading_level,
        "reading_order": reading_order,
        "bbox": bbox,
        "text_raw": text_raw,
        "text_normalized": text_normalized,
        "html": html,
        "table_cells": table_cells,
        "is_blank": is_blank,
        "is_repeated_candidate": False,
        "title_candidate_score": title_candidate_score,
        "section_hint": section_hint,
        "classification_confidence": classification_confidence,
        "classification_reason": classification_reason,
        "repeat_cluster_id": None,
        "repeat_frequency": 0,
        "repeat_position_band": None,
        "parent_heading_hint": None,
        "list_level_hint": infer_list_level_hint(text_normalized),
        "continues_from_previous_page": False,
        "continues_to_next_page": False,
        "table_fragment_id": None,
        "table_header_rows": table_header_rows,
        "table_row_count": infer_table_row_count(table_cells),
        "table_column_count": infer_table_column_count(table_cells),
        "table_has_merged_cells": detect_merged_cells(table_cells),
        "table_caption_hint": None,
        "owner_row_id": None,
        "relation_type": None,
        "continuation_group_id": None,
    }


def _classify_block(
    *,
    block_label: str,
    text: str,
    bbox: list[float] | None,
    page_height: float | None,
    table_cells: list[dict[str, object]] | None,
) -> tuple[str, str, int | None, float, str]:
    if block_label == "table":
        return "table", "table", None, 0.98, "provider_label:table"
    if block_label == "figure_title":
        return "table_caption", "figure_title", None, 0.92, "provider_label:figure_title"
    if block_label == "vision_footnote":
        return "note", "vision_footnote", None, 0.9, "provider_label:vision_footnote"
    if block_label == "content":
        return "toc_entry", "content", None, 0.94, "provider_label:content"
    if block_label == "number":
        if _looks_like_page_number(text=text, bbox=bbox, page_height=page_height):
            return "page_number", "number", None, 0.9, "provider_label:number:page_number"
        return "paragraph", "number", None, 0.5, "provider_label:number:body_fallback"
    if block_label in {"image", "header_image"}:
        return "image", block_label, None, 0.95, f"provider_label:{block_label}"
    if block_label == "footer":
        return "footer", "footer", None, 0.96, "provider_label:footer"
    if block_label == "doc_title":
        return "heading", "doc_title", 1, 0.99, "provider_label:doc_title"
    if block_label == "paragraph_title":
        return (
            "heading",
            "paragraph_title",
            _infer_heading_level(text),
            0.92,
            "provider_label:paragraph_title",
        )
    if block_label == "text" and _looks_like_page_number(
        text=text,
        bbox=bbox,
        page_height=page_height,
    ):
        return "page_number", "page_number", None, 0.84, "provider_label:text:page_number"
    if block_label == "text" and _looks_like_heading(text):
        return (
            "heading",
            "text_heading_candidate",
            _infer_heading_level(text),
            0.8,
            "text_pattern:heading",
        )
    if table_cells:
        return "table", "table", None, 0.82, "table_cells:detected"
    return "paragraph", block_label, None, 0.78, f"provider_label:{block_label or 'unknown'}"


def _extract_page_height(page_payload: dict[str, object]) -> float | None:
    pruned = page_payload.get("prunedResult")
    if isinstance(pruned, dict):
        value = pruned.get("height")
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def _looks_like_heading(text: str) -> bool:
    return bool(
        text
        and (
            _CN_SECTION_RE.match(text)
            or _looks_like_subsection_heading(text)
            or _CHAPTER_RE.match(text)
            or _looks_like_numeric_heading(text)
        )
    )


def _infer_heading_level(text: str) -> int:
    if _CHAPTER_RE.match(text) or _CN_SECTION_RE.match(text):
        return 2
    if _CN_SUBSECTION_RE.match(text):
        return 3
    if _NUMERIC_HEADING_RE.match(text):
        return 4
    return 2


def _section_hint(text: str) -> str | None:
    if _CHAPTER_RE.match(text):
        return "chapter"
    if _CN_SECTION_RE.match(text):
        return "section"
    if _CN_SUBSECTION_RE.match(text):
        return "subsection"
    if _NUMERIC_HEADING_RE.match(text):
        return "numeric_heading"
    return None


def _normalize_text(text: str) -> str:
    normalized = normalize_text(text or "")
    compact = _repair_sentence_wraps([line for line in normalized.split("\n") if line])
    compact = _DECIMAL_LIST_MARKER_AFTER_SENTENCE_RE.sub("\n", compact)
    compact = _repair_mineru_text_artifacts(compact)
    return compact.strip()


def _repair_mineru_text_artifacts(text: str) -> str:
    repaired = _MISSING_NUMERIC_LIST_DOT_RE.sub(r"\g<number>. \g<body>", text)
    repaired = _SPACED_NUMERIC_RANGE_RE.sub("-", repaired)
    repaired = re.sub(
        r"应修学分(?P<credits>\d+(?:\.\d+)?)学分",
        r"应修\g<credits>学分",
        repaired,
    )
    repaired = repaired.replace("建议续深造学生选修", "建议继续深造学生选修")
    repaired = repaired.replace("马克主义", "马克思主义")
    repaired = repaired.replace("具备具有", "具备")
    repaired = repaired.replace("全球胜任力培养客户", "全球胜任力培养课程")
    repaired = repaired.replace(">全球胜<", ">全球胜任力培养课程<")
    repaired = repaired.replace(">任力培养课程<", ">全球胜任力培养课程<")
    repaired = repaired.replace(">建议拟出国学<", ">建议拟出国学生选修<")
    repaired = repaired.replace(">生选修<", ">建议拟出国学生选修<")
    repaired = repaired.replace("高光谱成像级应用", "高光谱成像及应用")
    repaired = _repair_personalized_study_guidance_intro(repaired)
    repaired = _repair_curriculum_summary_table_artifacts(repaired)
    repaired = _repair_global_competence_placeholder_row(repaired)
    repaired = _repair_global_competence_label_split(repaired)
    repaired = _repair_basic_literacy_label_split(repaired)
    repaired = _repair_industry_collaboration_label_split(repaired)
    repaired = _repair_public_management_table_artifacts(repaired)
    repaired = _repair_public_management_elective_intro(repaired)
    repaired = _repair_minority_preparatory_program_artifacts(repaired)
    repaired = _repair_ethnology_second_bachelor_table_artifact(repaired)
    repaired = _repair_paleography_program_table_artifacts(repaired)
    return _repair_biology_cross_course_table_artifact(repaired)


def _repair_personalized_study_guidance_intro(text: str) -> str:
    if "修读建议拟继续深造学生建议" not in text:
        return text
    return text.replace(
        "修读建议拟继续深造学生建议",
        "修读建议如下:拟继续深造学生建议",
    )


def _repair_curriculum_summary_table_artifacts(text: str) -> str:
    if "<table" not in text or "培养阶段" not in text:
        return text
    repaired = text
    repaired = re.sub(
        r"<tr><td>专业</td><td>专业教育</td><td>专业核心课</td>",
        "<tr><td>专业培养</td><td>专业教育</td><td>专业核心课</td>",
        repaired,
    )
    repaired = re.sub(
        r"<tr><td>培养</td><td></td><td>专业选修课</td>",
        "<tr><td>专业培养</td><td>专业教育</td><td>专业选修课</td>",
        repaired,
    )
    repaired = re.sub(
        r"<tr><td></td><td>学科基础教育</td><td>学科基础课</td>",
        "<tr><td>大类培养</td><td>学科基础教育</td><td>学科基础课</td>",
        repaired,
    )
    return _repair_design_summary_table_major_split(repaired)


def _repair_design_summary_table_major_split(text: str) -> str:
    if "服装与服饰设" not in text or "<table" not in text:
        return text
    repaired = text.replace(
        '<tr><td rowspan="7">专业培养</td><td rowspan="7">专业教育</td>',
        '<tr><td rowspan="8">专业培养</td><td rowspan="8">专业教育</td>',
    )
    return repaired.replace(
        (
            "<tr><td>服装与服饰设</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>"
            "<tr><td></td><td></td><td>计</td><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
        ),
        (
            '<tr><td rowspan="2">服装与服饰设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>'
            "<tr><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
        ),
    )


def _repair_global_competence_placeholder_row(text: str) -> str:
    if _GLOBAL_COMPETENCE_PLACEHOLDER not in text or "<table" not in text:
        return text

    placeholder_cell = rf"<td>{re.escape(_GLOBAL_COMPETENCE_PLACEHOLDER)}/?</td>"
    pattern = re.compile(
        rf"<tr><td>(?P<course_class>全球胜任力(?:培养)?课程)</td>"
        rf"(?P<fields>{placeholder_cell}(?:{placeholder_cell}){{5}})"
        rf"(?P<remark><td>[^<]*</td>)?</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        course_class = match.group("course_class")
        remark = match.group("remark") or ""
        return (
            f"<tr><td>{course_class}</td><td></td>"
            f"<td>{_GLOBAL_COMPETENCE_PLACEHOLDER}</td>"
            f"<td></td><td></td><td></td><td></td>{remark}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_biology_cross_course_table_artifact(text: str) -> str:
    if "1043040223" not in text or "1043040603" not in text:
        return text
    repaired = text.replace(
        '<td rowspan="2">跨学科交叉课程</td><td>1043040223</td>',
        '<td rowspan="3">跨学科交叉课程</td><td>1043040223</td>',
    )
    repaired = repaired.replace(
        '<td rowspan="2">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的</td>',
        '<td rowspan="3">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的其他课程。此模块建议所有学生选修至少2学分</td>',
    )
    return repaired.replace(
        "<tr><td></td><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td><td>其他课程。此模块建议所有学生选修至少2学分</td></tr>",
        "<tr><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td></tr>",
    )


def _repair_global_competence_label_split(text: str) -> str:
    if "全球胜任力培" not in text or "养课程" not in text or "<table" not in text:
        return text

    pattern = re.compile(
        r"<tr><td rowspan=\"2\">全球胜任力培</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr>(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td rowspan=\"2\">养课程</td>(?P<third_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr>(?P<fourth_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        return (
            '<tr><td rowspan="4">全球胜任力培养课程</td>'
            f"{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
            f"<tr>{match.group('third_rest')}</tr>"
            f"<tr>{match.group('fourth_rest')}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_industry_collaboration_label_split(text: str) -> str:
    if "行业领域" not in text or "协同" not in text or "<table" not in text:
        return text

    pattern = re.compile(
        r"<tr><td>行业领域</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td(?:\s+rowspan=\"(?P<rowspan>\d+)\")?>(?P<suffix>协同(?:育人)?课程)</td>"
        r"(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        rowspan = int(match.group("rowspan") or "1")
        suffix = match.group("suffix")
        combined = f"行业领域{suffix}"
        rowspan_attr = f' rowspan="{rowspan + 1}"' if rowspan + 1 > 1 else ""
        return (
            f"<tr><td{rowspan_attr}>{combined}</td>{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_basic_literacy_label_split(text: str) -> str:
    if "基本素" not in text or "养课" not in text or "<table" not in text:
        return text

    pattern = re.compile(
        r"<tr><td>基本素</td>(?P<first_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
        r"<tr><td rowspan=\"(?P<rowspan>\d+)\">养课</td>(?P<second_rest>(?:<td[^>]*>.*?</td>)+)</tr>"
    )

    def replace(match: re.Match[str]) -> str:
        rowspan = int(match.group("rowspan"))
        return (
            f'<tr><td rowspan="{rowspan + 1}">基本素养课</td>'
            f"{match.group('first_rest')}</tr>"
            f"<tr>{match.group('second_rest')}</tr>"
        )

    return pattern.sub(replace, text)


def _repair_public_management_table_artifacts(text: str) -> str:
    if "2-4沟通与合作能够力" not in text and "3-3-1热忱对待公共管理事业" not in text:
        return text

    repaired = text.replace("2-4沟通与合作能够力", "2-4沟通与合作能力")
    repaired = repaired.replace(
        "2-4-3能够初步地进行专业领域的国际交流",
        "2-4-3 能够初步地进行专业领域的国际交流",
    )
    repaired = repaired.replace(
        "2-5-3形成公共管理学专业所需的人文关怀和实践创新能力",
        "2-5-3 形成公共管理学专业所需的人文关怀和实践创新能力",
    )
    repaired = repaired.replace(
        "3-1-4具有维护民族团结和祖国统一的使命感和中华民族共同体意识",
        "3-1-4 具有维护民族团结和祖国统一的使命感和中华民族共同体意识",
    )
    repaired = repaired.replace(
        "3-2-3积极践行社会主义核心价值观", "3-2-3 积极践行社会主义核心价值观"
    )
    pattern = re.compile(
        r"<tr>(?P<prefix>(?:<td[^>]*>.*?</td>)?)<td>3-3职业素养</td>"
        r"<td>3-3-1\s*热忱对待公共管理事业,对国家与社会发展</td></tr>"
        r"<tr>(?:<td[^>]*>\s*</td>){1,2}<td>有责任心</td></tr>"
        r"<tr><td>3-3-2\s*乐于、甘于投身祖国的公共管理事业</td></tr>"
    )
    return pattern.sub(
        lambda match: (
            f'<tr>{match.group("prefix")}<td rowspan="2">3-3职业素养</td>'
            "<td>3-3-1 热忱对待公共管理事业,对国家与社会发展有责任心</td></tr>"
            "<tr><td>3-3-2 乐于、甘于投身祖国的公共管理事业</td></tr>"
        ),
        repaired,
    )


def _repair_public_management_elective_intro(text: str) -> str:
    if "选修列表中的所有课程,原则上两个专业学生均可选修。为区分专业" not in text:
        return text
    return text.replace(
        "选修列表中的所有课程,原则上两个专业学生均可选修。为区分专业",
        "选修列表中的所有课程,原则上两个专业学生均可选修。",
    )


def _repair_minority_preparatory_program_artifacts(text: str) -> str:
    repaired = text.replace("文化引领为一体、根据教学内容和学生特点", "文化引领为一体,根据教学内容和学生特点")
    repaired = repaired.replace(
        "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语基础课程:理科班增设普通化学和大学物理",
        "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。基础课程:理科班增设普通化学和大学物理。",
    )

    summary_bad = (
        "<table><tr><td rowspan=\"2\" colspan=\"2\">类别</td><td rowspan=\"2\">学时</td><td colspan=\"2\">各学期周学时分配计划</td></tr>"
        "<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\"2\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>"
        "<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan=\"2\">限选课</td><td>144</td><td>4</td><td>4</td></tr>"
        "<tr><td colspan=\"2\">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr>"
        "<tr><td rowspan=\"3\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>"
        "<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\"2\">限选课</td><td>144</td><td>4</td><td>4</td></tr>"
        "<tr><td colspan=\"2\">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>"
    )
    summary_good = (
        "<table><tr><td colspan=\"5\">文科班</td></tr><tr><td rowspan=\"2\" colspan=\"2\">类别</td><td rowspan=\"2\">学时</td><td colspan=\"2\">各学期周学时分配计划</td></tr>"
        "<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\"2\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>"
        "<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan=\"2\">限选课</td><td>144</td><td>4</td><td>4</td></tr>"
        "<tr><td colspan=\"2\">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td colspan=\"5\">理科班</td></tr><tr><td rowspan=\"2\" colspan=\"2\">类别</td><td rowspan=\"2\">学时</td><td colspan=\"2\">各学期周学时分配计划</td></tr>"
        "<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\"3\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>"
        "<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\"2\">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\"2\">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>"
    )
    repaired = repaired.replace(summary_bad, summary_good)

    detail_bad = (
        "<table><tr><td rowspan=\"2\">课程类别</td><td rowspan=\"2\">课程编号</td><td rowspan=\"2\">课程名称</td><td rowspan=\"2\">学分</td><td colspan=\"2\">学时</td><td colspan=\"2\">各学期周学时分配</td><td rowspan=\"2\">备注</td></tr>"
        "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan=\"8\">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan=\"8\">必修</td></tr>"
        "<tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr><tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr>"
        "<tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr><tr><td rowspan=\"7\">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan=\"7\">必修</td></tr>"
        "<tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
        "<tr><td>1052030031</td><td>高等数学(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td></tr><tr><td>1052030032</td><td>高等数学(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr>"
        "<tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr><tr><td rowspan=\"3\">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan=\"3\">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr>"
        "<tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辨正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        "<tr><td rowspan=\"3\">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan=\"3\">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        "<tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td rowspan=\"3\">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan=\"3\">选修:根据兴趣及需求选修,可多选</td></tr>"
        "<tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td></td><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
        "<tr><td></td><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
        "<tr><td></td><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr></table>"
    )
    detail_good = (
        "<table><tr><td colspan=\"9\">文科班</td></tr><tr><td rowspan=\"2\">课程类别</td><td rowspan=\"2\">课程编号</td><td rowspan=\"2\">课程名称</td><td rowspan=\"2\">学分</td><td colspan=\"2\">学时</td><td colspan=\"2\">各学期周学时分配</td><td rowspan=\"2\">备注</td></tr>"
        "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan=\"8\">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan=\"8\">必修</td></tr>"
        "<tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr><tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr>"
        "<tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr><tr><td rowspan=\"7\">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan=\"7\">必修</td></tr>"
        "<tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
        "<tr><td>1052030031</td><td>高等数学(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td></tr><tr><td>1052030032</td><td>高等数学(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr>"
        "<tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr><tr><td rowspan=\"3\">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan=\"3\">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr>"
        "<tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辨正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        "<tr><td rowspan=\"3\">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan=\"3\">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        "<tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td rowspan=\"9\">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan=\"9\">选修:根据兴趣及需求选修,可多选</td></tr>"
        "<tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr>"
        "<tr><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr>"
        "<tr><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td colspan=\"9\">理科班</td></tr>"
        "<tr><td rowspan=\"2\">课程类别</td><td rowspan=\"2\">课程编号</td><td rowspan=\"2\">课程名称</td><td rowspan=\"2\">学分</td><td colspan=\"2\">学时</td><td colspan=\"2\">各学期周学时分配</td><td rowspan=\"2\">备注</td></tr><tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr>"
        "<tr><td rowspan=\"8\">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan=\"8\">必修</td></tr><tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr>"
        "<tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr><tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
        "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr><tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr>"
        "<tr><td rowspan=\"7\">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan=\"7\">必修</td></tr><tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
        "<tr><td>1052030063</td><td>高等数学(一)</td><td>6</td><td>108</td><td>12</td><td>6</td><td>/</td></tr><tr><td>1052030064</td><td>高等数学(二)</td><td>6</td><td>108</td><td>12</td><td>/</td><td>6</td></tr><tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr>"
        "<tr><td rowspan=\"2\">基础课</td><td>1052030065</td><td>普通化学</td><td></td><td>72</td><td>18</td><td>4</td><td>/</td><td rowspan=\"2\">必修(实验18学时)</td></tr><tr><td>1052030066</td><td>大学物理</td><td></td><td>72</td><td>18</td><td>/</td><td>4</td></tr>"
        "<tr><td rowspan=\"3\">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan=\"3\">选修:每学期限选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辩正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        "<tr><td rowspan=\"3\">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan=\"3\">选修:每学期限选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
        "<tr><td rowspan=\"9\">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan=\"9\">选修:根据兴趣及需求选修,可多选</td></tr><tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr>"
        "<tr><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr>"
        "<tr><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr></table>"
    )
    return repaired.replace(detail_bad, detail_good)


def _repair_ethnology_second_bachelor_table_artifact(text: str) -> str:
    if "专业必修课共30学分" not in text or "专业选修课须修满12学分" not in text:
        return text
    repaired = text.replace(
        '<td rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td>',
        '<td rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>',
    )
    return repaired.replace(
        "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>",
        "",
    )


def _repair_paleography_program_table_artifacts(text: str) -> str:
    if "全球胜任力培养</td>" not in text and "370</td><td>350</td><td>120" not in text:
        return text
    repaired = text.replace(">全球胜任力培养<", ">全球胜任力培养课程<")
    return repaired.replace(
        "<td>思政课</td><td>19</td><td>必修</td><td>370</td><td>350</td><td>120</td>",
        "<td>思政课</td><td>19</td><td>必修</td><td>370</td><td>250</td><td>120</td>",
    )


def _slugify_filename(filename: str) -> str:
    stem = Path(filename).stem.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in stem).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


def _looks_like_numeric_heading(text: str) -> bool:
    match = _NUMERIC_HEADING_RE.match(text)
    if not match:
        return False
    remainder = text[match.end() :].strip()
    if not remainder or len(remainder) > 20 or _SENTENCE_PUNCTUATION_RE.search(remainder):
        return False
    return not any(token in remainder for token in ("，", ",", "、", "以及", "并", "能够", "可以"))


def _looks_like_subsection_heading(text: str) -> bool:
    match = _CN_SUBSECTION_RE.match(text)
    if not match:
        return False
    remainder = text[match.end() :].strip()
    if not remainder or len(remainder) > 18 or _SENTENCE_PUNCTUATION_RE.search(remainder):
        return False
    return not any(
        token in remainder
        for token in ("，", ",", "、", "能够", "可以", "具备", "具有", "掌握", "理解")
    )


def _repair_sentence_wraps(lines: list[str]) -> str:
    if not lines:
        return ""
    repaired = lines[0]
    for line in lines[1:]:
        if _should_preserve_line_break(repaired, line):
            repaired = f"{repaired}\n{line}"
            continue
        repaired = f"{repaired}{_joiner_between(repaired, line)}{line}"
    return repaired


def _should_preserve_line_break(previous: str, current: str) -> bool:
    previous_tail = previous.rstrip()
    if not previous_tail:
        return False
    previous_line = previous_tail.rsplit("\n", maxsplit=1)[-1]
    if previous_tail.endswith(("。", "！", "？", "；", ":", "：")):
        return True
    if _FIELD_LABEL_LINE_RE.match(previous_line):
        return True
    if _FIELD_LABEL_LINE_RE.match(current):
        return True
    return bool(_LIST_LIKE_LINE_RE.match(current))


def _joiner_between(previous: str, current: str) -> str:
    previous_tail = previous.rstrip()
    current_head = current.lstrip()
    if not previous_tail or not current_head:
        return ""
    if (
        previous_tail[-1].isascii()
        and previous_tail[-1].isalnum()
        and current_head[0].isascii()
        and current_head[0].isalnum()
    ):
        return " "
    return ""


def _extract_table_cells(html: str) -> list[dict[str, object]] | None:
    return extract_html_table_cells(html)


def _looks_like_page_number(
    *, text: str, bbox: list[float] | None, page_height: float | None
) -> bool:
    normalized = text.strip()
    if not normalized.isdigit() or len(normalized) > 4:
        return False
    if bbox is None:
        return True
    if is_bottom_band(bbox=bbox, page_height=page_height):
        return True
    return len(bbox) >= 4 and float(bbox[1]) >= 700
